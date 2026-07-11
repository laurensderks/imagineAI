# ImagineAI — project brief for Claude

A browser-based drawing studio for students: draw on a canvas, optionally trace
over an uploaded photo, then render the drawing through OpenAI's image API in
one of several art styles. Built for a school teacher (Laurens Derks) to give
students access to AI as a creative partner.

## Stack & how it runs
- Plain **Node/Express** backend (`server.js`) serving a **vanilla JS** frontend
  (no framework, no build step). Just `npm install` then `npm start` → port 3000.
- Node lives at `C:\Program Files\nodejs\` on this Windows machine (not on PATH in
  fresh shells — call `node.exe` / `npm.cmd` by full path, or use the preview tool).
- The browser preview tool is the way to run/verify the app (see workflow below).

## Layout
- `server.js` — Express + the ONLY place the OpenAI key is used. Exposes
  `POST /api/render`; picks engine `fast` (gpt-image-1, 1024²) or `quality`
  (gpt-image-2, 2048², `quality:"high"`) per request. Key comes from `.env`
  (gitignored; already set locally). `STYLE_DETAILS` holds the full AI prompts —
  keep these detailed; they drive render quality.
- `public/index.html` — single page: left tool panel, centre canvas stage, right
  render panel, top bar.
- `public/js/canvas.js` — drawing engine. Fixed 1024×1024 backing store. Pointer
  Events (mouse/touch/pen + pressure). Stroke stabilizer. History/undo. Flags:
  `_suspended` (pinch), `_traceBlock` (trace adjust), `_penOnly` (stylus-only).
- `public/js/brushes.js` — 5 brushes (pen, ink, soft, spray, pixel) + `BRUSH_ORDER`.
- `public/js/zoom.js` — anchored zoom (buttons/wheel/pinch) + two-finger pan.
- `public/js/pages.js` — 4-page sketchbook (`PageManager`), tabs on canvas right edge.
- `public/js/trace.js` — `TraceController`: overlay a reference photo to trace over.
- `public/js/app.js` — wires everything: palette, brushes, styles, render flow,
  save-image (PC download / iPad share sheet), autosave to localStorage, fullscreen,
  pencil-only toggle, trace, page tabs.
- `public/img/styles/*.jpg` — render-style tile backgrounds (optimised).
- `public/css/style.css` — all styles. Dark theme, `--accent:#7c5cff`.

## Deploy flow (the loop we use every time)
1. Make the change. 2. Verify in the browser preview (start server, drive it, check
console for errors). 3. Only when it works, **commit + push to GitHub `main`** — this
auto-deploys to Render at https://imagineai-izvc.onrender.com. 4. Poll the live URL
(background `curl … | grep`) to confirm the deploy landed before telling the user.
GitHub repo: https://github.com/laurensderks/imagineAI

## Conventions / gotchas
- British spelling in UI ("colour", "watercolour").
- Elements with `display:flex` etc. ignore the `[hidden]` attribute — add an explicit
  `.foo[hidden]{display:none}` rule when toggling visibility via `hidden`.
- The trace overlay is a separate DOM `<img>`, never painted on the canvas, so it's
  excluded from exports. Render + Save are disabled while a trace is active.
- iPad: fullscreen only works in Safari (Apple blocks the API in Chrome/Brave — the
  button auto-hides there). Touch is hardened (touch-action:none on stage +
  document-level touchmove preventDefault outside panels) to stop swipe-to-exit.
- Don't commit `.env`, `node_modules/`, or `.claude/` (all gitignored).
- Confirm with the user before pushing (they say "push"/"go").

## Backlog / ideas discussed, not built
- Turning this into a real iOS app (Capacitor) or an installable PWA — parked.
