const api = require('../../services/api');

Page({
  data: {
    form: {
      title: '',
      content: '',
      reward: 10,
      penalty: 5,
      category: '学习',
      partnerChat: true,
      evaluationOpen: true,
      evidenceText: ''
    },
    categories: ['学习', '运动', '考研', '求职', '自律']
  },
  onInput(event) {
    const { field } = event.currentTarget.dataset;
    this.setData({
      [`form.${field}`]: event.detail.value
    });
  },
  onSwitch(event) {
    const { field } = event.currentTarget.dataset;
    this.setData({
      [`form.${field}`]: event.detail.value
    });
  },
  onCategoryChange(event) {
    this.setData({
      'form.category': this.data.categories[event.detail.value]
    });
  },
  async submitPost() {
    const app = getApp();
    const userInfo = app.globalData.userInfo || wx.getStorageSync('userInfo');

    if (!userInfo || !userInfo.id) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }

    if (!this.data.form.title || !this.data.form.content) {
      wx.showToast({ title: '请填写标题和内容', icon: 'none' });
      return;
    }

    try {
      const created = await api.createPost({
        ...this.data.form,
        publisherId: userInfo.id
      });
      wx.showToast({ title: `已创建 ${created.title}`, icon: 'none' });
      setTimeout(() => {
        wx.switchTab({ url: '/pages/home/home' });
      }, 600);
    } catch (error) {
      wx.showToast({ title: error.message || '发布失败', icon: 'none' });
    }
  }
});
