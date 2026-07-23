/**
 * gallery.js
 *
 * "My gallery" — the last few renders saved to the signed-in user's account.
 * The server uploads each successful render to Supabase Storage and prunes
 * anything past the newest 5, so this only ever reads.
 *
 * Files live in a private bucket, so thumbnails are shown via short-lived
 * signed URLs rather than public links.
 */
(function () {
  const SIGNED_URL_TTL = 60 * 60; // seconds

  const galleryOverlay = document.getElementById('galleryOverlay');
  const galleryGrid = document.getElementById('galleryGrid');
  const galleryMsg = document.getElementById('galleryMsg');
  const galleryNote = document.querySelector('.gallery-note');

  const viewerOverlay = document.getElementById('viewerOverlay');
  const viewerImg = document.getElementById('viewerImg');
  const viewerDownload = document.getElementById('viewerDownload');

  let currentUrl = null; // signed URL of the image open in the viewer

  // `action` is optional: { label, onClick }. It renders a button under the
  // message, so the signed-out state can start sign-in right here instead of
  // sending people back out to the top bar to find the button.
  function showMessage(text, action) {
    galleryMsg.textContent = text;
    galleryMsg.hidden = !text;
    galleryNote.hidden = !!text; // hide the storage note when there's nothing to show
    if (!action) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gallery-msg-btn';
    btn.textContent = action.label;
    // Bound straight to the handler, not wrapped in anything async: the
    // sign-in popup has to open inside the tap or iOS Safari blocks it.
    btn.addEventListener('click', action.onClick);
    galleryMsg.appendChild(btn);
  }

  async function loadGallery() {
    galleryGrid.innerHTML = '';
    const user = window.Auth && window.Auth.getUser();
    if (!user) {
      showMessage('Sign in to see your gallery.', {
        label: 'Sign in with Google',
        onClick: () => window.Auth && window.Auth.signInWithGoogle(),
      });
      return;
    }

    showMessage('Loading your renders…');
    const sb = window.Auth.client;

    // pruned rows are history-only: the row is kept for analytics but the file
    // has been deleted, so they must never reach the grid.
    let { data: rows, error } = await sb
      .from('renders')
      .select('id, path, style, created_at')
      .eq('pruned', false)
      .order('created_at', { ascending: false })
      .limit(5);

    // The `pruned` column is added by analytics.sql. If that migration hasn't
    // been run yet the filter errors (42703) — fall back to no filter, since
    // nothing can be pruned until the column exists anyway.
    if (error && error.code === '42703') {
      ({ data: rows, error } = await sb
        .from('renders')
        .select('id, path, style, created_at')
        .order('created_at', { ascending: false })
        .limit(5));
    }

    if (error) {
      showMessage('Could not load your gallery. Please try again.');
      return;
    }
    if (!rows.length) {
      showMessage('No renders yet — render a drawing and it will appear here.');
      return;
    }

    // Private bucket: mint short-lived signed URLs for the thumbnails.
    const { data: signed, error: signErr } = await sb.storage
      .from('renders')
      .createSignedUrls(rows.map((r) => r.path), SIGNED_URL_TTL);

    if (signErr) {
      showMessage('Could not load your images. Please try again.');
      return;
    }

    showMessage('');
    rows.forEach((row, i) => {
      const url = signed[i] && signed[i].signedUrl;
      if (!url) return;

      const tile = document.createElement('button');
      tile.className = 'gallery-tile';
      tile.type = 'button';
      tile.title = 'View larger';

      const img = document.createElement('img');
      img.src = url;
      img.alt = row.style ? `${row.style} render` : 'Rendered artwork';
      img.loading = 'lazy';
      tile.appendChild(img);

      const when = document.createElement('span');
      when.className = 'gallery-tile-date';
      when.textContent = new Date(row.created_at).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
      });
      tile.appendChild(when);

      tile.addEventListener('click', () => openViewer(url));
      galleryGrid.appendChild(tile);
    });
  }

  function openViewer(url) {
    currentUrl = url;
    viewerImg.src = url;
    galleryOverlay.classList.remove('open');
    viewerOverlay.classList.add('open');
  }

  // Fetch as a blob so the file downloads instead of opening in a new tab
  // (the `download` attribute is ignored for cross-origin URLs).
  async function downloadCurrent() {
    if (!currentUrl) return;
    try {
      const res = await fetch(currentUrl);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = 'inkmagik-render.png';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(objectUrl);
      }, 150);
    } catch (err) {
      console.error('[gallery] download failed:', err);
    }
  }

  // ---- "new render" dot ------------------------------------------------
  // The dot means: there is something in your gallery newer than the last time
  // you opened it. The marker is per-device on purpose — render on the iPad and
  // the dot is waiting for you on the PC.
  const SEEN_KEY = 'inkmagik.gallerySeen';
  const galleryBtn = document.getElementById('galleryBtn');

  function setDot(on) {
    galleryBtn.classList.toggle('has-new', on);
    // Not colour alone: the label carries it too, for screen readers and for
    // anyone who can't distinguish the dot.
    galleryBtn.title = on ? 'My gallery — new render' : 'My gallery';
    galleryBtn.setAttribute('aria-label', galleryBtn.title);
  }

  async function refreshDot() {
    const user = window.Auth && window.Auth.getUser();
    if (!user) return setDot(false);
    try {
      const { data, error } = await window.Auth.client
        .from('renders')
        .select('created_at')
        .eq('pruned', false)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error || !data || !data.length) return setDot(false);
      const newest = new Date(data[0].created_at).getTime();
      const seen = Number(localStorage.getItem(SEEN_KEY) || 0);
      setDot(newest > seen);
    } catch (_) {
      setDot(false);
    }
  }

  function markSeen() {
    localStorage.setItem(SEEN_KEY, String(Date.now()));
    setDot(false);
  }

  window.Gallery = { refreshDot };
  if (window.Auth) window.Auth.onChange(() => refreshDot());

  document.getElementById('galleryBtn').addEventListener('click', () => {
    galleryOverlay.classList.add('open');
    markSeen();
    loadGallery();
  });
  document.getElementById('closeGallery').addEventListener('click', () => {
    galleryOverlay.classList.remove('open');
  });

  // Signing in from the prompt above happens in a popup, so this window never
  // reloads — without this the gallery would keep showing "Sign in to see your
  // gallery" to someone who just did exactly that.
  if (window.Auth && window.Auth.client) {
    window.Auth.client.auth.onAuthStateChange((_event, session) => {
      if (session && galleryOverlay.classList.contains('open')) loadGallery();
    });
  }
  document.getElementById('closeViewer').addEventListener('click', () => {
    viewerOverlay.classList.remove('open');
  });
  document.getElementById('backToGallery').addEventListener('click', () => {
    viewerOverlay.classList.remove('open');
    galleryOverlay.classList.add('open');
  });
  viewerDownload.addEventListener('click', downloadCurrent);
})();
