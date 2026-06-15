<<<<<<< HEAD
const api = require('../../services/api');

Page({
  data: {
    user: {},
    posts: [],
    activeTab: 'active',
    filteredPosts: [],
    loading: true
  },
  async onLoad(options) {
    const app = getApp();
    const userInfo = app.globalData.userInfo || wx.getStorageSync('userInfo');

    if (!userInfo || !userInfo.id) {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }

    const targetUserId = options.userId;
    if (!targetUserId) {
      wx.showToast({ title: '用户不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }

    if (targetUserId === userInfo.id) {
      wx.switchTab({ url: '/pages/profile/profile' });
      return;
    }

    await this._loadProfile(targetUserId);
  },
  async _loadProfile(userId) {
    this.setData({ loading: true });
    try {
      const profile = await api.getProfile(userId);
      wx.setNavigationBarTitle({ title: `${profile.user.nickname} 的主页` });
      this.setData({
        user: profile.user,
        posts: profile.posts,
        loading: false
      });
      this._filterPosts();
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({ title: error.message || '加载失败', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
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
  goPostDetail(event) {
    const { id } = event.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/post-detail/post-detail?id=${id}` });
  }
});
=======
// pages/user-profile/user-profile.js
Page({

  /**
   * 页面的初始数据
   */
  data: {

  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {

  },

  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady() {

  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {

  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {

  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {

  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {

  },

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {

  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {

  }
})
>>>>>>> d58469bc441ee0a956f1de1dba0af7bc1afd10d6
