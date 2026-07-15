/**
 * analytics.js
 *
 * Reports the handful of things only the browser can see — chiefly anonymous
 * visitors, who never touch the database and would otherwise be invisible.
 * Everything else (renders, payments) is logged server-side where it can be
 * trusted.
 *
 * The server allowlists these event names, and no personal data is sent — just
 * what happened, plus the signed-in user's id if there is one.
 */
(function () {
  // Only sent if a session exists; anonymous visits are reported with no user,
  // which is the whole point of tracking them.
  async function track(event, meta) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      const token = window.Auth ? await window.Auth.getToken() : null;
      if (token) headers.Authorization = `Bearer ${token}`;
      await fetch('/api/event', {
        method: 'POST',
        headers,
        body: JSON.stringify({ event, meta: meta || null }),
        keepalive: true, // still sent if the page is closing
      });
    } catch (_) {
      // Analytics must never be load-bearing — swallow everything.
    }
  }

  window.Track = { event: track };

  // Top of funnel: every visit, signed in or not.
  track('app_opened', {
    referrer: document.referrer ? new URL(document.referrer).hostname : null,
    width: window.innerWidth,
  });

  // Did they actually draw, or just land and leave? Fires once per page load.
  let drew = false;
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (drew) return;
      if (!e.target.closest('#drawCanvas')) return;
      drew = true;
      track('drawing_started');
    },
    { capture: true }
  );

  document.getElementById('galleryBtn').addEventListener('click', () => track('gallery_opened'));
  document.getElementById('buyTokensBtn').addEventListener('click', () => track('buy_opened'));
})();
