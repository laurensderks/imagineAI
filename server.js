// Inkmagik backend
//
// This is the ONLY place the OpenAI API key is used. The browser never sees it.
// The frontend posts the drawing as a base64 PNG + a chosen style id to
// POST /api/render, and this server forwards an image-edit request to OpenAI's
// Images API — either the fast gpt-image-1 pass (1024x1024) or the slower
// high-quality gpt-image-2 pass (2048x2048), depending on the user's choice —
// then returns the rendered image back as base64.

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase project — used to verify that whoever calls /api/render is a real
// signed-in user. The publishable key is public (it ships in the browser too);
// it is NOT the secret service_role key.
const SUPABASE_URL = 'https://phcbyouccxunyavzzwrf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_y16rq43HiCYrgfogYoIfZw_5R_KnMu6';

// How many tokens each render engine costs. High-res is only ~1.4x the real
// cost of fast (measured: AUD $0.24 vs $0.17 — images.edit charges for the
// input image too, which flattens the difference), so charging 2 keeps the
// better-looking result within reach instead of pushing people to `fast`.
const RENDER_COST = { fast: 1, quality: 2 };

// Token packs, priced in USD. unit_amount is in cents (Stripe's smallest unit).
const TOKEN_PACKS = {
  small:  { tokens: 15, unit_amount: 500,  name: '15 tokens' },
  medium: { tokens: 35, unit_amount: 1000, name: '35 tokens' },
  large:  { tokens: 75, unit_amount: 2000, name: '75 tokens' },
};

function bearerToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

// Resolve the signed-in user from a Bearer token by asking Supabase to validate
// it. Returns the user object, or null if missing/invalid/expired.
async function getUserFromToken(token) {
  if (!token) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (err) {
    console.error('Auth check failed:', err.message);
    return null;
  }
}

// Read the caller's token balance (RLS lets a user read only their own row).
async function getTokenBalance(token, userId) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=tokens`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } }
  );
  if (!r.ok) return null;
  const rows = await r.json();
  return rows.length ? rows[0].tokens : null;
}

// How many renders we keep per user. Older ones are deleted automatically.
const GALLERY_LIMIT = 5;

// Save a successful render to the user's gallery: upload the PNG to Storage,
// record the metadata row, then prune anything past the newest GALLERY_LIMIT.
// All calls go through the user's own token, so Storage/table RLS applies.
async function saveToGallery(token, userId, base64Data, style, engine) {
  const authHeaders = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` };
  const path = `${userId}/${crypto.randomUUID()}.png`;

  const upload = await fetch(`${SUPABASE_URL}/storage/v1/object/renders/${path}`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'image/png' },
    body: Buffer.from(base64Data, 'base64'),
  });
  if (!upload.ok) throw new Error(`storage upload failed: ${await upload.text()}`);

  const insert = await fetch(`${SUPABASE_URL}/rest/v1/renders`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: userId, path, style, engine }),
  });
  if (!insert.ok) throw new Error(`renders insert failed: ${await insert.text()}`);

  // Past the newest GALLERY_LIMIT we delete the FILE (storage costs money) but
  // keep the ROW, flagged as pruned. The row is a few bytes and is the only
  // lasting record that the render happened — deleting it would throw away the
  // usage history permanently.
  const staleRes = await fetch(
    `${SUPABASE_URL}/rest/v1/renders?user_id=eq.${userId}&pruned=is.false&select=id,path` +
      `&order=created_at.desc&offset=${GALLERY_LIMIT}`,
    { headers: authHeaders }
  );
  if (!staleRes.ok) return;
  const stale = await staleRes.json();
  if (!stale.length) return;

  await fetch(`${SUPABASE_URL}/storage/v1/object/renders`, {
    method: 'DELETE',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: stale.map((r) => r.path) }),
  });
  await fetch(
    `${SUPABASE_URL}/rest/v1/renders?id=in.(${stale.map((r) => r.id).join(',')})`,
    {
      method: 'PATCH',
      headers: { ...authHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ pruned: true }),
    }
  );
}

