const api = require('../../services/api');

Page({
  data: {
    ranking: [],
    top3: [],
    restRanking: []
  },
  async onShow() {
    try {
      const ranking = await api.getRanking();
      this.setData({
        ranking,
        top3: ranking.slice(0, 3),
        restRanking: ranking.slice(3)
      });
    } catch (error) {
      wx.showToast({ title: '加载排行失败', icon: 'none' });
    }
  }
});
