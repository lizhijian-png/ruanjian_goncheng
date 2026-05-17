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
    evaluations: [],
    buddies: [],
    hasEvidence: false,
    currentUserId: '',
    isPublisher: false,
    isBuddy: false,
    // 游客
    canJoin: false,
    // 发布者
    canStart: false,
    canMarkDone: false,
    canAbandon: false,
    // 搭子
    canQuit: false,
    canRequestComplete: false,
    hasRequested: false,
    // 共同
    canSubmitEvidence: false,
    canEvaluate: false,
    myEvaluated: false,
    // 申请完成展示
    completionStatusList: [],
    // 表单
    showEvidenceForm: false,
    evidenceInput: '',
    showEvalForm: false,
    evalScore: 5,
    evalContent: ''
  },
  async onLoad(options) {
    const app = getApp();
    const userInfo = app.globalData.userInfo || wx.getStorageSync('userInfo');
    const currentUserId = userInfo ? userInfo.id : '';
    this.setData({ currentUserId });
    await this._loadDetail(options.id);
  },
  async _loadDetail(postId) {
    try {
      const detail = await api.getPostDetail(postId || this.data.post.id);
      const { post, evidenceList, evaluations, buddies = [], hasEvidence = false } = detail;
      const { currentUserId } = this.data;
      const isPublisher = post.publisherId === currentUserId;
      const isBuddy = buddies.some(b => b.userId === currentUserId);
      const completionRequests = post.completionRequests || [];

      // 游客
      const canJoin = !isPublisher && !isBuddy && post.status === '招募中' && post.currentBuddies < post.maxBuddies;

      // 发布者
      const canStart = isPublisher && post.status === '招募中' && post.currentBuddies >= 1;
      const canMarkDone = isPublisher && post.status === '进行中';
      const canAbandon = isPublisher && (post.status === '招募中' || post.status === '进行中');

      // 搭子
      const canQuit = isBuddy && (post.status === '招募中' || post.status === '进行中');
      const hasRequested = completionRequests.includes(currentUserId);
      const canRequestComplete = isBuddy && post.status === '进行中' && !hasRequested;

      // 共同（参与者在待评价阶段）
      const isParticipant = isPublisher || isBuddy;
      const myEvaluated = isPublisher
        ? Boolean(post.publisherEvaluated)
        : isBuddy ? Boolean(post.buddyEvaluated) : false;
      const canSubmitEvidence = isParticipant && post.status === '待评价' && !myEvaluated;
      const canEvaluate = isParticipant && post.status === '待评价' && hasEvidence && !myEvaluated;

      // 申请完成展示列表（进行中时，所有搭子的申请状态）
      const completionStatusList = buddies.map(b => ({
        nickname: b.nickname,
        requested: completionRequests.includes(b.userId)
      }));

      this.setData({
        post: {
          ...post,
          startTime: formatTime(post.startTime),
          endTime: formatTime(post.endTime)
        },
        evidenceList, evaluations, buddies, hasEvidence,
        isPublisher, isBuddy,
        canJoin, canStart, canMarkDone, canAbandon,
        canQuit, canRequestComplete, hasRequested,
        canSubmitEvidence, canEvaluate, myEvaluated,
        completionStatusList
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
    try {
      await api.startPost(post.id, currentUserId);
      wx.showToast({ title: '任务已开始', icon: 'success' });
      await this._loadDetail(post.id);
    } catch (error) {
      wx.showToast({ title: error.message || '操作失败', icon: 'none' });
    }
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
    try {
      await api.submitEvidence(post.id, currentUserId, evidenceInput);
      wx.showToast({ title: '证据已提交', icon: 'success' });
      this.setData({ showEvidenceForm: false, evidenceInput: '' });
      await this._loadDetail(post.id);
    } catch (error) {
      wx.showToast({ title: error.message || '提交失败', icon: 'none' });
    }
  },
  openEvalForm() {
    this.setData({ showEvalForm: true, evalScore: 5, evalContent: '' });
  },
  closeEvalForm() {
    this.setData({ showEvalForm: false });
  },
  onEvalScoreChange(e) {
    this.setData({ evalScore: Number(e.detail.value) });
  },
  onEvalContentInput(e) {
    this.setData({ evalContent: e.detail.value });
  },
  async submitEvaluation() {
    const { post, currentUserId, evalScore, evalContent } = this.data;
    if (!String(evalContent).trim()) {
      wx.showToast({ title: '请填写评价内容', icon: 'none' });
      return;
    }
    try {
      await api.submitEvaluation(post.id, currentUserId, evalScore, evalContent);
      wx.showToast({ title: '评价已提交', icon: 'success' });
      this.setData({ showEvalForm: false });
      await this._loadDetail(post.id);
    } catch (error) {
      wx.showToast({ title: error.message || '提交失败', icon: 'none' });
    }
  }
});
