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
      database: 'SQLite',
      storage: '本地或第三方对象存储'
    }
  },
  onLaunch() {
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo) {
      this.globalData.userInfo = userInfo;
      this.globalData.scoreSummary = {
        points: userInfo.points || 0,
        completionRate: userInfo.completionRate || 0,
        rank: userInfo.rank || '-'
      };
    }
  }
});
