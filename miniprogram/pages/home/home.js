const api = require('../../services/api');

const CATEGORIES = ['学习', '运动', '考研', '求职', '自律'];
const PAGE_SIZE = 10;

function formatTime(val) {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d.getTime())) return val;
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

Page({
  data: {
    feed: [],
    scoreSummary: {},
    recommendLabel: '基于任务类型、完成率、互评质量的推荐模型',
    // 分页
    page: 1,
    hasMore: true,
    loading: false,
    // 搜索
    keyword: '',
    // 筛选面板
    filterVisible: false,
    // 筛选条件（面板内临时值）
    draftCategory: '',
    draftStartAfter: '',
    draftEndBefore: '',
    // 已应用的筛选条件
    activeCategory: '',
    activeStartAfter: '',
    activeEndBefore: '',
    // 筛选标签显示
    filterLabel: '',
    categories: CATEGORIES,
    todayDate: ''
  },

  onLoad() {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    this.setData({ todayDate: today });
  },

  async onShow() {
    const app = getApp();
    const userInfo = app.globalData.userInfo || wx.getStorageSync('userInfo') || {};
    this.setData({
      scoreSummary: {
        points: userInfo.points || 0,
        completionRate: userInfo.completionRate || 0,
        rank: userInfo.rank || '-'
      }
    });
    // 重置并加载第一页
    await this._resetAndLoad();
  },

  async onReachBottom() {
    if (!this.data.hasMore || this.data.loading) return;
    await this._loadPage(this.data.page + 1, false);
  },

  async _resetAndLoad() {
    this.setData({ feed: [], page: 1, hasMore: true });
    await this._loadPage(1, true);
  },

  async _loadPage(page, reset) {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const { activeCategory, activeStartAfter, activeEndBefore, keyword } = this.data;
      const app = getApp();
      const userInfo = app.globalData.userInfo || wx.getStorageSync('userInfo') || {};
      const result = await api.getFeed({
        category: activeCategory,
        startAfter: activeStartAfter,
        endBefore: activeEndBefore,
        keyword,
        userId: userInfo.id || '',
        page,
        pageSize: PAGE_SIZE
      });
      const formatted = result.list.map(item => ({
        ...item,
        startTime: formatTime(item.startTime),
        endTime: formatTime(item.endTime)
      }));
      this.setData({
        feed: reset ? formatted : [...this.data.feed, ...formatted],
        page: result.page,
        hasMore: result.hasMore
      });
    } catch (error) {
      wx.showToast({ title: '加载广场失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  // ===== 筛选面板 =====
  openFilter() {
    // 打开面板时把已应用的条件同步到草稿
    this.setData({
      filterVisible: true,
      draftCategory: this.data.activeCategory,
      draftStartAfter: this.data.activeStartAfter,
      draftEndBefore: this.data.activeEndBefore
    });
  },

  closeFilter() {
    this.setData({ filterVisible: false });
  },

  onSelectCategory(e) {
    const val = e.currentTarget.dataset.value;
    this.setData({ draftCategory: this.data.draftCategory === val ? '' : val });
  },

  onStartAfterChange(e) {
    this.setData({ draftStartAfter: e.detail.value });
  },

  onEndBeforeChange(e) {
    this.setData({ draftEndBefore: e.detail.value });
  },

  resetFilter() {
    this.setData({ draftCategory: '', draftStartAfter: '', draftEndBefore: '' });
  },

  async applyFilter() {
    const { draftCategory, draftStartAfter, draftEndBefore } = this.data;
    if (draftStartAfter && draftEndBefore && draftEndBefore < draftStartAfter) {
      wx.showToast({ title: '结束日期不能早于开始日期', icon: 'none' });
      return;
    }
    const parts = [];
    if (draftCategory) parts.push(draftCategory);
    if (draftStartAfter) parts.push(`${draftStartAfter} 起`);
    if (draftEndBefore) parts.push(`${draftEndBefore} 止`);

    this.setData({
      filterVisible: false,
      activeCategory: draftCategory,
      activeStartAfter: draftStartAfter,
      activeEndBefore: draftEndBefore,
      filterLabel: parts.join('  ')
    });
    await this._resetAndLoad();
  },

  async clearAllFilter() {
    this.setData({
      filterVisible: false,
      activeCategory: '',
      activeStartAfter: '',
      activeEndBefore: '',
      draftCategory: '',
      draftStartAfter: '',
      draftEndBefore: '',
      filterLabel: ''
    });
    await this._resetAndLoad();
  },

  // ===== 搜索 =====
  onSearchInput(e) {
    const keyword = e.detail.value;
    this.setData({ keyword });
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => {
      this._resetAndLoad();
    }, 500);
  },

  clearSearch() {
    this.setData({ keyword: '' });
    this._resetAndLoad();
  },

  goPublish() {
    wx.navigateTo({ url: '/pages/publish/publish' });
  },

  goDetail(event) {
    wx.navigateTo({
      url: `/pages/post-detail/post-detail?id=${event.currentTarget.dataset.id}`
    });
  }
});
