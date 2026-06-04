const api = require('../../services/api');

Page({
  data: {
    postId: '',
    targetUserId: '',
    targetNickname: '',
    currentUserId: '',
    targetEvidence: '',
    evalScore: 5,
    evalContent: '',
    submitting: false
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
