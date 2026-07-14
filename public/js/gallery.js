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

  function showMessage(text) {
    galleryMsg.textContent = text;
    galleryMsg.hidden = !text;
    galleryNote.hidden = !!text; // hide the storage note when there's nothing to show
  }

  async function loadGallery() {
    galleryGrid.innerHTML = '';
    const user = window.Auth && window.Auth.getUser();
    if (!user) {
      showMessage('Sign in to see your gallery.');
      return;
    }

    showMessage('Loading your renders…');
    const sb = window.Auth.client;

    const { data: rows, error } = await sb
      .from('renders')
      .select('id, path, style, created_at')
      .order('created_at', { ascending: false })
      .limit(5);

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
      a.download = 'imagineai-render.png';
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

  document.getElementById('galleryBtn').addEventListener('click', () => {
    galleryOverlay.classList.add('open');
    loadGallery();
  });
  document.getElementById('closeGallery').addEventListener('click', () => {
    galleryOverlay.classList.remove('open');
  });
  document.getElementById('closeViewer').addEventListener('click', () => {
    viewerOverlay.classList.remove('open');
  });
  document.getElementById('backToGallery').addEventListener('click', () => {
    viewerOverlay.classList.remove('open');
    galleryOverlay.classList.add('open');
  });
  viewerDownload.addEventListener('click', downloadCurrent);
})();
