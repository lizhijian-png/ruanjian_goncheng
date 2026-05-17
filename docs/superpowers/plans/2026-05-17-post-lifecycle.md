# 帖子生命流程完善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补全帖子状态机的时间驱动逻辑、搭子申请完成功能，以及前端详情页各角色的完整操作按钮。

**Architecture:** 后端新增 `syncPostStatus` 懒更新函数（在每个写接口前调用），新增 `POST /api/posts/:id/start` 和 `POST /api/posts/:id/request-complete` 两个接口，`posts` 表新增 `completionRequests` 字段；前端 `post-detail.js` 重写按钮逻辑，`post-detail.wxml` 补充申请完成展示区和手动开始按钮，`api.js` 新增两个调用函数。

**Tech Stack:** Node.js / Express / MySQL（mysql2）、微信小程序原生框架

---

## 文件结构

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/src/db.js` | 修改 | `mapPost` 新增 `completionRequests` 字段映射；`createTables` 新增兼容性 ALTER |
| `backend/src/server.js` | 修改 | 新增 `syncPostStatus`、`/start`、`/request-complete` 接口；各写接口前调用 `syncPostStatus` |
| `miniprogram/services/api.js` | 修改 | 新增 `startPost`、`requestComplete` 函数 |
| `miniprogram/pages/post-detail/post-detail.js` | 修改 | 重写按钮状态计算逻辑，新增 `startTask`、`requestCompleteTask` 方法 |
| `miniprogram/pages/post-detail/post-detail.wxml` | 修改 | 补充手动开始按钮、申请完成按钮、申请完成展示区 |

---

## Task 1：数据库兼容迁移 — completionRequests 字段

**Files:**
- Modify: `backend/src/db.js:154-166`

- [ ] **Step 1：在 `createTables` 中添加兼容性迁移代码**

在 `backend/src/db.js` 的 `createTables` 函数末尾（`evaluations` 兼容块之后，约第 210 行）添加：

```js
  // 兼容旧表：搭子完成申请记录
  const completionRequestsCol = await query(`SHOW COLUMNS FROM posts LIKE 'completionRequests'`);
  if (completionRequestsCol.length === 0) {
    await query(`ALTER TABLE posts ADD COLUMN completionRequests TEXT NOT NULL DEFAULT '[]'`);
  }
```

- [ ] **Step 2：在 `mapPost` 中新增字段映射**

在 `backend/src/db.js` 的 `mapPost` 函数中，`createdAt` 行之后添加：

```js
    completionRequests: (() => {
      try { return JSON.parse(row.completionRequests || '[]'); } catch { return []; }
    })(),
```

完整的 `mapPost` return 对象末尾应为：

```js
    startTime: row.startTime || null,
    endTime: row.endTime || null,
    createdAt: row.createdAt,
    completionRequests: (() => {
      try { return JSON.parse(row.completionRequests || '[]'); } catch { return []; }
    })(),
```

- [ ] **Step 3：启动后端验证迁移**

```bash
cd backend && node src/server.js
```

预期输出：`Task Buddy backend listening on http://localhost:3000`（无报错）

```bash
curl http://localhost:3000/api/health
```

预期：`{"success":true,"message":"backend is running"}`

- [ ] **Step 4：验证字段已创建**

用 MySQL 客户端或命令行执行：

```sql
SHOW COLUMNS FROM posts LIKE 'completionRequests';
```

预期：返回一行，Type 为 `text`，Default 为 `[]`

- [ ] **Step 5：提交**

```bash
git add backend/src/db.js
git commit -m "feat: posts 表新增 completionRequests 字段"
```

---

## Task 2：后端 — syncPostStatus 懒更新函数

**Files:**
- Modify: `backend/src/server.js`

- [ ] **Step 1：在 `server.js` 中新增 `syncPostStatus` 函数**

在 `getUserById` 函数定义之后（约第 31 行）插入：

```js
async function syncPostStatus(postId) {
  const rows = await query('SELECT * FROM posts WHERE id = ?', [postId]);
  const post = rows[0];
  if (!post) return;

  const now = new Date();

  if (post.status === '招募中') {
    if (post.startTime && now >= new Date(post.startTime) && post.currentBuddies >= 1) {
      await query('UPDATE posts SET status = ? WHERE id = ?', ['进行中', postId]);
    }
    return;
  }

  if (post.status === '进行中') {
    if (post.endTime && now >= new Date(post.endTime)) {
      await query('UPDATE posts SET status = ? WHERE id = ?', ['待评价', postId]);
    }
  }
}
```

