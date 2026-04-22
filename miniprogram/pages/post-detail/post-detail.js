const api = require('../../services/api');

Page({
  data: {
    post: null,
    evidenceList: [],
    evaluations: []
  },
  async onLoad(options) {
    try {
      const detail = await api.getPostDetail(options.id);
      this.setData(detail);
    } catch (error) {
      wx.showToast({ title: error.message || '加载详情失败', icon: 'none' });
    }
  },
  async markDone() {
    if (!this.data.post || !this.data.post.id) {
      return;
    }

    try {
      const post = await api.completePost(this.data.post.id);
      this.setData({ post });
      wx.showToast({ title: '已更新为完成', icon: 'none' });
    } catch (error) {
      wx.showToast({ title: error.message || '更新失败', icon: 'none' });
    }
  }
});
