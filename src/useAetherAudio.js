/**
 * Aether Mixer — 本地声源引擎
 * 13 轨：rain, fire, wind, waves, birds, thunder, cafe, train, white_noise,
 *       office, city, forest, stream
 *
 * - 合成层：粉红噪音 + 滤波 + LFO（稳定、可循环、低成本）
 * - 素材层：可选的环境录音（更像咖啡馆/街道/办公室等），若存在则优先播放并 loop
 *
 * 未生成场景前权重全 0（静音）。线上部署时素材从 public/ 静态资源加载。
 */
import { useRef, useEffect, useCallback } from 'react';

const TRACK_KEYS = [
  'rain', 'fire', 'wind', 'waves', 'birds', 'thunder', 'cafe', 'train', 'white_noise',
  'office', 'city', 'forest', 'stream',
];

// Prefer short, seamlessly-looped *_loop.m4a clips (≈25s, ~300KB each) to keep
// first-paint and cellular bandwidth small. The cleaner rainfall loop is listed
// first so decodeFirstWorking picks it over rain_car_thunder.mp3 (which has
// thunder baked in and is better reserved for stormy scenes).
const SAMPLE_BANK = {
  rain: ['/samples/rain_light_loop.m4a', '/samples/rain_loop.m4a'],
  fire: ['/samples/fire_loop.m4a'],
  cafe: ['/samples/cafe_loop.m4a'],
  office: ['/samples/office_1.mp3', '/samples/office_2.mp3'],
  city: ['/samples/london_loop.m4a'],
  wind: ['/samples/wind_loop.m4a'],
  waves: ['/samples/waves_loop.m4a'],
  birds: ['/samples/forest_loop.m4a'],
  stream: ['/samples/stream_loop.m4a'],
};

// Per-track loudness trims to reduce masking during all-track audition and
// better match perceived volume across very different recordings.
const TRACK_GAIN_TRIM = {
  rain: 0.9,
  fire: 0.85,
  wind: 0.65,
  waves: 0.9,
  birds: 0.75,
  thunder: 1.35,
  cafe: 2.35,
  train: 1.75,
  white_noise: 0.35,
  office: 2.4,
  city: 1.55,
  forest: 0.75,
  stream: 1.95,
};

/** 将 mix 对象清洗为 0–1，键名小写 */
export function sanitizeMix(mix) {
  const out = {};
  for (const k of TRACK_KEYS) {
    const v = mix?.[k] ?? mix?.[k.toLowerCase()] ?? 0;
    out[k] = Math.min(1, Math.max(0, Number(v) || 0));
  }
  return out;
}

