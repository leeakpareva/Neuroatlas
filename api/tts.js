// NAVADA Atlas guided-tour voice — Vercel Node.js serverless function.
// Proxies text to xAI (Grok) TTS so the XAI_API_KEY never reaches the browser.
// Must be a Node handler (export default (req,res)) — the edge (req)=>Response
// signature silently hangs to a 60s timeout on this runtime.
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const key = process.env.XAI_API_KEY;
  if (!key) return res.status(502).json({ error: 'no_xai_key' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
  const text = String((body && body.text) || '').slice(0, 800);
  if (!text) return res.status(400).json({ error: 'no_text' });

  try {
    const r = await fetch('https://api.x.ai/v1/tts', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language: 'en' }),
    });
    if (!r.ok) {
      const detail = await r.text();
      return res.status(502).json({ error: 'xai_' + r.status, detail: detail.slice(0, 160) });
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(502).json({ error: String(e) });
  }
}
