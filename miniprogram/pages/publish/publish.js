const api = require('../../services/api');

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + ':00');
const DRAFT_KEY = 'publish_draft';

function todayStr() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// 从存储的 draft 中恢复时间选择器的索引
function restoreHourIndex(date, time) {
  if (!date || !time) return 0;
  const idx = HOURS.indexOf(time);
  return idx >= 0 ? idx : 0;
}

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
      evidenceText: '',
      startTime: '',
      endTime: '',
      maxBuddies: 1
    },
    categories: ['学习', '运动', '考研', '求职', '自律'],
    hours: HOURS,
    todayDate: '',
    startDate: '',
    startHourIndex: 0,
    endDate: '',
    endHourIndex: 0,
    hasDraft: false
  },
  onLoad() {
    const today = todayStr();
    this.setData({ todayDate: today });

    // 尝试从本地存储恢复草稿
    try {
      const saved = wx.getStorageSync(DRAFT_KEY);
      if (saved && saved.form && saved.form.title) {
        // 恢复表单数据
        const form = saved.form;
        // 恢复时间选择器索引
        const startHour = form.startTime ? form.startTime.split(' ')[1] || '' : '';
        const endHour = form.endTime ? form.endTime.split(' ')[1] || '' : '';
        const startHourIndex = restoreHourIndex(saved.startDate, startHour);
        const endHourIndex = restoreHourIndex(saved.endDate, endHour);
        this.setData({
          form,
          startDate: saved.startDate || '',
          endDate: saved.endDate || '',
          startHourIndex,
          endHourIndex,
          hasDraft: true
        });
      }
    } catch (e) {
      // 读取草稿失败不阻塞
    }
  },
  // 恢复草稿后调用——用户确认使用草稿，清除标记
  onDraftConfirm() {
    this.setData({ hasDraft: false });
    wx.showToast({ title: '已恢复草稿', icon: 'none' });
  },
  // 丢弃草稿
  discardDraft() {
    try { wx.removeStorageSync(DRAFT_KEY); } catch (e) {}
    this.setData({
      hasDraft: false,
      form: {
        title: '', content: '', reward: 10, penalty: 5,
        category: '学习', partnerChat: true, evaluationOpen: true,
        evidenceText: '', startTime: '', endTime: '', maxBuddies: 1
      },
      startDate: '', endDate: '', startHourIndex: 0, endHourIndex: 0
    });
    wx.showToast({ title: '草稿已清除', icon: 'none' });
  },
  // 自动保存草稿（每次表单输入时触发）
  _autoSaveDraft() {
    try {
      wx.setStorageSync(DRAFT_KEY, {
        form: this.data.form,
        startDate: this.data.startDate,
        endDate: this.data.endDate,
        savedAt: new Date().toISOString()
      });
    } catch (e) {
      // 存储空间满时静默失败
    }
  },
  onInput(event) {
    const { field } = event.currentTarget.dataset;
    this.setData({ [`form.${field}`]: event.detail.value });
    this._autoSaveDraft();
  },
  onSwitch(event) {
    const { field } = event.currentTarget.dataset;
    this.setData({ [`form.${field}`]: event.detail.value });
    this._autoSaveDraft();
  },
  onCategoryChange(event) {
    this.setData({ 'form.category': this.data.categories[event.detail.value] });
    this._autoSaveDraft();
  },
  _buildDatetime(date, hourIndex) {
    if (!date) return '';
    return `${date} ${HOURS[hourIndex]}`;
  },
  onStartDateChange(event) {
    const date = event.detail.value;
    this.setData({
      startDate: date,
      'form.startTime': this._buildDatetime(date, this.data.startHourIndex)
    });
    this._autoSaveDraft();
  },
  onStartHourChange(event) {
    const idx = Number(event.detail.value);
    this.setData({
      startHourIndex: idx,
      'form.startTime': this._buildDatetime(this.data.startDate, idx)
    });
    this._autoSaveDraft();
  },
  onEndDateChange(event) {
    const date = event.detail.value;
    this.setData({
      endDate: date,
      'form.endTime': this._buildDatetime(date, this.data.endHourIndex)
    });
    this._autoSaveDraft();
  },
  onEndHourChange(event) {
    const idx = Number(event.detail.value);
    this.setData({
      endHourIndex: idx,
      'form.endTime': this._buildDatetime(this.data.endDate, idx)
    });
    this._autoSaveDraft();
  },
  decMaxBuddies() {
    const val = Math.max(1, this.data.form.maxBuddies - 1);
    this.setData({ 'form.maxBuddies': val });
    this._autoSaveDraft();
  },
  incMaxBuddies() {
    const val = Math.min(20, this.data.form.maxBuddies + 1);
    this.setData({ 'form.maxBuddies': val });
    this._autoSaveDraft();
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

    if (this.data.form.maxBuddies < 1 || this.data.form.maxBuddies > 20) {
      wx.showToast({ title: '搭子人数限制须在 1~20 之间', icon: 'none' });
      return;
    }

    const { startTime, endTime } = this.data.form;
    const now = new Date();

    if (startTime && new Date(startTime) < now) {
      wx.showToast({ title: '开始时间不能早于当前时间', icon: 'none' });
      return;
    }

    if (startTime && endTime && endTime <= startTime) {
      wx.showToast({ title: '结束时间须晚于开始时间', icon: 'none' });
      return;
    }

    try {
      const created = await api.createPost({
        ...this.data.form,
        maxBuddies: Number(this.data.form.maxBuddies) || 1,
        publisherId: userInfo.id
      });
      // 发布成功后清除草稿
      try { wx.removeStorageSync(DRAFT_KEY); } catch (e) {}
      wx.showToast({ title: `已创建 ${created.title}`, icon: 'none' });
      setTimeout(() => {
        wx.switchTab({ url: '/pages/home/home' });
      }, 600);
    } catch (error) {
      wx.showToast({ title: error.message || '发布失败', icon: 'none' });
    }
  }
});
