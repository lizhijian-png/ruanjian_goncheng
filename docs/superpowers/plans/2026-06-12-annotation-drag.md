# 帖子批注拖拽微调功能 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让有权限的用户(批注作者本人 + 楼主)长按拖动已存在的批注/印章,松手后新坐标持久化到后端;轻点仍是查看作者/时间。

**Architecture:** 复用 MVP 既有边界——annotation-layer 组件管手势与渲染、详情页管数据与接口、后端管持久化。不新增组件、不改表(x/y 已是 DECIMAL)。后端新增 PATCH 接口仅更新坐标,前端在批注层加 touchstart/move/end,长按进入拖拽态、松手抛 dragend、详情页调接口并在失败时回滚。

**Tech Stack:** 微信原生小程序(自定义组件 + WXML/WXSS/JS)、Node.js + Express、MySQL 8(mysql2/promise)。

**对应设计文档:** `docs/superpowers/specs/2026-06-12-annotation-drag-design.md`

---

## 文件结构

**后端(`backend/`):**
- 修改 `src/server.js` — 在 DELETE 批注路由之后新增 PATCH 更新坐标路由
- 修改 `test_annotations.js` — 追加 PATCH 坐标更新的测试用例

**前端(`miniprogram/`):**
- 修改 `services/api.js` — 新增 `updateAnnotationPosition` 并导出
- 修改 `components/annotation-layer/annotation-layer.js` — 加长按拖拽手势、权限预计算、dragend 事件
- 修改 `components/annotation-layer/annotation-layer.wxml` — 绑定 touch 事件、应用拖拽态样式
- 修改 `components/annotation-layer/annotation-layer.wxss` — 拖拽态视觉反馈
- 修改 `pages/post-detail/post-detail.wxml` — 给 annotation-layer 传 currentUserId/publisherId/卡片尺寸,绑 dragend
- 修改 `pages/post-detail/post-detail.js` — 渲染后量取卡片尺寸传入,新增 onAnnotationDragEnd

---

## Task 1: 后端 PATCH 更新坐标接口

**Files:**
- Modify: `backend/src/server.js`(在 `app.delete('/api/posts/:id/annotations/:annId', ...)` 路由之后、全局错误处理 `app.use((err, ...))` 之前插入)

后端已有可复用工具:`query`(从 db 引入)、`createId`、`getUserById`。沿用 `next(error)` 错误处理。删除接口已确立"作者或楼主"的鉴权模式,这里复用同样判断。

- [ ] **Step 1: 新增 PATCH 路由**

在 DELETE 批注路由的闭合 `});` 之后插入:

```javascript
app.patch('/api/posts/:id/annotations/:annId', async (req, res, next) => {
  try {
    const { id: postId, annId } = req.params;
    const { userId, x, y } = req.body;

    const annRows = await query('SELECT * FROM annotations WHERE id = ? AND postId = ?', [annId, postId]);
    const ann = annRows[0];
    if (!ann) return res.status(404).json({ message: '批注不存在' });

    const postRows = await query('SELECT publisherId FROM posts WHERE id = ?', [postId]);
    const post = postRows[0];
    const isOwner = ann.userId === userId;
    const isPublisher = post && post.publisherId === userId;
    if (!isOwner && !isPublisher) {
      return res.status(403).json({ message: '无权移动该批注' });
    }

    const nx = Number(x), ny = Number(y);
    if (!(nx >= 0 && nx <= 100 && ny >= 0 && ny <= 100)) {
      return res.status(400).json({ message: '坐标超出范围' });
    }

    await query('UPDATE annotations SET x = ?, y = ? WHERE id = ?', [nx, ny, annId]);

    const rows = await query(
      `SELECT id, userId, nickname, type, content, style, x, y, createdAt
       FROM annotations WHERE id = ?`,
      [annId]
    );
    res.json({ success: true, annotation: rows[0] });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 2: 重启后端确认无语法错误**

Run: `cd backend && npm start`
Expected: 输出 `Task Buddy backend listening on http://localhost:3000`,无报错。确认后 Ctrl+C 停止。

- [ ] **Step 3: Commit**

```bash
git add backend/src/server.js
git commit -m "feat(api): 新增批注坐标更新接口 PATCH /annotations/:annId"
```

---

## Task 2: 后端手测脚本补 PATCH 用例

**Files:**
- Modify: `backend/test_annotations.js`(在"按帖子查询"断言之后、"删除"之前插入坐标更新测试)

注意:本脚本直连库做断言,与接口层鉴权无关,因此此处验证的是"UPDATE 坐标能正确落库"。接口层的 403/400 校验在 Task 1 已实现,通过前端手测覆盖。

- [ ] **Step 1: 插入坐标更新断言**

