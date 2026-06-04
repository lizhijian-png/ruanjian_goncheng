# Evaluate Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将评价表单从 post-detail 内嵌卡片迁移为独立页面，页面上方展示被评价人的证据，下方保留原有评价表单。

**Architecture:** 新建 `pages/evaluate/evaluate` 页面，接收 URL 参数后调用 `api.getPostDetail` 获取证据数据并渲染；`post-detail` 的 `openEvalFormForPerson` 改为 `wx.navigateTo` 跳转，删除内嵌表单相关代码；`post-detail` 新增 `onShow` 在返回时刷新数据。

**Tech Stack:** 微信小程序（WXML / WXSS / JS），无新依赖

---

### Task 1: 新建 evaluate 页面的四个文件

**Files:**
- Create: `miniprogram/pages/evaluate/evaluate.json`
- Create: `miniprogram/pages/evaluate/evaluate.wxml`
- Create: `miniprogram/pages/evaluate/evaluate.wxss`
- Create: `miniprogram/pages/evaluate/evaluate.js`

- [ ] **Step 1: 创建 evaluate.json**

```json
{
  "navigationBarTitleText": "评价"
}
```

- [ ] **Step 2: 创建 evaluate.wxml**

```xml
<view class="container">
  <!-- 证据卡片 -->
  <view class="card evidence-card">
    <view class="card-title">TA 的证据</view>
    <view wx:if="{{targetEvidence}}" class="evidence-text">{{targetEvidence}}</view>
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
    <view class="form-btns">
      <button class="ghost-btn form-btn" bindtap="cancel">取消</button>
      <button class="primary-btn form-btn" bindtap="submit">提交</button>
    </view>
  </view>
</view>
```

- [ ] **Step 3: 创建 evaluate.wxss**

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
  margin-bottom: 24rpx;
  border: 1rpx solid rgba(255,122,89,0.12);
}

.card-title {
  font-size: 32rpx;
  font-weight: 700;
  margin-bottom: 20rpx;
  color: #1e293b;
}

.evidence-text {
  font-size: 28rpx;
  line-height: 1.8;
  color: #334155;
}

.empty-hint {
  font-size: 26rpx;
  padding: 8rpx 0;
}

.eval-score-row {
  margin: 14rpx 0 8rpx;
}

.eval-slider {
  margin-top: 8rpx;
}

