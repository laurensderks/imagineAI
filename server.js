// ImagineAI backend
//
// This is the ONLY place the OpenAI API key is used. The browser never sees it.
// The frontend posts the drawing as a base64 PNG + a chosen style id to
// POST /api/render, and this server forwards an image-edit request to OpenAI's
// Images API (gpt-image-1), then returns the rendered image back as base64.

const path = require('path');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

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

// Prompt fragments for each supported render style. Keyed by the same ids
// used in the frontend's style picker (public/js/app.js).
const STYLE_PROMPTS = {
  photorealistic:
    'Transform this rough sketch into a highly detailed, enhanced photorealistic image. ' +
    'Preserve the original composition, layout and subject placement exactly, but render ' +
    'realistic lighting, textures, materials and depth as if it were a professional photograph.',
  cartoon:
    'Redraw this sketch as a cute, friendly cartoon illustration with bold clean outlines, ' +
    'simplified rounded shapes, bright cheerful colors and a playful, charming style, while ' +
    'keeping the original composition and subject placement.',
  watercolour:
    'Repaint this sketch as a romantic watercolour painting with soft blended edges, gentle ' +
    'pastel and warm tones, visible paper texture, and delicate paint bleeds, while preserving ' +
    'the original composition and subject placement.',
  pencil:
    'Render this sketch as a modern, edgy pencil drawing with bold expressive graphite lines, ' +
    'strong dramatic shading, high contrast crosshatching and a contemporary illustrative feel, ' +
    'while preserving the original composition and subject placement.',
  oil_masters:
    'Repaint this sketch as a classic oil painting in the style of the 17th-century Dutch ' +
    'Masters: rich deep colors, dramatic chiaroscuro lighting, visible canvas texture and ' +
    'brushwork, and an old-world painterly finish, while preserving the original composition ' +
    'and subject placement.',
  minecraft:
    'Convert this sketch into a Minecraft-style blocky pixel art scene: chunky cubic blocks, ' +
    'a limited retro pixel-art color palette, and crisp hard-edged voxel forms, while ' +
    'preserving the original composition and subject placement.',
  fantasy:
    'Transform this sketch into a dreamlike, cinematic fantasy illustration with atmospheric ' +
    'lighting, glowing highlights, rich imaginative detail and an epic painterly quality, while ' +
    'preserving the original composition and subject placement.',
};

app.post('/api/render', async (req, res) => {
  try {
    const { imageBase64, style, instructions } = req.body || {};

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({ error: 'Missing "imageBase64" in request body.' });
    }
    let prompt = STYLE_PROMPTS[style];
    if (!prompt) {
      return res.status(400).json({ error: `Unknown or missing render style: "${style}".` });
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
      model: 'gpt-image-1',
      image: imageFile,
      prompt,
      size: '1024x1024',
    });

    const rendered = result.data && result.data[0];
    if (!rendered || !rendered.b64_json) {
      throw new Error('OpenAI response did not include image data.');
    }

    return res.json({ imageBase64: `data:image/png;base64,${rendered.b64_json}` });
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
