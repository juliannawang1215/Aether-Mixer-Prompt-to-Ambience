const MODEL = 'gemini-2.5-flash';

const SYSTEM_PROMPT = `You are an atmosphere designer. For the user's scene description, output a JSON object with:
- imagePrompt: detailed English image prompt (lighting, ambiance, texture, no people), one paragraph.
- mix: object with keys rain,fire,wind,waves,birds,thunder,cafe,train,white_noise,office,city,forest,stream. Each value 0.0 to 1.0. Only set non-zero values for sounds that genuinely fit the scene. Use "office" for indoor workplace ambiences (HVAC, distant keyboards), "city" for outdoor urban/street/traffic ambiences, "forest" for woodland / birds / dawn-chorus beds, and "stream" for running water / rivers / brooks. "waves" remains for ocean / surf only.
- title: a short, evocative English title, 1–3 words.
- tags: array of 2–6 short English atmosphere tags.
Output ONLY valid JSON, no markdown.`;

async function callGemini(prompt, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{ parts: [{ text: `${SYSTEM_PROMPT}\n\nUser: ${prompt}` }] }],
    generationConfig: { responseMimeType: 'application/json' },
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
    const error = new Error(data?.error?.message || `Gemini API ${res.status}`);
    error.status = res.status || 500;
    throw error;
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text || typeof text !== 'string') {
    const error = new Error('No content returned from Gemini');
    error.status = 502;
    throw error;
  }

  return text;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'Method not allowed' } });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
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
    const text = await callGemini(prompt, apiKey);
    res.status(200).json({ text });
  } catch (e) {
    res.status(e?.status || 500).json({
      error: { message: e?.message || 'Scene generation failed' },
    });
  }
}
