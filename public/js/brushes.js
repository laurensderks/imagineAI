/**
 * brushes.js
 *
 * Defines the 12 brush types. Each brush exposes a `stroke(ctx, p0, p1, opts)`
 * function that paints ONE segment of a stroke (from point p0 to point p1).
 * canvas.js calls this once per pointermove for live drawing, and again for
 * every stored segment when replaying a stroke (undo/resize/redraw).
 *
 * `opts` = { size: number, color: "#rrggbb", pressure: 0..1 }
 * `p0`/`p1` = { x, y } in canvas pixel space.
 *
 * Brushes that need "wet" per-stroke state (e.g. calligraphy angle smoothing)
 * may store scratch data on `opts.strokeState` (an object that lives for the
 * whole stroke and is provided by canvas.js).
 */

(function (global) {
  function dist(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  function withAlpha(hex, alpha) {
    // Accepts "#rrggbb" and returns an rgba() string.
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function basicLine(ctx, p0, p1, size, color, opacity, cap, blend) {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.globalCompositeOperation = blend || 'source-over';
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = cap || 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
    ctx.restore();
  }

  const BRUSHES = {
    // 1. Smooth pen — clean, consistent, fully opaque round stroke.
    pen: {
      label: 'Smooth Pen',
      glyph: '✒',
      stroke(ctx, p0, p1, o) {
        basicLine(ctx, p0, p1, o.size, o.color, 1, 'round');
      },
    },

    // 2. Marker — broad flat translucent stroke that darkens on overlap.
    marker: {
      label: 'Marker',
      glyph: '🖊',
      stroke(ctx, p0, p1, o) {
        basicLine(ctx, p0, p1, o.size * 1.6, o.color, 0.55, 'square', 'multiply');
      },
    },

    // 3. Pencil — thin, grainy line built from several jittered light passes.
    pencil: {
      label: 'Pencil',
      glyph: '✏',
      stroke(ctx, p0, p1, o) {
        const passes = 3;
        for (let i = 0; i < passes; i++) {
          const jitter = o.size * 0.12;
          const jp0 = { x: p0.x + (Math.random() - 0.5) * jitter, y: p0.y + (Math.random() - 0.5) * jitter };
          const jp1 = { x: p1.x + (Math.random() - 0.5) * jitter, y: p1.y + (Math.random() - 0.5) * jitter };
          basicLine(ctx, jp0, jp1, Math.max(1, o.size * 0.22), o.color, 0.35);
        }
      },
    },

    // 4. Ink — bold, high-contrast, pressure-tapered, tiny bleed.
    ink: {
      label: 'Ink',
      glyph: '🖋',
      stroke(ctx, p0, p1, o) {
        const w = o.size * (0.6 + 0.4 * o.pressure);
        ctx.save();
        ctx.shadowColor = o.color;
        ctx.shadowBlur = w * 0.15;
        basicLine(ctx, p0, p1, w, o.color, 1, 'round');
        ctx.restore();
      },
    },

    // 5. Soft brush — feathered airbrush-style dabs stamped along the path.
    soft: {
      label: 'Soft Brush',
      glyph: '☁',
      stroke(ctx, p0, p1, o) {
        const steps = Math.max(1, Math.ceil(dist(p0, p1) / (o.size * 0.2)));
        const r = o.size * 0.9;
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const x = p0.x + (p1.x - p0.x) * t;
          const y = p0.y + (p1.y - p0.y) * t;
          const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
          grad.addColorStop(0, withAlpha(o.color, 0.18));
          grad.addColorStop(1, withAlpha(o.color, 0));
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      },
    },

    // 6. Watercolour — irregular translucent pools that pool and bleed.
    watercolour: {
      label: 'Watercolour',
      glyph: '🎨',
      stroke(ctx, p0, p1, o) {
        const steps = Math.max(1, Math.ceil(dist(p0, p1) / (o.size * 0.3)));
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const x = p0.x + (p1.x - p0.x) * t + (Math.random() - 0.5) * o.size * 0.4;
          const y = p0.y + (p1.y - p0.y) * t + (Math.random() - 0.5) * o.size * 0.4;
          const r = o.size * (0.6 + Math.random() * 0.6);
          const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
          grad.addColorStop(0, withAlpha(o.color, 0.12));
          grad.addColorStop(0.7, withAlpha(o.color, 0.08));
          grad.addColorStop(1, withAlpha(o.color, 0));
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      },
    },

    // 7. Charcoal — dark grainy texture from many scattered short strokes.
    charcoal: {
      label: 'Charcoal',
      glyph: '⚫',
      stroke(ctx, p0, p1, o) {
        const segLen = Math.max(dist(p0, p1), 1);
        const grains = Math.max(4, Math.round(segLen * 0.6 + o.size * 0.5));
        const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        for (let i = 0; i < grains; i++) {
          const t = Math.random();
          const x = p0.x + (p1.x - p0.x) * t;
          const y = p0.y + (p1.y - p0.y) * t;
          const perp = (Math.random() - 0.5) * o.size * 0.8;
          const gx = x + Math.cos(angle + Math.PI / 2) * perp;
          const gy = y + Math.sin(angle + Math.PI / 2) * perp;
          const grainSize = Math.random() * o.size * 0.18 + 0.5;
          ctx.globalAlpha = 0.15 + Math.random() * 0.35;
          ctx.fillStyle = o.color;
          ctx.beginPath();
          ctx.arc(gx, gy, grainSize, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      },
    },

    // 8. Crayon — waxy, slightly patchy strokes with visible paper grain gaps.
    crayon: {
      label: 'Crayon',
      glyph: '🖍',
      stroke(ctx, p0, p1, o) {
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        const segLen = Math.max(dist(p0, p1), 1);
        const dabs = Math.max(2, Math.round(segLen / 2));
        for (let i = 0; i <= dabs; i++) {
          const t = i / dabs;
          const x = p0.x + (p1.x - p0.x) * t + (Math.random() - 0.5) * o.size * 0.25;
          const y = p0.y + (p1.y - p0.y) * t + (Math.random() - 0.5) * o.size * 0.25;
          if (Math.random() < 0.15) continue; // gaps = waxy texture
          ctx.globalAlpha = 0.45 + Math.random() * 0.35;
          ctx.fillStyle = o.color;
          ctx.beginPath();
          ctx.arc(x, y, o.size * 0.32, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      },
    },

    // 9. Spray paint — particle spatter scattered within a radius.
    spray: {
      label: 'Spray Paint',
      glyph: '💨',
      stroke(ctx, p0, p1, o) {
        const steps = Math.max(1, Math.ceil(dist(p0, p1) / (o.size * 0.25))) ;
        const radius = o.size * 1.4;
        ctx.save();
        ctx.fillStyle = o.color;
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const cx = p0.x + (p1.x - p0.x) * t;
          const cy = p0.y + (p1.y - p0.y) * t;
          const particles = Math.round(radius * 0.8);
          for (let i = 0; i < particles; i++) {
            const a = Math.random() * Math.PI * 2;
            const r = Math.random() * radius;
            ctx.globalAlpha = 0.25 + Math.random() * 0.35;
            ctx.beginPath();
            ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.random() * 1.2 + 0.3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      },
    },

    // 10. Calligraphy — fixed-angle flat nib; width depends on stroke direction.
    calligraphy: {
      label: 'Calligraphy',
      glyph: '🖋',
      stroke(ctx, p0, p1, o) {
        const nibAngle = Math.PI / 4; // 45° nib
        const dx = p1.x - p0.x;
        const dy = p1.y - p0.y;
        const strokeAngle = Math.atan2(dy, dx);
        const diff = Math.abs(Math.sin(strokeAngle - nibAngle));
        const w = Math.max(o.size * 0.15, o.size * diff);
        const nx = Math.cos(nibAngle) * (w / 2);
        const ny = Math.sin(nibAngle) * (w / 2);

        ctx.save();
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = o.color;
        ctx.beginPath();
        ctx.moveTo(p0.x - nx, p0.y - ny);
        ctx.lineTo(p0.x + nx, p0.y + ny);
        ctx.lineTo(p1.x + nx, p1.y + ny);
        ctx.lineTo(p1.x - nx, p1.y - ny);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      },
    },

    // 11. Pixel brush — hard-edged, grid-snapped squares (retro pixel art).
    pixel: {
      label: 'Pixel',
      glyph: '▪',
      stroke(ctx, p0, p1, o) {
        const grid = Math.max(4, Math.round(o.size / 2));
        const steps = Math.max(1, Math.ceil(dist(p0, p1) / (grid * 0.6)));
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = o.color;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const x = p0.x + (p1.x - p0.x) * t;
          const y = p0.y + (p1.y - p0.y) * t;
          const gx = Math.floor(x / grid) * grid;
          const gy = Math.floor(y / grid) * grid;
          ctx.fillRect(gx, gy, grid, grid);
        }
        ctx.restore();
      },
    },

    // 12. Glow brush — bright core with a soft halo, built from shadowBlur
    // rather than additive ('lighter') compositing so it stays visible on
    // both light and dark canvas backgrounds.
    glow: {
      label: 'Glow',
      glyph: '✨',
      stroke(ctx, p0, p1, o) {
        ctx.save();
        ctx.shadowColor = o.color;
        ctx.shadowBlur = o.size * 1.8;
        basicLine(ctx, p0, p1, o.size * 0.6, o.color, 0.5, 'round');
        ctx.shadowBlur = o.size * 0.8;
        basicLine(ctx, p0, p1, o.size * 0.28, o.color, 0.95, 'round');
        ctx.shadowBlur = 0;
        basicLine(ctx, p0, p1, o.size * 0.12, '#ffffff', 0.9, 'round');
        ctx.restore();
      },
    },
  };

  // Ordered list drives the UI grid in app.js.
  const BRUSH_ORDER = ['pen', 'ink', 'soft', 'spray', 'pixel'];

  global.BRUSHES = BRUSHES;
  global.BRUSH_ORDER = BRUSH_ORDER;
})(window);
