/**
 * app.js
 *
 * Wires up the UI: page navigator, brush grid, colour palette, style
 * picker, and the Render flow that talks to the backend (server.js), which
 * in turn talks to OpenAI. No API key ever touches this file.
 */

(function () {
  // Ordered as a smooth spectrum so similar colours sit next to each other:
  // neutrals → browns → reds → oranges → yellows → greens → blues → purples → pinks.
  const PRESET_COLORS = [
    '#111111', '#6b7280', '#a3a3a3', '#c0c0c0', '#ffffff', '#7a4a2b', // neutrals + brown
    '#c68642', '#8b0000', '#e63946', '#ff4d6d', '#ff9770', '#f3722c', // brown → reds → orange
    '#f8961e', '#f9c74f', '#ffd23f', '#b5e48c', '#90be6d', '#43aa8b', // oranges → yellows → greens
    '#2d6a4f', '#118ab2', '#4d9de0', '#3a86ff', '#003049', '#5e548e', // greens → blues → purple
    '#7c5cff', '#9d4edd', '#d94ecb', '#ffafcc',                       // purples → pinks
  ];
  const DEFAULT_COLOR_INDEX = 24; // #7c5cff, the purple accent

  // Each tile's background image is loaded from img/styles/<id>.jpg.
  const RENDER_STYLES = [
    {
      id: 'photorealistic', title: 'Photorealistic', desc: 'Lifelike detail & lighting',
      description: 'Transform the drawing into a polished, high-quality photograph or cinematic still, ' +
        'with believable lighting, realistic textures, natural proportions, and convincing materials ' +
        'that make the scene feel genuinely real.',
      characteristics: [
        'Realistic anatomy and proportions',
        'Natural lighting with highlights, shadows, and depth',
        'Fine details and texture clarity',
        'Believable materials and surfaces',
        'Clean edges and high visual fidelity',
        'Strong sense of realism without looking plastic or uncanny',
        'Optional subtle cinematic polish, like shallow depth of field or realistic atmosphere',
      ],
      tone: 'Crisp, lifelike, detailed, polished, immersive, and visually convincing.',
    },
    {
      id: 'cartoon', title: 'Cartoon', desc: 'Bold, playful & friendly',
      description: 'Render the drawing as a charming, appealing cartoon with simplified, expressive ' +
        'forms and a playful, friendly personality — clean shapes, readable silhouettes, and a warm, ' +
        'joyful tone.',
      characteristics: [
        'Simplified but expressive forms',
        'Rounded shapes and appealing proportions',
        'Clean outlines or well-defined edges',
        'Bright, harmonious colours',
        'Strong facial expressions and personality',
        'Easy-to-read composition',
        'Fun, cheerful, approachable mood',
        'Stylised rather than realistic, but still carefully designed',
      ],
      tone: 'Adorable, lively, playful, expressive, polished, and family-friendly.',
    },
    {
      id: 'watercolour', title: 'Watercolour', desc: 'Soft washes & bleeds',
      description: 'Render the drawing as a delicate watercolour with soft washes, gentle blending, ' +
        'and translucent layering — graceful, artistic, and emotional, with flowing colours and a ' +
        'hand-painted feel.',
      characteristics: [
        'Soft edges and organic brush diffusion',
        'Transparent layered colour washes',
        'Gentle, harmonious colour palette',
        'Light bleeding and subtle texture from paper or pigment',
        'Elegant, emotional atmosphere',
        'Loose but controlled details',
        'Painterly softness without becoming muddy',
        'A sense of delicacy, charm, and beauty',
      ],
      tone: 'Tender, dreamy, graceful, romantic, airy, and painterly.',
    },
    {
      id: 'pencil', title: 'Pencil', desc: 'Bold graphite & contrast',
      description: 'Render the drawing as a contemporary pencil artwork with bold sketch energy, ' +
        'strong line work, and controlled shading — dynamic, expressive, and full of confidence, ' +
        'contrast, and attitude.',
      characteristics: [
        'Strong, deliberate pencil lines',
        'Layered shading and tonal variation',
        'Energetic sketch marks and expressive texture',
        'Contemporary, stylish composition',
        'Good use of contrast and negative space',
        'Visible graphite or pencil-like texture',
        'Slight roughness used intentionally for character',
        'Clean enough to feel refined, loose enough to feel alive',
      ],
      tone: 'Stylish, raw, expressive, dramatic, contemporary, and slightly rebellious.',
    },
    {
      id: 'oil_masters', title: 'Oil Painting', desc: 'Classic chiaroscuro painting',
      description: 'Render the drawing as a refined classical oil painting in the great Dutch master ' +
        'tradition — rich, moody, elegant, and timeless, with masterful lighting, dramatic light and ' +
        'shadow, and painterly depth.',
      characteristics: [
        'Dramatic chiaroscuro lighting',
        'Deep shadows and luminous highlights',
        'Rich, earthy, sophisticated colour palette',
        'Detailed rendering of fabrics, skin, objects, and surfaces',
        'Painterly brushwork with a refined finish',
        'Strong composition and timeless presence',
        'Atmospheric realism rather than photographic realism',
        'Sense of weight, craftsmanship, and classical beauty',
      ],
      tone: 'Elegant, moody, classical, rich, atmospheric, and masterfully painted.',
    },
    {
      id: 'minecraft', title: 'Pixel', desc: 'Blocky voxel style',
      description: 'Render the drawing in a blocky, voxel-inspired style like Minecraft, or crisp ' +
        'pixel art — shapes simplified into cubes, blocks, or visible pixels, while staying readable ' +
        'and charming.',
      characteristics: [
        'Clearly block-based or pixel-based structure',
        'Simplified geometry and forms',
        'Limited but effective colour palette',
        'Strong silhouette readability',
        'Tiled or pixel-texture logic where appropriate',
        'Clean, recognisable objects and characters',
        'Cohesive stylisation rather than random pixelation',
        'Playful, game-like feel',
      ],
      tone: 'Blocky, nostalgic, playful, stylised, readable, and visually clever.',
      note: 'If using a Minecraft-like result, favour cubic 3D voxel forms. If using pixel art, favour ' +
        'crisp sprite-like rendering with intentional pixel placement.',
    },
    {
      id: 'fantasy', title: 'Fantasy', desc: 'Cinematic & atmospheric',
      description: 'Render the drawing as a lush fantasy artwork with cinematic lighting, magical ' +
        'atmosphere, and a sense of wonder — immersive and emotionally rich, like an epic fantasy ' +
        'film or high-end concept art.',
      characteristics: [
        'Dramatic, atmospheric lighting',
        'Soft glow, mist, haze, or magical effects where suitable',
        'Rich and evocative colour palette',
        'Sense of depth, scale, and world-building',
        'Painterly or semi-realistic detail',
        'Beautiful composition with storytelling energy',
        'Wonder, mystery, enchantment, or emotional resonance',
        'Polished fantasy aesthetic without becoming cluttered',
      ],
      tone: 'Magical, cinematic, immersive, enchanting, emotional, and visually transportive.',
    },
  ];

  // ---- state --------------------------------------------------------
  let selectedStyle = null;
  let selectedEngine = 'fast';

  // ---- canvas ---------------------------------------------------------
  const canvasEl = document.getElementById('drawCanvas');
  const layerEls = [...document.querySelectorAll('#layerStack .draw-layer')];
  const drawing = new DrawingCanvas(canvasEl, layerEls);
  drawing.onStrokeEnd = () => { updateRenderAvailability(); scheduleSave(); refreshLayers(); };
  drawing.onLayerChange = () => refreshLayers();

  // ---- zoom (+/- buttons, mouse wheel, two-finger pinch) ---------------
  new ZoomController({
    viewport: document.getElementById('stage'),
    canvasWrap: document.getElementById('canvasWrap'),
    drawing,
    levelLabel: document.getElementById('zoomLevel'),
    zoomInBtn: document.getElementById('zoomInBtn'),
    zoomOutBtn: document.getElementById('zoomOutBtn'),
  });

  // ---- layers (three stacked sheets: foreground / middle / background) ----
  // Built before the page manager, since loading the first page fires
  // onLayerChange → refreshLayers. Listed front-on-top so the buttons mirror
  // how the drawing actually stacks.
  const LAYER_META = [
    { index: 2, name: 'Foreground' },
    { index: 1, name: 'Middle' },
    { index: 0, name: 'Background' },
  ];
  const layerList = document.getElementById('layerList');
  const activeLayerName = document.getElementById('activeLayerName');
  const layerButtons = [];
  const thumbDpr = window.devicePixelRatio || 1;

  LAYER_META.forEach((meta) => {
    const row = document.createElement('div');
    row.className = 'layer-row';

    const btn = document.createElement('button');
    btn.className = 'layer-btn';
    btn.type = 'button';
    btn.dataset.layer = meta.index;
    btn.setAttribute('aria-label', `Draw on the ${meta.name} layer`);

    const thumb = document.createElement('canvas');
    thumb.className = 'layer-thumb';
    thumb.width = Math.round(40 * thumbDpr);
    thumb.height = Math.round(40 * thumbDpr);

    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = meta.name;

    const empty = document.createElement('span');
    empty.className = 'layer-empty';
    empty.textContent = 'empty';

    btn.append(thumb, name, empty);
    btn.addEventListener('click', () => drawing.setActiveLayer(meta.index));

    // Per-layer clear (leaves the other layers alone).
    const clearBtn = document.createElement('button');
    clearBtn.className = 'layer-clear';
    clearBtn.type = 'button';
    clearBtn.title = `Clear the ${meta.name} layer`;
    clearBtn.setAttribute('aria-label', `Clear the ${meta.name} layer`);
    clearBtn.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/></svg>';
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!drawing.layerHasContent(meta.index)) return;
      if (window.confirm(`Clear the ${meta.name} layer? This cannot be undone.`)) {
        drawing.clearLayer(meta.index); // fires onLayerChange → refreshLayers
        updateRenderAvailability();
        scheduleSave();
      }
    });

    row.append(btn, clearBtn);
    layerList.appendChild(row);
    layerButtons.push({ index: meta.index, btn, clearBtn, thumb, empty });
  });

  // Reflect the active layer + repaint each layer's little preview.
  function refreshLayers() {
    const active = drawing.getActiveLayer();
    layerButtons.forEach(({ index, btn, clearBtn, thumb, empty }) => {
      btn.classList.toggle('active', index === active);
      const has = drawing.layerHasContent(index);
      empty.hidden = has;
      clearBtn.disabled = !has; // nothing to clear on an empty layer
      const tctx = thumb.getContext('2d');
      tctx.setTransform(1, 0, 0, 1, 0, 0);
      tctx.fillStyle = '#ffffff';
      tctx.fillRect(0, 0, thumb.width, thumb.height);
      tctx.drawImage(drawing.getLayerCanvas(index), 0, 0, thumb.width, thumb.height);
    });
    const meta = LAYER_META.find((m) => m.index === active);
    if (meta) activeLayerName.textContent = meta.name;
  }
  refreshLayers();

  // ---- pages (4 independent doodles, switchable at any time) ----------
  const pageManager = new PageManager({
    drawing,
    tabsContainer: document.getElementById('pageTabs'),
    onPageChange: () => { updateRenderAvailability(); scheduleSave(); },
  });

  // ---- trace (load a reference photo and draw over it) ----------------
  const traceOpenBtn = document.getElementById('traceOpenBtn');
  const traceCtrl = new TraceController({
    canvasWrap: document.getElementById('canvasWrap'),
    imgEl: document.getElementById('traceImg'),
    panel: document.getElementById('tracePanel'),
    fileInput: document.getElementById('traceFile'),
    openBtn: traceOpenBtn, // hidden while a trace is active to save space
    drawing,
    onChange: () => { updateRenderAvailability(); updateSaveAvailability(); scheduleSave(); },
  });
  traceOpenBtn.addEventListener('click', () => traceCtrl.openPicker());

  // ---- brush grid -----------------------------------------------------
  const brushGrid = document.getElementById('brushGrid');
  const brushNameEl = document.getElementById('brushName');
  BRUSH_ORDER.forEach((id) => {
    const b = BRUSHES[id];
    const btn = document.createElement('button');
    btn.className = 'brush-btn' + (id === 'pen' ? ' active' : '');
    btn.title = b.label;
    btn.dataset.brush = id;
    btn.innerHTML = b.icon;
    btn.addEventListener('click', () => {
      drawing.setBrush(id);
      eraserBtn.classList.remove('active');
      brushPreviewEl.classList.remove('erasing');
      [...brushGrid.children].forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      brushNameEl.textContent = b.label;
      renderBrushPreview();
      scheduleSave();
    });
    brushGrid.appendChild(btn);
  });

  // ---- live stroke preview -------------------------------------------
  // A sample swoosh painted by the REAL brush engine in the current colour,
  // so the tile always shows exactly the mark you're about to make.
  const brushPreviewEl = document.getElementById('brushPreview');
  let previewBuffer = null;
  function renderBrushPreview() {
    const cssW = brushPreviewEl.clientWidth;
    const cssH = brushPreviewEl.clientHeight;
    if (!cssW || !cssH) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    if (brushPreviewEl.width !== w) { brushPreviewEl.width = w; brushPreviewEl.height = h; }

    // Paint the sample swoosh at full opacity into a buffer, then composite it
    // onto the visible preview at the current transparency — so the preview
    // shows the same even, whole-stroke opacity the brush actually lays down.
    if (!previewBuffer) previewBuffer = document.createElement('canvas');
    if (previewBuffer.width !== w) { previewBuffer.width = w; previewBuffer.height = h; }
    const bctx = previewBuffer.getContext('2d');
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bctx.clearRect(0, 0, cssW, cssH);

    const brush = BRUSHES[drawing.brushId] || BRUSHES.pen;
    // Map the 1..80 canvas size onto a preview-friendly width (sqrt so small
    // sizes stay visible and big ones don't swallow the strip).
    const size = 2 + 22 * Math.sqrt(Math.max(0, drawing.size - 1) / 79);
    const state = {};
    const pad = 14;
    const steps = 44;
    let prev = null;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const pt = {
        x: pad + t * (cssW - pad * 2),
        y: cssH / 2 + Math.sin(t * Math.PI * 1.7 + 0.4) * cssH * 0.18,
        pressure: 0.12 + 0.88 * Math.sin(t * Math.PI), // swell, then taper
      };
      if (prev) brush.stroke(bctx, prev, pt, { size, color: drawing.color, pressure: pt.pressure, state });
      prev = pt;
    }

    const pctx = brushPreviewEl.getContext('2d');
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.clearRect(0, 0, w, h);
    pctx.globalAlpha = drawing.opacity;
    pctx.drawImage(previewBuffer, 0, 0);
    pctx.globalAlpha = 1;
  }

  // ---- size slider ------------------------------------------------------
  const sizeSlider = document.getElementById('sizeSlider');
  const sizeValue = document.getElementById('sizeValue');
  sizeSlider.addEventListener('input', () => {
    drawing.setSize(Number(sizeSlider.value));
    sizeValue.textContent = sizeSlider.value;
    renderBrushPreview();
    scheduleSave();
  });

  // ---- transparency slider (0% = opaque, 100% = invisible) -------------
  const opacitySlider = document.getElementById('opacitySlider');
  const opacityValue = document.getElementById('opacityValue');
  opacitySlider.addEventListener('input', () => {
    const transparency = Number(opacitySlider.value);
    opacityValue.textContent = transparency + '%';
    drawing.setOpacity(1 - transparency / 100);
    renderBrushPreview();
    scheduleSave();
  });

  // ---- help "?" hints: hover (mouse) or tap (touch) reveal the tooltip --
  // The tooltip is position:fixed so it can overhang the canvas instead of
  // being clipped by the panel's scroll box; JS places it under the "?".
  const helpHints = [...document.querySelectorAll('.help-hint')];
  function closeAllHelp() { helpHints.forEach((o) => o.classList.remove('help-open')); }
  function placeHelpTip(h) {
    const tip = h.querySelector('.help-tip');
    if (!tip) return;
    const r = h.getBoundingClientRect();
    tip.style.left = '0px'; // reset before measuring width
    const tw = tip.offsetWidth;
    const left = Math.max(8, Math.min(r.left - 6, window.innerWidth - tw - 8));
    tip.style.left = Math.round(left) + 'px';
    tip.style.top = Math.round(r.bottom + 8) + 'px';
  }
  function toggleHelp(h) {
    const open = h.classList.contains('help-open');
    closeAllHelp();
    if (!open) { placeHelpTip(h); h.classList.add('help-open'); }
  }
  helpHints.forEach((h) => {
    // Mouse: hover to reveal. Touch/keyboard: one tap (or Enter/Space) toggles.
    // No focus-to-open — on touch the tap both focuses and clicks, and a
    // focus-open would be cancelled by the same tap's click (needing a 2nd tap).
    h.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { placeHelpTip(h); h.classList.add('help-open'); } });
    h.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') h.classList.remove('help-open'); });
    h.addEventListener('blur', () => h.classList.remove('help-open'));
    h.addEventListener('click', (e) => { e.stopPropagation(); toggleHelp(h); });
    h.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleHelp(h); } });
  });
  document.addEventListener('click', closeAllHelp);

  // ---- keyboard shortcuts: [ ] opacity, - = brush size ----------------
  function nudgeSlider(slider, delta) {
    const v = Math.max(Number(slider.min), Math.min(Number(slider.max), Number(slider.value) + delta));
    if (v === Number(slider.value)) return;
    slider.value = v;
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Ignore while typing in a text field (e.g. the instructions box).
    const el = e.target;
    const tag = el && el.tagName;
    if (tag === 'TEXTAREA' ||
        (tag === 'INPUT' && !['range', 'checkbox', 'button'].includes(el.type)) ||
        (el && el.isContentEditable)) return;
    let handled = true;
    switch (e.key) {
      case '-': case '_': nudgeSlider(sizeSlider, -2); break;
      case '=': case '+': nudgeSlider(sizeSlider, 2); break;
      case ']': nudgeSlider(opacitySlider, 5); break;  // more transparent
      case '[': nudgeSlider(opacitySlider, -5); break; // less transparent
      default: handled = false;
    }
    if (handled) e.preventDefault();
  });

  // ---- colour swatches ----------------------------------------------
  const colorSwatches = document.getElementById('colorSwatches');
  const customColor = document.getElementById('customColor');
  const customPalette = document.getElementById('customPalette');
  const paletteSaveBtn = document.getElementById('paletteSaveBtn');

  const PALETTE_SIZE = 6;
  const PALETTE_KEY = 'inkmagik.customPalette';
  let activeColor = '#7c5cff';

  function selectColor(hex, swatchEl) {
    activeColor = hex;
    drawing.setColor(hex);
    eraserBtn.classList.remove('active');
    drawing.setEraser(false);
    brushPreviewEl.classList.remove('erasing');
    // Clear active state across both preset swatches and custom palette slots.
    document.querySelectorAll('#colorSwatches .swatch, #customPalette .swatch')
      .forEach((c) => c.classList.remove('active'));
    if (swatchEl) swatchEl.classList.add('active');
    customColor.value = hex;
    renderBrushPreview();
    scheduleSave();
  }

  PRESET_COLORS.forEach((hex, i) => {
    const sw = document.createElement('button');
    sw.className = 'swatch' + (i === DEFAULT_COLOR_INDEX ? ' active' : ''); // default = the purple accent
    sw.style.background = hex;
    sw.title = hex;
    sw.addEventListener('click', () => selectColor(hex, sw));
    colorSwatches.appendChild(sw);
  });
  customColor.addEventListener('input', () => selectColor(customColor.value, null));

  // ---- custom "My palette" (6 saveable slots, persisted to localStorage) ---
  function loadPalette() {
    try {
      const stored = JSON.parse(localStorage.getItem(PALETTE_KEY));
      if (Array.isArray(stored)) return stored.slice(0, PALETTE_SIZE);
    } catch (_) { /* ignore malformed storage */ }
    return [];
  }
  function savePalette(colors) {
    try { localStorage.setItem(PALETTE_KEY, JSON.stringify(colors)); } catch (_) { /* ignore */ }
  }

  let paletteColors = loadPalette(); // array of hex strings, up to PALETTE_SIZE

  function renderPalette() {
    customPalette.innerHTML = '';
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const hex = paletteColors[i];
      const slot = document.createElement('button');
      if (hex) {
        slot.className = 'swatch';
        slot.style.background = hex;
        slot.title = hex;
        slot.addEventListener('click', () => selectColor(hex, slot));
      } else {
        slot.className = 'swatch empty';
        slot.title = 'Save a colour here with the Save button';
      }
      customPalette.appendChild(slot);
    }
  }

  // Save the current colour into the next free slot, or cycle-overwrite the
  // oldest once all six are full, so the button always does something useful.
  function saveCurrentColor() {
    if (paletteColors.length < PALETTE_SIZE) {
      paletteColors.push(activeColor);
    } else {
      paletteColors.shift();
      paletteColors.push(activeColor);
    }
    savePalette(paletteColors);
    renderPalette();
  }

  paletteSaveBtn.addEventListener('click', saveCurrentColor);
  renderPalette();

  // ---- save current page image to the device --------------------------
  // iPad Safari ignores the <a download> attribute, so on Apple touch
  // devices we use the Web Share sheet (Save to Photos / Files). Desktop
  // gets a direct download.
  const saveImageBtn = document.getElementById('saveImageBtn');
  const saveHint = document.getElementById('saveHint');

  // Saving is blocked while a trace reference is active — finish (remove) the
  // trace first, so you only ever save the finished drawing.
  function updateSaveAvailability() {
    const tracing = traceCtrl.hasImage();
    saveImageBtn.disabled = tracing;
    saveImageBtn.title = tracing ? 'Remove the trace image before saving' : '';
    saveHint.hidden = !tracing;
  }

  function isAppleTouch() {
    return (
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );
  }

  function flashSaved() {
    const original = saveImageBtn.querySelector('span').textContent;
    saveImageBtn.classList.add('saved');
    saveImageBtn.querySelector('span').textContent = 'Saved!';
    setTimeout(() => {
      saveImageBtn.classList.remove('saved');
      saveImageBtn.querySelector('span').textContent = original;
    }, 1600);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 200);
  }

  saveImageBtn.addEventListener('click', () => {
    if (saveImageBtn.disabled) return;
    const filename = `inkmagik-page-${pageManager.currentIndex + 1}.png`;
    drawing.toBlob(async (blob) => {
      if (!blob) return;
      // Prefer the native share sheet on Apple touch devices so users can
      // save straight to Photos or Files.
      if (isAppleTouch() && navigator.canShare) {
        const file = new File([blob], filename, { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: 'Inkmagik drawing' });
            flashSaved();
            return;
          } catch (err) {
            if (err && err.name === 'AbortError') return; // user cancelled — don't also download
            // any other failure falls through to a direct download
          }
        }
      }
      downloadBlob(blob, filename);
      flashSaved();
    }, 'image/png');
  });

  // ---- eraser ---------------------------------------------------------
  const eraserBtn = document.getElementById('eraserBtn');
  eraserBtn.addEventListener('click', () => {
    const nowOn = !eraserBtn.classList.contains('active');
    eraserBtn.classList.toggle('active', nowOn);
    drawing.setEraser(nowOn);
    brushPreviewEl.classList.toggle('erasing', nowOn);
  });

  // ---- true-size brush cursor ------------------------------------------
  // A ring matching the exact on-screen brush diameter and current colour,
  // shown for mouse/stylus (touch keeps the screen clear under the finger).
  const brushCursor = document.getElementById('brushCursor');
  const canvasWrapEl = document.getElementById('canvasWrap');

  function hexToRgba(hex, a) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  function updateBrushCursor(e) {
    const rect = canvasWrapEl.getBoundingClientRect();
    const scale = rect.width / canvasEl.width; // display px per canvas px
    const d = Math.max(4, drawing.size * scale);
    brushCursor.style.width = `${d}px`;
    brushCursor.style.height = `${d}px`;
    brushCursor.style.left = `${e.clientX - rect.left}px`;
    brushCursor.style.top = `${e.clientY - rect.top}px`;
    brushCursor.classList.toggle('eraser', drawing.isEraser);
    brushCursor.style.borderColor = drawing.isEraser ? 'rgba(255,255,255,0.9)' : drawing.color;
    brushCursor.style.background = drawing.isEraser
      ? 'rgba(255,255,255,0.08)'
      : hexToRgba(drawing.color, 0.12);
  }

  canvasEl.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') { brushCursor.hidden = true; return; }
    updateBrushCursor(e);
    brushCursor.hidden = false;
  });
  canvasEl.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') brushCursor.hidden = true;
  });
  canvasEl.addEventListener('pointerleave', () => { brushCursor.hidden = true; });
  canvasEl.addEventListener('pointercancel', () => { brushCursor.hidden = true; });

  // ---- pencil-only mode (touch devices) --------------------------------
  // On touch devices, let the user restrict drawing to a stylus so a stray
  // finger (or iPad Safari's system swipe gestures) doesn't leave marks.
  const penOnlyBtn = document.getElementById('penOnlyBtn');
  const hasTouch = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
  function setPenOnly(on) {
    drawing.setPenOnly(on);
    penOnlyBtn.classList.toggle('active', on);
    penOnlyBtn.title = on ? 'Pencil only — tap to allow finger' : 'Draw with pencil only';
  }
  if (hasTouch) {
    penOnlyBtn.hidden = false;
    penOnlyBtn.addEventListener('click', () => { setPenOnly(!drawing.isPenOnly()); scheduleSave(); });
  }

  // Suppress browser-initiated touch gestures on the drawing surface. On iPad
  // Safari an un-consumed swipe can scroll the page or exit full screen even
  // when the finger isn't drawing — so block touchmove everywhere except the
  // tool panels and modals, which keep their native scrolling.
  document.addEventListener('touchmove', (e) => {
    if (e.target.closest && e.target.closest('.panel, .result-overlay, input, textarea, select')) return;
    if (e.cancelable) e.preventDefault();
  }, { passive: false });

  // ---- full screen -----------------------------------------------------
  // Uses the standard Fullscreen API with webkit fallbacks so it works on
  // desktop browsers and iPad Safari (which is webkit-prefixed). iPhone
  // Safari doesn't support element fullscreen, so the button hides there.
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  const fsRoot = document.documentElement;
  // Gate on whether fullscreen is actually PERMITTED, not just whether the
  // method exists. iOS third-party browsers (Chrome/Brave) expose the webkit
  // method but Apple blocks the API, so fullscreenEnabled is false there —
  // this hides the dead button on those browsers while keeping it on Safari.
  const fsSupported = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);

  function fsElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }
  function updateFsButton() {
    fullscreenBtn.classList.toggle('is-fullscreen', !!fsElement());
    fullscreenBtn.title = fsElement() ? 'Exit full screen' : 'Full screen';
  }
  if (!fsSupported) {
    fullscreenBtn.hidden = true;
  } else {
    fullscreenBtn.addEventListener('click', () => {
      try {
        if (fsElement()) {
          (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        } else {
          (fsRoot.requestFullscreen || fsRoot.webkitRequestFullscreen).call(fsRoot);
        }
      } catch (_) { /* denied or unsupported — ignore */ }
    });
    document.addEventListener('fullscreenchange', updateFsButton);
    document.addEventListener('webkitfullscreenchange', updateFsButton);
    updateFsButton();
  }

  // ---- undo / clear -----------------------------------------------------
  function doUndo() {
    drawing.undo();
    updateRenderAvailability();
    scheduleSave();
  }
  document.getElementById('undoBtn').addEventListener('click', doUndo);

  // Ctrl+Z (Cmd+Z on Mac) undoes the last stroke. The main shortcut handler
  // above ignores Ctrl/Cmd, so this needs its own listener.
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
    if (e.key !== 'z' && e.key !== 'Z') return;
    // Ignore while typing in a text field (e.g. the instructions box).
    const el = e.target;
    const tag = el && el.tagName;
    if (tag === 'TEXTAREA' ||
        (tag === 'INPUT' && !['range', 'checkbox', 'button'].includes(el.type)) ||
        (el && el.isContentEditable)) return;
    e.preventDefault();
    doUndo();
  });
  document.getElementById('clearBtn').addEventListener('click', () => {
    if (!drawing.hasDrawing()) return;
    if (window.confirm('Clear the entire canvas? This cannot be undone.')) {
      drawing.clear();
      updateRenderAvailability();
      scheduleSave();
    }
  });

  // ---- style picker (accordion: description opens under its own tile) ---
  const styleGrid = document.getElementById('styleGrid');

  RENDER_STYLES.forEach((style) => {
    const item = document.createElement('div');
    item.className = 'style-item';

    const card = document.createElement('button');
    card.className = 'style-card';
    card.style.backgroundImage = `url("img/styles/${style.id}.jpg")`;
    card.innerHTML = `
      <span class="style-text">
        <span class="style-title">${style.title}</span>
        <span class="style-desc">${style.desc}</span>
      </span>
      <span class="style-check">
        <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
      </span>`;

    const characteristics = style.characteristics.map((c) => `<li>${c}</li>`).join('');
    const detailWrap = document.createElement('div');
    detailWrap.className = 'style-detail-wrap';
    detailWrap.innerHTML = `
      <div class="style-detail-inner">
        <div class="style-detail-content">
          <p class="style-detail-desc">${style.description}</p>
          <ul class="style-detail-list">${characteristics}</ul>
          <p class="style-detail-tone"><strong>Tone:</strong> ${style.tone}</p>
          ${style.note ? `<p class="style-detail-note">${style.note}</p>` : ''}
        </div>
      </div>`;

    card.addEventListener('click', () => {
      selectedStyle = style.id;
      [...styleGrid.querySelectorAll('.style-card')].forEach((c) => c.classList.remove('active'));
      [...styleGrid.querySelectorAll('.style-detail-wrap')].forEach((w) => w.classList.remove('open'));
      card.classList.add('active');
      detailWrap.classList.add('open');
      updateRenderAvailability();
    });

    item.appendChild(card);
    item.appendChild(detailWrap);
    styleGrid.appendChild(item);
  });

  // ---- render engine toggle (fast gpt-image-1 vs high-res gpt-image-2) --
  const engineToggle = document.getElementById('engineToggle');
  const ENGINE_LOADING_TEXT = {
    fast: 'This should only take a few seconds.',
    quality: 'High-resolution renders can take a minute or two.',
  };
  engineToggle.querySelectorAll('.engine-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedEngine = btn.dataset.engine;
      engineToggle.querySelectorAll('.engine-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // ---- render button availability ----------------------------------
  const renderBtn = document.getElementById('renderBtn');
  function updateRenderAvailability() {
    const tracing = traceCtrl.hasImage();
    renderBtn.disabled = !selectedStyle || !drawing.hasDrawing() || tracing;
    renderBtn.title = tracing ? 'Remove the trace image before rendering' : '';
  }
  updateRenderAvailability();

  // ---- render flow (talks to backend, never to OpenAI directly) ------
  const resultOverlay = document.getElementById('resultOverlay');
  const originalPreview = document.getElementById('originalPreview');
  const renderedPreview = document.getElementById('renderedPreview');
  const loadingState = document.getElementById('loadingState');
  const errorState = document.getElementById('errorState');
  const errorMessage = document.getElementById('errorMessage');
  const errorBuyBtn = document.getElementById('errorBuyBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const extraInstructions = document.getElementById('extraInstructions');
  const loadingSubtext = document.getElementById('loadingSubtext');

  renderBtn.addEventListener('click', async () => {
    if (renderBtn.disabled) return;

    // Rendering is signed-in only. Check that synchronously — getUser() reads
    // cached state, so we stay inside the user's tap and the sign-in popup
    // isn't blocked (iOS Safari blocks window.open after any await).
    if (!window.Auth || !window.Auth.getUser()) {
      if (window.Auth) window.Auth.signInWithGoogle();
      return;
    }

    // Their drawing is safe either way — it's autosaved to localStorage.
    const token = await window.Auth.getToken();
    if (!token) {
      window.Auth.signInWithGoogle();
      return;
    }

    const originalDataUrl = drawing.toDataURL();
    originalPreview.src = originalDataUrl;

    renderedPreview.hidden = true;
    errorState.hidden = true;
    loadingState.hidden = false;
    loadingSubtext.textContent = ENGINE_LOADING_TEXT[selectedEngine] || '';
    downloadBtn.disabled = true;
    resultOverlay.classList.add('open');

    try {
      const res = await fetch('/api/render', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          imageBase64: originalDataUrl,
          style: selectedStyle,
          instructions: extraInstructions.value.trim(),
          engine: selectedEngine,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        const err = new Error(data.error || `Server responded with ${res.status}`);
        err.status = res.status; // 402 = out of tokens, so we can offer a top-up
        throw err;
      }

      renderedPreview.src = data.imageBase64;
      renderedPreview.hidden = false;
      loadingState.hidden = true;
      downloadBtn.disabled = false;

      // Reflect the token spent on this render in the account pill.
      if (window.Auth && typeof data.tokens === 'number') {
        window.Auth.setTokens(data.tokens);
      }
    } catch (err) {
      errorMessage.textContent = err.message || 'Something went wrong while rendering. Please try again.';
      // Out of tokens — offer a top-up right where they hit the wall.
      errorBuyBtn.hidden = err.status !== 402;
      errorState.hidden = false;
      loadingState.hidden = true;
    }
  });

  errorBuyBtn.addEventListener('click', () => {
    resultOverlay.classList.remove('open');
    if (window.Billing) window.Billing.openBuy();
  });

  document.getElementById('closeResult').addEventListener('click', () => {
    resultOverlay.classList.remove('open');
  });
  document.getElementById('editAgainBtn').addEventListener('click', () => {
    resultOverlay.classList.remove('open');
  });

  downloadBtn.addEventListener('click', () => {
    if (!renderedPreview.src || downloadBtn.disabled) return;
    const a = document.createElement('a');
    a.href = renderedPreview.src;
    a.download = 'inkmagik-render.png';
    document.body.appendChild(a);
    a.click();
    // Large data: URIs (multi-MB at High-Res) need a moment for the browser
    // to actually kick off the download before we remove the element —
    // removing it in the same tick as click() can silently cancel it.
    setTimeout(() => a.remove(), 150);
  });

  // ---- about this project ----------------------------------------------
  const aboutOverlay = document.getElementById('aboutOverlay');
  document.getElementById('aboutBtn').addEventListener('click', () => {
    aboutOverlay.classList.add('open');
  });
  document.getElementById('closeAbout').addEventListener('click', () => {
    aboutOverlay.classList.remove('open');
  });
  aboutOverlay.addEventListener('click', (e) => {
    if (e.target === aboutOverlay) aboutOverlay.classList.remove('open');
  });

  // ---- mobile slide-in panels -----------------------------------------
  const leftPanel = document.getElementById('leftPanel');
  const rightPanel = document.getElementById('rightPanel');
  const scrim = document.getElementById('scrim');

  function closePanels() {
    leftPanel.classList.remove('open');
    rightPanel.classList.remove('open');
    scrim.classList.remove('open');
  }

  document.getElementById('toggleLeftPanel').addEventListener('click', () => {
    const willOpen = !leftPanel.classList.contains('open');
    closePanels();
    if (willOpen) {
      leftPanel.classList.add('open');
      scrim.classList.add('open');
    }
  });
  document.getElementById('toggleRightPanel').addEventListener('click', () => {
    const willOpen = !rightPanel.classList.contains('open');
    closePanels();
    if (willOpen) {
      rightPanel.classList.add('open');
      scrim.classList.add('open');
    }
  });
  scrim.addEventListener('click', closePanels);

  // ---- session autosave / restore --------------------------------------
  // Persists all 5 pages, the current page, brush, colour, and size to
  // localStorage — saved when the tab is hidden/closed plus a debounced
  // safety-net save after every change — and restored on next visit.
  const SESSION_KEY = 'inkmagik.session';

  // Compact per-stroke form for storage; points → [x, y, pressure] triples
  // with rounded coords, keeping four full multi-layer pages inside quota.
  function compactStrokes(strokes) {
    return strokes.map((st) => ({
      t: st.tool,
      b: st.brushId,
      c: st.color,
      s: st.size,
      o: st.opacity != null ? st.opacity : 1,
      p: st.points.map((pt) => [
        Math.round(pt.x * 10) / 10,
        Math.round(pt.y * 10) / 10,
        Math.round((pt.pressure != null ? pt.pressure : 0.5) * 100) / 100,
      ]),
    }));
  }

  function expandStrokes(compact) {
    return (Array.isArray(compact) ? compact : []).map((st) => ({
      tool: st.t === 'eraser' ? 'eraser' : 'brush',
      brushId: typeof st.b === 'string' ? st.b : 'pen',
      color: typeof st.c === 'string' ? st.c : '#111111',
      size: typeof st.s === 'number' ? st.s : 14,
      opacity: typeof st.o === 'number' ? st.o : 1,
      points: (Array.isArray(st.p) ? st.p : [])
        .filter((a) => Array.isArray(a) && a.length >= 2)
        .map((a) => ({ x: a[0], y: a[1], pressure: a[2] != null ? a[2] : 0.5 })),
    })).filter((st) => st.points.length > 0);
  }

  function saveSession() {
    try {
      const snap = pageManager.snapshot();
      const data = {
        v: 2,
        brush: drawing.brushId,
        color: drawing.color,
        size: drawing.size,
        opacity: drawing.opacity,
        penOnly: drawing.isPenOnly(),
        page: snap.index,
        // Each page is { a: activeLayer, l: [back, middle, foreground] }, and
        // each layer is a list of compact strokes.
        pages: snap.pages.map((pg) => ({
          a: pg.active,
          l: pg.layers.map(compactStrokes),
        })),
        trace: traceCtrl.getState(), // reference image + geometry, or null
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(data));
    } catch (_) { /* storage full or blocked — skip silently */ }
  }

  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveSession, 1500);
  }

  function restoreSession() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (_) { /* corrupt — ignore */ }
    if (!data || (data.v !== 1 && data.v !== 2)) return;

    if (Array.isArray(data.pages)) {
      let pages;
      if (data.v === 2) {
        pages = data.pages.map((pg) => ({
          active: pg && typeof pg.a === 'number' ? pg.a : 1,
          layers: (Array.isArray(pg && pg.l) ? pg.l : []).map(expandStrokes),
        }));
      } else {
        // v1 sessions had a single flat history per page — put it on the
        // middle layer so older drawings survive the upgrade.
        pages = data.pages.map((flat) => ({
          active: 1,
          layers: [[], expandStrokes(flat), []],
        }));
      }
      pageManager.restore(pages, data.page || 0);
    }

    if (typeof data.brush === 'string' && BRUSHES[data.brush]) {
      const btn = [...brushGrid.children].find((b) => b.dataset.brush === data.brush);
      if (btn) btn.click();
    }
    if (typeof data.size === 'number' && data.size >= 1 && data.size <= 80) {
      sizeSlider.value = data.size;
      sizeSlider.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (typeof data.opacity === 'number' && data.opacity >= 0 && data.opacity <= 1) {
      opacitySlider.value = Math.round((1 - data.opacity) * 100);
      opacitySlider.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (typeof data.color === 'string' && /^#[0-9a-f]{6}$/i.test(data.color)) {
      const sw = [...colorSwatches.children, ...customPalette.children]
        .find((s) => s.title && s.title.toLowerCase() === data.color.toLowerCase());
      selectColor(data.color, sw || null);
    }
    if (data.trace) traceCtrl.restore(data.trace);
    if (hasTouch && data.penOnly) setPenOnly(true);
    updateRenderAvailability();
    updateSaveAvailability();
  }

  // visibilitychange(hidden) is the reliable "user is leaving" signal on
  // both desktop and iPad; pagehide is the belt-and-braces fallback.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveSession();
  });
  window.addEventListener('pagehide', saveSession);

  // ---- initial paint ---------------------------------------------------
  restoreSession();
  renderBrushPreview();
  window.addEventListener('resize', renderBrushPreview);
})();