找到第 33 行 `ok(list.some(r => r.id === annId), '按帖子查到批注');` 这一行,在它之后、`// 5. 删除` 注释之前插入:

```javascript

    // 4.5 更新坐标
    await pool.execute('UPDATE annotations SET x = ?, y = ? WHERE id = ?', [12.5, 80, annId]);
    const [[moved]] = await pool.execute('SELECT x, y FROM annotations WHERE id = ?', [annId]);
    ok(Number(moved.x) === 12.5 && Number(moved.y) === 80, '坐标更新成功');
```

- [ ] **Step 2: 运行测试**

Run: `cd backend && node test_annotations.js`
Expected: 各项 PASS,末尾结果通过数比原来多 1(若库中无帖子则打印 SKIP)。

- [ ] **Step 3: Commit**

```bash
git add backend/test_annotations.js
git commit -m "test: 批注手测脚本补充坐标更新用例"
```

---

## Task 3: 前端 API 封装 updateAnnotationPosition

**Files:**
- Modify: `miniprogram/services/api.js`(在 `deleteAnnotation` 函数之后新增,并加入 `module.exports`)

复用现有 `request()` 封装。现有 `deleteAnnotation(postId, annId, userId)` 紧邻,风格照搬。

- [ ] **Step 1: 新增函数**

在 `deleteAnnotation` 函数定义之后插入:

```javascript
function updateAnnotationPosition(postId, annId, userId, x, y) {
  return request({
    url: `/api/posts/${postId}/annotations/${annId}`,
    method: 'PATCH',
    data: { userId, x, y }
  });
}
```

- [ ] **Step 2: 加入导出**

在 `module.exports = { ... }` 对象中,`deleteAnnotation` 之后加入 `updateAnnotationPosition`(注意给 `deleteAnnotation` 补逗号):

```javascript
  deleteAnnotation,
  updateAnnotationPosition,
```

- [ ] **Step 3: Commit**

```bash
git add miniprogram/services/api.js
git commit -m "feat(api): 前端新增批注坐标更新封装"
```

---

## Task 4: 批注层组件加长按拖拽手势

**Files:**
- Modify: `miniprogram/components/annotation-layer/annotation-layer.js`(全量重写,在现有基础上加 properties、拖拽状态、touch 方法)

**手势设计:** touchstart 记起点 + 该批注起始 x/y,若可拖则启 400ms 长按计时器;计时器到点进入拖拽态;touchmove 在拖拽态按位移换算百分比增量并 clamp 到 0~100,非拖拽态且位移>10px 则取消计时器(判为滑动);touchend 拖拽态抛 `dragend`,否则若位移很小抛 `tapannotation`。

权限预计算:在 `observers` 里给每条算 `canDrag = (userId===currentUserId)||(publisherId===currentUserId)`。

卡片尺寸由详情页通过 property `cardWidth`/`cardHeight` 传入(Task 6 提供)。

- [ ] **Step 1: 重写组件 js**

文件 `annotation-layer.js` 全量替换为:

```javascript
const LONG_PRESS_MS = 400;
const MOVE_CANCEL_PX = 10;

Component({
  properties: {
    annotations: { type: Array, value: [] },
    currentUserId: { type: String, value: '' },
    publisherId: { type: String, value: '' },
    cardWidth: { type: Number, value: 0 },
    cardHeight: { type: Number, value: 0 }
  },
  data: { items: [] },
  observers: {
    'annotations, currentUserId, publisherId'(list, currentUserId, publisherId) {
      const items = (list || []).map(a => {
        let style = {};
        try { style = JSON.parse(a.style || '{}'); } catch (e) { style = {}; }
        const parts = [];
        if (style.color) parts.push(`color:${style.color}`);
        if (style.fontSize) parts.push(`font-size:${style.fontSize}rpx`);
        if (style.fontWeight) parts.push(`font-weight:${style.fontWeight}`);
        if (style.bg) parts.push(`background:${style.bg}`);
        if (style.rotate) parts.push(`transform:rotate(${style.rotate}deg)`);
        const canDrag = (a.userId === currentUserId) || (publisherId && publisherId === currentUserId);
        return { ...a, cssStyle: parts.join(';'), canDrag, dragging: false };
      });
      this.setData({ items });
    }
  },
  methods: {
    _findIndex(id) {
      return this.data.items.findIndex(it => it.id === id);
    },
    onTouchStart(e) {
      const id = e.currentTarget.dataset.id;
      const idx = this._findIndex(id);
      if (idx < 0) return;
      const t = e.touches[0];
      const item = this.data.items[idx];
      this._drag = {
        id, idx,
        startClientX: t.clientX,
        startClientY: t.clientY,
        startX: Number(item.x),
        startY: Number(item.y),
        dragging: false,
        moved: false
      };
      if (item.canDrag) {
        this._timer = setTimeout(() => {
          if (!this._drag) return;
          this._drag.dragging = true;
          this.setData({ [`items[${idx}].dragging`]: true });
        }, LONG_PRESS_MS);
      }
    },
    onTouchMove(e) {
      if (!this._drag) return;
      const t = e.touches[0];
      const dxPx = t.clientX - this._drag.startClientX;
      const dyPx = t.clientY - this._drag.startClientY;
      if (!this._drag.dragging) {
        if (Math.abs(dxPx) > MOVE_CANCEL_PX || Math.abs(dyPx) > MOVE_CANCEL_PX) {
          this._drag.moved = true;
          clearTimeout(this._timer);
        }
        return;
      }
      const w = this.data.cardWidth || 1;
      const h = this.data.cardHeight || 1;
      const nx = Math.max(0, Math.min(100, this._drag.startX + (dxPx / w) * 100));
      const ny = Math.max(0, Math.min(100, this._drag.startY + (dyPx / h) * 100));
      this._drag.curX = nx;
      this._drag.curY = ny;
      this.setData({
        [`items[${this._drag.idx}].x`]: nx,
        [`items[${this._drag.idx}].y`]: ny
      });
    },
    onTouchEnd(e) {
      clearTimeout(this._timer);
      const d = this._drag;
      this._drag = null;
      if (!d) return;
      if (d.dragging) {
        const x = d.curX !== undefined ? d.curX : d.startX;
        const y = d.curY !== undefined ? d.curY : d.startY;
        this.setData({ [`items[${d.idx}].dragging`]: false });
        this.triggerEvent('dragend', { id: d.id, x, y });
      } else if (!d.moved) {
        this.triggerEvent('tapannotation', { id: d.id });
      }
    }
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add miniprogram/components/annotation-layer/annotation-layer.js
git commit -m "feat(component): 批注层加长按拖拽手势与权限判定"
```

---

## Task 5: 批注层 wxml/wxss 绑定手势与拖拽态样式

**Files:**
- Modify: `miniprogram/components/annotation-layer/annotation-layer.wxml`(改 touch 绑定,移除原 catchtap)
- Modify: `miniprogram/components/annotation-layer/annotation-layer.wxss`(加 `.anno-dragging` 样式)

原 wxml 用 `catchtap="onTapAnnotation"`。现改为用 touch 事件统一处理轻点与拖拽(轻点由 onTouchEnd 内部判定后抛 tapannotation)。

- [ ] **Step 1: 改 wxml**

文件 `annotation-layer.wxml` 全量替换为:

```html
<view class="layer-root">
  <view
    wx:for="{{items}}"
    wx:key="id"
    class="anno {{item.type === 'stamp' ? 'anno-stamp' : 'anno-text'}} {{item.dragging ? 'anno-dragging' : ''}}"
    style="left:{{item.x}}%;top:{{item.y}}%;{{item.cssStyle}}"
    data-id="{{item.id}}"
    catchtouchstart="onTouchStart"
    catchtouchmove="onTouchMove"
    catchtouchend="onTouchEnd"
  >{{item.content}}</view>
</view>
```

- [ ] **Step 2: 加 wxss 拖拽态样式**

在 `annotation-layer.wxss` 末尾追加:

```css
.anno-dragging {
  transform: translate(-50%, -50%) scale(1.12);
  box-shadow: 0 6rpx 18rpx rgba(0, 0, 0, 0.3);
  opacity: 1;
  z-index: 50;
}
```

注意:`.anno-dragging` 的 transform 会覆盖 `.anno` 的居中 translate,这里已显式带上 `translate(-50%,-50%)` 保持居中。自带 rotate 的批注在拖拽瞬间会暂时丢失旋转,松手即恢复——可接受。

- [ ] **Step 3: Commit**

```bash
git add miniprogram/components/annotation-layer/annotation-layer.wxml miniprogram/components/annotation-layer/annotation-layer.wxss
git commit -m "feat(component): 批注层绑定拖拽手势与拖拽态样式"
```

---

## Task 6: 详情页接入拖拽(传参 + dragend 处理)

**Files:**
- Modify: `miniprogram/pages/post-detail/post-detail.wxml`(给 annotation-layer 传 currentUserId/publisherId/cardWidth/cardHeight + 绑 dragend)
- Modify: `miniprogram/pages/post-detail/post-detail.js`(data 加 cardWidth/cardHeight,渲染后量取卡片尺寸,新增 onAnnotationDragEnd)

- [ ] **Step 1: 改 wxml 给批注层传参**

`post-detail.wxml` 第 18-21 行的 `<annotation-layer ... />` 替换为:

