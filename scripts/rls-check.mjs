/**
 * rls-check.mjs — "test as an attacker" harness for Inkmagik's Supabase rules.
 *
 * Signs nothing, guesses nothing: you hand it two real sessions and it tries,
 * as user B, to reach user A's rows and files. Every check states what it
 * expects and why, so a PASS means something.
 *
 * HOW TO GET THE TWO TOKENS
 *   1. Open https://inkmagik.app (or http://localhost:3000) in a normal window,
 *      sign in as account A, open DevTools → Console and run:
 *         await window.Auth.getToken()
 *   2. Do the same in a private/incognito window as account B.
 *   3. Run (tokens are ~1 hour, so grab both, then run straight away):
 *
 *      TOKEN_A=eyJ... TOKEN_B=eyJ... node scripts/rls-check.mjs
 *
 * Exits non-zero if any check fails, so it can gate a deploy.
 *
 * What it deliberately does NOT do: touch the service_role key. This is the
 * view from the browser, which is the view an attacker actually has.
 */

const SUPABASE_URL = 'https://phcbyouccxunyavzzwrf.supabase.co';
const ANON_KEY = 'sb_publishable_y16rq43HiCYrgfogYoIfZw_5R_KnMu6';

const TOKEN_A = process.env.TOKEN_A;
const TOKEN_B = process.env.TOKEN_B;

if (!TOKEN_A || !TOKEN_B) {
  console.error('Set TOKEN_A and TOKEN_B (see the comment at the top of this file).');
  process.exit(2);
}

// A 1x1 PNG — small enough to upload and delete without noise.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

const results = [];
function record(name, passed, detail) {
  results.push({ name, passed, detail });
  const mark = passed ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function headers(token, extra = {}) {
  const h = { apikey: ANON_KEY, ...extra };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function userId(token) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: headers(token) });
  if (!r.ok) throw new Error(`could not resolve user for a token: ${r.status}`);
  return (await r.json()).id;
}

// --- the checks ------------------------------------------------------------

