/**
 * Aether Mixer v7.0 — Glassy Player Widget
 * 奶白背景 → 4:3 glassy 播放器 → hover 高斯模糊 + Liquid Glass CTA → prompt 输入 → 沉浸场景
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, RotateCcw, Volume2, X, SlidersHorizontal, ArrowRight } from 'lucide-react';
import { useAetherAudio } from './useAetherAudio';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const MODEL = 'gemini-2.5-flash';

const PLACEHOLDER_IMAGES = ['/scene1.png', '/scene2.png'];

const TRACK_LABELS = {
  rain: 'Rain', fire: 'Fire', wind: 'Wind', waves: 'Waves', birds: 'Birds',
  thunder: 'Thunder', cafe: 'Café', train: 'Train', white_noise: 'White Noise',
};

const SURPRISE_CARDS = [
  // Local stills
  { text: 'A quiet interior, warm lamp glow, soft shadows', img: '/card_cozy_room.png' },
  { text: 'Snow falling outside a window, thick glass and hush', img: '/card_snow_window.png' },
  { text: 'A small cabin in snow, distant wind and pine', img: '/card_cabin_snow.png' },
  { text: 'Rainy forest, wet leaves, muted daylight', img: '/card_rainy_forest.png' },
  { text: 'Misty mountains, cold air, low clouds', img: '/card_misty_mountain.png' },
  { text: 'Winter café window, amber lights, drizzle', img: '/card_coffee_shop.png' },
  { text: 'Slow camera drift across a still frame', img: '/scene1.png' },
  { text: 'A second still, slightly different mood', img: '/scene2.png' },

  // Added real stills (copied into public/stills)
  { text: 'Foggy train platform, distant hum, wet air', img: '/stills/still-train-fog-1.png' },
  { text: 'Snow on window, warm interior, quiet street', img: '/stills/still-snow-window-2.png' },
  { text: 'Rainy café table by the window, soft amber light', img: '/stills/still-rain-cafe-1.png' },
  { text: 'Cabin at blue hour, lights on, snowfield', img: '/stills/still-cabin-snow-2.png' },
  { text: 'Rain on glass, forest outside, muted tones', img: '/stills/still-rain-window-3.png' },
  { text: 'Empty station, mist and sodium lights', img: '/stills/still-train-station-2.png' },
  { text: 'Still lake at dawn, low fog, distant ridge', img: '/stills/still-lake-dawn-1.png' },
  { text: 'Piano by a window at dusk, city lights far away', img: '/stills/still-piano-window-1.png' },
  { text: 'Reading chair and lamp, bookshelf hush', img: '/stills/still-chair-library-1.png' },
  { text: 'A lone house in a snowfield at twilight', img: '/stills/still-house-snowfield-1.png' },
  { text: 'Rainy street, reflections, late night transit', img: '/stills/still-rain-street-1.png' },
  { text: 'Convenience store glow in the rain, empty road', img: '/stills/still-convenience-rain-1.png' },
  { text: 'Books wall, afternoon light, quiet reading', img: '/stills/still-books-wall-1.png' },
  { text: 'Snowy street café, warm window glow', img: '/stills/still-cafe-snow-street-1.png' },
  { text: 'Turntable at dusk, city beyond the glass', img: '/stills/still-turntable-dusk-1.png' },
  { text: 'Desk by a rainy window, green outside', img: '/stills/still-rain-desk-1.png' },
  { text: 'Soft sunrise, someone playing piano', img: '/stills/still-piano-sunrise-1.png' },
  { text: 'Rainy corner café at night, reflections', img: '/stills/still-rainy-corner-cafe-1.png' },
  { text: 'Minimal fireplace room, winter stillness', img: '/stills/still-snow-fireplace-1.png' },
  { text: 'Sofa by a snow window, calm lamplight', img: '/stills/still-snow-sofa-window-1.png' },
  { text: 'Mountains and field, overcast and wide', img: '/stills/still-mountains-field-1.png' },
  { text: 'Snow suburb outside a window, night hush', img: '/stills/still-snow-suburb-window-1.png' },
];

function sanitizeScenePayload(raw) {
  let o;
  try {
    let s = String(raw || '{}').replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/g, '').trim();
    s = s.replace(/\b(imagePrompt|image_prompt|mix|title|tags)\s*:/gi, (m) => m.toLowerCase());
    o = typeof raw === 'object' ? raw : JSON.parse(s || '{}');
  } catch { o = {}; }
  const mix = o.mix || o.Mix || {};
  const mixOut = {};
  for (const k of Object.keys(TRACK_LABELS)) {
    const v = mix[k] ?? mix[k.replace('_', '')] ?? 0;
    mixOut[k] = Math.min(1, Math.max(0, Number(v) || 0));
  }
  return {
    imagePrompt: String(o.imagePrompt || o.image_prompt || '').slice(0, 2000),
    mix: mixOut,
    title: String(o.title || '').replace(/[^a-zA-Z0-9\s]/g, '').trim().slice(0, 30) || 'Aether',
    tags: Array.isArray(o.tags) ? o.tags.slice(0, 8) : [],
  };
}

export default function App() {
  // Steps: player → prompt → loading → scene
  const [step, setStep] = useState('prompt');
  const [prompt, setPrompt] = useState('');
  const [loadingMsg, setLoadingMsg] = useState('');
  const [error, setError] = useState(null);
  const [scene, setScene] = useState(null);
  const [dismissedTracks, setDismissedTracks] = useState(new Set());
  const [mixerOpen, setMixerOpen] = useState(false);
  const audioInitRef = useRef(false);

  const { init, applyMix, setTrackGain, startTracks, TRACK_KEYS } = useAetherAudio();

  // Prompt background: 3D conveyor (tiles travel along Z towards the camera)
  const driftRef = useRef({
    raf: 0,
    lastT: 0,
    thrust: 0,
    thrustTarget: 0,
    t: 0,
    tiles: [],
    poolLen: 0,
    deck: [],
    deckPtr: 0,
  });
  const [, bump] = useState(0);
  useEffect(() => {
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const wrap = (v, min, max) => {
      const span = max - min;
      const n = ((v - min) % span + span) % span;
      return min + n;
    };

    const rand01 = (seed) => {
      // deterministic PRNG from seed → 0..1
      const x = Math.sin(seed * 999.123) * 10000;
      return x - Math.floor(x);
    };

    const initTilesIfNeeded = () => {
      const d = driftRef.current;
      const TILE_COUNT = Math.max(24, Math.min(48, SURPRISE_CARDS.length * 2));
      if (d.tiles.length === TILE_COUNT && d.poolLen === SURPRISE_CARDS.length) return;
      const m = 0.14; // overscan margin in viewport fractions
      d.poolLen = SURPRISE_CARDS.length;
      d.deck = Array.from({ length: Math.max(1, SURPRISE_CARDS.length) }, (_, idx) => idx);
      // Fisher–Yates shuffle (deterministic-ish based on current pool length)
      for (let i = d.deck.length - 1; i > 0; i--) {
        const j = Math.floor(rand01(i + 9999 + d.poolLen) * (i + 1));
        const tmp = d.deck[i];
        d.deck[i] = d.deck[j];
        d.deck[j] = tmp;
      }
      d.deckPtr = 0;
      const avoid = { cx: 0.5, cy: 0.52, rx: 0.22, ry: 0.16 }; // keep center clearer for input
      const pickPos = (seedBase) => {
        for (let a = 0; a < 14; a++) {
          const rA = rand01(seedBase + a * 17 + 3);
          const rB = rand01(seedBase + a * 17 + 9);
          const x = wrap(rA * (1 + 2 * m) - m, -m, 1 + m);
          const y = wrap(rB * (1 + 2 * m) - m, -m, 1 + m);
          const inVoid =
            Math.abs(x - avoid.cx) < avoid.rx &&
            Math.abs(y - avoid.cy) < avoid.ry;
          if (!inVoid) return { x, y };
        }
        return { x: wrap(rand01(seedBase + 77) * (1 + 2 * m) - m, -m, 1 + m), y: wrap(rand01(seedBase + 99) * (1 + 2 * m) - m, -m, 1 + m) };
      };

      d.tiles = Array.from({ length: TILE_COUNT }).map((_, i) => {
        const r1 = rand01(i + 1);
        const r2 = rand01(i + 11);
        const r3 = rand01(i + 101);
        const r4 = rand01(i + 1001);
        const r5 = rand01(i + 5001);
        const r6 = rand01(i + 7001);
        const r7 = rand01(i + 9001);

        // depth drives size and speed; z controls the 3D conveyor placement
        const depth = 0.22 + r3 * 0.78; // 0.22..1
        const baseSpeed = (0.28 + r4 * 0.58) * (0.55 + depth * 0.9); // z units / sec (scaled below)
        const { x, y } = pickPos(i * 31 + 7);
        const zFar = -2200;
        const zNear = 260;
        const z = zFar + (zNear - zFar) * r2;
        return {
          x,
          y,
          depth,
          baseSpeed,
          phase: r1 * Math.PI * 2,
          imgIndex: d.deck[(d.deckPtr++) % d.deck.length] ?? Math.floor(r5 * Math.max(1, SURPRISE_CARDS.length)),
          z,
          // Slight crop/zoom variance to avoid “same still” feeling (no filters).
          posX: Math.round((r6 * 60 + 20) * 10) / 10, // 20..80
          posY: Math.round((r7 * 60 + 20) * 10) / 10, // 20..80
          zoom: 1.02 + (rand01(i + 11001) * 0.12), // 1.02..1.14
        };
      });
    };

    const tick = (now) => {
      initTilesIfNeeded();
      const d = driftRef.current;
      const dt = d.lastT ? clamp((now - d.lastT) / 1000, 0, 0.05) : 1 / 60;
      d.lastT = now;
      d.t += dt;

      // Smooth thrust input and decay to neutral.
      d.thrust += (d.thrustTarget - d.thrust) * 0.12;
      d.thrustTarget *= 0.92;
      d.thrustTarget = clamp(d.thrustTarget, -2.2, 2.2);

      const zFar = -2200;
      const zNear = 260;
      for (const tile of d.tiles) {
        // subtle breathing so it's not perfectly mechanical
        const wobble = Math.sin(d.t * (0.55 + tile.depth * 0.85) + tile.phase) * 18;
        const forward = tile.baseSpeed + d.thrust * (0.9 + tile.depth * 0.6);
        tile.z += (forward * 520) * dt; // px/sec
        tile.z += wobble * dt;
        if (tile.z > zNear) {
          tile.z = zFar + (tile.z - zNear);
          // Deal a new still on wrap (prevents same-image clusters).
          if (d.deck.length) {
            tile.imgIndex = d.deck[(d.deckPtr++) % d.deck.length];
          } else {
            tile.imgIndex = (tile.imgIndex + 1) % Math.max(1, SURPRISE_CARDS.length);
          }
          // Refresh crop a bit so repeats are less obvious.
          const seed = Math.floor((d.t + tile.phase) * 1000) + (tile.imgIndex ?? 0) * 17;
          tile.posX = Math.round((rand01(seed + 1) * 60 + 20) * 10) / 10;
          tile.posY = Math.round((rand01(seed + 2) * 60 + 20) * 10) / 10;
          tile.zoom = 1.02 + (rand01(seed + 3) * 0.12);
        }
      }

      bump((n) => (n + 1) % 1_000_000);
      d.raf = requestAnimationFrame(tick);
    };

    driftRef.current.raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(driftRef.current.raf);
  }, []);

  useEffect(() => {
    const onWheel = (e) => {
      // Prevent the browser from treating this as page scroll (page is intentionally non-scrollable).
      e.preventDefault();
      // Trackpads can send tiny deltas; map to forward/back thrust.
      driftRef.current.thrustTarget += e.deltaY * 0.0032;
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, []);

  const ensureAudio = useCallback(() => {
    if (!audioInitRef.current) {
      try {
        const ctx = init();
        if (ctx.state === 'suspended') ctx.resume();
        audioInitRef.current = true;
      } catch (_) {
        // Audio init can be blocked until a user gesture in some environments.
        // UI navigation should not depend on this.
      }
    }
  }, [init]);

  const generateScene = useCallback(async (text) => {
    const t = (text || prompt).trim();
    if (t.length < 2) {
      setError('Please describe the atmosphere you want.');
      setTimeout(() => setError(null), 3000);
      return;
    }
    ensureAudio();
    setStep('loading');
    setError(null);
    setLoadingMsg('Parsing the mood…');

    try {
      const sys = `You are an atmosphere designer. For the user's scene description, output a JSON object with:
- imagePrompt: detailed English image prompt (lighting, ambiance, texture, no people), one paragraph.
- mix: object with keys rain,fire,wind,waves,birds,thunder,cafe,train,white_noise. Each value 0.0 to 1.0. Only set non-zero values for sounds that genuinely fit the scene.
- title: a short, evocative English title, 1–3 words.
- tags: array of 2–6 short English atmosphere tags.
Output ONLY valid JSON, no markdown.`;

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${sys}\n\nUser: ${t}` }] }],
            generationConfig: { responseMimeType: 'application/json' },
          }),
        }
      );
      const data = await res.json();
      if (!res.ok || data?.error) throw new Error(data?.error?.message || `API ${res.status}`);
      const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!raw || typeof raw !== 'string') throw new Error('No content returned.');

      setLoadingMsg('Building your space…');
      const clean = sanitizeScenePayload(raw);
      const imageDataUrl = PLACEHOLDER_IMAGES[Math.floor(Math.random() * PLACEHOLDER_IMAGES.length)];

      setScene({ ...clean, imageDataUrl });
      setDismissedTracks(new Set());
      setMixerOpen(false);
      applyMix(clean.mix);
      startTracks();
      setStep('scene');
    } catch (e) {
      setError(e?.message || 'Something went wrong.');
      setStep('prompt');
    }
  }, [prompt, applyMix, startTracks, ensureAudio]);

  const backToPlayer = useCallback(() => {
    setStep('prompt');
    setScene(null);
    setPrompt('');
    setMixerOpen(false);
    applyMix(Object.fromEntries(TRACK_KEYS.map((k) => [k, 0])));
  }, [applyMix, TRACK_KEYS]);

  const activeTracks = scene?.mix
    ? TRACK_KEYS.filter((k) => scene.mix[k] > 0 && !dismissedTracks.has(k))
    : [];

  const dismissTrack = useCallback((key) => {
    setTrackGain(key, 0);
    setScene((prev) => prev ? { ...prev, mix: { ...prev.mix, [key]: 0 } } : prev);
    setDismissedTracks((prev) => new Set(prev).add(key));
  }, [setTrackGain]);

  const ease = [0.25, 0.46, 0.45, 0.94];

  // ——————————— Scene View (full-page) ———————————
  if (step === 'scene' && scene) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.9, ease }} className="scene-stage">
        <div className="scene-matte" aria-hidden="true" />
        <div className="scene-still" style={{ backgroundImage: `url(${scene.imageDataUrl})` }} />
        <div className="scene-vignette" aria-hidden="true" />

        <div className="scene-hud">
          <div className="scene-hud-left">
            <div className="scene-chip">AETHER MIXER</div>
            <h1 className="scene-h1">{scene.title}</h1>
            {Array.isArray(scene.tags) && scene.tags.length > 0 && (
              <div className="scene-tags" aria-label="Atmosphere tags">
                {scene.tags.slice(0, 6).map((t) => (
                  <span key={t} className="scene-tag">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="scene-hud-right">
            <button onClick={backToPlayer} className="scene-ghost-btn">
              <RotateCcw size={12} />
              Rebuild
            </button>
          </div>
        </div>

        <div className="scene-footer">
          <div className="scene-waveform" aria-hidden="true">
            {Array.from({ length: 28 }).map((_, i) => (
              <motion.div
                key={i}
                className="scene-wave-bar"
                animate={{ scaleY: [0.25, 1, 0.25] }}
                transition={{ duration: 1.1 + (i % 7) * 0.12, repeat: Infinity, ease: 'easeInOut', delay: i * 0.03 }}
              />
            ))}
          </div>

          <div className="dock">
            <AnimatePresence>
              {mixerOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 14, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 14, scale: 0.98 }}
                  transition={{ duration: 0.22, ease }}
                  className="dock-panel"
                >
                  <div className="dock-title">
                    <Volume2 size={12} />
                    Mixer
                  </div>
                  {activeTracks.length === 0 ? (
                    <div className="dock-empty">No active tracks</div>
                  ) : (
                    <div className="dock-tracks">
                      {activeTracks.map((k) => (
                        <div key={k} className="dock-row">
                          <div className="dock-name">{TRACK_LABELS[k]}</div>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={scene.mix[k] ?? 0}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              setTrackGain(k, v);
                              setScene((prev) => (prev ? { ...prev, mix: { ...prev.mix, [k]: v } } : prev));
                            }}
                            className="dock-slider"
                          />
                          <div className="dock-pct">{Math.round((scene.mix[k] ?? 0) * 100)}%</div>
                          <button onClick={() => dismissTrack(k)} className="dock-x" title="Remove">
                            <X size={11} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            <motion.button onClick={() => setMixerOpen((v) => !v)} className="dock-btn" whileTap={{ scale: 0.96 }} aria-label="Toggle mixer">
              <SlidersHorizontal size={18} />
            </motion.button>
          </div>
        </div>
      </motion.div>
    );
  }

  // ——————————— Player / Prompt / Loading Widget ———————————
  return (
    <div className="immersive-shell">
      <div className="immersive-frame">
          <AnimatePresence mode="wait">
            {/* ——— Prompt Input ——— */}
            {step === 'prompt' && (
              <motion.div
                key="prompt"
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.7, ease }}
                className="prompt-stage"
              >
                <div className="prompt-gallery" aria-hidden="true">
                  {driftRef.current.tiles.map((tile, i) => {
                    const d = driftRef.current;
                    const pool = SURPRISE_CARDS;
                    const img = pool[(tile?.imgIndex ?? i) % Math.max(1, pool.length)]?.img ?? '/scene1.png';
                    const xN = tile?.x ?? ((i % 7) * 0.12 + 0.10);
                    const yN = tile?.y ?? (Math.floor(i / 7) * 0.12 + 0.10);
                    const depth = tile?.depth ?? 0.65;
                    const z = tile?.z ?? (-1200 + (i % 12) * 140);
                    const zNorm = Math.max(0, Math.min(1, (z + 2200) / (2200 + 260)));
                    const scale = (0.62 + depth * 0.62) * (0.72 + zNorm * 0.68);
                    const rollDeg =
                      Math.sin((d.t ?? 0) * (0.35 + depth) + (tile?.phase ?? 0)) * 1.2;
                    return (
                      <div
                        key={`${i}-${String(img).slice(0, 24)}`}
                        className="prompt-tile"
                        style={{
                          '--tile-bg': `url(${img})`,
                          '--tile-pos-x': `${tile?.posX ?? 50}%`,
                          '--tile-pos-y': `${tile?.posY ?? 50}%`,
                          '--tile-zoom': `${tile?.zoom ?? 1.06}`,
                          transform: `translate3d(${xN * 100}vw, ${yN * 100}vh, 0) translateZ(${z}px) scale(${scale}) rotate(${rollDeg}deg)`,
                        }}
                      />
                    );
                  })}
                </div>

                <div className="prompt-center">
                  <div className="prompt-editor">
                    <form
                      className="prompt-pill"
                      onSubmit={(e) => {
                        e.preventDefault();
                        generateScene();
                      }}
                    >
                      <input
                        value={prompt ?? ''}
                        onChange={(e) => {
                          const v = e?.target?.value;
                          setPrompt(typeof v === 'string' ? v : '');
                        }}
                        onFocus={ensureAudio}
                        placeholder="Describe your atmosphere…"
                        className="prompt-pill-input"
                        maxLength={220}
                      />
                      <button type="submit" className="prompt-pill-submit" aria-label="Generate">
                        <ArrowRight size={18} />
                      </button>
                    </form>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ——— Loading ——— */}
            {step === 'loading' && (
              <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="loading">
                <div className="loading-matte" />
                <motion.div className="loading-ring" animate={{ rotate: 360 }} transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }} />
                <div className="loading-text">
                  <div className="loading-kicker">Processing</div>
                  <div className="loading-msg">{loadingMsg}</div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {error && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} className="toast">
                {error}
              </motion.div>
            )}
          </AnimatePresence>
      </div>
    </div>
  );
}
