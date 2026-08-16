const MODEL = 'imagen-3.0-generate-002';

async function callImagen(prompt, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:predict?key=${apiKey}`;
  const payload = {
    instances: [
      { prompt: prompt }
    ],
    parameters: {
      sampleCount: 1,
      aspectRatio: "16:9"
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok || data?.error) {
    const error = new Error(data?.error?.message || `Gemini Imagen API ${res.status}`);
    error.status = res.status || 500;
    throw error;
  }

  const base64Bytes = data?.predictions?.[0]?.bytesBase64Encoded;
  if (!base64Bytes || typeof base64Bytes !== 'string') {
    const error = new Error('No image returned from Gemini Imagen');
    error.status = 502;
    throw error;
  }

  return `data:image/jpeg;base64,${base64Bytes}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'Method not allowed' } });
    return;
  }

  // vite config middleware is running in plain node, so process.env might be missing vite env vars
  let apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    try {
      const { loadEnv } = await import('vite');
      const env = loadEnv('development', process.cwd(), '');
      apiKey = env.GEMINI_API_KEY || env.VITE_GEMINI_API_KEY || '';
    } catch (e) {
      // ignore
    }
  }

  if (!apiKey) {
    res.status(500).json({ error: { message: 'Server missing GEMINI_API_KEY' } });
    return;
  }

  const prompt = String(req.body?.prompt || '').trim();
  if (prompt.length < 2) {
    res.status(400).json({ error: { message: 'Prompt is too short' } });
    return;
  }

  try {
    const dataUrl = await callImagen(prompt, apiKey);
    res.status(200).json({ dataUrl });
  } catch (e) {
    res.status(e?.status || 500).json({
      error: { message: e?.message || 'Image generation failed' },
    });
  }
}
