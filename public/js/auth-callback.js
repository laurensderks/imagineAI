/**
 * auth-callback.js
 *
 * Runs only on auth-callback.html — the popup Google returns to. Creating the
 * client auto-detects the ?code in the URL and exchanges it for a session
 * (stored in localStorage, shared with the app on the same origin).
 *
 * In its own file rather than inline because the Content-Security-Policy
 * allows no inline scripts; an inline block would silently never run and
 * sign-in would hang on the spinner.
 */
(function () {
  const sb = window.supabase.createClient(
    'https://phcbyouccxunyavzzwrf.supabase.co',
    'sb_publishable_y16rq43HiCYrgfogYoIfZw_5R_KnMu6'
  );

  function finish() {
    try {
      if (window.opener) {
        window.opener.postMessage('inkmagik-auth-done', window.location.origin);
      }
    } catch (_) { /* ignore */ }
    window.close();
    // If the browser refused to close the window, send the user back to the app.
    setTimeout(() => { window.location.replace('/'); }, 400);
  }

  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN') finish();
  });

  // Fallback in case the session is already established by the time we listen.
  sb.auth.getSession().then(({ data }) => { if (data.session) finish(); });
})();
