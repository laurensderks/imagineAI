/**
 * app.js
 *
 * Wires up the UI: page navigator, brush grid, colour palette, style
 * picker, and the Render flow that talks to the backend (server.js), which
 * in turn talks to OpenAI. No API key ever touches this file.
 */

(function () {
  const PRESET_COLORS = [
    // Original 12
    '#111111', '#ffffff', '#e63946', '#f3722c', '#f8961e', '#f9c74f',
    '#90be6d', '#43aa8b', '#4d9de0', '#3a86ff', '#7c5cff', '#d94ecb',
    // Additional 16: neutrals, browns, deep shades, pastels, and extra hues
    '#a3a3a3', '#6b7280', '#c0c0c0', '#7a4a2b',
    '#c68642', '#8b0000', '#ff4d6d', '#ff9770',
    '#ffd23f', '#b5e48c', '#2d6a4f', '#118ab2',
    '#003049', '#5e548e', '#9d4edd', '#ffafcc',
  ];

  // Each `thumb` is a tiny self-contained SVG that gives a rough visual
  // impression of the style (no external images/API calls needed for this).
  const RENDER_STYLES = [
    {
      id: 'photorealistic', title: 'Enhanced Photorealistic', desc: 'Lifelike detail & lighting',
      description: 'Transform the drawing into a highly realistic image that looks like a polished, ' +
        'high-quality photograph or cinematic still. The final image should have believable lighting, ' +
        'realistic textures, natural proportions, accurate depth, and convincing materials such as ' +
        'skin, fabric, wood, glass, metal, water, or stone depending on the subject.',
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
      thumb: `<svg viewBox="0 0 64 64"><defs><linearGradient id="g-photo" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffb56b"/><stop offset="0.55" stop-color="#ff8a5c"/><stop offset="1" stop-color="#3b4a63"/>
        </linearGradient></defs><rect width="64" height="64" fill="url(#g-photo)"/>
        <circle cx="46" cy="18" r="8" fill="#fff6d8"/>
        <path d="M0 46 Q 16 34 32 44 T 64 40 V64 H0 Z" fill="#2f3b2a"/></svg>`,
    },
    {
      id: 'cartoon', title: 'Cute Cartoon', desc: 'Bold, playful & friendly',
      description: 'Render the drawing as a charming, appealing cartoon illustration with simplified ' +
        'forms, expressive features, and a playful, friendly personality. The style should feel ' +
        'polished and intentional, with clean shapes, readable silhouettes, and a warm, joyful visual tone.',
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
      thumb: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#8fd6ff"/>
        <circle cx="46" cy="16" r="9" fill="#ffe066" stroke="#222" stroke-width="2.5"/>
        <path d="M6 46 Q 20 30 34 44 T 60 40" fill="none" stroke="#222" stroke-width="2.5"/>
        <path d="M6 46 Q 20 30 34 44 T 60 40 V64 H6 Z" fill="#7ed957" stroke="#222" stroke-width="2.5"/></svg>`,
    },
    {
      id: 'watercolour', title: 'Romantic Watercolour', desc: 'Soft washes & bleeds',
      description: 'Render the drawing as a delicate and beautiful watercolour painting with soft ' +
        'washes, gentle blending, translucent layering, and an emotional, poetic atmosphere. The image ' +
        'should feel graceful and artistic, with flowing colour transitions and a hand-painted quality.',
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
      thumb: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#faf3ea"/>
        <g filter="url(#soft)" opacity="0.75"><circle cx="22" cy="24" r="16" fill="#f2a6c1"/>
        <circle cx="42" cy="34" r="15" fill="#a9c9f0"/><circle cx="30" cy="44" r="13" fill="#f6d98b"/></g>
        <defs><filter id="soft"><feGaussianBlur stdDeviation="3.2"/></filter></defs></svg>`,
    },
    {
      id: 'pencil', title: 'Modern Edgy Pencil', desc: 'Bold graphite & contrast',
      description: 'Render the drawing as a contemporary pencil artwork with bold sketch energy, ' +
        'strong line work, controlled shading, and an artistic, fashion-forward edge. This should ' +
        'feel more dynamic and expressive than a simple school sketch, with confidence, contrast, ' +
        'and visual attitude.',
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
      thumb: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#f1f1ee"/>
        <g stroke="#2a2a2a" stroke-width="1.4" opacity="0.55">
        <path d="M4 8 L 60 8 M4 16 L 60 16 M4 24 L 60 24 M4 32 L 60 32 M4 40 L 60 40 M4 48 L 60 48 M4 56 L 60 56"/></g>
        <circle cx="32" cy="32" r="18" fill="none" stroke="#111" stroke-width="3"/></svg>`,
    },
    {
      id: 'oil_masters', title: 'Dutch Masters Oil', desc: 'Classic chiaroscuro painting',
      description: 'Render the drawing as a refined classical oil painting inspired by the great ' +
        'Dutch master tradition. The final image should feel rich, moody, elegant, and timeless, with ' +
        'masterful lighting, subtle realism, and painterly depth. Emphasise dramatic light and shadow, ' +
        'detailed textures, and a sense of dignity or atmosphere.',
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
      thumb: `<svg viewBox="0 0 64 64"><defs><radialGradient id="g-oil" cx="0.4" cy="0.35" r="0.65">
        <stop offset="0" stop-color="#caa25a"/><stop offset="0.5" stop-color="#5c3f26"/><stop offset="1" stop-color="#0e0a06"/>
        </radialGradient></defs><rect width="64" height="64" fill="url(#g-oil)"/>
        <ellipse cx="32" cy="40" rx="14" ry="18" fill="#1a120a" opacity="0.55"/></svg>`,
    },
    {
      id: 'minecraft', title: 'Minecraft / Pixel Art', desc: 'Blocky voxel style',
      description: 'Render the drawing in a blocky, voxel-inspired style reminiscent of Minecraft, ' +
        'or as crisp pixel art depending on the subject. Shapes should be intentionally simplified ' +
        'into cubes, blocks, or visible pixels, while still preserving readability, charm, and visual ' +
        'coherence.',
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
      thumb: `<svg viewBox="0 0 64 64" shape-rendering="crispEdges"><rect width="64" height="64" fill="#7ec0ee"/>
        <rect y="32" width="64" height="8" fill="#6a9a3d"/><rect y="40" width="64" height="24" fill="#8a5a34"/>
        <rect x="8" y="40" width="8" height="8" fill="#6a4426"/><rect x="24" y="48" width="8" height="8" fill="#6a4426"/>
        <rect x="42" y="40" width="8" height="8" fill="#6a4426"/><rect x="12" y="10" width="8" height="8" fill="#fff"/>
        <rect x="20" y="10" width="8" height="8" fill="#fff"/><rect x="12" y="18" width="16" height="8" fill="#fff"/></svg>`,
    },
    {
      id: 'fantasy', title: 'Dreamlike Fantasy', desc: 'Cinematic & atmospheric',
      description: 'Render the drawing as a lush fantasy artwork with cinematic lighting, magical ' +
        'atmosphere, and a sense of wonder. The image should feel immersive and emotionally rich, ' +
        'like a scene from an epic fantasy film, illustrated storybook, or high-end concept art piece.',
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
      thumb: `<svg viewBox="0 0 64 64"><defs><radialGradient id="g-fan" cx="0.65" cy="0.3" r="0.9">
        <stop offset="0" stop-color="#6a4fd6"/><stop offset="0.55" stop-color="#2c2159"/><stop offset="1" stop-color="#0c0a1e"/>
        </radialGradient></defs><rect width="64" height="64" fill="url(#g-fan)"/>
        <circle cx="42" cy="18" r="9" fill="#ffe9b0" opacity="0.9"/>
        <circle cx="10" cy="12" r="1.4" fill="#fff"/><circle cx="20" cy="26" r="1" fill="#fff"/>
        <circle cx="52" cy="42" r="1.2" fill="#fff"/><circle cx="8" cy="46" r="1" fill="#fff"/></svg>`,
    },
  ];

  // ---- state --------------------------------------------------------
  let selectedStyle = null;

  // ---- canvas ---------------------------------------------------------
  const canvasEl = document.getElementById('drawCanvas');
  const drawing = new DrawingCanvas(canvasEl);
  drawing.onStrokeEnd = updateRenderAvailability;

  // ---- zoom (+/- buttons, mouse wheel, two-finger pinch) ---------------
  new ZoomController({
    viewport: document.getElementById('stage'),
    canvasWrap: document.getElementById('canvasWrap'),
    drawing,
    levelLabel: document.getElementById('zoomLevel'),
    zoomInBtn: document.getElementById('zoomInBtn'),
    zoomOutBtn: document.getElementById('zoomOutBtn'),
  });

  // ---- pages (5 independent doodles, switchable at any time) ----------
  new PageManager({
    drawing,
    dotsContainer: document.getElementById('pageDots'),
    prevBtn: document.getElementById('prevPageBtn'),
    nextBtn: document.getElementById('nextPageBtn'),
    onPageChange: () => updateRenderAvailability(),
  });

  // ---- brush grid -----------------------------------------------------
  const brushGrid = document.getElementById('brushGrid');
  BRUSH_ORDER.forEach((id) => {
    const b = BRUSHES[id];
    const btn = document.createElement('button');
    btn.className = 'brush-btn' + (id === 'pen' ? ' active' : '');
    btn.title = b.label;
    btn.dataset.brush = id;
    btn.innerHTML = `<span>${b.glyph}</span>`;
    btn.addEventListener('click', () => {
      drawing.setBrush(id);
      eraserBtn.classList.remove('active');
      [...brushGrid.children].forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
    });
    brushGrid.appendChild(btn);
  });

  // ---- size slider ------------------------------------------------------
  const sizeSlider = document.getElementById('sizeSlider');
  const sizeValue = document.getElementById('sizeValue');
  sizeSlider.addEventListener('input', () => {
    drawing.setSize(Number(sizeSlider.value));
    sizeValue.textContent = sizeSlider.value;
  });

  // ---- colour swatches ----------------------------------------------
  const colorSwatches = document.getElementById('colorSwatches');
  const customColor = document.getElementById('customColor');

  function selectColor(hex, swatchEl) {
    drawing.setColor(hex);
    eraserBtn.classList.remove('active');
    drawing.setEraser(false);
    [...colorSwatches.children].forEach((c) => c.classList.remove('active'));
    if (swatchEl) swatchEl.classList.add('active');
    customColor.value = hex;
  }

  PRESET_COLORS.forEach((hex, i) => {
    const sw = document.createElement('button');
    sw.className = 'swatch' + (i === 10 ? ' active' : ''); // default = the purple accent
    sw.style.background = hex;
    sw.title = hex;
    sw.addEventListener('click', () => selectColor(hex, sw));
    colorSwatches.appendChild(sw);
  });
  customColor.addEventListener('input', () => selectColor(customColor.value, null));

  // ---- eraser ---------------------------------------------------------
  const eraserBtn = document.getElementById('eraserBtn');
  eraserBtn.addEventListener('click', () => {
    const nowOn = !eraserBtn.classList.contains('active');
    eraserBtn.classList.toggle('active', nowOn);
    drawing.setEraser(nowOn);
  });

  // ---- undo / clear -----------------------------------------------------
  document.getElementById('undoBtn').addEventListener('click', () => {
    drawing.undo();
    updateRenderAvailability();
  });
  document.getElementById('clearBtn').addEventListener('click', () => {
    if (!drawing.hasDrawing()) return;
    if (window.confirm('Clear the entire canvas? This cannot be undone.')) {
      drawing.clear();
      updateRenderAvailability();
    }
  });

  // ---- style picker -----------------------------------------------------
  const styleGrid = document.getElementById('styleGrid');
  const styleDetail = document.getElementById('styleDetail');

  function showStyleDetail(style) {
    const characteristics = style.characteristics.map((c) => `<li>${c}</li>`).join('');
    styleDetail.innerHTML = `
      <p class="style-detail-desc">${style.description}</p>
      <ul class="style-detail-list">${characteristics}</ul>
      <p class="style-detail-tone"><strong>Tone:</strong> ${style.tone}</p>
      ${style.note ? `<p class="style-detail-note">${style.note}</p>` : ''}`;
    styleDetail.hidden = false;
  }

  RENDER_STYLES.forEach((style) => {
    const card = document.createElement('button');
    card.className = 'style-card';
    card.innerHTML = `
      <span class="style-thumb">${style.thumb}</span>
      <span class="style-text">
        <span class="style-title">${style.title}</span>
        <span class="style-desc">${style.desc}</span>
      </span>
      <span class="style-check">
        <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
      </span>`;
    card.addEventListener('click', () => {
      selectedStyle = style.id;
      [...styleGrid.children].forEach((c) => c.classList.remove('active'));
      card.classList.add('active');
      showStyleDetail(style);
      updateRenderAvailability();
    });
    styleGrid.appendChild(card);
  });

  // ---- render button availability ----------------------------------
  const renderBtn = document.getElementById('renderBtn');
  function updateRenderAvailability() {
    renderBtn.disabled = !selectedStyle || !drawing.hasDrawing();
  }
  updateRenderAvailability();

  // ---- render flow (talks to backend, never to OpenAI directly) ------
  const resultOverlay = document.getElementById('resultOverlay');
  const originalPreview = document.getElementById('originalPreview');
  const renderedPreview = document.getElementById('renderedPreview');
  const loadingState = document.getElementById('loadingState');
  const errorState = document.getElementById('errorState');
  const errorMessage = document.getElementById('errorMessage');
  const downloadBtn = document.getElementById('downloadBtn');
  const extraInstructions = document.getElementById('extraInstructions');

  renderBtn.addEventListener('click', async () => {
    if (renderBtn.disabled) return;

    const originalDataUrl = drawing.toDataURL();
    originalPreview.src = originalDataUrl;

    renderedPreview.hidden = true;
    errorState.hidden = true;
    loadingState.hidden = false;
    downloadBtn.disabled = true;
    resultOverlay.classList.add('open');

    try {
      const res = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: originalDataUrl,
          style: selectedStyle,
          instructions: extraInstructions.value.trim(),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Server responded with ${res.status}`);
      }

      renderedPreview.src = data.imageBase64;
      renderedPreview.hidden = false;
      loadingState.hidden = true;
      downloadBtn.disabled = false;
    } catch (err) {
      errorMessage.textContent = err.message || 'Something went wrong while rendering. Please try again.';
      errorState.hidden = false;
      loadingState.hidden = true;
    }
  });

  document.getElementById('closeResult').addEventListener('click', () => {
    resultOverlay.classList.remove('open');
  });
  document.getElementById('editAgainBtn').addEventListener('click', () => {
    resultOverlay.classList.remove('open');
  });

  downloadBtn.addEventListener('click', () => {
    if (!renderedPreview.src) return;
    const a = document.createElement('a');
    a.href = renderedPreview.src;
    a.download = 'imagineai-render.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
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
})();
