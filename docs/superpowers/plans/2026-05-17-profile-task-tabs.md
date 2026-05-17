# Profile 帖子分类 Tab 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在个人主页新增三 Tab（活跃 / 已完成 / 已放弃），展示用户以发布者和搭子两种身份参与的所有帖子，并按状态归类。

**Architecture:** 扩展现有 `GET /api/users/:id/profile` 接口，额外查询 `post_buddies JOIN posts` 拿到搭子身份的帖子，合并后每条帖子附加 `role` 字段（`"publisher"` / `"buddy"`）。前端 profile 页增加 `activeTab` 状态和三 Tab 栏，纯前端过滤 `posts` 数组渲染不同列表。

**Tech Stack:** Node.js/Express + mysql2/promise（后端），WeChat miniprogram WXML/WXSS/JS（前端）

---

## 文件清单

| 文件 | 操作 |
|------|------|
| `backend/src/server.js` | 修改：扩展 profile 接口查询逻辑 |
| `miniprogram/pages/profile/profile.js` | 修改：新增 Tab 状态与切换逻辑 |
| `miniprogram/pages/profile/profile.wxml` | 修改：新增 Tab 栏与角色标签渲染 |
| `miniprogram/pages/profile/profile.wxss` | 修改：新增 Tab、角色标签样式 |

---

## Task 1：后端 — 扩展 profile 接口

**Files:**
- Modify: `backend/src/server.js`（`GET /api/users/:id/profile` 处理函数，约第 861 行）

- [ ] **Step 1：定位并替换 profile 接口的查询逻辑**

找到 `backend/src/server.js` 中以下代码块（约第 861–876 行）：

```js
app.get('/api/users/:id/profile', async (req, res, next) => {
  try {
    const user = await getUserById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }

    const posts = await query('SELECT * FROM posts WHERE publisherId = ? ORDER BY createdAt DESC', [req.params.id]);
    return res.json({
      user: await buildUserResponse(user),
      posts: posts.map(mapPost)
    });
  } catch (error) {
    next(error);
  }
});
```

替换为：

