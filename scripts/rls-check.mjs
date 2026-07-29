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

if (!TOKEN_A) {
  console.error('Set TOKEN_A (see the comment at the top of this file).');
  process.exit(2);
}

// TOKEN_B is optional. Without it we run "solo mode": everything that one
// signed-in account can prove on its own — bucket limits, expiry, the token
// economy, anonymous access. The seven checks that need a genuine second
// person are reported as SKIP rather than quietly passing, because a check
// that didn't run is not a check that passed.
const SOLO = !TOKEN_B;

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

// passed === null means "not run", which is neither a pass nor a failure.
function skip(name, why) {
  results.push({ name, passed: null, detail: why });
  console.log(`SKIP  ${name} — ${why}`);
}

function headers(token, extra = {}) {
  const h = { apikey: ANON_KEY, ...extra };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

// A token is a JWT: three dot-separated parts, and a long one. Most failures
// here are a copy/paste problem rather than a real auth problem, so say which
// token is bad and what it looked like instead of a bare 401.
function describeToken(label, token) {
  const parts = token.split('.');
  const hints = [];
  if (token.startsWith('"') || token.endsWith('"') || token.startsWith("'")) {
    hints.push('it still has quote marks around it — copy only what is between them');
  }
  if (parts.length !== 3) {
    hints.push(`it has ${parts.length} part(s) instead of 3, so it is not a whole token`);
  }
  if (token.includes('…') || token.includes('...')) {
    hints.push('it contains "…", so the console truncated it — use copy() as shown below');
  }
  if (token.length < 300) {
    hints.push(`it is only ${token.length} characters, which is too short — tokens are usually 700+`);
  }
  return `${label} looks wrong: ${hints.length ? hints.join('; ') : 'it may simply have expired (they last about an hour)'}`;
}

async function userId(label, token) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: headers(token) });
  if (!r.ok) {
    console.error(`\n${describeToken(label, token)}`);
    console.error(
      '\nMost reliable way to copy one: in the browser console run\n' +
      '    copy(await window.Auth.getToken())\n' +
      'then paste straight from the clipboard — copy() grabs the whole value, ' +
      'while selecting the printed text often grabs a shortened version.'
    );
    throw new Error(`${label} was rejected by Supabase (HTTP ${r.status})`);
  }
  return (await r.json()).id;
}

// --- the checks ------------------------------------------------------------