// Atomically spend `amount` tokens for the caller. Returns the new balance, or
// null if there weren't enough (or the call failed).
async function spendTokens(token, amount) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/spend_tokens`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount }),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (err) {
    console.error('spend_tokens failed:', err.message);
    return null;
  }
}

// Drawings can be reasonably large base64 PNGs, so raise the body size limit.
app.use(cors());

// ---------------------------------------------------------------------------
// Stripe
// ---------------------------------------------------------------------------

// Lazily created so the server still boots (and the app still works) without
// payment keys configured — the Buy buttons just report "not configured".
let stripeClient = null;
function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (!stripeClient) stripeClient = require('stripe')(process.env.STRIPE_SECRET_KEY);
  return stripeClient;
}

// Stripe calls us with no user session attached, so unlike /api/render we can't
// reuse the caller's JWT — these go through the service_role key instead.
function serviceHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

// Fire-and-forget analytics. Deliberately not awaited and never throws: losing
// an analytics row is trivial, breaking someone's render or payment is not.
// Silently no-ops until the service_role key is configured.
function logEvent(userId, event, meta) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  fetch(`${SUPABASE_URL}/rest/v1/events`, {
    method: 'POST',
    headers: { ...serviceHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: userId || null, event, meta: meta || null }),
  }).catch((err) => console.error('logEvent failed:', err.message));
}

// Claims the purchase. The Stripe session id is the table's primary key, so a
// duplicate webhook delivery conflicts here and returns false instead of
// crediting twice. Stripe retries deliveries, so this matters.
async function recordPurchase(session, userId, tokens) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/purchases`, {
    method: 'POST',
    headers: { ...serviceHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify({
      id: session.id,
      user_id: userId,
      tokens,
      amount_cents: session.amount_total,
      currency: session.currency,
    }),
  });
  if (r.status === 409) return false; // already processed
  if (!r.ok) throw new Error(`purchase insert failed: ${await r.text()}`);
  return true;
}

// Release the claim so a Stripe retry can have another go.
async function deletePurchase(sessionId) {
  await fetch(`${SUPABASE_URL}/rest/v1/purchases?id=eq.${sessionId}`, {
    method: 'DELETE',
    headers: serviceHeaders(),
  });
}

