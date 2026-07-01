/**
 * zoom.js
 *
 * Lets the user zoom the drawing canvas in/out via the +/- buttons, the
 * mouse wheel, or a two-finger pinch gesture on touch devices — and pan
 * around it once zoomed in by dragging with two fingers.
 *
 * Zooming resizes the canvas-wrap element in CSS pixels inside a scrollable
 * viewport (.stage) — the canvas's own backing-store resolution never
 * changes, so drawing accuracy (canvas.js's _getPoint derives its scale from
 * getBoundingClientRect at draw time) is unaffected by zoom level. Panning is
 * just scrolling that same viewport.
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

    // `recenter` re-centres the canvas in the viewport after resizing — the
    // right thing for button/wheel zoom, but pinch-zoom manages scroll
    // position itself (see _onTouchMove) so the user's two-finger pan isn't
    // fought/overridden every frame.
    _applySize(recenter = true) {
      const size = Math.round(this.baseSize * this.zoom);
      this.canvasWrap.style.width = `${size}px`;
      this.canvasWrap.style.height = `${size}px`;

      if (this.levelLabel) this.levelLabel.textContent = `${Math.round(this.zoom * 100)}%`;
      if (this.zoomInBtn) this.zoomInBtn.disabled = this.zoom >= MAX_ZOOM - 1e-6;
      if (this.zoomOutBtn) this.zoomOutBtn.disabled = this.zoom <= MIN_ZOOM + 1e-6;

      if (recenter) {
        requestAnimationFrame(() => {
          this.viewport.scrollLeft = (this.viewport.scrollWidth - this.viewport.clientWidth) / 2;
          this.viewport.scrollTop = (this.viewport.scrollHeight - this.viewport.clientHeight) / 2;
        });
      }
    }

    setZoom(next, { recenter = true } = {}) {
      const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
      if (clamped === this.zoom) return;
      this.zoom = clamped;
      this._applySize(recenter);
    }

    zoomIn() { this.setZoom(this.zoom + STEP); }
    zoomOut() { this.setZoom(this.zoom - STEP); }

    _bindEvents() {
      if (this.zoomInBtn) this.zoomInBtn.addEventListener('click', () => this.zoomIn());
      if (this.zoomOutBtn) this.zoomOutBtn.addEventListener('click', () => this.zoomOut());

      window.addEventListener('resize', () => {
        this._recomputeBaseSize();
        this._applySize();
      });

      this.viewport.addEventListener('wheel', (e) => {
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * WHEEL_SENSITIVITY);
        this.setZoom(this.zoom * factor);
      }, { passive: false });

      // Pinch-to-zoom (two-finger touch, e.g. iPad).
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

        // Pinch distance controls zoom...
        const ratio = this._touchDistance(e.touches) / this._pinch.startDist;
        this.setZoom(this._pinch.startZoom * ratio, { recenter: false });

        // ...while the midpoint's frame-to-frame movement pans the view, so
        // a two-finger drag ("push/pull") moves around a zoomed-in canvas.
        const mid = this._touchMidpoint(e.touches);
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
