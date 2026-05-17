# Evidence Submitter Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `submitterId` and `submitterName` columns to the `evidences` table so each participant can submit exactly one evidence record (upsert semantics), and display the submitter's nickname in the evidence list.

**Architecture:** DB migration adds two columns + a unique constraint `(postId, submitterId)`. The backend `POST` endpoint switches from `INSERT` to `INSERT … ON DUPLICATE KEY UPDATE`. The backend `GET` endpoint returns the two new fields. The frontend service, page logic, and template are updated to pass and render the submitter name.

**Tech Stack:** Node.js / Express, MySQL 2 (mysql2), WeChat Miniprogram (WXML/JS)

---

## File Map

| File | Change |
|------|--------|
| `backend/src/db.js` | Add migration block: new columns + unique key |
| `backend/src/server.js` | Update `POST /api/posts/:id/evidence` (upsert) and `GET /api/posts/:id` (return new fields) |
| `miniprogram/services/api.js` | Add `submitterName` param to `submitEvidence` |
| `miniprogram/pages/post-detail/post-detail.js` | Pass `submitterName` from `globalData.userInfo.nickname` |
| `miniprogram/pages/post-detail/post-detail.wxml` | Render `item.submitterName` instead of `item.type` |

---

### Task 1: DB Migration — add columns and unique constraint

**Files:**
- Modify: `backend/src/db.js`

- [ ] **Step 1: Locate the migration section in db.js**

  Open [backend/src/db.js](backend/src/db.js) and find the block that starts around line 211:
  ```js
  // 兼容旧表：evaluations 加 fromId
  const fromIdCol = await query(`SHOW COLUMNS FROM evaluations LIKE 'fromId'`);
  ```
  The new migration block goes **after** the existing `completionRequests` migration (around line 221).

- [ ] **Step 2: Add migration block for submitterId column**

  After the `completionRequests` migration block, insert:
  ```js
  // 兼容旧表：evidences 加 submitterId / submitterName / unique key
  const evidenceSubmitterCol = await query(`SHOW COLUMNS FROM evidences LIKE 'submitterId'`);
  if (evidenceSubmitterCol.length === 0) {
    await query(`
      ALTER TABLE evidences
        ADD COLUMN submitterId VARCHAR(64) NOT NULL DEFAULT '' AFTER postId,
        ADD COLUMN submitterName VARCHAR(100) NOT NULL DEFAULT '' AFTER submitterId
    `);
  }
  const evidenceUniqueKey = await query(`
    SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'evidences'
      AND CONSTRAINT_NAME = 'uq_evidence_post_user'
  `);
  if (evidenceUniqueKey.length === 0) {
    await query(`
      ALTER TABLE evidences
        ADD UNIQUE KEY uq_evidence_post_user (postId, submitterId)
    `);
  }
  ```

