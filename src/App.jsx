/**
 * Aether Mixer v7.0 — Glassy Player Widget
 * 奶白背景 → 4:3 glassy 播放器 → hover 高斯模糊 + Liquid Glass CTA → prompt 输入 → 沉浸场景
 */
import React, { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, RotateCcw, Volume2, X, SlidersHorizontal } from 'lucide-react';
import { useAetherAudio } from './useAetherAudio';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const MODEL = 'gemini-2.5-flash';

const PLACEHOLDER_IMAGES = ['/scene1.png', '/scene2.png'];

const TRACK_LABELS = {
  rain: 'Rain', fire: 'Fire', wind: 'Wind', waves: 'Waves', birds: 'Birds',
  thunder: 'Thunder', cafe: 'Café', train: 'Train', white_noise: 'White Noise',
};

const SURPRISE_ME = [
  'Snow falling outside a window',
  'Cozy room with a warm lamp',
  'Small cabin in the snow',
  'Rainy forest outside a window',
  'Misty mountain landscape',
  'Coffee shop window in winter',
  'Piano in a quiet room',
  'Reading chair by a bookshelf',
  'Winter street at night',
  'House in the distance at dusk',
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
  const [step, setStep] = useState('player');
  const [prompt, setPrompt] = useState('');
  const [loadingMsg, setLoadingMsg] = useState('');
  const [error, setError] = useState(null);
  const [scene, setScene] = useState(null);
  const [dismissedTracks, setDismissedTracks] = useState(new Set());
  const [mixerOpen, setMixerOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const audioInitRef = useRef(false);

  const { init, applyMix, setTrackGain, startTracks, TRACK_KEYS } = useAetherAudio();

  const ensureAudio = useCallback(() => {
    if (!audioInitRef.current) {
      const ctx = init();
      if (ctx.state === 'suspended') ctx.resume();
      audioInitRef.current = true;
    }
  }, [init]);

  const openPrompt = useCallback(() => {
    ensureAudio();
    setStep('prompt');
  }, [ensureAudio]);

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
    setStep('player');
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
      <>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@200;300;400;500&display=swap" rel="stylesheet" />
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1.2, ease }} className="scene-page">
          <div className="scene-frame">
            <motion.div
              className="scene-bg"
              style={{ backgroundImage: `url(${scene.imageDataUrl})` }}
              initial={{ filter: 'blur(12px)', opacity: 0.6 }}
              animate={{ filter: 'blur(0px)', opacity: 1 }}
              transition={{ duration: 1.5, ease }}
            />
            <div className="scene-dim" />

            {/* Top bar */}
            <div className="scene-top-bar">
              <h1 className="scene-title" style={{ fontFamily: "'Noto Sans SC', sans-serif" }}>
                {scene.title}
              </h1>
              <button onClick={backToPlayer} className="scene-rebuild-btn">
                <RotateCcw size={11} />
                Rebuild
              </button>
            </div>

            {/* Waveform */}
            <div className="scene-waveform">
              {Array.from({ length: 24 }).map((_, i) => (
                <motion.div
                  key={i}
                  className="scene-wave-bar"
                  animate={{ scaleY: [0.3, 0.9, 0.3] }}
                  transition={{ duration: 1.2 + (i % 5) * 0.15, repeat: Infinity, ease: 'easeInOut', delay: i * 0.04 }}
                />
              ))}
            </div>

            {/* Mixer */}
            <div className="scene-mixer-area">
              <AnimatePresence>
                {mixerOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 12, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 12, scale: 0.95 }}
                    transition={{ duration: 0.25, ease }}
                    className="mixer-panel"
                  >
                    <p className="mixer-label"><Volume2 size={10} /> Mixer</p>
                    {activeTracks.length === 0 ? (
                      <p className="mixer-empty">No active tracks</p>
                    ) : (
                      <div className="mixer-tracks">
                        {activeTracks.map((k) => (
                          <div key={k} className="mixer-track">
                            <span className="mixer-track-name">{TRACK_LABELS[k]}</span>
                            <input type="range" min="0" max="1" step="0.05" value={scene.mix[k] ?? 0}
                              onChange={(e) => { const v = parseFloat(e.target.value); setTrackGain(k, v); setScene((prev) => prev ? { ...prev, mix: { ...prev.mix, [k]: v } } : prev); }}
                              className="mixer-slider"
                            />
                            <span className="mixer-track-pct">{Math.round((scene.mix[k] ?? 0) * 100)}%</span>
                            <button onClick={() => dismissTrack(k)} className="mixer-track-dismiss" title="Remove"><X size={10} /></button>
                          </div>
                        ))}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
              <motion.button onClick={() => setMixerOpen((v) => !v)} className="glass-icon" whileTap={{ scale: 0.9 }}>
                <SlidersHorizontal size={20} />
              </motion.button>
            </div>
          </div>
        </motion.div>
      </>
    );
  }

  // ——————————— Player / Prompt / Loading Widget ———————————
  return (
    <div className="page-bg">
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@200;300;400;500&display=swap" rel="stylesheet" />

      <div className="player-widget">
        <AnimatePresence mode="wait">

          {/* ——— Player (default) ——— */}
          {step === 'player' && (
            <motion.div key="player" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.6, ease }}
              className="player-inner"
              onMouseEnter={() => setHovered(true)}
              onMouseLeave={() => setHovered(false)}
            >
              {/* Placeholder image */}
              <motion.div
                className="player-image"
                style={{ backgroundImage: `url(${PLACEHOLDER_IMAGES[0]})` }}
                animate={{ filter: hovered ? 'blur(20px) brightness(0.6)' : 'blur(0px) brightness(1)' }}
                transition={{ duration: 0.5, ease }}
              />

              {/* Title watermark */}
              <div className="player-watermark">
                <span style={{ fontFamily: "'Noto Sans SC', sans-serif" }}>Aether Mixer</span>
              </div>

              {/* Hover CTA */}
              <AnimatePresence>
                {hovered && (
                  <motion.div
                    className="player-cta-wrap"
                    initial={{ opacity: 0, scale: 0.92 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.92 }}
                    transition={{ duration: 0.3, ease }}
                  >
                    <button className="liquid-glass-btn" onClick={openPrompt}>
                      <Sparkles size={14} />
                      Create Your Space
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {/* ——— Prompt Input ——— */}
          {step === 'prompt' && (
            <motion.div key="prompt" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.6, ease }}
              className="prompt-view"
            >
              <p className="prompt-heading">Describe your atmosphere</p>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="A rainy night café, warm light and water streaks on the window…"
                className="prompt-textarea"
                style={{ fontFamily: "'Noto Sans SC', sans-serif" }}
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generateScene(); } }}
              />
              <button onClick={() => generateScene()} className="prompt-generate-btn">
                <Sparkles size={13} />
                Generate Space
              </button>

              {/* Surprise Me */}
              <div className="surprise-section">
                <p className="surprise-label">Or try one of these</p>
                <div className="surprise-chips">
                  {SURPRISE_ME.slice(0, 6).map((s, i) => (
                    <button key={i} className="surprise-chip" onClick={() => { setPrompt(s); generateScene(s); }}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <button onClick={() => setStep('player')} className="prompt-back-btn">← Back</button>
            </motion.div>
          )}

          {/* ——— Loading ——— */}
          {step === 'loading' && (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="loading-view"
            >
              <motion.div
                className="loading-spinner"
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              />
              <p className="loading-msg">{loadingMsg}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Error toast */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="error-toast">
            {error}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