- [ ] **Step 2：在 `GET /api/posts/:id` 中调用 syncPostStatus**

找到 `app.get('/api/posts/:id', async (req, res, next) => {`，在 `try {` 之后的第一行插入：

```js
    await syncPostStatus(req.params.id);
```

- [ ] **Step 3：在所有写接口中调用 syncPostStatus**

在以下六个接口的 `try {` 之后的第一行各插入 `await syncPostStatus(req.params.id);`：

- `app.post('/api/posts/:id/join', ...`
- `app.post('/api/posts/:id/quit', ...`
- `app.post('/api/posts/:id/complete', ...`
- `app.post('/api/posts/:id/abandon', ...`
- `app.post('/api/posts/:id/evidence', ...`
- `app.post('/api/posts/:id/evaluate', ...`

- [ ] **Step 4：手动测试懒更新**

创建一个 startTime 在过去的帖子（直接在数据库中修改 startTime 为过去时间，且 currentBuddies >= 1），然后：

```bash
curl http://localhost:3000/api/posts/<帖子ID>
```

预期：返回的 `post.status` 为 `"进行中"`（若之前是 `"招募中"`）

- [ ] **Step 5：提交**

```bash
git add backend/src/server.js
git commit -m "feat: 后端新增 syncPostStatus 懒更新，各写接口前自动同步帖子状态"
```

---

## Task 3：后端 — POST /api/posts/:id/start 接口

**Files:**
- Modify: `backend/src/server.js`

- [ ] **Step 1：在 `server.js` 中新增 /start 接口**

在 `app.post('/api/posts/:id/abandon', ...)` 接口定义之后插入：

```js
app.post('/api/posts/:id/start', async (req, res, next) => {
  try {
    await syncPostStatus(req.params.id);
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ message: '缺少 userId' });
    }

    const rows = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    const post = rows[0];
    if (!post) {
      return res.status(404).json({ message: '帖子不存在' });
    }
    if (post.publisherId !== userId) {
      return res.status(403).json({ message: '只有发布者可以手动开始任务' });
    }
    if (post.status !== '招募中') {
      return res.status(400).json({ message: '只有招募中的任务才能手动开始' });
    }
    if (post.currentBuddies < 1) {
      return res.status(400).json({ message: '至少需要一名搭子才能开始任务' });
    }

    await query('UPDATE posts SET status = ? WHERE id = ?', ['进行中', req.params.id]);

    const freshRows = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    res.json(mapPost(freshRows[0]));
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 2：测试 /start 接口**

```bash
curl -X POST http://localhost:3000/api/posts/<帖子ID>/start \
  -H "Content-Type: application/json" \
  -d '{"userId":"<发布者ID>"}'
```

预期：返回帖子对象，`status` 为 `"进行中"`

测试错误情况（非发布者）：
```bash
curl -X POST http://localhost:3000/api/posts/<帖子ID>/start \
  -H "Content-Type: application/json" \
  -d '{"userId":"<其他用户ID>"}'
```

预期：`{"message":"只有发布者可以手动开始任务"}` HTTP 403

- [ ] **Step 3：提交**

```bash
git add backend/src/server.js
git commit -m "feat: 新增 POST /api/posts/:id/start 发布者手动开始接口"
```

---

## Task 4：后端 — POST /api/posts/:id/request-complete 接口

**Files:**
- Modify: `backend/src/server.js`

- [ ] **Step 1：在 `server.js` 中新增 /request-complete 接口**

在 `/start` 接口之后插入：

```js
app.post('/api/posts/:id/request-complete', async (req, res, next) => {
  try {
    await syncPostStatus(req.params.id);
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ message: '缺少 userId' });
    }

    const rows = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    const post = rows[0];
    if (!post) {
      return res.status(404).json({ message: '帖子不存在' });
    }
    if (post.status !== '进行中') {
      return res.status(400).json({ message: '只有进行中的任务才能申请完成' });
    }

    const buddyRows = await query(
      'SELECT id FROM post_buddies WHERE postId = ? AND userId = ?',
      [req.params.id, userId]
    );
    if (buddyRows.length === 0) {
      return res.status(403).json({ message: '只有搭子才能申请完成' });
    }

    let requests;
    try {
      requests = JSON.parse(post.completionRequests || '[]');
    } catch {
      requests = [];
    }

    if (requests.includes(userId)) {
      return res.status(400).json({ message: '你已申请过完成' });
    }

    requests.push(userId);
    await query(
      'UPDATE posts SET completionRequests = ? WHERE id = ?',
      [JSON.stringify(requests), req.params.id]
    );

    const freshRows = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    res.json(mapPost(freshRows[0]));
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 2：测试 /request-complete 接口**

