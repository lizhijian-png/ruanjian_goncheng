# 发布者头像展示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在广场帖子卡片右上角显示发布者头像（不显示昵称），在帖子详情页右上角同时显示发布者头像和昵称。

**Architecture:** 后端列表和详情接口通过 JOIN users 表补充 `publisherAvatarUrl` 字段；前端广场卡片用绝对定位圆形头像替换昵称文字；详情页在标题上方插入 publisher bar（头像 + 昵称 + 分类）。

**Tech Stack:** Node.js / Express / mysql2（后端），微信小程序 WXML/WXSS（前端）

---

### Task 1: 后端 mapPost 补充 publisherAvatarUrl 字段

**Files:**
- Modify: `backend/src/db.js`

- [ ] **Step 1: 在 `mapPost` 函数中新增字段**

打开 [backend/src/db.js](backend/src/db.js)，找到 `mapPost` 函数（第 27 行），在 `return` 对象末尾加入新字段：

```js
function mapPost(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    publisherId: row.publisherId,
    publisher: row.publisherName,
    publisherAvatarUrl: row.publisherAvatarUrl || '',
    title: row.title,
    content: row.content,
    reward: row.reward,
    penalty: row.penalty,
    category: row.category,
    partnerChat: Boolean(row.partnerChat),
    evaluationOpen: Boolean(row.evaluationOpen),
    evidenceText: row.evidenceText,
    status: row.status,
    buddy: row.buddyName,
    progress: row.progress,
    recommendedScore: row.recommendedScore,
    maxBuddies: row.maxBuddies != null ? row.maxBuddies : 1,
    currentBuddies: row.currentBuddies != null ? row.currentBuddies : 0,
    startTime: row.startTime || null,
    endTime: row.endTime || null,
    createdAt: row.createdAt
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/db.js
git commit -m "feat: mapPost 新增 publisherAvatarUrl 字段"
```

---

### Task 2: 后端列表接口 JOIN users 取头像

**Files:**
- Modify: `backend/src/server.js`

- [ ] **Step 1: 修改列表接口的 SELECT 查询**

打开 [backend/src/server.js](backend/src/server.js)，找到 `GET /api/posts` 路由（第 129 行）。

将计数查询和数据查询都改为 JOIN users 表：

```js
const countRows = await query(
  `SELECT COUNT(*) AS total FROM posts p ${where.replace(/FROM posts/g, 'FROM posts p')}`,
  params
);
```

