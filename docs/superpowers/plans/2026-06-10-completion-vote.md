# 任务完成投票机制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在评价页面为每个被评价人新增"完成/未完成"投票按钮，由其他参与者投票决定每人是否完成任务，结果分别影响各人的积分和完成率。

**Architecture:** 新增 `completion_votes` 表存储投票记录；`post_buddies` 加 `isComplete` 字段、`posts` 加 `publisherComplete` 字段记录结算结果；`settlePost` 改为逐人判定；`recalcCompletionRate` 扩展为统计发布者+搭子两种身份；前端评价页新增投票 UI，与评价提交独立。

**Tech Stack:** Node.js/Express + MySQL (mysql2) 后端；微信小程序前端（WXML/WXSS/JS）；无新依赖。

---

## 文件变更总览

| 文件 | 操作 |
|------|------|
| `backend/src/db.js` | 修改：在 `createTables()` 中新增 `completion_votes` 表，为 `post_buddies` 加 `isComplete` 列，为 `posts` 加 `publisherComplete` 列 |
| `backend/src/server.js` | 修改：新增 `POST /api/posts/:id/completion-vote` 路由；修改 `GET /api/posts/:id` 返回 `myCompletionVotes`；重写 `settlePost`；重写 `recalcCompletionRate` |
| `miniprogram/services/api.js` | 修改：新增 `submitCompletionVote` 函数，更新 `module.exports` |
| `miniprogram/pages/evaluate/evaluate.js` | 修改：加载 `myCompletionVotes`，新增 `onVoteComplete` 处理函数 |
| `miniprogram/pages/evaluate/evaluate.wxml` | 修改：在评价卡片内新增完成投票区域 |
| `miniprogram/pages/evaluate/evaluate.wxss` | 修改：新增投票按钮样式 |

---

## Task 1: 数据库迁移 — 新增表和字段

**Files:**
- Modify: `backend/src/db.js:175-310`

- [ ] **Step 1: 在 `createTables()` 末尾追加 completion_votes 表创建语句**

在 `db.js` 末尾 `annotations` 表创建之后、函数关闭 `}` 之前，添加：