```html
    <annotation-layer
      annotations="{{annotations}}"
      currentUserId="{{currentUserId}}"
      publisherId="{{post.publisherId}}"
      cardWidth="{{cardWidth}}"
      cardHeight="{{cardHeight}}"
      bind:tapannotation="onTapAnnotation"
      bind:dragend="onAnnotationDragEnd"
    />
```

- [ ] **Step 2: data 中新增卡片尺寸字段**

`post-detail.js` 的 `data` 对象中,在 `annotations: []` 同级位置追加(找到 data 里 `annotations: [],` 那一行,在其后加):

```javascript
    cardWidth: 0,
    cardHeight: 0,
```

- [ ] **Step 3: 加载批注后量取卡片尺寸**

在 `_loadDetail` 中加载批注的 `setData({ annotations: ... })` 之后(annotations 已渲染),追加一次尺寸量取。找到加载批注的代码块:

```javascript
      try {
        const annoRes = await api.getAnnotations(post.id);
        this.setData({ annotations: annoRes.annotations || [] });
      } catch (e) {
        this.setData({ annotations: [] });
        wx.showToast({ title: '批注加载失败', icon: 'none' });
      }
```

在其后插入:

```javascript
      this._measureCard();
```

- [ ] **Step 4: 新增 _measureCard 与 onAnnotationDragEnd 方法**

在 `onTapAnnotation` 方法之后插入:

```javascript
  _measureCard() {
    const q = wx.createSelectorQuery().in(this);
    q.select('.detail-card').boundingClientRect();
    q.exec((res) => {
      const rect = res[0];
      if (rect) {
        this.setData({ cardWidth: rect.width, cardHeight: rect.height });
      }
    });
  },
  async onAnnotationDragEnd(e) {
    const { id, x, y } = e.detail;
    const { post, currentUserId } = this.data;
    const idx = this.data.annotations.findIndex(a => a.id === id);
    if (idx < 0) return;
    const oldX = this.data.annotations[idx].x;
    const oldY = this.data.annotations[idx].y;
    this.setData({
      [`annotations[${idx}].x`]: x,
      [`annotations[${idx}].y`]: y
    });
    try {
      const res = await api.updateAnnotationPosition(post.id, id, currentUserId, x, y);
      this.setData({ [`annotations[${idx}]`]: res.annotation });
    } catch (error) {
      this.setData({
        [`annotations[${idx}].x`]: oldX,
        [`annotations[${idx}].y`]: oldY
      });
      wx.showToast({ title: error.message || '移动失败', icon: 'none' });
    }
  },
```

- [ ] **Step 5: Commit**

```bash
git add miniprogram/pages/post-detail/post-detail.wxml miniprogram/pages/post-detail/post-detail.js
git commit -m "feat(post-detail): 接入批注拖拽,松手保存坐标并支持回滚"
```

---

## Task 7: 前端完整流程走查(微信开发者工具)

无代码改动,人工验证。打开微信开发者工具,确保后端运行。

- [ ] **Step 1:** 用参与者身份进入一个有自己批注的帖子详情页。
- [ ] **Step 2:** 长按自己的某条批注约 0.5 秒 → 批注放大并出现阴影(进入拖拽态)→ 拖到新位置 → 松手 → 批注停在新位置。
- [ ] **Step 3:** 退出详情页再重进 → 该批注在新位置(已落库)。
- [ ] **Step 4:** 轻点(不长按)任一批注 → 仍弹出作者昵称 + 时间弹层,未触发移动。
- [ ] **Step 5:** 以非楼主身份长按他人批注 → 无拖拽反应;轻点仍可查看。
- [ ] **Step 6:** 以楼主身份长按他人批注 → 可拖动。
- [ ] **Step 7:**(可选)拖动到帖子边缘 → 批注被限制在卡片范围内,不越界。

全部通过即拖拽功能完成。

---

## Self-Review 检查记录

- **Spec 覆盖:** PATCH 接口→Task1;鉴权作者+楼主→Task1(isOwner||isPublisher);坐标校验→Task1;前端封装→Task3;长按拖拽手势/轻点区分→Task4;拖拽态视觉→Task5;松手保存+失败回滚→Task6;测试策略→Task2/7。全覆盖。
- **类型/命名一致:** 组件事件 `dragend`/`tapannotation`(Task4 triggerEvent ↔ Task6 bind);property `currentUserId`/`publisherId`/`cardWidth`/`cardHeight`(Task4 定义 ↔ Task6 传入);页面方法 `onAnnotationDragEnd`/`_measureCard`(Task6 定义 ↔ wxml 绑定)。一致。
- **坐标:** 全链路百分比 0~100,Task4 clamp、Task1 后端校验、Task6 回滚保存一致。
- **权限:** Task4 `canDrag` 前端判定(体验) + Task1 后端 403(真闸门),双重一致。
