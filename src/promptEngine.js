/**
 * Prompt Engine v1.1 — Industrial-grade scene prompt builder
 * Ported from the Python reference implementation.
 * Ensures consistent, high-quality, cinematic scene images via Imagen 4.0.
 */

// --------------- Style & Guard ---------------

const STYLE_CORE = `\
Interpreted in a restrained, quiet, cinematic way.
Movement minimal and calm.
Colors naturally subdued and desaturated.
Light soft and diffused, never harsh.
Composition simplified and uncluttered.
If the scene implies high energy, vividness, chaos, or spectacle, reinterpret it as quiet, minimal, and subdued.

Cinematic realism, photo-like.
Slow living aesthetic. Subtle emotional tone.
Minimalist composition with strong negative space.
Eye-level camera, wide or medium-wide framing.
Soft depth of field. Film-like desaturated color grading.
Gentle warm–cool contrast. Calm atmosphere.
Poetic realism. Jazz album cover energy.
Leave a clean title-safe area (no text added), preserve negative space.`;

const NEGATIVE_GUARD = `\
Hard constraints (must not):
No vivid saturated colors. No harsh high contrast lighting.
No dramatic action, chaos, explosions, crowds, or spectacle.
No commercial/advertising look. No glossy product shot.
No illustration, painterly texture, CGI look, or graphic design style.
No cluttered composition. No exaggerated perspective.
No logos, watermarks, subtitles, readable text, or UI elements.`;

// --------------- Scene Sanitizer ---------------

const REPLACEMENTS = [
    [/\bexplod(ing|es|ed)?\b/gi, 'distant quiet aftermath'],
    [/\bcyberpunk\b/gi, 'modern city at dusk with subtle glow'],
    [/\bneon\b/gi, 'muted signage glow'],
    [/\blasers?\b/gi, 'soft ambient light'],
    [/\banime\b/gi, 'cinematic realism'],
    [/\bhyper\s*color(ful)?\b/gi, 'naturally subdued colors'],
    [/\bfireworks?\b/gi, 'soft distant lights'],
    [/\bconcert\b|\bedm\b|\bnightclub\b/gi, 'quiet late-night interior ambience'],
    [/\bcrowd(s)?\b/gi, 'few distant silhouettes'],
    [/\bfight\b|\bbrawl\b|\bviolence\b/gi, 'tense stillness, no action'],
    [/\bparty\b/gi, 'calm gathering'],
    [/\bglossy\b|\bcommercial\b|\bad\b|\badvertising\b/gi, 'documentary film still'],
    [/\bferrari\b|\blamborghini\b/gi, 'unbranded vehicle'],
    [/\btypography\b|\btitle\b|\btext\b|\blog[o]?\b|\bwatermark\b/gi, 'no text, no logos'],
    [/\bsaturated\b/gi, 'desaturated'],
    [/\bhigh contrast\b|\bharsh\b/gi, 'soft diffused'],
];

function sanitizeScene(userScene) {
    let s = userScene.trim().replace(/\s+/g, ' ');
    for (const [pattern, repl] of REPLACEMENTS) {
        s = s.replace(pattern, repl);
    }
    if (s.length > 220) {
        s = s.slice(0, 220).trimEnd() + '...';
    }
    return s;
}

/**
 * Build the final Imagen prompt from a raw user scene description.
 * Applies sanitization + style core + negative guard.
 */
export function buildImagePrompt(userScene) {
    const scene = sanitizeScene(userScene);
    return `Scene seed (do not over-literalize): ${scene}.

${STYLE_CORE}

${NEGATIVE_GUARD}`;
}

// --------------- Image Compression ---------------

const MAX_DECODED_BYTES = 4_000_000; // 4 MB target (safely under 5 MB API limit)

/**
 * Estimate the decoded byte size of a base64 string.
 * base64 encodes 3 bytes into 4 characters, so decoded ≈ length * 3/4.
 */
function estimateDecodedSize(b64String) {
    // Account for padding characters
    let padding = 0;
    if (b64String.endsWith('==')) padding = 2;
    else if (b64String.endsWith('=')) padding = 1;
    return Math.floor((b64String.length * 3) / 4) - padding;
}

/**
 * Compress a base64 data URL to stay under MAX_DECODED_BYTES.
 * Converts PNG → JPEG and progressively reduces quality/resolution until it fits.
 */
function compressDataUrl(dataUrl) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            let width = img.naturalWidth;
            let height = img.naturalHeight;
            let quality = 0.82;

            const compress = () => {
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                const jpeg = canvas.toDataURL('image/jpeg', quality);

                // Estimate the actual decoded byte size of the base64 payload
                const b64Payload = jpeg.slice(jpeg.indexOf(',') + 1);
                const decodedSize = estimateDecodedSize(b64Payload);

                if (decodedSize <= MAX_DECODED_BYTES || (quality <= 0.3 && width <= 800)) {
                    console.info(`[Imagen] Compressed to ${(decodedSize / 1_000_000).toFixed(2)} MB (q=${quality.toFixed(2)}, ${width}×${height})`);
                    resolve(jpeg);
                    return;
                }

                // Reduce quality first, then scale down
                if (quality > 0.5) {
                    quality -= 0.1;
                } else {
                    quality = Math.max(0.3, quality - 0.05);
                    width = Math.round(width * 0.75);
                    height = Math.round(height * 0.75);
                }
                compress();
            };

            compress();
        };
        img.onerror = () => {
            // If loading fails, return original
            resolve(dataUrl);
        };
        img.src = dataUrl;
    });
}

/**
 * Generate an image via Imagen 4.0 REST API.
 * Returns a data URL (image/jpeg base64, compressed to <5 MB) on success, or null on failure.
 */
export async function generateImage(apiKey, scenePrompt) {
    const prompt = buildImagePrompt(scenePrompt);

    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey,
            },
            body: JSON.stringify({
                instances: [{ prompt }],
                parameters: {
                    sampleCount: 1,
                    aspectRatio: '16:9',
                },
            }),
        }
    );

    const data = await res.json();

    if (!res.ok || data?.error) {
        console.warn('[Imagen] Image generation failed:', data?.error?.message || res.status);
        return null;
    }

    // Extract base64 image bytes from the response
    const b64 = data?.predictions?.[0]?.bytesBase64Encoded;
    if (!b64) {
        console.warn('[Imagen] No image data in response');
        return null;
    }

    const rawDataUrl = `data:image/png;base64,${b64}`;

    // Always compress if the decoded size exceeds our target (4 MB)
    const decodedSize = estimateDecodedSize(b64);
    if (decodedSize > MAX_DECODED_BYTES) {
        console.info(`[Imagen] Raw image is ${(decodedSize / 1_000_000).toFixed(2)} MB, compressing…`);
        return compressDataUrl(rawDataUrl);
    }
    return rawDataUrl;
}
