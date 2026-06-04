# 帖子批注协作互动功能 — 设计文档

> 状态:阶段一 MVP 设计已确认
> 日期:2026-06-04
> 适用项目:「行途有伴」任务搭子小程序(微信原生小程序 + Express + MySQL)

## 1. 背景与目标

当前平台的用户互动局限于任务生命周期内的结构化操作:加入/退出搭子、提交证据、双向互评、申请完成。缺少轻量、有趣、即时的搭子间交流方式。`partnerChat` 开关存在于数据库但从未落地为真实功能。

本功能让**任务参与者(发布者 + 已加入搭子)** 能在帖子卡片的任意位置贴「文字批注」和「表情印章」,点击批注可查看作者与时间,作者本人(及楼主)可删除。目标是把帖子从"只读的任务说明"变成"搭子共同涂鸦的协作空间",增强参与感与趣味性。

### 范围(分三阶段,本次只实现阶段一)

| 阶段 | 内容 | 本次是否实现 |
|---|---|---|
| 一 · MVP | 悬浮工具箱组件 + 文字批注(预设样式自选)+ 内置 Unicode 表情印章 + 点击定位放置 + 查看作者/时间 + 删除 | ✅ 是 |
| 二 · 素材库 | 收藏系统,可长按收藏他人的批注样式与表情到「我的工具箱」 | ❌ 后续 |
| 三 · 自定义导入 | `wx.chooseMedia` 导入图片表情,Base64 存库(同现有头像方案) | ❌ 后续 |

阶段一的数据模型为阶段二、三**预留扩展位**(`type` 字段区分 builtin/stamp/custom),后续接入不需改表。

### 成功标准

- 参与者能在帖子任意位置成功放置文字批注和表情印章,刷新后位置保持一致
- 点击任一批注可看到作者昵称与发布时间
- 作者能删除自己的批注,楼主能删除自己帖子上任何人的批注
- 非参与者看不到工具箱、无法创建批注(UI + 后端双重拦截)
- 新增功能不影响任何现有页面与接口

## 2. 整体架构

```
帖子详情页 (post-detail)
  ├── 帖子卡片(定位容器,position: relative)
  │     └── <annotation-layer>  批注渲染层(绝对定位覆盖)
  │            ├─ 文字批注 ×N(读取 style JSON 渲染)
  │            └─ 表情印章 ×N
  ├── <annotation-toolbox>  悬浮工具箱组件(右下角 🧰)
  └── 既有内容(搭子列表、操作按钮、证据、互评)

后端 (Express)
  ├── GET    /api/posts/:id/annotations         查批注
  ├── POST   /api/posts/:id/annotations         建批注
  └── DELETE /api/posts/:id/annotations/:annId  删批注

数据库
  └── annotations 表(独立新表,外键关联 posts,级联删除)
```

**模块边界:**
- `annotation-toolbox` 组件:只负责"用户选了什么工具",通过 `bind:pick` 事件抛出选择,不关心具体帖子。可被其他板块复用。
- `annotation-layer` 组件:接收 annotations 数组,负责绝对定位渲染 + 点击事件,通过事件抛出"点了哪条""要删哪条"。
- 详情页:持有数据,协调两个组件 + 调接口 + 计算点击坐标。

## 3. 数据模型

新增 `annotations` 表,风格对称于现有 `evidences`/`evaluations`:

```sql
CREATE TABLE IF NOT EXISTS annotations (
  id          VARCHAR(64) PRIMARY KEY,
  postId      VARCHAR(64) NOT NULL,
  userId      VARCHAR(64) NOT NULL,
  nickname    VARCHAR(100) NOT NULL,          -- 冗余作者昵称,免连表
  type        VARCHAR(20) NOT NULL,           -- 'text' | 'stamp'(阶段三加 'custom')
  content     TEXT NOT NULL,                  -- 文字内容 或 表情字符(如 🔥)
  style       TEXT NOT NULL,                  -- JSON: {color,fontSize,fontWeight,rotate,bg}
  x           DECIMAL(5,2) NOT NULL,          -- 横向百分比 0~100
  y           DECIMAL(5,2) NOT NULL,          -- 纵向百分比 0~100
  createdAt   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_annotations_post (postId),
  CONSTRAINT fk_annotations_post FOREIGN KEY (postId)
    REFERENCES posts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**关键设计点:**
- **坐标存百分比**(非像素),适配不同屏幕宽度;锚定于帖子卡片容器。
- **style 存 JSON 字符串**,沿用项目已有做法(`posts.completionRequests` 即 JSON-in-TEXT)。文字批注用全部字段;表情印章只需 `rotate`。
- **type 预留扩展**:阶段一只用 `text`/`stamp`,阶段三加 `custom` 无需改表。
- 建表语句追加到 `db.js` 的 `createTables()` 末尾,沿用"CREATE TABLE IF NOT EXISTS + 启动自动建表"模式,无需手动迁移脚本。

### 已知技术折中:坐标锚定漂移

批注挂在帖子卡片上,卡片高度由正文长度决定。同一内容在不同设备上字体渲染存在细微差异,Y 坐标可能漂移几像素。对本功能完全可接受——保留"任意位置自由覆盖"的核心乐趣优先于像素级精确。

## 4. 后端接口设计

沿用 `server.js` 现有路由风格(`app.post('/api/posts/:id/...')`、`next(err)` 统一错误处理)。

### 4.1 GET /api/posts/:id/annotations — 查批注

帖子详情页加载时调用,返回该帖所有批注用于渲染批注层。

```
响应: { success: true, annotations: [
  { id, userId, nickname, type, content, style, x, y, createdAt }
] }
```
按 `createdAt` 升序返回,保证后贴的渲染在上层。

### 4.2 POST /api/posts/:id/annotations — 建批注

```
请求体: { userId, type, content, style, x, y }
响应:   { success: true, annotation: {...} }
```
后端校验:
- 帖子存在(404)
- **userId 是参与者**:等于 `posts.publisherId`,或存在于 `post_buddies`(403)
- `type ∈ {'text','stamp'}`、`x/y ∈ [0,100]`、`content` 非空(400)
- 单帖每人批注数 < 20,否则拒绝(400)
- 从 `users` 表取 `nickname` 冗余写入

### 4.3 DELETE /api/posts/:id/annotations/:annId — 删批注

```
请求体: { userId }
响应:   { success: true }
```
校验:批注存在(404);`userId === annotation.userId`(作者本人)**或** `userId === post.publisherId`(楼主),否则 403。

### 4.4 建表

在 `db.js` 的 `createTables()` 末尾追加第 3 节的 `annotations` 建表语句。沿用启动自动建表模式。

### 4.5 前端 API 封装

`services/api.js` 复用现有 `request()` 新增三个函数:`getAnnotations(postId)`、`createAnnotation(postId, payload)`、`deleteAnnotation(postId, annId, userId)`。

## 5. 前端交互与组件设计

### 5.1 交互流程(点击定位)

1. 详情页加载 → `getAnnotations` → 渲染批注层
2. 点悬浮工具箱(🧰)→ 展开 → 选"✏️写批注"或某表情
3. 进入**放置模式**:帖子卡片显示半透明提示"点击要贴的位置"
4. 用户点击 → 用 `wx.createSelectorQuery` 取帖子卡片位置与宽高 → 算百分比坐标 `(clickX-cardLeft)/cardWidth*100`、`(clickY-cardTop)/cardHeight*100`
5. 文字批注弹输入框(填内容 + 选预设样式),表情则直接落点
6. `createAnnotation` → 成功后批注出现在该位置
7. 点已有批注 → 弹层显示作者昵称 + 时间;本人或楼主可删

### 5.2 悬浮工具箱组件 `components/annotation-toolbox/`

可复用自定义组件,为将来其他板块复用而设计。

- 悬浮按钮(🧰)固定屏幕右下角,点击展开/收起工具面板
- 面板内:"✏️写批注"按钮 + 一排内置 Unicode 表情(🔥💪👍❤️😂⭐ 等)
- `properties`:`emojis`(可用表情列表)、`textStyles`(预设文字样式列表)
- 对外事件 `bind:pick`,payload `{ kind:'text'|'stamp', value, style }`
- **不关心具体帖子**——只负责"用户选了什么工具";放置逻辑由使用页面处理

### 5.3 批注渲染层组件 `components/annotation-layer/`

- `properties`:`annotations`(数组)
- 绝对定位渲染每条批注:文字批注套用 style JSON(color/fontSize/fontWeight/rotate/bg),表情印章按 content 字符 + rotate 渲染
- 印章/批注半透明,避免完全遮挡正文
- 点击某条 → `bind:tap-annotation` 抛出该批注 id
- 提供"隐藏/显示批注层"开关,密集时可看原文

### 5.4 预设文字样式(阶段一)

提供有限预设,不做完整富文本编辑器(YAGNI):
- 颜色:若干预设色(红/橙/绿/蓝/紫)
- 字号:小/中/大
- 是否加粗、是否轻微旋转、便签底色

## 6. 错误处理与边界

**错误处理:**
- 非参与者创建 → 后端 403;前端对非参与者不显示工具箱(双重保险)
- 删除越权 → 403
- content 空 / 坐标越界 / type 非法 → 400,前端提交前先校验
- 批注加载失败 → 帖子正常显示,批注层为空 + 轻提示,不阻塞主流程
- 单帖每人 20 条上限,超出前端禁用工具箱并提示

**边界情况:**
- 帖子删除 → 外键级联清理批注,无残留
- 批注重叠 → 按 createdAt 升序渲染,后贴在上层,点击响应最上面那条
- 批注作者退出搭子 → 已贴批注保留为历史,不随退出删除

## 7. 测试策略

项目后端现用脚本手测(如 `test_query.js`),无正式测试框架。MVP 采用:
- **后端**:新增 `test_annotations.js` 脚本,覆盖建表、创建(参与者/非参与者)、查询、删除(本人/楼主/越权)、20 条上限校验
- **前端**:微信开发者工具内手动走查完整流程(放置 → 渲染 → 点击查看 → 删除)
- **建表验证**:重启后端确认 `annotations` 表自动创建成功

## 8. 不在本次范围(后续阶段)

- 收藏系统(阶段二):长按收藏他人批注样式/表情到「我的工具箱」
- 自定义图片表情导入(阶段三):`wx.chooseMedia` + Base64 存库
- 拖拽定位(放置后可拖动微调):本次用点击定位,拖拽留后续增强
- 点击批注后的扩展信息(评论、回应等)
