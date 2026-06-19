# 投票完成即提前结算 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 当所有参与者投完完成票（或 N=1）时立即结算任务，不再死等 `evaluationDeadline`，同时保留到期兜底。

**Architecture:** 新增内部函数 `maybeSettleEarly(postId)`，判断完成票是否投满（`N×(N-1)`，N=1 时阈值为 0），满足则调用既有 `settlePost`。在三处接入：投票成功后、手动 `/complete` 后、`syncPostStatus` 自动转待评价后。防重复完全依赖 `settlePost` 已有的 `WHERE status='待评价'` 守卫。

**Tech Stack:** Node.js + Express + mysql2（[backend/src/server.js](../../../backend/src/server.js)）。无单测框架，沿用独立脚本 + axios HTTP 集成测试约定。

---

## 文件结构

- 修改：[backend/src/server.js](../../../backend/src/server.js)
  - 新增 `maybeSettleEarly(postId)`（紧跟 `settlePost` 之后，约 line 184）
  - `syncPostStatus` 进行中→待评价分支末尾接入（约 line 104）
  - `POST /complete` 置待评价后接入（约 line 860）
  - `POST /completion-vote` 写票成功后接入（约 line 944）
- 新增：`backend/test_early_settlement.js`（HTTP 集成测试脚本）

参考设计：[docs/superpowers/specs/2026-06-15-early-settlement-design.md](../specs/2026-06-15-early-settlement-design.md)

---

### Task 1: 新增 `maybeSettleEarly` 函数

**Files:**
- Modify: `backend/src/server.js`（在 `settlePost` 函数结束 `}` 之后插入，约 line 184）

- [ ] **Step 1: 实现 `maybeSettleEarly`**

