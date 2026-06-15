# 评价页面重构设计

**日期：** 2026-06-04

## 背景

当前评价表单内嵌在 `post-detail` 页面卡片内，选择评价对象后直接在卡片内展开评价表单，且不展示被评价人的证据内容。

目标：将评价表单迁移为独立页面，页面上方展示被评价人提交的证据，下方保留原有评价表单。

## 不变的部分

- "评价"按钮入口不变（`canEvaluate` 逻辑不变）
- 人员选择弹层（`showPersonPicker`）不变，选择人员的交互逻辑不变
- 评价表单内容不变（评分滑块 1-5 + 评价内容 textarea + 取消/提交按钮）
- 后端 API 不变

## 设计

### 1. 新增页面：`pages/evaluate/evaluate`

新建四个文件：`.js` `.wxml` `.wxss` `.json`，并在 `app.json` 的 `pages` 数组中注册。

**页面布局（从上到下）：**

```
┌─────────────────────────────┐
│  TA 的证据                   │  ← 卡片标题
│  [证据文字内容]               │  ← 若无证据显示"暂未提交证据"
├─────────────────────────────┤
│  评价 [targetNickname]       │  ← 评价表单标题
│  评分：X 分  [滑块]           │
│  [评价内容 textarea]          │
│  [取消]  [提交]               │
└─────────────────────────────┘
```

**onLoad 参数（通过 URL query 传递）：**
- `postId`
- `targetUserId`
- `targetNickname`
- `currentUserId`

**数据获取：** 调用 `api.getPostDetail(postId, currentUserId)`，从返回的 `evidenceList` 中过滤 `submitterId === targetUserId` 的条目展示。

**提交：** 调用 `api.submitEvaluation(postId, currentUserId, targetUserId, score, content)`，成功后 `wx.navigateBack()`。

**取消：** 直接 `wx.navigateBack()`。

### 2. 修改 `post-detail`

**删除：**
- `data` 中的 `showEvalForm`、`evalTargetId`、`evalTargetName`、`evalScore`、`evalContent`
- `closeEvalForm`、`onEvalScoreChange`、`onEvalContentInput`、`submitEvaluation`、`backToPersonPicker` 方法
- wxml 中的 `<!-- 评价表单（对某人） -->` 块

**修改 `openEvalFormForPerson`（保留方法，改为跳转）：**
```js
openEvalFormForPerson(e) {
  const { userid, nickname, evaluated } = e.currentTarget.dataset;
  if (evaluated) return;
  this.setData({ showPersonPicker: false });
  wx.navigateTo({
    url: `/pages/evaluate/evaluate?postId=${this.data.post.id}&targetUserId=${userid}&targetNickname=${nickname}&currentUserId=${this.data.currentUserId}`
  });
}
```

**新增 `onShow` 刷新：** 从评价页返回时刷新 post-detail 数据。
```js
onShow() {
  if (this.data.post) {
    this._loadDetail(this.data.post.id);
  }
}
```

### 3. 数据流

```
post-detail: 点击"评价"
  └─ showPersonPicker 弹层：选择评价对象
      └─ openEvalFormForPerson → wx.navigateTo
          └─ evaluate 页面 onLoad
              └─ api.getPostDetail → 过滤目标用户证据
              └─ 渲染证据卡片 + 评价表单
          └─ submitEvaluation → api.submitEvaluation → wx.navigateBack
post-detail onShow: _loadDetail() 刷新
```

## 改动范围

| 文件 | 操作 |
|------|------|
| `miniprogram/pages/evaluate/evaluate.js` | 新建 |
| `miniprogram/pages/evaluate/evaluate.wxml` | 新建 |
| `miniprogram/pages/evaluate/evaluate.wxss` | 新建 |
| `miniprogram/pages/evaluate/evaluate.json` | 新建 |
| `miniprogram/app.json` | 注册新页面 |
| `miniprogram/pages/post-detail/post-detail.js` | 删除评价表单逻辑，改 openEvalFormForPerson，加 onShow |
| `miniprogram/pages/post-detail/post-detail.wxml` | 删除评价表单 wxml 块 |
