# "行途有伴" 任务搭子 — 积分互助平台

一个基于**微信原生小程序 + 通用前后端分离架构**的"任务搭子 / 积分互助平台"。用户可以发布任务、寻找搭子互相监督，通过积分奖惩机制驱动任务完成。


ai修改要求：不要直接将ai修改的内容上传到GitHub仓库，只要修改我本地的文件。

## 技术选型

| 层级 | 技术栈 |
|---|---|
| 前端 | 微信原生小程序（WXML + WXSS + JavaScript） |
| 后端 | Node.js + Express REST API + ws WebSocket |
| 数据库 | MySQL 8.0 |

架构优点：
- 不依赖微信云开发，采用通用前后端分离架构
- 小程序端通过 HTTP 请求访问 REST 接口，通过 `wx.connectSocket` 接入 WebSocket 聊天
- 适合后续扩展、部署和多人协作

## 项目结构

```
├── miniprogram/                 # 微信小程序前端
│   ├── pages/
│   │   ├── login/               # 登录页
│   │   ├── home/                # 任务广场（首页）
│   │   ├── publish/             # 发布任务
│   │   ├── post-detail/         # 帖子详情
│   │   ├── ranking/             # 积分排行榜
│   │   ├── profile/             # 个人主页
│   │   ├── score-history/       # 积分流水记录
│   │   ├── evaluate/            # 互评页
│   │   ├── submit-evidence/     # 提交证据页
│   │   ├── admin/               # 管理员后台
│   │   └── chat/                # 任务聊天室
│   ├── services/api.js          # 后端接口封装
│   ├── app.js                   # 小程序入口
│   ├── app.json                 # 页面与 tabBar 配置
│   ├── app.wxss                 # 全局样式
│   └── env.js                   # 后端地址配置
├── backend/                     # Node.js 后端
│   ├── src/
│   │   ├── server.js            # Express + HTTP 接口入口
│   │   ├── chat.js              # WebSocket 聊天服务器
│   │   └── db.js                # MySQL 连接与建表
│   ├── .env                     # 数据库连接配置
│   └── package.json             # 后端依赖
├── cloudfunctions/              # 云函数（已废弃，仅保留历史文件）
└── project.config.json          # 微信开发者工具配置
```

## 已实现功能

### 前端页面（11 个页面）

| 页面 | 路径 | 功能说明 |
|---|---|---|
| 登录页 | `pages/login` | 微信头像 + 昵称授权登录；`wx.login` 获取 code 换取真实 openid；老用户自动跳首页 |
| 任务广场 | `pages/home` | 帖子列表（含开始/结束时间）、积分摘要、关键词搜索、分类+时间区间筛选、触底分页加载 |
| 发布任务 | `pages/publish` | 表单填写标题、内容、奖惩积分、分类、搭子人数上限、起止时间、聊天开关、互评开关、证据说明 |
| 帖子详情 | `pages/post-detail` | 帖子完整信息（含起止时间）、搭子列表、证据列表、互评列表、注解列表；操作按钮随身份和状态动态显示 |
| 积分排行榜 | `pages/ranking` | 按积分降序排名；前三名以金银铜领奖台样式呈现，第四名起列表展示 |
| 个人主页 | `pages/profile` | 用户信息与 AI 评价；我的帖子列表（含发布/参与分页）；资料编辑弹窗（昵称 + 头像，头像转 Base64 持久化存储） |
| 积分流水 | `pages/score-history` | 查看个人积分变动记录（类型、金额、备注、时间） |
| 互评页 | `pages/evaluate` | 独立互评提交页面，支持评分 1–5 分 + 文字评语 |
| 提交证据页 | `pages/submit-evidence` | 提交文字或图片证据，图片通过 `wx.chooseMedia` + `wx.uploadFile` 上传 |
| 管理员后台 | `pages/admin` | 管理员登录；帖子审核（通过/拒绝）列表 |
| 任务聊天室 | `pages/chat` | 实时 WebSocket 文字聊天；加载历史消息；任务结束后聊天室自动关闭 |

底部 tabBar 包含三个入口：广场、排行、我的。

---

### 任务广场 — 搜索与筛选

**搜索框**（常驻，输入后 500ms 自动触发）
- 同时匹配帖子**标题**和**发布者昵称**
- 输入框右侧有 ✕ 一键清空

