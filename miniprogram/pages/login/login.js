const api = require('../../services/api');

Page({
  data: {
    nickname: '',
    loading: false,
    features: [
      '微信小程序前端 + 通用 REST API',
      '任务贴发布、修改、删除',
      '积分奖惩与实时排名',
      '上传图片和文字证据',
      '搭子互评与 AI 评价'
    ]
  },
  onNicknameInput(event) {
    this.setData({
      nickname: event.detail.value
    });
  },
  async handleLogin() {
    this.setData({ loading: true });

    try {
      const result = await api.login(this.data.nickname);
      const app = getApp();
      app.globalData.userInfo = result.user;
      app.globalData.scoreSummary = {
        points: result.user.points,
        completionRate: result.user.completionRate,
        rank: result.user.rank
      };
      wx.setStorageSync('token', result.token);
      wx.setStorageSync('userInfo', result.user);
      wx.switchTab({
        url: '/pages/home/home'
      });
    } catch (error) {
      wx.showToast({ title: error.message || '登录失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  }
});
