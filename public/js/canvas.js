/**
 * canvas.js
 *
 * The drawing engine. Owns the <canvas> element, pointer input handling
 * (mouse / touch / stylus via the unified Pointer Events API, including
 * pressure), the stroke history (for undo/redraw), and the background
 * colour.
 *
 * The backing store is a fixed 1024x1024 logical resolution — CSS scales it
 * responsively for display, and 1024x1024 also happens to be the size we
 * request from the image API, so no rescaling is needed before export.
 */

(function (global) {
  const LOGICAL_SIZE = 1024;

  class DrawingCanvas {
    constructor(canvasEl) {
      this.canvas = canvasEl;
      this.ctx = canvasEl.getContext('2d', { willReadFrequently: false });

      this.canvas.width = LOGICAL_SIZE;
      this.canvas.height = LOGICAL_SIZE;

      // Tool state
      this.brushId = 'pen';
      this.color = '#7c5cff';
      this.size = 14;
      this.isEraser = false;
      this.bgColor = '#ffffff';

      // History of completed strokes, for undo + full redraws.
      this.history = [];
      this.currentStroke = null;
      this.activePointerId = null;

      this._bindEvents();
      this.redrawAll();
    }

    setBrush(id) { this.brushId = id; this.isEraser = false; }
    setColor(hex) { this.color = hex; }
    setSize(px) { this.size = px; }
    setEraser(on) { this.isEraser = on; }
    setBackground(hex) {
      this.bgColor = hex;
      this.redrawAll();
    }

    undo() {
      this.history.pop();
      this.redrawAll();
    }

    clear() {
      this.history = [];
      this.redrawAll();
    }

    toDataURL() {
      return this.canvas.toDataURL('image/png');
    }

    hasDrawing() {
      return this.history.length > 0;
    }

    // ---- internal -------------------------------------------------

    _bindEvents() {
      const el = this.canvas;
      el.style.touchAction = 'none';

      el.addEventListener('pointerdown', (e) => this._onPointerDown(e));
      el.addEventListener('pointermove', (e) => this._onPointerMove(e));
      el.addEventListener('pointerup', (e) => this._onPointerEnd(e));
      el.addEventListener('pointercancel', (e) => this._onPointerEnd(e));
      el.addEventListener('pointerleave', (e) => {
        if (e.pointerId === this.activePointerId) this._onPointerEnd(e);
      });
      // Belt-and-braces: stop the page from scrolling on touch devices
      // even if touch-action is somehow overridden.
      el.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
      el.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    }

    _getPoint(e) {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
        pressure: e.pressure > 0 ? e.pressure : 0.5,
      };
    }

    _onPointerDown(e) {
      e.preventDefault();
      try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { /* no-op */ }
      this.activePointerId = e.pointerId;

      const pt = this._getPoint(e);
      this.currentStroke = {
        tool: this.isEraser ? 'eraser' : 'brush',
        brushId: this.brushId,
        color: this.color,
        size: this.size,
        points: [pt],
      };
      this._paintSegment(this.currentStroke, pt, pt);
    }

    _onPointerMove(e) {
      if (!this.currentStroke || e.pointerId !== this.activePointerId) return;
      e.preventDefault();

      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      const pts = events.length ? events : [e];
      for (const ev of pts) {
        const pt = this._getPoint(ev);
        const last = this.currentStroke.points[this.currentStroke.points.length - 1];
        this._paintSegment(this.currentStroke, last, pt);
        this.currentStroke.points.push(pt);
      }
    }

    _onPointerEnd(e) {
      if (!this.currentStroke || e.pointerId !== this.activePointerId) return;
      this.history.push(this.currentStroke);
      this.currentStroke = null;
      this.activePointerId = null;
      try { this.canvas.releasePointerCapture(e.pointerId); } catch (_) { /* no-op */ }
      if (typeof this.onStrokeEnd === 'function') this.onStrokeEnd();
    }

    // Paints one segment straight to the visible canvas (used for both live
    // drawing and full redraws).
    _paintSegment(stroke, p0, p1) {
      if (stroke.tool === 'eraser') {
        this.ctx.save();
        this.ctx.globalAlpha = 1;
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.strokeStyle = this.bgColor;
        this.ctx.lineWidth = stroke.size;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.beginPath();
        this.ctx.moveTo(p0.x, p0.y);
        this.ctx.lineTo(p1.x, p1.y);
        this.ctx.stroke();
        this.ctx.restore();
        return;
      }
      const brush = global.BRUSHES[stroke.brushId] || global.BRUSHES.pen;
      brush.stroke(this.ctx, p0, p1, {
        size: stroke.size,
        color: stroke.color,
        pressure: p1.pressure != null ? p1.pressure : 0.5,
      });
    }

    redrawAll() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.fillStyle = this.bgColor;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      for (const stroke of this.history) {
        const pts = stroke.points;
        if (pts.length === 1) {
          this._paintSegment(stroke, pts[0], pts[0]);
        } else {
          for (let i = 1; i < pts.length; i++) {
            this._paintSegment(stroke, pts[i - 1], pts[i]);
          }
        }
      }
    }
  }

  global.DrawingCanvas = DrawingCanvas;
})(window);
