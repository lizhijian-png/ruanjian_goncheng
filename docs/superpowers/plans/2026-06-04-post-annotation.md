# 帖子批注协作互动功能 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让任务参与者(发布者+搭子)能在帖子卡片任意位置贴文字批注和表情印章,点击查看作者/时间,作者及楼主可删除。

**Architecture:** 后端新增独立 `annotations` 表 + 3 个 REST 接口(查/建/删),沿用现有 `query`/`withTransaction`/`next(err)` 模式。前端新增两个可复用自定义组件(悬浮工具箱 `annotation-toolbox`、批注渲染层 `annotation-layer`),由帖子详情页协调数据、坐标计算与接口调用。坐标存百分比适配多屏。

**Tech Stack:** 微信原生小程序(WXML/WXSS/JS 自定义组件)、Node.js + Express、MySQL 8(mysql2/promise)。

**对应设计文档:** `docs/superpowers/specs/2026-06-04-post-annotation-design.md`

---

## 文件结构

**后端(`backend/`):**
- 修改 `src/db.js` — 在 `createTables()` 末尾追加 `annotations` 建表语句
- 修改 `src/server.js` — 新增 3 个路由 + 一个 `isParticipant` 辅助函数
- 创建 `test_annotations.js` — 独立手测脚本

**前端(`miniprogram/`):**
- 修改 `services/api.js` — 新增 `getAnnotations`/`createAnnotation`/`deleteAnnotation`
- 创建 `components/annotation-toolbox/` — 悬浮工具箱组件(4 文件)
- 创建 `components/annotation-layer/` — 批注渲染层组件(4 文件)
- 修改 `pages/post-detail/post-detail.json` — 注册两个组件
- 修改 `pages/post-detail/post-detail.js` — 加载批注、放置模式、坐标计算、增删
- 修改 `pages/post-detail/post-detail.wxml` — 嵌入两个组件 + 放置提示 + 详情弹层
- 修改 `pages/post-detail/post-detail.wxss` — 批注层定位与弹层样式

---

## Task 1: 后端建表

**Files:**
- Modify: `backend/src/db.js`(在 `createTables()` 末尾,`point_logs` 建表之后、函数闭合 `}` 之前)

- [ ] **Step 1: 在 `createTables()` 末尾追加 annotations 建表语句**

打开 `backend/src/db.js`,找到 `point_logs` 表的 `CREATE TABLE` 语句结束处(约 295 行,`)` 加 `;` 之后,`createTables` 函数的闭合 `}` 之前),插入:

