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
    annoVisible: true,
    cardWidth: 0,
    cardHeight: 0,
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
    activeRotate: 0,
    activeScale: 1,
    activeColor: '#333333',
    activeFontSize: 28,
    editingAnno: false,
    editContent: '',
    colorOptions: ['#333333', '#e74c3c', '#27ae60', '#2980b9', '#f39c12', '#8e44ad'],
    // 点赞 / 回复
    activeLiked: false,
    activeLikeCount: 0,
    activeReplies: [],
    replyInput: '',
    replyLoading: false,
    // 回收站
    showTrash: false,
    trashList: [],
    canOpenChat: false,
    // 通知
    unreadChat: 0,
    showNotification: false,
    notificationContent: '',
    notificationType: '',
    _prevNotifSnapshot: {},
  },
  async onLoad(options) {
    this._firstShow = true;
    this._pollPostId = options.id;
    const app = getApp();
    const userInfo = app.globalData.userInfo || wx.getStorageSync('userInfo');
    const currentUserId = userInfo ? userInfo.id : '';
    this.setData({ currentUserId });
    await this._loadDetail(options.id);
    if (this.data.isParticipant) {
      this._startPolling();
    }
  },
  onShow() {
    if (this._firstShow) { this._firstShow = false; return; }
    if ((this._returnFromEvaluate || this._returnFromEvidence) && this.data.post) {
      this._returnFromEvaluate = false;
      this._returnFromEvidence = false;
      this._loadDetail(this.data.post.id).then(() => {
        if (this.data.isParticipant) this._startPolling();
      });
    } else if (this.data.isParticipant) {
      // 从聊天返回时,先静默同步通知快照,防止旧通知触发弹窗
      this.setData({ unreadChat: 0 });
      this._syncNotifSnapshot().then(() => this._startPolling());
    }
  },
  onHide() {
    this._stopPolling();
  },
  onUnload() {
    this._stopPolling();
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
        const annoRes = await api.getAnnotations(post.id, currentUserId);
        this.setData({ annotations: annoRes.annotations || [] });
      } catch (e) {
        this.setData({ annotations: [] });
        wx.showToast({ title: '批注加载失败', icon: 'none' });
      }
      this._measureCard();
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
    let rotate = 0, scale = 1, color = '#333333', fontSize = 28;
    try {
      const st = JSON.parse(anno.style || '{}');
      rotate = Number(st.rotate) || 0;
      scale = Number(st.scale) || 1;
      if (st.color) color = st.color;
      if (st.fontSize) fontSize = Number(st.fontSize);
    } catch (err) { rotate = 0; scale = 1; }
    this.setData({
      showAnnoDetail: true, activeAnno: anno, canDeleteActive: canDelete,
      activeRotate: rotate, activeScale: scale, activeColor: color, activeFontSize: fontSize,
      editingAnno: false, editContent: anno.content,
      activeLiked: !!anno.liked, activeLikeCount: Number(anno.likeCount) || 0,
      activeReplies: [], replyInput: ''
    });
    this._loadReplies(anno.id);
  },
  async _loadReplies(annId) {
    const { post } = this.data;
    try {
      const res = await api.getAnnotationReplies(post.id, annId);
      // 弹层可能已切换到别的批注,确认还在看同一条才写入
      if (this.data.activeAnno && this.data.activeAnno.id === annId) {
        this.setData({ activeReplies: res.replies || [] });
      }
    } catch (e) {
      // 回复加载失败不阻断弹层,静默
    }
  },
  _measureCard() {
    const q = wx.createSelectorQuery().in(this);
    q.select('.detail-card').boundingClientRect();
    q.exec((res) => {
      const rect = res[0];
      if (rect) {
        this.setData({ cardWidth: rect.width, cardHeight: rect.height });
      }
    });
  },
  onToggleAnnoVisible() {
    this.setData({ annoVisible: !this.data.annoVisible });
  },
  async onAnnotationDragEnd(e) {
    const { id, x, y } = e.detail;
    const { post, currentUserId } = this.data;
    const idx = this.data.annotations.findIndex(a => a.id === id);
    if (idx < 0) return;
    const oldX = this.data.annotations[idx].x;
    const oldY = this.data.annotations[idx].y;
    this.setData({
      [`annotations[${idx}].x`]: x,
      [`annotations[${idx}].y`]: y
    });
    try {
      const res = await api.updateAnnotationPosition(post.id, id, currentUserId, x, y);
      this.setData({ [`annotations[${idx}]`]: res.annotation });
    } catch (error) {
      this.setData({
        [`annotations[${idx}].x`]: oldX,
        [`annotations[${idx}].y`]: oldY
      });
      wx.showToast({ title: error.message || '移动失败', icon: 'none' });
    }
  },
  closeAnnoDetail() {
    this.setData({ showAnnoDetail: false, activeAnno: null });
  },
  onRotateChanging(e) {
    // 拖动中实时预览:更新弹层角度 + 批注层该条
    const rotate = Number(e.detail.value);
    const id = this.data.activeAnno && this.data.activeAnno.id;
    if (!id) return;
    const idx = this.data.annotations.findIndex(a => a.id === id);
    if (idx < 0) return;
    let style = {};
    try { style = JSON.parse(this.data.annotations[idx].style || '{}'); } catch (err) { style = {}; }
    style.rotate = rotate;
    this.setData({
      activeRotate: rotate,
      [`annotations[${idx}].style`]: JSON.stringify(style)
    });
  },
  async onRotateChange(e) {
    // 松手保存
    const rotate = Number(e.detail.value);
    const { post, currentUserId, activeAnno } = this.data;
    if (!activeAnno) return;
    const id = activeAnno.id;
    const idx = this.data.annotations.findIndex(a => a.id === id);
    if (idx < 0) return;
    const oldStyle = activeAnno.style;
    try {
      const res = await api.updateAnnotationRotate(post.id, id, currentUserId, rotate);
      this.setData({
        [`annotations[${idx}]`]: res.annotation,
        activeAnno: res.annotation
      });
    } catch (error) {
      this.setData({ [`annotations[${idx}].style`]: oldStyle, activeRotate: this._parseRotate(oldStyle) });
      wx.showToast({ title: error.message || '旋转失败', icon: 'none' });
    }
  },
  _parseRotate(styleStr) {
    try { return Number(JSON.parse(styleStr || '{}').rotate) || 0; } catch (e) { return 0; }
  },
  onScaleChanging(e) {
    const scale = Number(e.detail.value);
    const id = this.data.activeAnno && this.data.activeAnno.id;
    if (!id) return;
    const idx = this.data.annotations.findIndex(a => a.id === id);
    if (idx < 0) return;
    let style = {};
    try { style = JSON.parse(this.data.annotations[idx].style || '{}'); } catch (err) { style = {}; }
    style.scale = scale;
    this.setData({
      activeScale: scale,
      [`annotations[${idx}].style`]: JSON.stringify(style)
    });
  },
  async onScaleChange(e) {
    const scale = Number(e.detail.value);
    const { post, currentUserId, activeAnno } = this.data;
    if (!activeAnno) return;
    const id = activeAnno.id;
    const idx = this.data.annotations.findIndex(a => a.id === id);
    if (idx < 0) return;
    const oldStyle = activeAnno.style;
    try {
      const res = await api.updateAnnotationScale(post.id, id, currentUserId, scale);
      this.setData({
        [`annotations[${idx}]`]: res.annotation,
        activeAnno: res.annotation
      });
    } catch (error) {
      this.setData({ [`annotations[${idx}].style`]: oldStyle, activeScale: this._parseScale(oldStyle) });
      wx.showToast({ title: error.message || '缩放失败', icon: 'none' });
    }
  },
  _parseScale(styleStr) {
    try { return Number(JSON.parse(styleStr || '{}').scale) || 1; } catch (e) { return 1; }
  },
  // ===== 内容/样式编辑 =====
  noop() {},
  startEditAnno() {
    const anno = this.data.activeAnno;
    if (!anno) return;
    this.setData({ editingAnno: true, editContent: anno.content });
  },
  cancelEditAnno() {
    this.setData({ editingAnno: false, editContent: this.data.activeAnno ? this.data.activeAnno.content : '' });
  },
  onEditContentInput(e) {
    this.setData({ editContent: e.detail.value });
  },
  async saveEditContent() {
    const { post, currentUserId, activeAnno, editContent } = this.data;
    if (!activeAnno) return;
    const content = String(editContent || '').trim();
    if (!content) {
      wx.showToast({ title: '内容不能为空', icon: 'none' });
      return;
    }
    try {
      const res = await api.updateAnnotationContent(post.id, activeAnno.id, currentUserId, { content });
      const idx = this.data.annotations.findIndex(a => a.id === activeAnno.id);
      const patch = { activeAnno: res.annotation, editingAnno: false };
      if (idx >= 0) patch[`annotations[${idx}]`] = res.annotation;
      this.setData(patch);
      wx.showToast({ title: '已保存', icon: 'none' });
    } catch (error) {
      wx.showToast({ title: error.message || '保存失败', icon: 'none' });
    }
  },
  async onPickColor(e) {
    const color = e.currentTarget.dataset.color;
    const { post, currentUserId, activeAnno } = this.data;
    if (!activeAnno || color === this.data.activeColor) return;
    const idx = this.data.annotations.findIndex(a => a.id === activeAnno.id);
    if (idx < 0) return;
    const oldColor = this.data.activeColor;
    const oldStyle = activeAnno.style;
    try {
      const res = await api.updateAnnotationContent(post.id, activeAnno.id, currentUserId, { color });
      this.setData({
        [`annotations[${idx}]`]: res.annotation,
        activeAnno: res.annotation, activeColor: color
      });
    } catch (error) {
      this.setData({ [`annotations[${idx}].style`]: oldStyle, activeColor: oldColor });
      wx.showToast({ title: error.message || '改色失败', icon: 'none' });
    }
  },
  onFontSizeChanging(e) {
    const fontSize = Number(e.detail.value);
    const id = this.data.activeAnno && this.data.activeAnno.id;
    if (!id) return;
    const idx = this.data.annotations.findIndex(a => a.id === id);
    if (idx < 0) return;
    let style = {};
    try { style = JSON.parse(this.data.annotations[idx].style || '{}'); } catch (err) { style = {}; }
    style.fontSize = fontSize;
    this.setData({
      activeFontSize: fontSize,
      [`annotations[${idx}].style`]: JSON.stringify(style)
    });
  },
  async onFontSizeChange(e) {
    const fontSize = Number(e.detail.value);
    const { post, currentUserId, activeAnno } = this.data;
    if (!activeAnno) return;
    const idx = this.data.annotations.findIndex(a => a.id === activeAnno.id);
    if (idx < 0) return;
    const oldStyle = activeAnno.style;
    try {
      const res = await api.updateAnnotationContent(post.id, activeAnno.id, currentUserId, { fontSize });
      this.setData({
        [`annotations[${idx}]`]: res.annotation,
        activeAnno: res.annotation
      });
    } catch (error) {
      this.setData({ [`annotations[${idx}].style`]: oldStyle, activeFontSize: this._parseFontSize(oldStyle) });
      wx.showToast({ title: error.message || '字号修改失败', icon: 'none' });
    }
  },
  _parseFontSize(styleStr) {
    try { return Number(JSON.parse(styleStr || '{}').fontSize) || 28; } catch (e) { return 28; }
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
      wx.showToast({ title: '已移入回收站', icon: 'none' });
    } catch (error) {
      wx.showToast({ title: error.message || '删除失败', icon: 'none' });
    }
  },
  // ===== 点赞 / 回复 =====
  _patchAnnoInList(annId, patch) {
    const idx = this.data.annotations.findIndex(a => a.id === annId);
    if (idx < 0) return;
    const upd = {};
    Object.keys(patch).forEach(k => { upd[`annotations[${idx}].${k}`] = patch[k]; });
    this.setData(upd);
  },
  async onToggleLike() {
    const { post, currentUserId, activeAnno, activeLiked, activeLikeCount } = this.data;
    if (!activeAnno) return;
    if (!currentUserId) { wx.showToast({ title: '请先登录', icon: 'none' }); return; }
    // 乐观更新
    const nextLiked = !activeLiked;
    const nextCount = activeLikeCount + (nextLiked ? 1 : -1);
    this.setData({ activeLiked: nextLiked, activeLikeCount: nextCount });
    this._patchAnnoInList(activeAnno.id, { liked: nextLiked, likeCount: nextCount });
    try {
      const res = await api.toggleAnnotationLike(post.id, activeAnno.id, currentUserId);
      // 以服务端返回为准校正
      this.setData({ activeLiked: res.liked, activeLikeCount: res.likeCount });
      this._patchAnnoInList(activeAnno.id, { liked: res.liked, likeCount: res.likeCount });
    } catch (error) {
      // 回滚
      this.setData({ activeLiked, activeLikeCount });
      this._patchAnnoInList(activeAnno.id, { liked: activeLiked, likeCount: activeLikeCount });
      wx.showToast({ title: error.message || '操作失败', icon: 'none' });
    }
  },
  onReplyInput(e) {
    this.setData({ replyInput: e.detail.value });
  },
  async submitReply() {
    const { post, currentUserId, activeAnno, replyInput, replyLoading } = this.data;
    if (!activeAnno || replyLoading) return;
    if (!currentUserId) { wx.showToast({ title: '请先登录', icon: 'none' }); return; }
    const content = String(replyInput || '').trim();
    if (!content) { wx.showToast({ title: '回复不能为空', icon: 'none' }); return; }
    this.setData({ replyLoading: true });
    try {
      const res = await api.createAnnotationReply(post.id, activeAnno.id, currentUserId, content);
      const replies = this.data.activeReplies.concat(res.reply);
      this.setData({ activeReplies: replies, replyInput: '' });
      this._patchAnnoInList(activeAnno.id, { replyCount: replies.length });
    } catch (error) {
      wx.showToast({ title: error.message || '回复失败', icon: 'none' });
    } finally {
      this.setData({ replyLoading: false });
    }
  },
  async deleteReply(e) {
    const replyId = e.currentTarget.dataset.id;
    const { post, currentUserId, activeAnno } = this.data;
    if (!activeAnno || !replyId) return;
    try {
      await api.deleteAnnotationReply(post.id, activeAnno.id, replyId, currentUserId);
      const replies = this.data.activeReplies.filter(r => r.id !== replyId);
      this.setData({ activeReplies: replies });
      this._patchAnnoInList(activeAnno.id, { replyCount: replies.length });
    } catch (error) {
      wx.showToast({ title: error.message || '删除失败', icon: 'none' });
    }
  },
  // ===== 回收站 =====
  async openTrash() {
    const { post, currentUserId } = this.data;
    try {
      const res = await api.getAnnotationTrash(post.id, currentUserId);
      this.setData({ showTrash: true, trashList: res.trash || [] });
    } catch (error) {
      wx.showToast({ title: error.message || '回收站加载失败', icon: 'none' });
    }
  },
  closeTrash() {
    this.setData({ showTrash: false });
  },
  async restoreFromTrash(e) {
    const annId = e.currentTarget.dataset.id;
    const { post, currentUserId } = this.data;
    if (!annId) return;
    try {
      await api.restoreAnnotation(post.id, annId, currentUserId);
      // 软删未动赞/回复,恢复后重新拉一次列表,拿到准确的点赞/回复计数
      this.setData({ trashList: this.data.trashList.filter(a => a.id !== annId) });
      try {
        const annoRes = await api.getAnnotations(post.id, currentUserId);
        this.setData({ annotations: annoRes.annotations || [] });
      } catch (e) { /* 列表刷新失败不阻断恢复结果 */ }
      wx.showToast({ title: '已恢复', icon: 'none' });
    } catch (error) {
      wx.showToast({ title: error.message || '恢复失败', icon: 'none' });
    }
  },
  // ===== 通知轮询 & 弹窗 =====
  async _syncNotifSnapshot() {
    const { currentUserId, post } = this.data;
    if (!currentUserId || !post) return;
    try {
      const res = await api.getUnreadCounts(currentUserId, post.id);
      this.data._prevNotifSnapshot = {};
      for (const key of ['task_start', 'evidence_submit', 'new_chat']) {
        if (res[key] > 0) this.data._prevNotifSnapshot[key] = res[key];
      }
      this.setData({ unreadChat: res.chat || 0 });
    } catch (e) {
      this.data._prevNotifSnapshot = {};
    }
  },
  _startPolling() {
    this._stopPolling();
    this._pollNotifications(); // 立即执行一次
    this._pollTimer = setInterval(() => {
      this._pollNotifications();
    }, 10000);
  },
  _stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  },
  async _pollNotifications() {
    const { currentUserId, post, _prevNotifSnapshot } = this.data;
    if (!currentUserId || !post) return;
    try {
      const res = await api.getUnreadCounts(currentUserId, post.id);
      this.setData({ unreadChat: res.chat || 0 });

      if (res.latest && res.latest.type) {
        const prevCount = _prevNotifSnapshot[res.latest.type] || 0;
        const currentCount = res[res.latest.type] || 0;
        if (currentCount > prevCount) {
          this._showNotificationPopup(res.latest.type, res.latest.content);
        }
      }
      this.data._prevNotifSnapshot = {};
      for (const key of ['task_start', 'evidence_submit', 'new_chat']) {
        if (res[key] > 0) this.data._prevNotifSnapshot[key] = res[key];
      }
    } catch (e) {
      // 轮询失败静默处理
    }
  },
  _showNotificationPopup(type, content) {
    if (this._notifDismissTimer) clearTimeout(this._notifDismissTimer);
    this.setData({
      showNotification: true,
      notificationContent: content,
      notificationType: type
    });
    this._notifDismissTimer = setTimeout(() => {
      this.dismissNotif();
    }, 3000);
  },
  dismissNotif() {
    if (this._notifDismissTimer) {
      clearTimeout(this._notifDismissTimer);
      this._notifDismissTimer = null;
    }
    const { currentUserId, post, notificationType } = this.data;
    this.setData({ showNotification: false, notificationContent: '', notificationType: '' });
    if (currentUserId && post && notificationType) {
      api.markNotificationsRead(currentUserId, post.id, notificationType).catch(() => {});
    }
  },
  onNotifTap() {
    const { notificationType } = this.data;
    this.dismissNotif();
    if (notificationType === 'new_chat') {
      this.openChat();
    } else if (notificationType === 'evidence_submit') {
      this.openEvidencePage();
    }
    // task_start: 弹窗消失即可,页面已刷新状态
  },
  openChat() {
    // 进入聊天室前标记聊天已读
    const { currentUserId, post } = this.data;
    if (currentUserId && post) {
      api.markChatRead(post.id, currentUserId).catch(() => {});
    }
    wx.navigateTo({
      url: `/pages/chat/chat?postId=${this.data.post.id}`
    });
  },
  goUserProfile(e) {
    const { userid } = e.currentTarget.dataset;
    if (!userid) return;

    const app = getApp();
    const userInfo = app.globalData.userInfo || wx.getStorageSync('userInfo');
    if (!userInfo || !userInfo.id) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }

    if (userid === userInfo.id) {
      wx.switchTab({ url: '/pages/profile/profile' });
      return;
    }

    wx.navigateTo({
      url: `/pages/user-profile/user-profile?userId=${userid}`
    });
  },
});
