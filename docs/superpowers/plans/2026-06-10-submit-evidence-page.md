# Submit Evidence Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将证据提交从 post-detail 内联表单改为独立页面，支持文字 + 最多 3 张图片。

**Architecture:** 新建 `miniprogram/pages/submit-evidence/` 页面，入口从 post-detail 改为 `wx.navigateTo` 跳转；后端新增 `multer` 文件上传接口，`evidences` 表新增 `imageUrls` TEXT 列；api.js `submitEvidence` 签名增加 `imageUrls` 参数。

**Tech Stack:** 微信小程序原生、Node.js/Express、MySQL、multer（新增）

---

## 文件变更总览

| 操作 | 文件 |
|------|------|
| Modify | `backend/package.json` |
| Modify | `backend/src/server.js` |
| Modify | `miniprogram/services/api.js` |
| Modify | `miniprogram/app.json` |
| Modify | `miniprogram/pages/post-detail/post-detail.js` |
| Modify | `miniprogram/pages/post-detail/post-detail.wxml` |
| Create | `miniprogram/pages/submit-evidence/submit-evidence.js` |
| Create | `miniprogram/pages/submit-evidence/submit-evidence.wxml` |
| Create | `miniprogram/pages/submit-evidence/submit-evidence.wxss` |
| Create | `miniprogram/pages/submit-evidence/submit-evidence.json` |

---

## Task 1: 数据库迁移 + 安装 multer

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: 安装 multer**

```bash
cd backend
npm install multer@1.4.5-lts.1
```

Expected output: multer 出现在 `backend/node_modules/`，`package.json` dependencies 新增 `"multer": "1.4.5-lts.1"`

- [ ] **Step 2: 执行数据库迁移**

在你的 MySQL 客户端（或通过 `mysql` CLI）对项目数据库执行：

```sql
ALTER TABLE evidences ADD COLUMN imageUrls TEXT NULL;
```

Expected output: `Query OK, 0 rows affected`（若已有数据则显示行数）

- [ ] **Step 3: 验证列已存在**

```sql
DESCRIBE evidences;
```

确认输出中包含 `imageUrls` 列，类型为 `text`，Null 为 `YES`。

- [ ] **Step 4: Commit**

```bash
cd ..
git add backend/package.json backend/package-lock.json
git commit -m "feat: install multer for image upload"
```

---

## Task 2: 后端 — POST /api/upload 接口

**Files:**
- Modify: `backend/src/server.js`（在文件顶部 require 区和路由区各增加内容）

- [ ] **Step 1: 在 server.js 顶部添加 multer 引用**

在 `backend/src/server.js` 文件顶部，找到现有的 `require` 语句块（前几行），在其后添加：

```js
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${createId('img')}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });
```

注意：`createId` 在 server.js 中已定义，可直接使用。

- [ ] **Step 2: 添加静态文件路由**

在 `app.use(cors(...))` 等 middleware 注册之后，路由定义之前，添加：

```js
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
```

- [ ] **Step 3: 添加 POST /api/upload 路由**

在 `app.post('/api/posts/:id/evidence', ...)` 路由之前添加：

```js
app.post('/api/upload', upload.single('file'), (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: '未收到文件' });
    res.json({ url: `/uploads/${req.file.filename}` });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 4: 启动后端验证接口可用**

```bash
cd backend
node src/server.js
```

用任意 HTTP 客户端（curl 或 Postman）发送一张图片：

```bash
curl -X POST http://127.0.0.1:3000/api/upload \
  -F "file=@/path/to/test.jpg"
