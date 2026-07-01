# ImagineAI

A minimalist browser drawing studio: draw with 12 brush types, then render your
sketch through OpenAI's image API in one of 7 art styles.

## Setup

1. Install [Node.js](https://nodejs.org) (18+).
2. Install dependencies:
   ```
   npm install
   ```
3. Add your OpenAI key:
   ```
   copy .env.example .env
   ```
   then edit `.env` and set `OPENAI_API_KEY`. Without a key, drawing still
   works fully — the **Render** button will just show a "not configured"
   message instead of calling OpenAI.
4. Start the app:
   ```
   npm start
   ```
5. Open http://localhost:3000

## How it's put together

- `server.js` — Express server. Serves the frontend and exposes
  `POST /api/render`, the only place the OpenAI key is used (never sent to
  the browser). It forwards the drawing + chosen style to `images.edit`
  (`gpt-image-1`) and returns the result as base64.
- `public/js/canvas.js` — the drawing engine (pointer events for
  mouse/touch/stylus, undo history, background colour, fixed 1024x1024
  internal resolution so no rescaling is needed before sending to the API).
- `public/js/brushes.js` — the 12 brush renderers.
- `public/js/app.js` — UI wiring (palette, brush grid, style picker, render
  flow, mobile panels).