```javascript
  // 帖子批注表(文字批注 + 表情印章)
  await query(`
    CREATE TABLE IF NOT EXISTS annotations (
      id          VARCHAR(64) PRIMARY KEY,
      postId      VARCHAR(64) NOT NULL,
      userId      VARCHAR(64) NOT NULL,
      nickname    VARCHAR(100) NOT NULL,
      type        VARCHAR(20) NOT NULL,
      content     TEXT NOT NULL,
      style       TEXT NOT NULL,
      x           DECIMAL(5,2) NOT NULL,
      y           DECIMAL(5,2) NOT NULL,
      createdAt   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_annotations_post (postId),
      CONSTRAINT fk_annotations_post FOREIGN KEY (postId)
        REFERENCES posts(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
```

- [ ] **Step 2: 重启后端验证自动建表**

Run: `cd backend && npm start`
Expected: 输出 `Task Buddy backend listening on http://localhost:3000`,无 SQL 报错。启动后 Ctrl+C 停止。

- [ ] **Step 3: 确认表已创建**

Run: `cd backend && node -e "const{query,initDb}=require('./src/db');initDb().then(()=>query('SHOW TABLES LIKE \'annotations\'')).then(r=>{console.log(r.length?'OK: annotations 表存在':'FAIL: 表不存在');process.exit(0)})"`
Expected: 打印 `OK: annotations 表存在`

- [ ] **Step 4: Commit**

```bash
git add backend/src/db.js
git commit -m "feat(db): 新增 annotations 帖子批注表"
```

---

## Task 2: 后端批注接口(查/建/删)

**Files:**
- Modify: `backend/src/server.js`(在 `app.get('/api/users/:id/point-logs', ...)` 路由之后、全局错误处理 `app.use((err,...))` 之前,约 1059 行处插入)

后端已有可复用工具:`createId(prefix)`(13 行)、`query`(从 db 引入)、`getUserById`(39 行)。沿用 `next(error)` 错误处理。

- [ ] **Step 1: 新增参与者校验辅助函数**

在 `server.js` 中 `getUserById` 函数之后(约 42 行)插入:

```javascript
async function isParticipant(postId, userId, post) {
  if (post.publisherId === userId) return true;
  const rows = await query(
    'SELECT id FROM post_buddies WHERE postId = ? AND userId = ?',
    [postId, userId]
  );
  return rows.length > 0;
}
```

- [ ] **Step 2: 新增 GET 查批注路由**

在 point-logs 路由之后、`app.use((err,...))` 之前插入:

```javascript
app.get('/api/posts/:id/annotations', async (req, res, next) => {
  try {
    const annotations = await query(
      `SELECT id, userId, nickname, type, content, style, x, y, createdAt
       FROM annotations WHERE postId = ? ORDER BY createdAt ASC`,
      [req.params.id]
    );
    res.json({ success: true, annotations });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 3: 新增 POST 建批注路由**

紧接上一段插入:

```javascript
app.post('/api/posts/:id/annotations', async (req, res, next) => {
  try {
    const postId = req.params.id;
    const { userId, type, content, style, x, y } = req.body;

    const postRows = await query('SELECT * FROM posts WHERE id = ?', [postId]);
    const post = postRows[0];
    if (!post) return res.status(404).json({ message: '帖子不存在' });

    if (!userId || !(await isParticipant(postId, userId, post))) {
      return res.status(403).json({ message: '只有任务参与者可以批注' });
    }
    if (type !== 'text' && type !== 'stamp') {
      return res.status(400).json({ message: 'type 不合法' });
    }
    if (!String(content || '').trim()) {
      return res.status(400).json({ message: '批注内容不能为空' });
    }
    const nx = Number(x), ny = Number(y);
    if (!(nx >= 0 && nx <= 100 && ny >= 0 && ny <= 100)) {
      return res.status(400).json({ message: '坐标超出范围' });
    }

    const countRows = await query(
      'SELECT COUNT(*) AS cnt FROM annotations WHERE postId = ? AND userId = ?',
      [postId, userId]
    );
    if (countRows[0].cnt >= 20) {
      return res.status(400).json({ message: '你在该帖的批注已达上限(20 条)' });
    }

    const user = await getUserById(userId);
    if (!user) return res.status(400).json({ message: '用户不存在' });

    const id = createId('ann');
    const styleStr = typeof style === 'string' ? style : JSON.stringify(style || {});
    await query(
      `INSERT INTO annotations (id, postId, userId, nickname, type, content, style, x, y)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, postId, userId, user.nickname, type, String(content), styleStr, nx, ny]
    );

    const rows = await query(
      `SELECT id, userId, nickname, type, content, style, x, y, createdAt
       FROM annotations WHERE id = ?`,
      [id]
    );
    res.json({ success: true, annotation: rows[0] });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 4: 新增 DELETE 删批注路由**

紧接上一段插入:

```javascript
app.delete('/api/posts/:id/annotations/:annId', async (req, res, next) => {
  try {
    const { id: postId, annId } = req.params;
    const { userId } = req.body;

    const annRows = await query('SELECT * FROM annotations WHERE id = ? AND postId = ?', [annId, postId]);
    const ann = annRows[0];
    if (!ann) return res.status(404).json({ message: '批注不存在' });

    const postRows = await query('SELECT publisherId FROM posts WHERE id = ?', [postId]);
    const post = postRows[0];
    const isOwner = ann.userId === userId;
    const isPublisher = post && post.publisherId === userId;
    if (!isOwner && !isPublisher) {
      return res.status(403).json({ message: '无权删除该批注' });
    }

    await query('DELETE FROM annotations WHERE id = ?', [annId]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 5: 重启后端确认无语法错误**

Run: `cd backend && npm start`
Expected: 输出监听地址,无报错。Ctrl+C 停止。

- [ ] **Step 6: Commit**

```bash
git add backend/src/server.js
git commit -m "feat(api): 新增帖子批注查/建/删接口"
```

---

## Task 3: 前端 API 封装

**Files:**
- Modify: `miniprogram/services/api.js`(在 `getPointLogs` 函数之后、`module.exports` 之前新增三个函数,并加入导出)

复用现有 `request()` 封装(3 行起)。

- [ ] **Step 1: 新增三个 API 函数**

在 `getPointLogs` 函数定义之后(约 167 行)、`module.exports = {` 之前插入:

```javascript
function getAnnotations(postId) {
  return request({ url: `/api/posts/${postId}/annotations` });
}

function createAnnotation(postId, payload) {
  return request({
    url: `/api/posts/${postId}/annotations`,
    method: 'POST',
    data: payload
  });
}

function deleteAnnotation(postId, annId, userId) {
  return request({
    url: `/api/posts/${postId}/annotations/${annId}`,
    method: 'DELETE',
    data: { userId }
  });
}
```

- [ ] **Step 2: 加入导出**

在 `module.exports = { ... }` 对象中,`getPointLogs` 之后加入三个名字:

```javascript
  getPointLogs,
  getAnnotations,
  createAnnotation,
  deleteAnnotation
```

(注意:`getPointLogs` 原本是导出列表最后一项,需要给它补上逗号。)

- [ ] **Step 3: Commit**

```bash
git add miniprogram/services/api.js
git commit -m "feat(api): 前端新增批注接口封装"
```

---

## Task 4: 悬浮工具箱组件 annotation-toolbox

**Files:**
- Create: `miniprogram/components/annotation-toolbox/annotation-toolbox.json`
- Create: `miniprogram/components/annotation-toolbox/annotation-toolbox.wxml`
- Create: `miniprogram/components/annotation-toolbox/annotation-toolbox.js`
- Create: `miniprogram/components/annotation-toolbox/annotation-toolbox.wxss`

组件职责:展示悬浮 🧰 按钮,点击展开面板(写批注 + 一排表情);用户选择后通过 `bind:pick` 抛事件。不关心具体帖子。

- [ ] **Step 1: 创建组件 json**

文件 `annotation-toolbox.json`:

```json
{
  "component": true,
  "usingComponents": {}
}
```

- [ ] **Step 2: 创建组件 wxml**

文件 `annotation-toolbox.wxml`:

```html
<view class="toolbox-root">
  <view wx:if="{{expanded}}" class="toolbox-panel">
    <view class="panel-title">批注工具箱</view>
    <button class="text-tool-btn" bindtap="pickText">✏️ 写批注</button>
    <view class="emoji-row">
      <view
        wx:for="{{emojis}}"
        wx:key="*this"
        class="emoji-item"
        data-emoji="{{item}}"
        bindtap="pickStamp"
      >{{item}}</view>
    </view>
  </view>
  <view class="toolbox-fab" bindtap="toggle">{{expanded ? '✕' : '🧰'}}</view>
</view>
```

- [ ] **Step 3: 创建组件 js**

文件 `annotation-toolbox.js`:

```javascript
Component({
  properties: {
    emojis: {
      type: Array,
      value: ['🔥', '💪', '👍', '❤️', '😂', '⭐', '🎯', '✨']
    }
  },
  data: {
    expanded: false
  },
  methods: {
    toggle() {
      this.setData({ expanded: !this.data.expanded });
    },
    pickText() {
      this.setData({ expanded: false });
      this.triggerEvent('pick', { kind: 'text' });
    },
    pickStamp(e) {
      const emoji = e.currentTarget.dataset.emoji;
      this.setData({ expanded: false });
      this.triggerEvent('pick', { kind: 'stamp', value: emoji });
    }
  }
});
```

- [ ] **Step 4: 创建组件 wxss**

文件 `annotation-toolbox.wxss`:

```css
.toolbox-fab {
  position: fixed;
  right: 30rpx;
  bottom: 60rpx;
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
  background: #ff7a59;
  color: #fff;
  font-size: 44rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6rpx 18rpx rgba(255, 122, 89, 0.4);
  z-index: 100;
}
.toolbox-panel {
  position: fixed;
  right: 30rpx;
  bottom: 176rpx;
  width: 420rpx;
  background: #fff;
  border-radius: 18rpx;
  padding: 20rpx;
  box-shadow: 0 6rpx 24rpx rgba(0, 0, 0, 0.15);
  z-index: 100;
}
.panel-title {
  font-size: 24rpx;
  color: #a08;
  letter-spacing: 2rpx;
  margin-bottom: 14rpx;
}
.text-tool-btn {
  background: #ff7a59;
  color: #fff;
  font-size: 28rpx;
  border-radius: 12rpx;
  margin-bottom: 16rpx;
}
.emoji-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}
.emoji-item {
  font-size: 44rpx;
  width: 72rpx;
  height: 72rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

- [ ] **Step 5: Commit**

```bash
git add miniprogram/components/annotation-toolbox/
git commit -m "feat(component): 新增可复用悬浮批注工具箱组件"
```

---

## Task 5: 批注渲染层组件 annotation-layer

**Files:**
- Create: `miniprogram/components/annotation-layer/annotation-layer.json`
- Create: `miniprogram/components/annotation-layer/annotation-layer.wxml`
- Create: `miniprogram/components/annotation-layer/annotation-layer.js`
- Create: `miniprogram/components/annotation-layer/annotation-layer.wxss`

组件职责:接收 annotations 数组,绝对定位渲染文字批注与表情印章;点击某条抛 `bind:tapannotation` 事件。style 字段在 js 内解析为内联 css 字符串供 wxml 用。

- [ ] **Step 1: 创建组件 json**

文件 `annotation-layer.json`:

```json
{
  "component": true,
  "usingComponents": {}
}
```

- [ ] **Step 2: 创建组件 wxml**

文件 `annotation-layer.wxml`:

```html
<view class="layer-root">
  <view
    wx:for="{{items}}"
    wx:key="id"
    class="anno {{item.type === 'stamp' ? 'anno-stamp' : 'anno-text'}}"
    style="left:{{item.x}}%;top:{{item.y}}%;{{item.cssStyle}}"
    data-id="{{item.id}}"
    catchtap="onTapAnnotation"
  >{{item.content}}</view>
</view>
```

- [ ] **Step 3: 创建组件 js**

文件 `annotation-layer.js`(用 `observers` 监听 annotations,把 style JSON 转为内联 css):

```javascript
Component({
  properties: {
    annotations: { type: Array, value: [] }
  },
  data: { items: [] },
  observers: {
    annotations(list) {
      const items = (list || []).map(a => {
        let style = {};
        try { style = JSON.parse(a.style || '{}'); } catch (e) { style = {}; }
        const parts = [];
        if (style.color) parts.push(`color:${style.color}`);
        if (style.fontSize) parts.push(`font-size:${style.fontSize}rpx`);
        if (style.fontWeight) parts.push(`font-weight:${style.fontWeight}`);
        if (style.bg) parts.push(`background:${style.bg}`);
        if (style.rotate) parts.push(`transform:rotate(${style.rotate}deg)`);
        return { ...a, cssStyle: parts.join(';') };
      });
      this.setData({ items });
    }
  },
  methods: {
    onTapAnnotation(e) {
      this.triggerEvent('tapannotation', { id: e.currentTarget.dataset.id });
    }
  }
});
```

- [ ] **Step 4: 创建组件 wxss**

文件 `annotation-layer.wxss`:

```css
.layer-root {
  position: absolute;
  left: 0; top: 0; right: 0; bottom: 0;
  pointer-events: none;
}
.anno {
  position: absolute;
  pointer-events: auto;
  transform: translate(-50%, -50%);
  opacity: 0.92;
}
.anno-text {
  padding: 6rpx 12rpx;
  border-radius: 10rpx;
  font-size: 26rpx;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.12);
  max-width: 360rpx;
}
.anno-stamp {
  font-size: 64rpx;
  filter: drop-shadow(0 2rpx 4rpx rgba(0, 0, 0, 0.2));
}
```

注意:批注若自带 `rotate`,内联 style 的 transform 会覆盖 `.anno` 的居中 translate。可接受——轻微偏移不影响体验。

- [ ] **Step 5: Commit**

```bash
git add miniprogram/components/annotation-layer/
git commit -m "feat(component): 新增批注渲染层组件"
```

---

## Task 6: 详情页接入批注逻辑(数据 + 放置 + 增删)

**Files:**
- Modify: `miniprogram/pages/post-detail/post-detail.json`(注册两个组件)
- Modify: `miniprogram/pages/post-detail/post-detail.js`(状态、加载、放置、坐标计算、增删)

- [ ] **Step 1: 注册组件**

`post-detail.json` 改为:

```json
{
  "navigationBarTitleText": "帖子详情",
  "usingComponents": {
    "annotation-toolbox": "/components/annotation-toolbox/annotation-toolbox",
    "annotation-layer": "/components/annotation-layer/annotation-layer"
  }
}
```

- [ ] **Step 2: data 中新增批注状态**

`post-detail.js` 的 `data` 对象末尾(`evalContent: ''` 之后,补一个逗号)加入:

```javascript
    ,
    annotations: [],
    isParticipant: false,
    placingMode: false,
    placingKind: '',
    placingEmoji: '',
    showTextInput: false,
    textInputValue: '',
    pendingX: 0,
    pendingY: 0,
    showAnnoDetail: false,
    activeAnno: null,
    canDeleteActive: false
```

- [ ] **Step 3: `_loadDetail` 中补 isParticipant 并加载批注**

在 `_loadDetail` 的主 `setData({...})` 调用里,`evalTargets` 之后追加 `, isParticipant: isPublisher || isBuddy`。然后在该 `setData` 语句之后插入:

```javascript
      try {
        const annoRes = await api.getAnnotations(post.id);
        this.setData({ annotations: annoRes.annotations || [] });
      } catch (e) {
        this.setData({ annotations: [] });
        wx.showToast({ title: '批注加载失败', icon: 'none' });
      }
```

- [ ] **Step 4: 新增工具箱选择、放置、坐标、增删方法**

在 `backToPersonPicker()` 方法之后(`Page({...})` 闭合的 `});` 之前)加入:

```javascript
  onToolPick(e) {
    if (!this.data.isParticipant) {
      wx.showToast({ title: '只有参与者可以批注', icon: 'none' });
      return;
    }
    const { kind, value } = e.detail;
    this.setData({
      placingMode: true,
      placingKind: kind,
      placingEmoji: kind === 'stamp' ? value : ''
    });
    wx.showToast({ title: '点击帖子上要贴的位置', icon: 'none' });
  },
  onCardTap(e) {
    if (!this.data.placingMode) return;
    const q = wx.createSelectorQuery().in(this);
    q.select('.detail-card').boundingClientRect();
    q.exec((res) => {
      const rect = res[0];
      if (!rect) return;
      const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e.detail;
      const px = t.clientX !== undefined ? t.clientX : t.x;
      const py = t.clientY !== undefined ? t.clientY : t.y;
      const x = Math.max(0, Math.min(100, ((px - rect.left) / rect.width) * 100));
      const y = Math.max(0, Math.min(100, ((py - rect.top) / rect.height) * 100));
      if (this.data.placingKind === 'stamp') {
        this._createAnnotation('stamp', this.data.placingEmoji, { rotate: 0 }, x, y);
      } else {
        this.setData({ showTextInput: true, pendingX: x, pendingY: y });
      }
    });
  },
  onTextInputChange(e) {
    this.setData({ textInputValue: e.detail.value });
  },
  confirmTextAnnotation() {
    const text = String(this.data.textInputValue || '').trim();
    if (!text) {
      wx.showToast({ title: '请输入批注内容', icon: 'none' });
      return;
    }
    const style = { color: '#c0392b', fontSize: 28, fontWeight: 'bold', bg: '#fff3b0', rotate: -3 };
    this._createAnnotation('text', text, style, this.data.pendingX, this.data.pendingY);
    this.setData({ showTextInput: false, textInputValue: '' });
  },
  cancelTextAnnotation() {
    this.setData({ showTextInput: false, textInputValue: '', placingMode: false });
  },
  async _createAnnotation(type, content, style, x, y) {
    const { post, currentUserId } = this.data;
    try {
      const res = await api.createAnnotation(post.id, {
        userId: currentUserId, type, content, style: JSON.stringify(style), x, y
      });
      this.setData({
        annotations: [...this.data.annotations, res.annotation],
        placingMode: false, placingKind: '', placingEmoji: ''
      });
    } catch (error) {
      this.setData({ placingMode: false });
      wx.showToast({ title: error.message || '批注失败', icon: 'none' });
    }
  },
  onTapAnnotation(e) {
    const anno = this.data.annotations.find(a => a.id === e.detail.id);
    if (!anno) return;
    const canDelete = anno.userId === this.data.currentUserId || this.data.isPublisher;
    this.setData({ showAnnoDetail: true, activeAnno: anno, canDeleteActive: canDelete });
  },
  closeAnnoDetail() {
    this.setData({ showAnnoDetail: false, activeAnno: null });
  },
  async deleteActiveAnnotation() {
    const { post, currentUserId, activeAnno } = this.data;
    if (!activeAnno) return;
    try {
      await api.deleteAnnotation(post.id, activeAnno.id, currentUserId);
      this.setData({
        annotations: this.data.annotations.filter(a => a.id !== activeAnno.id),
        showAnnoDetail: false, activeAnno: null
      });
      wx.showToast({ title: '已删除', icon: 'none' });
    } catch (error) {
      wx.showToast({ title: error.message || '删除失败', icon: 'none' });
    }
  },
```

- [ ] **Step 5: Commit**

```bash
git add miniprogram/pages/post-detail/post-detail.json miniprogram/pages/post-detail/post-detail.js
git commit -m "feat(post-detail): 接入批注加载与增删放置逻辑"
```

---

## Task 7: 详情页视图层(嵌入组件 + 弹层)

**Files:**
- Modify: `miniprogram/pages/post-detail/post-detail.wxml`
- Modify: `miniprogram/pages/post-detail/post-detail.wxss`

- [ ] **Step 1: 给帖子卡片加点击监听 + 嵌入批注层**

`post-detail.wxml` 第 2 行 `<view class="post-card detail-card">` 改为带点击:

```html
<view class="post-card detail-card" bindtap="onCardTap">
```

在该卡片的 `<view class="detail-content">{{post.content}}</view>`(约 16 行)之后,紧接插入批注层:

```html
    <annotation-layer
      annotations="{{annotations}}"
      bind:tapannotation="onTapAnnotation"
    />
```

- [ ] **Step 2: 放置提示条**

在 `<view class="container" ...>` 内、卡片之上(约第 2 行卡片之前)插入放置模式提示:

```html
  <view wx:if="{{placingMode}}" class="placing-hint">点击帖子上要贴批注的位置</view>
```

- [ ] **Step 3: 工具箱组件 + 文字输入弹层 + 批注详情弹层**

在最外层 `<view class="container" wx:if="{{post}}">` 的闭合 `</view>`(文件末尾,约 167 行)之前插入:

```html
  <annotation-toolbox
    wx:if="{{isParticipant}}"
    bind:pick="onToolPick"
  />

  <view wx:if="{{showTextInput}}" class="anno-input-overlay">
    <view class="anno-input-panel">
      <view class="section-title">写批注</view>
      <textarea
        class="evidence-textarea"
        placeholder="输入批注文字..."
        placeholder-class="placeholder"
        bindinput="onTextInputChange"
        value="{{textInputValue}}"
      />
      <view class="evidence-form-btns">
        <button class="ghost-btn evidence-btn" bindtap="cancelTextAnnotation">取消</button>
        <button class="primary-btn evidence-btn" bindtap="confirmTextAnnotation">贴上</button>
      </view>
    </view>
  </view>

  <view wx:if="{{showAnnoDetail}}" class="anno-input-overlay" bindtap="closeAnnoDetail">
    <view class="anno-detail-panel" catchtap="">
      <view class="anno-detail-author">{{activeAnno.nickname}}</view>
      <view class="anno-detail-content">{{activeAnno.content}}</view>
      <view class="muted">{{activeAnno.createdAt}}</view>
      <view class="evidence-form-btns">
        <button class="ghost-btn evidence-btn" bindtap="closeAnnoDetail">关闭</button>
        <button
          wx:if="{{canDeleteActive}}"
          class="danger-btn evidence-btn"
          bindtap="deleteActiveAnnotation"
        >删除</button>
      </view>
    </view>
  </view>
```

- [ ] **Step 4: 卡片定位容器 + 弹层样式**

`post-detail.wxss` 末尾追加:

```css
.detail-card {
  position: relative;
}
.placing-hint {
  background: #fff3b0;
  color: #7a5a00;
  font-size: 26rpx;
  text-align: center;
  padding: 16rpx;
  border-radius: 12rpx;
  margin-bottom: 16rpx;
}
.anno-input-overlay {
  position: fixed;
  left: 0; top: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}
.anno-input-panel, .anno-detail-panel {
  width: 560rpx;
  background: #fff;
  border-radius: 18rpx;
  padding: 28rpx;
}
.anno-detail-author {
  font-weight: 700;
  font-size: 30rpx;
  color: #3a2a33;
  margin-bottom: 10rpx;
}
.anno-detail-content {
  font-size: 28rpx;
  color: #5a4a52;
  margin-bottom: 10rpx;
}
```

- [ ] **Step 5: Commit**

```bash
git add miniprogram/pages/post-detail/post-detail.wxml miniprogram/pages/post-detail/post-detail.wxss
git commit -m "feat(post-detail): 批注层渲染、工具箱与弹层视图"
```

---

## Task 8: 后端手测脚本

**Files:**
- Create: `backend/test_annotations.js`

沿用 `test_query.js` 的独立 `mysql2` 脚本风格,直连库做端到端校验。前置:后端依赖已装,MySQL 在运行,库中至少有一个帖子和两个用户(可先在小程序里造数据)。

- [ ] **Step 1: 创建测试脚本**

文件 `backend/test_annotations.js`:

```javascript
const mysql = require('mysql2/promise');
const dbConfig = {
  host: '127.0.0.1', port: 3306, user: 'root', password: '123456',
  database: 'task_buddy', charset: 'utf8mb4'
};

async function run() {
  const pool = mysql.createPool(dbConfig);
  let pass = 0, fail = 0;
  const ok = (c, m) => c ? (pass++, console.log('  PASS', m)) : (fail++, console.log('  FAIL', m));
  try {
    // 1. 表存在
    const [t] = await pool.execute("SHOW TABLES LIKE 'annotations'");
    ok(t.length === 1, 'annotations 表存在');

    // 2. 取一个帖子和其发布者
    const [[post]] = await pool.execute('SELECT id, publisherId FROM posts LIMIT 1');
    if (!post) { console.log('SKIP: 库中无帖子,请先在小程序造数据'); await pool.end(); return; }

    // 3. 插入一条参与者(发布者)的批注
    const annId = 'test_ann_' + Date.now();
    await pool.execute(
      `INSERT INTO annotations (id, postId, userId, nickname, type, content, style, x, y)
       VALUES (?, ?, ?, ?, 'text', '测试批注', '{"color":"#c0392b"}', 50, 50)`,
      [annId, post.id, post.publisherId, '测试者']
    );
    const [[ins]] = await pool.execute('SELECT * FROM annotations WHERE id = ?', [annId]);
    ok(ins && ins.content === '测试批注', '插入批注成功');
    ok(Number(ins.x) === 50 && Number(ins.y) === 50, '坐标正确存储');

    // 4. 按 postId 查询
    const [list] = await pool.execute('SELECT id FROM annotations WHERE postId = ?', [post.id]);
    ok(list.some(r => r.id === annId), '按帖子查到批注');

    // 5. 删除
    await pool.execute('DELETE FROM annotations WHERE id = ?', [annId]);
    const [after] = await pool.execute('SELECT id FROM annotations WHERE id = ?', [annId]);
    ok(after.length === 0, '删除批注成功');

    console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  } catch (e) {
    console.error('Error:', e.message);
  }
  await pool.end();
}
run();
```

- [ ] **Step 2: 运行测试**

Run: `cd backend && node test_annotations.js`
Expected: 各项 PASS,末尾 `结果: 5 通过, 0 失败`(若库中无帖子则打印 SKIP)。

- [ ] **Step 3: 接口层手测(可选,需后端运行)**

启动后端后,用 curl 验证 403 拦截(非参与者):

Run: `curl -s -X POST http://localhost:3000/api/posts/<某帖子id>/annotations -H "Content-Type: application/json" -d '{"userId":"not_a_participant","type":"stamp","content":"🔥","style":"{}","x":10,"y":10}'`
Expected: 返回 `{"message":"只有任务参与者可以批注"}`(403)。

- [ ] **Step 4: Commit**

```bash
git add backend/test_annotations.js
git commit -m "test: 新增批注功能后端手测脚本"
```

---

## Task 9: 前端完整流程走查(微信开发者工具)

无代码改动,人工验证。打开微信开发者工具,确保后端运行。

- [ ] **Step 1:** 用参与者(发布者或搭子)身份进入一个帖子详情页 → 右下角应出现 🧰 悬浮按钮。
- [ ] **Step 2:** 点 🧰 展开 → 点某表情 → 提示"点击帖子上要贴的位置" → 点帖子某处 → 表情印章出现在该位置。
- [ ] **Step 3:** 点 🧰 → "✏️ 写批注" → 点帖子某处 → 弹输入框 → 输入文字 → "贴上" → 文字批注出现。
- [ ] **Step 4:** 点已有批注 → 弹层显示作者昵称 + 时间。本人/楼主有"删除"按钮,他人没有。
- [ ] **Step 5:** 删除一条 → 批注消失。
- [ ] **Step 6:** 退出重进详情页 → 批注位置与内容保持一致(已落库)。
- [ ] **Step 7:** 用非参与者身份进入 → 不显示 🧰 工具箱。

全部通过即 MVP 完成。

---

## Self-Review 检查记录

- **Spec 覆盖:** 数据模型→Task1;3 接口→Task2;前端封装→Task3;工具箱组件→Task4;批注层→Task5;详情页交互→Task6/7;测试策略→Task8/9。全覆盖。
- **权限一致:** 创建限参与者(Task2 `isParticipant` + Task6 `isParticipant` 状态);删除限作者或楼主(Task2 `isOwner||isPublisher` + Task6 `canDelete`)。一致。
- **命名一致:** 组件事件 `pick`/`tapannotation`,页面方法 `onToolPick`/`onTapAnnotation`,跨 Task4/5/6/7 一致。
- **坐标:** 全链路用百分比 0~100,Task2 校验、Task6 计算、Task5 渲染一致。
