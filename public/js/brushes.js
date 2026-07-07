/**
 * brushes.js
 *
 * Five hand-tuned brushes. Each exposes a `stroke(ctx, p0, p1, opts)` function
 * that paints ONE segment of a stroke (from point p0 to point p1). canvas.js
 * calls this once per pointermove for live drawing, and again for every stored
 * segment when replaying a stroke (undo/page switch/redraw).
 *
 * `opts` = {
 *   size: number,            // brush size in canvas px
 *   color: "#rrggbb",
 *   pressure: 0..1,          // stylus pressure (0.5 for mouse/touch)
 *   state: {}                // per-stroke scratch object, reset on replay —
 * }                          //   used for width smoothing so tapers stay organic
 *
 * The brushes lean on two tricks for a natural, "expensive" feel:
 *  - width smoothing: target width follows pressure AND stroke speed, but is
 *    eased toward across segments, so lines swell and taper like real media;
 *  - gaussian scatter (spray/soft): particles cluster densely at the centre
 *    and thin out at the edge, the way real spray and airbrush deposit paint.
 */

(function (global) {
  function dist(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  function rgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // Standard normal via Box-Muller — used for organic particle scatter.
  function gauss() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  // Eases the working width toward `target` across segments (per-stroke state),
  // so width changes read as smooth swells/tapers rather than steps.
  function smoothWidth(state, key, target, ease) {
    const prev = state[key] === undefined ? target : state[key];
    const w = prev + (target - prev) * ease;
    state[key] = w;
    return Math.max(0.4, w);
  }

  // Fast segments thin the line slightly, like real ink under a quick hand.
  function speedThin(p0, p1, size, amount) {
    const t = Math.min(1, dist(p0, p1) / (size * 3));
    return 1 - amount * t;
  }

  function strokeSegment(ctx, p0, p1, w, style, alpha) {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = style;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (p0.x === p1.x && p0.y === p1.y) {
      // Zero-length segments (a tap) don't render as lines — draw a dot.
      ctx.fillStyle = style;
      ctx.beginPath();
      ctx.arc(p0.x, p0.y, w / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }

  const BRUSHES = {
    // Smooth pen — velvety, weight-shifting line. Width breathes gently with
    // pressure and hand speed, eased across segments for a lacquered finish.
    pen: {
      label: 'Velvet Pen',
      icon: '<svg viewBox="0 0 32 32"><path fill="currentColor" stroke="none" d="M4 28 C11 23 13 15 19 10 C22.2 7.2 26 5 29 4 C24.5 7.5 21.5 11 19 15 C16 20 12 26 4 28 Z"/></svg>',
      stroke(ctx, p0, p1, o) {
        const target = o.size * (0.6 + 0.4 * o.pressure) * speedThin(p0, p1, o.size, 0.3);
        const w = smoothWidth(o.state, 'penW', target, 0.3);
        ctx.save();
        strokeSegment(ctx, p0, p1, w, o.color, 1);
        ctx.restore();
      },
    },

    // Ink — expressive nib. Strong pressure/speed response with a faint wet
    // halo under a crisp core, like dense ink settling into paper.
    ink: {
      label: 'Wet Ink',
      icon: '<svg viewBox="0 0 32 32"><path fill="currentColor" stroke="none" d="M3.5 25 C9 25.5 14.5 23.5 18.5 19.5 C22.5 15.5 25.5 10.5 28.5 4.5 C28 12 25 18.5 20 22.8 C15.3 26.8 8.7 27.6 3.5 25 Z"/><circle fill="currentColor" stroke="none" cx="25.5" cy="24.5" r="2"/><circle fill="currentColor" stroke="none" cx="29" cy="20.5" r="1.2"/></svg>',
      stroke(ctx, p0, p1, o) {
        const target = o.size * (0.35 + 0.8 * o.pressure) * speedThin(p0, p1, o.size, 0.45);
        const w = smoothWidth(o.state, 'inkW', target, 0.35);
        ctx.save();
        strokeSegment(ctx, p0, p1, w * 1.7, o.color, 0.14); // soft bleed halo
        strokeSegment(ctx, p0, p1, w, o.color, 1);          // dense core
        ctx.restore();
      },
    },

    // Soft brush — airbrush with a gaussian-falloff veil; colour builds up in
    // sheer layers, so slow passes deepen and fast passes stay whisper-light.
    soft: {
      label: 'Cloud',
      icon: '<svg viewBox="0 0 32 32"><circle fill="currentColor" stroke="none" cx="16" cy="16" r="12.5" opacity="0.16"/><circle fill="currentColor" stroke="none" cx="16" cy="16" r="9" opacity="0.32"/><circle fill="currentColor" stroke="none" cx="16" cy="16" r="5.5" opacity="0.9"/></svg>',
      stroke(ctx, p0, p1, o) {
        const r = o.size * (0.85 + 0.35 * o.pressure);
        const step = Math.max(1, r * 0.18);
        const steps = Math.max(1, Math.ceil(dist(p0, p1) / step));
        const a = 0.05 + 0.07 * o.pressure;
        ctx.save();
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const x = p0.x + (p1.x - p0.x) * t;
          const y = p0.y + (p1.y - p0.y) * t;
          const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
          grad.addColorStop(0, rgba(o.color, a));
          grad.addColorStop(0.55, rgba(o.color, a * 0.5));
          grad.addColorStop(1, rgba(o.color, 0));
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      },
    },

    // Spray paint — gaussian mist: particles crowd the centre and feather out,
    // with fine grain sizes, like a well-shaken can at arm's length.
    spray: {
      label: 'Mist',
      icon: '<svg viewBox="0 0 32 32"><g fill="currentColor" stroke="none"><circle cx="6" cy="26" r="1.9" opacity="0.95"/><circle cx="10" cy="22" r="1.7" opacity="0.9"/><circle cx="14" cy="18" r="1.6" opacity="0.9"/><circle cx="18" cy="14" r="1.5" opacity="0.9"/><circle cx="22" cy="10" r="1.4" opacity="0.9"/><circle cx="26" cy="6" r="1.3" opacity="0.9"/><circle cx="10" cy="27" r="1" opacity="0.4"/><circle cx="6" cy="20.5" r="1" opacity="0.45"/><circle cx="15" cy="23" r="1.1" opacity="0.4"/><circle cx="11" cy="16" r="1" opacity="0.4"/><circle cx="19" cy="19" r="1.1" opacity="0.4"/><circle cx="16" cy="10" r="1" opacity="0.4"/><circle cx="23" cy="15" r="1" opacity="0.4"/><circle cx="27" cy="11" r="0.9" opacity="0.4"/><circle cx="21" cy="5" r="0.9" opacity="0.35"/><circle cx="25" cy="2.8" r="0.8" opacity="0.35"/></g></svg>',
      stroke(ctx, p0, p1, o) {
        const radius = o.size * 1.35;
        const step = Math.max(1, radius * 0.25);
        const steps = Math.max(1, Math.ceil(dist(p0, p1) / step));
        const perStep = Math.round(radius * (0.6 + 0.8 * o.pressure));
        ctx.save();
        ctx.fillStyle = o.color;
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const cx = p0.x + (p1.x - p0.x) * t;
          const cy = p0.y + (p1.y - p0.y) * t;
          for (let i = 0; i < perStep; i++) {
            const rr = Math.min(radius, Math.abs(gauss()) * radius * 0.45);
            const ang = Math.random() * Math.PI * 2;
            const grain = 0.3 + Math.random() * Math.random() * 1.1;
            ctx.globalAlpha = 0.16 + Math.random() * 0.3;
            ctx.beginPath();
            ctx.arc(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr, grain, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      },
    },

    // Pixel — precise, gap-free grid strokes. Cells are deduped per stroke so
    // lines stay crisp and even at any drawing speed.
    pixel: {
      label: '8-Bit',
      icon: '<svg viewBox="0 0 32 32"><g fill="currentColor" stroke="none"><rect x="3" y="23" width="6" height="6" rx="1"/><rect x="9" y="17" width="6" height="6" rx="1"/><rect x="15" y="11" width="6" height="6" rx="1"/><rect x="21" y="5" width="6" height="6" rx="1"/><rect x="9" y="23" width="6" height="6" rx="1" opacity="0.35"/><rect x="15" y="17" width="6" height="6" rx="1" opacity="0.35"/><rect x="21" y="11" width="6" height="6" rx="1" opacity="0.35"/></g></svg>',
      stroke(ctx, p0, p1, o) {
        const grid = Math.max(3, Math.round(o.size / 2));
        const cells = (o.state.pixelCells = o.state.pixelCells || {});
        const steps = Math.max(1, Math.ceil(dist(p0, p1) / (grid * 0.35)));
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = o.color;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const x = p0.x + (p1.x - p0.x) * t;
          const y = p0.y + (p1.y - p0.y) * t;
          const gx = Math.floor(x / grid) * grid;
          const gy = Math.floor(y / grid) * grid;
          const key = gx + ',' + gy;
          if (cells[key]) continue;
          cells[key] = true;
          ctx.fillRect(gx, gy, grid, grid);
        }
        ctx.restore();
      },
    },
  };

  // Ordered list drives the UI grid in app.js.
  const BRUSH_ORDER = ['pen', 'ink', 'soft', 'spray', 'pixel'];

  global.BRUSHES = BRUSHES;
  global.BRUSH_ORDER = BRUSH_ORDER;
})(window);
