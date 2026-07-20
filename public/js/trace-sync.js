/**
 * trace-sync.js
 *
 * Cross-device trace images for signed-in users. The browser already holds the
 * reference photo, so it uploads straight to Supabase Storage (private bucket,
 * RLS own-folder only) plus a small geometry row — no server round-trip. A
 * trace placed on one device then loads on another after sign-in.
 *
 * Anonymous users don't sync; trace still works locally for them, so this is
 * purely additive. Exposes window.TraceSync.
 */
(function () {
  const BUCKET = 'traces';
  const TABLE = 'page_traces';
  const SIGNED_TTL = 60 * 60; // seconds
  const PUSH_DEBOUNCE = 800;  // geometry drags fire fast; batch them

  // The image src already known to be in the cloud for each page, so a geometry
  // tweak doesn't re-upload the same photo. A pulled signed URL counts as
  // "already there".
  const uploadedSrc = [null, null, null, null];
  const pushTimers = [null, null, null, null];

  function sb() { return window.Auth && window.Auth.client; }
  function uid() {
    const u = window.Auth && window.Auth.getUser();
    return u ? u.id : null;
  }

  function dataUrlToBlob(dataUrl) {
    const [head, body] = dataUrl.split(',');
    const mime = (head.match(/data:(.*?);/) || [])[1] || 'image/jpeg';
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  // Everything about placement — but not the image bytes, which live in Storage.
  function geometryOf(s) {
    return {
      baseW: s.baseW, cx: s.cx, cy: s.cy,
      scale: s.scale, rotation: s.rotation,
      opacity: s.opacity, locked: s.locked,
    };
  }

  async function doPush(page, state) {
    const id = uid();
    if (!id || !state) return;
    const client = sb();
    const path = `${id}/${page}.jpg`;

    // Upload the image only when it's a freshly-picked local one (a data: URL)
    // not already stored. Pulled images arrive as https signed URLs and are
    // already in the bucket, so they skip this and only their geometry updates.
    if (typeof state.src === 'string' &&
        state.src.startsWith('data:') &&
        state.src !== uploadedSrc[page]) {
      const { error } = await client.storage.from(BUCKET)
        .upload(path, dataUrlToBlob(state.src), { upsert: true, contentType: 'image/jpeg' });
      if (error) { console.error('[trace-sync] upload failed:', error.message); return; }
      uploadedSrc[page] = state.src;
    }

    const { error } = await client.from(TABLE).upsert({
      user_id: id,
      page_index: page,
      geometry: geometryOf(state),
      updated_at: new Date().toISOString(),
    });
    if (error) console.error('[trace-sync] row upsert failed:', error.message);
  }

  window.TraceSync = {
    push(page, state) {
      if (!uid() || !state) return;
      clearTimeout(pushTimers[page]);
      pushTimers[page] = setTimeout(() => doPush(page, state), PUSH_DEBOUNCE);
    },

    async remove(page) {
      const id = uid();
      if (!id) return;
      clearTimeout(pushTimers[page]);
      uploadedSrc[page] = null;
      const client = sb();
      try {
        await client.storage.from(BUCKET).remove([`${id}/${page}.jpg`]);
        await client.from(TABLE).delete().eq('user_id', id).eq('page_index', page);
      } catch (err) {
        console.error('[trace-sync] remove failed:', err.message);
      }
    },

    // All 4 pages' traces for the signed-in user, as an array[4] of trace states
    // (or null). Used on sign-in for the cross-device load.
    async pullAll() {
      const id = uid();
      const out = [null, null, null, null];
      if (!id) return out;
      const client = sb();
      const { data: rows, error } = await client.from(TABLE)
        .select('page_index, geometry').eq('user_id', id);
      if (error || !rows || !rows.length) return out;

      for (const row of rows) {
        const page = row.page_index;
        if (page < 0 || page > 3) continue;
        const { data: signed } = await client.storage.from(BUCKET)
          .createSignedUrl(`${id}/${page}.jpg`, SIGNED_TTL);
        if (!signed || !signed.signedUrl) continue;
        out[page] = { ...row.geometry, src: signed.signedUrl };
        uploadedSrc[page] = signed.signedUrl; // already stored → don't re-upload
      }
      return out;
    },
  };
})();
