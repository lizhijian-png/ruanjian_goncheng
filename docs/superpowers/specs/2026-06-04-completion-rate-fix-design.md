# 完成率修复设计

**日期：** 2026-06-04

## 问题

`users.completionRate` 存在两个 bug：

1. `recalcCompletionRate(userId)` 的 SQL 只统计 `publisherId = userId` 的任务，buddy 参与并完成的任务不计入
2. `settlePost()` 结算后只对发布者调用 `recalcCompletionRate`，所有 buddy 的完成率从不更新

导致现象：用户以 buddy 身份完成任务可以获得积分，但完成率永远为 0。

## 方案

方案 A：最小改动，只修 `backend/src/server.js`，不变更数据库 schema。

## 设计

### 1. `recalcCompletionRate` SQL 逻辑

**现在：**
```sql
SELECT COUNT(*) AS total, SUM(status = '已完成') AS done
FROM posts WHERE publisherId = ?
```

**改为：**
```sql
SELECT
  (SELECT COUNT(*) FROM posts WHERE publisherId = ? AND status = '已完成')
  + (SELECT COUNT(*) FROM post_buddies pb JOIN posts p ON pb.postId = p.id
     WHERE pb.userId = ? AND p.status = '已完成') AS done,
  (SELECT COUNT(*) FROM posts WHERE publisherId = ?)
  + (SELECT COUNT(*) FROM post_buddies WHERE userId = ?) AS total
```

- `done` = 我发布且已完成 + 我作为 buddy 参与且已完成
- `total` = 我发布的总数 + 我作为 buddy 参与的总数
- `total = 0` 时 `completionRate = 0`，逻辑不变
- 函数签名和调用方式不变

### 2. `settlePost` 补全 buddy 更新

事务内已查出所有 buddy 的 `userId`，事务结束后对每个 buddy 也调用一次 `recalcCompletionRate`。

**数据流：**
```
settlePost(postId)
  └─ 事务：发布者 + 每个 buddy 加积分，记录 buddyIds
  └─ 事务后：
       recalcCompletionRate(publisherId)
       for each buddy → recalcCompletionRate(buddy.userId)  ← 新增
       generateAiComment(...)
```

### 3. 边界情况

- `abandon` 路径已调用 `recalcCompletionRate(publisherId)`，不需要改动（buddy 放弃时无积分变化，完成率不更新）
- 性能影响可忽略：每次结算多几条子查询，任务参与人数极小

## 改动范围

仅 `backend/src/server.js` 两处：
- `recalcCompletionRate` 函数体（约 5 行）
- `settlePost` 事务后的 buddy 循环（新增约 3 行）
