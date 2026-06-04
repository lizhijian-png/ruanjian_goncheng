Component({
  properties: {
    emojis: {
      type: Array,
      value: ['🔥', '💪', '👍', '❤️', '😂', '⭐', '🎯', '✨']
    }
  },
  data: {
    expanded: false
  },
  methods: {
    toggle() {
      this.setData({ expanded: !this.data.expanded });
    },
    pickText() {
      this.setData({ expanded: false });
      this.triggerEvent('pick', { kind: 'text' });
    },
    pickStamp(e) {
      const emoji = e.currentTarget.dataset.emoji;
      this.setData({ expanded: false });
      this.triggerEvent('pick', { kind: 'stamp', value: emoji });
    }
  }
});
