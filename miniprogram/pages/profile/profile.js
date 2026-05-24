const api = require('../../services/api');

Page({
  data: {
    user: {},
    posts: [],
    activeTab: 'active',   // 'active' | 'done' | 'abandoned'
    filteredPosts: [],
    settingsVisible: false,
    editNickname: '',
    editAvatarUrl: '',
    saving: false
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
      this._filterPosts();
    } catch (error) {
      wx.showToast({ title: '加载个人信息失败', icon: 'none' });
    }
  },
  _filterPosts() {
    const { posts, activeTab } = this.data;
    const ACTIVE_STATUSES = ['招募中', '进行中', '待评价'];
    let filtered;
    if (activeTab === 'active') {
      filtered = posts.filter(p => ACTIVE_STATUSES.includes(p.status));
    } else if (activeTab === 'done') {
      filtered = posts.filter(p => p.status === '已完成');
    } else {
      filtered = posts.filter(p => p.status === '已放弃');
    }
    this.setData({ filteredPosts: filtered });
  },
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ activeTab: tab });
    this._filterPosts();
  },
  goPublish() {
    wx.navigateTo({ url: '/pages/publish/publish' });
  },
  goScoreHistory() {
    wx.navigateTo({ url: '/pages/score-history/score-history' });
  },
  goPostDetail(event) {
    const { id } = event.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/post-detail/post-detail?id=${id}` });
  },
  async deletePost(event) {
    const { id } = event.currentTarget.dataset;

    try {
      await api.deletePost(id);
      this.setData({
        posts: this.data.posts.filter((item) => item.id !== id)
      });
      this._filterPosts();
      wx.showToast({ title: '帖子已删除', icon: 'none' });
    } catch (error) {
      wx.showToast({ title: error.message || '删除失败', icon: 'none' });
    }
  },
  openSettings() {
    this.setData({
      settingsVisible: true,
      editNickname: this.data.user.nickname,
      editAvatarUrl: this.data.user.avatarUrl
    });
  },
  closeSettings() {
    this.setData({ settingsVisible: false });
  },
  onNicknameInput(e) {
    this.setData({ editNickname: e.detail.value });
  },
  pickAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempPath = res.tempFiles[0].tempFilePath;
        wx.getFileSystemManager().readFile({
          filePath: tempPath,
          encoding: 'base64',
          success: (fileRes) => {
            const ext = tempPath.split('.').pop().toLowerCase() || 'jpeg';
            const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
            this.setData({ editAvatarUrl: `data:${mime};base64,${fileRes.data}` });
          },
          fail: () => {
            wx.showToast({ title: '读取图片失败', icon: 'none' });
          }
        });
      }
    });
  },
  async saveSettings() {
    const nickname = this.data.editNickname.trim();
    if (!nickname) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' });
      return;
    }

    this.setData({ saving: true });
    try {
      const userId = this.data.user.id;
      const result = await api.updateProfile(userId, {
        nickname,
        avatarUrl: this.data.editAvatarUrl
      });

      const app = getApp();
      app.globalData.userInfo = result.user;
      wx.setStorageSync('userInfo', result.user);
      this.setData({
        user: result.user,
        settingsVisible: false
      });
      wx.showToast({ title: '保存成功', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  }
});
