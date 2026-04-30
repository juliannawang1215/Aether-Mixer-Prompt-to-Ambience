/**
 * Aether Mixer — 动态声学合成器 (Procedural Synthesis)
 * 9 轨：rain, fire, wind, waves, birds, thunder, cafe, train, white_noise
 * 粉红噪音基底、LFO 调制、实时滤波。未生成场景前权重全 0，绝对静音。
 */
import { useRef, useEffect, useCallback } from 'react';

const TRACK_KEYS = ['rain', 'fire', 'wind', 'waves', 'birds', 'thunder', 'cafe', 'train', 'white_noise'];

/** 将 mix 对象清洗为 0–1，键名小写 */
export function sanitizeMix(mix) {
  const out = {};
  for (const k of TRACK_KEYS) {
    const v = mix?.[k] ?? mix?.[k.toLowerCase()] ?? 0;
    out[k] = Math.min(1, Math.max(0, Number(v) || 0));
  }
  return out;
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
      filter.frequency.value = 180;
      filter.Q.value = 0.5;
      break;
    case 'cafe':
      filter.type = 'bandpass';
      filter.frequency.value = 600;
      filter.Q.value = 1;
      break;
    case 'train':
      filter.type = 'lowpass';
      filter.frequency.value = 250;
      filter.Q.value = 0.7;
      break;
    case 'birds':
      filter.type = 'bandpass';
      filter.frequency.value = 3200;
      filter.Q.value = 2;
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

export function useAetherAudio() {
  const ctxRef = useRef(null);
  const tracksRef = useRef({});
  const masterRef = useRef(null);
  const mixRef = useRef({});

  const init = useCallback(() => {
    if (ctxRef.current) return ctxRef.current;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    ctxRef.current = ctx;
    const master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);
    masterRef.current = master;

    TRACK_KEYS.forEach((key) => {
      const { gainNode, start } = createTrackNodes(ctx, key);
      gainNode.connect(master);
      tracksRef.current[key] = { gainNode, start };
    });
    return ctx;
  }, []);

  /** 应用混音配置；未传入 mix 时保持当前（用于仅改单轨） */
  const applyMix = useCallback((mix) => {
    const sanitized = mix ? sanitizeMix(mix) : mixRef.current;
    mixRef.current = sanitized;
    const tracks = tracksRef.current;
    if (!tracks) return;
    TRACK_KEYS.forEach((k) => {
      const g = tracks[k]?.gainNode?.gain;
      // Slightly hotter output: the procedural sources are subtle by nature.
      if (g) g.setTargetAtTime(sanitized[k] * 0.5, 0, 0.05); // 0.05 ≈ 50ms
    });
  }, []);

  /** 设置单轨增益 0–1，实时反馈 <50ms */
  const setTrackGain = useCallback((key, value) => {
    const v = Math.min(1, Math.max(0, Number(value) || 0));
    mixRef.current = { ...mixRef.current, [key]: v };
    const g = tracksRef.current[key]?.gainNode?.gain;
    if (g) g.setTargetAtTime(v * 0.5, 0, 0.05);
  }, []);

  const startedRef = useRef(false);

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