```bash
curl -X POST http://localhost:3000/api/posts/<帖子ID>/request-complete \
  -H "Content-Type: application/json" \
  -d '{"userId":"<搭子ID>"}'
```

预期：返回帖子对象，`completionRequests` 数组中包含该搭子 ID

测试重复申请：
```bash
curl -X POST http://localhost:3000/api/posts/<帖子ID>/request-complete \
  -H "Content-Type: application/json" \
  -d '{"userId":"<搭子ID>"}'
```

预期：`{"message":"你已申请过完成"}` HTTP 400

测试发布者申请（应被拒绝）：
```bash
curl -X POST http://localhost:3000/api/posts/<帖子ID>/request-complete \
  -H "Content-Type: application/json" \
  -d '{"userId":"<发布者ID>"}'
```

预期：`{"message":"只有搭子才能申请完成"}` HTTP 403

- [ ] **Step 3：提交**

```bash
git add backend/src/server.js
git commit -m "feat: 新增 POST /api/posts/:id/request-complete 搭子申请完成接口"
```

---

## Task 5：前端 api.js — 新增两个调用函数

**Files:**
- Modify: `miniprogram/services/api.js`

- [ ] **Step 1：在 api.js 中新增 startPost 和 requestComplete 函数**

在 `submitEvaluation` 函数定义之后，`module.exports` 之前插入：

```js
function startPost(postId, userId) {
  return request({
    url: `/api/posts/${postId}/start`,
    method: 'POST',
    data: { userId }
  });
}

function requestComplete(postId, userId) {
  return request({
    url: `/api/posts/${postId}/request-complete`,
    method: 'POST',
    data: { userId }
  });
}
```

- [ ] **Step 2：在 module.exports 中导出新函数**

将 `module.exports` 修改为：

```js
module.exports = {
  login,
  bind,
  getFeed,
  getPostDetail,
  getRanking,
  getProfile,
  updateProfile,
  createPost,
  updatePost,
  deletePost,
  completePost,
  submitEvidence,
  joinPost,
  quitPost,
  abandonPost,
  submitEvaluation,
  startPost,
  requestComplete
};
```

- [ ] **Step 3：提交**

```bash
git add miniprogram/services/api.js
git commit -m "feat: api.js 新增 startPost、requestComplete 调用函数"
```

---

## Task 6：前端 post-detail.js — 重写按钮逻辑

**Files:**
- Modify: `miniprogram/pages/post-detail/post-detail.js`

- [ ] **Step 1：扩展 data 初始状态**

将 `Page({` 的 `data` 对象替换为：

```js
  data: {
    post: null,
    evidenceList: [],
    evaluations: [],
    buddies: [],
    hasEvidence: false,
    currentUserId: '',
    isPublisher: false,
    isBuddy: false,
    // 游客
    canJoin: false,
    // 发布者
    canStart: false,
    canMarkDone: false,
    canAbandon: false,
    // 搭子
    canQuit: false,
    canRequestComplete: false,
    hasRequested: false,
    // 共同
    canSubmitEvidence: false,
    canEvaluate: false,
    myEvaluated: false,
    // 申请完成展示
    completionStatusList: [],
    // 表单
    showEvidenceForm: false,
    evidenceInput: '',
    showEvalForm: false,
    evalScore: 5,
    evalContent: ''
  },
```

- [ ] **Step 2：重写 _loadDetail 中的按钮状态计算**

将 `_loadDetail` 方法中从 `const isPublisher = ...` 到 `this.setData({...})` 的部分替换为：

