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
    },
    {
      id: 'oil_masters', title: 'Dramatic Oil Painting', desc: 'Classic chiaroscuro painting',
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
    },
  ];

  // ---- state --------------------------------------------------------
  let selectedStyle = null;
  let selectedEngine = 'fast';

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
  const customPalette = document.getElementById('customPalette');
  const paletteSaveBtn = document.getElementById('paletteSaveBtn');

  const PALETTE_SIZE = 6;
  const PALETTE_KEY = 'imagineai.customPalette';
  let activeColor = '#7c5cff';

  function selectColor(hex, swatchEl) {
    activeColor = hex;
    drawing.setColor(hex);
    eraserBtn.classList.remove('active');
    drawing.setEraser(false);
    // Clear active state across both preset swatches and custom palette slots.
    document.querySelectorAll('#colorSwatches .swatch, #customPalette .swatch')
      .forEach((c) => c.classList.remove('active'));
    if (swatchEl) swatchEl.classList.add('active');
    customColor.value = hex;
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
  const loadingSubtext = document.getElementById('loadingSubtext');

  renderBtn.addEventListener('click', async () => {
    if (renderBtn.disabled) return;

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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: originalDataUrl,
          style: selectedStyle,
          instructions: extraInstructions.value.trim(),
          engine: selectedEngine,
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
    if (!renderedPreview.src || downloadBtn.disabled) return;
    const a = document.createElement('a');
    a.href = renderedPreview.src;
    a.download = 'imagineai-render.png';
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
})();
