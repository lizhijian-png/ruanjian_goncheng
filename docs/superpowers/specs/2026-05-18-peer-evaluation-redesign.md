# 多对多互评系统重设计

**日期：** 2026-05-18  
**状态：** 待实现

---

## 背景

原评价系统每人只能对"整个帖子"提交一条评价，不区分被评价对象，无法支持多搭子场景下的逐人互评。现重设计为多对多互评，每位参与者可对其他每位参与者分别评价，评价完全可选，任务完成由时间驱动。

---

## 数据模型变更

### `evaluations` 表（修改）
新增字段：
- `toId VARCHAR(64) NOT NULL` — 被评价者的 userId

现有字段保留：`id`, `postId`, `fromId`, `fromName`, `score`, `content`, `createdAt`

约束：`(postId, fromId, toId)` 唯一，防止重复评价同一人。

迁移说明：现有旧数据的 `toId` 可设为空字符串或清理，旧数据不影响新逻辑。

### `posts` 表（修改）
- 新增 `evaluationDeadline DATETIME DEFAULT NULL` — 进入"待评价"时写入（`NOW() + 32小时`）
- 删除 `publisherEvaluated TINYINT` — 完成判定改为时间驱动，不再需要

### `post_buddies` 表（修改）
- 删除 `evaluated TINYINT` — 同上，不再需要

### `users` 表（修改）
- 新增 `avgScore DECIMAL(3,1) DEFAULT NULL` — 收到评价时滚动更新；NULL 表示尚未收到任何评价

---

## 状态机变更

### `syncPostStatus` 新增逻辑

```
进行中 → 待评价：
  条件：endTime 到期（原有逻辑）
  新增：写入 evaluationDeadline = NOW() + 32h

待评价 → 已完成：
  条件：NOW() >= evaluationDeadline
  触发：积分结算（原有逻辑，搬移到此处）
```

原来"所有人都提交评价才完成"的逻辑完全删除，改为时间驱动。

---

## API 变更

### `POST /api/posts/:id/evaluate`（修改）

请求体：
```json
{
  "userId": "fromId（评价者）",
  "toId": "被评价者 userId（必填）",
  "score": 1-5,
  "content": "文字内容"
}
```

校验：
1. `toId` 必须是该帖子的参与者（发布者或搭子）
2. `toId !== userId`（不能自评）
3. `(postId, fromId, toId)` 组合不可重复
4. `userId` 必须是该帖子的参与者
5. 帖子状态必须为"待评价"

写入：
- 插入 `evaluations` 记录
- 调用 `updateUserAvgScore(toId)` 更新被评价者的 `avgScore`

删除旧逻辑：不再读写 `publisherEvaluated`、`post_buddies.evaluated`

### `GET /api/posts/:id`（修改）

新增 query 参数：`viewerId`（当前用户 userId）

响应中 `evaluations` 字段过滤规则：
- 返回 `fromId = viewerId`（我发出的）
- 返回 `toId = viewerId`（我收到的）
- 其他组合不返回

同时在响应中区分：
```json
{
  "evaluationsSent": [...],     // 我发出的
  "evaluationsReceived": [...]  // 我收到的
}
```

### `GET /api/users/:id/evaluations-received`（新增）

返回该用户在所有帖子中收到的全部评价，预留 AI 分析接口。

响应：
```json
[
  {
    "postId": "...",
    "fromId": "...",
    "fromName": "...",
    "score": 4,
    "content": "...",
    "createdAt": "..."
  }
]
```

无特殊鉴权，后续按需添加。

---

## 前端变更

### 帖子详情页（`post-detail`）

**待评价状态时：**
- 显示"评价"按钮
- 按钮下方显示 deadline 倒计时（"还有 XX 小时 XX 分钟"）

**评价区域展示（两个独立列表）：**
- "我对他人的评价"：`evaluationsSent` 列表，显示对谁、几分、内容
- "他人对我的评价"：`evaluationsReceived` 列表，显示谁评、几分、内容

### 人员选择页（新页面或弹出层）

点击"评价"按钮后进入，展示所有其他参与者：
- 昵称
- 状态标记：已评价 / 未评价（根据 `evaluationsSent` 判断）

点击某人：
- 未评价 → 进入评价表单（评分滑块 1-5 + 文字输入 + 提交）
- 已评价 → 只读展示已提交的分数和内容

提交后返回人员选择页，该人更新为"已评价"标记。

---

## 辅助函数

### `updateUserAvgScore(userId)`
每次新增评价时调用，重新计算该用户在所有帖子中收到的评价均值，写入 `users.avgScore`。

```sql
SELECT AVG(score) FROM evaluations WHERE toId = ?
```

---

## 不在本次范围内

- AI 评价分析接口实现（`/api/users/:id/evaluations-received` 仅预留）
- 评价提醒通知
- 评价内容审核