```js
      const { currentUserId } = this.data;
      const isPublisher = post.publisherId === currentUserId;
      const isBuddy = buddies.some(b => b.userId === currentUserId);
      const completionRequests = post.completionRequests || [];

      // 游客
      const canJoin = !isPublisher && !isBuddy && post.status === '招募中' && post.currentBuddies < post.maxBuddies;

      // 发布者
      const canStart = isPublisher && post.status === '招募中' && post.currentBuddies >= 1;
      const canMarkDone = isPublisher && post.status === '进行中';
      const canAbandon = isPublisher && (post.status === '招募中' || post.status === '进行中');

      // 搭子
      const canQuit = isBuddy && (post.status === '招募中' || post.status === '进行中');
      const hasRequested = completionRequests.includes(currentUserId);
      const canRequestComplete = isBuddy && post.status === '进行中' && !hasRequested;

      // 共同（参与者在待评价阶段）
      const isParticipant = isPublisher || isBuddy;
      const myEvaluated = isPublisher
        ? Boolean(post.publisherEvaluated)
        : isBuddy ? Boolean(post.buddyEvaluated) : false;
      const canSubmitEvidence = isParticipant && post.status === '待评价' && !myEvaluated;
      const canEvaluate = isParticipant && post.status === '待评价' && hasEvidence && !myEvaluated;

      // 申请完成展示列表（进行中时，所有搭子的申请状态）
      const completionStatusList = buddies.map(b => ({
        nickname: b.nickname,
        requested: completionRequests.includes(b.userId)
      }));

      this.setData({
        post: {
          ...post,
          startTime: formatTime(post.startTime),
          endTime: formatTime(post.endTime)
        },
        evidenceList, evaluations, buddies, hasEvidence,
        isPublisher, isBuddy,
        canJoin, canStart, canMarkDone, canAbandon,
        canQuit, canRequestComplete, hasRequested,
        canSubmitEvidence, canEvaluate, myEvaluated,
        completionStatusList
      });
```

- [ ] **Step 3：新增 startTask 方法**

在 `markDone` 方法定义之前插入：

```js
  async startTask() {
    const { post, currentUserId } = this.data;
    if (!post || !post.id) return;
    try {
      await api.startPost(post.id, currentUserId);
      wx.showToast({ title: '任务已开始', icon: 'success' });
      await this._loadDetail(post.id);
    } catch (error) {
      wx.showToast({ title: error.message || '操作失败', icon: 'none' });
    }
  },
```

- [ ] **Step 4：新增 requestCompleteTask 方法**

在 `startTask` 方法之后插入：

```js
  async requestCompleteTask() {
    const { post, currentUserId } = this.data;
    if (!post || !post.id) return;
    try {
      await api.requestComplete(post.id, currentUserId);
      wx.showToast({ title: '已申请完成，等待发布者确认', icon: 'success' });
      await this._loadDetail(post.id);
    } catch (error) {
      wx.showToast({ title: error.message || '操作失败', icon: 'none' });
    }
  },
```

- [ ] **Step 5：提交**

```bash
git add miniprogram/pages/post-detail/post-detail.js
git commit -m "feat: post-detail.js 重写按钮状态计算，新增 startTask、requestCompleteTask"
```

---

## Task 7：前端 post-detail.wxml — 补充按钮和展示区

**Files:**
- Modify: `miniprogram/pages/post-detail/post-detail.wxml`

- [ ] **Step 1：替换操作按钮区**

将 `<!-- 操作按钮区 -->` 到 `</view>（action-area 的闭合）` 这一整块替换为：

