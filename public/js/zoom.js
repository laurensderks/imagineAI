/**
 * zoom.js
 *
 * Lets the user zoom the drawing canvas in/out via the +/- buttons, the
 * mouse wheel / trackpad pinch, or a two-finger pinch gesture on touch
 * devices — and pan around it with a two-finger drag once zoomed in.
 *
 * All zooming is ANCHORED: the canvas point under the cursor (wheel) or
 * under the finger midpoint (pinch) stays fixed on screen while the canvas
 * scales around it, which is what makes the gesture feel native. Panning is
 * just scrolling the .stage viewport.
 *
 * Zooming resizes the canvas-wrap element in CSS pixels inside that
 * scrollable viewport — the canvas's own backing-store resolution never
 * changes, so drawing accuracy (canvas.js's _getPoint derives its scale from
 * getBoundingClientRect at draw time) is unaffected by zoom level.
 */

(function (global) {
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 4;
  const STEP = 0.1;
  const WHEEL_SENSITIVITY = 0.0015;

  class ZoomController {
    constructor({ viewport, canvasWrap, drawing, levelLabel, zoomInBtn, zoomOutBtn }) {
      this.viewport = viewport;
      this.canvasWrap = canvasWrap;
      this.drawing = drawing;
      this.levelLabel = levelLabel;
      this.zoomInBtn = zoomInBtn;
      this.zoomOutBtn = zoomOutBtn;

      this.zoom = 1;
      this.baseSize = 700;
      this._pinch = null; // { startDist, startZoom, lastMidpoint }

      this._recomputeBaseSize();
      this._applySize();
      this._recenter();
      this._bindEvents();
    }

    // The "100%" size: as much of the viewport as is available, capped at
    // 1000px so it doesn't get absurdly large on huge monitors.
    _recomputeBaseSize() {
      const styles = getComputedStyle(this.viewport);
      const padX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
      const padY = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
      const availW = this.viewport.clientWidth - padX;
      const availH = this.viewport.clientHeight - padY;
      this.baseSize = Math.max(120, Math.min(1000, availW, availH));
    }

    _applySize() {
      const size = Math.round(this.baseSize * this.zoom);
      this.canvasWrap.style.width = `${size}px`;
      this.canvasWrap.style.height = `${size}px`;

      if (this.levelLabel) this.levelLabel.textContent = `${Math.round(this.zoom * 100)}%`;
      if (this.zoomInBtn) this.zoomInBtn.disabled = this.zoom >= MAX_ZOOM - 1e-6;
      if (this.zoomOutBtn) this.zoomOutBtn.disabled = this.zoom <= MIN_ZOOM + 1e-6;
    }

    _recenter() {
      requestAnimationFrame(() => {
        this.viewport.scrollLeft = (this.viewport.scrollWidth - this.viewport.clientWidth) / 2;
        this.viewport.scrollTop = (this.viewport.scrollHeight - this.viewport.clientHeight) / 2;
      });
    }

    // Anchored zoom: scale the canvas while keeping the canvas point that sits
    // under (clientX, clientY) fixed on screen. Layout is synchronous after a
    // style write, so reading the wrap's rect before/after gives exact deltas.
    zoomAt(next, clientX, clientY) {
      const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
      if (clamped === this.zoom) return;

      const before = this.canvasWrap.getBoundingClientRect();
      const fx = (clientX - before.left) / before.width;
      const fy = (clientY - before.top) / before.height;

      this.zoom = clamped;
      this._applySize();

      const after = this.canvasWrap.getBoundingClientRect();
      this.viewport.scrollLeft += (after.left + fx * after.width) - clientX;
      this.viewport.scrollTop += (after.top + fy * after.height) - clientY;
    }

    // Buttons anchor at the viewport centre — zooming "into the middle".
    _zoomStep(delta) {
      const r = this.viewport.getBoundingClientRect();
      this.zoomAt(this.zoom + delta, r.left + r.width / 2, r.top + r.height / 2);
    }

    _bindEvents() {
      if (this.zoomInBtn) this.zoomInBtn.addEventListener('click', () => this._zoomStep(STEP));
      if (this.zoomOutBtn) this.zoomOutBtn.addEventListener('click', () => this._zoomStep(-STEP));

      window.addEventListener('resize', () => {
        this._recomputeBaseSize();
        this._applySize();
        this._recenter();
      });

      // Wheel zoom anchored at the cursor. Trackpad pinches arrive as wheel
      // events with ctrlKey set and small deltas — boost those so a physical
      // pinch feels 1:1 rather than sluggish.
      this.viewport.addEventListener('wheel', (e) => {
        e.preventDefault();
        const boost = e.ctrlKey ? 3 : 1;
        const factor = Math.exp(-e.deltaY * WHEEL_SENSITIVITY * boost);
        this.zoomAt(this.zoom * factor, e.clientX, e.clientY);
      }, { passive: false });

      // Two-finger pinch-zoom + pan (e.g. iPad).
      this.canvasWrap.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
      this.canvasWrap.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
      this.canvasWrap.addEventListener('touchend', (e) => this._onTouchEnd(e), { passive: false });
      this.canvasWrap.addEventListener('touchcancel', (e) => this._onTouchEnd(e), { passive: false });
    }

    _touchDistance(touches) {
      const [a, b] = touches;
      return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
    }

    _touchMidpoint(touches) {
      const [a, b] = touches;
      return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
    }

    _onTouchStart(e) {
      if (e.touches.length === 2) {
        e.preventDefault();
        this.drawing.setSuspended(true);
        this._pinch = {
          startDist: this._touchDistance(e.touches),
          startZoom: this.zoom,
          lastMidpoint: this._touchMidpoint(e.touches),
        };
      }
    }

    _onTouchMove(e) {
      if (e.touches.length === 2 && this._pinch) {
        e.preventDefault();
        const mid = this._touchMidpoint(e.touches);

        // Finger spread controls zoom, anchored at the finger midpoint so the
        // spot being pinched stays pinned under the fingers...
        const ratio = this._touchDistance(e.touches) / this._pinch.startDist;
        this.zoomAt(this._pinch.startZoom * ratio, mid.x, mid.y);

        // ...and the midpoint's frame-to-frame movement pans the view, so the
        // same two-finger gesture drags the canvas around while zoomed.
        this.viewport.scrollLeft -= mid.x - this._pinch.lastMidpoint.x;
        this.viewport.scrollTop -= mid.y - this._pinch.lastMidpoint.y;
        this._pinch.lastMidpoint = mid;
      }
    }

    _onTouchEnd(e) {
      if (e.touches.length < 2) {
        this._pinch = null;
        if (e.touches.length === 0) this.drawing.setSuspended(false);
      }
    }
  }

  global.ZoomController = ZoomController;
})(window);
