// Generic loop maker: slices a SEGMENT seconds region from SRC starting at
// START seconds and applies an equal-power crossfade of CROSSFADE seconds at
// the loop seam so playback can loop seamlessly.
//
// Usage: node make_loop.mjs <src.wav> <dst.wav> <startSec> <segmentSec> <crossfadeSec>
import { readFileSync, writeFileSync } from 'node:fs';

const [, , SRC, DST, startStr, segStr, xfStr] = process.argv;
if (!SRC || !DST) {
  console.error('Usage: make_loop.mjs <src.wav> <dst.wav> <startSec> <segmentSec> <crossfadeSec>');
  process.exit(1);
}

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const BPS = 2;
const START_SECONDS = Number(startStr ?? 10);
const SEGMENT_SECONDS = Number(segStr ?? 25);
const CROSSFADE_SECONDS = Number(xfStr ?? 1.5);

const buf = readFileSync(SRC);

function findDataChunk(b) {
  for (let i = 12; i < b.length - 8; i++) {
    if (b[i] === 0x64 && b[i + 1] === 0x61 && b[i + 2] === 0x74 && b[i + 3] === 0x61) {
      const size = b.readUInt32LE(i + 4);
      return { offset: i + 8, size };
    }
  }
  throw new Error('No data chunk found');
}

const { offset, size } = findDataChunk(buf);
const totalFrames = size / (CHANNELS * BPS);
const startFrame = Math.floor(START_SECONDS * SAMPLE_RATE);
const segmentFrames = Math.floor(SEGMENT_SECONDS * SAMPLE_RATE);
const crossfadeFrames = Math.floor(CROSSFADE_SECONDS * SAMPLE_RATE);
if (startFrame + segmentFrames > totalFrames) throw new Error('Source too short');

function readFrame(frame) {
  const p = offset + frame * CHANNELS * BPS;
  return [buf.readInt16LE(p) / 32768, buf.readInt16LE(p + 2) / 32768];
}

const out = Buffer.alloc(segmentFrames * CHANNELS * BPS);
for (let i = 0; i < segmentFrames; i++) {
  let [l, r] = readFrame(startFrame + i);
  if (i >= segmentFrames - crossfadeFrames) {
    const k = (i - (segmentFrames - crossfadeFrames)) / crossfadeFrames;
    const aGain = Math.cos(0.5 * Math.PI * k);
    const bGain = Math.sin(0.5 * Math.PI * k);
    const [hL, hR] = readFrame(startFrame + (i - (segmentFrames - crossfadeFrames)));
    l = l * aGain + hL * bGain;
    r = r * aGain + hR * bGain;
  }
  const p = i * CHANNELS * BPS;
  out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(l * 32767))), p);
  out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(r * 32767))), p + 2);
}

const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + out.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(CHANNELS, 22);
header.writeUInt32LE(SAMPLE_RATE, 24);
header.writeUInt32LE(SAMPLE_RATE * CHANNELS * BPS, 28);
header.writeUInt16LE(CHANNELS * BPS, 32);
header.writeUInt16LE(BPS * 8, 34);
header.write('data', 36);
header.writeUInt32LE(out.length, 40);
writeFileSync(DST, Buffer.concat([header, out]));
console.log(`Wrote ${DST}  ${(segmentFrames / SAMPLE_RATE).toFixed(2)}s`);
