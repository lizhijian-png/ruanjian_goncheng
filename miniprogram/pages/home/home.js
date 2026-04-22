const api = require('../../services/api');

Page({
  data: {
    feed: [],
    scoreSummary: {},
    recommendLabel: '基于任务类型、完成率、互评质量的推荐模型'
  },
  async onShow() {
    try {
      const feed = await api.getFeed();
      const app = getApp();
      const userInfo = app.globalData.userInfo || wx.getStorageSync('userInfo') || {};
      this.setData({
        feed,
        scoreSummary: {
          points: userInfo.points || 0,
          completionRate: userInfo.completionRate || 0,
          rank: userInfo.rank || '-'
        }
      });
    } catch (error) {
      wx.showToast({ title: '加载广场失败', icon: 'none' });
    }
  },
  goPublish() {
    wx.navigateTo({ url: '/pages/publish/publish' });
  },
  goDetail(event) {
    wx.navigateTo({
      url: `/pages/post-detail/post-detail?id=${event.currentTarget.dataset.id}`
    });
  }
});
