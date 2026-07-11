/**
 * splash.js
 *
 * Welcome overlay shown on load: cross-dissolves through the render-style
 * images (one every 3s, looping) behind the intro text, until the user taps
 * "Start creating" (or presses Enter/Esc). Runs standalone before app.js.
 *
 * Each slide is shown twice, in sync: a sharp, centred "contain" copy (the
 * whole artwork, never cropped) over a blurred, enlarged "cover" copy that
 * fills the viewport behind it. Both layers fade together on every tick.
 */

(function () {
  const splash = document.getElementById('splash');
  if (!splash) return;
  const bg = document.getElementById('splashBg');
  const fg = document.getElementById('splashFg');

  const SLIDES = [
    'realistic', 'cartoon', 'water', 'pencil',
    'oil', 'minecraft', 'fantasy',
  ].map((id) => `img/splash/splash_${id}.webp`);

  // Shuffle so the opening image varies between visits.
  for (let i = SLIDES.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [SLIDES[i], SLIDES[j]] = [SLIDES[j], SLIDES[i]];
  }

  // One stacked layer per image in each container; the ".show" one is opaque,
  // the rest fade to 0, so advancing the active layer produces a cross-dissolve.
  function buildLayers(container, cls) {
    return SLIDES.map((src, i) => {
      const layer = document.createElement('div');
      layer.className = cls;
      layer.style.backgroundImage = `url("${src}")`;
      if (i === 0) layer.classList.add('show');
      container.appendChild(layer);
      return layer;
    });
  }
  const bgLayers = buildLayers(bg, 'splash-layer');    // blurred fill
  const fgLayers = buildLayers(fg, 'splash-fg-layer'); // sharp, centred

  let idx = 0;
  const timer = setInterval(() => {
    bgLayers[idx].classList.remove('show');
    fgLayers[idx].classList.remove('show');
    idx = (idx + 1) % SLIDES.length;
    bgLayers[idx].classList.add('show'); // both fade in together
    fgLayers[idx].classList.add('show');
  }, 3000);

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
