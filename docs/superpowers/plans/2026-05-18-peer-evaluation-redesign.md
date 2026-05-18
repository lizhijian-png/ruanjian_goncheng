# 多对多互评系统重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将原来"每人对整个帖子提交一条评价"改为多对多互评，每位参与者可自由选择对哪些其他参与者评价；任务完成由 32 小时 evaluationDeadline 驱动，不再依赖所有人评价完。

**Architecture:** 在数据库层面给 evaluations 表加 toId 字段、posts 加 evaluationDeadline、users 加 avgScore；删除旧的 publisherEvaluated/post_buddies.evaluated 标志位；syncPostStatus 负责 deadline 到期后自动完成并结算；前端新增人员选择弹出层替代原来的单一评价表单。

**Tech Stack:** Node.js/Express (backend/src/server.js), MySQL (backend/src/db.js), 微信小程序原生框架 (miniprogram/pages/post-detail/)

---

## 文件变更一览

| 文件 | 操作 |
|------|------|
| `backend/src/db.js` | 修改：迁移脚本加 toId/evaluationDeadline/avgScore，删除旧标志位迁移，mapPost 清理 |
| `backend/src/server.js` | 修改：syncPostStatus、/evaluate、/posts/:id GET，新增 /users/:id/evaluations-received |
| `miniprogram/services/api.js` | 修改：submitEvaluation 加 toId，getPostDetail 加 viewerId，新增 getEvaluationsReceived |
| `miniprogram/pages/post-detail/post-detail.js` | 修改：移除旧评价逻辑，新增人员选择弹层状态与提交逻辑 |
| `miniprogram/pages/post-detail/post-detail.wxml` | 修改：替换旧评价表单为人员选择弹层 + 评价表单 + 双栏展示 |
| `miniprogram/pages/post-detail/post-detail.wxss` | 修改：新增人员选择弹层样式 |

---

## Task 1: 数据库迁移 — 新增字段，删除旧标志位

**Files:**
- Modify: `backend/src/db.js`

- [ ] **Step 1: 在 createTables 末尾追加迁移脚本**

在 `backend/src/db.js` 的 `createTables` 函数末尾（第 253 行 `}` 之前）添加：

```js
  // 迁移：evaluations 加 toId（被评价者）
  const evalToIdCol = await query(`SHOW COLUMNS FROM evaluations LIKE 'toId'`);
  if (evalToIdCol.length === 0) {
    await query(`ALTER TABLE evaluations ADD COLUMN toId VARCHAR(64) NOT NULL DEFAULT '' AFTER fromId`);
    await query(`ALTER TABLE evaluations ADD UNIQUE KEY uq_eval_from_to (postId, fromId, toId)`);
  }

  // 迁移：posts 加 evaluationDeadline
  const evalDeadlineCol = await query(`SHOW COLUMNS FROM posts LIKE 'evaluationDeadline'`);
  if (evalDeadlineCol.length === 0) {
    await query(`ALTER TABLE posts ADD COLUMN evaluationDeadline DATETIME DEFAULT NULL`);
  }

  // 迁移：users 加 avgScore
  const avgScoreCol = await query(`SHOW COLUMNS FROM users LIKE 'avgScore'`);
  if (avgScoreCol.length === 0) {
    await query(`ALTER TABLE users ADD COLUMN avgScore DECIMAL(3,1) DEFAULT NULL`);
  }
```

- [ ] **Step 2: 在 mapPost 中删除 publisherEvaluated/buddyEvaluated，加 evaluationDeadline**

在 `backend/src/db.js` 的 `mapPost` 函数（第 32-59 行）中：

将：
```js
    publisherEvaluated: Boolean(row.publisherEvaluated),
    buddyEvaluated: Boolean(row.buddyEvaluated),
```
替换为：
```js
    evaluationDeadline: row.evaluationDeadline || null,
```

- [ ] **Step 3: 重启后端验证迁移无报错**

```bash
cd backend && node src/server.js
```
预期：启动日志无 ALTER 错误，数据库正常连接。Ctrl+C 停止。

- [ ] **Step 4: Commit**

```bash
git add backend/src/db.js
git commit -m "feat: db migration — add toId, evaluationDeadline, avgScore; drop old eval flags from mapPost"
```

---

## Task 2: syncPostStatus — 写 evaluationDeadline，到期自动完成并结算

