// ImagineAI backend
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

// How many tokens each render engine costs.
const RENDER_COST = { fast: 1, quality: 4 };

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
async function saveToGallery(token, userId, base64Data, style) {
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
    body: JSON.stringify({ user_id: userId, path, style }),
  });
  if (!insert.ok) throw new Error(`renders insert failed: ${await insert.text()}`);

  // Anything beyond the newest GALLERY_LIMIT gets removed (file + row).
  const staleRes = await fetch(
    `${SUPABASE_URL}/rest/v1/renders?user_id=eq.${userId}&select=id,path` +
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
    { method: 'DELETE', headers: authHeaders }
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
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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
      return res.status(402).json({
        error: `This render costs ${cost} token${cost > 1 ? 's' : ''}, but you have ${balance}. Top up to keep rendering.`,
        tokens: balance,
        needed: cost,
      });
    }

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

    // Save to the user's gallery. Never let a storage problem fail a render the
    // user has already paid for — log it and carry on.
    try {
      await saveToGallery(token, user.id, rendered.b64_json, style);
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
    return res.status(502).json({ error: message });
  }
});

app.listen(PORT, () => {
  console.log(`ImagineAI running at http://localhost:${PORT}`);
  if (!process.env.OPENAI_API_KEY) {
    console.log(
      'Note: OPENAI_API_KEY is not set — drawing works, but the Render button will show a ' +
        'placeholder message. See .env.example.'
    );
  }
});