- [ ] **Step 3: Update the CREATE TABLE statement for evidences**

  Replace the existing `CREATE TABLE IF NOT EXISTS evidences` block (lines 187–196) with:
  ```js
  await query(`
    CREATE TABLE IF NOT EXISTS evidences (
      id VARCHAR(64) PRIMARY KEY,
      postId VARCHAR(64) NOT NULL,
      submitterId VARCHAR(64) NOT NULL DEFAULT '',
      submitterName VARCHAR(100) NOT NULL DEFAULT '',
      type VARCHAR(50) NOT NULL,
      value TEXT NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_evidence_post_user (postId, submitterId),
      CONSTRAINT fk_evidences_post FOREIGN KEY (postId) REFERENCES posts(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  ```

- [ ] **Step 4: Verify migration runs without error**

  Start the backend (or restart if already running):
  ```bash
  cd backend && node src/server.js
  ```
  Expected: Server starts, no MySQL error about `evidences` table or unknown columns.

  Then in a separate terminal confirm the columns exist:
  ```bash
  node -e "
  const mysql = require('mysql2/promise');
  (async () => {
    const pool = mysql.createPool({ host:'127.0.0.1', port:3306, user:'root', password:'123456', database:'task_buddy' });
    const [rows] = await pool.execute(\"SHOW COLUMNS FROM evidences\");
    rows.forEach(r => console.log(r.Field));
    await pool.end();
  })();"
  ```
  Expected output includes: `id`, `postId`, `submitterId`, `submitterName`, `type`, `value`, `createdAt`

- [ ] **Step 5: Commit**

  ```bash
  git add backend/src/db.js
  git commit -m "feat: evidences 表新增 submitterId / submitterName 列及唯一约束迁移"
  ```

---

### Task 2: Backend — upsert on POST /api/posts/:id/evidence

**Files:**
- Modify: `backend/src/server.js` (lines ~576–624)

- [ ] **Step 1: Update request body destructuring**

  In `app.post('/api/posts/:id/evidence', ...)`, change:
  ```js
  const { userId, content } = req.body;
  if (!userId || !String(content || '').trim()) {
    return res.status(400).json({ message: '缺少 userId 或证据内容' });
  }
  ```
  to:
  ```js
  const { userId, submitterName, content } = req.body;
  if (!userId || !String(content || '').trim()) {
    return res.status(400).json({ message: '缺少 userId 或证据内容' });
  }
  const safeSubmitterName = String(submitterName || userId).trim();
  ```

- [ ] **Step 2: Replace INSERT with upsert**

  Replace:
  ```js
  const id = createId('e');
  await query(
    'INSERT INTO evidences (id, postId, type, value) VALUES (?, ?, ?, ?)',
    [id, req.params.id, '文字', String(content).trim()]
  );

  const evidence = { id, type: '文字', value: String(content).trim() };
  res.status(201).json(evidence);
  ```
  with:
  ```js
  const id = createId('e');
  const trimmedValue = String(content).trim();
  await query(
    `INSERT INTO evidences (id, postId, submitterId, submitterName, type, value)
     VALUES (?, ?, ?, ?, '文字', ?)
     ON DUPLICATE KEY UPDATE
       id = VALUES(id),
       submitterName = VALUES(submitterName),
       value = VALUES(value),
       createdAt = NOW()`,
    [id, req.params.id, userId, safeSubmitterName, trimmedValue]
  );

  const evidence = { id, submitterId: userId, submitterName: safeSubmitterName, type: '文字', value: trimmedValue };
  res.status(201).json(evidence);
  ```

- [ ] **Step 3: Manual test — POST creates evidence with submitter info**

  ```bash
  # Replace POST_ID and USER_ID with real values from your DB
  curl -s -X POST http://localhost:3000/api/posts/POST_ID/evidence \
    -H "Content-Type: application/json" \
    -d '{"userId":"USER_ID","submitterName":"测试昵称","content":"完成截图已上传"}' | node -e "process.stdin.setEncoding('utf8');let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d)))"
  ```
  Expected: `{ id: 'e...', submitterId: 'USER_ID', submitterName: '测试昵称', type: '文字', value: '完成截图已上传' }`

- [ ] **Step 4: Manual test — second POST from same user overwrites**

  Run the same curl again with `"content":"修改后的内容"`. Then query the DB:
  ```bash
  node -e "
  const mysql = require('mysql2/promise');
  (async () => {
    const pool = mysql.createPool({ host:'127.0.0.1', port:3306, user:'root', password:'123456', database:'task_buddy' });
    const [rows] = await pool.execute('SELECT * FROM evidences WHERE postId = ?', ['POST_ID']);
    console.log(rows);
    await pool.end();
  })();"
  ```
  Expected: exactly **one** row for that `(postId, userId)` pair, with `value = '修改后的内容'`.

- [ ] **Step 5: Commit**

  ```bash
  git add backend/src/server.js
  git commit -m "feat: POST /api/posts/:id/evidence 改为 upsert，携带 submitterId / submitterName"
  ```

---

### Task 3: Backend — GET /api/posts/:id returns submitter fields

**Files:**
- Modify: `backend/src/server.js` (lines ~270–273)

- [ ] **Step 1: Update the evidenceList SELECT**

  In `app.get('/api/posts/:id', ...)`, replace:
  ```js
  const evidenceList = await query(
    'SELECT type, value FROM evidences WHERE postId = ? ORDER BY createdAt ASC',
    [req.params.id]
  );
  ```
  with:
  ```js
  const evidenceList = await query(
    'SELECT submitterId, submitterName, type, value FROM evidences WHERE postId = ? ORDER BY createdAt ASC',
    [req.params.id]
  );
  ```

- [ ] **Step 2: Manual test — GET returns submitter fields**

  ```bash
  curl -s http://localhost:3000/api/posts/POST_ID | node -e "process.stdin.setEncoding('utf8');let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{ const r=JSON.parse(d); console.log(r.evidenceList); })"
  ```
  Expected: array of objects each with `submitterId`, `submitterName`, `type`, `value`.

- [ ] **Step 3: Commit**

  ```bash
  git add backend/src/server.js
  git commit -m "feat: GET /api/posts/:id 的 evidenceList 新增 submitterId / submitterName 字段"
  ```

---

### Task 4: Frontend service — pass submitterName

**Files:**
- Modify: `miniprogram/services/api.js` (lines ~96–102)

- [ ] **Step 1: Update submitEvidence signature**

  Replace:
  ```js
  function submitEvidence(postId, userId, content) {
    return request({
      url: `/api/posts/${postId}/evidence`,
      method: 'POST',
      data: { userId, content }
    });
  }
  ```
  with:
  ```js
  function submitEvidence(postId, userId, submitterName, content) {
    return request({
      url: `/api/posts/${postId}/evidence`,
      method: 'POST',
      data: { userId, submitterName, content }
    });
  }
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add miniprogram/services/api.js
  git commit -m "feat: api.submitEvidence 新增 submitterName 参数"
  ```

---

### Task 5: Frontend page logic — read nickname and pass it

**Files:**
- Modify: `miniprogram/pages/post-detail/post-detail.js` (lines ~203–217)

- [ ] **Step 1: Update submitEvidence method**

  Replace the current `submitEvidence` method body:
  ```js
  async submitEvidence() {
    const { post, currentUserId, evidenceInput } = this.data;
    if (!String(evidenceInput).trim()) {
      wx.showToast({ title: '请填写证据内容', icon: 'none' });
      return;
    }
    try {
      await api.submitEvidence(post.id, currentUserId, evidenceInput);
      wx.showToast({ title: '证据已提交', icon: 'success' });
      this.setData({ showEvidenceForm: false, evidenceInput: '' });
      await this._loadDetail(post.id);
    } catch (error) {
      wx.showToast({ title: error.message || '提交失败', icon: 'none' });
    }
  },
  ```
  with:
  ```js
  async submitEvidence() {
    const { post, currentUserId, evidenceInput } = this.data;
    if (!String(evidenceInput).trim()) {
      wx.showToast({ title: '请填写证据内容', icon: 'none' });
      return;
    }
    const userInfo = app.globalData.userInfo || wx.getStorageSync('userInfo');
    const submitterName = (userInfo && userInfo.nickname) ? userInfo.nickname : currentUserId;
    try {
      await api.submitEvidence(post.id, currentUserId, submitterName, evidenceInput);
      wx.showToast({ title: '证据已提交', icon: 'success' });
      this.setData({ showEvidenceForm: false, evidenceInput: '' });
      await this._loadDetail(post.id);
    } catch (error) {
      wx.showToast({ title: error.message || '提交失败', icon: 'none' });
    }
  },
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add miniprogram/pages/post-detail/post-detail.js
  git commit -m "feat: submitEvidence 从 globalData.userInfo.nickname 取昵称传给接口"
  ```

---

### Task 6: Frontend template — show submitter nickname

**Files:**
- Modify: `miniprogram/pages/post-detail/post-detail.wxml` (lines ~82–84)

- [ ] **Step 1: Update evidence list rendering**

  Replace:
  ```xml
  <block wx:for="{{evidenceList}}" wx:key="index">
    <view class="evidence-item">{{item.type}}：{{item.value}}</view>
  </block>
  ```
  with:
  ```xml
  <block wx:for="{{evidenceList}}" wx:key="index">
    <view class="evidence-item">{{item.submitterName}}：{{item.value}}</view>
  </block>
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add miniprogram/pages/post-detail/post-detail.wxml
  git commit -m "feat: 证据列表改为展示提交者昵称"
  ```

---

### Task 7: End-to-end smoke test

- [ ] **Step 1: Restart backend**

  ```bash
  cd backend && node src/server.js
  ```

- [ ] **Step 2: Open miniprogram in WeChat DevTools**

  Navigate to a post that is in `'已完成'` or past `endTime`. Open the post-detail page.

- [ ] **Step 3: Submit evidence as publisher**

  Tap "提交证据", fill in content, tap "提交".
  Expected: Toast "证据已提交". Evidence list refreshes and shows `<你的昵称>：<内容>`.

- [ ] **Step 4: Submit evidence as buddy**

  Switch to a buddy account. Open the same post-detail. Submit evidence.
  Expected: A second evidence item appears with the buddy's nickname.

- [ ] **Step 5: Re-submit (overwrite) as same user**

  Submit again as the same user with different content.
  Expected: The evidence item for that user updates in place (list still shows one entry per user, not a duplicate).
