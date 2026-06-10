const api = require('../../services/api');

Page({
  data: {
    postId: '',
    postTitle: '',
    titleLoading: true,
    currentUserId: '',
    submitterName: '',
    evidenceText: '',
    imageUrls: [],
    submitting: false
  },

  async onLoad(options) {
    const { postId } = options;
    if (!postId) {
      wx.showToast({ title: '参数错误', icon: 'none' });
      wx.navigateBack();
      return;
    }
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
        imageUrls: myEvidence ? (myEvidence.imageUrls || []) : [],
        titleLoading: false
      });
    } catch (err) {
      this.setData({ titleLoading: false });
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
            const url = await api.uploadEvidenceImage(file.tempFilePath, this.data.currentUserId);
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
