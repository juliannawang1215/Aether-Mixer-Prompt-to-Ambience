# Aether Mixer — Prompt to Ambience

Aether Mixer turns a short text prompt into an immersive, tunable ambient scene.
It combines a scene parser (Gemini or local fallback), layered audio tracks, and a visual stage to create a controllable atmosphere in real time.

---

## What It Does

- Parse prompt into:
  - `mix` (track weights)
  - `title`
  - `tags`
  - `imagePrompt` (currently used as metadata; visual generation pipeline is still placeholder-driven)
- Render an immersive scene UI
- Play and mix multi-track ambient audio in browser via Web Audio
- Allow per-track live control in mixer
- Provide quick QA mode: `全声音检查` / `恢复场景混音`

---

## Audio Model (Current)

Tracks:

- `rain`
- `fire`
- `wind`
- `waves`
- `birds`
- `thunder`
- `cafe`
- `train`
- `white_noise`
- `office`
- `city`
- `forest`
- `stream` (UI label: `River`)

Design:

- Sample-first when available (`public/samples/*`)
- Procedural synth fallback (pink-noise + filter/LFO shaping)
- Lazy sample loading by active track
- Track-level gain trims for better perceptual balance

---

## Prompt Parsing Modes

### 1) Gemini mode

- Frontend calls backend endpoint: `POST /api/scene`
- Backend route (`api/scene.js`) calls Gemini and returns structured JSON text
- API key stays server-side

### 2) Local fallback mode

- Uses `fallbackSceneFromPrompt()` in `src/App.jsx`
- Includes:
  - keyword matching (with word boundaries for English)
  - vibe-axis scoring
  - preset blending (`moody_night`, `urban_mist`, `cozy_indoor`, `minimal_hush`, `nature_breath`)
  - negative cues / sparse-mix constraints

---

## Quick Start

```bash
cd aether-mixer
cp env.example .env
npm install
npm run dev:5173
```

Open:

- `http://localhost:5173`

---

## Environment Variables

| Variable | Required | Description |
|---|---:|---|
| `VITE_USE_GEMINI` | No | `1` = use backend `/api/scene`; `0` = local fallback only |
| `GEMINI_API_KEY` | Yes (if Gemini on) | Server-side Gemini key (recommended) |
| `VITE_GEMINI_API_KEY` | No | Legacy fallback key name, kept for compatibility |

Notes:

- For production, use `GEMINI_API_KEY` (server-side).
- Do not rely on client-exposed keys.

---

## Scripts

```bash
npm run dev         # Vite dev server
npm run dev:5173    # Force 5173 with auto port cleanup script
npm run build       # Production build
npm run preview     # Preview built app
npm run lint        # ESLint
```

---

## Deployment (Vercel Recommended)

This project is Vercel-friendly and includes:

- frontend static build (Vite)
- serverless route: `api/scene.js`

### Required Vercel env vars

- `VITE_USE_GEMINI=1`
- `GEMINI_API_KEY=...`

If missing, app falls back to local parser flow.

---

## Current Limitations

- Visual generation is still placeholder-based (processed via `generateImageWithValidation`)
- Not all tracks have equally rich real-world samples
- Some prompt semantics still depend on rule heuristics in local mode

---

## Project Structure

```text
src/
  App.jsx                    # UI + scene flow + local fallback prompt parser
  useAetherAudio.js          # audio engine, sample routing, procedural fallback
  generateImageWithValidation.js

api/
  scene.js                   # serverless Gemini proxy endpoint

public/
  samples/                   # compressed loop assets used in runtime
  stills/                    # static visual stills

scripts/
  make_loop.mjs              # helper to create seamless audio loops
  start-dev-5173.mjs         # dev helper for fixed local port
```

---

## Troubleshooting

### No sound at first load

- Browser blocks audio until user gesture.
- Click/tap once in app and retry.

### Gemini not used

- Check `VITE_USE_GEMINI=1`
- Ensure `GEMINI_API_KEY` exists in runtime environment
- Check `/api/scene` response in network panel

### Track sounds wrong

- Use `全声音检查` first
- Then move sliders one-by-one to isolate
- If needed, regenerate loop slices from `samples-source/` using `scripts/make_loop.mjs`
