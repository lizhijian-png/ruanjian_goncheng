const api = require('../../services/api');

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + ':00');

function todayStr() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
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
    endHourIndex: 0
  },
  onLoad() {
    this.setData({ todayDate: todayStr() });
  },
  onInput(event) {
    const { field } = event.currentTarget.dataset;
    this.setData({ [`form.${field}`]: event.detail.value });
  },
  onSwitch(event) {
    const { field } = event.currentTarget.dataset;
    this.setData({ [`form.${field}`]: event.detail.value });
  },
  onCategoryChange(event) {
    this.setData({ 'form.category': this.data.categories[event.detail.value] });
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
  },
  onStartHourChange(event) {
    const idx = Number(event.detail.value);
    this.setData({
      startHourIndex: idx,
      'form.startTime': this._buildDatetime(this.data.startDate, idx)
    });
  },
  onEndDateChange(event) {
    const date = event.detail.value;
    this.setData({
      endDate: date,
      'form.endTime': this._buildDatetime(date, this.data.endHourIndex)
    });
  },
  onEndHourChange(event) {
    const idx = Number(event.detail.value);
    this.setData({
      endHourIndex: idx,
      'form.endTime': this._buildDatetime(this.data.endDate, idx)
    });
  },
  decMaxBuddies() {
    const val = Math.max(1, this.data.form.maxBuddies - 1);
    this.setData({ 'form.maxBuddies': val });
  },
  incMaxBuddies() {
    const val = Math.min(20, this.data.form.maxBuddies + 1);
    this.setData({ 'form.maxBuddies': val });
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
      wx.showToast({ title: `已创建 ${created.title}`, icon: 'none' });
      setTimeout(() => {
        wx.switchTab({ url: '/pages/home/home' });
      }, 600);
    } catch (error) {
      wx.showToast({ title: error.message || '发布失败', icon: 'none' });
    }
  }
});
