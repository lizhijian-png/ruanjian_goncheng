# 任务完成投票机制设计文档

**日期：** 2026-06-10  
**状态：** 已审批

---

## 背景

现有系统中，任务是否"完成"由帖子整体状态决定（时间到期或发布者手动触发），不区分个人。积分和完成率的发放以帖子为单位，所有参与者一律相同。

本设计将完成判定改为**分人、由同伴投票**的机制：每个参与者是否完成任务，由其他参与者在评价窗口内投票决定，结果影响该人的积分和完成率。

---

## 需求

- 发布者和搭子地位对等，所有参与者的完成状态都由其余参与者投票决定。
- 评价页面为每个被评价人新增"完成 / 未完成"切换按钮。
- 投票时限与评价功能共用同一个 `evaluationDeadline`。
- 未对某人投票，默认视为支持其完成；只有明确投"未完成"才计为反对票。
- 反对票超过其他参与者总数的一半，该人判定为未完成；否则判定为已完成。
- 完成的人获得 `reward` 积分，完成率分子+1、分母+1；未完成的人不得积分，仅分母+1。

---

## 数据模型

### 新增表：`completion_votes`

```sql
CREATE TABLE completion_votes (
  id        VARCHAR(64) PRIMARY KEY,
  postId    VARCHAR(64) NOT NULL,
  voterId   VARCHAR(64) NOT NULL,
  targetId  VARCHAR(64) NOT NULL,
  vote      ENUM('complete', 'incomplete') NOT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_vote (postId, voterId, targetId)
);
```

- `voterId`：投票人，必须是该帖子的参与者。
- `targetId`：被判定人，必须是该帖子的参与者，且不能等于 `voterId`。
- 同一 `(postId, voterId, targetId)` 可重复提交，用 `ON DUPLICATE KEY UPDATE vote = VALUES(vote)` 覆盖。
- `evaluationDeadline` 过期后拒绝写入（返回 403）。

### `posts` 表、`evaluations` 表无需改动。

---

## 判定逻辑

设帖子参与者（发布者 + 所有搭子）总数为 **N**。

对每位参与者 `targetId`：

```
rejectCount = 明确投了 'incomplete' 的人数
voterCount  = N - 1（其余所有参与者）

// 完成条件：支持票（包含默认支持）严格大于总投票人数的一半
// 等价于：反对票 * 2 < voterCount
if rejectCount * 2 >= voterCount:
    判定为"未完成"
else:
    判定为"已完成"
```

未投票等价于支持完成，无需写入数据库，计算时自动成立。

**边界示例：**

| voterCount | rejectCount | 结果 |
|-----------|-------------|------|
| 1 | 0 | 已完成（无人反对）|
| 1 | 1 | 未完成（唯一投票人反对）|
| 2 | 1 | 未完成（1反对 = 恰好一半，未超过半数支持）|
| 2 | 0 | 已完成 |
| 3 | 1 | 已完成（2支持 > 1.5）|
| 3 | 2 | 未完成（1支持 ≤ 1.5）|

---

## API 设计

### 新增：`POST /api/posts/:id/completion-vote`

**请求体：**
```json
{ "targetId": "string", "vote": "complete" | "incomplete" }
```

**鉴权规则：**
- voterId（当前登录用户）必须是该帖子参与者。
- targetId 必须是该帖子参与者。
- voterId ≠ targetId（不能对自己投票）。
- 帖子状态必须为 `待评价`，且当前时间 ≤ `evaluationDeadline`。

**响应：** 204 No Content

### 修改：`GET /api/posts/:id`

响应新增字段，返回当前用户已投的完成票：

```json
"myCompletionVotes": {
  "<targetUserId>": "complete" | "incomplete"
}
```

仅返回当前用户作为 voterId 的记录。未投票的 targetId 不出现在此对象中。

### 修改：`settlePost` 函数

结算时逐人判定，替换原来的统一发积分逻辑：

