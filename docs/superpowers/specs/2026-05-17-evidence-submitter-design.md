# 证据提交者标识设计文档

**日期：** 2026-05-17  
**状态：** 待实现

## 问题

`evidences` 表缺少提交者字段，导致展示证据列表时无法区分是发布者还是搭子提交的。每个参与者应有唯一一条证据（可覆盖修改），且展示时需显示提交者昵称。

## 方案

方案 A：`evidences` 表加 `submitterId` + `submitterName`，并对 `(postId, submitterId)` 加 UNIQUE 约束，写入用 `INSERT ... ON DUPLICATE KEY UPDATE` 实现覆盖语义。

## 数据库变更

### 建表语句（`db.js`）

```sql
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
)
```

### 旧表迁移（兼容脚本，`db.js` 启动时执行）

```sql
-- 若 submitterId 列不存在则补加
ALTER TABLE evidences
  ADD COLUMN submitterId VARCHAR(64) NOT NULL DEFAULT '' AFTER postId,
  ADD COLUMN submitterName VARCHAR(100) NOT NULL DEFAULT '' AFTER submitterId;

-- 加唯一约束（若尚未存在）
ALTER TABLE evidences
  ADD UNIQUE KEY uq_evidence_post_user (postId, submitterId);
```

## 后端变更（`server.js`）

### `POST /api/posts/:id/evidence`

**请求体：** `{ userId, submitterName, content }`

**写入逻辑：**
```sql
INSERT INTO evidences (id, postId, submitterId, submitterName, type, value)
VALUES (?, ?, ?, ?, '文字', ?)
ON DUPLICATE KEY UPDATE
  id = VALUES(id),
  submitterName = VALUES(submitterName),
  value = VALUES(value),
  createdAt = NOW()
```

**响应：** `{ id, submitterId, submitterName, type, value }`

### `GET /api/posts/:id`

`evidenceList` 查询改为：
```sql
SELECT submitterId, submitterName, type, value
FROM evidences WHERE postId = ? ORDER BY createdAt ASC
```

## 前端变更

### `services/api.js`

```js
// 改为
function submitEvidence(postId, userId, submitterName, content) {
  return request({
    url: `/api/posts/${postId}/evidence`,
    method: 'POST',
    data: { userId, submitterName, content }
  });
}
```

### `pages/post-detail/post-detail.js`

`submitEvidence()` 方法从 `app.globalData.userInfo.nickname` 取昵称：

```js
async submitEvidence() {
  const { post, currentUserId, evidenceInput } = this.data;
  const userInfo = app.globalData.userInfo || wx.getStorageSync('userInfo');
  const submitterName = userInfo ? userInfo.nickname : currentUserId;
  // ...
  await api.submitEvidence(post.id, currentUserId, submitterName, evidenceInput);
}
```

### `pages/post-detail/post-detail.wxml`

```xml
<!-- 改为 -->
<view class="evidence-item">{{item.submitterName}}：{{item.value}}</view>
```

## 数据一致性

- 唯一约束 `(postId, submitterId)` 由数据库强制，无竞态风险
- 覆盖时 `id` 更新为新 id，`createdAt` 重置为当前时间，保证排序反映最新提交顺序
- 旧数据（`submitterId = ''`）不冲突，可保留或后续清理
