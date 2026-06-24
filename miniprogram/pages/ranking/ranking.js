const api = require('../../services/api');

Page({
  data: {
    ranking: [],
    top3: [],
    restRanking: [],
    currentUserId: ''
  },
  async onShow() {
    const app = getApp();
    const userInfo = app.globalData.userInfo || wx.getStorageSync('userInfo');
    const currentUserId = userInfo ? userInfo.id : '';
    try {
      const ranking = await api.getRanking();
      this.setData({
        ranking,
        top3: ranking.slice(0, 3),
        restRanking: ranking.slice(3),
        currentUserId
      });
    } catch (error) {
      wx.showToast({ title: '加载排行失败', icon: 'none' });
    }
  },
  // 点击排行榜上的用户跳转到其个人主页
  goUserProfile(e) {
    const { userid } = e.currentTarget.dataset;
    if (!userid) return;

    // 如果是自己 → 切到"我的"Tab页
    if (userid === this.data.currentUserId) {
      wx.switchTab({ url: '/pages/profile/profile' });
      return;
    }

    // 如果是他人 → 打开他人的个人主页
    wx.navigateTo({
      url: `/pages/user-profile/user-profile?userId=${userid}`
    });
  }
});