async function fetchArrayBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch audio: ${url}`);
  return await res.arrayBuffer();
}

async function decodeFirstWorking(ctx, urls = []) {
  for (const url of urls) {
    try {
      const buf = await fetchArrayBuffer(url);
      const audioBuffer = await ctx.decodeAudioData(buf.slice(0));
      if (audioBuffer?.duration) return { url, audioBuffer };
    } catch {
      // ignore and try next
    }
  }
  return null;
}

/** 创建粉红噪近似：多阶 -3dB/oct 衰减的白噪 */
function createPinkNoise(ctx) {
  const bufSize = 2 * ctx.sampleRate;
  const buffer = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < bufSize; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  return source;
}

/** 为某轨创建处理链：noise → filter → gainNode */
function createTrackNodes(ctx, key) {
  const noise = createPinkNoise(ctx);
  const filter = ctx.createBiquadFilter();
  const gainNode = ctx.createGain();
  gainNode.gain.value = 0;

  // 按类型调滤波与可选 LFO
  switch (key) {
    case 'rain':
      filter.type = 'bandpass';
      filter.frequency.value = 2800;
      filter.Q.value = 1.5;
      break;
    case 'fire':
      filter.type = 'bandpass';
      filter.frequency.value = 1200;
      filter.Q.value = 2;
      break;
    case 'wind':
      filter.type = 'lowpass';
      filter.frequency.value = 800;
      /* LFO 起伏：周期调整 filter 模拟 */
      (function mod() {
        const t = (Date.now() / 1000) * 0.2;
        filter.frequency.setTargetAtTime(600 + 400 * Math.sin(t), 0, 0.3);
        requestAnimationFrame(mod);
      })();
      break;
    case 'waves':
      filter.type = 'bandpass';
      filter.frequency.value = 200;
      filter.Q.value = 1;
      (function mod() {
        const t = (Date.now() / 1000) * 0.12;
        filter.frequency.setTargetAtTime(150 + 120 * Math.sin(t), 0, 0.4);
        requestAnimationFrame(mod);
      })();
      break;
    case 'thunder':
      filter.type = 'lowpass';
      filter.frequency.value = 110;
      filter.Q.value = 0.9;
      (function mod() {
        const t = (Date.now() / 1000) * 0.22;
        // Slow low-end sweeps with occasional peaks to mimic distant rumbles.
        const rumble = 80 + 70 * (0.5 + 0.5 * Math.sin(t));
        const swell = Math.max(0, Math.sin(t * 0.31 + 1.7)) ** 5;
        filter.frequency.setTargetAtTime(rumble + swell * 240, 0, 0.22);
        requestAnimationFrame(mod);
      })();
      break;
    case 'cafe':
      filter.type = 'bandpass';
      filter.frequency.value = 600;
      filter.Q.value = 1;
      break;
    case 'train':
      filter.type = 'lowpass';
      filter.frequency.value = 220;
      filter.Q.value = 1.05;
      (function mod() {
        const t = Date.now() / 1000;
        // Rhythmic carriage-like texture instead of static low rumble.
        const clack = 0.5 + 0.5 * Math.sin(t * 3.6);
        const cutoff = 140 + clack * 300 + 35 * Math.sin(t * 0.4);
        filter.frequency.setTargetAtTime(cutoff, 0, 0.08);
        requestAnimationFrame(mod);
      })();
      break;
    case 'birds':
      filter.type = 'bandpass';
      filter.frequency.value = 3200;
      filter.Q.value = 2;
      break;
    case 'office':
      // Low broadband HVAC hum with rare brief openings that suggest
      // tactile keyboard/footstep clicks in the high-mids.
      filter.type = 'lowpass';
      filter.frequency.value = 360;
      filter.Q.value = 0.6;
      (function mod() {
        const t = (Date.now() / 1000) * 0.5;
        // Sparse, peaky envelope: most of the time near 280 Hz, occasional spikes.
        const peak = Math.max(0, Math.sin(t) * Math.sin(t * 1.13)) ** 6;
        filter.frequency.setTargetAtTime(280 + peak * 1800, 0, 0.05);
        requestAnimationFrame(mod);
      })();
      break;
    case 'city':
      // Distant traffic: filtered pink noise with slow LFO on lowpass cutoff.
      filter.type = 'lowpass';
      filter.frequency.value = 700;
      filter.Q.value = 0.7;
      (function mod() {
        const t = (Date.now() / 1000) * 0.15;
        const cutoff = 500 + 380 * Math.sin(t) + 120 * Math.sin(t * 0.43);
        filter.frequency.setTargetAtTime(cutoff, 0, 0.4);
        requestAnimationFrame(mod);
      })();
      break;
    case 'forest':
      // Soft woodland bed: lowpass pink noise hints at leaf rustle, with a slow
      // LFO suggesting distant bird-like brightness in the high-mids. The real
      // /samples/forest_loop.m4a carries the dawn-chorus character; this synth
      // fallback only needs to feel "alive and green" while the sample loads.
      filter.type = 'lowpass';
      filter.frequency.value = 1200;
      filter.Q.value = 0.8;
      (function mod() {
        const t = (Date.now() / 1000) * 0.11;
        // Periodic bright opening every ~18s to evoke a passing bird call.
        const shimmer = Math.max(0, Math.sin(t) * Math.sin(t * 0.37)) ** 4;
        const cutoff = 1000 + 300 * Math.sin(t * 0.6) + shimmer * 2800;
        filter.frequency.setTargetAtTime(cutoff, 0, 0.35);
        requestAnimationFrame(mod);
      })();
      break;
    case 'stream':
      // Babbling water bed: highpass pink noise for the bright splash texture,
      // with slow Q modulation so the brook breathes instead of hissing.
      filter.type = 'highpass';
      filter.frequency.value = 400;
      filter.Q.value = 0.8;
      (function mod() {
        const t = (Date.now() / 1000) * 0.25;
        const q = 0.6 + 0.9 * (0.5 + 0.5 * Math.sin(t));
        const cutoff = 380 + 140 * Math.sin(t * 0.7);
        filter.Q.setTargetAtTime(q, 0, 0.2);
        filter.frequency.setTargetAtTime(cutoff, 0, 0.3);
        requestAnimationFrame(mod);
      })();
      break;
    case 'white_noise':
    default:
      filter.type = 'highpass';
      filter.frequency.value = 80;
      filter.Q.value = 0.5;
      break;
  }
  noise.connect(filter);
  filter.connect(gainNode);
  return { gainNode, start: () => noise.start(0) };
}

function createSampleTrack(ctx, audioBuffer) {
  const gainNode = ctx.createGain();
  gainNode.gain.value = 0;

  let src = null;
  const start = () => {
    if (src) return;
    const s = ctx.createBufferSource();
    s.buffer = audioBuffer;
    s.loop = true;
    s.connect(gainNode);
    s.start(0);
    src = s;
  };

  return { gainNode, start };
}

export function useAetherAudio() {
  const ctxRef = useRef(null);
  const tracksRef = useRef({});
  const sampleStateRef = useRef({});
  const masterRef = useRef(null);
  const mixRef = useRef({});
  const startedRef = useRef(false);
  const GAIN_SCALE = 0.5;

  const init = useCallback(() => {
    if (ctxRef.current) return ctxRef.current;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    ctxRef.current = ctx;
    const master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);
    masterRef.current = master;

    // Always create the procedural synth layer immediately (no async).
    const synthTracks = {};
    TRACK_KEYS.forEach((key) => {
      const { gainNode, start } = createTrackNodes(ctx, key);
      gainNode.connect(master);
      synthTracks[key] = { gainNode, start };
    });
    // Main track map starts with synth for guaranteed instant sound.
    tracksRef.current = { ...synthTracks };
    sampleStateRef.current = Object.fromEntries(
      Object.keys(SAMPLE_BANK).map((k) => [k, { state: 'idle', promise: null }])
    );

    return ctx;
  }, []);

  const ensureSampleTrack = useCallback(async (key) => {
    if (!SAMPLE_BANK[key]) return;
    const ctx = ctxRef.current;
    const master = masterRef.current;
    if (!ctx || !master) return;

    const getState = () => sampleStateRef.current[key] || { state: 'idle', promise: null };
    const setState = (next) => {
      sampleStateRef.current = {
        ...sampleStateRef.current,
        [key]: { ...getState(), ...next },
      };
    };
    const state = getState();

    if (state.state === 'ready' || state.state === 'failed') return;
    if (state.state === 'loading' && state.promise) {
      await state.promise;
      return;
    }

    const loadingPromise = (async () => {
      const decoded = await decodeFirstWorking(ctx, SAMPLE_BANK[key]);
      if (!decoded?.audioBuffer) {
        setState({ state: 'failed', promise: null });
        return;
      }

      const sampleTrack = createSampleTrack(ctx, decoded.audioBuffer);
      sampleTrack.gainNode.connect(master);

      // Crossfade from the current track (usually synth) to sample.
      const previous = tracksRef.current[key];
      if (previous?.gainNode?.gain) previous.gainNode.gain.setTargetAtTime(0, 0, 0.08);
      tracksRef.current[key] = sampleTrack;

      if (startedRef.current) sampleTrack.start();
      const current = Math.min(1, Math.max(0, Number(mixRef.current[key]) || 0));
      const trackScale = GAIN_SCALE * (TRACK_GAIN_TRIM[key] ?? 1);
      sampleTrack.gainNode.gain.setTargetAtTime(current * trackScale, 0, 0.05);

      setState({ state: 'ready', promise: null });
    })().catch(() => {
      setState({ state: 'failed', promise: null });
    });
    setState({ state: 'loading', promise: loadingPromise });

    await loadingPromise;
  }, []);

  /** 应用混音配置；未传入 mix 时保持当前（用于仅改单轨） */
  const applyMix = useCallback((mix) => {
    const sanitized = mix ? sanitizeMix(mix) : mixRef.current;
    mixRef.current = sanitized;
    const tracks = tracksRef.current;
    if (!tracks) return;
    TRACK_KEYS.forEach((k) => {
      if ((sanitized[k] || 0) > 0.001) {
        // Lazy-load sample only when this track is actually used.
        void ensureSampleTrack(k);
      }
      const g = tracks[k]?.gainNode?.gain;
      const trackScale = GAIN_SCALE * (TRACK_GAIN_TRIM[k] ?? 1);
      if (g) g.setTargetAtTime(sanitized[k] * trackScale, 0, 0.05); // 0.05 ≈ 50ms
    });
  }, [ensureSampleTrack]);

  /** 设置单轨增益 0–1，实时反馈 <50ms */
  const setTrackGain = useCallback((key, value) => {
    const v = Math.min(1, Math.max(0, Number(value) || 0));
    mixRef.current = { ...mixRef.current, [key]: v };
    if (v > 0.001) void ensureSampleTrack(key);
    const g = tracksRef.current[key]?.gainNode?.gain;
    const trackScale = GAIN_SCALE * (TRACK_GAIN_TRIM[key] ?? 1);
    if (g) g.setTargetAtTime(v * trackScale, 0, 0.05);
  }, [ensureSampleTrack]);

  /** 启动所有音源（在 applyMix 之后调用，否则仍为静音） */
  const startTracks = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    Object.values(tracksRef.current || {}).forEach((t) => t?.start?.());
  }, []);

  useEffect(() => {
    return () => {
      try {
        ctxRef.current?.close?.();
      } catch (_) { }
    };
  }, []);

  return { init, applyMix, setTrackGain, startTracks, TRACK_KEYS };
}
