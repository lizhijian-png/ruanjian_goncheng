# 个性化推荐分系统实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 feed 排序从纯时间序改为基于发布者质量、帖子吸引力、用户历史偏好的个性化推荐分排序。

**Architecture:** 后端新增 `calcRecommendedScore` 纯函数，`GET /api/posts` 取全量候选帖子后在内存计算个性化分并排序分页；前端 `getFeed` 传入 `userId`，`home.js` 读取当前用户 id 并附带请求。

**Tech Stack:** Node.js/Express + mysql2/promise（后端），WeChat miniprogram JS（前端）

---

## 文件清单

| 文件 | 操作 |
|------|------|
| `backend/src/server.js` | 修改：新增 `calcRecommendedScore`，改造 `GET /api/posts` |
| `miniprogram/services/api.js` | 修改：`getFeed` 接受并传递 `userId` |
| `miniprogram/pages/home/home.js` | 修改：`_loadPage` 附带当前用户 `userId` |

---

## Task 1：后端 — 新增 `calcRecommendedScore` 纯函数

**Files:**
- Modify: `backend/src/server.js`（在 `syncPostStatus` 函数之后，约第 52 行后插入）

- [ ] **Step 1：在 `syncPostStatus` 函数结束后插入 `calcRecommendedScore`**

找到 `backend/src/server.js` 中 `syncPostStatus` 函数的结束花括号（约第 52 行），在其后插入：

```js
function calcRecommendedScore(post, publisherUser, preferenceMap) {
  const cr = publisherUser ? (publisherUser.completionRate || 0) : 0;
  const pts = publisherUser ? Math.min((publisherUser.points || 0) / 10, 100) : 0;
  const publisherScore = cr * 0.6 + pts * 0.4;

  const rewardScore = Math.min((post.reward || 0) / 2, 50);
  const penaltyScore = Math.min((post.penalty || 0) / 2, 30);
  const hotBonus = (post.currentBuddies || 0) >= (post.maxBuddies || 1) * 0.8 ? 20 : 0;
  const postScore = rewardScore + penaltyScore + hotBonus;

  const pref = preferenceMap ? preferenceMap.get(post.category) : null;
  let prefScore = 50;
  if (pref) {
    const total = pref.doneCount * 2 + pref.abandonCount;
    prefScore = total > 0 ? (pref.doneCount * 2 / total) * 100 : 50;
  }

  return Math.round(publisherScore * 0.4 + postScore * 0.3 + prefScore * 0.3);
}
```

- [ ] **Step 2：验证语法**

```bash
node --check backend/src/server.js
```

预期：无输出（语法正确）

- [ ] **Step 3：提交**

```bash
git add backend/src/server.js
git commit -m "feat: 新增 calcRecommendedScore 纯函数"
```

---

## Task 2：后端 — 改造 `GET /api/posts` 使用个性化排序

**Files:**
- Modify: `backend/src/server.js`（`GET /api/posts` 处理函数，约第 150–203 行）

- [ ] **Step 1：替换 `GET /api/posts` 处理函数**

找到以下代码块（约第 150–203 行）：

