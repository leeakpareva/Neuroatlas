// NAVADA NeuroAtlas — Vercel edge function. Port of server.py's GET /api/health.
export const config = { runtime: 'edge' };

const hasKey = () => Boolean(process.env.NVIDIA_API_KEY || process.env.ANTHROPIC_API_KEY);
const defaultModel = () =>
  process.env.NVIDIA_API_KEY
    ? process.env.NAVADA_TUTOR_MODEL || 'meta/llama-3.3-70b-instruct'
    : process.env.NAVADA_TUTOR_MODEL || 'claude-sonnet-4-6';

export default function handler() {
  return new Response(JSON.stringify({ ai: hasKey(), model: defaultModel() }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
