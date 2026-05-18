# Multi-Buddy Logic Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three broken behaviors when a post has multiple buddies: (1) evaluation tracking conflates all buddies into one flag, (2) points are only awarded to the publisher, (3) joining while maxBuddies is reached ignores startTime.

**Architecture:** The `buddyEvaluated` boolean on `posts` is replaced with a per-row flag (`evaluated TINYINT`) on `post_buddies`, making evaluation state per-participant. Point settlement distributes reward to every buddy. The join handler checks `startTime` before auto-advancing to `进行中`.

**Tech Stack:** Node.js/Express, MySQL 8.0, WeChat Mini-program (WXML + JS)

---

## File Map

| File | Change |
|------|--------|
| `backend/src/db.js` | Add `evaluated` column migration to `post_buddies`; remove `buddyEvaluated` migration |
| `backend/src/server.js` | Rewrite evaluate endpoint, rewrite point settlement, fix join status logic |
| `miniprogram/pages/post-detail/post-detail.js` | Derive `myEvaluated` from `buddies` array instead of `post.buddyEvaluated` |

---

## Task 1: Add `evaluated` column to `post_buddies` via migration

**Files:**
- Modify: `backend/src/db.js`

- [ ] **Step 1: Add the migration** — append after the existing `evidences` unique-key migration block (around line 247), before the closing `}` of `createTables`:

```js
  // 兼容旧表：post_buddies 加 evaluated 标志位（替代 posts.buddyEvaluated）
  const pbEvaluatedCol = await query(`SHOW COLUMNS FROM post_buddies LIKE 'evaluated'`);
  if (pbEvaluatedCol.length === 0) {
    await query(`ALTER TABLE post_buddies ADD COLUMN evaluated TINYINT(1) NOT NULL DEFAULT 0`);
  }
```

- [ ] **Step 2: Restart backend and verify column exists**

```bash
cd backend && node -e "
const { initDb, query } = require('./src/db');
initDb().then(async () => {
  const cols = await query(\"SHOW COLUMNS FROM post_buddies LIKE 'evaluated'\");
  console.log(cols.length === 1 ? 'OK: column exists' : 'FAIL: column missing');
  process.exit(0);
});
"
```

Expected output: `OK: column exists`

- [ ] **Step 3: Commit**

```bash
git add backend/src/db.js
git commit -m "feat: add evaluated column to post_buddies for per-buddy evaluation tracking"
```

---

## Task 2: Rewrite evaluate endpoint — duplicate detection and flag update

**Files:**
- Modify: `backend/src/server.js` (lines ~694–721)

The old code uses `post.publisherEvaluated` / `post.buddyEvaluated`. Replace the duplicate-check and flag-update sections so buddies are tracked individually via `post_buddies.evaluated`.

- [ ] **Step 1: Replace duplicate-check block**

Find this block (approx lines 695–700):

```js
    // 防重复提交
    if (isPublisher && post.publisherEvaluated) {
      return res.status(400).json({ message: '你已经提交过评价了' });
    }
    if (isBuddy && post.buddyEvaluated) {
      return res.status(400).json({ message: '你已经提交过评价了' });
    }
```

Replace with:

```js
    // 防重复提交
    if (isPublisher && post.publisherEvaluated) {
      return res.status(400).json({ message: '你已经提交过评价了' });
    }
    if (isBuddy && buddyRows[0].evaluated) {
      return res.status(400).json({ message: '你已经提交过评价了' });
    }
```

Note: `buddyRows` already contains the current buddy's row (fetched at line ~685 — `SELECT userId, nickname FROM post_buddies WHERE postId = ? AND userId = ?`). We just add `evaluated` to what is selected in the next step.

- [ ] **Step 2: Expand the buddyRows SELECT to include `evaluated`**

Find (approx line 685):

```js
    const buddyRows = await query(
      'SELECT userId, nickname FROM post_buddies WHERE postId = ? AND userId = ?',
      [req.params.id, userId]
    );
```

Replace with:

```js
    const buddyRows = await query(
      'SELECT userId, nickname, evaluated FROM post_buddies WHERE postId = ? AND userId = ?',
      [req.params.id, userId]
    );
```

- [ ] **Step 3: Replace the flag-update line**

