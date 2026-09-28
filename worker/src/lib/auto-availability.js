// Is Auto available right now? — the kill switch plus the platform keys.
//
// Auto runs on StorySeam's own keys (ADR 0003), so every Film is StorySeam's
// cost and pausing it is a platform concern. The kill switch is a KV key, not a
// var, so it can be flipped WITHOUT a redeploy:
//
//   pause:   npx wrangler kv key put --binding AUTH_KV --remote auto:paused "<reason>"
//   resume:  npx wrangler kv key delete --binding AUTH_KV --remote auto:paused
//
// (run from worker/). The value is shown to authors as the reason; "1"/"true"
// get a generic line. `AUTO_PAUSED` as a var is honoured too, for local dev.
//
// The switch pauses NEW jobs only: whatever starts an Auto job must call
// autoAvailable() and refuse on !ok; a job already running never consults it,
// so existing jobs finish.

export const AUTO_PAUSE_KEY = "auto:paused";

// Secret name → what it pays for. Both are Worker secrets a human sets.

export const AUTO_KEYS = {
  FAL_KEY: "fal (sheets, clips, the sitting)",
  DAYTONA_API_KEY: "Daytona (cutting and scoring)",
};

// No key for the writing steps: every writer a new Film can pick (lib/writer.js)
// runs through the Worker's AI binding — Qwen and Kimi on Workers AI, Claude on
// AI Gateway's Unified Billing. Only the legacy AUTO_WRITER (a job from before
// the writer was explicit) may still need GROQ_API_KEY / CEREBRAS_API_KEY.
const requiredKeys = () => AUTO_KEYS;

const GENERIC_PAUSE = "Auto is paused for now — new Films can't start. Films already running will finish.";

function pauseReason(v) {
  const s = String(v ?? "").trim();
  if (!s || s === "0" || /^false$/i.test(s)) return null;
  return s === "1" || /^true$/i.test(s) ? GENERIC_PAUSE : s;
}

// → { ok, reason, paused, keys: {NAME: bool}, missing: [NAME] }. Never throws;
// a KV read failure is treated as "not paused" (the keys check still applies).
export async function autoAvailable(env) {
  const keys = Object.fromEntries(Object.keys(requiredKeys(env)).map((k) => [k, !!env?.[k]]));
  const missing = Object.keys(keys).filter((k) => !keys[k]);

  let paused = pauseReason(env?.AUTO_PAUSED);
  if (!paused && env?.AUTH_KV) {
    try { paused = pauseReason(await env.AUTH_KV.get(AUTO_PAUSE_KEY)); } catch { /* treat as not paused */ }
  }

  if (paused) return { ok: false, reason: paused, paused: true, keys, missing };
  if (missing.length) {
    return {
      ok: false,
      reason: "Auto isn't set up on this server yet — new Films can't start.",
      paused: false,
      keys,
      missing,
    };
  }
  return { ok: true, reason: null, paused: false, keys, missing };
}
