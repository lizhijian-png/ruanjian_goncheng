# 帖子生命流程完善设计文档

**日期**: 2026-05-17  
**范围**: 状态机时间驱动、搭子申请完成、前端详情页按钮矩阵  
**目标**: 完善帖子各阶段的状态流转逻辑，补全用户在各状态下的可执行操作

---

## 背景与问题

当前帖子状态机存在以下缺口：

1. **时间字段未驱动状态**：startTime / endTime 存储于数据库但不影响任何状态转换
2. **缺少手动开始入口**：发布者在人数未满时无法提前推进到"进行中"
3. **搭子无法表达完成意向**：搭子完成任务后只能等待发布者标记，缺少主动表态渠道
4. **前端按钮逻辑不完整**：详情页各角色在不同状态下看到的操作按钮存在缺失或错误

---

## 状态机（完整版）

```
招募中
  ↓ [startTime 到达 且 currentBuddies ≥ 1]（懒更新自动触发）
  ↓ [发布者手动开始，且 currentBuddies ≥ 1]
进行中
  ↓ [endTime 到达]（懒更新自动触发）
  ↓ [发布者手动标记完成]
待评价
  ↓ [双方互评完成]
已完成

招募中 / 进行中
  ↓ [发布者手动放弃]
已放弃
```

**规则说明**：
- 若 startTime 为空，"招募中 → 进行中"只能靠人数满（maxBuddies 全满）或发布者手动开始
- 若 endTime 为空，"进行中 → 待评价"只能靠发布者手动标记完成
- 懒更新：不使用定时任务，每次访问帖子详情或执行写操作前在后端执行状态同步

---

## 方案选择

**懒更新（C 选项）**：每次有人访问帖子时，后端检查时间并在需要时更新 status，再返回数据。无需额外定时服务，对小程序场景足够。

---

## 第一节：懒更新逻辑

### 实现位置

在 `backend/src/server.js` 中新增函数 `syncPostStatus(postId)`，在以下接口的处理函数**最开始**调用：

- `GET /api/posts/:id`
- `POST /api/posts/:id/join`
- `POST /api/posts/:id/quit`
- `POST /api/posts/:id/complete`
- `POST /api/posts/:id/abandon`
- `POST /api/posts/:id/evidence`
- `POST /api/posts/:id/evaluate`
- `POST /api/posts/:id/request-complete`（新接口）

### 函数逻辑

```
async function syncPostStatus(postId):
  读取帖子当前状态
  now = 当前时间

  if 状态 == '招募中':
    if startTime 不为空 AND now >= startTime AND currentBuddies >= 1:
      UPDATE status = '进行中'

  if 状态 == '进行中':
    if endTime 不为空 AND now >= endTime:
      UPDATE status = '待评价'
```

函数只做状态推进，不做积分结算（结算逻辑保持在 evaluate 接口中）。

---

## 第二节：申请完成功能

### 数据库变更

在 `posts` 表新增字段：

```sql
ALTER TABLE posts ADD COLUMN completionRequests TEXT NOT NULL DEFAULT '[]';
```

存储格式为 JSON 数组，记录已申请的搭子用户 ID，例如：`["u_xxx", "u_yyy"]`

### 新增接口

```
POST /api/posts/:id/request-complete
Content-Type: application/json

Body: { "userId": "u_xxx" }
```

**校验规则**：
1. 帖子存在
2. 状态为"进行中"（在 syncPostStatus 之后检查）
3. userId 是搭子（在 post_buddies 表中存在），发布者不能调用此接口
4. userId 尚未在 completionRequests 中，否则返回 400"你已申请过"

**成功逻辑**：
- 将 userId 追加到 completionRequests 数组
- 序列化后写回数据库
- 返回最新帖子完整数据

### mapPost 函数变更

在 `backend/src/db.js` 的 `mapPost` 函数中新增字段映射：

```js
completionRequests: JSON.parse(row.completionRequests || '[]')
```

### GET /api/posts/:id 返回变更

帖子对象中新增 `completionRequests` 字段（由 mapPost 统一处理，无需单独改接口代码）。

---

## 第三节：前端详情页按钮矩阵

### 角色判断逻辑（post-detail.js）

```
isPublisher = currentUserId === post.publisherId
isBuddy     = buddies.some(b => b.userId === currentUserId)
hasRequested = post.completionRequests.includes(currentUserId)
```

### 发布者视角

| 状态 | 显示的操作 |
|------|-----------|
| 招募中 | **放弃任务**；若 currentBuddies ≥ 1 额外显示**手动开始** |
| 进行中 | **标记完成**、**放弃任务** |
| 待评价 | **提交证据**（若本人未提交）、**提交互评**（若已有证据且本人未评价） |
| 已完成 | 无操作，只读展示 |
| 已放弃 | 无操作，只读展示 |

> 注：懒更新保证了"startTime 已到且有搭子"时状态已是"进行中"，发布者在招募中看不到该情况，无需在前端重复判断。

### 搭子视角

| 状态 | 显示的操作 |
|------|-----------|
| 招募中 | **退出任务** |
| 进行中 | 未申请：**申请完成**；已申请：灰色"已申请完成"（不可点击） |
| 待评价 | **提交证据**（若本人未提交）、**提交互评**（若已有证据且本人未评价） |
| 已完成 | 无操作，只读展示 |
| 已放弃 | 无操作，只读展示 |

### 游客视角（未加入、非发布者）

| 状态 | 显示的操作 |
|------|-----------|
| 招募中 | **加入任务**（若 currentBuddies < maxBuddies） |
| 进行中 | 无操作，提示文字"任务进行中" |
| 其余状态 | 无操作，只读展示 |

### 申请完成展示区（进行中状态，所有角色可见）

在"进行中"状态下，详情页显示一个完成申请区域，列出所有搭子及其申请状态：

```
完成申请进度：
  小明 ✓   小红 ✓   小李 —
```

数据来源：`buddies` 数组 + `post.completionRequests` 数组取交集判断每人是否已申请。

---

## 前端需要新增/修改的 API 调用

在 `miniprogram/services/api.js` 中新增：

```js
function requestComplete(postId, userId) {
  return request({
    url: `/api/posts/${postId}/request-complete`,
    method: 'POST',
    data: { userId }
  });
}
```

同时新增手动开始接口（复用 complete 逻辑的独立接口）：

```
POST /api/posts/:id/start
Body: { "userId": "u_xxx" }
```

校验：发布者身份、状态为"招募中"、currentBuddies ≥ 1，成功则将 status 改为"进行中"。

```js
function startPost(postId, userId) {
  return request({
    url: `/api/posts/${postId}/start`,
    method: 'POST',
    data: { userId }
  });
}
```

---

## 不在本次范围内

- 点赞、收藏、通用评论功能
- 推荐分算法
- 图片证据上传
- 安全鉴权（已有独立设计文档）