async function creditTokens(userId, amount) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/credit_tokens`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify({ p_user: userId, p_amount: amount }),
  });
  if (!r.ok) throw new Error(`credit_tokens failed: ${await r.text()}`);
  return await r.json();
}

// Mounted BEFORE express.json() on purpose: signature verification needs the
// raw, unparsed body. Parsing it first would silently break every webhook.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return res.status(501).send('Stripe is not configured.');

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret);
  } catch (err) {
    // This check is what proves the request genuinely came from Stripe, and not
    // from someone POSTing a fake "payment succeeded" to mint free tokens.
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata && session.metadata.supabase_user_id;
    const tokens = parseInt((session.metadata && session.metadata.tokens) || '', 10);

    if (session.payment_status !== 'paid') return res.json({ received: true });
    if (!userId || !Number.isFinite(tokens)) {
      console.error('Webhook is missing metadata; ignoring session', session.id);
      return res.json({ received: true });
    }

    try {
      const isNew = await recordPurchase(session, userId, tokens);
      if (!isNew) {
        console.log(`Duplicate webhook for ${session.id} — already credited.`);
        return res.json({ received: true });
      }
      try {
        const balance = await creditTokens(userId, tokens);
        console.log(`Credited ${tokens} tokens to ${userId}. New balance: ${balance}`);
        logEvent(userId, 'checkout_completed', {
          tokens,
          amount_cents: session.amount_total,
          currency: session.currency,
        });
      } catch (err) {
        // Undo the claim so Stripe's retry can credit them properly.
        await deletePurchase(session.id);
        throw err;
      }
    } catch (err) {
      console.error('Failed to credit purchase:', err.message);
      return res.status(500).send('Crediting failed.');
    }
  }

  return res.json({ received: true });
});

app.use(express.json({ limit: '25mb' }));

// Server-side visit logging. This is the only visit count that can't be
// blocked: the client-side `app_opened` event is JavaScript, so ad blockers and
// privacy extensions stop a chunk of it. Everyone has to fetch this page from
// us, so logging it here catches all of them.
//
// Records NO IP address and sets NO cookie — just that a visit happened. That
// keeps it out of GDPR/consent-banner territory entirely. The cost is that we
// can't tell unique visitors apart, or attribute a visit to a user (the login
// token lives in localStorage and isn't sent with this request).
const BOT_UA = /bot|crawler|spider|slurp|headless|monitor|uptime|curl|wget|python-requests|axios|postman|pingdom|lighthouse/i;

app.get('/', (req, res, next) => {
  const ua = req.headers['user-agent'] || '';
  let referrer = null;
  try {
    if (req.headers.referer) referrer = new URL(req.headers.referer).hostname;
  } catch (_) {
    /* malformed referer header — ignore */
  }
  // Bots are flagged rather than dropped, so you can filter them out in a query
  // and still see how much crawler traffic you get.
  logEvent(null, 'page_view', {
    bot: BOT_UA.test(ua),
    mobile: /mobile|iphone|ipad|android/i.test(ua),
    referrer,
  });
  next(); // hand off to express.static, which serves index.html
});

app.use(express.static(path.join(__dirname, 'public')));

// Who may see the analytics dashboard. Checked against the email on the
// verified Supabase session, so knowing the address gets you nothing — you'd
// have to actually sign in as that Google account.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'laurens.derks1@gmail.com')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function isAdmin(user) {
  return !!user && !!user.email && ADMIN_EMAILS.includes(user.email.toLowerCase());
}

// Tells the frontend whether to show the dashboard button at all. Purely
// cosmetic — /api/analytics re-checks, so hiding the button is not the gate.
app.get('/api/me', async (req, res) => {
  const user = await getUserFromToken(bearerToken(req));
  return res.json({ admin: isAdmin(user) });
});

app.get('/api/analytics', async (req, res) => {
  const user = await getUserFromToken(bearerToken(req));
  if (!isAdmin(user)) {
    // Same answer whether you're signed out or just not an admin.
    return res.status(403).json({ error: 'Not authorised.' });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(501).json({
      error: 'Analytics needs SUPABASE_SERVICE_ROLE_KEY set on the server.',
    });
  }
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_analytics`, {
      method: 'POST',
      headers: serviceHeaders(),
      body: '{}',
    });
    if (!r.ok) throw new Error(await r.text());
    return res.json(await r.json());
  } catch (err) {
    console.error('Analytics error:', err.message);
    return res.status(500).json({
      error: 'Could not load analytics. Have you run admin-dashboard.sql?',
    });
  }
});

// Events the browser is allowed to report — mainly the anonymous, pre-signup
// activity the database can't otherwise see. Allowlisted so this endpoint can't
// be used to write arbitrary junk into your analytics.
const CLIENT_EVENTS = new Set([
  'app_opened',      // includes anonymous visitors — your top of funnel
  'buy_opened',      // saw the packs...
  'gallery_opened',
  'drawing_started', // actually drew something, vs just landed
]);

app.post('/api/event', async (req, res) => {
  const { event, meta } = req.body || {};
  if (!CLIENT_EVENTS.has(event)) return res.status(400).json({ error: 'Unknown event.' });
  // Optional: anonymous visitors have no token, and that's the point.
  const user = await getUserFromToken(bearerToken(req));
  logEvent(user && user.id, event, meta);
  return res.json({ ok: true });
});

// The packs, so the frontend renders prices from one source of truth.
app.get('/api/packs', (_req, res) => {
  res.json(
    Object.entries(TOKEN_PACKS).map(([id, p]) => ({
      id,
      tokens: p.tokens,
      price: p.unit_amount / 100,
    }))
  );
});

