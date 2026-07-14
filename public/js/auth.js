/**
 * auth.js
 *
 * Google sign-in via Supabase. Loaded before app.js.
 *
 * Drawing, tracing and downloading stay completely anonymous and free — this
 * module only powers the account pill in the top bar (and, later, the credits
 * that will gate the Render button). No secrets live here: the anon key below
 * is a *public* key, safe to ship in the browser.
 *
 * Exposes window.Auth for the rest of the app.
 */
(function () {
  const SUPABASE_URL = 'https://phcbyouccxunyavzzwrf.supabase.co';
  // Supabase → Settings → API → Project API keys → the `anon` `public` one.
  // This is meant to be public; it is NOT the service_role key.
  const SUPABASE_ANON_KEY = 'sb_publishable_y16rq43HiCYrgfogYoIfZw_5R_KnMu6';

  // The UMD build (loaded via <script>) exposes a global `supabase` object
  // with createClient on it. We name our client `sb` to avoid the clash.
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  let currentUser = null;
  const listeners = [];
  function notify() { listeners.forEach((fn) => fn(currentUser)); }

  // NOTE: deliberately not async. The window MUST be opened synchronously,
  // while we're still inside the user's click/tap — iOS Safari blocks
  // window.open once anything has been awaited, which would silently drop us
  // to a full-page redirect. So we open a blank window first, then point it at
  // Google when the URL comes back.
  function signInWithGoogle() {
    const w = 500;
    const h = 650;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    const popup = window.open(
      'about:blank',
      'imagineai-google-signin',
      `width=${w},height=${h},left=${left},top=${top}`
    );

    // The window lands on /auth-callback.html, which completes the sign-in and
    // closes itself; the session lands in localStorage, which this window
    // picks up via onAuthStateChange (fires across windows on the same origin).
    sb.auth
      .signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth-callback.html`,
          skipBrowserRedirect: true, // give us the URL instead of navigating away
        },
      })
      .then(({ data, error }) => {
        if (error || !data || !data.url) {
          console.error('[auth] sign-in failed:', error && error.message);
          if (popup) popup.close();
          return;
        }
        if (popup && !popup.closed) {
          popup.location.href = data.url;
        } else {
          // Popup was blocked outright — fall back to a full-page redirect.
          window.location.href = data.url;
        }
      });
  }

  async function signOut() {
    await sb.auth.signOut();
  }

  // The bearer token to send to our own backend so it can verify who's calling.
  async function getToken() {
    const { data } = await sb.auth.getSession();
    return data.session ? data.session.access_token : null;
  }

  // Read the signed-in user's token balance (RLS lets them read only their own
  // row) and push it into the pill. Called on sign-in and after each render.
  async function refreshTokens() {
    if (!currentUser) { setTokens(null); return; }
    const { data, error } = await sb
      .from('profiles')
      .select('tokens')
      .eq('id', currentUser.id)
      .single();
    setTokens(error ? null : data.tokens);
  }

  // Fires once on load with any restored session, and again on every
  // sign-in / sign-out (including when the sign-in popup writes the session
  // to localStorage — that propagates to this window on the same origin).
  sb.auth.onAuthStateChange((_event, session) => {
    currentUser = session ? session.user : null;
    notify();
    refreshTokens();
  });

  // Backup: the sign-in popup posts this when it finishes, in case the
  // cross-window storage event doesn't fire. Re-read the session explicitly.
  window.addEventListener('message', async (e) => {
    if (e.origin !== window.location.origin || e.data !== 'imagineai-auth-done') return;
    const { data } = await sb.auth.getSession();
    currentUser = data.session ? data.session.user : null;
    notify();
    refreshTokens();
  });

  window.Auth = {
    client: sb,
    signInWithGoogle,
    signOut,
    getToken,
    getUser: () => currentUser,
    refreshTokens,
    // Register a callback; it's invoked immediately with the current state.
    onChange: (fn) => { listeners.push(fn); fn(currentUser); },
  };

  // ---- top-bar account pill -------------------------------------------
  const accountBtn = document.getElementById('accountBtn');
  const accountLabel = document.getElementById('accountLabel');
  const accountMenu = document.getElementById('accountMenu');
  const accountEmail = document.getElementById('accountEmail');
  const accountSignout = document.getElementById('accountSignout');
  const tokenBalance = document.getElementById('tokenBalance');

  // Set the token balance shown in the menu (em-dash when unknown/signed out).
  // Declared as a function so refreshTokens() above can call it by name.
  function setTokens(n) {
    tokenBalance.textContent = (n === null || n === undefined) ? '—' : n;
  }
  window.Auth.setTokens = setTokens;

  function closeMenu() { accountMenu.hidden = true; }

  // "Laurens D." from the Google profile, with graceful fallbacks.
  function displayName(user) {
    const m = user.user_metadata || {};
    let first = m.given_name;
    let last = m.family_name;
    // Some providers only give a single `full_name`/`name` — split that.
    if (!first && (m.full_name || m.name)) {
      const parts = (m.full_name || m.name).trim().split(/\s+/);
      first = parts[0];
      last = parts.length > 1 ? parts[parts.length - 1] : '';
    }
    if (first) return last ? `${first} ${last[0]}.` : first;
    return user.email || 'Account'; // last resort
  }

  accountBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentUser) {
      accountMenu.hidden = !accountMenu.hidden; // toggle the sign-out menu
    } else {
      signInWithGoogle();
    }
  });

  accountSignout.addEventListener('click', () => { signOut(); closeMenu(); });

  // Click anywhere else closes the menu.
  document.addEventListener('click', (e) => {
    if (!accountMenu.hidden && !e.target.closest('.account')) closeMenu();
  });

  window.Auth.onChange((user) => {
    if (user) {
      accountLabel.textContent = displayName(user);
      accountEmail.textContent = user.email || '';
      accountBtn.title = 'Account';
    } else {
      accountLabel.textContent = 'Sign in';
      accountBtn.title = 'Sign in with Google';
      closeMenu();
    }
  });
})();
