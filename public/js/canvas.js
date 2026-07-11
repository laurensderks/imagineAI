/**
 * canvas.js
 *
 * The drawing engine. Owns the drawing surface, pointer input handling
 * (mouse / touch / stylus via the unified Pointer Events API, including
 * pressure), the per-layer stroke history (for undo/redraw), and the
 * background colour.
 *
 * LAYERS: each page has three stacked <canvas> layers — back, middle,
 * foreground — that the browser composites for free (correct z-order, and
 * live drawing only ever touches the ACTIVE layer, so it stays fast no matter
 * how much is on the other layers). A transparent input surface sits on top of
 * the stack and receives all pointer events; `this.canvas` / `this.ctx` /
 * `this.history` always mirror the active layer so the drawing + undo code
 * stays layer-agnostic. Export flattens the three layers onto a white
 * background.
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
  // How long each frame may spend replaying strokes during a page load. Higher
  // = the page finishes sooner (wall-clock closer to a raw redraw), lower = the
  // app stays more responsive and the tab fill animates more smoothly.
  const LOAD_FRAME_BUDGET_MS = 24;

  class DrawingCanvas {
    constructor(inputEl, layerEls) {
      // Transparent surface on top of the layer stack that receives all pointer
      // input; the actual pixels live on the stacked layer canvases below it.
      this.inputEl = inputEl;
      inputEl.width = LOGICAL_SIZE;
      inputEl.height = LOGICAL_SIZE;

      // Back → middle → foreground. Each layer owns a canvas + its own stroke
      // history. Kept transparent — the white "paper" comes from .canvas-wrap.
      this.layers = layerEls.map((el) => {
        el.width = LOGICAL_SIZE;
        el.height = LOGICAL_SIZE;
        return { canvas: el, ctx: el.getContext('2d'), history: [] };
      });
      this.activeIndex = 1; // default to the middle layer

      // Tool state (shared across layers — brush/colour/size are not per-layer).
      this.brushId = 'pen';
      this.color = '#7c5cff';
      this.size = 14;
      this.isEraser = false;
      this.bgColor = '#ffffff';

      this.currentStroke = null;
      this.activePointerId = null;
      this._suspended = false;  // true during a multi-touch gesture (pinch-zoom)
      this._traceBlock = false; // true while adjusting a trace reference image
      this._penOnly = false;    // true = only a stylus draws; finger is ignored

      this._useActiveLayer();
      this._bindEvents();
      this.redrawAll();
    }

    setBrush(id) { this.brushId = id; this.isEraser = false; }
    setColor(hex) { this.color = hex; }
    setSize(px) { this.size = px; }
    setEraser(on) { this.isEraser = on; }

    // ---- layers ---------------------------------------------------

    layerCount() { return this.layers.length; }
    getActiveLayer() { return this.activeIndex; }
    getLayerCanvas(i) { return this.layers[i].canvas; }
    layerHasContent(i) { return this.layers[i].history.length > 0; }
    // Live references to each layer's stroke history (used by pages/autosave).
    getLayers() { return this.layers.map((l) => l.history); }

    // Point this.canvas / this.ctx / this.history at the active layer, so the
    // drawing + undo code doesn't need to know layers exist.
    _useActiveLayer() {
      const l = this.layers[this.activeIndex];
      this.canvas = l.canvas;
      this.ctx = l.ctx;
      this.history = l.history;
    }

    // Switch which layer new strokes land on. Instant — the layers are already
    // painted, so there's nothing to redraw.
    setActiveLayer(i) {
      if (i < 0 || i >= this.layers.length || i === this.activeIndex) return;
      this.cancelActiveStroke();
      this.activeIndex = i;
      this._useActiveLayer();
      if (typeof this.onLayerChange === 'function') this.onLayerChange();
    }

    // Toggles the "loading" dim on the layer stack (used by pages.js during a
    // page switch, so the current page dims while the next renders off-screen).
    setLoadingDim(on) {
      const stack = this.layers[0].canvas.parentElement;
      if (stack) stack.classList.toggle('page-loading', on);
    }

    // Discards the in-progress stroke (if any) and repaints the active layer
    // from history only, wiping any pixels the aborted stroke had painted live.
    cancelActiveStroke() {
      this._lastRaw = null;
      if (this.currentStroke) {
        this.currentStroke = null;
        this.activePointerId = null;
        this._redrawLayer(this.activeIndex);
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

    // Undo the last stroke on the layer you're working on.
    undo() {
      this.layers[this.activeIndex].history.pop();
      this._redrawLayer(this.activeIndex);
    }

    // Clear the whole page (every layer).
    clear() {
      this.layers.forEach((l) => { l.history = []; });
      this._useActiveLayer();
      this.redrawAll();
      if (typeof this.onLayerChange === 'function') this.onLayerChange();
    }

    // Clear a single layer, leaving the others (and the active layer) untouched.
    clearLayer(i) {
      if (i < 0 || i >= this.layers.length) return;
      this.layers[i].history = [];
      this._redrawLayer(i);
      this._useActiveLayer(); // resync in case the active layer's array was cleared
      if (typeof this.onLayerChange === 'function') this.onLayerChange();
    }

    // Replace all layers' histories and show the given page. Used on restore
    // and when a page is loaded without the progressive/dim transition.
    loadLayers(layerHistories, activeIndex) {
      this._cancelProgressiveLoad();
      this.currentStroke = null;
      this.activePointerId = null;
      for (let i = 0; i < this.layers.length; i++) {
        this.layers[i].history = layerHistories[i] || [];
      }
      this.activeIndex = this._clampLayer(activeIndex);
      this._useActiveLayer();
      this.redrawAll();
      if (typeof this.onLayerChange === 'function') this.onLayerChange();
    }

    // Like loadLayers, but the strokes replay into off-screen buffers (one per
    // layer), in time-budgeted chunks across animation frames, so the main
    // thread never locks up AND the user never watches the redraw: the visible
    // layers keep showing the current page until every layer is fully drawn,
    // then they swap in together. onProgress(fraction 0..1) fires after each
    // chunk; onDone() once the finished page is on screen. A second call
    // cancels any replay still in flight. Drawing is blocked while a load runs.
    loadLayersProgressive(layerHistories, activeIndex, onProgress, onDone) {
      this._cancelProgressiveLoad();
      this.currentStroke = null;
      this.activePointerId = null;

      const S = LOGICAL_SIZE;
      if (!this._buffers) this._buffers = this.layers.map(() => document.createElement('canvas'));
      const bufCtxs = this._buffers.map((b) => {
        if (b.width !== S) { b.width = S; b.height = S; }
        const c = b.getContext('2d');
        c.clearRect(0, 0, S, S);
        return c;
      });

      // Flat work list across all target layers (order within a layer matters).
      const work = [];
      for (let li = 0; li < layerHistories.length; li++) {
        const hs = layerHistories[li] || [];
        for (let si = 0; si < hs.length; si++) work.push([li, hs[si]]);
      }
      const total = work.length;

      const finish = () => {
        for (let li = 0; li < this.layers.length; li++) {
          this.layers[li].history = layerHistories[li] || [];
          const ctx = this.layers[li].ctx;
          ctx.clearRect(0, 0, S, S);
          ctx.drawImage(this._buffers[li], 0, 0);
        }
        this.activeIndex = this._clampLayer(activeIndex);
        this._useActiveLayer();
        this._loadRAF = null;
        if (typeof this.onLayerChange === 'function') this.onLayerChange();
        if (onDone) onDone();
      };

      if (total === 0) {
        if (onProgress) onProgress(1);
        finish();
        return;
      }

      let i = 0;
      const step = () => {
        const start = performance.now();
        while (i < total && performance.now() - start < LOAD_FRAME_BUDGET_MS) {
          this._paintStrokeTo(bufCtxs[work[i][0]], work[i][1]);
          i++;
        }
        if (onProgress) onProgress(i / total);
        if (i < total) this._loadRAF = requestAnimationFrame(step);
        else finish();
      };
      this._loadRAF = requestAnimationFrame(step);
    }

    _cancelProgressiveLoad() {
      if (this._loadRAF) {
        cancelAnimationFrame(this._loadRAF);
        this._loadRAF = null;
      }
    }

    // True while a page is still replaying into the off-screen buffers.
    isLoadingPage() {
      return !!this._loadRAF;
    }

    _clampLayer(i) {
      return Math.min(Math.max(0, i | 0), this.layers.length - 1);
    }

    // ---- export ---------------------------------------------------

    // Flatten the three layers onto the background colour into a temp canvas.
    _flatten() {
      const c = document.createElement('canvas');
      c.width = LOGICAL_SIZE;
      c.height = LOGICAL_SIZE;
      const x = c.getContext('2d');
      x.fillStyle = this.bgColor;
      x.fillRect(0, 0, LOGICAL_SIZE, LOGICAL_SIZE);
      for (const l of this.layers) x.drawImage(l.canvas, 0, 0);
      return c;
    }

    toDataURL() {
      return this._flatten().toDataURL('image/png');
    }

    toBlob(cb, type) {
      this._flatten().toBlob(cb, type || 'image/png');
    }

    hasDrawing() {
      return this.layers.some((l) => l.history.length > 0);
    }

    // ---- internal -------------------------------------------------

    _bindEvents() {
      const el = this.inputEl;
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
      const rect = this.inputEl.getBoundingClientRect();
      const scaleX = LOGICAL_SIZE / rect.width;
      const scaleY = LOGICAL_SIZE / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
        pressure: e.pressure > 0 ? e.pressure : 0.5,
      };
    }

    _onPointerDown(e) {
      if (this._suspended || this._traceBlock) return;
      // Ignore input while a page is still loading into the off-screen buffers,
      // so a stroke can't land on the half-built page (or the page we're about
      // to swap in over the top of it).
      if (this._loadRAF) { if (e.cancelable) e.preventDefault(); return; }
      // In pen-only mode swallow the finger entirely (preventDefault) rather
      // than just skipping it, so it can't feed a browser swipe/exit gesture.
      if (this._penOnly && e.pointerType === 'touch') { if (e.cancelable) e.preventDefault(); return; }
      e.preventDefault();

      // A second pointer landing while one is already active means this is a
      // multi-touch gesture (pinch-to-zoom), not a drawing stroke — bail out
      // and wait for zoom.js to lift the suspension once all touches end.
      if (this.activePointerId !== null) {
        this.cancelActiveStroke();
        this._suspended = true;
        return;
      }

      try { this.inputEl.setPointerCapture(e.pointerId); } catch (_) { /* no-op */ }
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

      this.layers[this.activeIndex].history.push(this.currentStroke);
      this.currentStroke = null;
      this.activePointerId = null;
      try { this.inputEl.releasePointerCapture(e.pointerId); } catch (_) { /* no-op */ }
      if (typeof this.onStrokeEnd === 'function') this.onStrokeEnd();
    }

    // Paints one segment straight to the current target context (this.ctx —
    // the active layer while drawing, or a buffer/layer ctx during a replay).
    _paintSegment(stroke, p0, p1) {
      if (stroke.tool === 'eraser') {
        // Erase to transparent so the layers below (and the white paper) show
        // through, rather than painting an opaque background colour.
        this.ctx.save();
        this.ctx.globalCompositeOperation = 'destination-out';
        this.ctx.strokeStyle = 'rgba(0,0,0,1)';
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

    // Replay a whole stroke into an arbitrary context (temporarily retargets
    // this.ctx, which _paintSegment paints to).
    _paintStrokeTo(ctx, stroke) {
      const saved = this.ctx;
      this.ctx = ctx;
      stroke._state = {}; // fresh scratch so tapers/dedupe replay identically
      const pts = stroke.points;
      if (pts.length === 1) {
        this._paintSegment(stroke, pts[0], pts[0]);
      } else {
        for (let j = 1; j < pts.length; j++) {
          this._paintSegment(stroke, pts[j - 1], pts[j]);
        }
      }
      this.ctx = saved;
    }

    // Repaint one layer from its own history (transparent — no background fill).
    _redrawLayer(i) {
      const l = this.layers[i];
      l.ctx.clearRect(0, 0, LOGICAL_SIZE, LOGICAL_SIZE);
      for (const stroke of l.history) this._paintStrokeTo(l.ctx, stroke);
    }

    redrawAll() {
      this._cancelProgressiveLoad(); // a full redraw supersedes any in-flight replay
      for (let i = 0; i < this.layers.length; i++) this._redrawLayer(i);
    }
  }

  global.DrawingCanvas = DrawingCanvas;
})(window);
