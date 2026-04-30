const DEFAULT_TARGET_W = 1024;
const DEFAULT_TARGET_H = 576; // 16:9

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

async function loadImage(src) {
  const img = new Image();
  img.decoding = 'async';
  img.crossOrigin = 'anonymous';
  img.src = src;
  // decode() is not supported in some older browsers; fall back to onload.
  if (typeof img.decode === 'function') {
    await img.decode();
    return img;
  }
  await new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = (e) => reject(e);
  });
  return img;
}

function drawCover(ctx, img, dw, dh) {
  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;
  if (!sw || !sh) throw new Error('Invalid image dimensions.');

  const scale = Math.max(dw / sw, dh / sh);
  const cw = Math.ceil(dw / scale);
  const ch = Math.ceil(dh / scale);
  const sx = Math.floor((sw - cw) / 2);
  const sy = Math.floor((sh - ch) / 2);

  ctx.clearRect(0, 0, dw, dh);
  ctx.drawImage(img, sx, sy, cw, ch, 0, 0, dw, dh);
}

function laplacianVariance(imageData) {
  // Simple, fast sharpness proxy: variance of Laplacian over luma.
  // Returns a non-negative number; larger == sharper.
  const { data, width: w, height: h } = imageData;
  if (!w || !h) return 0;

  const luma = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    luma[p] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  let sum = 0;
  let sumSq = 0;
  let count = 0;

  // 4-neighbor Laplacian: L = 4*c - (n+s+e+w)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const c = luma[i];
      const lap =
        4 * c -
        (luma[i - 1] + luma[i + 1] + luma[i - w] + luma[i + w]);
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }

  if (count <= 1) return 0;
  const mean = sum / count;
  const variance = sumSq / count - mean * mean;
  return Math.max(0, variance);
}

async function canvasToDataUrl(canvas, type = 'image/webp', quality = 0.92) {
  // Safari has partial webp support depending on version; fall back to png.
  try {
    return canvas.toDataURL(type, quality);
  } catch {
    return canvas.toDataURL('image/png');
  }
}

export async function prepareImageToSpec(src, targetWidth = DEFAULT_TARGET_W, targetHeight = DEFAULT_TARGET_H) {
  const img = await loadImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D context unavailable.');

  // Prefer crisp resampling when possible.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  drawCover(ctx, img, targetWidth, targetHeight);

  // Compute sharpness on a downsampled probe to keep it cheap.
  const probeW = clamp(Math.round(targetWidth / 2), 256, 640);
  const probeH = Math.round((probeW * targetHeight) / targetWidth);
  const probe = document.createElement('canvas');
  probe.width = probeW;
  probe.height = probeH;
  const pctx = probe.getContext('2d', { alpha: false });
  if (!pctx) throw new Error('Canvas 2D context unavailable.');
  pctx.imageSmoothingEnabled = true;
  pctx.imageSmoothingQuality = 'high';
  pctx.drawImage(canvas, 0, 0, probeW, probeH);
  const sharpness = laplacianVariance(pctx.getImageData(0, 0, probeW, probeH));

  const dataUrl = await canvasToDataUrl(canvas);
  return { dataUrl, sharpness, width: targetWidth, height: targetHeight };
}

/**
 * Generate an image with deterministic output constraints:
 * - Validates aspect ratio/size by re-rendering to target spec (cover crop)
 * - Measures sharpness; retries if below threshold
 *
 * Pass a `generate()` that returns a source string usable by <img src>.
 * That can be a remote URL, a data URL, or a public asset path.
 */
export async function generateImageWithValidation({
  generate,
  targetWidth = DEFAULT_TARGET_W,
  targetHeight = DEFAULT_TARGET_H,
  maxAttempts = 3,
  minSharpness = 80,
}) {
  let last = null;
  for (let i = 0; i < maxAttempts; i++) {
    const src = await generate(i);
    const out = await prepareImageToSpec(src, targetWidth, targetHeight);
    last = out;
    if (out.sharpness >= minSharpness) return out;
  }
  // If everything fails, return the best/last attempt rather than nothing.
  return last;
}