```js
app.get('/api/users/:id/profile', async (req, res, next) => {
  try {
    const user = await getUserById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }

    const publishedRows = await query(
      'SELECT * FROM posts WHERE publisherId = ? ORDER BY createdAt DESC',
      [req.params.id]
    );
    const joinedRows = await query(
      `SELECT posts.* FROM posts
       JOIN post_buddies ON posts.id = post_buddies.postId
       WHERE post_buddies.userId = ?
       ORDER BY posts.createdAt DESC`,
      [req.params.id]
    );

    // 懒更新：同步每条帖子的时间驱动状态
    const allRows = [...publishedRows, ...joinedRows];
    for (const row of allRows) {
      await syncPostStatus(row.id);
    }

    // 重新查询以获取 syncPostStatus 后的最新状态
    const freshPublished = await query(
      'SELECT * FROM posts WHERE publisherId = ? ORDER BY createdAt DESC',
      [req.params.id]
    );
    const freshJoined = await query(
      `SELECT posts.* FROM posts
       JOIN post_buddies ON posts.id = post_buddies.postId
       WHERE post_buddies.userId = ?
       ORDER BY posts.createdAt DESC`,
      [req.params.id]
    );

    const posts = [
      ...freshPublished.map(row => ({ ...mapPost(row), role: 'publisher' })),
      ...freshJoined.map(row => ({ ...mapPost(row), role: 'buddy' }))
    ];

    return res.json({
      user: await buildUserResponse(user),
      posts
    });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 2：手动验证接口**

启动后端：`node backend/src/server.js`

用自己账号的 userId 请求：
```
GET http://localhost:3000/api/users/<your-userId>/profile
```

预期：`posts` 数组中每条帖子都有 `role` 字段，值为 `"publisher"` 或 `"buddy"`。既是发布者又参与过搭子的帖子不会重复（因为发布者不能加入自己的帖子）。

- [ ] **Step 3：提交**

```bash
git add backend/src/server.js
git commit -m "feat: profile 接口新增搭子身份帖子及 role 字段"
```

---

## Task 2：前端 JS — 新增 Tab 状态与过滤逻辑

**Files:**
- Modify: `miniprogram/pages/profile/profile.js`

- [ ] **Step 1：在 `data` 中新增 `activeTab` 和 `filteredPosts`**

找到 `data: {` 块，在 `posts: []` 后新增两行：

```js
data: {
  user: {},
  posts: [],
  activeTab: 'active',   // 'active' | 'done' | 'abandoned'
  filteredPosts: [],
  settingsVisible: false,
  editNickname: '',
  editAvatarUrl: '',
  saving: false
},
```

- [ ] **Step 2：新增 `_filterPosts` 私有方法**

在 `goPublish()` 方法之前插入：

```js
_filterPosts() {
  const { posts, activeTab } = this.data;
  const ACTIVE_STATUSES = ['招募中', '进行中', '待评价'];
  let filtered;
  if (activeTab === 'active') {
    filtered = posts.filter(p => ACTIVE_STATUSES.includes(p.status));
  } else if (activeTab === 'done') {
    filtered = posts.filter(p => p.status === '已完成');
  } else {
    filtered = posts.filter(p => p.status === '已放弃');
  }
  this.setData({ filteredPosts: filtered });
},
```

- [ ] **Step 3：在 `onShow` 的 setData 之后调用 `_filterPosts`**

找到 `onShow` 中的 `this.setData(profile);`，在其后追加一行：

```js
this.setData(profile);
this._filterPosts();
```

- [ ] **Step 4：新增 `switchTab` 方法**

在 `_filterPosts` 方法之后插入：

```js
switchTab(e) {
  const tab = e.currentTarget.dataset.tab;
  this.setData({ activeTab: tab });
  this._filterPosts();
},
```

- [ ] **Step 5：验证逻辑**

在微信开发者工具中打开 profile 页，打开 AppData 面板，确认：
- `activeTab` 初始值为 `'active'`
- `filteredPosts` 只包含状态为招募中/进行中/待评价的帖子

- [ ] **Step 6：提交**

```bash
git add miniprogram/pages/profile/profile.js
git commit -m "feat: profile 页新增 Tab 状态与过滤逻辑"
```

---

## Task 3：前端 WXML — Tab 栏与帖子卡片

**Files:**
- Modify: `miniprogram/pages/profile/profile.wxml`

- [ ] **Step 1：替换「我的帖子操作」区块**

找到以下整个区块：

```xml
<!-- 我的帖子 -->
<view class="section-card operations-card">
  <view class="section-title">我的帖子操作</view>
  <button class="primary-btn manage-btn" bindtap="goPublish">继续创建帖子</button>
  <block wx:for="{{posts}}" wx:key="id">
    <view class="post-card my-post" data-id="{{item.id}}" bindtap="goPostDetail">
      <view>
        <view class="post-title">{{item.title}}</view>
        <view class="muted">{{item.status}} · +{{item.reward}} / -{{item.penalty}}</view>
      </view>
      <button class="ghost-btn delete-btn" size="mini" data-id="{{item.id}}" catchtap="deletePost">删除</button>
    </view>
  </block>
</view>
```

替换为：

```xml
<!-- 我的帖子 -->
<view class="section-card operations-card">
  <view class="section-title">我的帖子</view>
  <button class="primary-btn manage-btn" bindtap="goPublish">继续创建帖子</button>

  <!-- Tab 栏 -->
  <view class="tab-bar">
    <view
      class="tab-item {{activeTab === 'active' ? 'tab-active' : ''}}"
      data-tab="active"
      bindtap="switchTab"
    >活跃</view>
    <view
      class="tab-item {{activeTab === 'done' ? 'tab-active' : ''}}"
      data-tab="done"
      bindtap="switchTab"
    >已完成</view>
    <view
      class="tab-item {{activeTab === 'abandoned' ? 'tab-active' : ''}}"
      data-tab="abandoned"
      bindtap="switchTab"
    >已放弃</view>
  </view>

  <!-- 帖子列表 -->
  <block wx:for="{{filteredPosts}}" wx:key="id">
    <view class="post-card my-post" data-id="{{item.id}}" bindtap="goPostDetail">
      <view class="my-post-main">
        <view class="post-title">{{item.title}}</view>
        <view class="my-post-meta">
          <view class="muted">{{item.status}}</view>
          <view class="role-tag {{item.role === 'buddy' ? 'role-tag-buddy' : 'role-tag-publisher'}}">
            {{item.role === 'buddy' ? '参与' : '发布'}}
          </view>
        </view>
        <view class="muted small-text">+{{item.reward}} / -{{item.penalty}} 积分</view>
      </view>
      <button
        wx:if="{{item.role === 'publisher'}}"
        class="ghost-btn delete-btn"
        size="mini"
        data-id="{{item.id}}"
        catchtap="deletePost"
      >删除</button>
    </view>
  </block>

  <!-- 空状态 -->
  <view class="empty-tip" wx:if="{{filteredPosts.length === 0}}">
    <text>暂无相关帖子</text>
  </view>
</view>
```

- [ ] **Step 2：验证 WXML 结构**

在微信开发者工具中检查 profile 页面：
- 三个 Tab 按钮正常渲染
- 切换 Tab 后列表内容切换
- 「参与」标签帖子不显示删除按钮
- 「发布」标签帖子显示删除按钮
- 空 Tab 显示「暂无相关帖子」

- [ ] **Step 3：提交**

```bash
git add miniprogram/pages/profile/profile.wxml
git commit -m "feat: profile 页 WXML 新增 Tab 栏与角色标签"
```

---

## Task 4：前端 WXSS — Tab 与角色标签样式

**Files:**
- Modify: `miniprogram/pages/profile/profile.wxss`

- [ ] **Step 1：在文件末尾追加样式**

```css
/* Tab 栏 */
.tab-bar {
  display: flex;
  background: rgba(255, 244, 230, 0.6);
  border-radius: 18rpx;
  padding: 6rpx;
  margin-bottom: 24rpx;
  gap: 6rpx;
}

.tab-item {
  flex: 1;
  text-align: center;
  padding: 18rpx 0;
  border-radius: 14rpx;
  font-size: 28rpx;
  color: var(--muted);
  transition: all 0.2s;
}

.tab-active {
  background: #ffffff;
  color: var(--primary);
  font-weight: 700;
  box-shadow: 0 4rpx 12rpx rgba(255, 122, 89, 0.15);
}

/* 帖子卡片内部布局 */
.my-post-main {
  flex: 1;
}

.my-post-meta {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-top: 6rpx;
}

/* 角色标签 */
.role-tag {
  display: inline-flex;
  align-items: center;
  padding: 4rpx 14rpx;
  border-radius: 999rpx;
  font-size: 22rpx;
}

.role-tag-publisher {
  background: rgba(139, 111, 136, 0.12);
  color: var(--muted);
}

.role-tag-buddy {
  background: rgba(56, 189, 248, 0.14);
  color: var(--accent);
}

/* 空状态 */
.empty-tip {
  text-align: center;
  padding: 48rpx 0;
  color: var(--muted);
  font-size: 28rpx;
}
```

- [ ] **Step 2：视觉验收**

在微信开发者工具中检查：
- Tab 栏圆角背景正常，当前选中 Tab 白色高亮
- 「发布」标签灰色，「参与」标签蓝色
- 空状态居中灰色文字

- [ ] **Step 3：提交**

```bash
git add miniprogram/pages/profile/profile.wxss
git commit -m "feat: profile 页新增 Tab 与角色标签样式"
```

---

## Self-Review

**Spec coverage:**
- ✅ 后端 profile 接口新增搭子帖子查询 + `role` 字段 → Task 1
- ✅ 三 Tab（活跃/已完成/已放弃）状态映射 → Task 2
- ✅ Tab 栏 + 角色标签 WXML → Task 3
- ✅ Tab + 角色标签样式 → Task 4
- ✅ 删除按钮仅 publisher 显示 → Task 3 Step 1
- ✅ 空状态提示 → Task 3 Step 1
- ✅ syncPostStatus 懒更新 → Task 1 Step 1

**Placeholder scan:** 无 TBD/TODO

**Type consistency:**
- `role` 字段：Task 1 定义为 `'publisher'`/`'buddy'`，Task 3 WXML 中 `item.role === 'buddy'` 一致
- `activeTab`：Task 2 定义为 `'active'`/`'done'`/`'abandoned'`，Task 3 WXML 中 `data-tab` 值一致
- `filteredPosts`：Task 2 定义，Task 3 WXML 中使用，一致
- `switchTab`：Task 2 定义，Task 3 WXML 中 `bindtap="switchTab"` 一致
