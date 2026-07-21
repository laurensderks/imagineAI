/**
 * onboarding.js
 *
 * A one-time, 3-step coach tour that introduces the Layers feature the first
 * time someone opens the app. It spotlights the Layers panel and steps through
 * what layers are, switching between them, and clearing a single layer — then
 * never shows again (a flag in localStorage).
 *
 * It touches nothing in the drawing engine: it's a self-contained overlay that
 * highlights existing UI. On narrow screens (iPad portrait) the left tool panel
 * is off-canvas, so the tour opens it for the duration.
 */

(function () {
  const KEY = 'inkmagik.onboarded.layers';
  if (localStorage.getItem(KEY)) return;

  const steps = [
    {
      title: 'Draw in layers',
      body: 'Your picture can sit on three sheets — <b>Foreground</b>, <b>Middle</b> and ' +
            '<b>Background</b>. Tap a sheet to choose where your brush draws.',
      target: () => document.getElementById('layerList') &&
        document.getElementById('layerList').closest('.panel-section'),
    },
    {
      title: 'Each sheet is its own',
      body: 'Switch sheets whenever you like — your brush, colour and size stay the same. ' +
            'The little preview shows what’s on each one.',
      target: () => document.getElementById('layerList'),
    },
    {
      title: 'Clear one sheet',
      body: 'Made a mess on a layer? Tap its bin to clear <b>just that sheet</b> — the ' +
            'others stay exactly as they are.',
      target: () => document.querySelector('.layer-clear'),
    },
  ];

  let i = 0;
  let els = null;
  let openedPanel = false;
  let panelScroll = null;   // the left panel's scroll container
  let startScrollTop = 0;   // where it sat before the tour moved it

  whenSplashGone(start);

  // Hold the tour until the welcome splash has been dismissed.
  function whenSplashGone(cb) {
    const gone = () => {
      const s = document.getElementById('splash');
      return !s || s.classList.contains('hide');
    };
    if (gone()) { setTimeout(cb, 350); return; }
    const obs = new MutationObserver(() => {
      if (gone()) { obs.disconnect(); setTimeout(cb, 350); }
    });
    obs.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['class'],
    });
  }

  const isMobile = () => window.matchMedia('(max-width: 900px)').matches;

  function start() {
    if (!document.getElementById('layerList')) return; // nothing to point at

    // Remember the panel's scroll position so we can put it back afterwards —
    // spotlighting Layers scrolls the panel and would otherwise leave Trace
    // (the top section) hidden once the tour ends.
    const panel = document.getElementById('leftPanel');
    panelScroll = panel && panel.querySelector('.panel-scroll');
    startScrollTop = panelScroll ? panelScroll.scrollTop : 0;

    // On narrow layouts the left panel is off-canvas — open it for the tour.
    if (isMobile()) {
      const scrim = document.getElementById('scrim');
      if (panel && !panel.classList.contains('open')) {
        panel.classList.add('open');
        if (scrim) scrim.classList.add('open');
        openedPanel = true;
      }
    }

    build();
    // let an opened panel finish sliding in before we measure
    setTimeout(() => show(0), openedPanel ? 320 : 0);
    window.addEventListener('resize', reposition);
  }

  function build() {
    const root = document.createElement('div');
    root.id = 'tour';
    root.innerHTML =
      '<div class="tour-block"></div>' +
      '<div class="tour-hole" id="tourHole"></div>' +
      '<div class="tour-card" id="tourCard">' +
        '<span class="tour-badge">' +
          '<svg viewBox="0 0 24 24"><path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5"/>' +
          '<path d="M3 16l9 5 9-5"/></svg> New · Layers</span>' +
        '<h4 id="tourTitle"></h4>' +
        '<p id="tourBody"></p>' +
        '<div class="tour-foot">' +
          '<div class="tour-dots" id="tourDots"></div>' +
          '<div class="tour-actions">' +
            '<button class="tour-btn tour-skip" id="tourSkip" type="button">Skip</button>' +
            '<button class="tour-btn tour-back" id="tourBack" type="button">Back</button>' +
            '<button class="tour-btn tour-next" id="tourNext" type="button">Next</button>' +
          '</div>' +
        '</div>' +
        '<div class="tour-arrow" id="tourArrow"></div>' +
      '</div>';
    document.body.appendChild(root);

    els = {
      root,
      hole: root.querySelector('#tourHole'),
      card: root.querySelector('#tourCard'),
      title: root.querySelector('#tourTitle'),
      body: root.querySelector('#tourBody'),
      dots: root.querySelector('#tourDots'),
      back: root.querySelector('#tourBack'),
      next: root.querySelector('#tourNext'),
      skip: root.querySelector('#tourSkip'),
      arrow: root.querySelector('#tourArrow'),
    };
    els.dots.innerHTML = steps.map(() => '<span class="tour-dot"></span>').join('');
    els.skip.addEventListener('click', finish);
    els.back.addEventListener('click', () => show(i - 1));
    els.next.addEventListener('click', () => (i >= steps.length - 1 ? finish() : show(i + 1)));
  }

  function show(n) {
    i = Math.max(0, Math.min(steps.length - 1, n));
    const step = steps[i];
    els.title.innerHTML = step.title;
    els.body.innerHTML = step.body;
    els.back.style.visibility = i === 0 ? 'hidden' : 'visible';
    els.next.textContent = i === steps.length - 1 ? 'Got it' : 'Next';
    [...els.dots.children].forEach((d, k) => d.classList.toggle('on', k === i));

    const t = step.target && step.target();
    if (t && t.scrollIntoView) t.scrollIntoView({ block: 'center', inline: 'nearest' });
    requestAnimationFrame(reposition);
  }

  function reposition() {
    if (!els) return;
    const t = steps[i].target && steps[i].target();
    const { hole, card, arrow } = els;
    const vw = window.innerWidth, vh = window.innerHeight;

    if (!t) { // no target — centre the card, hide the spotlight
      hole.style.display = 'none';
      arrow.style.display = 'none';
      card.style.left = Math.round((vw - card.offsetWidth) / 2) + 'px';
      card.style.top = Math.round((vh - card.offsetHeight) / 2) + 'px';
      return;
    }

    const r = t.getBoundingClientRect();
    const pad = 8;
    hole.style.display = 'block';
    hole.style.left = (r.left - pad) + 'px';
    hole.style.top = (r.top - pad) + 'px';
    hole.style.width = (r.width + pad * 2) + 'px';
    hole.style.height = (r.height + pad * 2) + 'px';

    const gap = 16;
    const cw = card.offsetWidth, ch = card.offsetHeight;

    // Prefer beside the target (desktop); otherwise centre horizontally and go
    // below the target (or above if there isn't room).
    if (!isMobile() && r.right + gap + cw <= vw) {
      const left = r.right + gap;
      const top = Math.min(Math.max(12, r.top - 4), vh - ch - 12);
      card.style.left = Math.round(left) + 'px';
      card.style.top = Math.round(top) + 'px';
      arrow.style.display = 'block';
      const ay = Math.min(Math.max(16, r.top + r.height / 2 - top), ch - 16);
      arrow.style.top = Math.round(ay) + 'px';
    } else {
      const left = Math.max(12, Math.min(vw - cw - 12, (vw - cw) / 2));
      const top = (r.bottom + gap + ch <= vh)
        ? r.bottom + gap
        : Math.max(12, r.top - gap - ch);
      card.style.left = Math.round(left) + 'px';
      card.style.top = Math.round(top) + 'px';
      arrow.style.display = 'none';
    }
  }

  function finish() {
    try { localStorage.setItem(KEY, '1'); } catch (_) { /* ignore */ }
    window.removeEventListener('resize', reposition);
    if (els && els.root) els.root.remove();
    els = null;

    // Put the panel back where it was so the Trace section is visible again.
    if (panelScroll) {
      try { panelScroll.scrollTo({ top: startScrollTop, behavior: 'smooth' }); }
      catch (_) { panelScroll.scrollTop = startScrollTop; }
    }

    if (openedPanel) {
      const panel = document.getElementById('leftPanel');
      const scrim = document.getElementById('scrim');
      if (panel) panel.classList.remove('open');
      if (scrim) scrim.classList.remove('open');
    }
  }
})();