**Files:**
- Modify: `backend/src/server.js:33-52`

- [ ] **Step 1: 替换 syncPostStatus 函数**

将 `backend/src/server.js` 第 33-52 行整个 `syncPostStatus` 函数替换为：

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
      const deadline = new Date(now.getTime() + 32 * 60 * 60 * 1000);
      await query(
        'UPDATE posts SET status = ?, evaluationDeadline = ? WHERE id = ?',
        ['待评价', deadline, postId]
      );
    }
    return;
  }

  if (post.status === '待评价') {
    if (post.evaluationDeadline && now >= new Date(post.evaluationDeadline)) {
      await settlePost(postId);
    }
  }
}
```

- [ ] **Step 2: 在 syncPostStatus 下方新增 settlePost 辅助函数**

紧接着 `syncPostStatus` 函数之后，在第 53 行之前插入：

```js
async function settlePost(postId) {
  const rows = await query('SELECT * FROM posts WHERE id = ?', [postId]);
  const post = rows[0];
  if (!post || post.status !== '待评价') return;

  const allBuddies = await query('SELECT userId FROM post_buddies WHERE postId = ?', [postId]);
  await withTransaction(async (connection) => {
    await connection.execute(
      'UPDATE posts SET status = ?, progress = 100 WHERE id = ?',
      ['已完成', postId]
    );
    await connection.execute(
      'UPDATE users SET points = points + ? WHERE id = ?',
      [post.reward, post.publisherId]
    );
    for (const buddy of allBuddies) {
      await connection.execute(
        'UPDATE users SET points = points + ? WHERE id = ?',
        [post.reward, buddy.userId]
      );
    }
  });
  await recalcCompletionRate(post.publisherId);
}
```

- [ ] **Step 3: 手动测试 syncPostStatus 逻辑**

启动后端，用 curl 或 Postman 将一个进行中帖子的 endTime 设为过去时间，然后访问该帖详情，确认：
- 状态变为"待评价"
- evaluationDeadline 不为 null

- [ ] **Step 4: Commit**

```bash
git add backend/src/server.js
git commit -m "feat: syncPostStatus writes evaluationDeadline on → 待评价; settlePost handles deadline expiry"
```

---

## Task 3: 修改 /evaluate 端点 — 多对多，防重，更新 avgScore

**Files:**
- Modify: `backend/src/server.js` (evaluate endpoint, ~lines 669-777)

- [ ] **Step 1: 完整替换 /evaluate 端点**

找到 `app.post('/api/posts/:id/evaluate'` 到其对应 `});` 的全部内容，替换为：

```js
app.post('/api/posts/:id/evaluate', async (req, res, next) => {
  try {
    await syncPostStatus(req.params.id);
    const { userId, toId, score, content } = req.body;
    if (!userId || !toId || !score || !String(content || '').trim()) {
      return res.status(400).json({ message: '缺少 userId、toId、score 或评价内容' });
    }
    const s = Number(score);
    if (!Number.isInteger(s) || s < 1 || s > 5) {
      return res.status(400).json({ message: '评分须为 1-5 的整数' });
    }
    if (userId === toId) {
      return res.status(400).json({ message: '不能评价自己' });
    }

    const postRows = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    const post = postRows[0];
    if (!post) return res.status(404).json({ message: '帖子不存在' });
    if (post.status !== '待评价') {
      return res.status(400).json({ message: '只有待评价状态的任务才能提交互评' });
    }

    // 校验 fromId 是参与者
    const allBuddies = await query('SELECT userId FROM post_buddies WHERE postId = ?', [req.params.id]);
    const participantIds = new Set([post.publisherId, ...allBuddies.map(b => b.userId)]);
    if (!participantIds.has(userId)) {
      return res.status(403).json({ message: '只有参与者才能提交互评' });
    }
    // 校验 toId 是参与者
    if (!participantIds.has(toId)) {
      return res.status(400).json({ message: '被评价者不是该任务参与者' });
    }

    // 防重复：同一 (postId, fromId, toId) 只能提交一次
    const existing = await query(
      'SELECT id FROM evaluations WHERE postId = ? AND fromId = ? AND toId = ?',
      [req.params.id, userId, toId]
    );
    if (existing.length > 0) {
      return res.status(400).json({ message: '你已经评价过该参与者了' });
    }

    const user = await getUserById(userId);
    const evalId = createId('ev');
    await query(
      'INSERT INTO evaluations (id, postId, fromId, fromName, toId, score, content) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [evalId, req.params.id, userId, user.nickname, toId, s, String(content).trim()]
    );

    // 更新被评价者的平均分
    await updateUserAvgScore(toId);

    const finalPost = (await query('SELECT * FROM posts WHERE id = ?', [req.params.id]))[0];
    res.status(201).json({ post: mapPost(finalPost) });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 2: 在 recalcCompletionRate 下方添加 updateUserAvgScore**

在 `recalcCompletionRate` 函数（约 779 行）之后添加：

```js
async function updateUserAvgScore(userId) {
  const rows = await query(
    'SELECT AVG(score) AS avg FROM evaluations WHERE toId = ?',
    [userId]
  );
  const avg = rows[0] && rows[0].avg != null ? Number(rows[0].avg).toFixed(1) : null;
  await query('UPDATE users SET avgScore = ? WHERE id = ?', [avg, userId]);
}
```

- [ ] **Step 3: 删除旧的积分结算逻辑**

旧的"所有参与者都评价完才完成"的代码块已在上一步替换中消失。确认新 /evaluate 端点中**没有**对 `publisherEvaluated`、`post_buddies.evaluated` 的任何读写。

- [ ] **Step 4: Commit**

```bash
git add backend/src/server.js
git commit -m "feat: rewrite /evaluate for many-to-many; add updateUserAvgScore; settle via deadline only"
```

---

## Task 4: 修改 GET /api/posts/:id — 按 viewerId 过滤评价可见性

**Files:**
- Modify: `backend/src/server.js` (GET /api/posts/:id, ~lines 253-300)

- [ ] **Step 1: 修改帖子详情端点**

找到 `app.get('/api/posts/:id'` 端点，将 evidenceList/evaluations 查询和响应部分改为：

```js
app.get('/api/posts/:id', async (req, res, next) => {
  try {
    await syncPostStatus(req.params.id);
    const postRows = await query(
      `SELECT p.*, u.avatarUrl AS publisherAvatarUrl,
              u.completionRate AS publisherCompletionRate,
              u.points AS publisherPoints
       FROM posts p LEFT JOIN users u ON p.publisherId = u.id
       WHERE p.id = ?`,
      [req.params.id]
    );
    const postRow = postRows[0];
    if (!postRow) return res.status(404).json({ message: '帖子不存在' });

    const evidenceList = await query(
      'SELECT submitterId, submitterName, type, value FROM evidences WHERE postId = ? ORDER BY createdAt ASC',
      [req.params.id]
    );
    const buddies = await query(
      'SELECT userId, nickname, joinedAt FROM post_buddies WHERE postId = ? ORDER BY joinedAt ASC',
      [req.params.id]
    );

    const viewerId = req.query.viewerId || '';
    let evaluationsSent = [];
    let evaluationsReceived = [];
    if (viewerId) {
      evaluationsSent = await query(
        `SELECT e.toId, u.nickname AS toName, e.score, e.content, e.createdAt
         FROM evaluations e LEFT JOIN users u ON e.toId = u.id
         WHERE e.postId = ? AND e.fromId = ? ORDER BY e.createdAt ASC`,
        [req.params.id, viewerId]
      );
      evaluationsReceived = await query(
        `SELECT e.fromId, e.fromName, e.score, e.content, e.createdAt
         FROM evaluations e
         WHERE e.postId = ? AND e.toId = ? ORDER BY e.createdAt ASC`,
        [req.params.id, viewerId]
      );
    }

    const participantIds = new Set([postRow.publisherId, ...buddies.map(b => b.userId)]);
    const evidenceSubmitters = new Set(evidenceList.map(e => e.submitterId));
    const hasEvidence = participantIds.size > 0 && [...participantIds].every(id => evidenceSubmitters.has(id));

    const publisherUser = postRow.publisherCompletionRate != null
      ? { completionRate: postRow.publisherCompletionRate, points: postRow.publisherPoints }
      : null;
    const dynamicScore = calcRecommendedScore(postRow, publisherUser, null);

    return res.json({
      post: { ...mapPost(postRow), recommendedScore: dynamicScore },
      evidenceList,
      buddies,
      hasEvidence,
      evaluationsSent,
      evaluationsReceived
    });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 2: 新增 GET /api/users/:id/evaluations-received**

在 /evaluate 端点之后（约 777 行）添加：

```js
app.get('/api/users/:id/evaluations-received', async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT e.postId, e.fromId, e.fromName, e.score, e.content, e.createdAt
       FROM evaluations e
       WHERE e.toId = ? ORDER BY e.createdAt DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 3: 验证接口**

```bash
# 假设有帖子 id=xxx，用户 viewerId=yyy
curl "http://localhost:3000/api/posts/xxx?viewerId=yyy"
```
预期响应包含 `evaluationsSent`、`evaluationsReceived` 两个数组，且不含其他人之间的评价。

- [ ] **Step 4: Commit**

```bash
git add backend/src/server.js
git commit -m "feat: GET /posts/:id filters evaluations by viewerId; add GET /users/:id/evaluations-received"
```

---

## Task 5: 前端 api.js — 更新调用签名

**Files:**
- Modify: `miniprogram/services/api.js`

- [ ] **Step 1: 修改 getPostDetail，加 viewerId 参数**

将：
```js
function getPostDetail(id) {
  return request({ url: `/api/posts/${id}` });
}
```
替换为：
```js
function getPostDetail(id, viewerId) {
  const qs = viewerId ? `?viewerId=${encodeURIComponent(viewerId)}` : '';
  return request({ url: `/api/posts/${id}${qs}` });
}
```

- [ ] **Step 2: 修改 submitEvaluation，加 toId 参数**

将：
```js
function submitEvaluation(postId, userId, score, content) {
  return request({
    url: `/api/posts/${postId}/evaluate`,
    method: 'POST',
    data: { userId, score, content }
  });
}
```
替换为：
```js
function submitEvaluation(postId, userId, toId, score, content) {
  return request({
    url: `/api/posts/${postId}/evaluate`,
    method: 'POST',
    data: { userId, toId, score, content }
  });
}
```

- [ ] **Step 3: 新增 getEvaluationsReceived**

在 `module.exports` 之前添加：
```js
function getEvaluationsReceived(userId) {
  return request({ url: `/api/users/${userId}/evaluations-received` });
}
```

在 `module.exports` 对象中加入：
```js
  getEvaluationsReceived,
```

- [ ] **Step 4: Commit**

```bash
git add miniprogram/services/api.js
git commit -m "feat: update api.js — getPostDetail accepts viewerId, submitEvaluation accepts toId, add getEvaluationsReceived"
```

---

## Task 6: 前端 post-detail.js — 新增人员选择弹层逻辑

**Files:**
- Modify: `miniprogram/pages/post-detail/post-detail.js`

- [ ] **Step 1: 替换 data 初始化块**

将 `data: { ... }` 整个块替换为：

```js
  data: {
    post: null,
    evidenceList: [],
    evaluationsSent: [],
    evaluationsReceived: [],
    buddies: [],
    hasEvidence: false,
    currentUserId: '',
    isPublisher: false,
    isBuddy: false,
    canJoin: false,
    canStart: false,
    canMarkDone: false,
    canAbandon: false,
    canQuit: false,
    canRequestComplete: false,
    hasRequested: false,
    canSubmitEvidence: false,
    canEvaluate: false,
    completionStatusList: [],
    evalDeadlineText: '',
    // 证据表单
    showEvidenceForm: false,
    evidenceInput: '',
    // 人员选择弹层
    showPersonPicker: false,
    evalTargets: [],       // [{ userId, nickname, evaluated: bool }]
    // 评价表单
    showEvalForm: false,
    evalTargetId: '',
    evalTargetName: '',
    evalScore: 5,
    evalContent: ''
  },
```

- [ ] **Step 2: 替换 _loadDetail 函数**

将整个 `_loadDetail` 函数替换为：

```js
  async _loadDetail(postId) {
    try {
      const { currentUserId } = this.data;
      const detail = await api.getPostDetail(postId || this.data.post.id, currentUserId);
      const { post, evidenceList, evaluationsSent = [], evaluationsReceived = [], buddies = [], hasEvidence = false } = detail;
      const isPublisher = post.publisherId === currentUserId;
      const isBuddy = buddies.some(b => b.userId === currentUserId);
      const completionRequests = post.completionRequests || [];

      const canJoin = !isPublisher && !isBuddy && post.status === '招募中' && post.currentBuddies < post.maxBuddies;
      const canStart = isPublisher && post.status === '招募中' && post.currentBuddies >= 1;
      const canMarkDone = isPublisher && post.status === '进行中';
      const canAbandon = isPublisher && (post.status === '招募中' || post.status === '进行中');
      const canQuit = isBuddy && (post.status === '招募中' || post.status === '进行中');
      const hasRequested = completionRequests.includes(currentUserId);
      const canRequestComplete = isBuddy && post.status === '进行中' && !hasRequested;
      const isParticipant = isPublisher || isBuddy;
      const canSubmitEvidence = isParticipant && post.status === '待评价';
      const canEvaluate = isParticipant && post.status === '待评价';

      // deadline 倒计时文字
      let evalDeadlineText = '';
      if (post.status === '待评价' && post.evaluationDeadline) {
        const diff = new Date(post.evaluationDeadline) - new Date();
        if (diff > 0) {
          const h = Math.floor(diff / 3600000);
          const m = Math.floor((diff % 3600000) / 60000);
          evalDeadlineText = `还有 ${h} 小时 ${m} 分钟`;
        } else {
          evalDeadlineText = '评价窗口已结束';
        }
      }

      // 人员选择列表：我已评价过的 toId 集合
      const evaluatedToIds = new Set(evaluationsSent.map(e => e.toId));
      const others = isPublisher
        ? buddies
        : [{ userId: post.publisherId, nickname: post.publisher }, ...buddies.filter(b => b.userId !== currentUserId)];
      const evalTargets = others.map(p => ({
        userId: p.userId,
        nickname: p.nickname,
        evaluated: evaluatedToIds.has(p.userId)
      }));

      const completionStatusList = buddies.map(b => ({
        userId: b.userId,
        nickname: b.nickname,
        requested: completionRequests.includes(b.userId)
      }));

      this.setData({
        post: { ...post, startTime: formatTime(post.startTime), endTime: formatTime(post.endTime) },
        evidenceList, evaluationsSent, evaluationsReceived, buddies, hasEvidence,
        isPublisher, isBuddy,
        canJoin, canStart, canMarkDone, canAbandon,
        canQuit, canRequestComplete, hasRequested,
        canSubmitEvidence, canEvaluate,
        completionStatusList, evalDeadlineText, evalTargets
      });
    } catch (error) {
      wx.showToast({ title: error.message || '加载详情失败', icon: 'none' });
    }
  },
```

- [ ] **Step 3: 替换评价相关方法**

删除旧的 `openEvalForm`、`closeEvalForm`、`onEvalScoreChange`、`onEvalContentInput`、`submitEvaluation` 五个方法，替换为：

```js
  openPersonPicker() {
    this.setData({ showPersonPicker: true });
  },
  closePersonPicker() {
    this.setData({ showPersonPicker: false });
  },
  openEvalFormForPerson(e) {
    const { userid, nickname, evaluated } = e.currentTarget.dataset;
    if (evaluated) return;
    this.setData({
      showPersonPicker: false,
      showEvalForm: true,
      evalTargetId: userid,
      evalTargetName: nickname,
      evalScore: 5,
      evalContent: ''
    });
  },
  closeEvalForm() {
    this.setData({ showEvalForm: false, evalTargetId: '', evalTargetName: '' });
  },
  onEvalScoreChange(e) {
    this.setData({ evalScore: Number(e.detail.value) });
  },
  onEvalContentInput(e) {
    this.setData({ evalContent: e.detail.value });
  },
  async submitEvaluation() {
    const { post, currentUserId, evalTargetId, evalScore, evalContent } = this.data;
    if (!String(evalContent).trim()) {
      wx.showToast({ title: '请填写评价内容', icon: 'none' });
      return;
    }
    try {
      await api.submitEvaluation(post.id, currentUserId, evalTargetId, evalScore, evalContent);
      wx.showToast({ title: '评价已提交', icon: 'success' });
      this.setData({ showEvalForm: false, evalTargetId: '', evalTargetName: '' });
      await this._loadDetail(post.id);
    } catch (error) {
      wx.showToast({ title: error.message || '提交失败', icon: 'none' });
    }
  },
  backToPersonPicker() {
    this.setData({ showEvalForm: false, showPersonPicker: true });
  },
```

- [ ] **Step 4: Commit**

```bash
git add miniprogram/pages/post-detail/post-detail.js
git commit -m "feat: post-detail.js — person picker logic, per-person eval form, deadline countdown"
```

---

## Task 7: 前端 post-detail.wxml — 替换评价 UI

**Files:**
- Modify: `miniprogram/pages/post-detail/post-detail.wxml`

- [ ] **Step 1: 替换操作按钮区中评价相关按钮**

找到操作按钮区中：
```xml
      <!-- 参与者：待评价可提交互评 -->
      <button wx:if="{{canEvaluate}}" class="primary-btn action-btn" bindtap="openEvalForm">提交互评</button>

      <!-- 已评价提示 -->
      <view wx:if="{{(isPublisher || isBuddy) && post.status === '待评价' && myEvaluated}}" class="eval-done-hint">你已提交评价，等待对方评价中…</view>
```
替换为：
```xml
      <!-- 参与者：待评价可评价他人 -->
      <view wx:if="{{canEvaluate}}" class="eval-deadline-hint">评价窗口：{{evalDeadlineText}}</view>
      <button wx:if="{{canEvaluate}}" class="primary-btn action-btn" bindtap="openPersonPicker">评价</button>
```

- [ ] **Step 2: 删除旧的互评表单，替换为人员选择弹层 + 评价表单**

找到并删除：
```xml
    <!-- 互评表单 -->
    <view wx:if="{{showEvalForm}}" class="eval-form">
      ...（整个 eval-form block）...
    </view>
```

在证据表单 `</view>` 之后（`showEvidenceForm` block 结束后）插入：

```xml
    <!-- 人员选择弹层 -->
    <view wx:if="{{showPersonPicker}}" class="person-picker-overlay">
      <view class="person-picker-panel">
        <view class="person-picker-title">选择要评价的人</view>
        <block wx:for="{{evalTargets}}" wx:key="userId">
          <view
            class="person-picker-item {{item.evaluated ? 'person-evaluated' : ''}}"
            bindtap="openEvalFormForPerson"
            data-userid="{{item.userId}}"
            data-nickname="{{item.nickname}}"
            data-evaluated="{{item.evaluated}}"
          >
            <view class="person-name">{{item.nickname}}</view>
            <view class="person-status">{{item.evaluated ? '已评价' : '未评价'}}</view>
          </view>
        </block>
        <button class="ghost-btn person-picker-close" bindtap="closePersonPicker">关闭</button>
      </view>
    </view>

    <!-- 评价表单（对某人） -->
    <view wx:if="{{showEvalForm}}" class="eval-form">
      <view class="section-title">评价 {{evalTargetName}}</view>
      <view class="eval-score-row">
        <view class="label">评分：{{evalScore}} 分</view>
        <slider
          class="eval-slider"
          min="1" max="5" step="1"
          value="{{evalScore}}"
          show-value="{{false}}"
          activeColor="#f97316"
          bindchange="onEvalScoreChange"
        />
      </view>
      <view class="label">评价内容</view>
      <textarea
        class="evidence-textarea"
        placeholder="描述对方的完成情况和配合度..."
        placeholder-class="placeholder"
        bindinput="onEvalContentInput"
        value="{{evalContent}}"
      />
      <view class="evidence-form-btns">
        <button class="ghost-btn evidence-btn" bindtap="backToPersonPicker">返回</button>
        <button class="primary-btn evidence-btn" bindtap="submitEvaluation">提交</button>
      </view>
    </view>
```

- [ ] **Step 3: 替换互评记录展示区**

找到：
```xml
    <!-- 互评记录 -->
    <view class="section-title detail-section">互评记录</view>
    <view wx:if="{{evaluations.length === 0}}" class="muted empty-hint">暂无评价</view>
    <block wx:for="{{evaluations}}" wx:key="from">
      <view class="evaluation-item">
        <view class="evaluation-head">{{item.from}} · {{item.score}} / 5</view>
        <view class="muted">{{item.content}}</view>
      </view>
    </block>
```
替换为：
```xml
    <!-- 我对他人的评价 -->
    <view wx:if="{{isPublisher || isBuddy}}" class="section-title detail-section">我对他人的评价</view>
    <view wx:if="{{(isPublisher || isBuddy) && evaluationsSent.length === 0}}" class="muted empty-hint">暂未评价任何人</view>
    <block wx:for="{{evaluationsSent}}" wx:key="toId">
      <view class="evaluation-item">
        <view class="evaluation-head">对 {{item.toName}} · {{item.score}} / 5</view>
        <view class="muted">{{item.content}}</view>
      </view>
    </block>

    <!-- 他人对我的评价 -->
    <view wx:if="{{isPublisher || isBuddy}}" class="section-title detail-section">他人对我的评价</view>
    <view wx:if="{{(isPublisher || isBuddy) && evaluationsReceived.length === 0}}" class="muted empty-hint">暂无他人评价</view>
    <block wx:for="{{evaluationsReceived}}" wx:key="fromId">
      <view class="evaluation-item">
        <view class="evaluation-head">{{item.fromName}} · {{item.score}} / 5</view>
        <view class="muted">{{item.content}}</view>
      </view>
    </block>
```

- [ ] **Step 4: Commit**

```bash
git add miniprogram/pages/post-detail/post-detail.wxml
git commit -m "feat: post-detail.wxml — person picker overlay, per-person eval form, split sent/received eval display"
```

---

## Task 8: 前端 post-detail.wxss — 新增人员选择弹层样式

**Files:**
- Modify: `miniprogram/pages/post-detail/post-detail.wxss`

- [ ] **Step 1: 在文件末尾追加样式**

```css
/* ===== 评价 deadline 提示 ===== */
.eval-deadline-hint {
  text-align: center;
  font-size: 24rpx;
  color: #f97316;
  padding: 8rpx 0;
}

/* ===== 人员选择弹层 ===== */
.person-picker-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 100;
  display: flex;
  align-items: flex-end;
}

.person-picker-panel {
  width: 100%;
  background: #fff;
  border-radius: 32rpx 32rpx 0 0;
  padding: 32rpx 32rpx 48rpx;
}

.person-picker-title {
  font-size: 32rpx;
  font-weight: 700;
  margin-bottom: 24rpx;
  text-align: center;
}

.person-picker-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 28rpx 24rpx;
  border-radius: 22rpx;
  background: rgba(255, 255, 255, 0.88);
  border: 1rpx solid rgba(255, 122, 89, 0.15);
  margin-bottom: 16rpx;
}

.person-picker-item.person-evaluated {
  opacity: 0.5;
}

.person-name {
  font-size: 30rpx;
  font-weight: 600;
}

.person-status {
  font-size: 24rpx;
  color: #94a3b8;
}

.person-picker-close {
  margin-top: 16rpx;
  width: 100%;
  height: 80rpx;
}
```

- [ ] **Step 2: Commit**

```bash
git add miniprogram/pages/post-detail/post-detail.wxss
git commit -m "feat: post-detail.wxss — person picker overlay and deadline hint styles"
```

---

## Task 9: 端到端验收测试

- [ ] **Step 1: 启动后端**

```bash
cd backend && node src/server.js
```

- [ ] **Step 2: 在微信开发者工具中打开一个"待评价"状态的帖子，用以下场景验收**

| 场景 | 预期结果 |
|------|---------|
| 以参与者身份进入帖子 | 出现"评价"按钮，按钮下方显示倒计时 |
| 点击"评价"按钮 | 弹出人员选择面板，列出所有其他参与者，各自标注"未评价" |
| 点击某人 | 跳转到评价表单，标题显示"评价 XXX" |
| 填写评分和内容后提交 | Toast 提示成功，返回人员选择面板，该人状态变为"已评价" |
| 再次点击已评价的人 | 不打开表单（item disabled） |
| 以非参与者身份进入帖子 | 不出现"评价"按钮，不出现评价展示区 |
| 帖子详情"我对他人的评价"栏 | 只显示自己发出的评价 |
| "他人对我的评价"栏 | 只显示收到自己的评价 |
| evaluationDeadline 到期后刷新帖子 | 状态变为"已完成"，积分已结算 |
| GET /api/users/:id/evaluations-received | 返回该用户收到的所有评价列表 |

- [ ] **Step 3: 确认数据库中 users.avgScore 有更新**

```sql
SELECT id, nickname, avgScore FROM users WHERE avgScore IS NOT NULL;
```
预期：被评价过的用户有非 NULL 的 avgScore 值。

- [ ] **Step 4: 最终 Commit（如有遗漏调整）**

```bash
git add -p
git commit -m "fix: post-eval e2e adjustments after manual testing"
```
