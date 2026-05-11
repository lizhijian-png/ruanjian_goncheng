App({
  globalData: {
    userInfo: null,
    scoreSummary: {
      points: 0,
      completionRate: 0,
      rank: '-'
    },
    techStack: {
      frontend: '微信原生小程序',
      backend: 'Express REST API',
      database: 'MySQL',
      storage: '本地或第三方对象存储'
    }
  },
  onLaunch() {
    const userInfo = wx.getStorageSync('userInfo');
    const token = wx.getStorageSync('token');
    if (userInfo && token) {
      this.globalData.userInfo = userInfo;
      this.globalData.scoreSummary = {
        points: userInfo.points || 0,
        completionRate: userInfo.completionRate || 0,
        rank: userInfo.rank || '-'
      };
      // 已登录：跳过登录页直接进首页
      wx.reLaunch({ url: '/pages/home/home' });
    }
  }
});