app.post('/api/checkout', async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(501).json({ error: 'Payments are not set up on this server yet.' });
    }

    const token = bearerToken(req);
    const user = await getUserFromToken(token);
    if (!user) return res.status(401).json({ error: 'Please sign in to buy tokens.' });

    const pack = TOKEN_PACKS[(req.body || {}).pack];
    if (!pack) return res.status(400).json({ error: 'Unknown token pack.' });

    const origin = req.headers.origin || `http://localhost:${PORT}`;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      // No payment_method_types on purpose — omitting it enables dynamic
      // payment methods, so Stripe shows each customer the methods most likely
      // to convert, configurable from the Dashboard without code changes.
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: pack.unit_amount,
            product_data: { name: `Inkmagik — ${pack.name}` },
          },
        },
      ],
      customer_email: user.email,
      client_reference_id: user.id,
      // The webhook reads these back to know who to credit, and how much.
      metadata: { supabase_user_id: user.id, tokens: String(pack.tokens) },
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancelled`,
    });

    // Pairs with checkout_completed in the webhook: the gap between the two is
    // your checkout abandonment rate.
    logEvent(user.id, 'checkout_started', {
      pack: req.body.pack,
      tokens: pack.tokens,
      amount_cents: pack.unit_amount,
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    return res.status(500).json({ error: 'Could not start checkout. Please try again.' });
  }
});

// Lazily create the OpenAI client only if a key is configured, so the server
// can still boot (and serve the drawing app) without one — the Render button
// will just return a friendly "not configured" error instead of crashing.
let openaiClient = null;
function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!openaiClient) {
    const OpenAI = require('openai');
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

// Detailed guidance for each supported render style. Keyed by the same ids
// used in the frontend's style picker (public/js/app.js), which shows this
// same content to the user once they select a style.
const STYLE_DETAILS = {
  photorealistic: {
    description:
      'Transform the drawing into a highly realistic image that looks like a polished, ' +
      'high-quality photograph or cinematic still. The final image should have believable ' +
      'lighting, realistic textures, natural proportions, accurate depth, and convincing ' +
      'materials such as skin, fabric, wood, glass, metal, water, or stone depending on the subject.',
    characteristics: [
      'realistic anatomy and proportions',
      'natural lighting with highlights, shadows, and depth',
      'fine details and texture clarity',
      'believable materials and surfaces',
      'clean edges and high visual fidelity',
      'a strong sense of realism without looking plastic or uncanny',
      'optional subtle cinematic polish, like shallow depth of field or realistic atmosphere',
    ],
    tone: 'Crisp, lifelike, detailed, polished, immersive, and visually convincing.',
  },
  cartoon: {
    description:
      'Render the drawing as a charming, appealing cartoon illustration with simplified forms, ' +
      'expressive features, and a playful, friendly personality. The style should feel polished ' +
      'and intentional, with clean shapes, readable silhouettes, and a warm, joyful visual tone.',
    characteristics: [
      'simplified but expressive forms',
      'rounded shapes and appealing proportions',
      'clean outlines or well-defined edges',
      'bright, harmonious colours',
      'strong facial expressions and personality',
      'easy-to-read composition',
      'fun, cheerful, approachable mood',
      'stylised rather than realistic, but still carefully designed',
    ],
    tone: 'Adorable, lively, playful, expressive, polished, and family-friendly.',
  },
  watercolour: {
    description:
      'Render the drawing as a delicate and beautiful watercolour painting with soft washes, ' +
      'gentle blending, translucent layering, and an emotional, poetic atmosphere. The image ' +
      'should feel graceful and artistic, with flowing colour transitions and a hand-painted quality.',
    characteristics: [
      'soft edges and organic brush diffusion',
      'transparent layered colour washes',
      'gentle, harmonious colour palette',
      'light bleeding and subtle texture from paper or pigment',
      'elegant, emotional atmosphere',
      'loose but controlled details',
      'painterly softness without becoming muddy',
      'a sense of delicacy, charm, and beauty',
    ],
    tone: 'Tender, dreamy, graceful, romantic, airy, and painterly.',
  },
  pencil: {
    description:
      'Render the drawing as a contemporary pencil artwork with bold sketch energy, strong line ' +
      'work, controlled shading, and an artistic, fashion-forward edge. This should feel more ' +
      'dynamic and expressive than a simple school sketch, with confidence, contrast, and visual attitude.',
    characteristics: [
      'strong, deliberate pencil lines',
      'layered shading and tonal variation',
      'energetic sketch marks and expressive texture',
      'contemporary, stylish composition',
      'good use of contrast and negative space',
      'visible graphite or pencil-like texture',
      'slight roughness used intentionally for character',
      'clean enough to feel refined, loose enough to feel alive',
    ],
    tone: 'Stylish, raw, expressive, dramatic, contemporary, and slightly rebellious.',
  },
  oil_masters: {
    description:
      'Render the drawing as a refined classical oil painting inspired by the great Dutch master ' +
      'tradition. The final image should feel rich, moody, elegant, and timeless, with masterful ' +
      'lighting, subtle realism, and painterly depth. Emphasise dramatic light and shadow, detailed ' +
      'textures, and a sense of dignity or atmosphere.',
    characteristics: [
      'dramatic chiaroscuro lighting',
      'deep shadows and luminous highlights',
      'rich, earthy, sophisticated colour palette',
      'detailed rendering of fabrics, skin, objects, and surfaces',
      'painterly brushwork with a refined finish',
      'strong composition and timeless presence',
      'atmospheric realism rather than photographic realism',
      'a sense of weight, craftsmanship, and classical beauty',
    ],
    tone: 'Elegant, moody, classical, rich, atmospheric, and masterfully painted.',
  },
  minecraft: {
    description:
      'Render the drawing in a blocky, voxel-inspired style reminiscent of Minecraft, or as crisp ' +
      'pixel art depending on the subject. Shapes should be intentionally simplified into cubes, ' +
      'blocks, or visible pixels, while still preserving readability, charm, and visual coherence.',
    characteristics: [
      'clearly block-based or pixel-based structure',
      'simplified geometry and forms',
      'limited but effective colour palette',
      'strong silhouette readability',
      'tiled or pixel-texture logic where appropriate',
      'clean, recognisable objects and characters',
      'cohesive stylisation rather than random pixelation',
      'a playful, game-like feel',
    ],
    tone: 'Blocky, nostalgic, playful, stylised, readable, and visually clever.',
    extraNote:
      'If using a Minecraft-like result, favour cubic 3D voxel forms. If using pixel art, favour ' +
      'crisp sprite-like rendering with intentional pixel placement.',
  },
  fantasy: {
    description:
      'Render the drawing as a lush fantasy artwork with cinematic lighting, magical atmosphere, ' +
      'and a sense of wonder. The image should feel immersive and emotionally rich, like a scene ' +
      'from an epic fantasy film, illustrated storybook, or high-end concept art piece.',
    characteristics: [
      'dramatic, atmospheric lighting',
      'soft glow, mist, haze, or magical effects where suitable',
      'rich and evocative colour palette',
      'a sense of depth, scale, and world-building',
      'painterly or semi-realistic detail',
      'beautiful composition with storytelling energy',
      'wonder, mystery, enchantment, or emotional resonance',
      'a polished fantasy aesthetic without becoming cluttered',
    ],
    tone: 'Magical, cinematic, immersive, enchanting, emotional, and visually transportive.',
  },
};

function buildStylePrompt(detail) {
  const parts = [
    detail.description,
    `Characteristics of a good result: ${detail.characteristics.join('; ')}.`,
    `Tone to aim for: ${detail.tone}`,
  ];
  if (detail.extraNote) parts.push(detail.extraNote);
  parts.push('Preserve the original composition and subject placement from the original sketch.');
  return parts.join(' ');
}

const STYLE_PROMPTS = Object.fromEntries(
  Object.entries(STYLE_DETAILS).map(([id, detail]) => [id, buildStylePrompt(detail)])
);

// Two render engines the user can pick between: a quick lower-res pass for
// iterating, and a slower true-2K high-quality pass for a final artwork.
const RENDER_ENGINES = {
  fast: { model: 'gpt-image-1', size: '1024x1024' },
  quality: { model: 'gpt-image-2', size: '2048x2048', quality: 'high' },
};

app.post('/api/render', async (req, res) => {
  // The consts below are block-scoped to the try, so the catch can't see them.
  // Keep what the failure event needs out here.
  const ctx = {};
  try {
    // Rendering is a paid, signed-in-only feature. Drawing/download stay free
    // and anonymous, but this endpoint requires a valid Supabase session.
    const token = bearerToken(req);
    const user = await getUserFromToken(token);
    if (!user) {
      return res.status(401).json({ error: 'Please sign in to render your drawing.' });
    }

    const { imageBase64, style, instructions, engine } = req.body || {};

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({ error: 'Missing "imageBase64" in request body.' });
    }
    let prompt = STYLE_PROMPTS[style];
    if (!prompt) {
      return res.status(400).json({ error: `Unknown or missing render style: "${style}".` });
    }
    const engineConfig = RENDER_ENGINES[engine] || RENDER_ENGINES.fast;
    const cost = RENDER_COST[engine] || RENDER_COST.fast;

    // Check the balance up front so we don't call OpenAI for someone who can't
    // afford it. The actual deduction happens only after a successful render.
    const balance = await getTokenBalance(token, user.id);
    if (balance === null) {
      return res.status(500).json({ error: 'Could not read your token balance. Please try again.' });
    }
    if (balance < cost) {
      // The single best pricing signal you have: someone wanted a render and
      // couldn't afford it.
      logEvent(user.id, 'out_of_tokens', { style, engine, balance, needed: cost });
      return res.status(402).json({
        error: `This render costs ${cost} token${cost > 1 ? 's' : ''}, but you have ${balance}. Top up to keep rendering.`,
        tokens: balance,
        needed: cost,
      });
    }

    Object.assign(ctx, { userId: user.id, style, engine });
    logEvent(user.id, 'render_started', { style, engine });
    const startedAt = Date.now();

    // Optional free-text guidance from the user, layered on top of the style prompt.
    if (typeof instructions === 'string' && instructions.trim()) {
      prompt += ` Additional guidance from the artist: ${instructions.trim().slice(0, 500)}`;
    }

    const client = getOpenAIClient();
    if (!client) {
      // No API key configured — this lets the rest of the app be demoed/tested
      // without a real OpenAI account. See .env.example for setup instructions.
      return res.status(501).json({
        error:
          'OPENAI_API_KEY is not configured on the server. Copy .env.example to .env and add ' +
          'your key to enable AI rendering. The drawing tools above work fully without it.',
        placeholder: true,
      });
    }

    // Strip the "data:image/png;base64," prefix if present and turn it into a Buffer.
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    const { toFile } = require('openai');
    const imageFile = await toFile(buffer, 'drawing.png', { type: 'image/png' });

    const result = await client.images.edit({
      image: imageFile,
      prompt,
      ...engineConfig,
    });

    const rendered = result.data && result.data[0];
    if (!rendered || !rendered.b64_json) {
      throw new Error('OpenAI response did not include image data.');
    }

    // Render succeeded — now charge for it. Deducting only on success means a
    // failed render never costs the user a token.
    const newBalance = await spendTokens(token, cost);

    logEvent(user.id, 'render_completed', {
      style,
      engine,
      cost,
      ms: Date.now() - startedAt, // how long renders actually take, per engine
    });

    // Save to the user's gallery. Never let a storage problem fail a render the
    // user has already paid for — log it and carry on.
    try {
      await saveToGallery(token, user.id, rendered.b64_json, style, engine);
    } catch (err) {
      console.error('Gallery save failed:', err.message);
    }

    return res.json({
      imageBase64: `data:image/png;base64,${rendered.b64_json}`,
      tokens: newBalance === null ? balance - cost : newBalance,
    });
  } catch (err) {
    console.error('Render error:', err);
    const message =
      (err && err.error && err.error.message) ||
      (err && err.message) ||
      'Unexpected error while rendering the image.';
    // Failed renders are free (we only deduct on success), so this is also how
    // you'd spot a broken engine burning goodwill rather than tokens.
    logEvent(ctx.userId, 'render_failed', {
      style: ctx.style,
      engine: ctx.engine,
      error: String(message).slice(0, 300),
    });
    return res.status(502).json({ error: message });
  }
});

app.listen(PORT, () => {
  console.log(`Inkmagik running at http://localhost:${PORT}`);
  if (!process.env.OPENAI_API_KEY) {
    console.log(
      'Note: OPENAI_API_KEY is not set — drawing works, but the Render button will show a ' +
        'placeholder message. See .env.example.'
    );
  }
});
