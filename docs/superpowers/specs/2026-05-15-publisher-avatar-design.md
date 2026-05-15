# 发布者头像展示设计文档

**日期：** 2026-05-15  
**范围：** 广场帖子卡片 + 帖子详情页

---

## 需求

- 广场（home）帖子卡片：显示发布者**头像**，不显示昵称
- 帖子详情页（post-detail）：在右上角同时显示发布者**头像 + 昵称**

---

## 方案：悬浮圆形头像（方案 A）

### 后端改动

#### `GET /api/posts`（列表接口）

- `server.js` 中查询帖子时 JOIN `users` 表，取 `avatarUrl`
- `mapPost` 函数新增字段 `publisherAvatarUrl`
- 前端通过 `item.publisherAvatarUrl` 渲染头像

#### `GET /api/posts/:id`（详情接口）

- 同样在查询 post 时 JOIN `users` 取 `avatarUrl`
- `mapPost` 透传 `publisherAvatarUrl`，详情页可直接读取

---

### 广场卡片（home）

**布局变更：**

- `.post-card` 补充 `position: relative`（app.wxss 中该类目前无显式定位）
- 在 `.post-header` 内插入头像元素，**绝对定位**于卡片右上角

**头像样式：**

```
position: absolute
top: 20rpx
right: 20rpx
width: 80rpx
height: 80rpx
border-radius: 50%
border: 3rpx solid #ffffff
box-shadow: 0 4rpx 12rpx rgba(0, 0, 0, 0.12)
```

**文字变更：**

- 原来的 `{{item.publisher}} · {{item.category}} · {{item.status}}` 改为 `{{item.category}} · {{item.status}}`（去掉昵称）

---

### 帖子详情页（post-detail）

**新增 publisher bar：**

插入位置：`tag（任务详情）` 胶囊下方、`detail-title` 上方

**布局：**

```
display: flex
justify-content: flex-end
align-items: center
gap: 16rpx
margin: 12rpx 0 0
```

**左侧（头像）：**

```
width: 64rpx
height: 64rpx
border-radius: 50%
border: 3rpx solid #ffffff
box-shadow: 0 4rpx 12rpx rgba(0, 0, 0, 0.12)
```

**右侧（文字，竖排两行）：**

```
上行：昵称，font-size 28rpx，font-weight 700，color var(--text)
下行：分类，font-size 22rpx，color var(--muted)
```

**删除：** 原 `<view class="muted">发布者 {{post.publisher}} · {{post.category}}</view>` 整行（分类已移入 publisher bar）

---

## 数据流

```
users 表 (avatarUrl)
  └─ JOIN posts 表
       ├─ mapPost → publisherAvatarUrl
       ├─ GET /api/posts → feed 列表 → home.js → item.publisherAvatarUrl
       └─ GET /api/posts/:id → post 详情 → post-detail.js → post.publisherAvatarUrl
```

---

## 文件变更清单

| 文件 | 变更内容 |
|------|----------|
| `backend/src/db.js` | `mapPost` 新增 `publisherAvatarUrl` 字段 |
| `backend/src/server.js` | 列表和详情接口 JOIN users 表取 avatarUrl |
| `miniprogram/pages/home/home.wxml` | 头像元素 + 去掉昵称文字 |
| `miniprogram/pages/home/home.wxss` | `.post-card` 加 `position: relative`；新增 `.post-publisher-avatar` 样式 |
| `miniprogram/pages/post-detail/post-detail.wxml` | 新增 publisher bar，删除旧发布者文字行 |
| `miniprogram/pages/post-detail/post-detail.wxss` | 新增 `.publisher-bar`、`.publisher-avatar`、`.publisher-info` 样式 |