Find (approx line 720–721):

```js
    // 更新对应标志位
    const flagField = isPublisher ? 'publisherEvaluated' : 'buddyEvaluated';
    await query(`UPDATE posts SET ${flagField} = 1 WHERE id = ?`, [req.params.id]);
```

Replace with:

```js
    // 更新对应标志位
    if (isPublisher) {
      await query('UPDATE posts SET publisherEvaluated = 1 WHERE id = ?', [req.params.id]);
    } else {
      await query('UPDATE post_buddies SET evaluated = 1 WHERE postId = ? AND userId = ?', [req.params.id, userId]);
    }
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/server.js
git commit -m "fix: track buddy evaluation state per-buddy via post_buddies.evaluated"
```

---

## Task 3: Fix settlement — all buddies earn points, trigger when all have evaluated

**Files:**
- Modify: `backend/src/server.js` (lines ~724–739)

The current settlement fires when `publisherEvaluated && buddyEvaluated` and only credits the publisher. The new logic fires when the publisher AND **every** buddy have evaluated, and credits each buddy.

- [ ] **Step 1: Replace the settlement block**

Find (approx lines 724–739):

```js
    // 重新读取最新 post 状态
    const freshPost = (await query('SELECT * FROM posts WHERE id = ?', [req.params.id]))[0];

    // 双方都已评价 → 已完成，结算积分
    if (freshPost.publisherEvaluated && freshPost.buddyEvaluated) {
      await withTransaction(async (connection) => {
        await connection.execute(
          'UPDATE posts SET status = ?, progress = 100 WHERE id = ?',
          ['已完成', req.params.id]
        );
        await connection.execute(
          'UPDATE users SET points = points + ? WHERE id = ?',
          [freshPost.reward, freshPost.publisherId]
        );
      });
      await recalcCompletionRate(freshPost.publisherId);
    }
```

Replace with:

```js
    // 重新读取最新 post 状态
    const freshPost = (await query('SELECT * FROM posts WHERE id = ?', [req.params.id]))[0];

    // 所有参与者都已评价 → 已完成，结算积分
    const unevaluatedBuddies = await query(
      'SELECT userId FROM post_buddies WHERE postId = ? AND evaluated = 0',
      [req.params.id]
    );
    const allBuddiesEvaluated = unevaluatedBuddies.length === 0;

    if (freshPost.publisherEvaluated && allBuddiesEvaluated) {
      const allBuddies = await query(
        'SELECT userId FROM post_buddies WHERE postId = ?',
        [req.params.id]
      );
      await withTransaction(async (connection) => {
        await connection.execute(
          'UPDATE posts SET status = ?, progress = 100 WHERE id = ?',
          ['已完成', req.params.id]
        );
        // 发布者获得奖励积分
        await connection.execute(
          'UPDATE users SET points = points + ? WHERE id = ?',
          [freshPost.reward, freshPost.publisherId]
        );
        // 每位搭子也获得奖励积分
        for (const buddy of allBuddies) {
          await connection.execute(
            'UPDATE users SET points = points + ? WHERE id = ?',
            [freshPost.reward, buddy.userId]
          );
        }
      });
      await recalcCompletionRate(freshPost.publisherId);
    }
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/server.js
git commit -m "fix: settle points for all buddies on task completion, not just publisher"
```

---

## Task 4: Fix join — respect startTime before auto-advancing to 进行中

**Files:**
- Modify: `backend/src/server.js` (line ~502)

- [ ] **Step 1: Replace the newStatus line in the join handler**

Find (approx lines 501–507):

```js
      const newCount = post.currentBuddies + 1;
      const newStatus = newCount >= post.maxBuddies ? '进行中' : '招募中';
      // buddyName 记录最后一位（保持向后兼容）
      await connection.execute(
        'UPDATE posts SET currentBuddies = ?, buddyName = ?, status = ? WHERE id = ?',
        [newCount, user.nickname, newStatus, req.params.id]
      );
```

Replace with:

```js
      const newCount = post.currentBuddies + 1;
      const now = new Date();
      const startReached = !post.startTime || new Date(post.startTime) <= now;
      const newStatus = (newCount >= post.maxBuddies && startReached) ? '进行中' : '招募中';
      // buddyName 记录最后一位（保持向后兼容）
      await connection.execute(
        'UPDATE posts SET currentBuddies = ?, buddyName = ?, status = ? WHERE id = ?',
        [newCount, user.nickname, newStatus, req.params.id]
      );
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/server.js
git commit -m "fix: joining full post only auto-starts if startTime has been reached"
```

---

## Task 5: Update frontend — derive myEvaluated from buddies array

**Files:**
- Modify: `miniprogram/pages/post-detail/post-detail.js`

The frontend currently uses `post.buddyEvaluated` for all buddies. Replace it with a per-user check from the `buddies` array (which now carries the `evaluated` field from the backend).

- [ ] **Step 1: Update `_loadDetail` — fix myEvaluated derivation**

Find (approx lines 65–67 in post-detail.js):

```js
      const myEvaluated = isPublisher
        ? Boolean(post.publisherEvaluated)
        : isBuddy ? Boolean(post.buddyEvaluated) : false;
```

Replace with:

```js
      const myBuddy = buddies.find(b => b.userId === currentUserId);
      const myEvaluated = isPublisher
        ? Boolean(post.publisherEvaluated)
        : isBuddy ? Boolean(myBuddy && myBuddy.evaluated) : false;
```

- [ ] **Step 2: Verify the buddies query returns `evaluated`**

In `backend/src/server.js`, find the buddies SELECT in `GET /api/posts/:id` (approx line 278):

```js
    const buddies = await query(
      'SELECT userId, nickname, joinedAt FROM post_buddies WHERE postId = ? ORDER BY joinedAt ASC',
      [req.params.id]
    );
```

Replace with:

```js
    const buddies = await query(
      'SELECT userId, nickname, joinedAt, evaluated FROM post_buddies WHERE postId = ? ORDER BY joinedAt ASC',
      [req.params.id]
    );
```

Also update the buddies SELECT in `POST /api/posts/:id/join` response (approx line 511):

```js
    const buddies = await query(
      'SELECT userId, nickname, joinedAt FROM post_buddies WHERE postId = ? ORDER BY joinedAt ASC',
      [req.params.id]
    );
```

Replace with:

```js
    const buddies = await query(
      'SELECT userId, nickname, joinedAt, evaluated FROM post_buddies WHERE postId = ? ORDER BY joinedAt ASC',
      [req.params.id]
    );
```

And same fix for `POST /api/posts/:id/quit` response (approx line 565):

```js
    const buddies = await query(
      'SELECT userId, nickname, joinedAt FROM post_buddies WHERE postId = ? ORDER BY joinedAt ASC',
      [req.params.id]
    );
```

Replace with:

```js
    const buddies = await query(
      'SELECT userId, nickname, joinedAt, evaluated FROM post_buddies WHERE postId = ? ORDER BY joinedAt ASC',
      [req.params.id]
    );
```

- [ ] **Step 3: Commit**

```bash
git add miniprogram/pages/post-detail/post-detail.js backend/src/server.js
git commit -m "fix: derive myEvaluated per-buddy from buddies array; expose evaluated field in API responses"
```

---

## Task 6: Manual verification

- [ ] **Scenario A — multiple buddies, all must evaluate before completion**
  1. Create a post with `maxBuddies = 2`.
  2. Two different users join.
  3. Start and complete the task (advance to 待评价).
  4. Buddy A submits evaluation → task should still be 待评价.
  5. Buddy B submits evaluation → task should still be 待评价 (publisher hasn't evaluated).
  6. Publisher submits evaluation → task should become 已完成.
  7. Check that publisher, buddy A, and buddy B all received `reward` points.

- [ ] **Scenario B — buddy duplicate evaluation rejected**
  1. Buddy A submits evaluation.
  2. Buddy A tries to submit again → should get 400 "你已经提交过评价了".
  3. Buddy B is not blocked; Buddy B can submit successfully.

- [ ] **Scenario C — join with future startTime**
  1. Create a post with `maxBuddies = 1` and `startTime` 1 hour in the future.
  2. One buddy joins → `currentBuddies` becomes 1 (= maxBuddies) but status stays `招募中`.
  3. After `startTime` passes, `syncPostStatus` advances it to `进行中`.