.eval-textarea {
  width: 100%;
  min-height: 180rpx;
  background: rgba(255,250,244,0.9);
  border: 1rpx solid rgba(255,122,89,0.16);
  border-radius: 16rpx;
  padding: 20rpx;
  box-sizing: border-box;
  font-size: 28rpx;
  line-height: 1.7;
  margin: 14rpx 0 20rpx;
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

- [ ] **Step 4: 创建 evaluate.js**

```js
const api = require('../../services/api');

Page({
  data: {
    postId: '',
    targetUserId: '',
    targetNickname: '',
    currentUserId: '',
    targetEvidence: '',
    evalScore: 5,
    evalContent: ''
  },
  async onLoad(options) {
    const { postId, targetUserId, targetNickname, currentUserId } = options;
    this.setData({ postId, targetUserId, targetNickname, currentUserId });
    try {
      const detail = await api.getPostDetail(postId, currentUserId);
      const evidence = (detail.evidenceList || []).find(e => e.submitterId === targetUserId);
      this.setData({ targetEvidence: evidence ? evidence.value : '' });
    } catch (err) {
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
  async submit() {
    const { postId, currentUserId, targetUserId, evalScore, evalContent } = this.data;
    if (!String(evalContent).trim()) {
      wx.showToast({ title: '请填写评价内容', icon: 'none' });
      return;
    }
    try {
      await api.submitEvaluation(postId, currentUserId, targetUserId, evalScore, evalContent);
      wx.showToast({ title: '评价已提交', icon: 'success' });
      wx.navigateBack();
    } catch (err) {
      wx.showToast({ title: err.message || '提交失败', icon: 'none' });
    }
  }
});
```

- [ ] **Step 5: 验证文件存在**

检查以下四个文件均已创建：
- `miniprogram/pages/evaluate/evaluate.json`
- `miniprogram/pages/evaluate/evaluate.wxml`
- `miniprogram/pages/evaluate/evaluate.wxss`
- `miniprogram/pages/evaluate/evaluate.js`

- [ ] **Step 6: Commit**

```bash
git add miniprogram/pages/evaluate/
git commit -m "feat: add evaluate page with evidence display and eval form"
```

---

### Task 2: 在 app.json 中注册新页面

**Files:**
- Modify: `miniprogram/app.json`

- [ ] **Step 1: 在 pages 数组末尾添加新页面**

在 `miniprogram/app.json` 的 `"pages"` 数组中，在 `"pages/admin/admin"` 后面添加一行：

```json
"pages/evaluate/evaluate"
```

完整 pages 数组结果：
```json
"pages": [
  "pages/login/login",
  "pages/home/home",
  "pages/publish/publish",
  "pages/ranking/ranking",
  "pages/profile/profile",
  "pages/post-detail/post-detail",
  "pages/admin/admin",
  "pages/evaluate/evaluate"
]
```

- [ ] **Step 2: Commit**

```bash
git add miniprogram/app.json
git commit -m "feat: register evaluate page in app.json"
```

---

### Task 3: 修改 post-detail.js

**Files:**
- Modify: `miniprogram/pages/post-detail/post-detail.js`

- [ ] **Step 1: 删除 data 中的评价表单字段**

在 `data` 对象中，删除以下五个字段（约第 40-44 行）：
```js
// 删除这五行：
showEvalForm: false,
evalTargetId: '',
evalTargetName: '',
evalScore: 5,
evalContent: ''
```

- [ ] **Step 2: 将 openEvalFormForPerson 改为跳转**

将原来的 `openEvalFormForPerson` 方法（约第 237-248 行）替换为：

```js
openEvalFormForPerson(e) {
  const { userid, nickname, evaluated } = e.currentTarget.dataset;
  if (evaluated) return;
  this.setData({ showPersonPicker: false });
  wx.navigateTo({
    url: `/pages/evaluate/evaluate?postId=${this.data.post.id}&targetUserId=${userid}&targetNickname=${nickname}&currentUserId=${this.data.currentUserId}`
  });
},
```

- [ ] **Step 3: 删除不再需要的方法**

删除以下方法（约第 249-275 行）：
- `closeEvalForm()`
- `onEvalScoreChange(e)`
- `onEvalContentInput(e)`
- `submitEvaluation()`
- `backToPersonPicker()`

- [ ] **Step 4: 新增 onShow 刷新**

在 `onLoad` 方法之后，新增 `onShow`：

```js
onShow() {
  if (this.data.post) {
    this._loadDetail(this.data.post.id);
  }
},
```

- [ ] **Step 5: Commit**

```bash
git add miniprogram/pages/post-detail/post-detail.js
git commit -m "refactor: replace inline eval form with navigate to evaluate page"
```

---

### Task 4: 修改 post-detail.wxml

**Files:**
- Modify: `miniprogram/pages/post-detail/post-detail.wxml`

- [ ] **Step 1: 删除评价表单 wxml 块**

删除第 119-145 行的整个 `<!-- 评价表单（对某人） -->` 块：

```xml
<!-- 删除这整段 -->
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

- [ ] **Step 2: Commit**

```bash
git add miniprogram/pages/post-detail/post-detail.wxml
git commit -m "refactor: remove inline eval form from post-detail"
```

---

### Task 5: 手动验证

- [ ] **Step 1: 在微信开发者工具中编译项目，确认无报错**

- [ ] **Step 2: 进入一个处于"待评价"状态的任务详情页**

确认：
- "评价"按钮正常显示
- 点击后人员选择弹层正常弹出

- [ ] **Step 3: 选择一个未评价的对象**

确认：
- 弹层关闭
- 跳转到独立评价页面（导航栏标题为"评价"）
- 页面上方"TA 的证据"卡片显示该用户的证据（或"暂未提交证据"）
- 页面下方评价表单正常显示（滑块 + 输入框 + 取消/提交按钮）

- [ ] **Step 4: 提交评价**

确认：
- 提交成功后返回 post-detail
- post-detail 数据自动刷新，该用户变为"已评价"状态

- [ ] **Step 5: 点击已评价的对象**

确认：
- 无法跳转（已评价状态点击无反应，与原来行为一致）
