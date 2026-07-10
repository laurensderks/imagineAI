/**
 * canvas.js
 *
 * The drawing engine. Owns the <canvas> element, pointer input handling
 * (mouse / touch / stylus via the unified Pointer Events API, including
 * pressure), the stroke history (for undo/redraw), and the background
 * colour.
 *
 * Incoming pointer input runs through a STABILIZER: each raw point is eased
 * toward the previous drawn point, filtering hand wobble into confident,
 * flowing lines (with a catch-up pass on release so strokes still finish
 * exactly where the pointer lifted). The smoothed points are what's stored,
 * so replays are identical.
 *
 * The backing store is a fixed 1024x1024 logical resolution — CSS scales it
 * responsively for display, and 1024x1024 also happens to be the size we
 * request from the image API, so no rescaling is needed before export.
 */

(function (global) {
  const LOGICAL_SIZE = 1024;
  const SMOOTHING = 0.35;  // how far each raw point pulls the line (lower = steadier)
  const MIN_DIST = 0.8;    // ignore sub-pixel jitter between events

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
      this._suspended = false;  // true during a multi-touch gesture (pinch-zoom)
      this._traceBlock = false; // true while adjusting a trace reference image
      this._penOnly = false;    // true = only a stylus draws; finger is ignored

      this._bindEvents();
      this.redrawAll();
    }

    setBrush(id) { this.brushId = id; this.isEraser = false; }
    setColor(hex) { this.color = hex; }
    setSize(px) { this.size = px; }
    setEraser(on) { this.isEraser = on; }

    // Discards the in-progress stroke (if any) and repaints from history only,
    // wiping any pixels the aborted stroke had already painted live.
    cancelActiveStroke() {
      this._lastRaw = null;
      if (this.currentStroke) {
        this.currentStroke = null;
        this.activePointerId = null;
        this.redrawAll();
      }
    }

    // Called by zoom.js while a two-finger pinch gesture is in progress, so a
    // second touch point doesn't get interpreted as (or interfere with) a
    // drawing stroke.
    setSuspended(suspended) {
      this._suspended = suspended;
      if (suspended) this.cancelActiveStroke();
    }

    // Blocks new strokes while a trace image is being positioned, so taps
    // outside the reference don't draw. Independent of pinch-zoom's suspend.
    setTraceBlock(blocked) {
      this._traceBlock = blocked;
      if (blocked) this.cancelActiveStroke();
    }

    // Pen-only mode: only a stylus ('pen') may draw; finger touches are
    // ignored. Lets people draw in iPad fullscreen without a stray finger
    // stroke (and finger swipes stay free for the system's own gestures).
    setPenOnly(on) { this._penOnly = !!on; }
    isPenOnly() { return this._penOnly; }

    undo() {
      this.history.pop();
      this.redrawAll();
    }

    clear() {
      this.history = [];
      this.redrawAll();
    }

    // Called by pages.js when switching pages: swaps in a different page's
    // stroke history (each page keeps its own array) without touching
    // current tool settings like brush/colour/size.
    loadPage(historyArray) {
      this.currentStroke = null;
      this.activePointerId = null;
      this.history = historyArray;
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
      if (this._suspended || this._traceBlock) return;
      if (this._penOnly && e.pointerType === 'touch') return; // finger ignored
      e.preventDefault();

      // A second pointer landing while one is already active means this is a
      // multi-touch gesture (pinch-to-zoom), not a drawing stroke — bail out
      // and wait for zoom.js to lift the suspension once all touches end.
      if (this.activePointerId !== null) {
        this.cancelActiveStroke();
        this._suspended = true;
        return;
      }

      try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { /* no-op */ }
      this.activePointerId = e.pointerId;

      const pt = this._getPoint(e);
      this._lastRaw = pt;
      this.currentStroke = {
        tool: this.isEraser ? 'eraser' : 'brush',
        brushId: this.brushId,
        color: this.color,
        size: this.size,
        points: [pt],
        _state: {}, // per-stroke scratch for brushes (width smoothing etc.)
      };
      this._paintSegment(this.currentStroke, pt, pt);
    }

    _onPointerMove(e) {
      if (!this.currentStroke || e.pointerId !== this.activePointerId) return;
      e.preventDefault();

      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      const pts = events.length ? events : [e];
      for (const ev of pts) {
        const raw = this._getPoint(ev);
        this._lastRaw = raw;
        // Stabilizer: ease toward the raw point rather than jumping to it.
        const last = this.currentStroke.points[this.currentStroke.points.length - 1];
        const pt = {
          x: last.x + (raw.x - last.x) * SMOOTHING,
          y: last.y + (raw.y - last.y) * SMOOTHING,
          pressure: last.pressure + (raw.pressure - last.pressure) * SMOOTHING,
        };
        if (Math.hypot(pt.x - last.x, pt.y - last.y) < MIN_DIST) continue;
        this._paintSegment(this.currentStroke, last, pt);
        this.currentStroke.points.push(pt);
      }
    }

    _onPointerEnd(e) {
      if (!this.currentStroke || e.pointerId !== this.activePointerId) return;

      // Catch-up: the stabilizer trails behind the pointer, so ease the tail
      // out to where the pointer actually lifted — strokes end on target.
      const raw = this._lastRaw;
      if (raw) {
        for (let i = 0; i < 6; i++) {
          const last = this.currentStroke.points[this.currentStroke.points.length - 1];
          if (Math.hypot(raw.x - last.x, raw.y - last.y) < 0.6) break;
          const pt = {
            x: last.x + (raw.x - last.x) * 0.5,
            y: last.y + (raw.y - last.y) * 0.5,
            pressure: last.pressure + (raw.pressure - last.pressure) * 0.5,
          };
          this._paintSegment(this.currentStroke, last, pt);
          this.currentStroke.points.push(pt);
        }
      }
      this._lastRaw = null;

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
        state: stroke._state || (stroke._state = {}),
      });
    }

    redrawAll() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.fillStyle = this.bgColor;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      for (const stroke of this.history) {
        stroke._state = {}; // fresh scratch so tapers/dedupe replay identically
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
