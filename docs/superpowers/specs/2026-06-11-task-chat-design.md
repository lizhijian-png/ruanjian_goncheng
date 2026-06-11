# 任务聊天室功能设计文档

**日期：** 2026-06-11  
**功能：** 任务内聊天室（Task-Scoped Chat Room）

---

## 1. 背景与目标

在任务协作平台中，发布者与参与者（buddy）目前只能通过帖子内容和证据提交间接沟通。本功能为每个任务提供一个独立的实时文字聊天室，仅对该任务的参与者开放，帮助双方更直接地协调任务进度。

**核心约束：**
- 聊天室由发布者在创建任务时选择开启（`partnerChat: true`）
- 仅支持纯文字消息
- 任务完成（`已完成`）或放弃（`已放弃`）后，聊天室关闭，历史消息删除
- 只有任务参与者（发布者 + 已加入的 buddy）可进入聊天室

---

## 2. 架构总览

在现有 Express HTTP Server 上附加一个 `ws` WebSocket 服务器，二者共享同一个 `http.Server` 实例。

```
┌─────────────────────────────────────┐
│           Express HTTP Server       │
│  /api/...  REST routes (不变)        │
│  GET /api/chat/:postId/history      │  历史消息（REST）
└──────────────┬──────────────────────┘
               │ 共享同一 http.Server
┌──────────────▼──────────────────────┐
│         WebSocket Server (ws 包)    │
│  ws://host/chat?postId=x&userId=x   │
│  房间表: Map<postId, Set<ws>>        │
└──────────────┬──────────────────────┘
               │ 实时广播
┌──────────────▼──────────────────────┐
│     微信小程序 wx.connectSocket()    │
│     miniprogram/pages/chat/         │
└─────────────────────────────────────┘
```

### 新增文件

| 文件 | 说明 |
|------|------|
| `backend/src/chat.js` | WebSocket 服务器：房间管理、鉴权、消息广播 |
| `miniprogram/pages/chat/chat.js` | 聊天室页面逻辑 |
| `miniprogram/pages/chat/chat.wxml` | 聊天室页面结构 |
| `miniprogram/pages/chat/chat.wxss` | 聊天室页面样式 |
| `miniprogram/pages/chat/chat.json` | 聊天室页面配置 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `backend/src/server.js` | 升级为 `http.createServer`，引入并挂载 `chat.js` |
| `backend/src/db.js` | 新增 `messages` 表及相关查询函数 |
| `miniprogram/pages/post-detail/` | 增加"进入聊天室"按钮 |
| `miniprogram/pages/publish/` | 增加"开启任务聊天室"开关 |
| `miniprogram/services/api.js` | 增加 `getChatHistory(postId)` 函数 |
| `miniprogram/app.json` | 注册 chat 页面路由 |

---

## 3. 数据模型

### 新增 `messages` 表

```sql
CREATE TABLE IF NOT EXISTS messages (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  postId      VARCHAR(64) NOT NULL,
  senderId    VARCHAR(64) NOT NULL,
  senderName  VARCHAR(100) NOT NULL,
  content     TEXT NOT NULL,
  createdAt   DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_postId_createdAt (postId, createdAt)
);
```

### 生命周期规则

- 帖子 `status` 变为 `已完成` 或 `已放弃` 时（在现有的 `/complete`、`/abandon` 路由中），执行：
  1. `DELETE FROM messages WHERE postId = ?`
  2. 广播 `room_closed` 给房间内所有在线连接
  3. 关闭并清除该房间所有 ws 连接

### 历史消息加载

进入聊天页时，先通过 REST 拉取最近 50 条历史消息，之后通过 WebSocket 接收实时新消息。

```
GET /api/chat/:postId/history
Response: { messages: [{ id, senderId, senderName, content, createdAt }] }
```

权限：调用方必须是该帖子的发布者或已加入的 buddy，否则返回 403。

---

## 4. WebSocket 协议

### 连接 URL

```
ws://host/chat?postId=xxx&userId=xxx
```

微信小程序无法自定义 WebSocket 握手 Header，因此鉴权参数通过 query string 传递。服务端在握手时查询 `post_buddies` 表（发布者也视为参与者），验证失败则立即关闭连接（code 4001）。

### 消息格式（均为 JSON 字符串）

