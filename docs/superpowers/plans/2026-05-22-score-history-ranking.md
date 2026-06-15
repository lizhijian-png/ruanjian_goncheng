# 积分历史记录 + 排行榜增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增积分历史记录功能（数据库表 + 后端接口 + 前端页面），并补全排行榜高亮当前用户位置。

**Architecture:** 在数据库新增 `point_logs` 表，在后端所有积分变动处插入日志记录，新增查询接口；前端新建 `score-history` 页面展示历史，个人主页添加入口，排行榜读取本地用户 ID 高亮当前用户。

**Tech Stack:** Node.js/Express, MySQL, 微信小程序原生（WXML + WXSS + JS）

---

### Task 1: 数据库新增 point_logs 表

**Files:**
- Modify: `backend/src/db.js`

- [ ] **Step 1: 在 `createTables()` 末尾追加建表 SQL**

在 [backend/src/db.js](backend/src/db.js) 的 `createTables` 函数最后一个 `await query(...)` 语句之后，追加：

```js
  await query(`
    CREATE TABLE IF NOT EXISTS point_logs (
      id VARCHAR(64) PRIMARY KEY,
      userId VARCHAR(64) NOT NULL,
      delta INT NOT NULL,
      balance INT NOT NULL,
      reason VARCHAR(255) NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_point_logs_userId (userId),
      CONSTRAINT fk_pl_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
```

- [ ] **Step 2: 重启后端验证建表成功**

```bash
cd backend && npm start
```

观察控制台无报错，然后用 MySQL 客户端或命令行验证：
```sql
SHOW TABLES LIKE 'point_logs';
DESCRIBE point_logs;
```
期望：表存在，有 id / userId / delta / balance / reason / createdAt 六列。

- [ ] **Step 3: Commit**

```bash
git add backend/src/db.js
git commit -m "feat: add point_logs table"
```

---

### Task 2: 后端写入积分日志 + 新增查询接口

**Files:**
- Modify: `backend/src/server.js`

积分变动发生在两处：
1. `settlePost`（任务完成，发布者和所有搭子各 +reward）
2. `POST /api/posts/:id/abandon`（放弃任务，发布者 -penalty，但使用 GREATEST(0,...) 兜底）

- [ ] **Step 1: 在 server.js 顶部添加 `insertPointLog` 辅助函数**

在 `buildUserResponse` 函数定义之前（约第 12 行）插入：

```js
async function insertPointLog(connection, userId, delta, reason) {
  const [[user]] = await connection.execute('SELECT points FROM users WHERE id = ?', [userId]);
  const balance = user ? user.points : 0;
  const logId = createId('pl');
  await connection.execute(
    'INSERT INTO point_logs (id, userId, delta, balance, reason) VALUES (?, ?, ?, ?, ?)',
    [logId, userId, delta, balance, reason]
  );
}
```

注意：`balance` 在 `UPDATE users SET points = points + ?` **之后**查询，所以要先 UPDATE 再 INSERT。下面的步骤中确保顺序正确。

- [ ] **Step 2: 在 `settlePost` 的事务中，每次 UPDATE points 之后立即插入日志**

找到 `settlePost` 函数（约第 57 行），在事务内修改为：

```js
async function settlePost(postId) {
  let publisherId = null;
  await withTransaction(async (connection) => {
    const [result] = await connection.execute(
      "UPDATE posts SET status = '已完成', progress = 100 WHERE id = ? AND status = '待评价'",
      [postId]
    );
    if (result.affectedRows === 0) return;

    const [postRows] = await connection.execute('SELECT * FROM posts WHERE id = ?', [postId]);
    const post = postRows[0];
    publisherId = post.publisherId;

    await connection.execute(
      'UPDATE users SET points = points + ? WHERE id = ?',
      [post.reward || 0, post.publisherId]
    );
    await insertPointLog(connection, post.publisherId, post.reward || 0, `完成任务《${post.title}》`);

    const [buddyRows] = await connection.execute(
      'SELECT userId FROM post_buddies WHERE postId = ?',
      [postId]
    );
    for (const buddy of buddyRows) {
      await connection.execute(
        'UPDATE users SET points = points + ? WHERE id = ?',
        [post.reward || 0, buddy.userId]
      );
      await insertPointLog(connection, buddy.userId, post.reward || 0, `完成任务《${post.title}》`);
    }
  });
  if (publisherId) await recalcCompletionRate(publisherId);
}
```

- [ ] **Step 3: 在 `POST /api/posts/:id/abandon` 的事务中写入日志**

找到 abandon 接口（约第 820 行），在事务内 `UPDATE users SET points = GREATEST(...)` 之后追加日志：

```js
    await withTransaction(async (connection) => {
      await connection.execute(
        'UPDATE posts SET status = ? WHERE id = ?',
        ['已放弃', req.params.id]
      );
      await connection.execute(
        'UPDATE users SET points = GREATEST(0, points - ?) WHERE id = ?',
        [post.penalty, post.publisherId]
      );
      await insertPointLog(connection, post.publisherId, -post.penalty, `放弃任务《${post.title}》`);
    });
```

- [ ] **Step 4: 新增 GET /api/users/:id/point-logs 接口**

在 `GET /api/users/:id/profile` 接口定义之后（约第 930 行）插入：

```js
app.get('/api/users/:id/point-logs', async (req, res, next) => {
  try {
    const rows = await query(
      'SELECT id, delta, balance, reason, createdAt FROM point_logs WHERE userId = ? ORDER BY createdAt DESC',
      [req.params.id]
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 5: 重启后端，手动测试接口**

```bash
cd backend && npm start
```

用浏览器或 curl 访问（替换实际 userId）：
```
http://localhost:3000/api/users/<userId>/point-logs
```
期望：返回空数组 `[]`（因为还没有积分变动记录）。

- [ ] **Step 6: Commit**

```bash
git add backend/src/server.js
git commit -m "feat: record point_logs on settle/abandon; add GET /api/users/:id/point-logs"
```

---

### Task 3: 前端 api.js 新增 getPointLogs

**Files:**
- Modify: `miniprogram/services/api.js`

- [ ] **Step 1: 在 api.js 中新增函数**

在 `getEvaluationsReceived` 函数之后添加：

```js
function getPointLogs(userId) {
  return request({ url: `/api/users/${userId}/point-logs` });
}
```

- [ ] **Step 2: 在 module.exports 中导出**

在 `module.exports` 对象中加入 `getPointLogs`：

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
  requestComplete,
  getEvaluationsReceived,
  getPointLogs
};
```

- [ ] **Step 3: Commit**

```bash
git add miniprogram/services/api.js
git commit -m "feat: add getPointLogs api"
```

---

### Task 4: 新建积分历史页面

**Files:**
- Create: `miniprogram/pages/score-history/score-history.js`
- Create: `miniprogram/pages/score-history/score-history.wxml`
- Create: `miniprogram/pages/score-history/score-history.wxss`
- Create: `miniprogram/pages/score-history/score-history.json`
- Modify: `miniprogram/app.json`

- [ ] **Step 1: 在 app.json 的 pages 数组中注册新页面**

在 `miniprogram/app.json` 的 `pages` 数组中添加（加在最后一项之后）：

```json
"pages/score-history/score-history"
```

- [ ] **Step 2: 创建 score-history.json**

```json
{
  "navigationBarTitleText": "积分历史",
  "navigationBarBackgroundColor": "#ff8c42",
  "navigationBarTextStyle": "white"
}
```

- [ ] **Step 3: 创建 score-history.js**

```js
const api = require('../../services/api');

Page({
  data: {
    logs: [],
    loading: true
  },
  async onLoad() {
    const app = getApp();
    const userInfo = app.globalData.userInfo || wx.getStorageSync('userInfo');
    if (!userInfo || !userInfo.id) {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }
    try {
      const logs = await api.getPointLogs(userInfo.id);
      this.setData({ logs, loading: false });
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  }
});
```

- [ ] **Step 4: 创建 score-history.wxml**

```xml
<view class="container">
  <view class="page-header">
    <text class="page-title">积分历史</text>
  </view>

  <view wx:if="{{loading}}" class="empty-tip">
    <text>加载中...</text>
  </view>

  <view wx:elif="{{logs.length === 0}}" class="empty-tip">
    <text>暂无积分记录</text>
  </view>

  <view wx:else class="log-list">
    <view wx:for="{{logs}}" wx:key="id" class="log-item">
      <view class="log-left">
        <view class="log-reason">{{item.reason}}</view>
        <view class="log-time">{{item.createdAt}}</view>
      </view>
      <view class="log-right">
        <view class="log-delta {{item.delta >= 0 ? 'delta-positive' : 'delta-negative'}}">
          {{item.delta >= 0 ? '+' : ''}}{{item.delta}} 分
        </view>
        <view class="log-balance">余额：{{item.balance}} 分</view>
      </view>
    </view>
  </view>
</view>
```

- [ ] **Step 5: 创建 score-history.wxss**

```css
.container {
  min-height: 100vh;
  background: #f5f5f5;
  padding-bottom: 40rpx;
}

.page-header {
  background: #ff8c42;
  padding: 40rpx 32rpx 30rpx;
}

.page-title {
  font-size: 40rpx;
  font-weight: bold;
  color: #fff;
}

.empty-tip {
  text-align: center;
  color: #999;
  padding: 80rpx 0;
  font-size: 28rpx;
}

.log-list {
  padding: 24rpx 24rpx 0;
}

.log-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #fff;
  border-radius: 16rpx;
  padding: 28rpx 32rpx;
  margin-bottom: 20rpx;
  box-shadow: 0 2rpx 8rpx rgba(0,0,0,0.06);
}

.log-left {
  flex: 1;
  margin-right: 20rpx;
}

.log-reason {
  font-size: 30rpx;
  color: #333;
  margin-bottom: 10rpx;
}

.log-time {
  font-size: 24rpx;
  color: #999;
}

.log-right {
  text-align: right;
}

.log-delta {
  font-size: 36rpx;
  font-weight: bold;
  margin-bottom: 8rpx;
}

.delta-positive {
  color: #4caf50;
}

.delta-negative {
  color: #f44336;
}

.log-balance {
  font-size: 24rpx;
  color: #999;
}
```

- [ ] **Step 6: 在微信开发者工具中编译，直接访问页面测试**

在开发者工具顶部的路径栏输入：
```
pages/score-history/score-history
```
期望：页面显示"暂无积分记录"（因为还没有积分变动数据）。

- [ ] **Step 7: Commit**

```bash
git add miniprogram/pages/score-history/ miniprogram/app.json
git commit -m "feat: add score-history page"
```

---

### Task 5: 个人主页添加积分历史入口

**Files:**
- Modify: `miniprogram/pages/profile/profile.wxml`
- Modify: `miniprogram/pages/profile/profile.js`
- Modify: `miniprogram/pages/profile/profile.wxss`

- [ ] **Step 1: 在 profile.wxml 的积分信息行添加可点击入口**

找到以下代码（profile.wxml 约第 7 行）：

```xml
      <view class="muted">积分 {{user.points}} · 排名 #{{user.rank}} · 完成率 {{user.completionRate}}%</view>
```

替换为：

```xml
      <view class="score-row" bindtap="goScoreHistory">
        <text class="muted">积分 </text>
        <text class="score-value">{{user.points}}</text>
        <text class="muted"> · 排名 #{{user.rank}} · 完成率 {{user.completionRate}}%</text>
        <text class="score-hint"> 查看记录 ›</text>
      </view>
```

- [ ] **Step 2: 在 profile.js 中添加跳转方法**

在 `openSettings()` 方法之前添加：

```js
  goScoreHistory() {
    wx.navigateTo({ url: '/pages/score-history/score-history' });
  },
```

- [ ] **Step 3: 在 profile.wxss 中添加样式**

在文件末尾追加：

```css
.score-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 4rpx;
}

.score-value {
  color: #ff8c42;
  font-weight: bold;
  font-size: 30rpx;
}

.score-hint {
  color: #ff8c42;
  font-size: 24rpx;
  margin-left: 8rpx;
}
```

- [ ] **Step 4: 编译验证**

在微信开发者工具中编译，进入"我的"页面，点击积分行，确认跳转到积分历史页面。

- [ ] **Step 5: Commit**

```bash
git add miniprogram/pages/profile/profile.wxml miniprogram/pages/profile/profile.js miniprogram/pages/profile/profile.wxss
git commit -m "feat: profile page links to score-history"
```

---

### Task 6: 排行榜高亮当前用户

**Files:**
- Modify: `miniprogram/pages/ranking/ranking.js`
- Modify: `miniprogram/pages/ranking/ranking.wxml`
- Modify: `miniprogram/pages/ranking/ranking.wxss`

- [ ] **Step 1: 在 ranking.js 的 onShow 中读取当前用户 ID**

将 ranking.js 替换为：

```js
const api = require('../../services/api');

Page({
  data: {
    ranking: [],
    top3: [],
    restRanking: [],
    currentUserId: ''
  },
  async onShow() {
    const app = getApp();
    const userInfo = app.globalData.userInfo || wx.getStorageSync('userInfo');
    const currentUserId = userInfo ? userInfo.id : '';
    try {
      const ranking = await api.getRanking();
      this.setData({
        ranking,
        top3: ranking.slice(0, 3),
        restRanking: ranking.slice(3),
        currentUserId
      });
    } catch (error) {
      wx.showToast({ title: '加载排行失败', icon: 'none' });
    }
  }
});
```

- [ ] **Step 2: 在 ranking.wxml 中为当前用户加高亮 class**

找到领奖台三个 `podium-item` view，分别对第1、2、3名加条件 class：

```xml
    <!-- 第2名（左） -->
    <view class="podium-item podium-2 {{top3[1].id === currentUserId ? 'podium-me' : ''}}" wx:if="{{top3[1]}}">
```

```xml
    <!-- 第1名（中） -->
    <view class="podium-item podium-1 {{top3[0].id === currentUserId ? 'podium-me' : ''}}" wx:if="{{top3[0]}}">
```

```xml
    <!-- 第3名（右） -->
    <view class="podium-item podium-3 {{top3[2].id === currentUserId ? 'podium-me' : ''}}" wx:if="{{top3[2]}}">
```

找到第4名以后的列表行：

```xml
      <view class="rank-row {{item.id === currentUserId ? 'rank-row-me' : ''}}">
```

- [ ] **Step 3: 在 ranking.wxss 末尾添加高亮样式**

```css
.podium-me {
  outline: 4rpx solid #ff8c42;
  border-radius: 16rpx;
}

.rank-row-me {
  background: #fff3e0;
  border-left: 6rpx solid #ff8c42;
}
```

- [ ] **Step 4: 编译验证**

进入排行榜页面，确认当前登录用户的位置有橙色高亮。

- [ ] **Step 5: Commit**

```bash
git add miniprogram/pages/ranking/ranking.js miniprogram/pages/ranking/ranking.wxml miniprogram/pages/ranking/ranking.wxss
git commit -m "feat: highlight current user in ranking"
```

---

## 实验报告检查清单

完成所有 Task 后，需要保存以下内容用于实验报告：

| 截图/内容 | 说明 |
|---|---|
| 个人主页截图 | 显示积分、排名、完成率、"查看记录 ›" 入口 |
| 积分历史页截图（有数据） | 完成或放弃一个任务后截图，显示变动记录 |
| 排行榜截图 | 高亮当前用户位置 |
| `point_logs` 表结构截图 | MySQL 中 `DESCRIBE point_logs;` 的结果 |
| `/api/users/:id/point-logs` 接口响应截图 | 浏览器访问后的 JSON 响应 |
