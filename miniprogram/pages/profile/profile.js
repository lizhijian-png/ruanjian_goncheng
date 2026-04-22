const api = require('../../services/api');

Page({
  data: {
    user: {},
    posts: []
  },
  async onShow() {
    const app = getApp();
    const userInfo = app.globalData.userInfo || wx.getStorageSync('userInfo');

    if (!userInfo || !userInfo.id) {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }

    try {
      const profile = await api.getProfile(userInfo.id);
      app.globalData.userInfo = profile.user;
      app.globalData.scoreSummary = {
        points: profile.user.points,
        completionRate: profile.user.completionRate,
        rank: profile.user.rank
      };
      wx.setStorageSync('userInfo', profile.user);
      this.setData(profile);
    } catch (error) {
      wx.showToast({ title: '加载个人信息失败', icon: 'none' });
    }
  },
  goPublish() {
    wx.navigateTo({ url: '/pages/publish/publish' });
  },
  async deletePost(event) {
    const { id } = event.currentTarget.dataset;

    try {
      await api.deletePost(id);
      this.setData({
        posts: this.data.posts.filter((item) => item.id !== id)
      });
      wx.showToast({ title: '帖子已删除', icon: 'none' });
    } catch (error) {
      wx.showToast({ title: error.message || '删除失败', icon: 'none' });
    }
  }
});