**客户端 → 服务端：**
```json
{ "type": "message", "content": "你好，我们今天开始吗？" }
```

**服务端 → 客户端（普通消息广播）：**
```json
{
  "type": "message",
  "id": 123,
  "senderId": "u_abc",
  "senderName": "Alice",
  "content": "你好，我们今天开始吗？",
  "createdAt": "2026-06-11T10:00:00.000Z"
}
```

**服务端 → 客户端（任务结束通知）：**
```json
{ "type": "room_closed", "reason": "task_completed" }
// 或
{ "type": "room_closed", "reason": "task_abandoned" }
```
`reason` 取值：任务状态变为 `已完成` 时为 `task_completed`，变为 `已放弃` 时为 `task_abandoned`。

### 服务端消息处理流程

```
收到 ws message
  → 解析 JSON，验证 type === "message"
  → content 非空且长度 ≤ 500 字符
  → INSERT INTO messages
  → 广播给房间内所有在线连接（包括发送者自己）
```

### 连接管理

- 服务端维护内存房间表：`Map<postId, Set<WebSocket>>`
- 连接断开时从房间表中移除
- 房间内无连接时，从 Map 中删除该条目（防止内存泄漏）
- 心跳：`ws` 包自带 ping/pong，无需手动处理

---

## 5. 前端页面设计

### 发布页 `publish`

在表单中增加一个 Switch 开关，标签为"开启任务聊天室"，绑定 `partnerChat` 字段，默认关闭。

### 帖子详情页 `post-detail`

显示条件（同时满足）：
1. `post.partnerChat === true`
2. 当前用户是发布者，或在 `post_buddies` 中有记录
3. 任务状态不是 `已完成` 或 `已放弃`

显示一个"进入聊天室"按钮，点击跳转至 `pages/chat/chat?postId=xxx`。

### 聊天室页 `chat`（新增）

```
┌─────────────────────────────┐
│  ← 返回    任务聊天室        │  导航栏（显示任务标题）
├─────────────────────────────┤
│  Alice  10:01               │
│  你好，我们今天开始吗？      │  消息列表（scroll-view，自动滚底）
│                             │
│             10:02  Bob      │
│  好的，我这边准备好了  ›     │  自己的消息靠右
│                             │
│  [系统] 聊天室已关闭         │  任务结束时显示系统提示
├─────────────────────────────┤
│  [输入文字...（最多500字）]  [发送] │  输入区
└─────────────────────────────┘
```

**页面生命周期：**

| 生命周期 | 行为 |
|----------|------|
| `onLoad` | 调 `getChatHistory` 拉取历史消息并渲染；调 `wx.connectSocket` 建立 WebSocket 连接 |
| WebSocket `onMessage` | 解析消息，追加到列表末尾，滚动到底部 |
| 收到 `room_closed` | 断开连接，输入框禁用，显示"聊天室已关闭"系统提示 |
| `onUnload` | 主动关闭 WebSocket 连接（`wx.closeSocket`） |

**断线重连：** 捕获 `wx.onSocketClose` 后，若任务未结束则自动重连，最多 3 次，间隔 2 秒。

**输入限制：** 发送前校验内容非空且长度 ≤ 500 字符，否则提示用户。

---

## 6. 权限与安全

| 操作 | 权限要求 |
|------|----------|
| 查看聊天入口 | 任务参与者 + `partnerChat === true` + 任务未结束 |
| 拉取历史消息（REST） | 任务参与者，后端校验 |
| 建立 WebSocket 连接 | 任务参与者，握手时后端校验，失败 close(4001) |
| 发送消息 | 已通过握手鉴权的连接 |
| 消息内容过滤 | 服务端校验：非空、≤ 500 字符；超出截断或拒绝 |

---

## 7. 任务结束时的清理时序

```
POST /api/posts/:id/complete（或 /abandon）
  → 原有业务逻辑（更新 status、积分结算等）
  → DELETE FROM messages WHERE postId = id
  → chatServer.closeRoom(id)
      → 向房间内所有 ws 广播 { type: "room_closed", reason: "..." }
      → 逐个关闭连接
      → 从 rooms Map 中删除该条目
  → 返回 HTTP 响应
```

---

## 8. 依赖变更

后端新增一个 npm 依赖：

```bash
npm install ws@^8.18.0
```

前端无新增依赖（使用微信原生 `wx.connectSocket` API）。
