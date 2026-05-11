const api = require('../../services/api');

Page({
  data: {
    showBindUI: false,
    nickname: '',
    avatarUrl: '',
    loading: false,
    // code 缓存：login 阶段拿到后给 bind 阶段复用
    _code: '',
    features: [
      '微信小程序前端 + 通用 REST API',
      '任务贴发布、修改、删除',
      '积分奖惩与实时排名',
      '上传图片和文字证据',
      '搭子互评与 AI 评价'
    ]
  },

  // 阶段一：点击"微信登录"，判断是否新用户
  async handleLogin() {
    this.setData({ loading: true });
    try {
      const { code } = await new Promise((resolve, reject) =>
        wx.login({ success: resolve, fail: reject })
      );

      const result = await api.login({ code });

      if (result.isNewUser) {
        // 新用户：缓存 code，展示头像 + 昵称绑定界面
        this.setData({ showBindUI: true, _code: code });
        return;
      }

      // 老用户：直接保存并跳首页
      this._saveAndGo(result);
    } catch (error) {
      wx.showToast({ title: error.message || '登录失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 阶段二：点击"完成绑定"
  async handleBind() {
    const nickname = this.data.nickname.trim();
    if (!nickname) {
      wx.showToast({ title: '请填写昵称', icon: 'none' });
      return;
    }
    this.setData({ loading: true });
    try {
      // devMode 时 code 已失效，重新获取一次
      const { code } = await new Promise((resolve, reject) =>
        wx.login({ success: resolve, fail: reject })
      );

      const result = await api.bind({
        code,
        nickname,
        avatarUrl: this.data.avatarUrl || ''
      });

      this._saveAndGo(result);
    } catch (error) {
      wx.showToast({ title: error.message || '绑定失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  _saveAndGo(result) {
    const app = getApp();
    app.globalData.userInfo = result.user;
    app.globalData.scoreSummary = {
      points: result.user.points,
      completionRate: result.user.completionRate,
      rank: result.user.rank
    };
    wx.setStorageSync('token', result.token);
    wx.setStorageSync('userInfo', result.user);
    wx.switchTab({ url: '/pages/home/home' });
  },

  onChooseAvatar(e) {
    this.setData({ avatarUrl: e.detail.avatarUrl });
  },

  onNicknameInput(e) {
    this.setData({ nickname: e.detail.value });
  },

  onNicknameBlur(e) {
    if (e.detail.value) {
      this.setData({ nickname: e.detail.value });
    }
  }
});
