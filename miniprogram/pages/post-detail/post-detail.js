const api = require('../../services/api');

function formatTime(val) {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d.getTime())) return val;
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

Page({
  data: {
    post: null,
    evidenceList: [],
    evaluationsSent: [],
    evaluationsReceived: [],
    buddies: [],
    hasEvidence: false,
    currentUserId: '',
    isPublisher: false,
    isBuddy: false,
    canJoin: false,
    canStart: false,
    canMarkDone: false,
    canAbandon: false,
    canQuit: false,
    canRequestComplete: false,
    hasRequested: false,
    canSubmitEvidence: false,
    canEvaluate: false,
    completionStatusList: [],
    evalDeadlineText: '',
    // 证据表单
    showEvidenceForm: false,
    evidenceInput: '',
    // 人员选择弹层
    showPersonPicker: false,
    evalTargets: [],
  },
  async onLoad(options) {
    this._firstShow = true;
    const app = getApp();
    const userInfo = app.globalData.userInfo || wx.getStorageSync('userInfo');
    const currentUserId = userInfo ? userInfo.id : '';
    this.setData({ currentUserId });
    await this._loadDetail(options.id);
  },
  onShow() {
    if (this._firstShow) { this._firstShow = false; return; }
    if (this.data.post) {
      this._loadDetail(this.data.post.id);
    }
  },
  async _loadDetail(postId) {
    try {
      const { currentUserId } = this.data;
      const detail = await api.getPostDetail(postId || this.data.post.id, currentUserId);
      const { post, evidenceList, evaluationsSent = [], evaluationsReceived = [], buddies = [], hasEvidence = false } = detail;
      const isPublisher = post.publisherId === currentUserId;
      const isBuddy = buddies.some(b => b.userId === currentUserId);
      const completionRequests = post.completionRequests || [];

      const canJoin = !isPublisher && !isBuddy && post.status === '招募中' && post.currentBuddies < post.maxBuddies;
      const canStart = isPublisher && post.status === '招募中' && post.currentBuddies >= 1;
      const canMarkDone = isPublisher && post.status === '进行中';
      const canAbandon = isPublisher && (post.status === '招募中' || post.status === '进行中');
      const canQuit = isBuddy && (post.status === '招募中' || post.status === '进行中');
      const hasRequested = completionRequests.includes(currentUserId);
      const canRequestComplete = isBuddy && post.status === '进行中' && !hasRequested;
      const isParticipant = isPublisher || isBuddy;
      const canSubmitEvidence = isParticipant && post.status === '待评价';

      let evalDeadlineText = '';
      let deadlineExpired = false;
      if (post.status === '待评价' && post.evaluationDeadline) {
        const diff = new Date(post.evaluationDeadline) - new Date();
        if (diff > 0) {
          const h = Math.floor(diff / 3600000);
          const m = Math.floor((diff % 3600000) / 60000);
          evalDeadlineText = `还有 ${h} 小时 ${m} 分钟`;
        } else {
          evalDeadlineText = '评价窗口已结束';
          deadlineExpired = true;
        }
      }
      const canEvaluate = isParticipant && post.status === '待评价' && !deadlineExpired;

      const evaluatedToIds = new Set(evaluationsSent.map(e => e.toId));
      const others = isPublisher
        ? buddies
        : [{ userId: post.publisherId, nickname: post.publisher }, ...buddies.filter(b => b.userId !== currentUserId)];
      const evalTargets = others.map(p => ({
        userId: p.userId,
        nickname: p.nickname,
        evaluated: evaluatedToIds.has(p.userId)
      }));

      const completionStatusList = buddies.map(b => ({
        userId: b.userId,
        nickname: b.nickname,
        requested: completionRequests.includes(b.userId)
      }));

      this.setData({
        post: { ...post, startTime: formatTime(post.startTime), endTime: formatTime(post.endTime) },
        evidenceList, evaluationsSent, evaluationsReceived, buddies, hasEvidence,
        isPublisher, isBuddy,
        canJoin, canStart, canMarkDone, canAbandon,
        canQuit, canRequestComplete, hasRequested,
        canSubmitEvidence, canEvaluate,
        completionStatusList, evalDeadlineText, evalTargets
      });
    } catch (error) {
      wx.showToast({ title: error.message || '加载详情失败', icon: 'none' });
    }
  },
  async joinTask() {
    const { post, currentUserId } = this.data;
    if (!currentUserId) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    try {
      await api.joinPost(post.id, currentUserId);
      wx.showToast({ title: '已成功加入任务', icon: 'success' });
      await this._loadDetail(post.id);
    } catch (error) {
      wx.showToast({ title: error.message || '加入失败', icon: 'none' });
    }
  },
  async quitTask() {
    const { post, currentUserId } = this.data;
    wx.showModal({
      title: '确认退出',
      content: '退出后任务将重新进入招募中，确认退出吗？',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.quitPost(post.id, currentUserId);
          wx.showToast({ title: '已退出任务', icon: 'none' });
          await this._loadDetail(post.id);
        } catch (error) {
          wx.showToast({ title: error.message || '退出失败', icon: 'none' });
        }
      }
    });
  },
  async startTask() {
    const { post, currentUserId } = this.data;
    if (!post || !post.id) return;
    wx.showModal({
      title: '确认开始任务',
      content: '开始后任务将进入进行中状态，确认开始吗？',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.startPost(post.id, currentUserId);
          wx.showToast({ title: '任务已开始', icon: 'success' });
          await this._loadDetail(post.id);
        } catch (error) {
          wx.showToast({ title: error.message || '操作失败', icon: 'none' });
        }
      }
    });
  },
  async requestCompleteTask() {
    const { post, currentUserId } = this.data;
    if (!post || !post.id) return;
    try {
      await api.requestComplete(post.id, currentUserId);
      wx.showToast({ title: '已申请完成，等待发布者确认', icon: 'success' });
      await this._loadDetail(post.id);
    } catch (error) {
      wx.showToast({ title: error.message || '操作失败', icon: 'none' });
    }
  },
  async markDone() {
    const { post, currentUserId } = this.data;
    if (!post || !post.id) return;
    try {
      await api.completePost(post.id, currentUserId);
      wx.showToast({ title: '已进入待评价阶段', icon: 'success' });
      await this._loadDetail(post.id);
    } catch (error) {
      wx.showToast({ title: error.message || '更新失败', icon: 'none' });
    }
  },
  async abandonTask() {
    const { post, currentUserId } = this.data;
    wx.showModal({
      title: '确认放弃任务',
      content: `放弃后将扣除 ${post.penalty} 积分，且无法恢复，确认放弃吗？`,
      confirmColor: '#e11d48',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.abandonPost(post.id, currentUserId);
          wx.showToast({ title: '任务已放弃', icon: 'none' });
          await this._loadDetail(post.id);
        } catch (error) {
          wx.showToast({ title: error.message || '操作失败', icon: 'none' });
        }
      }
    });
  },
  openEvidenceForm() {
    this.setData({ showEvidenceForm: true, evidenceInput: '' });
  },
  closeEvidenceForm() {
    this.setData({ showEvidenceForm: false, evidenceInput: '' });
  },
  onEvidenceInput(e) {
    this.setData({ evidenceInput: e.detail.value });
  },
  async submitEvidence() {
    const { post, currentUserId, evidenceInput } = this.data;
    if (!String(evidenceInput).trim()) {
      wx.showToast({ title: '请填写证据内容', icon: 'none' });
      return;
    }
    const userInfo = getApp().globalData.userInfo || wx.getStorageSync('userInfo');
    const submitterName = (userInfo && userInfo.nickname) ? userInfo.nickname : currentUserId;
    try {
      await api.submitEvidence(post.id, currentUserId, submitterName, evidenceInput);
      wx.showToast({ title: '证据已提交', icon: 'success' });
      this.setData({ showEvidenceForm: false, evidenceInput: '' });
      await this._loadDetail(post.id);
    } catch (error) {
      wx.showToast({ title: error.message || '提交失败', icon: 'none' });
    }
  },
  openPersonPicker() {
    this.setData({ showPersonPicker: true });
  },
  closePersonPicker() {
    this.setData({ showPersonPicker: false });
  },
  openEvalFormForPerson(e) {
    const { userid, nickname, evaluated } = e.currentTarget.dataset;
    if (evaluated) return;
    this.setData({ showPersonPicker: false });
    wx.navigateTo({
      url: `/pages/evaluate/evaluate?postId=${this.data.post.id}&targetUserId=${userid}&targetNickname=${encodeURIComponent(nickname)}`
    });
  },
});
