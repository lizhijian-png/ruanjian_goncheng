const LONG_PRESS_MS = 400;
const MOVE_CANCEL_PX = 10;

Component({
  properties: {
    annotations: { type: Array, value: [] },
    currentUserId: { type: String, value: '' },
    publisherId: { type: String, value: '' },
    cardWidth: { type: Number, value: 0 },
    cardHeight: { type: Number, value: 0 },
    visible: { type: Boolean, value: true }
  },
  data: { items: [] },
  observers: {
    'annotations, currentUserId, publisherId'(list, currentUserId, publisherId) {
      const items = (list || []).map(a => {
        let style = {};
        try { style = JSON.parse(a.style || '{}'); } catch (e) { style = {}; }
        const parts = [];
        if (style.color) parts.push(`color:${style.color}`);
        if (style.fontSize) parts.push(`font-size:${style.fontSize}rpx`);
        if (style.fontWeight) parts.push(`font-weight:${style.fontWeight}`);
        if (style.bg) parts.push(`background:${style.bg}`);
        const transforms = [];
        if (style.rotate) transforms.push(`rotate(${style.rotate}deg)`);
        if (style.scale && Number(style.scale) !== 1) transforms.push(`scale(${style.scale})`);
        if (transforms.length) parts.push(`transform:${transforms.join(' ')}`);
        const canDrag = (a.userId === currentUserId) || (publisherId && publisherId === currentUserId);
        const likeCount = Number(a.likeCount) || 0;
        const replyCount = Number(a.replyCount) || 0;
        const badgeParts = [];
        if (likeCount > 0) badgeParts.push(`❤${likeCount}`);
        if (replyCount > 0) badgeParts.push(`💬${replyCount}`);
        return {
          ...a,
          cssStyle: parts.join(';'),
          canDrag,
          dragging: false,
          badge: badgeParts.join(' '),
          hasBadge: badgeParts.length > 0
        };
      });
      this.setData({ items });
    }
  },
  methods: {
    _findIndex(id) {
      return this.data.items.findIndex(it => it.id === id);
    },
    onTouchStart(e) {
      const id = e.currentTarget.dataset.id;
      const idx = this._findIndex(id);
      if (idx < 0) return;
      const t = e.touches[0];
      const item = this.data.items[idx];
      this._drag = {
        id, idx,
        startClientX: t.clientX,
        startClientY: t.clientY,
        startX: Number(item.x),
        startY: Number(item.y),
        dragging: false,
        moved: false
      };
      if (item.canDrag) {
        this._timer = setTimeout(() => {
          if (!this._drag) return;
          this._drag.dragging = true;
          this.setData({ [`items[${idx}].dragging`]: true });
        }, LONG_PRESS_MS);
      }
    },
    onTouchMove(e) {
      if (!this._drag) return;
      const t = e.touches[0];
      const dxPx = t.clientX - this._drag.startClientX;
      const dyPx = t.clientY - this._drag.startClientY;
      if (!this._drag.dragging) {
        if (Math.abs(dxPx) > MOVE_CANCEL_PX || Math.abs(dyPx) > MOVE_CANCEL_PX) {
          this._drag.moved = true;
          clearTimeout(this._timer);
        }
        return;
      }
      const w = this.data.cardWidth || 1;
      const h = this.data.cardHeight || 1;
      const nx = Math.max(0, Math.min(100, this._drag.startX + (dxPx / w) * 100));
      const ny = Math.max(0, Math.min(100, this._drag.startY + (dyPx / h) * 100));
      this._drag.curX = nx;
      this._drag.curY = ny;
      this.setData({
        [`items[${this._drag.idx}].x`]: nx,
        [`items[${this._drag.idx}].y`]: ny
      });
    },
    onTouchEnd(e) {
      clearTimeout(this._timer);
      const d = this._drag;
      this._drag = null;
      if (!d) return;
      if (d.dragging) {
        const x = d.curX !== undefined ? d.curX : d.startX;
        const y = d.curY !== undefined ? d.curY : d.startY;
        this.setData({ [`items[${d.idx}].dragging`]: false });
        this.triggerEvent('dragend', { id: d.id, x, y });
      } else if (!d.moved) {
        this.triggerEvent('tapannotation', { id: d.id });
      }
    }
  }
});
