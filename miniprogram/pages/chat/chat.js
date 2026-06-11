const api = require('../../services/api');
const config = require('../../env');

function formatTime(val) {
  const d = new Date(val);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

Page({
  data: {
    messages: [],
    inputText: '',
    isClosed: false,
    currentUserId: '',
    postId: '',
    scrollTarget: ''
  },

  _postId: '',
  _socketOpen: false,
  _reconnectCount: 0,
  _maxReconnect: 3,

  async onLoad(options) {
    const app = getApp();
    const userInfo = app.globalData.userInfo || wx.getStorageSync('userInfo');
    const currentUserId = userInfo ? userInfo.id : '';
    const postId = options.postId || '';
    this._postId = postId;
    this.setData({ currentUserId, postId });

    try {
      const { messages } = await api.getChatHistory(postId, currentUserId);
      const formatted = (messages || []).map(m => ({
        ...m,
        timeStr: formatTime(m.createdAt)
      }));
      this.setData({ messages: formatted, scrollTarget: 'msg-bottom' });
    } catch (e) {
      wx.showToast({ title: '加载历史消息失败', icon: 'none' });
    }

    this._connect();
  },

  _connect() {
    const { currentUserId } = this.data;
    const postId = this._postId;
    const wsBase = config.apiBaseUrl.replace(/^http/, 'ws');
    const wsUrl = `${wsBase}/chat?postId=${encodeURIComponent(postId)}&userId=${encodeURIComponent(currentUserId)}`;

    wx.connectSocket({ url: wsUrl });

    wx.onSocketOpen(() => {
      this._socketOpen = true;
      this._reconnectCount = 0;
    });

    wx.onSocketMessage((res) => {
      let msg;
      try { msg = JSON.parse(res.data); } catch { return; }

      if (msg.type === 'room_closed') {
        this._socketOpen = false;
        wx.closeSocket();
        this.setData({ isClosed: true });
        return;
      }

      if (msg.type === 'message') {
        const newMsg = { ...msg, timeStr: formatTime(msg.createdAt) };
        this.setData({
          messages: [...this.data.messages, newMsg],
          scrollTarget: 'msg-bottom'
        });
      }
    });

    wx.onSocketClose(() => {
      this._socketOpen = false;
      if (!this.data.isClosed && this._reconnectCount < this._maxReconnect) {
        this._reconnectCount++;
        setTimeout(() => this._connect(), 2000);
      }
    });

    wx.onSocketError(() => {
      this._socketOpen = false;
    });
  },

  onInput(e) {
    this.setData({ inputText: e.detail.value });
  },

  sendMessage() {
    const content = String(this.data.inputText || '').trim();
    if (!content) return;
    if (content.length > 500) {
      wx.showToast({ title: '消息不能超过500字', icon: 'none' });
      return;
    }
    if (!this._socketOpen) {
      wx.showToast({ title: '连接已断开，请稍后重试', icon: 'none' });
      return;
    }
    wx.sendSocketMessage({ data: JSON.stringify({ type: 'message', content }) });
    this.setData({ inputText: '' });
  },

  onUnload() {
    if (this._socketOpen) {
      wx.closeSocket();
    }
  }
});