async function run() {
  const idA = await userId('TOKEN_A', TOKEN_A);
  const idB = SOLO ? idA : await userId('TOKEN_B', TOKEN_B);

  if (!SOLO && idA === idB) {
    console.error(
      'TOKEN_A and TOKEN_B belong to the SAME account, so the cross-user checks\n' +
      'would prove nothing. A private window often signs back in as the same\n' +
      'Google account — on the sign-in screen choose "Use another account".\n\n' +
      'Or drop TOKEN_B entirely to run the single-account checks.'
    );
    process.exitCode = 2;
    return;
  }

  // Stands in for "some other signed-in user" in the checks that only need an
  // ordinary authenticated caller rather than a second identity.
  const OTHER = TOKEN_B || TOKEN_A;

  console.log(SOLO ? `A = ${idA}\n(solo mode — cross-user checks will be skipped)\n`
                   : `A = ${idA}\nB = ${idB}\n`);

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
    process.exitCode = 1;
    return;
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

  if (SOLO) {
    skip('B cannot download A\'s file', 'needs a second account');
    skip('B cannot sign a URL for A\'s file', 'needs a second account');
    skip('B cannot list A\'s folder', 'needs a second account');
    skip('B cannot delete A\'s file', 'needs a second account');
  } else {
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
  }

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
    headers: headers(OTHER, { 'Content-Type': 'text/html' }),
    body: '<script>alert(1)</script>',
  });
  record('A non-image upload is rejected', !badType.ok, `HTTP ${badType.status}`);

  // 9. Upload size enforcement — 12MB against a 10MB bucket limit.
  const big = Buffer.alloc(12 * 1024 * 1024, 1);
  const tooBig = await fetch(`${SUPABASE_URL}/storage/v1/object/renders/${idB}/big.png`, {
    method: 'POST',
    headers: headers(OTHER, { 'Content-Type': 'image/png' }),
    body: big,
  });
  record('An oversized upload is rejected', !tooBig.ok, `HTTP ${tooBig.status}`);

  // 9b/9c. The same two limits on the TRACES bucket. This matters more than the
  // renders bucket: trace photos go from the browser straight to Storage, so
  // these bucket settings are the only size/type check that exists. Both target
  // paths that are rejected, so nothing is written and no real trace is touched.
  const traceBadType = await fetch(`${SUPABASE_URL}/storage/v1/object/traces/${idA}/rls-probe.html`, {
    method: 'POST',
    headers: headers(TOKEN_A, { 'Content-Type': 'text/html' }),
    body: '<script>alert(1)</script>',
  });
  record('A non-image trace upload is rejected', !traceBadType.ok, `HTTP ${traceBadType.status}`);

  const traceTooBig = await fetch(`${SUPABASE_URL}/storage/v1/object/traces/${idA}/rls-probe-big.jpg`, {
    method: 'POST',
    headers: headers(TOKEN_A, { 'Content-Type': 'image/jpeg' }),
    body: big,
  });
  record('An oversized trace upload is rejected', !traceTooBig.ok, `HTTP ${traceTooBig.status}`);

  // --- database rows -------------------------------------------------------

  if (SOLO) {
    skip('B cannot read A\'s render rows', 'needs a second account');
    skip('B cannot read A\'s profile', 'needs a second account');
  } else {
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
  }

  // 12. Anonymous read of the whole renders table.
  const anonRows = await fetch(`${SUPABASE_URL}/rest/v1/renders?select=id`, { headers: headers(null) });
  const anonList = anonRows.ok ? await anonRows.json() : [];
  record('Anonymous cannot read the renders table', anonList.length === 0,
    `HTTP ${anonRows.status}, ${anonList.length} rows`);

  // 13. Nobody can read the coupon codes — they are free tokens in text form.
  const coupons = await fetch(`${SUPABASE_URL}/rest/v1/coupons?select=code`, { headers: headers(OTHER) });
  const couponRows = coupons.ok ? await coupons.json() : [];
  record('B cannot read coupon codes', couponRows.length === 0,
    `HTTP ${coupons.status}, ${couponRows.length} rows`);

  // 14. B cannot write their own token balance. profiles has no write policy,
  //     so this must change nothing.
  const patch = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${idB}`, {
    method: 'PATCH',
    headers: headers(OTHER, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({ tokens: 9999 }),
  });
  const patched = patch.ok ? await patch.json() : [];
  record('B cannot top up their own balance', patched.length === 0,
    `HTTP ${patch.status}, ${patched.length} rows changed`);

  // 15. spend_tokens must refuse a negative amount, which would ADD tokens.
  const negative = await fetch(`${SUPABASE_URL}/rest/v1/rpc/spend_tokens`, {
    method: 'POST',
    headers: headers(OTHER, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ amount: -100 }),
  });
  const negResult = negative.ok ? await negative.json() : null;
  record('spend_tokens(-100) does not credit tokens', negResult === null,
    `returned ${JSON.stringify(negResult)}`);

  // 16. credit_tokens is service_role only — a user calling it directly would
  //     be able to mint themselves an unlimited balance.
  const credit = await fetch(`${SUPABASE_URL}/rest/v1/rpc/credit_tokens`, {
    method: 'POST',
    headers: headers(OTHER, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ p_user: idB, p_amount: 100 }),
  });
  record('B cannot call credit_tokens', !credit.ok, `HTTP ${credit.status}`);

  // 17. B updates A's render row (e.g. re-pointing it at their own file).
  const aRowRes = await fetch(
    `${SUPABASE_URL}/rest/v1/renders?user_id=eq.${idA}&select=id&limit=1`,
    { headers: headers(TOKEN_A) }
  );
  const aRows = aRowRes.ok ? await aRowRes.json() : [];
  if (SOLO) {
    skip('B cannot modify A\'s render row', 'needs a second account');
  } else if (aRows.length) {
    const hijack = await fetch(`${SUPABASE_URL}/rest/v1/renders?id=eq.${aRows[0].id}`, {
      method: 'PATCH',
      headers: headers(TOKEN_B, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
      body: JSON.stringify({ style: 'hijacked' }),
    });
    const changed = hijack.ok ? await hijack.json() : [];
    record('B cannot modify A\'s render row', changed.length === 0, `${changed.length} rows changed`);
  } else {
    skip('B cannot modify A\'s render row', 'A has no render rows to target');
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
    skip('A CAN update A\'s own render row (prune needs this)', 'A has no render rows yet');
  }

  // --- tidy up -------------------------------------------------------------
  await fetch(`${SUPABASE_URL}/storage/v1/object/renders/${probe}`, {
    method: 'DELETE',
    headers: headers(TOKEN_A),
  });

  const failed = results.filter((r) => r.passed === false);
  const skipped = results.filter((r) => r.passed === null);
  const passed = results.filter((r) => r.passed === true);

  console.log(`\n${passed.length} passed, ${failed.length} failed, ${skipped.length} not run.`);
  if (failed.length) {
    console.log('\nFailed:');
    failed.forEach((f) => console.log(`  - ${f.name} (${f.detail})`));
    process.exitCode = 1;
  }
  if (skipped.length) {
    console.log(
      `\n${skipped.length} check(s) did not run. Set TOKEN_B to a SECOND Google` +
      ' account to cover the cross-user cases — they are the ones that prove one' +
      ' student cannot reach another student\'s work.'
    );
  }
}

// Sets exitCode rather than calling process.exit(): killing the process while
// fetch still has sockets open trips a libuv assertion on Windows, which prints
// an alarming C-level crash on top of an otherwise ordinary failure message.
run().catch((err) => {
  console.error('\nStopped:', err.message);
  process.exitCode = 2;
});