**筛选面板**（点击"⚙ 筛选"按钮从底部弹出）
- **任务分类**：全部 / 学习 / 运动 / 考研 / 求职 / 自律，单选
- **开始时间（不早于）**：日期选择器，最早可选今天
- **结束时间（不晚于）**：日期选择器，最早可选所选开始日期
- 重置按钮清空草稿；应用后在列表上方显示橙色标签条，可一键清除
- 搜索与筛选可同时生效（如：搜索"跑步" + 分类"运动"）

**分页**：每页 10 条，滚动到底部自动加载下一页；切换条件时自动重置至第一页。

---

### 帖子完整生命周期

```
发布者创建帖子
  │
  ▼
【招募中】
  │ 其他用户加入 → 搭子数达到上限时自动流转
  ▼
【进行中】
  │ 发布者点击"申请完成" → 搭子投票确认
  ▼
【待评价】
  │ 发布者和搭子双方各自提交互评（1–5 分 + 评语）
  │ 双方均提交后自动流转
  ▼
【已完成】→ 双方各获得 reward 积分，completionRate 重新计算

【招募中】或【进行中】
  │ 发布者点击"放弃任务"
  ▼
【已放弃】→ 发布者扣除 penalty 积分，completionRate 重新计算
```

**各身份可见操作：**

| 操作 | 触发条件 |
|---|---|
| 加入任务 | 非发布者、非已加入搭子、状态为招募中 |
| 退出任务 | 已加入搭子、状态为招募中或进行中 |
| 申请完成 | 发布者本人、状态为进行中 |
| 完成投票 | 已加入搭子、状态为进行中、有完成申请待确认 |
| 提交证据 | 参与者（发布者或搭子）、状态为进行中或已超结束时间 |
| 提交互评 | 参与者、状态为待评价、本人尚未评价 |
| 放弃任务 | 发布者本人、状态为招募中或进行中 |
| 进入聊天室 | 任务参与者、`partnerChat` 为 true、任务未结束 |
| 添加注解 | 任务参与者、状态为进行中 |

---

### 后端接口（30 个）

| 接口 | 方法 | 功能 |
|---|---|---|
| `/api/health` | GET | 健康检查 |
| `/api/auth/login` | POST | 微信 code 登录，老用户返回用户信息，新用户返回 `isNewUser: true` |
| `/api/auth/bind` | POST | 新用户绑定昵称与头像，创建账号 |
| `/api/posts` | GET | 帖子列表，支持 `keyword`、`category`、`startAfter`、`endBefore`、`page`、`pageSize` |
| `/api/posts/:id` | GET | 帖子详情（含证据、互评、搭子列表、注解） |
| `/api/posts` | POST | 创建新帖子 |
| `/api/posts/:id` | PUT | 更新帖子信息 |
| `/api/posts/:id` | DELETE | 删除帖子（级联删除证据和评价） |
| `/api/posts/:id/join` | POST | 加入任务；搭子数满时自动流转为"进行中" |
| `/api/posts/:id/quit` | POST | 退出任务；状态回退为"招募中" |
| `/api/posts/:id/start` | POST | 手动开始任务（状态流转为"进行中"） |
| `/api/posts/:id/request-complete` | POST | 发布者申请完成，触发搭子投票流程 |
| `/api/posts/:id/completion-vote` | POST | 搭子对完成申请投票；全员通过后流转为"待评价" |
| `/api/posts/:id/complete` | POST | 直接标记完成（状态流转为"待评价"） |
| `/api/posts/:id/abandon` | POST | 放弃任务；扣除 penalty 积分并更新完成率 |
| `/api/upload` | POST | 上传图片文件，返回可访问 URL |
| `/api/posts/:id/evidence` | POST | 提交证据（文字或图片） |
| `/api/posts/:id/evaluate` | POST | 提交互评；双方均评价后自动发放积分并更新完成率 |
| `/api/posts/:id/annotations` | GET | 获取帖子注解列表 |
| `/api/posts/:id/annotations` | POST | 添加帖子注解 |
| `/api/posts/:id/annotations/:annId` | DELETE | 删除注解 |
| `/api/ranking` | GET | 积分排行榜（含头像） |
| `/api/users/:id/profile` | GET | 用户资料及其发布的帖子列表 |
| `/api/users/:id/profile` | PUT | 更新用户昵称与头像（头像支持 Base64） |
| `/api/users/:id/point-logs` | GET | 用户积分流水记录 |
| `/api/users/:id/evaluations-received` | GET | 用户收到的互评列表 |
| `/api/chat/:postId/history` | GET | 获取聊天室历史消息（最近 50 条），需为任务参与者 |
| `/api/admin/login` | POST | 管理员登录 |
| `/api/admin/posts` | GET | 管理员获取待审核帖子列表 |
| `/api/admin/posts/:id/audit-status` | PUT | 管理员审核帖子（通过/拒绝） |

