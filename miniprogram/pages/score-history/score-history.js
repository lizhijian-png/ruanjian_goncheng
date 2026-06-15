const api = require('../../services/api');

Page({
  data: {
    logs: [],
    loading: true
  },
  async onLoad() {
    const app = getApp();
    const userInfo = app.globalData.userInfo || wx.getStorageSync('userInfo');
    if (!userInfo || !userInfo.id) {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }
    try {
      const logs = await api.getPointLogs(userInfo.id);
      this.setData({ logs, loading: false });
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  }
});