```
participants = [publisherId, ...buddyIds]
N = participants.length

for each targetId in participants:
    rejectCount = SELECT COUNT(*) FROM completion_votes
                  WHERE postId=? AND targetId=? AND vote='incomplete'
    voterCount  = N - 1

    if rejectCount * 2 >= voterCount:
        // 未完成：不发积分
        // 在 post_buddies 或单独字段记录该人本次任务未完成
        UPDATE post_buddies SET isComplete = 0
          WHERE postId=? AND userId=?
        // 发布者未完成：在 posts 表记录
        // (若 targetId === publisherId，在 posts 记录 publisherComplete = 0)
    else:
        // 已完成：发 reward 积分
        UPDATE users SET points = points + post.reward WHERE id = targetId
        UPDATE post_buddies SET isComplete = 1
          WHERE postId=? AND userId=?

// 结算完毕后，逐人重算完成率
for each targetId in participants:
    recalcCompletionRate(targetId)
```

### `post_buddies` 表新增字段

```sql
ALTER TABLE post_buddies ADD COLUMN isComplete TINYINT(1) NULL;
-- NULL 表示尚未结算，0=未完成，1=已完成
```

发布者的完成结果记录在 `posts` 表新增字段：

```sql
ALTER TABLE posts ADD COLUMN publisherComplete TINYINT(1) NULL;
```

### `recalcCompletionRate` 修改

完成率需同时统计"作为发布者的完成情况"和"作为搭子的完成情况"：

```sql
-- 作为发布者：已完成的帖子数 / 发布的全部帖子数
SELECT COUNT(*) AS total, SUM(publisherComplete = 1) AS done
FROM posts WHERE publisherId = ?

-- 作为搭子：已完成的参与记录数 / 全部参与记录数（已结算的）
SELECT COUNT(*) AS total, SUM(isComplete = 1) AS done
FROM post_buddies WHERE userId = ? AND isComplete IS NOT NULL

-- 合并：rate = (done_publisher + done_buddy) / (total_publisher + total_buddy)
```

`completionRate` 含义从"发布完成率"扩展为"全局参与完成率"，覆盖发布者和搭子两种身份。

---

## 前端 UI

### 评价页面（evaluate）

在每个被评价人的评价卡片内新增完成判定区域，位置在评分和评语下方：

```
┌─────────────────────────────────────┐
│  张三                               │
│  评分：★★★★☆                       │
│  评语：[输入框]                      │
│                                     │
│  任务完成判定：                      │
│  [✓ 已完成]  [ 未完成]              │
└─────────────────────────────────────┘
```

- 页面加载时调用 `GET /api/posts/:id`，读取 `myCompletionVotes` 回显当前投票状态。
- 未投票时默认高亮"已完成"（视觉上表达默认支持），但不写入数据库——只有用户主动点击才发请求。
- 点击任一按钮时立即调用 `POST /api/posts/:id/completion-vote`，独立于评价提交，不阻塞评价流程。
- `evaluationDeadline` 过期后按钮变为只读，显示最终投票结果。

### 帖子详情页（post-detail）

无需改动。完成判定结果通过结算后的积分变化和个人完成率体现，不在详情页展示中间投票进度。

---

## 边界情况

| 情况 | 处理方式 |
|------|---------|
| 帖子只有 1 个参与者（无他人可投票） | voterCount = 0，rejectCount 永远为 0，判定为已完成 |
| 用户在 evaluationDeadline 后尝试投票 | 返回 403，前端按钮已变只读，正常不会触发 |
| 用户重复投票（改变投票） | ON DUPLICATE KEY UPDATE 覆盖，取最新值 |
| 搭子中途退出帖子 | 已退出搭子不再是参与者，不纳入 N 的计算；其已投的票保留（已发出的票不撤回） |

---

## 不在本期范围内

- 投票结果的实时通知（push 或轮询）。
- 在帖子详情页展示各人的投票进度。
- 对"未完成"判定提出申诉的机制。