在 [server.js:184](../../../backend/src/server.js#L184)（`settlePost` 的闭合 `}` 之后、`calcRecommendedScore` 之前）插入：

```javascript
async function maybeSettleEarly(postId) {
  const rows = await query('SELECT * FROM posts WHERE id = ?', [postId]);
  const post = rows[0];
  if (!post || post.status !== '待评价') return;

  const buddyRows = await query('SELECT userId FROM post_buddies WHERE postId = ?', [postId]);
  const participants = [post.publisherId, ...buddyRows.map(b => b.userId)];
  const N = participants.length;
  const required = N * (N - 1);

  if (required > 0) {
    const placeholders = participants.map(() => '?').join(',');
    const [{ actual }] = await query(
      `SELECT COUNT(*) AS actual FROM completion_votes
       WHERE postId = ? AND voterId IN (${placeholders}) AND targetId IN (${placeholders})`,
      [postId, ...participants, ...participants]
    );
    if (Number(actual) < required) return;
  }

  await settlePost(postId);
}
```

- [ ] **Step 2: 语法自检**

Run: `cd backend && node -e "require('./src/server.js')"` 启动会监听端口，仅用于确认无语法错误后 Ctrl-C。
预期：无 `SyntaxError` 抛出（出现 "backend is running" 或端口监听日志即通过）。

- [ ] **Step 3: Commit**

```bash
git add backend/src/server.js
git commit -m "feat(settle): 新增 maybeSettleEarly 提前结算判定函数"
```

---

### Task 2: 三处接入 `maybeSettleEarly`

**Files:**
- Modify: `backend/src/server.js`（line 104、line 860、line 944 附近）

- [ ] **Step 1: 接入 `syncPostStatus`（自动转待评价）**

在 [server.js:99-107](../../../backend/src/server.js#L99-L107) 的"进行中"分支中，将原代码：

```javascript
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
```

改为（仅在转待评价后追加一行调用）：

```javascript
  if (post.status === '进行中') {
    if (post.endTime && now >= new Date(post.endTime)) {
      const deadline = new Date(now.getTime() + 32 * 60 * 60 * 1000);
      await query(
        'UPDATE posts SET status = ?, evaluationDeadline = ? WHERE id = ?',
        ['待评价', deadline, postId]
      );
      await maybeSettleEarly(postId);
    }
    return;
  }
```

- [ ] **Step 2: 接入 `POST /complete`**

在 [server.js:860](../../../backend/src/server.js#L860) 的
`await query('UPDATE posts SET status = ? WHERE id = ?', ['待评价', req.params.id]);`
这一行之后、`await deleteMessagesByPost(...)` 之前插入：

```javascript
    await maybeSettleEarly(req.params.id);
```

- [ ] **Step 3: 接入 `POST /completion-vote`**

在 [server.js:939-944](../../../backend/src/server.js#L939-L944) 的 `INSERT ... completion_votes` 写入语句之后、`res.status(204).end();` 之前插入：

```javascript
    await maybeSettleEarly(req.params.id);
```

- [ ] **Step 4: 语法自检**

Run: `cd backend && node -e "require('./src/server.js')"`（确认无语法错误后 Ctrl-C）
预期：无 `SyntaxError`。

- [ ] **Step 5: Commit**

```bash
git add backend/src/server.js
git commit -m "feat(settle): 投票完成/手动完成/自动到期三处接入提前结算"
```

---

### Task 3: HTTP 集成测试脚本

**Files:**
- Create: `backend/test_early_settlement.js`

测试通过 HTTP 打本地后端 + 直连 DB 造数与断言，沿用 `test_annotations.js` 的 `ok()` 风格。DB 配置取 `process.env.MYSQL_PASSWORD || '123456'`（与 [db.js:8](../../../backend/src/db.js#L8) 一致）。

前置：另开终端 `cd backend && npm start` 启动服务（默认 3000，若日志显示其它端口则改 `BASE`）。

- [ ] **Step 1: 写测试脚本**

```javascript
// backend/test_early_settlement.js
// 前置：另开终端 `npm start` 启动后端；本脚本直连 DB 造数 + HTTP 触发投票
const mysql = require('mysql2/promise');
const axios = require('axios');

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const dbConfig = {
  host: '127.0.0.1', port: 3306, user: 'root',
  password: process.env.MYSQL_PASSWORD || '123456',
  database: 'task_buddy', charset: 'utf8mb4'
};

async function run() {
  const pool = mysql.createPool(dbConfig);
  let pass = 0, fail = 0;
  const ok = (c, m) => c ? (pass++, console.log('  PASS', m)) : (fail++, console.log('  FAIL', m));
  const ts = Date.now();
  const ids = { users: [], posts: [] };

  async function mkUser(suffix) {
    const id = `t_es_u_${ts}_${suffix}`;
    await pool.execute('INSERT INTO users (id, nickname) VALUES (?, ?)', [id, `测试${suffix}`]);
    ids.users.push(id);
    return id;
  }
  // 造一个直接处于"待评价"的帖子，evaluationDeadline 设在未来，避免兜底干扰
  async function mkPost(publisherId, buddyIds) {
    const id = `t_es_p_${ts}_${Math.random().toString(36).slice(2, 7)}`;
    const future = new Date(Date.now() + 24 * 3600 * 1000);
    await pool.execute(
      `INSERT INTO posts (id, title, publisherId, status, reward, evaluationDeadline, maxBuddies, currentBuddies)
       VALUES (?, ?, ?, '待评价', 10, ?, 9, ?)`,
      [id, '提前结算测试', publisherId, future, buddyIds.length]
    );
    for (const b of buddyIds) {
      await pool.execute('INSERT INTO post_buddies (postId, userId) VALUES (?, ?)', [id, b]);
    }
    ids.posts.push(id);
    return id;
  }
  const statusOf = async (id) => (await pool.execute('SELECT status FROM posts WHERE id = ?', [id]))[0][0].status;
  const vote = (postId, userId, targetId) =>
    axios.post(`${BASE}/api/posts/${postId}/completion-vote`,
      { userId, targetId, vote: 'complete' });

  try {
    const u1 = await mkUser('1'), u2 = await mkUser('2'), u3 = await mkUser('3');

    // 场景 A：N=2，互投 2 票后应结算
    const pA = await mkPost(u1, [u2]);
    await vote(pA, u1, u2);
    ok(await statusOf(pA) === '待评价', 'N=2 仅投 1 票未结算');
    await vote(pA, u2, u1);
    ok(await statusOf(pA) === '已完成', 'N=2 投满 2 票后已完成');

    // 场景 B：N=3，投满 6 票才结算；5 票不结算
    const pB = await mkPost(u1, [u2, u3]);
    const pairs = [[u1,u2],[u1,u3],[u2,u1],[u2,u3],[u3,u1]];
    for (const [v, t] of pairs) await vote(pB, v, t);
    ok(await statusOf(pB) === '待评价', 'N=3 投 5 票未结算');
    await vote(pB, u3, u2); // 第 6 票
    ok(await statusOf(pB) === '已完成', 'N=3 投满 6 票后已完成');

    console.log(`\n结果: ${pass} passed, ${fail} failed`);
  } catch (e) {
    console.error('ERROR', e.response ? e.response.data : e.message);
    fail++;
  } finally {
    // 清理
    for (const p of ids.posts) {
      await pool.execute('DELETE FROM completion_votes WHERE postId = ?', [p]);
      await pool.execute('DELETE FROM post_buddies WHERE postId = ?', [p]);
      await pool.execute('DELETE FROM posts WHERE id = ?', [p]);
    }
    for (const u of ids.users) await pool.execute('DELETE FROM users WHERE id = ?', [u]);
    await pool.end();
    process.exit(fail ? 1 : 0);
  }
}
run();
```

- [ ] **Step 2: 启动后端**

另开终端 Run: `cd backend && npm start`
预期：输出服务运行日志（如 "backend is running" 或监听端口）。记下端口，非 3000 则设 `BASE` 环境变量。

- [ ] **Step 3: 跑测试**

Run: `cd backend && node test_early_settlement.js`
预期：`4 passed, 0 failed`。
覆盖：N=2 投 1 票不结算 / 投满结算；N=3 投 5 票不结算 / 投满 6 票结算。

- [ ] **Step 4: Commit**

```bash
git add backend/test_early_settlement.js
git commit -m "test(settle): 提前结算 HTTP 集成测试(N=2/N=3 投票阈值)"
```

---

### Task 4: 手动验证 N=1 与到期兜底

代码无法在自动化脚本里方便地推进时间触发兜底，这两条用手动核对。

- [ ] **Step 1: N=1 手动完成即结算**

在已运行后端 + 库中存在一个"进行中"、无搭子(`currentBuddies=0`)且发布者为某 userId 的帖子上：

Run（替换 `<postId>`/`<publisherId>`）:
```bash
curl -s -X POST http://127.0.0.1:3000/api/posts/<postId>/complete \
  -H "Content-Type: application/json" -d '{"userId":"<publisherId>"}'
```
预期：响应 JSON 的 `status` 为 `已完成`（`/complete` 置待评价后 `maybeSettleEarly` 因 required=0 立即结算）。
DB 核对：`SELECT status, publisherComplete FROM posts WHERE id='<postId>'` → `已完成`、`publisherComplete=1`。

- [ ] **Step 2: 到期兜底仍生效（人工核对逻辑）**

确认 [server.js:110-114](../../../backend/src/server.js#L110-L114) 的"待评价 + 到期 → settlePost"分支未被改动。
可选 DB 验证：将某待评价帖子 `UPDATE posts SET evaluationDeadline = '2000-01-01' WHERE id=?`，再对其调用任一带 `syncPostStatus` 的接口（如 `GET /api/posts/:id`），随后 `SELECT status` 应为 `已完成`。

- [ ] **Step 3: 记录验证结果**

在 PR/提交说明中记录 N=1 与兜底两项的实际观测结果。本任务无代码改动，不单独 commit。

---

## 前端跟进（本计划范围说明）

`evaluate` 页面在 `/completion-vote` 成功后应重新拉取 `GET /api/posts/:id`，若 `status==='已完成'` 切换只读/结果态。后端改完即生效（投票后帖子可能直接结算），前端适配为独立跟进项，不在本后端计划的强制任务内——若本次一并处理，按现有 evaluate 页面拉取模式新增一次刷新即可。

---

## Self-Review

- **Spec 覆盖**：触发阈值 `N×(N-1)`（Task1）、N=1 即结算（Task1 required=0 + Task4）、三接入点（Task2）、保留兜底（Task2 未动 110-114 + Task4 Step2）、防重复依赖 settlePost 守卫（无需新代码，设计已说明）、前端跟进（范围说明）——均有对应。
- **占位符**：无 TBD/TODO，测试与命令均为完整可执行内容。
- **类型/命名一致**：函数名 `maybeSettleEarly` 在定义与三处调用一致；列名 `voterId/targetId/postId/publisherComplete`、状态字面量 `待评价/已完成` 与 server.js 现有用法一致。