```javascript
  // completion_votes 表：记录参与者对他人完成情况的投票
  await query(`
    CREATE TABLE IF NOT EXISTS completion_votes (
      id        VARCHAR(64) PRIMARY KEY,
      postId    VARCHAR(64) NOT NULL,
      voterId   VARCHAR(64) NOT NULL,
      targetId  VARCHAR(64) NOT NULL,
      vote      ENUM('complete', 'incomplete') NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_vote (postId, voterId, targetId),
      CONSTRAINT fk_cv_post FOREIGN KEY (postId) REFERENCES posts(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // post_buddies 表新增 isComplete 字段（NULL=未结算, 0=未完成, 1=已完成）
  const pbIsCompleteCol = await query(`SHOW COLUMNS FROM post_buddies LIKE 'isComplete'`);
  if (pbIsCompleteCol.length === 0) {
    await query(`ALTER TABLE post_buddies ADD COLUMN isComplete TINYINT(1) NULL`);
  }

  // posts 表新增 publisherComplete 字段（NULL=未结算, 0=未完成, 1=已完成）
  const publisherCompleteCol = await query(`SHOW COLUMNS FROM posts LIKE 'publisherComplete'`);
  if (publisherCompleteCol.length === 0) {
    await query(`ALTER TABLE posts ADD COLUMN publisherComplete TINYINT(1) NULL`);
  }
```

- [ ] **Step 2: 启动后端，验证迁移成功**

```bash
cd backend && node src/server.js
```

预期：服务启动无报错，控制台无 SQL 错误。

用 MySQL 客户端验证：
```sql
SHOW TABLES LIKE 'completion_votes';
SHOW COLUMNS FROM post_buddies LIKE 'isComplete';
SHOW COLUMNS FROM posts LIKE 'publisherComplete';
```

三条查询各应返回 1 行。

- [ ] **Step 3: Commit**

```bash
git add backend/src/db.js
git commit -m "feat: add completion_votes table, isComplete and publisherComplete columns"
```

---

## Task 2: 后端 — 新增投票接口

**Files:**
- Modify: `backend/src/server.js`（在 `/evaluate` 路由之后插入新路由，约行 718）

- [ ] **Step 1: 在 server.js 的 `POST /api/posts/:id/evaluate` 路由结束之后（行718后），插入新路由**

```javascript
app.post('/api/posts/:id/completion-vote', async (req, res, next) => {
  try {
    const { userId, targetId, vote } = req.body;
    if (!userId || !targetId || !['complete', 'incomplete'].includes(vote)) {
      return res.status(400).json({ message: '缺少参数或 vote 值非法' });
    }
    if (userId === targetId) {
      return res.status(400).json({ message: '不能对自己投票' });
    }

    const postRows = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    const post = postRows[0];
    if (!post) return res.status(404).json({ message: '帖子不存在' });
    if (post.status !== '待评价') {
      return res.status(400).json({ message: '只有待评价状态才能投票' });
    }
    if (post.evaluationDeadline && new Date() > new Date(post.evaluationDeadline)) {
      return res.status(403).json({ message: '评价窗口已关闭' });
    }

    const allBuddies = await query('SELECT userId FROM post_buddies WHERE postId = ?', [req.params.id]);
    const participantIds = new Set([post.publisherId, ...allBuddies.map(b => b.userId)]);
    if (!participantIds.has(userId)) {
      return res.status(403).json({ message: '只有参与者才能投票' });
    }
    if (!participantIds.has(targetId)) {
      return res.status(400).json({ message: '被投票者不是该任务参与者' });
    }

    const voteId = createId('cv');
    await query(
      `INSERT INTO completion_votes (id, postId, voterId, targetId, vote)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE vote = VALUES(vote)`,
      [voteId, req.params.id, userId, targetId, vote]
    );

    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 2: 手动测试新接口（curl 或 Postman）**

先创建一个处于"待评价"状态的帖子，然后：

```bash
curl -X POST http://localhost:3000/api/posts/<postId>/completion-vote \
  -H "Content-Type: application/json" \
  -d '{"userId":"<voterId>","targetId":"<targetId>","vote":"complete"}'
```

预期：返回 204。重复提交同一条改为 `"vote":"incomplete"`，再查数据库应只有 1 条记录且 vote='incomplete'。

- [ ] **Step 3: Commit**

```bash
git add backend/src/server.js
git commit -m "feat: add POST /api/posts/:id/completion-vote endpoint"
```

---

## Task 3: 后端 — GET /api/posts/:id 返回 myCompletionVotes

**Files:**
- Modify: `backend/src/server.js:320-383`

- [ ] **Step 1: 在 GET /api/posts/:id 路由中，viewerId 查询块（行346-361）内追加 myCompletionVotes 查询**

找到这段代码：
```javascript
    if (viewerId) {
      [evaluationsSent, evaluationsReceived] = await Promise.all([
        query(...),
        query(...)
      ]);
    }
```

改为：
```javascript
    let myCompletionVotes = {};
    if (viewerId) {
      [evaluationsSent, evaluationsReceived] = await Promise.all([
        query(
          `SELECT e.toId, u.nickname AS toName, e.score, e.content, e.createdAt
           FROM evaluations e LEFT JOIN users u ON e.toId = u.id
           WHERE e.postId = ? AND e.fromId = ? ORDER BY e.createdAt ASC`,
          [req.params.id, viewerId]
        ),
        query(
          `SELECT e.fromId, e.fromName, e.score, e.content, e.createdAt
           FROM evaluations e
           WHERE e.postId = ? AND e.toId = ? ORDER BY e.createdAt ASC`,
          [req.params.id, viewerId]
        )
      ]);

      const voteRows = await query(
        'SELECT targetId, vote FROM completion_votes WHERE postId = ? AND voterId = ?',
        [req.params.id, viewerId]
      );
      myCompletionVotes = Object.fromEntries(voteRows.map(r => [r.targetId, r.vote]));
    }
```

- [ ] **Step 2: 在 return res.json(...) 中加入 myCompletionVotes**

找到：
```javascript
    return res.json({
      post: { ...mapPost(postRow), recommendedScore: dynamicScore },
      evidenceList,
      buddies,
      hasEvidence,
      evaluationsSent,
      evaluationsReceived
    });
```

改为：
```javascript
    return res.json({
      post: { ...mapPost(postRow), recommendedScore: dynamicScore },
      evidenceList,
      buddies,
      hasEvidence,
      evaluationsSent,
      evaluationsReceived,
      myCompletionVotes
    });
```

- [ ] **Step 3: 测试**

```bash
curl "http://localhost:3000/api/posts/<postId>?viewerId=<userId>"
```

预期：响应中包含 `"myCompletionVotes": {}` 或已投票的键值对。

- [ ] **Step 4: Commit**

```bash
git add backend/src/server.js
git commit -m "feat: include myCompletionVotes in GET /api/posts/:id response"
```

---

## Task 4: 后端 — 重写 settlePost 和 recalcCompletionRate

**Files:**
- Modify: `backend/src/server.js:84-127`（settlePost）
- Modify: `backend/src/server.js:734-742`（recalcCompletionRate）

- [ ] **Step 1: 重写 recalcCompletionRate 函数（行734-742）**

将：
```javascript
async function recalcCompletionRate(userId) {
  const rows = await query(
    `SELECT COUNT(*) AS total, SUM(status = '已完成') AS done FROM posts WHERE publisherId = ?`,
    [userId]
  );
  const { total, done } = rows[0];
  const rate = total > 0 ? Math.round(((done || 0) / total) * 100) : 0;
  await query('UPDATE users SET completionRate = ? WHERE id = ?', [rate, userId]);
}
```

改为：
```javascript
async function recalcCompletionRate(userId) {
  const [pubRows] = await Promise.all([
    query(
      `SELECT COUNT(*) AS total, SUM(publisherComplete = 1) AS done
       FROM posts WHERE publisherId = ? AND publisherComplete IS NOT NULL`,
      [userId]
    )
  ]);
  const buddyRows = await query(
    `SELECT COUNT(*) AS total, SUM(isComplete = 1) AS done
     FROM post_buddies WHERE userId = ? AND isComplete IS NOT NULL`,
    [userId]
  );

  const pubTotal = Number(pubRows[0].total) || 0;
  const pubDone = Number(pubRows[0].done) || 0;
  const buddyTotal = Number(buddyRows[0].total) || 0;
  const buddyDone = Number(buddyRows[0].done) || 0;

  const total = pubTotal + buddyTotal;
  const done = pubDone + buddyDone;
  const rate = total > 0 ? Math.round((done / total) * 100) : 0;
  await query('UPDATE users SET completionRate = ? WHERE id = ?', [rate, userId]);
}
```

- [ ] **Step 2: 重写 settlePost 函数（行84-127）**

将整个 `settlePost` 函数替换为：

```javascript
async function settlePost(postId) {
  const postRows = await query('SELECT * FROM posts WHERE id = ?', [postId]);
  const post = postRows[0];
  if (!post) return;

  const buddyRows = await query('SELECT userId FROM post_buddies WHERE postId = ?', [postId]);
  const participants = [post.publisherId, ...buddyRows.map(b => b.userId)];
  const N = participants.length;

  await withTransaction(async (connection) => {
    const [result] = await connection.execute(
      "UPDATE posts SET status = '已完成', progress = 100 WHERE id = ? AND status = '待评价'",
      [postId]
    );
    if (result.affectedRows === 0) return;

    for (const targetId of participants) {
      const [[{ rejectCount }]] = await connection.execute(
        `SELECT COUNT(*) AS rejectCount FROM completion_votes
         WHERE postId = ? AND targetId = ? AND vote = 'incomplete'`,
        [postId, targetId]
      );
      const voterCount = N - 1;
      const isComplete = Number(rejectCount) * 2 < voterCount ? 1 : 0;

      if (targetId === post.publisherId) {
        await connection.execute(
          'UPDATE posts SET publisherComplete = ? WHERE id = ?',
          [isComplete, postId]
        );
      } else {
        await connection.execute(
          'UPDATE post_buddies SET isComplete = ? WHERE postId = ? AND userId = ?',
          [isComplete, postId, targetId]
        );
      }

      if (isComplete) {
        await connection.execute(
          'UPDATE users SET points = points + ? WHERE id = ?',
          [post.reward || 0, targetId]
        );
        await insertPointLog(connection, targetId, post.reward || 0, `完成任务《${post.title}》`);
      }
    }
  });

  for (const targetId of participants) {
    await recalcCompletionRate(targetId);
  }

  const evaluated = await query(
    'SELECT DISTINCT toId FROM evaluations WHERE postId = ?',
    [postId]
  );
  for (const { toId } of evaluated) {
    setImmediate(() => generateAiComment(toId).catch(err =>
      console.error(`[AI] setImmediate error for ${toId}:`, err)
    ));
  }
}
```

- [ ] **Step 3: 验证 settlePost 逻辑**

重启后端，手动触发一个帖子进入"已完成"（在数据库直接将 `evaluationDeadline` 设为过去时间，然后调用 `GET /api/posts/:id` 触发 `syncPostStatus`）。

检查：
```sql
SELECT publisherComplete FROM posts WHERE id = '<postId>';
SELECT userId, isComplete FROM post_buddies WHERE postId = '<postId>';
SELECT points, completionRate FROM users WHERE id IN ('<publisherId>', '<buddyId>');
```

- 完成者积分应增加 reward 值
- isComplete / publisherComplete 应为 0 或 1
- completionRate 应根据新逻辑重算

- [ ] **Step 4: Commit**

```bash
git add backend/src/server.js
git commit -m "feat: rewrite settlePost and recalcCompletionRate for per-person completion voting"
```

---

## Task 5: 前端 — api.js 新增 submitCompletionVote

**Files:**
- Modify: `miniprogram/services/api.js`

- [ ] **Step 1: 在 api.js 的 submitEvaluation 函数（约行90）之后添加新函数**

```javascript
function submitCompletionVote(postId, userId, targetId, vote) {
  return request({
    url: `/api/posts/${postId}/completion-vote`,
    method: 'POST',
    data: { userId, targetId, vote }
  });
}
```

- [ ] **Step 2: 在 module.exports 中加入 submitCompletionVote**

找到 `module.exports = {` 块，加入 `submitCompletionVote,`。

- [ ] **Step 3: Commit**

```bash
git add miniprogram/services/api.js
git commit -m "feat: add submitCompletionVote api function"
```

---

## Task 6: 前端 — evaluate.js 加载投票状态并处理点击

**Files:**
- Modify: `miniprogram/pages/evaluate/evaluate.js`

- [ ] **Step 1: 将 evaluate.js 替换为以下内容**

```javascript
const api = require('../../services/api');

Page({
  data: {
    postId: '',
    targetUserId: '',
    targetNickname: '',
    currentUserId: '',
    targetEvidence: '',
    evidenceLoading: true,
    evalScore: 5,
    evalContent: '',
    submitting: false,
    completionVote: 'complete',  // 'complete' | 'incomplete'，默认已完成
    voteSubmitting: false,
    deadlinePassed: false
  },
  async onLoad(options) {
    const { postId, targetUserId } = options;
    const targetNickname = decodeURIComponent(options.targetNickname || '');
    const app = getApp();
    const userInfo = app.globalData.userInfo || wx.getStorageSync('userInfo');
    const currentUserId = userInfo ? userInfo.id : '';
    this.setData({ postId, targetUserId, targetNickname, currentUserId });
    try {
      const detail = await api.getPostDetail(postId, currentUserId);
      const evidence = (detail.evidenceList || []).find(e => e.submitterId === targetUserId);

      // 检查评价窗口是否已过期
      const deadline = detail.post && detail.post.evaluationDeadline;
      const deadlinePassed = deadline ? new Date() > new Date(deadline) : false;

      // 回显已投票状态，未投票则默认 'complete'（不写库，仅视觉默认）
      const myVotes = detail.myCompletionVotes || {};
      const completionVote = myVotes[targetUserId] || 'complete';

      this.setData({
        targetEvidence: evidence ? evidence.value : '',
        evidenceLoading: false,
        completionVote,
        deadlinePassed
      });
    } catch (err) {
      this.setData({ evidenceLoading: false });
      wx.showToast({ title: err.message || '加载失败', icon: 'none' });
    }
  },
  onEvalScoreChange(e) {
    this.setData({ evalScore: Number(e.detail.value) });
  },
  onEvalContentInput(e) {
    this.setData({ evalContent: e.detail.value });
  },
  cancel() {
    wx.navigateBack();
  },
  async onVoteComplete(e) {
    if (this.data.deadlinePassed || this.data.voteSubmitting) return;
    const vote = e.currentTarget.dataset.vote;
    if (vote === this.data.completionVote) return;  // 未变化，不重复提交

    this.setData({ voteSubmitting: true });
    try {
      await api.submitCompletionVote(
        this.data.postId,
        this.data.currentUserId,
        this.data.targetUserId,
        vote
      );
      this.setData({ completionVote: vote });
    } catch (err) {
      wx.showToast({ title: err.message || '投票失败', icon: 'none' });
    } finally {
      this.setData({ voteSubmitting: false });
    }
  },
  async submit() {
    if (this.data.submitting) return;
    const { postId, currentUserId, targetUserId, evalScore, evalContent } = this.data;
    if (!String(evalContent).trim()) {
      wx.showToast({ title: '请填写评价内容', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    try {
      await api.submitEvaluation(postId, currentUserId, targetUserId, evalScore, evalContent);
      wx.showToast({ title: '评价已提交', icon: 'success' });
      wx.navigateBack();
    } catch (err) {
      wx.showToast({ title: err.message || '提交失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add miniprogram/pages/evaluate/evaluate.js
git commit -m "feat: add completion vote state and handler to evaluate page"
```

---

## Task 7: 前端 — evaluate.wxml 新增投票 UI

**Files:**
- Modify: `miniprogram/pages/evaluate/evaluate.wxml`

- [ ] **Step 1: 替换 evaluate.wxml**

```xml
<view class="container">
  <!-- 证据卡片 -->
  <view class="card evidence-card">
    <view class="card-title">TA 的证据</view>
    <view wx:if="{{evidenceLoading}}" class="muted empty-hint">加载中...</view>
    <view wx:elif="{{targetEvidence}}" class="evidence-text">{{targetEvidence}}</view>
    <view wx:else class="muted empty-hint">暂未提交证据</view>
  </view>

  <!-- 评价表单 -->
  <view class="card eval-card">
    <view class="card-title">评价 {{targetNickname}}</view>
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
      class="eval-textarea"
      placeholder="描述对方的完成情况和配合度..."
      placeholder-class="placeholder"
      bindinput="onEvalContentInput"
      value="{{evalContent}}"
    />

    <!-- 任务完成判定 -->
    <view class="label completion-label">任务完成判定</view>
    <view class="completion-vote-row">
      <view
        class="vote-btn {{completionVote === 'complete' ? 'vote-btn--active-complete' : ''}} {{deadlinePassed ? 'vote-btn--disabled' : ''}}"
        data-vote="complete"
        bindtap="onVoteComplete"
      >✓ 已完成</view>
      <view
        class="vote-btn {{completionVote === 'incomplete' ? 'vote-btn--active-incomplete' : ''}} {{deadlinePassed ? 'vote-btn--disabled' : ''}}"
        data-vote="incomplete"
        bindtap="onVoteComplete"
      >✗ 未完成</view>
    </view>
    <view wx:if="{{deadlinePassed}}" class="muted completion-hint">评价窗口已关闭</view>
    <view wx:else class="muted completion-hint">未投票默认视为已完成</view>

    <view class="form-btns">
      <button class="ghost-btn form-btn" bindtap="cancel">取消</button>
      <button class="primary-btn form-btn" bindtap="submit" disabled="{{submitting}}">提交</button>
    </view>
  </view>
</view>
```

- [ ] **Step 2: Commit**

```bash
git add miniprogram/pages/evaluate/evaluate.wxml
git commit -m "feat: add completion vote buttons to evaluate page"
```

---

## Task 8: 前端 — evaluate.wxss 新增投票按钮样式

**Files:**
- Modify: `miniprogram/pages/evaluate/evaluate.wxss`

- [ ] **Step 1: 在 evaluate.wxss 末尾追加样式**

```css
.completion-label {
  margin-top: 20rpx;
}

.completion-vote-row {
  display: flex;
  gap: 20rpx;
  margin: 14rpx 0 4rpx;
}

.vote-btn {
  flex: 1;
  height: 72rpx;
  line-height: 72rpx;
  text-align: center;
  border-radius: 16rpx;
  font-size: 28rpx;
  border: 2rpx solid rgba(255,122,89,0.25);
  color: #64748b;
  background: rgba(255,255,255,0.7);
  transition: all 0.15s;
}

.vote-btn--active-complete {
  background: #dcfce7;
  border-color: #22c55e;
  color: #16a34a;
  font-weight: 600;
}

.vote-btn--active-incomplete {
  background: #fee2e2;
  border-color: #ef4444;
  color: #dc2626;
  font-weight: 600;
}

.vote-btn--disabled {
  opacity: 0.5;
  pointer-events: none;
}

.completion-hint {
  font-size: 24rpx;
  margin-bottom: 20rpx;
}
```

- [ ] **Step 2: Commit**

```bash
git add miniprogram/pages/evaluate/evaluate.wxss
git commit -m "feat: add completion vote button styles"
```

---

## Task 9: 端到端验证

- [ ] **Step 1: 完整流程测试**

1. 创建帖子，至少有 1 名搭子加入
2. 帖子进入"待评价"状态
3. 在评价页面，对某人点击"未完成"按钮 → 应立即高亮红色，后台 `completion_votes` 表有记录
4. 切换回"已完成" → 数据库记录更新为 `'complete'`
5. 关闭评价窗口（将 `evaluationDeadline` 设为过去时间）→ 重新打开评价页，按钮应只读
6. 触发 `settlePost`（调用 `GET /api/posts/:id` 等待自动结算）
7. 验证：被多数投"未完成"的人不得积分，其 `isComplete`/`publisherComplete` 为 0，`completionRate` 已重算

- [ ] **Step 2: 边界情况验证**

- 只有 1 名参与者（无人投票）→ voterCount=0，rejectCount=0，`0 * 2 < 0` 为 false，所以 isComplete=1（已完成）✓
- 2 人参与，1 票反对（voterCount=1，rejectCount=1）→ `1*2 >= 1` → 未完成 ✓
- 重复投票改变立场 → 数据库只保留最新记录 ✓

- [ ] **Step 3: 最终 commit（如有未提交改动）**

```bash
git status
git add -A
git commit -m "feat: completion vote — end-to-end verified"
```
