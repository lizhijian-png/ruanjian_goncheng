# 任务搭子 — 积分互助平台

一个基于**微信原生小程序 + 通用前后端分离架构**的"任务搭子 / 积分互助平台"。用户可以发布任务、寻找搭子互相监督，通过积分奖惩机制驱动任务完成。

## 技术选型

| 层级 | 技术栈 |
|---|---|
| 前端 | 微信原生小程序（WXML + WXSS + JavaScript） |
| 后端 | Node.js + Express REST API |
| 数据库 | MySQL 5.7+ |

架构优点：
- 不依赖微信云开发，采用通用前后端分离架构
- 小程序端仅通过 HTTP 请求访问后端，结构清晰
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
│   │   └── profile/             # 个人主页
│   ├── services/api.js          # 后端接口封装
│   ├── data/mock.js             # 模拟数据（备用）
│   ├── app.js                   # 小程序入口
│   ├── app.json                 # 页面与 tabBar 配置
│   ├── app.wxss                 # 全局样式
│   └── env.js                   # 后端地址配置
├── backend/                     # Node.js 后端
│   ├── src/
│   │   ├── server.js            # Express 接口入口
│   │   └── db.js                # MySQL 连接、建表、种子数据
│   ├── .env                     # 数据库连接配置
│   └── package.json             # 后端依赖
├── cloudfunctions/              # 云函数（已废弃，仅保留历史文件）
└── project.config.json          # 微信开发者工具配置
```

## 当前已实现功能

### 前端页面（6 个页面）

| 页面 | 路径 | 功能说明 |
|---|---|---|
| 登录页 | `pages/login` | 昵称登录，自动创建新用户 |
| 任务广场 | `pages/home` | 展示帖子列表、积分摘要、快速发布入口 |
| 发布任务 | `pages/publish` | 表单发布任务帖（标题、内容、奖惩、分类、开关等） |
| 帖子详情 | `pages/post-detail` | 查看帖子信息、证据列表、互评列表、标记完成 |
| 排行榜 | `pages/ranking` | 按积分降序展示用户排名 |
| 个人主页 | `pages/profile` | 用户信息、AI 评价、我的帖子管理、删除帖子 |

底部 tabBar 包含三个入口：广场、排行、我的。

### 后端接口（10 个）

| 接口 | 方法 | 功能 |
|---|---|---|
| `/api/health` | GET | 健康检查 |
| `/api/auth/login` | POST | 昵称登录 / 自动注册 |
| `/api/posts` | GET | 获取全部帖子列表 |
| `/api/posts/:id` | GET | 获取帖子详情（含证据 + 互评） |
| `/api/posts` | POST | 创建新帖子 |
| `/api/posts/:id` | PUT | 更新帖子信息 |
| `/api/posts/:id` | DELETE | 删除帖子（事务级联删除证据和评价） |
| `/api/posts/:id/complete` | POST | 标记任务完成，奖励积分 |
| `/api/ranking` | GET | 获取积分排行榜 |
| `/api/users/:id/profile` | GET | 获取用户资料及其帖子 |

### 数据库（4 张表）

| 表名 | 说明 |
|---|---|
| `users` | 用户表（昵称、头像、积分、完成率、AI 评价） |
| `posts` | 帖子表（标题、内容、奖惩、分类、状态、进度、推荐分） |
| `evidences` | 证据表（图片/文字类型的完成证据） |
| `evaluations` | 评价表（用户互评，含评分和评语） |

启动时自动建库建表，首次运行插入种子数据（4 用户 + 2 帖子 + 2 证据 + 2 评价）。

### 已知限制

- token 为 demo 字符串，后端不校验身份
- 登录为昵称登录，未接入微信真实授权
- 证据仅为文字描述，无真实图片上传
- 互评数据仅来自种子数据，前端无提交入口
- 帖子编辑接口存在但前端无编辑页面
- 推荐分为静态值 80，无真实推荐算法
- completionRate 不会自动更新
- 无搭子加入/配对机制

## 如何运行

### 1. 安装后端依赖

```bash
cd backend
npm install
```

### 2. 配置 MySQL 连接

编辑 `backend/.env` 文件，填入你本地的 MySQL 连接信息：

```dotenv
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=你的MySQL密码
MYSQL_DATABASE=task_buddy
```

### 3. 启动 MySQL 服务

确保本地 MySQL 服务已启动。Windows 下可通过以下命令启动：

```bash
net start mysql57
```

服务名根据实际安装版本调整（可能是 `mysql`、`mysql80` 等）。

### 4. 启动后端

```bash
cd backend
npm start
```

启动成功后输出：

```
Task Buddy backend listening on http://localhost:3000
```

后端启动时会自动创建数据库、数据表并插入种子数据。

### 5. 配置小程序后端地址

编辑 `miniprogram/env.js`：

```javascript
module.exports = {
  apiBaseUrl: 'http://127.0.0.1:3000'
};
```

部署到服务器后改为对应地址即可。

### 6. 运行小程序

- 用微信开发者工具打开项目根目录
- 确保后端已启动
- 在开发者工具中关闭"不校验合法域名"用于本地调试
- 编译运行

### 常见问题

| 问题 | 原因与解决 |
|---|---|
| `npm` 无法运行，提示禁止执行脚本 | PowerShell 执行策略限制，运行 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `Cannot find module 'dotenv'` | 未安装依赖，先执行 `npm install` |
| `connect ECONNREFUSED 127.0.0.1:3306` | MySQL 服务未启动，执行 `net start mysql57` |
| `Access denied for user 'root'@'localhost'` | `.env` 中的密码与 MySQL 实际密码不一致，修改后重启 |

## 开发计划

### 阶段一：补全核心业务闭环

- [ ] **搭子匹配（加入任务）** — 新增 `POST /api/posts/:id/join` 接口，前端详情页增加"我来当搭子"按钮，将帖子状态从"招募中"改为"进行中"
- [ ] **互评提交** — 新增 `POST /api/posts/:id/evaluate` 接口，前端详情页增加评价表单（评分 1-5 + 评语），仅已完成且开启互评的帖子可评价
- [ ] **帖子编辑页面** — 新增 `pages/edit-post` 页面，复用发布页表单结构，个人主页增加编辑按钮
- [ ] **completionRate 自动计算** — 完成任务时重新计算发布者的完成率（已完成数 / 总数 × 100）

### 阶段二：积分与状态完善

- [ ] **惩罚积分扣除** — 新增"放弃任务"接口 `POST /api/posts/:id/abandon`，放弃时扣除 penalty 积分
- [ ] **帖子分类筛选** — `GET /api/posts` 支持 `category` 和 `status` 查询参数，前端广场增加分类 tab
- [ ] **分页加载** — 后端支持 `page` 和 `pageSize` 参数，前端实现下拉刷新和触底加载

### 阶段三：安全与鉴权

- [ ] **JWT 鉴权** — 登录返回真实 JWT，后端增加 auth 中间件校验身份，关键接口需验证用户
- [ ] **接口参数校验** — 引入 `express-validator` 或 `joi`，对所有写接口做类型与范围校验

### 阶段四：体验提升

- [ ] **推荐算法** — 根据用户分类偏好、完成率、互评评分计算推荐分，替代静态值
- [ ] **图片上传** — 后端增加 `POST /api/upload` 接口（multer），前端使用 `wx.chooseImage` + `wx.uploadFile`
- [ ] **接入微信登录** — 替代昵称登录，使用 `wx.login` 获取 code 换取 openid

## 说明

当前版本采用前后端分离架构，不再依赖微信云函数、云数据库和云存储，数据库使用 MySQL。`cloudfunctions/` 目录为早期历史文件，当前版本不使用。
