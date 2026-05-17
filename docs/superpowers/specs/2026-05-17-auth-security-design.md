# 鉴权与安全设计文档

**日期**: 2026-05-17  
**范围**: 后端身份鉴权、越权校验、JWT 登录流程  
**目标**: 消除身份伪造与越权操作两类安全漏洞

---

## 背景与问题

当前后端存在两类安全漏洞：

1. **身份伪造**：所有写操作的 userId 由客户端 `req.body.userId` 传入，后端完全信任，任何人可以冒充任何用户。
2. **越权操作**：删帖、改帖等接口没有校验"操作者必须是发布者本人"，任何人可以操作别人的帖子。

---

## 设计目标

- 生产级架构，当前用简化登录占位，后续接微信官方登录只需改一个函数
- 读操作（列表、详情、排行榜）保持公开，无需登录
- 写操作和敏感操作全部要求有效 JWT，userId 从 token 中解析，不再信任请求体

---

## 技术选型

- **Token 方案**: JWT（JSON Web Token），无状态，不需要服务端存储 session
- **签名算法**: HS256
- **有效期**: 7 天
- **传输方式**: HTTP Header `Authorization: Bearer <token>`

---

## 数据库变更

在 `users` 表新增字段：

```sql
ALTER TABLE users ADD COLUMN openid TEXT UNIQUE;
```

- 现阶段模拟登录时 openid 为空，兼容现有用户
- 接入微信登录后，将真实 openid 写入此字段用于身份绑定

---

## 新增文件

### `backend/src/middleware/auth.js`

鉴权中间件，逻辑如下：

```
读取 req.headers.authorization
  → 解析 "Bearer <token>"
  → jwt.verify() 解析 payload，取出 { id }
  → 查询数据库确认用户存在
  → 将用户对象挂载到 req.user
  → next()

任何步骤失败 → 返回 401 { error: "未登录或 token 已失效" }
```

---

## 新增接口

### 模拟登录（当前使用）

```
POST /api/auth/login
Content-Type: application/json

Body: { "userId": "u_xxx" }

Response 200:
{
  "token": "<JWT>",
  "user": { "id": "u_xxx", "nickname": "...", "avatarUrl": "...", "points": 0 }
}

Response 400: { "error": "用户不存在" }
```

后端验证 userId 在数据库中存在，签发 JWT，payload 为 `{ id: userId }`。

### 微信登录（预留）

```
POST /api/auth/wx-login
Content-Type: application/json

Body: { "code": "<wx.login 返回的 code>" }

Response 200: 与 /api/auth/login 返回格式完全一致
```

内部调用微信 `code2session` 接口换取 openid，查找或新建用户，签发 JWT。前端代码无需修改。

---

## 接口鉴权规则

### 公开接口（无需 token）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/posts` | 帖子列表 |
| GET | `/api/posts/:id` | 帖子详情 |
| GET | `/api/ranking` | 排行榜 |
| POST | `/api/auth/login` | 模拟登录 |
| POST | `/api/auth/wx-login` | 微信登录（预留） |

### 需要鉴权的接口（挂载 `authenticate` 中间件）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/posts` | 发帖 |
| PUT | `/api/posts/:id` | 编辑帖子 |
| DELETE | `/api/posts/:id` | 删帖 |
| POST | `/api/posts/:id/join` | 加入任务 |
| POST | `/api/posts/:id/quit` | 退出任务 |
| POST | `/api/posts/:id/complete` | 标记完成 |
| POST | `/api/posts/:id/abandon` | 放弃任务 |
| POST | `/api/posts/:id/evidence` | 提交证据 |
| POST | `/api/posts/:id/evaluate` | 互评 |
| GET | `/api/users/:id/profile` | 查看用户资料 |
| PUT | `/api/users/:id/profile` | 更新用户资料 |

---

## 越权校验规则

中间件解决"你是谁"，越权校验解决"你能做什么"，在各处理函数内部实现。

### 帖子所有权校验

| 接口 | 校验规则 | 失败返回 |
|------|---------|---------|
| `PUT /api/posts/:id` | `req.user.id === post.publisherId` | 403 |
| `DELETE /api/posts/:id` | `req.user.id === post.publisherId` | 403 |
| `POST /api/posts/:id/complete` | `req.user.id === post.publisherId` | 403 |
| `POST /api/posts/:id/abandon` | `req.user.id === post.publisherId` | 403 |

### 参与者身份校验

| 接口 | 校验规则 | 失败返回 |
|------|---------|---------|
| `POST /api/posts/:id/join` | `req.user.id !== post.publisherId`（不能加入自己的帖子） | 403 |
| `POST /api/posts/:id/quit` | 用户在 `post_buddies` 表中存在 | 403 |
| `POST /api/posts/:id/evidence` | 用户是 publisherId 或在 `post_buddies` 中 | 403 |
| `POST /api/posts/:id/evaluate` | 用户是 publisherId 或在 `post_buddies` 中 | 403 |

### 用户资料校验

| 接口 | 校验规则 | 失败返回 |
|------|---------|---------|
| `PUT /api/users/:id/profile` | `req.user.id === req.params.id` | 403 |

---

## userId 来源变更

所有接口中原来从 `req.body.userId` 读取 userId 的代码，**全部改为从 `req.user.id` 读取**。`req.body.userId` 字段不再被信任或使用。

涉及的接口：`/api/posts`（POST）、`/api/posts/:id/join`、`/api/posts/:id/quit`、`/api/posts/:id/complete`、`/api/posts/:id/abandon`、`/api/posts/:id/evidence`、`/api/posts/:id/evaluate`

---

## 前端适配

1. 登录时调用 `POST /api/auth/login`，将返回的 token 存入 `wx.setStorageSync('token', token)`
2. 在 `miniprogram/services/api.js` 的请求封装中，统一在 header 添加 `Authorization: Bearer <token>`
3. 接口请求体中不再需要传 `userId` 字段

---

## 依赖

后端新增依赖：
- `jsonwebtoken` — JWT 签发与验证

```bash
cd backend && npm install jsonwebtoken
```

---

## 不在本次范围内

- 微信 code2session 的真实对接（预留接口，逻辑留空）
- Token 刷新机制
- 登出/Token 吊销
- 读接口的登录墙
