const api = require('../../services/api');

Page({
  data: {
    ranking: []
  },
  async onShow() {
    try {
      const ranking = await api.getRanking();
      this.setData({ ranking });
    } catch (error) {
      wx.showToast({ title: '加载排行失败', icon: 'none' });
    }
  }
});
