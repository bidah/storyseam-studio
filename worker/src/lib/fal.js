// fal.ai provider — the second generation backend beside Higgsfield. Unlike
// Higgsfield (per-user OAuth token via MCP), fal is a plain HTTP API keyed by
// the USER'S OWN fal key (BYOK): the browser keeps it in localStorage only and
// stamps it on each request as `x-fal-key` (see src/lib/falKey.js) — we never
// persist it server-side. The FAL_KEY env secret is an optional operator
// fallback (dev / single-tenant). No refresh, no MCP handshake — jobs go
// through the queue API (https://queue.fal.run): submit → poll status → fetch
// result. See https://fal.ai/docs.
//
// Every function below takes that per-request `key` string, so which fal
// account pays follows the request, per user.
//
// Models are a CURATED registry (below), not runtime discovery — fal hosts
// thousands of endpoints with per-endpoint input schemas, so we pin the ones the
// pipeline actually uses and map our settings onto each schema explicitly.
// Catalog ids are namespaced with a `fal:` prefix so they can never collide
// with a Higgsfield model id in the shared model pickers / stored settings.

const FAL_QUEUE = "https://queue.fal.run";

export const FAL_MODEL_PREFIX = "fal:";
export const isFalModel = (id) => typeof id === "string" && id.startsWith(FAL_MODEL_PREFIX);

// Curated registry. Image entries: `endpoint` for text-to-image, `editEndpoint`
// when reference images ride along (fal splits those into separate endpoints).
// Video entries: `t2vEndpoint` / `i2vEndpoint`, picked by whether a start frame
// (or any image reference) is present.
export const FAL_IMAGE_MODELS = [
  {
    id: "fal:fal-ai/nano-banana-pro",
    label: "Nano Banana Pro · fal",
    endpoint: "fal-ai/nano-banana-pro",
    editEndpoint: "fal-ai/nano-banana-pro/edit",
  },
];

export const FAL_VIDEO_MODELS = [
  {
    id: "fal:bytedance/seedance-2.0/fast",
    label: "Seedance 2.0 Fast · fal",
    t2vEndpoint: "bytedance/seedance-2.0/fast/text-to-video",
    i2vEndpoint: "bytedance/seedance-2.0/fast/image-to-video",
  },
];

export function falModelEntry(id) {
  return [...FAL_IMAGE_MODELS, ...FAL_VIDEO_MODELS].find((m) => m.id === id) || null;
}

// Picker-shaped catalog entries ({ id, label, provider }) for one media kind.
export function falCatalog(kind) {
  const list = kind === "video" ? FAL_VIDEO_MODELS : FAL_IMAGE_MODELS;
  return list.map(({ id, label }) => ({ id, label, provider: "fal" }));
}

// Result bytes only ever come off fal's own media CDN (mirrors Higgsfield's
// isAllowedMediaUrl — these URLs transit clients and agent scripts, so pin them).
export function isAllowedFalMediaUrl(u) {
  try {
    const url = new URL(String(u || ""));
    if (url.protocol !== "https:") return false;
    const h = url.hostname;
    return h === "fal.media" || h.endsWith(".fal.media");
  } catch {
    return false;
  }
}

// Queue request URLs are addressed by the APP id (owner/alias — the first two
// path segments), not the full endpoint subpath: a job submitted to
// `bytedance/seedance-2.0/fast/text-to-video` is polled at
// `.../bytedance/seedance-2.0/requests/<id>/status`.
const queueBase = (endpoint) => String(endpoint).split("/").slice(0, 2).join("/");

async function falFetch(key, url, init = {}) {
  if (!key) throw new Error("No fal API key on this request");
  return fetch(url, {
    ...init,
    headers: {
      authorization: `Key ${key}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
}

// fal's error bodies put the message under `detail` (string, or a list of
// validation objects with `msg`).
async function falErrorText(res) {
  try {
    const body = await res.json();
    const d = body?.detail ?? body?.error ?? body?.message;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) return d.map((e) => e?.msg || JSON.stringify(e)).join("; ");
    if (d) return JSON.stringify(d);
  } catch { /* non-JSON body */ }
  return "";
}

// Submit a job to the queue. Returns the request id used by falPoll.
export async function falSubmit(key, endpoint, input) {
  const res = await falFetch(key, `${FAL_QUEUE}/${endpoint}`, {
    method: "POST",
    body: JSON.stringify(input || {}),
  });
  if (!res.ok) {
    const detail = await falErrorText(res);
    throw new Error(`fal submit failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  const data = await res.json();
  const requestId = data?.request_id;
  if (!requestId) throw new Error("fal submit returned no request_id");
  return { requestId };
}

// Pull the primary media URL out of a fal result payload. Shapes vary by
// endpoint (`images: [{url}]`, `video: {url}`, `audio: {url}`) — read the
// explicit fields first, then fall back to a shallow scan for fal.media URLs.
export function falResultMediaUrl(out) {
  const o = out && typeof out === "object" ? out : {};
  const explicit = [
    o.images?.[0]?.url,
    o.video?.url,
    o.image?.url,
    o.audio?.url,
    o.audio_file?.url,
  ].filter((u) => typeof u === "string" && isAllowedFalMediaUrl(u));
  if (explicit.length) return explicit[0];
  const found = [];
  const walk = (v, depth = 0) => {
    if (!v || depth > 5) return;
    if (typeof v === "string") { if (isAllowedFalMediaUrl(v)) found.push(v); return; }
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    if (typeof v === "object") for (const x of Object.values(v)) walk(x, depth + 1);
  };
  walk(o);
  return found[0] || "";
}

// One poll tick for a queued job:
//   { done: false }                        — still IN_QUEUE / IN_PROGRESS
//   { done: true, url, output }            — completed, primary media URL picked
//   { done: true, failed: true, error }    — job failed (queue 422 detail)
// Throws on transient transport errors (caller keeps the record processing).
export async function falPoll(key, endpoint, requestId) {
  const base = queueBase(endpoint);
  const id = encodeURIComponent(String(requestId));
  const stRes = await falFetch(key, `${FAL_QUEUE}/${base}/requests/${id}/status`);
  if (!stRes.ok) {
    const detail = await falErrorText(stRes);
    throw new Error(`fal status failed (${stRes.status})${detail ? `: ${detail}` : ""}`);
  }
  const st = await stRes.json();
  const status = String(st?.status || "").toUpperCase();
  if (status !== "COMPLETED") return { done: false };

  const outRes = await falFetch(key, `${FAL_QUEUE}/${base}/requests/${id}`);
  if (!outRes.ok) {
    // A completed-but-failed job surfaces here (422 with the failure detail).
    const detail = await falErrorText(outRes);
    return { done: true, failed: true, error: detail || `fal job failed (${outRes.status})` };
  }
  const output = await outRes.json();
  return { done: true, url: falResultMediaUrl(output), output };
}