async function run() {
  const idA = await userId(TOKEN_A);
  const idB = await userId(TOKEN_B);
  if (idA === idB) {
    console.error('TOKEN_A and TOKEN_B belong to the SAME account — the results would be meaningless.');
    process.exit(2);
  }
  console.log(`A = ${idA}\nB = ${idB}\n`);

  // Put a known file in A's folder so every "can B reach it?" check has a real,
  // known-good target rather than a guessed path.
  const probe = `${idA}/rls-probe-${Date.now()}.png`;
  const put = await fetch(`${SUPABASE_URL}/storage/v1/object/renders/${probe}`, {
    method: 'POST',
    headers: headers(TOKEN_A, { 'Content-Type': 'image/png' }),
    body: TINY_PNG,
  });
  record('A can upload into A\'s own folder', put.ok, put.ok ? probe : `HTTP ${put.status}`);
  if (!put.ok) {
    console.error('\nCannot continue without a probe file.');
    process.exit(1);
  }

  // 1. A can read it back. If this fails the rest proves nothing.
  const ownRead = await fetch(`${SUPABASE_URL}/storage/v1/object/renders/${probe}`, {
    headers: headers(TOKEN_A),
  });
  record('A can download A\'s own file', ownRead.ok, `HTTP ${ownRead.status}`);

  // 2. Anonymous download of a known path. The bucket is private, so knowing
  //    the exact path must not be enough.
  const anon = await fetch(`${SUPABASE_URL}/storage/v1/object/renders/${probe}`, {
    headers: headers(null),
  });
  record('Anonymous download of A\'s exact path is denied', !anon.ok, `HTTP ${anon.status}`);

  // 3. B downloads A's exact path — the core broken-object-level-auth test.
  const bRead = await fetch(`${SUPABASE_URL}/storage/v1/object/renders/${probe}`, {
    headers: headers(TOKEN_B),
  });
  record('B cannot download A\'s file', !bRead.ok, `HTTP ${bRead.status}`);

  // 4. B mints a signed URL for A's path. Denied at the signing step means the
  //    URL never exists to be leaked.
  const bSign = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/renders/${probe}`, {
    method: 'POST',
    headers: headers(TOKEN_B, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ expiresIn: 60 }),
  });
  record('B cannot sign a URL for A\'s file', !bSign.ok, `HTTP ${bSign.status}`);

  // 5. B lists A's folder. Enumeration is how an attacker finds paths at all.
  const bList = await fetch(`${SUPABASE_URL}/storage/v1/object/list/renders`, {
    method: 'POST',
    headers: headers(TOKEN_B, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefix: `${idA}/`, limit: 100 }),
  });
  const listed = bList.ok ? await bList.json() : [];
  record('B cannot list A\'s folder', !bList.ok || listed.length === 0,
    `HTTP ${bList.status}, ${listed.length} objects`);

  // 6. B deletes A's file. The honest assertion is not B's status code — it's
  //    whether the file is still there afterwards.
  await fetch(`${SUPABASE_URL}/storage/v1/object/renders/${probe}`, {
    method: 'DELETE',
    headers: headers(TOKEN_B),
  });
  const survived = await fetch(`${SUPABASE_URL}/storage/v1/object/renders/${probe}`, {
    headers: headers(TOKEN_A),
  });
  record('B cannot delete A\'s file', survived.ok,
    survived.ok ? 'file still there afterwards' : 'FILE IS GONE');

  // 7. Expired signed URLs stop working. Signed with 1s, then waited out.
  const sign = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/renders/${probe}`, {
    method: 'POST',
    headers: headers(TOKEN_A, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ expiresIn: 1 }),
  });
  if (sign.ok) {
    const { signedURL } = await sign.json();
    await new Promise((r) => setTimeout(r, 3000));
    const expired = await fetch(`${SUPABASE_URL}/storage/v1${signedURL}`);
    record('An expired signed URL is refused', !expired.ok, `HTTP ${expired.status}`);
  } else {
    record('An expired signed URL is refused', false, 'could not mint a test URL');
  }

  // 8. Upload type enforcement — the bucket allows images only.
  const badType = await fetch(`${SUPABASE_URL}/storage/v1/object/renders/${idB}/evil.html`, {
    method: 'POST',
    headers: headers(TOKEN_B, { 'Content-Type': 'text/html' }),
    body: '<script>alert(1)</script>',
  });
  record('A non-image upload is rejected', !badType.ok, `HTTP ${badType.status}`);

  // 9. Upload size enforcement — 12MB against a 10MB bucket limit.
  const big = Buffer.alloc(12 * 1024 * 1024, 1);
  const tooBig = await fetch(`${SUPABASE_URL}/storage/v1/object/renders/${idB}/big.png`, {
    method: 'POST',
    headers: headers(TOKEN_B, { 'Content-Type': 'image/png' }),
    body: big,
  });
  record('An oversized upload is rejected', !tooBig.ok, `HTTP ${tooBig.status}`);

  // --- database rows -------------------------------------------------------

  // 10. B reads A's render rows. RLS filters rather than errors, so an empty
  //     result is the pass and ANY row is the failure.
  const bRows = await fetch(
    `${SUPABASE_URL}/rest/v1/renders?user_id=eq.${idA}&select=id,path`,
    { headers: headers(TOKEN_B) }
  );
  const rows = bRows.ok ? await bRows.json() : [];
  record('B cannot read A\'s render rows', rows.length === 0, `${rows.length} rows`);

  // 11. B reads A's profile — this is the token balance and email.
  const bProfile = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${idA}&select=id,email,tokens`,
    { headers: headers(TOKEN_B) });
  const profiles = bProfile.ok ? await bProfile.json() : [];
  record('B cannot read A\'s profile', profiles.length === 0, `${profiles.length} rows`);

  // 12. Anonymous read of the whole renders table.
  const anonRows = await fetch(`${SUPABASE_URL}/rest/v1/renders?select=id`, { headers: headers(null) });
  const anonList = anonRows.ok ? await anonRows.json() : [];
  record('Anonymous cannot read the renders table', anonList.length === 0,
    `HTTP ${anonRows.status}, ${anonList.length} rows`);

  // 13. Nobody can read the coupon codes — they are free tokens in text form.
  const coupons = await fetch(`${SUPABASE_URL}/rest/v1/coupons?select=code`, { headers: headers(TOKEN_B) });
  const couponRows = coupons.ok ? await coupons.json() : [];
  record('B cannot read coupon codes', couponRows.length === 0,
    `HTTP ${coupons.status}, ${couponRows.length} rows`);

  // 14. B cannot write their own token balance. profiles has no write policy,
  //     so this must change nothing.
  const patch = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${idB}`, {
    method: 'PATCH',
    headers: headers(TOKEN_B, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({ tokens: 9999 }),
  });
  const patched = patch.ok ? await patch.json() : [];
  record('B cannot top up their own balance', patched.length === 0,
    `HTTP ${patch.status}, ${patched.length} rows changed`);

  // 15. spend_tokens must refuse a negative amount, which would ADD tokens.
  const negative = await fetch(`${SUPABASE_URL}/rest/v1/rpc/spend_tokens`, {
    method: 'POST',
    headers: headers(TOKEN_B, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ amount: -100 }),
  });
  const negResult = negative.ok ? await negative.json() : null;
  record('spend_tokens(-100) does not credit tokens', negResult === null,
    `returned ${JSON.stringify(negResult)}`);

  // 16. credit_tokens is service_role only — a user calling it directly would
  //     be able to mint themselves an unlimited balance.
  const credit = await fetch(`${SUPABASE_URL}/rest/v1/rpc/credit_tokens`, {
    method: 'POST',
    headers: headers(TOKEN_B, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ p_user: idB, p_amount: 100 }),
  });
  record('B cannot call credit_tokens', !credit.ok, `HTTP ${credit.status}`);

  // 17. B updates A's render row (e.g. re-pointing it at their own file).
  const aRowRes = await fetch(
    `${SUPABASE_URL}/rest/v1/renders?user_id=eq.${idA}&select=id&limit=1`,
    { headers: headers(TOKEN_A) }
  );
  const aRows = aRowRes.ok ? await aRowRes.json() : [];
  if (aRows.length) {
    const hijack = await fetch(`${SUPABASE_URL}/rest/v1/renders?id=eq.${aRows[0].id}`, {
      method: 'PATCH',
      headers: headers(TOKEN_B, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
      body: JSON.stringify({ style: 'hijacked' }),
    });
    const changed = hijack.ok ? await hijack.json() : [];
    record('B cannot modify A\'s render row', changed.length === 0, `${changed.length} rows changed`);
  } else {
    record('B cannot modify A\'s render row', true, 'skipped — A has no render rows');
  }

  // 18. The other side of the same coin: A's own UPDATE must work, or the
  //     server's prune step silently stops flagging rows as pruned.
  if (aRows.length) {
    const own = await fetch(`${SUPABASE_URL}/rest/v1/renders?id=eq.${aRows[0].id}`, {
      method: 'PATCH',
      headers: headers(TOKEN_A, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
      body: JSON.stringify({ style: null }),
    });
    const ownChanged = own.ok ? await own.json() : [];
    // Put the style back so this check leaves no trace.
    if (ownChanged.length) {
      await fetch(`${SUPABASE_URL}/rest/v1/renders?id=eq.${aRows[0].id}`, {
        method: 'PATCH',
        headers: headers(TOKEN_A, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
        body: JSON.stringify({ style: ownChanged[0].style }),
      });
    }
    record('A CAN update A\'s own render row (prune needs this)', ownChanged.length === 1,
      `${ownChanged.length} rows changed`);
  } else {
    record('A CAN update A\'s own render row (prune needs this)', true, 'skipped — no rows');
  }

  // --- tidy up -------------------------------------------------------------
  await fetch(`${SUPABASE_URL}/storage/v1/object/renders/${probe}`, {
    method: 'DELETE',
    headers: headers(TOKEN_A),
  });

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) {
    console.log('\nFailed:');
    failed.forEach((f) => console.log(`  - ${f.name} (${f.detail})`));
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('\nHarness error:', err.message);
  process.exit(2);
});