```xml
    <!-- 操作按钮区 -->
    <view class="action-area">
      <!-- 游客：招募中可加入 -->
      <button wx:if="{{canJoin}}" class="primary-btn action-btn" bindtap="joinTask">加入任务</button>

      <!-- 发布者：招募中且有搭子可手动开始 -->
      <button wx:if="{{canStart}}" class="primary-btn action-btn" bindtap="startTask">手动开始任务</button>

      <!-- 发布者：进行中可标记完成 -->
      <button wx:if="{{canMarkDone}}" class="primary-btn action-btn" bindtap="markDone">标记完成 → 进入待评价</button>

      <!-- 发布者/搭子：可放弃 -->
      <button wx:if="{{canAbandon}}" class="danger-btn action-btn" bindtap="abandonTask">放弃任务</button>

      <!-- 搭子：招募中或进行中可退出 -->
      <button wx:if="{{canQuit}}" class="ghost-btn action-btn" bindtap="quitTask">退出任务</button>

      <!-- 搭子：进行中未申请可申请完成 -->
      <button wx:if="{{canRequestComplete}}" class="ghost-btn action-btn" bindtap="requestCompleteTask">申请完成</button>
      <!-- 搭子：已申请完成（灰色不可点） -->
      <button wx:if="{{isBuddy && post.status === '进行中' && hasRequested}}" class="ghost-btn action-btn" disabled>已申请完成</button>

      <!-- 参与者：待评价可提交证据 -->
      <button wx:if="{{canSubmitEvidence && !showEvidenceForm}}" class="ghost-btn action-btn" bindtap="openEvidenceForm">+ 提交文字证据</button>

      <!-- 参与者：待评价可提交互评 -->
      <button wx:if="{{canEvaluate}}" class="primary-btn action-btn" bindtap="openEvalForm">提交互评</button>

      <!-- 已评价提示 -->
      <view wx:if="{{(isPublisher || isBuddy) && post.status === '待评价' && myEvaluated}}" class="eval-done-hint">你已提交评价，等待对方评价中…</view>
    </view>
```

- [ ] **Step 2：在搭子列表之后、操作按钮区之前插入申请完成展示区**

在 `<!-- 操作按钮区 -->` 注释之前插入：

```xml
    <!-- 申请完成进度（进行中状态，所有角色可见） -->
    <view wx:if="{{post.status === '进行中' && buddies.length > 0}}" class="section-title detail-section">完成申请进度</view>
    <view wx:if="{{post.status === '进行中' && buddies.length > 0}}" class="completion-requests">
      <view wx:for="{{completionStatusList}}" wx:key="nickname" class="completion-request-item">
        <view class="buddy-name">{{item.nickname}}</view>
        <view class="{{item.requested ? 'request-done' : 'request-pending'}}">{{item.requested ? '✓ 已申请' : '— 未申请'}}</view>
      </view>
    </view>
```

- [ ] **Step 3：将原有证据提交入口移入操作按钮区（已在 Step 1 处理），删除原位置的证据入口**

找到并删除以下代码块（在"完成证据"区域上方或下方的独立入口，约在原 wxml 第 62-64 行）：

```xml
    <!-- 提交证据入口 -->
    <view wx:if="{{canSubmitEvidence && !showEvidenceForm}}" class="evidence-submit-entry">
      <button class="ghost-btn action-btn" bindtap="openEvidenceForm">+ 提交文字证据</button>
    </view>
```

- [ ] **Step 4：提交**

```bash
git add miniprogram/pages/post-detail/post-detail.wxml
git commit -m "feat: post-detail.wxml 补充手动开始、申请完成按钮及申请进度展示区"
```

---

## Task 8：验证完整流程

- [ ] **Step 1：启动后端**

```bash
cd backend && node src/server.js
```

预期：`Task Buddy backend listening on http://localhost:3000`

- [ ] **Step 2：逐一验证状态流转**

在微信开发者工具中，用两个测试用户（发布者 A、搭子 B）验证以下路径：

| 操作 | 预期结果 |
|------|---------|
| A 创建帖子（设置 startTime 为 1 分钟后） | 状态：招募中，无"手动开始"按钮（无搭子） |
| B 加入帖子 | 状态：招募中，A 看到"手动开始"按钮 |
| A 点击"手动开始" | 状态变为进行中，A 看到"标记完成"和"放弃任务" |
| B 看到"申请完成"按钮，点击 | completionStatusList 显示 B 已申请，B 按钮变灰 |
| A 点击"标记完成" | 状态变为待评价 |
| A 和 B 各提交证据、互评 | 状态最终变为已完成 |

- [ ] **Step 3：验证时间驱动（懒更新）**

直接在数据库修改一个招募中帖子的 startTime 为过去时间（且 currentBuddies >= 1），再访问该帖子详情：

```sql
UPDATE posts SET startTime = '2020-01-01 00:00:00' WHERE id = '<帖子ID>';
```

```bash
curl http://localhost:3000/api/posts/<帖子ID>
```

预期：返回 `status: "进行中"`

- [ ] **Step 4：最终提交（如有未提交文件）**

```bash
git status
git add .
git commit -m "feat: 帖子生命流程完善 — 懒更新、手动开始、申请完成、按钮矩阵"
```