另有 WebSocket 接口：`ws://host/chat?postId=xxx&userId=xxx`，用于任务聊天室实时通信。

---

### 数据库（9 张表）

| 表名 | 说明 |
|---|---|
| `users` | 用户（openid、昵称、头像 Base64、积分、完成率、AI 评价） |
| `posts` | 帖子（标题、内容、奖惩、分类、状态、进度、最大/当前搭子数、起止时间、推荐分、互评/聊天/证据标志位） |
| `post_buddies` | 搭子关系（记录每个帖子的所有加入者及加入时间） |
| `evidences` | 证据（文字/图片类型的完成证据） |
| `evaluations` | 互评（评分 1–5 分 + 评语） |
| `point_logs` | 积分流水（每次积分变动的类型、金额、备注） |
| `annotations` | 帖子注解（任务进行中参与者添加的标注内容） |
| `completion_votes` | 完成投票（搭子对发布者完成申请的投票记录） |
| `messages` | 聊天消息（任务聊天室消息，任务结束时自动删除） |

启动时自动建库建表，无初始种子数据。

---

## 已知限制

| 限制 | 说明 |
|---|---|
| 无真实身份鉴权 | token 为 `token-{userId}` 演示字符串，后端不校验签名 |
| 无接口参数校验 | 后端写接口缺少类型与范围校验 |
| 聊天消息无持久化 | 任务完成或放弃后聊天记录立即删除，无归档 |

## 待实现功能

- [ ] **帖子编辑页面** — 新增 `pages/edit-post`，个人主页"我的帖子"增加编辑入口，调用 `PUT /api/posts/:id`
- [ ] **接口参数校验** — 引入 `express-validator` 或 `joi`，对所有写接口做类型与范围校验
- [ ] **JWT 鉴权** — 登录返回真实 JWT，后端增加 auth 中间件

## 如何运行

### 1. 安装后端依赖

```bash
cd backend
npm install
```

### 2. 配置 MySQL 连接

编辑 `backend/.env`，填入本地 MySQL 连接信息：

```dotenv
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=你的MySQL密码
MYSQL_DATABASE=task_buddy
WX_APPID=wxe4c181cd90900168
WX_SECRET=1715eb38954218e68fbd562c2d1552e4
```

### 3. 启动 MySQL 服务

```bash
net start MySQL80
```

服务名根据实际安装版本调整（可能是 `MySQL`、`MySQL80` 等）。

### 4. 启动后端

```bash
cd backend
npm start
```

启动成功后输出：

```
Task Buddy backend listening on http://localhost:3000
```

后端启动时会自动创建数据库和全部数据表。

### 5. 配置小程序后端地址

编辑 `miniprogram/env.js`：

```javascript
module.exports = {
  apiBaseUrl: 'http://127.0.0.1:3000'
};
```

### 6. 运行小程序
- 微信开发者工具使用微信扫码登录
- 导入该项目文件
- 输入App ID ：  wxe4c181cd90900168
- 勾选不使用云服务
- 用微信开发者工具打开项目根目录
- 确保后端已启动
- 在开发者工具中勾选"不校验合法域名"用于本地调试
- 编译运行

### 常见问题

| 问题 | 原因与解决 |
|---|---|
| `npm` 无法运行，提示禁止执行脚本 | PowerShell 执行策略限制，运行 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `Cannot find module 'dotenv'` | 未安装依赖，先执行 `npm install` |
| `connect ECONNREFUSED 127.0.0.1:3306` | MySQL 服务未启动，执行 `net start MySQL80` |
| `Access denied for user 'root'@'localhost'` | `.env` 中的密码与 MySQL 实际密码不一致，修改后重启后端 |
| 小程序请求超时 | 后端未启动或未重启，修改后端代码后必须重启才能生效 |
| WebSocket 连接失败 | 检查 `env.js` 中 `apiBaseUrl` 是否为 `http://`（小程序会自动转为 `ws://`） |

## 说明

当前版本采用前后端分离架构，不依赖微信云函数、云数据库和云存储。`cloudfunctions/` 目录为早期历史文件，当前版本不使用。
