/**
 * trace.js
 *
 * Lets the user load a reference photo, position/scale/rotate/fade it over the
 * canvas, lock it in place, then trace over it with the normal brushes — and
 * remove it when done. The reference is a separate DOM <img> overlaid inside
 * .canvas-wrap, never painted onto the canvas, so it's excluded from exports
 * and (by app.js) blocks the Render button until removed.
 *
 * Geometry is stored canvas-relative (centre as a 0..1 fraction, width as a %
 * of the canvas, plus scale/rotation) so it tracks zoom and survives save.
 *
 *   Adjust mode  — image is draggable (one finger / mouse); size, rotation,
 *                  opacity sliders active; drawing is blocked (the image
 *                  captures pointer input).
 *   Locked mode  — image ignores pointer input, so brushes draw straight
 *                  through it; only opacity stays adjustable.
 */

(function (global) {
  const MAX_DIM = 1400; // downscale cap so the reference fits in localStorage
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  class TraceController {
    constructor({ canvasWrap, imgEl, panel, fileInput, openBtn, drawing, onChange }) {
      this.canvasWrap = canvasWrap;
      this.img = imgEl;
      this.panel = panel;
      this.fileInput = fileInput;
      this.openBtn = openBtn || null;
      this.drawing = drawing;
      this.onChange = onChange || (() => {});

      this.opacityInput = panel.querySelector('[data-trace="opacity"]');
      this.sizeInput = panel.querySelector('[data-trace="size"]');
      this.rotInput = panel.querySelector('[data-trace="rotation"]');
      this.lockBtn = panel.querySelector('[data-trace="lock"]');
      this.finishBtn = panel.querySelector('[data-trace="finish"]');
      this.removeBtn = panel.querySelector('[data-trace="remove"]');
      this.adjustRows = [...panel.querySelectorAll('[data-trace-adjust]')];

      this.state = null;   // null when no image loaded
      this._drag = null;

      this._bind();
      this._syncPanel();
    }

    // ---- public API -----------------------------------------------------

    openPicker() { this.fileInput.click(); }
    hasImage() { return !!this.state; }

    getState() {
      return this.state ? { ...this.state } : null;
    }

    restore(saved) {
      if (!saved || typeof saved.src !== 'string') return;
      this.state = {
        src: saved.src,
        baseW: Number(saved.baseW) || 70,
        cx: clamp(Number(saved.cx) || 0.5, -0.3, 1.3),
        cy: clamp(Number(saved.cy) || 0.5, -0.3, 1.3),
        scale: clamp(Number(saved.scale) || 1, 0.2, 3),
        rotation: clamp(Number(saved.rotation) || 0, -180, 180),
        opacity: clamp(saved.opacity != null ? Number(saved.opacity) : 0.5, 0, 1),
        locked: !!saved.locked,
      };
      this.img.src = this.state.src;
      this._apply();
      this._syncPanel();
    }

    // Clear the on-screen trace WITHOUT the "user finished" meaning — used when
    // switching pages, so it fires no onChange and deletes nothing from storage.
    clear() {
      this.state = null;
      this.img.hidden = true;
      this.img.removeAttribute('src');
      this._syncPanel();
    }

    // User is done with this trace (Finish / ✕): clear it and signal onChange so
    // the app can drop it from the page and from cloud storage.
    remove() {
      this.clear();
      this.onChange();
    }

    // ---- internals ------------------------------------------------------

    _bind() {
      this.fileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) this._loadFile(file);
        this.fileInput.value = ''; // allow re-picking the same file
      });

      this.opacityInput.addEventListener('input', () => {
        if (!this.state) return;
        this.state.opacity = Number(this.opacityInput.value) / 100;
        this._apply();
        this.onChange();
      });
      this.sizeInput.addEventListener('input', () => {
        if (!this.state) return;
        this.state.scale = Number(this.sizeInput.value) / 100;
        this._apply();
        this.onChange();
      });
      this.rotInput.addEventListener('input', () => {
        if (!this.state) return;
        this.state.rotation = Number(this.rotInput.value);
        this._apply();
        this.onChange();
      });
      this.lockBtn.addEventListener('click', () => {
        if (!this.state) return;
        this.state.locked = !this.state.locked;
        this._apply();
        this._syncPanel();
        this.onChange();
      });
      this.removeBtn.addEventListener('click', () => this.remove());
      // "Finish" = done tracing: drop the reference photo (the drawing stays).
      // Gives a clear exit from trace mode instead of only the header ✕.
      if (this.finishBtn) this.finishBtn.addEventListener('click', () => this.remove());

      // Drag to move — only while unlocked. Single pointer; two-finger pinch
      // still bubbles to the canvas-wrap zoom handler untouched.
      this.img.addEventListener('pointerdown', (e) => {
        if (!this.state || this.state.locked) return;
        e.preventDefault();
        try { this.img.setPointerCapture(e.pointerId); } catch (_) { /* no-op */ }
        this._drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      });
      this.img.addEventListener('pointermove', (e) => {
        if (!this._drag || e.pointerId !== this._drag.id) return;
        const rect = this.canvasWrap.getBoundingClientRect();
        this.state.cx = clamp(this.state.cx + (e.clientX - this._drag.x) / rect.width, -0.3, 1.3);
        this.state.cy = clamp(this.state.cy + (e.clientY - this._drag.y) / rect.height, -0.3, 1.3);
        this._drag.x = e.clientX;
        this._drag.y = e.clientY;
        this._apply();
      });
      const endDrag = (e) => {
        if (this._drag && e.pointerId === this._drag.id) {
          this._drag = null;
          this.onChange();
        }
      };
      this.img.addEventListener('pointerup', endDrag);
      this.img.addEventListener('pointercancel', endDrag);
    }

    _loadFile(file) {
      const reader = new FileReader();
      reader.onload = () => this._prepare(String(reader.result));
      reader.readAsDataURL(file);
    }

    // Downscale to MAX_DIM and re-encode as JPEG so the dataURL stays small
    // enough to persist in localStorage alongside the drawing session.
    _prepare(dataURL) {
      const im = new Image();
      im.onload = () => {
        let w = im.naturalWidth, h = im.naturalHeight;
        const ar = w / h;
        if (Math.max(w, h) > MAX_DIM) {
          if (w >= h) { w = MAX_DIM; h = Math.round(MAX_DIM / ar); }
          else { h = MAX_DIM; w = Math.round(MAX_DIM * ar); }
        }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(im, 0, 0, w, h);
        let out;
        try { out = c.toDataURL('image/jpeg', 0.85); } catch (_) { out = dataURL; }

        this.state = {
          src: out,
          baseW: 80 * Math.min(1, ar), // width as % of canvas so it fits contained
          cx: 0.5, cy: 0.5,
          scale: 1, rotation: 0, opacity: 0.5,
          locked: false,
        };
        this.img.src = out;
        this._apply();
        this._syncPanel();
        this.onChange();
      };
      im.onerror = () => { /* not a usable image — ignore */ };
      im.src = dataURL;
    }

    _apply() {
      const s = this.state;
      if (!s) return;
      this.img.hidden = false;
      this.img.style.left = `${s.cx * 100}%`;
      this.img.style.top = `${s.cy * 100}%`;
      this.img.style.width = `${s.baseW}%`;
      this.img.style.transform =
        `translate(-50%, -50%) rotate(${s.rotation}deg) scale(${s.scale})`;
      this.img.style.opacity = String(s.opacity);
      this.img.style.pointerEvents = s.locked ? 'none' : 'auto';
      this.img.style.cursor = s.locked ? 'default' : 'move';
      this.img.classList.toggle('locked', s.locked);
    }

    // Reflect state into the panel (visibility + control values + button text).
    _syncPanel() {
      const on = !!this.state;
      this.panel.hidden = !on;
      // The "Trace a photo" button is redundant while an image is loaded —
      // hide it so the controls sit higher and save space.
      if (this.openBtn) this.openBtn.hidden = on;
      // Block canvas drawing while adjusting (unlocked); allow it when locked
      // or when there's no image. Called only when this state changes.
      this.drawing.setTraceBlock(on && !this.state.locked);
      if (!on) return;
      this.opacityInput.value = Math.round(this.state.opacity * 100);
      this.sizeInput.value = Math.round(this.state.scale * 100);
      this.rotInput.value = Math.round(this.state.rotation);
      const locked = this.state.locked;
      this.adjustRows.forEach((r) => { r.hidden = locked; });
      // While tracing, split into "Adjust" (back to positioning) and "Finish"
      // (leave trace mode). While adjusting, one full-width "Lock & trace".
      this.lockBtn.textContent = locked ? 'Adjust' : 'Lock & trace';
      this.lockBtn.classList.toggle('locked', locked);
      if (this.finishBtn) this.finishBtn.hidden = !locked;
    }
  }

  global.TraceController = TraceController;
})(window);
