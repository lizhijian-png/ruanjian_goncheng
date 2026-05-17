# 个性化推荐分系统设计

**日期:** 2026-05-17

## 背景

当前 `recommendedScore` 硬编码为 80，feed 仅按 `createdAt DESC` 排序，无任何个性化逻辑。本次改动实现用户 × 帖子维度的个性化推荐分，综合发布者质量、帖子本身吸引力、用户历史偏好三个维度排序 feed。

---

## 推荐分公式

```
recommendedScore = 发布者质量分 × 0.4 + 帖子基础分 × 0.3 + 用户偏好分 × 0.3
```

最终结果四舍五入取整，范围 0–100。

### 发布者质量分（0–100）

```
= completionRate × 0.6 + min(points / 10, 100) × 0.4
```

- `completionRate`：用户表中已有的 0–100 整数
- `points / 10` cap 到 100，避免高积分垄断排名

### 帖子基础分（0–100）

```
= min(reward / 2, 50) + min(penalty / 2, 30) + 满员加成
```

- `reward` / `penalty` 越高代表帖子认真程度越高，各自设上限防止极端值
- 满员加成：`currentBuddies >= maxBuddies × 0.8` 时 +20（热门信号）

### 用户偏好分（0–100）

基于用户历史上在该 `category` 下**作为搭子**加入的帖子，按完成/放弃加权：

```
= doneCount × 2 / (doneCount × 2 + abandonCount) × 100
```

- `doneCount`：该 category 下状态为 `已完成` 的加入记录数
- `abandonCount`：该 category 下状态为 `已放弃` 的加入记录数
- 新用户或无历史记录时，偏好分默认 **50**（中性，不惩罚也不加成）

---

## 数据流

### 前端改动（`miniprogram/pages/home/home.js`）

`_loadPage` 调用 `api.getFeed` 时附带当前用户 `userId`：

```js
const result = await api.getFeed({
  category: activeCategory,
  startAfter: activeStartAfter,
  endBefore: activeEndBefore,
  keyword,
  userId: currentUserId,   // 新增
  page,
  pageSize: PAGE_SIZE
});
```

`currentUserId` 从 `app.globalData.userInfo.id` 或 `wx.getStorageSync('userInfo').id` 读取，未登录时不传。

### 后端改动（`backend/src/server.js`）

#### 新增 helper 函数

`calcRecommendedScore(post, publisherUser, preferenceMap)` 纯函数，放在文件顶部 helper 区：

```js
/**
 * @param {object} post - mapPost 之前的原始 DB row
 * @param {object|null} publisherUser - users 表行，可为 null
 * @param {Map<string, {doneCount:number, abandonCount:number}>} preferenceMap
 * @returns {number} 0-100 整数
 */
function calcRecommendedScore(post, publisherUser, preferenceMap) {
  // 发布者质量分
  const cr = publisherUser ? (publisherUser.completionRate || 0) : 0;
  const pts = publisherUser ? Math.min((publisherUser.points || 0) / 10, 100) : 0;
  const publisherScore = cr * 0.6 + pts * 0.4;

  // 帖子基础分
  const rewardScore = Math.min((post.reward || 0) / 2, 50);
  const penaltyScore = Math.min((post.penalty || 0) / 2, 30);
  const hotBonus = (post.currentBuddies || 0) >= (post.maxBuddies || 1) * 0.8 ? 20 : 0;
  const postScore = rewardScore + penaltyScore + hotBonus;

  // 用户偏好分
  const pref = preferenceMap ? preferenceMap.get(post.category) : null;
  let prefScore = 50;
  if (pref) {
    const total = pref.doneCount * 2 + pref.abandonCount;
    prefScore = total > 0 ? (pref.doneCount * 2 / total) * 100 : 50;
  }

  return Math.round(publisherScore * 0.4 + postScore * 0.3 + prefScore * 0.3);
}
```

#### `GET /api/posts` 查询流程变更

**原流程：**
```
WHERE条件 → SQL排序(createdAt DESC) → LIMIT/OFFSET → 返回
```

**新流程：**
```
WHERE条件 → 取全量符合条件的帖子
  → (若有 userId) 查偏好向量（一次 GROUP BY 查询）
  → JOIN 发布者信息（已有）
  → 对每条帖子内存计算 recommendedScore
  → 内存按 score DESC 排序
  → 内存分页（slice）
  → 返回
```

#### 偏好向量查询 SQL

```sql
SELECT p.category,
  SUM(CASE WHEN p.status = '已完成' THEN 1 ELSE 0 END) AS doneCount,
  SUM(CASE WHEN p.status = '已放弃' THEN 1 ELSE 0 END) AS abandonCount
FROM post_buddies pb
JOIN posts p ON p.id = pb.postId
WHERE pb.userId = ?
GROUP BY p.category
```

结果构建为 `Map<category, {doneCount, abandonCount}>`，传入 `calcRecommendedScore`。

---

## 边界情况

| 情况 | 处理 |
|------|------|
| 无 `userId`（未登录或未传） | `preferenceMap` 为 null，偏好分固定 50 |
| 新用户，无任何加入历史 | preferenceMap 为空 Map，偏好分固定 50 |
| 某 category 只有放弃记录 | `doneCount=0`，偏好分 = 0 |
| 发布者已删除 | `publisherUser` 为 null，发布者质量分 = 0 |
| reward=0，penalty=0 | 帖子基础分仅靠满员加成，最低可为 0 |
| 自己发布的帖子出现在 feed | 正常参与排序，不做特殊处理 |

---

## 不改动范围

- `posts` 表结构不变（`recommendedScore` 列保留但仅作展示用，不再用于排序）
- `users` 表结构不变
- profile 页、post-detail 页不受影响
- 前端 `home.wxml` 展示的 `recommendedScore` 字段现在显示实时计算的个性化分数

---

## 性能说明

内存排序在帖子数量为数百条时（课程项目规模）完全可接受。偏好向量查询为单次 GROUP BY，时间复杂度 O(用户加入帖子数)。如未来帖子量增大，可在 `post_buddies` 的 `userId` 上加索引优化。