注意：此处 where 子句中已有 `posts` 表字段名，JOIN 后需要加表别名。将整个路由的查询逻辑替换为：

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

    const countRows = await query(
      `SELECT COUNT(*) AS total FROM posts p LEFT JOIN users u ON p.publisherId = u.id ${where}`,
      params
    );
    const total = countRows[0].total;

    const rows = await query(
      `SELECT p.*, u.avatarUrl AS publisherAvatarUrl
       FROM posts p LEFT JOIN users u ON p.publisherId = u.id
       ${where} ORDER BY p.createdAt DESC LIMIT ${pageSize} OFFSET ${offset}`,
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

- [ ] **Step 2: 启动后端验证接口返回字段**

```bash
cd backend && node src/server.js &
curl "http://localhost:3000/api/posts?pageSize=1" | grep publisherAvatarUrl
```

期望输出：包含 `"publisherAvatarUrl":` 字段（值可能为空字符串或 URL）

- [ ] **Step 3: Commit**

```bash
git add backend/src/server.js
git commit -m "feat: 列表接口 JOIN users 返回 publisherAvatarUrl"
```

---

### Task 3: 后端详情接口 JOIN users 取头像

**Files:**
- Modify: `backend/src/server.js`

- [ ] **Step 1: 修改详情接口的 SELECT 查询**

找到 `GET /api/posts/:id` 路由（第 178 行），将查询帖子的语句改为 JOIN users：

```js
app.get('/api/posts/:id', async (req, res, next) => {
  try {
    const postRows = await query(
      `SELECT p.*, u.avatarUrl AS publisherAvatarUrl
       FROM posts p LEFT JOIN users u ON p.publisherId = u.id
       WHERE p.id = ?`,
      [req.params.id]
    );
    const postRow = postRows[0];

    if (!postRow) {
      return res.status(404).json({ message: '帖子不存在' });
    }

    // 以下代码保持不变（evidenceList, evaluations, buddies 查询等）
```

其余代码（evidenceList、evaluations、buddies 查询、return res.json）保持原样不动。

- [ ] **Step 2: 验证详情接口**

```bash
# 先用列表接口拿一个帖子 id，替换下面的 <POST_ID>
curl "http://localhost:3000/api/posts/<POST_ID>" | grep publisherAvatarUrl
```

期望输出：`post` 对象中包含 `"publisherAvatarUrl":` 字段

- [ ] **Step 3: Commit**

```bash
git add backend/src/server.js
git commit -m "feat: 详情接口 JOIN users 返回 publisherAvatarUrl"
```

---

### Task 4: 广场卡片 WXML — 头像替换昵称

**Files:**
- Modify: `miniprogram/pages/home/home.wxml`

- [ ] **Step 1: 修改 post-card 内容**

找到帖子列表渲染块（第 52-72 行），做两处改动：

1. 将 `post-header` 内的 muted 文字行去掉昵称，只保留分类和状态
2. 在 `post-header` 内添加头像元素

将以下原始代码：

```xml
<view class="post-header">
  <view>
    <view class="post-title">{{item.title}}</view>
    <view class="muted">{{item.publisher}} · {{item.category}} · {{item.status}}</view>
  </view>
  <view class="score-chip">推荐 {{item.recommendedScore}}</view>
</view>
```

替换为：

```xml
<view class="post-header">
  <view>
    <view class="post-title">{{item.title}}</view>
    <view class="muted">{{item.category}} · {{item.status}}</view>
  </view>
  <view class="score-chip">推荐 {{item.recommendedScore}}</view>
  <image
    class="post-publisher-avatar"
    src="{{item.publisherAvatarUrl}}"
    mode="aspectFill"
  />
</view>
```

- [ ] **Step 2: Commit**

```bash
git add miniprogram/pages/home/home.wxml
git commit -m "feat: 广场卡片用头像替换昵称文字"
```

---

### Task 5: 广场卡片 WXSS — 头像样式

**Files:**
- Modify: `miniprogram/pages/home/home.wxss`
- Modify: `miniprogram/app.wxss`

- [ ] **Step 1: 给 post-card 加 position: relative**

打开 [miniprogram/app.wxss](miniprogram/app.wxss)，找到 `.post-card` 的选择器（第 30 行的联合选择器），在其下方追加：

```css
.post-card {
  position: relative;
}
```

- [ ] **Step 2: 在 home.wxss 末尾添加头像样式**

打开 [miniprogram/pages/home/home.wxss](miniprogram/pages/home/home.wxss)，在文件末尾追加：

```css
/* ===== 发布者头像（卡片右上角悬浮） ===== */
.post-publisher-avatar {
  position: absolute;
  top: 20rpx;
  right: 20rpx;
  width: 80rpx;
  height: 80rpx;
  border-radius: 50%;
  border: 3rpx solid #ffffff;
  box-shadow: 0 4rpx 12rpx rgba(0, 0, 0, 0.12);
  flex-shrink: 0;
}
```

- [ ] **Step 3: Commit**

```bash
git add miniprogram/app.wxss miniprogram/pages/home/home.wxss
git commit -m "feat: 广场卡片头像悬浮样式"
```

---

### Task 6: 详情页 WXML — publisher bar

**Files:**
- Modify: `miniprogram/pages/post-detail/post-detail.wxml`

- [ ] **Step 1: 插入 publisher bar，删除旧发布者文字行**

找到 `detail-card` 内部（第 3-6 行），将以下原始代码：

```xml
<view class="tag">任务详情</view>
<view class="detail-title">{{post.title}}</view>
<view class="muted">发布者 {{post.publisher}} · {{post.category}}</view>
```

替换为：

```xml
<view class="tag">任务详情</view>
<view class="publisher-bar">
  <image
    class="publisher-avatar"
    src="{{post.publisherAvatarUrl}}"
    mode="aspectFill"
  />
  <view class="publisher-info">
    <view class="publisher-name">{{post.publisher}}</view>
    <view class="publisher-category">{{post.category}}</view>
  </view>
</view>
<view class="detail-title">{{post.title}}</view>
```

- [ ] **Step 2: Commit**

```bash
git add miniprogram/pages/post-detail/post-detail.wxml
git commit -m "feat: 详情页插入 publisher bar"
```

---

### Task 7: 详情页 WXSS — publisher bar 样式

**Files:**
- Modify: `miniprogram/pages/post-detail/post-detail.wxss`

- [ ] **Step 1: 在文件末尾追加样式**

打开 [miniprogram/pages/post-detail/post-detail.wxss](miniprogram/pages/post-detail/post-detail.wxss)，在末尾追加：

```css
/* ===== Publisher bar ===== */
.publisher-bar {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 16rpx;
  margin: 12rpx 0 18rpx;
}

.publisher-avatar {
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  border: 3rpx solid #ffffff;
  box-shadow: 0 4rpx 12rpx rgba(0, 0, 0, 0.12);
  flex-shrink: 0;
}

.publisher-info {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4rpx;
}

.publisher-name {
  font-size: 28rpx;
  font-weight: 700;
  color: var(--text);
}

.publisher-category {
  font-size: 22rpx;
  color: var(--muted);
}
```

- [ ] **Step 2: Commit**

```bash
git add miniprogram/pages/post-detail/post-detail.wxss
git commit -m "feat: 详情页 publisher bar 样式"
```

---

### Task 8: 收尾验证

- [ ] **Step 1: 确认后端正常运行**

```bash
curl "http://localhost:3000/api/health"
```

期望输出：`{"success":true,"message":"backend is running"}`

- [ ] **Step 2: 确认列表接口有头像字段**

```bash
curl "http://localhost:3000/api/posts?pageSize=2" | python3 -m json.tool | grep publisherAvatarUrl
```

期望输出：每条帖子都有 `"publisherAvatarUrl":` 字段

- [ ] **Step 3: 在微信开发者工具中打开小程序预览**

- 打开广场页，确认帖子卡片右上角出现圆形头像，昵称文字不再显示
- 点进任意帖子，确认标题上方右侧出现头像 + 昵称 + 分类的 publisher bar
- 检查头像加载失败时（avatarUrl 为空）的显示是否异常（小程序 image 组件空 src 不报错，显示为空白，可接受）

- [ ] **Step 4: 最终 commit**

```bash
git add .
git commit -m "feat: 发布者头像展示功能完成"
```
