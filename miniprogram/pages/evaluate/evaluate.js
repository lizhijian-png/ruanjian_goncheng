const api = require('../../services/api');

Page({
  data: {
    postId: '',
    targetUserId: '',
    targetNickname: '',
    currentUserId: '',
    targetEvidence: '',
    evidenceLoading: true,
    evalScore: 5,
    evalContent: '',
    submitting: false,
    completionVote: 'complete',  // 'complete' | 'incomplete', default supports completion
    voteSubmitting: false,
    deadlinePassed: false
  },
  async onLoad(options) {
    const { postId, targetUserId } = options;
    const targetNickname = decodeURIComponent(options.targetNickname || '');
    const app = getApp();
    const userInfo = app.globalData.userInfo || wx.getStorageSync('userInfo');
    const currentUserId = userInfo ? userInfo.id : '';
    this.setData({ postId, targetUserId, targetNickname, currentUserId });
    try {
      const detail = await api.getPostDetail(postId, currentUserId);
      const evidence = (detail.evidenceList || []).find(e => e.submitterId === targetUserId);

      const deadline = detail.post && detail.post.evaluationDeadline;
      const deadlinePassed = deadline ? new Date() > new Date(deadline) : false;

      // Restore previously cast vote if any; absent key means not voted (visually defaults to 'complete')
      const myVotes = detail.myCompletionVotes || {};
      const completionVote = myVotes[targetUserId] || 'complete';

      this.setData({
        targetEvidence: evidence ? evidence.value : '',
        evidenceLoading: false,
        completionVote,
        deadlinePassed
      });
    } catch (err) {
      this.setData({ evidenceLoading: false });
      wx.showToast({ title: err.message || '加载失败', icon: 'none' });
    }
  },
  onEvalScoreChange(e) {
    this.setData({ evalScore: Number(e.detail.value) });
  },
  onEvalContentInput(e) {
    this.setData({ evalContent: e.detail.value });
  },
  cancel() {
    wx.navigateBack();
  },
  async onVoteComplete(e) {
    if (this.data.deadlinePassed || this.data.voteSubmitting) return;
    const vote = e.currentTarget.dataset.vote;
    if (vote === this.data.completionVote) return;

    this.setData({ voteSubmitting: true });
    try {
      await api.submitCompletionVote(
        this.data.postId,
        this.data.currentUserId,
        this.data.targetUserId,
        vote
      );
      this.setData({ completionVote: vote });
    } catch (err) {
      wx.showToast({ title: err.message || '投票失败', icon: 'none' });
    } finally {
      this.setData({ voteSubmitting: false });
    }
  },
  async submit() {
    if (this.data.submitting) return;
    const { postId, currentUserId, targetUserId, evalScore, evalContent } = this.data;
    if (!String(evalContent).trim()) {
      wx.showToast({ title: '请填写评价内容', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    try {
      await api.submitEvaluation(postId, currentUserId, targetUserId, evalScore, evalContent);
      wx.showToast({ title: '评价已提交', icon: 'success' });
      wx.navigateBack();
    } catch (err) {
      wx.showToast({ title: err.message || '提交失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