```js
app.get('/api/posts', async (req, res, next) => {
  try {
    const { category, startAfter, endBefore, keyword } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize) || 10));
    const offset = (page - 1) * pageSize;

    const conditions = [];
    const params = [];

    if (category) {
      conditions.push('p.category = ?');
      params.push(category);
    }
    if (startAfter) {
      conditions.push('p.startTime >= ?');
      params.push(startAfter);
    }
    if (endBefore) {
      conditions.push('p.endTime <= ?');
      params.push(endBefore + ' 23:59:59');
    }
    if (keyword) {
      conditions.push('(p.title LIKE ? OR p.publisherName LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const whereClause = where ? ` ${where}` : '';

    const countRows = await query(
      `SELECT COUNT(*) AS total FROM posts p LEFT JOIN users u ON p.publisherId = u.id${whereClause}`,
      params
    );
    const total = countRows[0].total;

    const rows = await query(
      `SELECT p.*, u.avatarUrl AS publisherAvatarUrl
       FROM posts p LEFT JOIN users u ON p.publisherId = u.id${whereClause}
       ORDER BY p.createdAt DESC LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );

    res.json({
      list: rows.map(mapPost),
      total,
      page,
      pageSize,
      hasMore: offset + rows.length < total
    });
  } catch (error) {
    next(error);
  }
});
```

替换为：

```js
app.get('/api/posts', async (req, res, next) => {
  try {
    const { category, startAfter, endBefore, keyword, userId } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize) || 10));

    const conditions = [];
    const params = [];

    if (category) {
      conditions.push('p.category = ?');
      params.push(category);
    }
    if (startAfter) {
      conditions.push('p.startTime >= ?');
      params.push(startAfter);
    }
    if (endBefore) {
      conditions.push('p.endTime <= ?');
      params.push(endBefore + ' 23:59:59');
    }
    if (keyword) {
      conditions.push('(p.title LIKE ? OR p.publisherName LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const whereClause = where ? ` ${where}` : '';

    // 取全量候选帖子（含发布者信息），内存排序后再分页
    const rows = await query(
      `SELECT p.*, u.avatarUrl AS publisherAvatarUrl,
              u.completionRate AS publisherCompletionRate,
              u.points AS publisherPoints
       FROM posts p LEFT JOIN users u ON p.publisherId = u.id${whereClause}
       ORDER BY p.createdAt DESC`,
      params
    );

    // 构建用户偏好向量
    let preferenceMap = null;
    if (userId) {
      const prefRows = await query(
        `SELECT p.category,
           SUM(CASE WHEN p.status = '已完成' THEN 1 ELSE 0 END) AS doneCount,
           SUM(CASE WHEN p.status = '已放弃' THEN 1 ELSE 0 END) AS abandonCount
         FROM post_buddies pb
         JOIN posts p ON p.id = pb.postId
         WHERE pb.userId = ?
         GROUP BY p.category`,
        [userId]
      );
      preferenceMap = new Map(
        prefRows.map(r => [r.category, { doneCount: Number(r.doneCount), abandonCount: Number(r.abandonCount) }])
      );
    }

    // 内存计算推荐分并排序
    const scored = rows.map(row => {
      const publisherUser = row.publisherCompletionRate != null
        ? { completionRate: row.publisherCompletionRate, points: row.publisherPoints }
        : null;
      const score = calcRecommendedScore(row, publisherUser, preferenceMap);
      return { row, score };
    });
    scored.sort((a, b) => b.score - a.score);

    const total = scored.length;
    const offset = (page - 1) * pageSize;
    const pageSlice = scored.slice(offset, offset + pageSize);

    res.json({
      list: pageSlice.map(({ row, score }) => ({ ...mapPost(row), recommendedScore: score })),
      total,
      page,
      pageSize,
      hasMore: offset + pageSlice.length < total
    });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 2：验证语法**

```bash
node --check backend/src/server.js
```

预期：无输出

- [ ] **Step 3：手动验证接口**

启动后端：
```bash
node backend/src/server.js
```

无 userId 请求（退回质量分排序）：
```
GET http://localhost:3000/api/posts?page=1&pageSize=5
```
预期：返回帖子列表，每条帖子有 `recommendedScore` 字段，值为 0–100 的整数。

带 userId 请求（个性化）：
```
GET http://localhost:3000/api/posts?page=1&pageSize=5&userId=<your-userId>
```
预期：`recommendedScore` 因用户历史偏好不同而与无 userId 时有差异（若用户有历史加入记录）。

- [ ] **Step 4：提交**

```bash
git add backend/src/server.js
git commit -m "feat: GET /api/posts 改为个性化推荐分内存排序"
```

---

## Task 3：前端 api.js — `getFeed` 传递 `userId`

**Files:**
- Modify: `miniprogram/services/api.js`（`getFeed` 函数，约第 41–50 行）

- [ ] **Step 1：替换 `getFeed` 函数**

找到：

```js
function getFeed({ category = '', startAfter = '', endBefore = '', keyword = '', page = 1, pageSize = 10 } = {}) {
  const params = [];
  if (category) params.push(`category=${encodeURIComponent(category)}`);
  if (startAfter) params.push(`startAfter=${encodeURIComponent(startAfter)}`);
  if (endBefore) params.push(`endBefore=${encodeURIComponent(endBefore)}`);
  if (keyword) params.push(`keyword=${encodeURIComponent(keyword)}`);
  params.push(`page=${page}`);
  params.push(`pageSize=${pageSize}`);
  return request({ url: `/api/posts?${params.join('&')}` });
}
```

替换为：

```js
function getFeed({ category = '', startAfter = '', endBefore = '', keyword = '', userId = '', page = 1, pageSize = 10 } = {}) {
  const params = [];
  if (category) params.push(`category=${encodeURIComponent(category)}`);
  if (startAfter) params.push(`startAfter=${encodeURIComponent(startAfter)}`);
  if (endBefore) params.push(`endBefore=${encodeURIComponent(endBefore)}`);
  if (keyword) params.push(`keyword=${encodeURIComponent(keyword)}`);
  if (userId) params.push(`userId=${encodeURIComponent(userId)}`);
  params.push(`page=${page}`);
  params.push(`pageSize=${pageSize}`);
  return request({ url: `/api/posts?${params.join('&')}` });
}
```

- [ ] **Step 2：提交**

```bash
git add miniprogram/services/api.js
git commit -m "feat: getFeed 新增 userId 参数"
```

---

## Task 4：前端 home.js — `_loadPage` 附带当前用户 `userId`

**Files:**
- Modify: `miniprogram/pages/home/home.js`（`_loadPage` 方法，约第 72–100 行）

- [ ] **Step 1：修改 `_loadPage` 中的 `getFeed` 调用**

找到 `_loadPage` 方法中的 `getFeed` 调用：

```js
const result = await api.getFeed({
  category: activeCategory,
  startAfter: activeStartAfter,
  endBefore: activeEndBefore,
  keyword,
  page,
  pageSize: PAGE_SIZE
});
```

替换为：

```js
const app = getApp();
const userInfo = app.globalData.userInfo || wx.getStorageSync('userInfo') || {};
const result = await api.getFeed({
  category: activeCategory,
  startAfter: activeStartAfter,
  endBefore: activeEndBefore,
  keyword,
  userId: userInfo.id || '',
  page,
  pageSize: PAGE_SIZE
});
```

- [ ] **Step 2：验证**

在微信开发者工具中打开主页，查看 Network 面板，确认 `GET /api/posts` 请求的 URL 中包含 `userId=<当前用户id>` 参数。

- [ ] **Step 3：提交**

```bash
git add miniprogram/pages/home/home.js
git commit -m "feat: home 页 getFeed 附带 userId 实现个性化推荐"
```

---

## Self-Review

**Spec coverage:**
- ✅ `calcRecommendedScore` 纯函数（发布者质量 × 0.4 + 帖子基础 × 0.3 + 偏好 × 0.3）→ Task 1
- ✅ 发布者质量分公式（completionRate × 0.6 + min(points/10,100) × 0.4）→ Task 1
- ✅ 帖子基础分公式（reward/2 cap 50 + penalty/2 cap 30 + 满员加成 20）→ Task 1
- ✅ 用户偏好分公式（doneCount×2 / (doneCount×2 + abandonCount) × 100，无历史默认 50）→ Task 1
- ✅ `GET /api/posts` 接受 `userId`，查偏好向量，内存计算分、排序、分页 → Task 2
- ✅ 偏好向量 SQL（GROUP BY category，SUM 已完成/已放弃）→ Task 2
- ✅ 无 `userId` 时偏好分默认 50 → Task 1（preferenceMap 为 null 时 prefScore = 50）
- ✅ `getFeed` 传递 `userId` → Task 3
- ✅ `home.js` 读取当前用户 id 附带请求 → Task 4
- ✅ `recommendedScore` 字段在返回列表中实时覆盖 → Task 2（`{ ...mapPost(row), recommendedScore: score }`）

**Placeholder scan:** 无 TBD/TODO

**Type consistency:**
- `calcRecommendedScore(post, publisherUser, preferenceMap)` — Task 1 定义，Task 2 调用时签名一致
- `publisherUser` 在 Task 2 中构造为 `{ completionRate, points }` 或 `null`，与 Task 1 函数体中 `publisherUser.completionRate` / `publisherUser.points` 访问一致
- `preferenceMap` 类型为 `Map<string, {doneCount:number, abandonCount:number}>`，Task 1 定义，Task 2 构造 `new Map(prefRows.map(...))` 一致
- `userId` 参数：Task 3 `getFeed` 新增，Task 4 `home.js` 传入，名称一致
