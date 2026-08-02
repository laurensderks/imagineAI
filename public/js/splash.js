/**
 * splash.js
 *
 * Welcome overlay shown on load. The point it makes is the product's whole
 * premise: a real sketch on the left, what Inkmagik turned it into on the
 * right, cycling through the styles — so a visitor understands in two seconds
 * that the input is a drawing, not a typed prompt.
 *
 * The sketch is fixed; only the render tile changes. Each style also tints an
 * ambient blurred wash behind everything, reusing the same (cached) image.
 *
 * Images are loaded lazily — all nine together are ~800 KB, which is a poor
 * trade for a screen most people dismiss in a few seconds. Only the first is
 * fetched up front; the rest are pulled in one step ahead of being shown.
 */

(function () {
  const splash = document.getElementById('splash');
  if (!splash) return;

  const render = document.getElementById('revealRender');
  const glow = document.getElementById('splashGlow');
  const styleLabel = document.getElementById('revealStyle');
  if (!render || !glow || !styleLabel) return;

  const STYLES = [
    { file: 'photo', name: 'Photorealistic' },
    { file: 'cartoon', name: 'Cartoon' },
    { file: 'watercolour', name: 'Watercolour' },
    { file: 'pencil', name: 'Pencil' },
    { file: 'oil', name: 'Oil Painting' },
    { file: 'pixel', name: 'Pixel Art' },
    { file: 'fantasy', name: 'Fantasy' },
    { file: 'papercraft', name: 'Paper Craft' },
  ];

  // Shuffle so the opening style varies between visits.
  for (let i = STYLES.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [STYLES[i], STYLES[j]] = [STYLES[j], STYLES[i]];
  }

  const url = (s) => `img/splash/${s.file}.webp`;

  // One empty layer per style in each container; filling in the background
  // image is what actually triggers the download, so it is deferred.
  const renderLayers = [];
  const glowLayers = [];
  STYLES.forEach(() => {
    const r = document.createElement('div');
    render.appendChild(r);
    renderLayers.push(r);
    const g = document.createElement('div');
    glow.appendChild(g);
    glowLayers.push(g);
  });

  const loaded = new Set();
  function ensureLoaded(i) {
    if (loaded.has(i)) return;
    loaded.add(i);
    const src = url(STYLES[i]);
    renderLayers[i].style.backgroundImage = `url("${src}")`;
    glowLayers[i].style.backgroundImage = `url("${src}")`;
  }

  let idx = 0;
  ensureLoaded(0);
  renderLayers[0].classList.add('show');
  glowLayers[0].classList.add('show');
  styleLabel.textContent = STYLES[0].name;
  ensureLoaded(1); // one ahead, so the first transition is never a blank tile

  const timer = setInterval(() => {
    renderLayers[idx].classList.remove('show');
    glowLayers[idx].classList.remove('show');
    idx = (idx + 1) % STYLES.length;
    ensureLoaded(idx);
    renderLayers[idx].classList.add('show');
    glowLayers[idx].classList.add('show');
    styleLabel.textContent = STYLES[idx].name;
    ensureLoaded((idx + 1) % STYLES.length); // stay one ahead
  }, 3200);

  let dismissed = false;
  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    clearInterval(timer);
    splash.classList.add('hide');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => splash.remove(), 500); // after the fade-out transition
  }
  function onKey(e) {
    if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') dismiss();
  }

  document.getElementById('splashEnter').addEventListener('click', dismiss);
  document.addEventListener('keydown', onKey);
})();
