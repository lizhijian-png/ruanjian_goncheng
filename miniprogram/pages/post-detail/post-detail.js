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
    // 人员选择弹层
    showPersonPicker: false,
    evalTargets: [],
    // 批注
    annotations: [],
    isParticipant: false,
    placingMode: false,
    placingKind: '',
    placingEmoji: '',
    showTextInput: false,
    textInputValue: '',
    pendingX: 0,
    pendingY: 0,
    showAnnoDetail: false,
    activeAnno: null,
    canDeleteActive: false,
    canOpenChat: false,
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
    if ((this._returnFromEvaluate || this._returnFromEvidence) && this.data.post) {
      this._returnFromEvaluate = false;
      this._returnFromEvidence = false;
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
      const canOpenChat = post.partnerChat &&
        isParticipant &&
        post.status !== '已完成' &&
        post.status !== '已放弃';
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
        completionStatusList, evalDeadlineText, evalTargets, isParticipant: isPublisher || isBuddy,
        canOpenChat
      });
      try {
        const annoRes = await api.getAnnotations(post.id);
        this.setData({ annotations: annoRes.annotations || [] });
      } catch (e) {
        this.setData({ annotations: [] });
        wx.showToast({ title: '批注加载失败', icon: 'none' });
      }
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
  openEvidencePage() {
    this._returnFromEvidence = true;
    wx.navigateTo({
      url: `/pages/submit-evidence/submit-evidence?postId=${this.data.post.id}`
    });
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
    this._returnFromEvaluate = true;
    wx.navigateTo({
      url: `/pages/evaluate/evaluate?postId=${this.data.post.id}&targetUserId=${userid}&targetNickname=${encodeURIComponent(nickname)}`
    });
  },
  onToolPick(e) {
    if (!this.data.isParticipant) {
      wx.showToast({ title: '只有参与者可以批注', icon: 'none' });
      return;
    }
    const { kind, value } = e.detail;
    this.setData({
      placingMode: true,
      placingKind: kind,
      placingEmoji: kind === 'stamp' ? value : ''
    });
    wx.showToast({ title: '点击帖子上要贴的位置', icon: 'none' });
  },
  onCardTap(e) {
    if (!this.data.placingMode) return;
    const q = wx.createSelectorQuery().in(this);
    q.select('.detail-card').boundingClientRect();
    q.exec((res) => {
      const rect = res[0];
      if (!rect) return;
      const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e.detail;
      const px = t.clientX !== undefined ? t.clientX : t.x;
      const py = t.clientY !== undefined ? t.clientY : t.y;
      const x = Math.max(0, Math.min(100, ((px - rect.left) / rect.width) * 100));
      const y = Math.max(0, Math.min(100, ((py - rect.top) / rect.height) * 100));
      if (this.data.placingKind === 'stamp') {
        this._createAnnotation('stamp', this.data.placingEmoji, { rotate: 0 }, x, y);
      } else {
        this.setData({ showTextInput: true, pendingX: x, pendingY: y });
      }
    });
  },
  onTextInputChange(e) {
    this.setData({ textInputValue: e.detail.value });
  },
  confirmTextAnnotation() {
    const text = String(this.data.textInputValue || '').trim();
    if (!text) {
      wx.showToast({ title: '请输入批注内容', icon: 'none' });
      return;
    }
    const style = { color: '#c0392b', fontSize: 28, fontWeight: 'bold', bg: '#fff3b0', rotate: -3 };
    this._createAnnotation('text', text, style, this.data.pendingX, this.data.pendingY);
    this.setData({ showTextInput: false, textInputValue: '' });
  },
  cancelTextAnnotation() {
    this.setData({ showTextInput: false, textInputValue: '', placingMode: false });
  },
  async _createAnnotation(type, content, style, x, y) {
    const { post, currentUserId } = this.data;
    try {
      const res = await api.createAnnotation(post.id, {
        userId: currentUserId, type, content, style: JSON.stringify(style), x, y
      });
      this.setData({
        annotations: [...this.data.annotations, res.annotation],
        placingMode: false, placingKind: '', placingEmoji: ''
      });
    } catch (error) {
      this.setData({ placingMode: false });
      wx.showToast({ title: error.message || '批注失败', icon: 'none' });
    }
  },
  onTapAnnotation(e) {
    const anno = this.data.annotations.find(a => a.id === e.detail.id);
    if (!anno) return;
    const canDelete = anno.userId === this.data.currentUserId || this.data.isPublisher;
    this.setData({ showAnnoDetail: true, activeAnno: anno, canDeleteActive: canDelete });
  },
  closeAnnoDetail() {
    this.setData({ showAnnoDetail: false, activeAnno: null });
  },
  async deleteActiveAnnotation() {
    const { post, currentUserId, activeAnno } = this.data;
    if (!activeAnno) return;
    try {
      await api.deleteAnnotation(post.id, activeAnno.id, currentUserId);
      this.setData({
        annotations: this.data.annotations.filter(a => a.id !== activeAnno.id),
        showAnnoDetail: false, activeAnno: null
      });
      wx.showToast({ title: '已删除', icon: 'none' });
    } catch (error) {
      wx.showToast({ title: error.message || '删除失败', icon: 'none' });
    }
  },
  openChat() {
    wx.navigateTo({
      url: `/pages/chat/chat?postId=${this.data.post.id}`
    });
  },
});
