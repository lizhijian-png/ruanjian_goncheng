# 投票完成即提前结算设计文档

**日期：** 2026-06-15
**状态：** 已审批

---

## 背景

当前任务结算（`settlePost`）只在 `evaluationDeadline` 到期时由 `syncPostStatus` 触发（[server.js:110-114](../../../backend/src/server.js#L110-L114)）。即使所有参与者早已完成投票，仍要等到截止时间（进入待评价后约 32 小时）才结算、发积分、把帖子状态置为"已完成"。

本设计在保留截止兜底的前提下，新增"投票全部完成即提前结算"的触发路径。

---

## 需求

- 当所有参与者都对其余每个参与者投完完成票时，立即结算，不等截止时间。
- 任务只有发布者、没有搭子（N=1）时，进入待评价即结算。
- 保留 `evaluationDeadline` 到期作为兜底：有人迟迟不投票，到期照常自动结算。

---

## "投票全部完成"的判定口径

待评价阶段参与者有两个独立动作：

- **互评** `/evaluate`：给其他人打分+评语，每对一条 `evaluations` 记录。
- **完成投票** `/completion-vote`：投"完成/未完成"，决定结算时各人是否算完成。不投默认支持。

提前结算以**完成投票**为触发依据（用户选定）。判定：

```
N        = 当前参与者数（发布者 + 当前 post_buddies）
required = N × (N - 1)        // 每人对其余每人各投一票
actual   = SELECT COUNT(*) FROM completion_votes
           WHERE postId=? AND voterId IN(参与者) AND targetId IN(参与者)

若 actual >= required → 触发 settlePost(postId)
```

- 只有用户主动点过"完成/未完成"按钮、写入 `completion_votes` 的票才计数。
- N=1 时 `required = 0`，任何时候都满足 → 进入待评价即结算。
- 只统计当前参与者之间的票。中途退出的搭子不在参与者集合内，其历史票不计入（与现有 `settlePost` 的参与者口径一致，见 [completion-vote-design.md](2026-06-10-completion-vote-design.md)）。

---

## 架构

### 新增辅助函数 `maybeSettleEarly(postId)`

放在 `settlePost` 附近（[server.js:117](../../../backend/src/server.js#L117) 前后）。职责单一：判断是否满足"投票全投完"，满足则调用 `settlePost`。

```
async function maybeSettleEarly(postId):
    post = SELECT * FROM posts WHERE id=?
    if !post 或 post.status !== '待评价': return    // 仅待评价可提前结算
    buddies = SELECT userId FROM post_buddies WHERE postId=?
    participants = [post.publisherId, ...buddies.userId]
    N = participants.length
    required = N * (N - 1)
    if required > 0:
        actual = SELECT COUNT(*) FROM completion_votes
                 WHERE postId=? AND voterId IN(participants) AND targetId IN(participants)
        if actual < required: return
    await settlePost(postId)
```

**防并发重复**：`settlePost` 内部第一步是带守卫的更新
`UPDATE posts SET status='已完成' ... WHERE id=? AND status='待评价'`（[server.js:122-126](../../../backend/src/server.js#L122-L126)），`affectedRows===0` 时直接 return。因此即使提前触发与截止兜底竞争、或并发多次调用，也只会结算一次。`maybeSettleEarly` 自身不需要额外加锁。

---

## 接入点

1. **`POST /completion-vote` 写票成功后**（[server.js:944](../../../backend/src/server.js#L944) 之后，`res.status(204)` 之前）→ `await maybeSettleEarly(req.params.id)`。这是主路径：最后一票投完即结算。
2. **`POST /complete` 手动标记完成、状态置为待评价后**（[server.js:860](../../../backend/src/server.js#L860) 之后）→ `await maybeSettleEarly(req.params.id)`。主要让 N=1 立即结算。
3. **`syncPostStatus` 中 `进行中→待评价` 自动转换后**（[server.js:104](../../../backend/src/server.js#L104) 之后、`return` 之前）→ `await maybeSettleEarly(postId)`。覆盖 N=1 在 `endTime` 自动到期进入待评价的场景。

接入点 2、3 调用 `maybeSettleEarly` 时，刚写入的状态已是"待评价"，函数内的状态检查通过。

---

## 保留不变

`syncPostStatus` 中"待评价 + `now >= evaluationDeadline`"仍调用 `settlePost`（[server.js:110-114](../../../backend/src/server.js#L110-L114) 不改）。截止兜底完整保留。

`settlePost` 的逐人投票判定、积分发放、完成率重算、AI 评语生成逻辑全部不变。

---

## 副作用

提前结算会同步关闭评价窗口（结算后帖子转"已完成"，`/evaluate` 与 `/completion-vote` 的"仅待评价"校验会拒绝后续提交）。若某人投了完成票但尚未提交互评分数/评语，提前结算后将来不及补评，其 AI 评语也不会生成（AI 评语只针对已有 `evaluations` 的人，[server.js:175-183](../../../backend/src/server.js#L175-L183)）。

这与"截止到期结算"时未评价者的处境一致，只是触发时点提前。属可接受范围。

---

## 前端

`evaluate` 页面：投出完成票（`/completion-vote` 返回后），后端可能已直接结算、帖子转"已完成"。前端在投票请求成功后应重新拉取帖子状态（`GET /api/posts/:id`），若状态变为"已完成"则切换到只读/结果态，避免用户继续在已结算的帖子上操作。具体改动在实现计划中细化。

---

## 测试

- N=1：进入待评价（手动 `/complete` 或自动到期）即结算，发布者按 0 反对票判完成。
- N=2：双方互投 2 票后立即结算；只投 1 票不结算。
- N=3：投满 6 票结算；差 1 票（5 票）不结算。
- 截止兜底：有人不投票，`evaluationDeadline` 到期仍正常结算。
- 重复投票（改票，`ON DUPLICATE KEY UPDATE`）：票数不增，不会触发额外结算；结算已发生时 `settlePost` 守卫使其幂等。
- 中途退票/退出：已退出搭子不计入 N 与票数统计。

---

## 不在本期范围内

- 投票进度的实时推送或前端进度条。
- 对"未完成"判定的申诉机制。
- 提前结算的通知提醒。
