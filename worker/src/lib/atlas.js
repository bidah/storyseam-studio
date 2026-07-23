// Atlas Cloud provider — the third generation backend beside Higgsfield and
// fal. Same BYOK model as fal (worker/src/lib/fal.js): the user's own Atlas
// Cloud API key lives in the browser's localStorage only and rides per-request
// as `x-atlas-key` (see src/lib/atlasKey.js) — never persisted server-side. The
// ATLAS_KEY env secret is an optional operator fallback (dev / single-tenant).
//
// Unlike fal's queue API, Atlas is a single prediction API
// (https://www.atlascloud.ai/docs): POST /api/v1/model/generateImage or
// /generateVideo with a `model` field → { data: { id } }, then
// GET /api/v1/model/prediction/<id> until status leaves "processing"
// (completed | failed | timeout); outputs land in `data.outputs[]` as URLs.
//
// Models are a CURATED registry mirroring the fal one — Atlas hosts 400+
// endpoints with per-model input schemas, so we pin the pipeline's models and
// map our settings onto each schema explicitly. Catalog ids are namespaced
// `atlas:` so they can never collide with Higgsfield or fal ids in the shared
// model pickers / stored settings.

const ATLAS_API = "https://api.atlascloud.ai/api/v1";

export const ATLAS_MODEL_PREFIX = "atlas:";
export const isAtlasModel = (id) => typeof id === "string" && id.startsWith(ATLAS_MODEL_PREFIX);

// Curated registry. Image entries: `endpoint` for text-to-image, `editEndpoint`
// when reference images ride along (Atlas splits those into sibling models —
// the edit model takes an `images: [url]` array). Video entries:
// `t2vEndpoint` / `i2vEndpoint` (the i2v model takes the start frame as
// `image`), picked by whether a start frame / reference is present.
export const ATLAS_IMAGE_MODELS = [
  {
    id: "atlas:google/nano-banana-2",
    label: "Nano Banana 2 · Atlas",
    endpoint: "google/nano-banana-2/text-to-image",
    editEndpoint: "google/nano-banana-2/edit",
  },
];

export const ATLAS_VIDEO_MODELS = [
  {
    id: "atlas:bytedance/seedance-2.0-fast",
    label: "Seedance 2.0 Fast · Atlas",
    t2vEndpoint: "bytedance/seedance-2.0-fast/text-to-video",
    i2vEndpoint: "bytedance/seedance-2.0-fast/image-to-video",
  },
];

export function atlasModelEntry(id) {
  return [...ATLAS_IMAGE_MODELS, ...ATLAS_VIDEO_MODELS].find((m) => m.id === id) || null;
}

// Picker-shaped catalog entries ({ id, label, provider }) for one media kind.
export function atlasCatalog(kind) {
  const list = kind === "video" ? ATLAS_VIDEO_MODELS : ATLAS_IMAGE_MODELS;
  return list.map(({ id, label }) => ({ id, label, provider: "atlas" }));
}

// Attach-route gate for agent-supplied Atlas result URLs (mirrors
// isAllowedFalMediaUrl). Result bytes come off Atlas' own hosts; the /poll path
// doesn't need this gate because it reads the URL from the authenticated
// prediction response.
export function isAllowedAtlasMediaUrl(u) {
  try {
    const url = new URL(String(u || ""));
    if (url.protocol !== "https:") return false;
    const h = url.hostname;
    return h === "atlascloud.ai" || h.endsWith(".atlascloud.ai");
  } catch {
    return false;
  }
}

// The aspect-ratio enums differ per model family: Nano Banana 2 accepts the
// full picker set; Seedance's `ratio` field is narrower and has an "adaptive"
// mode (match the first-frame image / prompt).
const IMAGE_ASPECTS = new Set(["21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16"]);
const VIDEO_RATIOS = new Set(["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"]);
export const atlasImageAspect = (a) => (IMAGE_ASPECTS.has(a) ? a : "16:9");
export const atlasVideoRatio = (a, hasStartFrame) =>
  VIDEO_RATIOS.has(a) ? a : hasStartFrame ? "adaptive" : "16:9";

async function atlasFetch(key, path, init = {}) {
  if (!key) throw new Error("No Atlas Cloud API key on this request");
  return fetch(`${ATLAS_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${key}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
}

async function atlasErrorText(res) {
  try {
    const body = await res.json();
    const d = body?.error ?? body?.message ?? body?.msg ?? body?.detail ?? body?.data?.error;
    if (typeof d === "string") return d;
    if (d) return JSON.stringify(d);
  } catch { /* non-JSON body */ }
  return "";
}

// Responses may wrap the prediction under `data` ({ code, data: {...} }) or
// return it bare — normalize before reading id/status/outputs.
const unwrap = (j) => (j && typeof j === "object" && j.data && typeof j.data === "object" ? j.data : j || {});

// Submit one prediction. `kind` picks the route (generateImage / generateVideo);
// `endpoint` is the Atlas model id and rides in the body as `model`. Returns the
// prediction id used by atlasPoll.
export async function atlasSubmit(key, kind, endpoint, input) {
  const res = await atlasFetch(key, kind === "video" ? "/model/generateVideo" : "/model/generateImage", {
    method: "POST",
    body: JSON.stringify({ model: endpoint, ...(input || {}) }),
  });
  if (!res.ok) {
    const detail = await atlasErrorText(res);
    throw new Error(`Atlas submit failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  const p = unwrap(await res.json());
  const predictionId = p?.id ? String(p.id) : "";
  if (!predictionId) throw new Error("Atlas submit returned no prediction id");
  return { predictionId };
}

// One poll tick for a prediction:
//   { done: false }                        — still processing
//   { done: true, url, output }            — completed, first output URL picked
//   { done: true, failed: true, error }    — failed / timeout
// Throws on transient transport errors (caller keeps the record processing).
export async function atlasPoll(key, predictionId) {
  const res = await atlasFetch(key, `/model/prediction/${encodeURIComponent(String(predictionId))}`);
  if (!res.ok) {
    const detail = await atlasErrorText(res);
    throw new Error(`Atlas prediction failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  const p = unwrap(await res.json());
  const status = String(p?.status || "").toLowerCase();
  if (!status || status === "processing" || status === "pending" || status === "starting") {
    return { done: false };
  }
  if (status !== "completed") {
    return { done: true, failed: true, error: String(p?.error || `Atlas prediction ${status}`) };
  }
  // Outputs come from the authenticated prediction response (not a client), so
  // https is the only constraint — Atlas may serve results from any CDN host.
  const url = (Array.isArray(p?.outputs) ? p.outputs : [])
    .find((u) => typeof u === "string" && u.startsWith("https://")) || "";
  return { done: true, url, output: p };
}
