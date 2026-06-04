const api = require('../../services/api');

Page({
  data: {
    posts: []
  },
  onLoad() {
    this.loadData();
  },
  async loadData() {
    wx.showLoading({ title: '加载中' });
    try {
      const res = await api.getAdminFeed();
      this.setData({ posts: res.list || [] });
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },
  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/post-detail/post-detail?id=${id}` });
  },
  async toggleAuditStatus(e) {
    const { id, current } = e.currentTarget.dataset;
    const nextStatus = current === '正常' ? '违规' : '正常';
    
    wx.showModal({
      title: '确认操作',
      content: `确定将该任务状态设置为[${nextStatus}]吗？`,
      success: async (res) => {
        if (res.confirm) {
          try {
            await api.updatePostAuditStatus(id, nextStatus);
            wx.showToast({ title: '修改成功', icon: 'success' });
            this.loadData();
          } catch (err) {
            wx.showToast({ title: err.message || '修改失败', icon: 'none' });
          }
        }
      }
    });
  }
});