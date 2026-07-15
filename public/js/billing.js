/**
 * billing.js
 *
 * Buying token packs via Stripe Checkout.
 *
 * The server creates the Checkout Session and hands back a URL; we just send
 * the browser there. Card details are only ever entered on Stripe's own page,
 * so nothing sensitive touches this app. Tokens are credited by the webhook on
 * the server, never by the browser — the client is not trusted with balances.
 */
(function () {
  const buyOverlay = document.getElementById('buyOverlay');
  const buyGrid = document.getElementById('buyGrid');
  const buyMsg = document.getElementById('buyMsg');
  const toast = document.getElementById('toast');

  let packs = null;

  function showMsg(text) {
    buyMsg.textContent = text;
    buyMsg.hidden = !text;
  }

  function showToast(text, ms = 4000) {
    toast.textContent = text;
    toast.hidden = false;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => { toast.hidden = true; }, 300);
    }, ms);
  }

  async function loadPacks() {
    if (packs) return packs;
    const res = await fetch('/api/packs');
    packs = await res.json();
    return packs;
  }

  async function openBuy() {
    buyOverlay.classList.add('open');
    showMsg('');
    showRedeemMsg('');

    if (!window.Auth || !window.Auth.getUser()) {
      buyGrid.innerHTML = '';
      showMsg('Sign in to buy tokens.');
      return;
    }

    const list = await loadPacks();
    buyGrid.innerHTML = '';
    list.forEach((p, i) => {
      const card = document.createElement('button');
      card.className = 'buy-pack';
      card.type = 'button';
      if (i === list.length - 1) card.classList.add('best'); // biggest pack
      card.innerHTML =
        `<span class="buy-pack-tokens">${p.tokens}</span>` +
        `<span class="buy-pack-label">tokens</span>` +
        `<span class="buy-pack-price">$${p.price}</span>`;
      if (i === list.length - 1) {
        const badge = document.createElement('span');
        badge.className = 'buy-pack-badge';
        badge.textContent = 'Best value';
        card.appendChild(badge);
      }
      card.addEventListener('click', () => startCheckout(p.id));
      buyGrid.appendChild(card);
    });
  }

  async function startCheckout(packId) {
    showMsg('Taking you to checkout…');
    [...buyGrid.querySelectorAll('button')].forEach((b) => (b.disabled = true));
    try {
      const token = await window.Auth.getToken();
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pack: packId }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || 'Could not start checkout.');
      window.location.href = data.url; // Stripe-hosted checkout
    } catch (err) {
      showMsg(err.message || 'Could not start checkout. Please try again.');
      [...buyGrid.querySelectorAll('button')].forEach((b) => (b.disabled = false));
    }
  }

  // ---- returning from Stripe -------------------------------------------
  // The webhook credits the tokens, and it may land a moment after the browser
  // gets back here — so poll briefly for the balance to change rather than
  // showing a stale number.
  async function handleReturn() {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('checkout');
    if (!status) return;

    // Tidy the URL so a refresh doesn't re-trigger this.
    window.history.replaceState({}, '', window.location.pathname);

    if (status === 'cancelled') {
      showToast('Checkout cancelled — no payment was taken.');
      return;
    }
    if (status !== 'success') return;

    showToast('Payment received — adding your tokens…', 8000);
    const before = window.Auth && window.Auth.getUser() ? await currentTokens() : null;
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const now = await currentTokens();
      if (now !== null && (before === null || now > before)) {
        if (window.Auth) window.Auth.refreshTokens();
        showToast(`Tokens added — you now have ${now}.`);
        return;
      }
    }
    showToast('Payment received. Your tokens will appear shortly.');
  }

  async function currentTokens() {
    const user = window.Auth && window.Auth.getUser();
    if (!user) return null;
    const { data, error } = await window.Auth.client
      .from('profiles')
      .select('tokens')
      .eq('id', user.id)
      .single();
    return error ? null : data.tokens;
  }

  // ---- gift codes -------------------------------------------------------
  // Redeeming runs entirely in Postgres (redeem_coupon), which checks expiry,
  // remaining uses and prior redemption atomically, and only ever credits the
  // caller's own account. The browser can't read the coupons table at all.
  const redeemInput = document.getElementById('redeemInput');
  const redeemBtn = document.getElementById('redeemBtn');
  const redeemMsg = document.getElementById('redeemMsg');

  const REDEEM_ERRORS = {
    not_signed_in: 'Sign in to redeem a code.',
    invalid: "That code isn't valid — check it and try again.",
    expired: 'That code has expired.',
    used_up: 'That code has already been used.',
    already_redeemed: "You've already redeemed that code.",
  };

  function showRedeemMsg(text, ok) {
    redeemMsg.textContent = text;
    redeemMsg.hidden = !text;
    redeemMsg.classList.toggle('ok', !!ok);
  }

  async function redeem() {
    const code = redeemInput.value.trim();
    if (!code) return;

    if (!window.Auth || !window.Auth.getUser()) {
      showRedeemMsg(REDEEM_ERRORS.not_signed_in, false);
      return;
    }

    redeemBtn.disabled = true;
    showRedeemMsg('Checking…', false);
    try {
      const { data, error } = await window.Auth.client.rpc('redeem_coupon', { p_code: code });
      if (error) throw new Error(error.message);

      if (!data || !data.ok) {
        showRedeemMsg(REDEEM_ERRORS[data && data.error] || 'Could not redeem that code.', false);
        return;
      }
      showRedeemMsg(`${data.tokens} tokens added.`, true);
      redeemInput.value = '';
      window.Auth.setTokens(data.balance);
      showToast(`Gift code redeemed — you now have ${data.balance} tokens.`);
    } catch (err) {
      showRedeemMsg('Could not redeem that code. Please try again.', false);
      console.error('[billing] redeem failed:', err);
    } finally {
      redeemBtn.disabled = false;
    }
  }

  redeemBtn.addEventListener('click', redeem);
  redeemInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); redeem(); }
  });

  document.getElementById('buyTokensBtn').addEventListener('click', openBuy);
  document.getElementById('closeBuy').addEventListener('click', () => {
    buyOverlay.classList.remove('open');
  });

  // Wait for auth to settle before checking a Stripe return, so we can read the
  // balance as the signed-in user.
  if (window.Auth) {
    window.Auth.onChange((user) => {
      if (user && !handleReturn._done) {
        handleReturn._done = true;
        handleReturn();
      }
    });
  }

  window.Billing = { openBuy };
})();
