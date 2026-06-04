Component({
  properties: {
    annotations: { type: Array, value: [] }
  },
  data: { items: [] },
  observers: {
    annotations(list) {
      const items = (list || []).map(a => {
        let style = {};
        try { style = JSON.parse(a.style || '{}'); } catch (e) { style = {}; }
        const parts = [];
        if (style.color) parts.push(`color:${style.color}`);
        if (style.fontSize) parts.push(`font-size:${style.fontSize}rpx`);
        if (style.fontWeight) parts.push(`font-weight:${style.fontWeight}`);
        if (style.bg) parts.push(`background:${style.bg}`);
        if (style.rotate) parts.push(`transform:rotate(${style.rotate}deg)`);
        return { ...a, cssStyle: parts.join(';') };
      });
      this.setData({ items });
    }
  },
  methods: {
    onTapAnnotation(e) {
      this.triggerEvent('tapannotation', { id: e.currentTarget.dataset.id });
    }
  }
});