```

Expected response:
```json
{ "url": "/uploads/img_xxxxxxxx.jpg" }
```

验证 `backend/uploads/` 目录下有对应文件生成。

- [ ] **Step 5: Commit**

```bash
git add backend/src/server.js
git commit -m "feat: add POST /api/upload image upload endpoint"
```

---

## Task 3: 后端 — 修改 POST /api/posts/:id/evidence 支持 imageUrls

**Files:**
- Modify: `backend/src/server.js`（`app.post('/api/posts/:id/evidence', ...)` 路由）

- [ ] **Step 1: 修改路由，接收并存储 imageUrls**

找到 `backend/src/server.js` 中的 `app.post('/api/posts/:id/evidence', ...)` 路由，将整个路由替换为：

```js
app.post('/api/posts/:id/evidence', async (req, res, next) => {
  try {
    await syncPostStatus(req.params.id);
    const { userId, submitterName, content, imageUrls } = req.body;
    if (!userId || !String(content || '').trim()) return res.status(400).json({ message: '缺少 userId 或证据内容' });

    const safeImageUrls = Array.isArray(imageUrls) ? imageUrls.slice(0, 3) : [];
    if (safeImageUrls.length > 3) return res.status(400).json({ message: '图片最多 3 张' });

    const safeSubmitterName = String(submitterName || userId).trim();

    const postRows = await query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    const post = postRows[0];
    if (!post) return res.status(404).json({ message: '帖子不存在' });

    const buddyRows = await query('SELECT id FROM post_buddies WHERE postId = ? AND userId = ?', [req.params.id, userId]);
    const isPublisher = post.publisherId === userId;
    const isBuddy = buddyRows.length > 0;
    if (!isPublisher && !isBuddy) return res.status(403).json({ message: '只有参与者才能提交证据' });

    const now = new Date();
    const ended = post.endTime && new Date(post.endTime) <= now;
    if (post.status !== '已完成' && !ended) {
      const endStr = post.endTime ? new Date(post.endTime).toLocaleString('zh-CN') : '未设置结束时间';
      return res.status(400).json({ message: `任务尚未结束，证据须在任务完成后或到达结束时间（${endStr}）后提交` });
    }

    const id = createId('e');
    const trimmedValue = String(content).trim();
    const imageUrlsJson = safeImageUrls.length > 0 ? JSON.stringify(safeImageUrls) : null;

    const result = await query(
      `INSERT INTO evidences (id, postId, submitterId, submitterName, type, value, imageUrls) VALUES (?, ?, ?, ?, '文字', ?, ?)
       ON DUPLICATE KEY UPDATE id = VALUES(id), submitterName = VALUES(submitterName), value = VALUES(value), imageUrls = VALUES(imageUrls), createdAt = NOW()`,
      [id, req.params.id, userId, safeSubmitterName, trimmedValue, imageUrlsJson]
    );

    const evidence = {
      id,
      submitterId: userId,
      submitterName: safeSubmitterName,
      type: '文字',
      value: trimmedValue,
      imageUrls: safeImageUrls
    };
    const statusCode = result.affectedRows === 1 ? 201 : 200;
    res.status(statusCode).json(evidence);
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/server.js
git commit -m "feat: evidence endpoint accepts imageUrls field"
```

---

## Task 4: 后端 — GET /api/posts/:id 解析 evidenceList.imageUrls

**Files:**
- Modify: `backend/src/server.js`（`GET /api/posts/:id` 路由中的 evidenceList 处理）

- [ ] **Step 1: 找到 evidenceList 查询并添加 imageUrls 解析**

在 `GET /api/posts/:id` 路由中，找到以下查询语句：

```js
const evidenceList = await query(
  'SELECT submitterId, submitterName, type, value FROM evidences WHERE postId = ? ORDER BY createdAt ASC',
  [req.params.id]
);
```

将其替换为：

```js
const evidenceRows = await query(
  'SELECT submitterId, submitterName, type, value, imageUrls FROM evidences WHERE postId = ? ORDER BY createdAt ASC',
  [req.params.id]
);
const evidenceList = evidenceRows.map(row => ({
  ...row,
  imageUrls: row.imageUrls ? JSON.parse(row.imageUrls) : []
}));
```

- [ ] **Step 2: 重启后端并验证**

重启 `node src/server.js`，用浏览器或 curl 访问：

```bash
curl "http://127.0.0.1:3000/api/posts/<任意postId>?viewerId=<userId>"
```

确认返回的 `evidenceList` 中每条记录包含 `imageUrls` 字段（数组类型）。

- [ ] **Step 3: Commit**

```bash
git add backend/src/server.js
git commit -m "feat: parse imageUrls in evidenceList response"
```

---

## Task 5: 前端 — 更新 api.js submitEvidence 签名

**Files:**
- Modify: `miniprogram/services/api.js`

- [ ] **Step 1: 更新 submitEvidence 函数**

找到 `miniprogram/services/api.js` 中的：

```js
function submitEvidence(postId, userId, submitterName, content) {
  return request({ url: `/api/posts/${postId}/evidence`, method: 'POST', data: { userId, submitterName, content } });
}
```

替换为：

```js
function submitEvidence(postId, userId, submitterName, content, imageUrls = []) {
  return request({ url: `/api/posts/${postId}/evidence`, method: 'POST', data: { userId, submitterName, content, imageUrls } });
}
```

- [ ] **Step 2: 添加 uploadFile 辅助函数**

在 `submitEvidence` 函数之后添加：

```js
function uploadEvidenceImage(localPath) {
  const config = require('../env');
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${config.apiBaseUrl}/api/upload`,
      filePath: localPath,
      name: 'file',
      success: (res) => {
        try {
          const data = JSON.parse(res.data);
          if (res.statusCode >= 200 && res.statusCode < 300 && data.url) {
            resolve(data.url);
          } else {
            reject(new Error(data.message || '上传失败'));
          }
        } catch (e) {
          reject(new Error('上传响应解析失败'));
        }
      },
      fail: (err) => reject(err)
    });
  });
}
```

- [ ] **Step 3: 在 module.exports 中导出新函数**

找到 `module.exports = { ... }` 块，添加 `uploadEvidenceImage`：

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
  uploadEvidenceImage,
  joinPost,
  quitPost,
  abandonPost,
  submitEvaluation,
  submitCompletionVote,
  startPost,
  requestComplete,
  getEvaluationsReceived,
  getPointLogs,
  getAnnotations,
  createAnnotation,
  deleteAnnotation,
  adminLogin,
  getAdminFeed,
  updatePostAuditStatus
};
```

- [ ] **Step 4: Commit**

```bash
git add miniprogram/services/api.js
git commit -m "feat: update submitEvidence signature and add uploadEvidenceImage"
```

---

## Task 6: 前端 — 创建 submit-evidence 页面

**Files:**
- Create: `miniprogram/pages/submit-evidence/submit-evidence.json`
- Create: `miniprogram/pages/submit-evidence/submit-evidence.wxml`
- Create: `miniprogram/pages/submit-evidence/submit-evidence.wxss`
- Create: `miniprogram/pages/submit-evidence/submit-evidence.js`

- [ ] **Step 1: 创建 submit-evidence.json**

新建文件 `miniprogram/pages/submit-evidence/submit-evidence.json`，内容：

```json
{
  "navigationBarTitleText": "提交证据"
}
```

- [ ] **Step 2: 创建 submit-evidence.wxml**

新建文件 `miniprogram/pages/submit-evidence/submit-evidence.wxml`，内容：

```xml
<view class="container">
  <view class="card">
    <view class="card-title">{{postTitle}}</view>

    <view class="label">证据说明</view>
    <textarea
      class="evidence-textarea"
      placeholder="描述你的完成情况..."
      placeholder-class="placeholder"
      bindinput="onTextInput"
      value="{{evidenceText}}"
    />

    <view class="label img-label">图片（最多 3 张）</view>
    <view class="img-row">
      <block wx:for="{{imageUrls}}" wx:key="index">
        <view class="img-wrap">
          <image class="img-thumb" src="{{item}}" mode="aspectFill" />
          <view class="img-del" data-index="{{index}}" bindtap="removeImage">×</view>
        </view>
      </block>
      <view wx:if="{{imageUrls.length < 3}}" class="img-add" bindtap="chooseImage">+</view>
    </view>

    <view class="form-btns">
      <button class="ghost-btn form-btn" bindtap="cancel">取消</button>
      <button class="primary-btn form-btn" bindtap="submit" disabled="{{submitting}}">提交</button>
    </view>
  </view>
</view>
```

- [ ] **Step 3: 创建 submit-evidence.wxss**

新建文件 `miniprogram/pages/submit-evidence/submit-evidence.wxss`，内容：

```css
.container {
  padding: 24rpx 24rpx 48rpx;
  background: #fffaf4;
  min-height: 100vh;
}

.card {
  background: linear-gradient(180deg, rgba(255,255,255,0.95), rgba(255,244,238,0.92));
  border-radius: 28rpx;
  padding: 32rpx;
  border: 1rpx solid rgba(255,122,89,0.12);
}

.card-title {
  font-size: 32rpx;
  font-weight: 700;
  margin-bottom: 24rpx;
  color: #1e293b;
}

.label {
  font-size: 26rpx;
  color: #64748b;
  margin-bottom: 8rpx;
}

.img-label {
  margin-top: 24rpx;
}

.evidence-textarea {
  width: 100%;
  min-height: 180rpx;
  background: rgba(255,250,244,0.9);
  border: 1rpx solid rgba(255,122,89,0.16);
  border-radius: 16rpx;
  padding: 20rpx;
  box-sizing: border-box;
  font-size: 28rpx;
  line-height: 1.7;
  margin-bottom: 8rpx;
}

.img-row {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
  margin: 12rpx 0 28rpx;
}

.img-wrap {
  position: relative;
  width: 180rpx;
  height: 180rpx;
}

.img-thumb {
  width: 180rpx;
  height: 180rpx;
  border-radius: 12rpx;
  border: 1rpx solid rgba(255,122,89,0.16);
}

.img-del {
  position: absolute;
  top: -16rpx;
  right: -16rpx;
  width: 40rpx;
  height: 40rpx;
  line-height: 40rpx;
  text-align: center;
  background: #ef4444;
  color: #fff;
  border-radius: 50%;
  font-size: 28rpx;
  font-weight: bold;
}

.img-add {
  width: 180rpx;
  height: 180rpx;
  border-radius: 12rpx;
  border: 2rpx dashed rgba(255,122,89,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 64rpx;
  color: rgba(255,122,89,0.5);
  background: rgba(255,250,244,0.6);
}

.form-btns {
  display: flex;
  gap: 20rpx;
}

.form-btn {
  flex: 1;
  height: 76rpx;
  font-size: 28rpx;
}
```

- [ ] **Step 4: 创建 submit-evidence.js**

新建文件 `miniprogram/pages/submit-evidence/submit-evidence.js`，内容：

```js
const api = require('../../services/api');

Page({
  data: {
    postId: '',
    postTitle: '',
    currentUserId: '',
    submitterName: '',
    evidenceText: '',
    imageUrls: [],
    submitting: false
  },

  async onLoad(options) {
    const { postId } = options;
    const app = getApp();
    const userInfo = app.globalData.userInfo || wx.getStorageSync('userInfo');
    const currentUserId = userInfo ? userInfo.id : '';
    const submitterName = userInfo ? (userInfo.nickname || currentUserId) : currentUserId;
    this.setData({ postId, currentUserId, submitterName });

    try {
      const detail = await api.getPostDetail(postId, currentUserId);
      const myEvidence = (detail.evidenceList || []).find(e => e.submitterId === currentUserId);
      this.setData({
        postTitle: detail.post ? detail.post.title : '',
        evidenceText: myEvidence ? myEvidence.value : '',
        imageUrls: myEvidence ? (myEvidence.imageUrls || []) : []
      });
    } catch (err) {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' });
    }
  },

  onTextInput(e) {
    this.setData({ evidenceText: e.detail.value });
  },

  async chooseImage() {
    const remain = 3 - this.data.imageUrls.length;
    if (remain <= 0) return;
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      success: async (res) => {
        for (const file of res.tempFiles) {
          try {
            const url = await api.uploadEvidenceImage(file.tempFilePath);
            this.setData({ imageUrls: [...this.data.imageUrls, url] });
          } catch (err) {
            wx.showToast({ title: '图片上传失败', icon: 'none' });
          }
        }
      }
    });
  },

  removeImage(e) {
    const { index } = e.currentTarget.dataset;
    const imageUrls = [...this.data.imageUrls];
    imageUrls.splice(index, 1);
    this.setData({ imageUrls });
  },

  cancel() {
    wx.navigateBack();
  },

  async submit() {
    if (this.data.submitting) return;
    const { postId, currentUserId, submitterName, evidenceText, imageUrls } = this.data;
    if (!String(evidenceText).trim()) {
      wx.showToast({ title: '请填写证据内容', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    try {
      await api.submitEvidence(postId, currentUserId, submitterName, evidenceText, imageUrls);
      wx.showToast({ title: '证据已提交', icon: 'success' });
      wx.navigateBack();
    } catch (err) {
      wx.showToast({ title: err.message || '提交失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
```

- [ ] **Step 5: Commit**

```bash
git add miniprogram/pages/submit-evidence/
git commit -m "feat: add submit-evidence page with text and image support"
```

---

## Task 7: 前端 — 注册页面 + 改造 post-detail

**Files:**
- Modify: `miniprogram/app.json`
- Modify: `miniprogram/pages/post-detail/post-detail.js`
- Modify: `miniprogram/pages/post-detail/post-detail.wxml`

- [ ] **Step 1: 在 app.json 中注册新页面**

打开 `miniprogram/app.json`，在 `pages` 数组中添加新页面（加在 `evaluate` 之后）：

```json
"pages": [
  "pages/login/login",
  "pages/home/home",
  "pages/publish/publish",
  "pages/ranking/ranking",
  "pages/profile/profile",
  "pages/post-detail/post-detail",
  "pages/score-history/score-history",
  "pages/admin/admin",
  "pages/evaluate/evaluate",
  "pages/submit-evidence/submit-evidence"
]
```

- [ ] **Step 2: 修改 post-detail.js — 移除内联表单，改为跳转**

在 `miniprogram/pages/post-detail/post-detail.js` 中：

**2a.** 在 `data` 对象中，移除 `showEvidenceForm: false` 和 `evidenceInput: ''` 两行。

**2b.** 删除以下 4 个方法（整个方法体）：
- `openEvidenceForm()`
- `closeEvidenceForm()`
- `onEvidenceInput(e)`
- `submitEvidence()`

**2c.** 在 `onShow` 方法中，在现有 `_returnFromEvaluate` 逻辑旁边添加 `_returnFromEvidence` 处理。将 `onShow` 替换为：

```js
onShow() {
  if (this._firstShow) { this._firstShow = false; return; }
  if ((this._returnFromEvaluate || this._returnFromEvidence) && this.data.post) {
    this._returnFromEvaluate = false;
    this._returnFromEvidence = false;
    this._loadDetail(this.data.post.id);
  }
},
```

**2d.** 添加新方法 `openEvidencePage()`，插入在 `openPersonPicker` 方法之前：

```js
openEvidencePage() {
  this._returnFromEvidence = true;
  wx.navigateTo({
    url: `/pages/submit-evidence/submit-evidence?postId=${this.data.post.id}`
  });
},
```

- [ ] **Step 3: 修改 post-detail.wxml — 替换内联表单为跳转按钮**

在 `miniprogram/pages/post-detail/post-detail.wxml` 中：

**3a.** 找到以下按钮（在操作按钮区），将 `bindtap` 从 `openEvidenceForm` 改为 `openEvidencePage`：

将：
```xml
<button wx:if="{{canSubmitEvidence && !showEvidenceForm}}" class="ghost-btn action-btn" bindtap="openEvidenceForm">+ 提交文字证据</button>
```

替换为：
```xml
<button wx:if="{{canSubmitEvidence}}" class="ghost-btn action-btn" bindtap="openEvidencePage">+ 提交证据</button>
```

**3b.** 找到并完整删除内联表单块（共 12 行）：

```xml
<view wx:if="{{showEvidenceForm}}" class="evidence-form">
  <view class="label">证据内容</view>
  <textarea
    class="evidence-textarea"
    placeholder="描述你的完成情况..."
    placeholder-class="placeholder"
    bindinput="onEvidenceInput"
    value="{{evidenceInput}}"
  />
  <view class="evidence-form-btns">
    <button class="ghost-btn evidence-btn" bindtap="closeEvidenceForm">取消</button>
    <button class="primary-btn evidence-btn" bindtap="submitEvidence">提交</button>
  </view>
</view>
```

- [ ] **Step 4: Commit**

```bash
git add miniprogram/app.json miniprogram/pages/post-detail/post-detail.js miniprogram/pages/post-detail/post-detail.wxml
git commit -m "feat: replace inline evidence form with submit-evidence page navigation"
```

---

## Task 8: 端到端验证

- [ ] **Step 1: 启动后端**

```bash
cd backend && node src/server.js
```

确认控制台无报错。

- [ ] **Step 2: 在微信开发者工具中验证黄金路径**

1. 进入一个状态为「待评价」的帖子详情页
2. 点击「+ 提交证据」，确认跳转到新的证据页面（标题栏显示"提交证据"）
3. 页面显示帖子标题
4. 填写证据文字
5. 点击"+"选择 1-3 张图片，确认缩略图正确显示
6. 点击缩略图右上角"×"，确认图片可删除
7. 点击"提交"，确认 toast 显示"证据已提交"并返回详情页
8. 详情页刷新后，「完成证据」区域显示新提交的内容

- [ ] **Step 3: 验证覆盖提交**

再次点击"+ 提交证据"，确认页面回显上次的文字内容和图片 URL，修改后提交成功。

- [ ] **Step 4: 验证文字为空时的校验**

进入证据页面，不填文字直接点提交，确认 toast 提示"请填写证据内容"，不发起网络请求。
