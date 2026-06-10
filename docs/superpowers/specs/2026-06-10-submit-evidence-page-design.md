# 证据提交独立页面设计文档

**日期：** 2026-06-10
**状态：** 已审批

---

## 背景

现有系统中，证据提交通过 post-detail 页面内的内联展开表单实现，仅支持文字输入。本设计将证据提交改为独立页面，并支持文字 + 最多 3 张图片，与评价页面（evaluate）的交互模式保持一致。

---

## 需求

- 证据提交入口改为跳转到独立页面，不再在 post-detail 内展开内联表单。
- 新页面支持文字（必填）+ 图片（可选，最多 3 张）。
- 已提交过证据时，进入页面回显上次内容，允许覆盖提交。
- 图片上传独立于最终提交，逐张上传、立即预览，可删除。
- 返回 post-detail 后自动刷新详情。

---

## 架构

### 新页面

`miniprogram/pages/submit-evidence/`，包含 4 个文件：

- `submit-evidence.js`
- `submit-evidence.wxml`
- `submit-evidence.wxss`
- `submit-evidence.json`

在 `miniprogram/app.json` 的 `pages` 数组中注册。

### 入口改动

post-detail 中"提交证据"按钮改为：

```js
wx.navigateTo({
  url: `/pages/submit-evidence/submit-evidence?postId=${post.id}`
});
```

移除 post-detail 中的以下内容（内联表单相关）：
- `data` 中的 `showEvidenceForm`、`evidenceInput`
- 方法：`openEvidenceForm`、`closeEvidenceForm`、`onEvidenceInput`、`submitEvidence`
- wxml 中的 `evidence-form` 块

### 返回刷新

post-detail 的 `onShow` 已有 `_returnFromEvaluate` 刷新机制。新增 `_returnFromEvidence` flag，证据页面返回时触发 `_loadDetail` 刷新，逻辑与 evaluate 完全对称。

---

## 前端页面设计

### submit-evidence 页面结构（从上到下）

```
帖子标题（只读，从 getPostDetail 返回值取得，API 加载前显示空）

证据说明
  textarea（placeholder: "描述你的完成情况..."）

图片
  最多 3 张缩略图，每张右上角有删除按钮
  已选 < 3 张时显示"+"添加按钮
  已选满 3 张时"+"按钮隐藏

[提交] 按钮（submitting 态防重复点击）
```

### 数据流

1. `onLoad` 接收 `postId`，从 `options` 解析。读取当前用户信息（`globalData` 或 `storage`）。
2. 调用 `api.getPostDetail(postId, currentUserId)`，从 `evidenceList` 中找 `submitterId === currentUserId` 的记录，回填 `evidenceText` 和 `imageUrls`。
3. 用户点"+"：调 `wx.chooseMedia({ count: 3 - imageUrls.length, mediaType: ['image'] })`，选完后逐张调 `wx.uploadFile` 上传到 `/api/upload`，成功后将返回的 URL 追加到 `imageUrls` 数组。
4. 用户点缩略图删除：从本地 `imageUrls` 数组移除对应项，不通知后端。
5. 点"提交"：`evidenceText` 为空则提示"请填写证据内容"并阻止提交；否则调 `api.submitEvidence(postId, currentUserId, submitterName, text, imageUrls)`，成功后 `wx.navigateBack()`。

### 错误处理

| 场景 | 处理方式 |
|------|---------|
| 文字为空点提交 | toast 提示"请填写证据内容"，阻止提交 |
| 单张图片上传失败 | toast 提示，不影响其他图片，不阻止提交 |
| 提交接口失败 | toast 提示，保留页面状态 |

---

## 后端改动

### 新增依赖

```bash
npm install multer
```

`multer` 处理 `multipart/form-data` 文件上传，图片存本地 `backend/uploads/` 目录。

### 静态文件路由

```js
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
```

### 新接口：`POST /api/upload`

- 接收 `multipart/form-data`，字段名 `file`，限单张图片
- multer 存至 `backend/uploads/`，文件名使用随机 UUID + 原始扩展名
- 返回 `{ url: "/uploads/<filename>" }`
- 无鉴权（小程序端已保证只有参与者可进入证据页面）

### 数据库迁移

```sql
ALTER TABLE evidences ADD COLUMN imageUrls TEXT NULL;
-- NULL 表示无图片，存储格式为 JSON 数组字符串，如 '["url1","url2"]'
```

### 修改：`POST /api/posts/:id/evidence`

- 请求体新增 `imageUrls`（字符串数组，可选）
- 后端验证 `Array.isArray(imageUrls) && imageUrls.length <= 3`，不符合返回 400
- 序列化为 JSON 字符串存入 `evidences.imageUrls`
- `ON DUPLICATE KEY UPDATE` 同时更新 `imageUrls` 字段

### 修改：`GET /api/posts/:id`

`evidenceList` 中每条记录的 `imageUrls` 字段，在返回前解析：

```js
imageUrls: row.imageUrls ? JSON.parse(row.imageUrls) : []
```

### 修改：`miniprogram/services/api.js`

```js
function submitEvidence(postId, userId, submitterName, content, imageUrls = []) {
  return request({
    url: `/api/posts/${postId}/evidence`,
    method: 'POST',
    data: { userId, submitterName, content, imageUrls }
  });
}
```

---

## 不在本期范围内

- 图片压缩或格式限制（交由微信 `chooseMedia` 默认行为处理）
- 证据图片的云存储（本期使用本地磁盘）
- 证据提交后的通知推送
