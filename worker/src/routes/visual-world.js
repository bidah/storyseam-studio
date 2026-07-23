// Visual World endpoints (/api/visual-world*). The VISUAL counterpart of the
// (written) World tab: a chat-style image generator to explore how the series'
// characters and places look, plus a reference-lineage canvas. Prompt-engineered,
// bulk image generation via the Higgsfield MCP (Nano Banana Pro by default).
//
// Backed by the R2 doc `state/<pid>/visual-world.json` (whole-document
// read-modify-write, like world.json) and R2 image bytes under the `visual`
// media kind (served at `/visual-media/<file>`). Two writers share the store:
//   1. the in-app composer (this file's /generate + /poll), and
//   2. the flue agent (the /image attach route, like /api/storyboard/image),
// so agent-generated images land on the tab live via the data-channel broadcast.
//
// Generation is ASYNC and spans two requests, exactly like a Higgsfield job:
// POST /generate starts one job per image (status "processing"); GET /poll asks
// job_status for each pending job and, on completion, downloads the bytes into R2
// and flips the record to "ready". The client polls /poll every ~3s while any
// card is processing (mirrors idea-mural's VideoGenView).
import { readDoc, updateDoc, normalizeProjectId } from "../lib/docs.js";
import { putMedia, mediaKey, filesUrl } from "../lib/media.js";
import { ensureImageThumb } from "../lib/proxy.js";
import {
  getHiggsfieldToken,
  forceRefreshHiggsfieldToken,
  mcpToolCall,
  isAllowedMediaUrl,
  HiggsfieldAuthError,
} from "../lib/higgsfield.js";
import {
  isFalModel,
  falCatalog,
  falModelEntry,
  falSubmit,
  falPoll,
  isAllowedFalMediaUrl,
} from "../lib/fal.js";

// The fal key for THIS request: the user's own key (BYOK, stamped by the
// browser as x-fal-key from localStorage — never stored server-side), falling
// back to the operator's optional FAL_KEY env secret (dev / single-tenant).
const reqFalKey = (c) => str(c.req.header("x-fal-key") || c.env.FAL_KEY || "");

/* ------------------------------------------------------------------ *
 * Store shape                                                         *
 * ------------------------------------------------------------------ */

const str = (v) => (v == null ? "" : String(v));
const clampCount = (n) => Math.min(4, Math.max(1, Math.floor(Number(n) || 1)));

// The user's 2D prompt (adapted for stills — style/palette/composition kept, the
// Seedance camera-motion clauses moved to the `video` field). Seeds the library
// so the composer has a real preset to choose from on first use.
const SEED_PROMPTS = [
  {
    id: "preset-2d",
    name: "2D storybook (Whistlewood)",
    builtin: true,
    image:
      "Flat 2D hand-drawn animation, clean confident vector linework, strictly " +
      "limited muted palette of teal, mustard yellow and dusty rose, " +
      "gouache-textured flat painterly backgrounds with subtle paper grain, " +
      "Scandinavian folklore storybook illustration style, soft diffused morning " +
      "light, flat ambient shading with no gradients, minimalist rounded " +
      "character design with simple sparse facial features, strong graphic " +
      "composition with generous negative space. Split of panes when needed " +
      "between front, middle and backgrounds. Cozy, adventurous, slightly " +
      "melancholic Nordic atmosphere. No 3D rendering, no photorealism, no CGI " +
      "shading, no volumetric depth, no oversaturation.",
    video:
      "Slow gentle dolly-in with subtle layered parallax on background planes, " +
      "camera stays flat and 2D-friendly with no orbiting or perspective shifts. " +
      "Smooth hand-drawn 2D animated motion. No hand held camera.",
  },
];

// Sheet prompts: layered on TOP of the style preset when a generation is tagged
// as a character, location, or prop sheet (composer checkboxes / agent skill).
// Editable on the Settings page (PUT /api/visual-world/sheet-prompts).
const SEED_SHEET_PROMPTS = {
  character:
    "Create a contact sheet for this character. The contact sheet should contain " +
    "a full body front facing wide shot, including the feet. A rear facing full " +
    "body wide shot including the feet. And a close-up of the character framed " +
    "from the shoulders up, front facing. Make sure the character is the exact " +
    "same in all poses. The setting is a neutral and minimal environment with a " +
    "ground plane and simplistic scene depth. Even lighting, low contrast, " +
    "natural color palette, lifted shadows and natural color tones. There are no " +
    "division lines, text labels or graphic overlays present",
  location:
    "Create ONE single full-frame image of this location — a clean establishing " +
    "wide shot usable as a background plate for animation shots. Exactly one " +
    "continuous image: never a collage, grid, contact sheet, split frame, or " +
    "multi-panel layout. No characters or people. Frame it like a film " +
    "establishing shot with clear room to stage action in the foreground. Even " +
    "lighting, low contrast, natural color palette, lifted shadows and natural " +
    "color tones. There are no division lines, text labels or graphic overlays " +
    "present",
  prop:
    "Create a prop reference sheet for this object. The sheet should contain a " +
    "front view, a three-quarter view, and a side or back view of the exact " +
    "same prop, plus one close-up of its most distinctive detail. Show the prop " +
    "on its own — no characters, no hands holding it, nothing else in frame — " +
    "resting in a neutral and minimal environment with a simple ground plane. " +
    "The design, proportions, scale, materials, colors and wear must be " +
    "identical in every view. Even lighting, low contrast, natural color " +
    "palette, lifted shadows and natural color tones. There are no division " +
    "lines, text labels or graphic overlays present",
};

function normalizeSheetPrompts(s) {
  const o = s || {};
  return {
    character: str(o.character) || SEED_SHEET_PROMPTS.character,
    location: str(o.location) || SEED_SHEET_PROMPTS.location,
    prop: str(o.prop) || SEED_SHEET_PROMPTS.prop,
  };
}

function emptyVisualWorld() {
  return {
    generatedAt: null,
    source: null,
    settings: { model: "", aspectRatio: "16:9", count: 1, cinematic: false, presetId: "preset-2d" },
    prompts: structuredClone(SEED_PROMPTS),
    sheetPrompts: { ...SEED_SHEET_PROMPTS },
    promptRevisions: [],
    generations: [],
    board: { nodes: [], edges: [], viewport: null },
  };
}

// Every prompt save (style presets and/or sheet prompts, from the composer
// dialog or Settings) snapshots the resulting state as a numbered revision so
// the user can reference "rev N · date" later. Oldest revisions roll off.
const PROMPT_REVISION_CAP = 30;

function normalizePromptRevision(r) {
  const o = r || {};
  return {
    rev: Number.isFinite(+o.rev) ? Math.max(1, Math.round(+o.rev)) : 1,
    ts: str(o.ts),
    prompts: Array.isArray(o.prompts) ? o.prompts.map(normalizePrompt) : [],
    sheetPrompts: normalizeSheetPrompts(o.sheetPrompts),
  };
}

function pushPromptRevision(v) {
  // Older stored visual worlds predate promptRevisions — treat missing as empty.
  const revs = Array.isArray(v.promptRevisions) ? v.promptRevisions : [];
  const last = revs[revs.length - 1];
  const revision = {
    rev: (last?.rev || 0) + 1,
    ts: new Date().toISOString(),
    prompts: structuredClone(v.prompts),
    sheetPrompts: { ...v.sheetPrompts },
  };
  v.promptRevisions = [...revs, revision].slice(-PROMPT_REVISION_CAP);
  return revision;
}

function normalizePrompt(p, i = 0) {
  const o = p || {};
  return {
    id: str(o.id) || `prompt-${Date.now().toString(36)}-${i}`,
    name: str(o.name) || "Untitled prompt",
    image: str(o.image),
    video: str(o.video),
    builtin: !!o.builtin,
  };
}

function normalizeRef(r) {
  const o = r || {};
  const kind = o.kind === "generation" ? "generation" : "library";
  return {
    kind,
    rel: kind === "library" ? str(o.rel) : "",
    genId: kind === "generation" ? str(o.genId) : "",
    url: str(o.url),
  };
}

function normalizeGeneration(g, i = 0) {
  const o = g || {};
  const status = ["processing", "ready", "error"].includes(o.status) ? o.status : "ready";
  return {
    id: str(o.id) || `gen-${Date.now().toString(36)}-${i}`,
    status,
    // "" (Higgsfield, the default) | "fal" — which backend ran this generation.
    // Drives how /poll checks the job (job_status MCP tool vs fal queue API).
    provider: o.provider === "fal" ? "fal" : "",
    // "image" (default) | "video" — which medium this generation is. A video's
    // `file` is an .mp4 served (with range support) from /visual-media/.
    kind: o.kind === "video" ? "video" : "image",
    // The canvas node that produced this generation (a node Run), when any. Lets
    // the Nodes canvas bind a generation back to its originating node + history.
    nodeId: str(o.nodeId),
    prompt: str(o.prompt),
    assembledPrompt: str(o.assembledPrompt),
    model: str(o.model),
    aspectRatio: str(o.aspectRatio) || "16:9",
    presetId: str(o.presetId),
    // "" (plain image) | "character" | "location" | "prop" — this generation was
    // made as a design sheet (the sheet prompt was layered into the assembled
    // prompt). Provenance metadata for filtering + linking to rosters.
    sheetType: ["character", "location", "prop"].includes(o.sheetType) ? o.sheetType : "",
    jobId: str(o.jobId),
    source: str(o.source),
    file: str(o.file),
    thumb: str(o.thumb),
    // Library `rel` once this generation was promoted to the shared asset
    // library (empty = never saved). Lets the UI show a persistent "Saved to
    // library" state after reload instead of re-offering the save.
    savedRel: str(o.savedRel),
    error: str(o.error),
    refs: Array.isArray(o.refs) ? o.refs.map(normalizeRef) : [],
    ts: o.ts || null,
  };
}

// ---- Nodes canvas graph (generator flow) ----
// Each node is a GENERATOR (or a source), not just a moodboard sticker:
//   image / video — carry a prompt + settings + a Run that fires a job, using
//     wired input edges as references. Their run history is `genIds` (newest
//     last); `currentGenId` is the one shown in the node preview.
//   text          — a prompt SOURCE; its text-output feeds downstream prompts.
//   upload        — a source-only holder for an EXISTING generation (the old
//     moodboard sticker). Its output medium mirrors that generation's kind.
// Edges are TYPED and functional (see FLOW_CONNECT_RULES): an image-output →
// image-input edge feeds the source's current image in as a reference; an
// image-output → start-frame edge feeds a video its first frame; a text-output →
// text-input edge inherits the source's prompt text.
const FLOW_NODE_TYPES = new Set(["image", "video", "text", "upload"]);
const FLOW_CONNECT_RULES = {
  "image-output": ["image-input", "start-frame"],
  "video-output": [],
  "text-output": ["text-input"],
};
const clampDuration = (n) => Math.min(15, Math.max(4, Math.round(Number(n) || 5)));

function normalizeNodeSettings(type, s) {
  const o = s || {};
  if (type === "image") {
    return {
      model: str(o.model),
      aspectRatio: str(o.aspectRatio) || "16:9",
      presetId: str(o.presetId),
    };
  }
  if (type === "video") {
    return {
      model: str(o.model),
      aspectRatio: str(o.aspectRatio) || "16:9",
      duration: clampDuration(o.duration),
      generateAudio: !!o.generateAudio,
      presetId: str(o.presetId),
    };
  }
  return {}; // text / upload carry no generation settings
}

function normalizeBoardNode(n) {
  const o = n || {};
  // Legacy moodboard node: `{ id, genId, x, y, w, h }`. Migrate to an `upload`
  // source node holding that generation (source-only display, same as before).
  const legacyGen = str(o.genId);
  const type = FLOW_NODE_TYPES.has(o.type) ? o.type : (legacyGen ? "upload" : "image");
  const genIds = Array.isArray(o.genIds)
    ? o.genIds.map(str).filter(Boolean)
    : (legacyGen ? [legacyGen] : []);
  const currentGenId = str(o.currentGenId) || legacyGen || genIds[0] || "";
  return {
    id: str(o.id),
    type,
    x: Number(o.x) || 0,
    y: Number(o.y) || 0,
    w: o.w != null ? Number(o.w) : null,
    h: o.h != null ? Number(o.h) : null,
    prompt: str(o.prompt),
    settings: normalizeNodeSettings(type, o.settings),
    currentGenId,
    genIds,
  };
}

// Normalize one edge, returning null for an ILLEGAL handle combo (dropped). A
// legacy edge with no handles at all migrates to the old decorative lineage
// (image-output → image-input); any edge that names handles is validated
// strictly against FLOW_CONNECT_RULES so a bad body can't persist a dead edge.
function normalizeBoardEdge(e) {
  const o = e || {};
  let src = str(o.sourceHandle);
  let tgt = str(o.targetHandle);
  if (!src && !tgt) { src = "image-output"; tgt = "image-input"; }
  const allowed = FLOW_CONNECT_RULES[src];
  if (!allowed || !allowed.includes(tgt)) return null;
  return {
    id: str(o.id),
    source: str(o.source),
    sourceHandle: src,
    target: str(o.target),
    targetHandle: tgt,
    createdAt: Number(o.createdAt) || 0,
  };
}

function normalizeRun(r) {
  const o = r || {};
  if (!o.active) return null;
  const arr = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
  return {
    active: true,
    mode: o.mode === "from-here" ? "from-here" : "this",
    runSet: arr(o.runSet),
    started: arr(o.started),
    ready: arr(o.ready),
    errored: arr(o.errored),
    ts: o.ts || null,
  };
}

function normalizeBoard(b) {
  const o = b || {};
  const nodes = Array.isArray(o.nodes)
    ? o.nodes.map(normalizeBoardNode).filter((n) => n.id)
    : [];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = Array.isArray(o.edges)
    ? o.edges.map(normalizeBoardEdge)
        .filter((e) => e && e.id && nodeIds.has(e.source) && nodeIds.has(e.target))
    : [];
  return { nodes, edges, viewport: o.viewport ?? null, run: normalizeRun(o.run) };
}

function normalizeVisualWorld(raw) {
  const base = emptyVisualWorld();
  const w = raw || {};
  base.generatedAt = w.generatedAt ?? null;
  base.source = w.source ?? null;
  if (w.settings && typeof w.settings === "object") {
    base.settings = {
      model: str(w.settings.model),
      aspectRatio: str(w.settings.aspectRatio) || "16:9",
      count: clampCount(w.settings.count),
      cinematic: !!w.settings.cinematic,
      presetId: str(w.settings.presetId) || "preset-2d",
    };
  }
  base.prompts = Array.isArray(w.prompts) && w.prompts.length
    ? w.prompts.map(normalizePrompt)
    : structuredClone(SEED_PROMPTS);
  base.sheetPrompts = normalizeSheetPrompts(w.sheetPrompts);
  base.promptRevisions = Array.isArray(w.promptRevisions) ? w.promptRevisions.map(normalizePromptRevision) : [];
  base.generations = Array.isArray(w.generations) ? w.generations.map(normalizeGeneration) : [];
  base.board = normalizeBoard(w.board);
  return base;
}

const FALLBACK = emptyVisualWorld();
const readVW = async (env, pid) => normalizeVisualWorld(await readDoc(env, pid, "visual-world", null));
const updateVW = (env, pid, mutate) => updateDoc(env, pid, "visual-world", FALLBACK, mutate);

// Decorate a ready generation for consumers:
//   `url`    — the relative serve path (`/visual-media/<file>`) the in-app UI renders.
//   `refUrl` — an ABSOLUTE ungated `/files/...` URL an external generator can fetch,
//              so the flue agent can pass a prior generation back as an
//              `image_references` media (via Higgsfield `media_import_url`). The
//              relative `url` is not fetchable by an anonymous MCP call.
function withUrls(env, pid, gen) {
  return {
    ...gen,
    url: gen.file ? `/visual-media/${gen.file}` : "",
    refUrl: gen.file ? filesUrl(env, mediaKey(pid, "visual", gen.file)) : "",
  };
}

/* ------------------------------------------------------------------ *
 * Higgsfield MCP helpers                                             *
 * ------------------------------------------------------------------ */

// Call an MCP tool, retrying once with a forced token refresh — an expired bearer
// surfaces as a generic tool error, not a 401 (same net as /api/higgsfield/images).
async function mcp(env, userId, token, name, args) {
  try {
    return await mcpToolCall(env, token, name, args);
  } catch (e) {
    if (e instanceof HiggsfieldAuthError) throw e;
    const fresh = await forceRefreshHiggsfieldToken(env, userId);
    if (!fresh) throw e;
    return await mcpToolCall(env, fresh, name, args);
  }
}

// Pull a media/job id out of whatever shape the MCP tool returned. Higgsfield's
// generate_* tools vary: a bare id, `{ id }`, `{ jobId }`, a `{ job_set_id }`, or
// a `{ jobs: [{ id }] }` / `{ generations: [{ id }] }` array (count ≥ 1). We probe
// a broad key set at the top level, one level of object nesting, and the first
// element of any id-bearing array.
const JOB_ID_KEYS = [
  "jobId", "job_id", "id", "job_set_id", "jobSetId",
  "generation_id", "generationId", "media_id", "mediaId",
  "task_id", "taskId", "uuid",
];
function pickIdFrom(obj, keys) {
  if (!obj || typeof obj !== "object") return "";
  for (const k of keys) if (obj[k]) return String(obj[k]);
  return "";
}
function pickId(data, ...extraKeys) {
  if (!data) return "";
  if (typeof data === "string") return data;
  const keys = [...extraKeys, ...JOB_ID_KEYS];
  const top = pickIdFrom(data, keys);
  if (top) return top;
  // One level of object nesting, and the first element of id-bearing arrays.
  for (const nest of ["media", "result", "data", "job", "jobs", "job_set", "generations", "results", "items"]) {
    const inner = data[nest];
    if (Array.isArray(inner)) {
      for (const el of inner) {
        const v = typeof el === "string" ? el : pickIdFrom(el, keys);
        if (v) return v;
      }
    } else if (inner && typeof inner === "object") {
      const v = pickIdFrom(inner, keys);
      if (v) return v;
    }
  }
  return "";
}

// Keys under which job_status echoes the INPUT references we sent (never the
// result). Collecting these would make an image-to-image job "return" its own
// reference — so collectMediaUrls skips them.
const INPUT_MEDIA_KEYS = /^(input_images?|medias|source_?medias?|reference_?images?)$/i;

// Higgsfield's job_status nests the generation under `generation` (or returns it
// bare), and the result media URL's key varies by model — so we deep-collect
// every allowed media URL in the payload and prefer a full-res one over a thumb.
// Input references (params.input_images, etc.) are skipped so they can't be
// mistaken for the output.
function collectMediaUrls(obj, out = [], depth = 0) {
  if (!obj || depth > 7) return out;
  if (typeof obj === "string") { if (isAllowedMediaUrl(obj)) out.push(obj); return out; }
  if (Array.isArray(obj)) { for (const v of obj) collectMediaUrls(v, out, depth + 1); return out; }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      if (INPUT_MEDIA_KEYS.test(k)) continue; // echoed input reference — never the result
      collectMediaUrls(v, out, depth + 1);
    }
    return out;
  }
  return out;
}
function bestMediaUrl(urls) {
  if (!urls.length) return "";
  const isThumb = (u) => /thumb|preview|small|proxy|_min\.|_resize\./i.test(u);
  const isRaw = (u) => /raw|result|original|full|output|\/max|\/hd/i.test(u);
  const pool = urls.filter((u) => !isThumb(u));
  const use = pool.length ? pool : urls;
  return use.find(isRaw) || use[0];
}

// Extract the RESULT media url from a job_status payload. The output lives under
// explicit result fields (normalized `results.rawUrl/minUrl`, or the raw shape's
// `result_url`); we read those first so an echoed input reference can never win.
// Falls back to a deep collect (which skips input-media keys) for odd shapes.
function resultMediaUrl(st) {
  const gen = (st && typeof st === "object" && st.generation && typeof st.generation === "object")
    ? st.generation : st;
  const g = (gen && typeof gen === "object") ? gen : {};
  const results = (g.results && typeof g.results === "object") ? g.results : {};
  const explicit = [
    results.rawUrl, results.url, results.minUrl,          // normalized shape
    g.result_url, g.min_result_url, g.h264_url,           // raw shape (nested)
    st?.result_url, st?.min_result_url, st?.h264_url,     // raw shape (top level)
  ].filter((u) => typeof u === "string" && isAllowedMediaUrl(u));
  if (explicit.length) return bestMediaUrl(explicit);
  return bestMediaUrl(collectMediaUrls(g.results ?? gen ?? st));
}
// job_status lifecycle buckets. A job leaving IN_PROGRESS with a media URL is
// treated as done even if its terminal word isn't in DONE (models vary).
const JOB_IN_PROGRESS = new Set(["in_progress", "queued", "pending", "processing", "running", "started", "created", "waiting"]);
const JOB_FAILED = new Set(["failed", "error", "canceled", "cancelled", "rejected", "nsfw", "blocked", "moderated"]);

// Collect every media-role string anywhere in a models_explore.get payload
// (roles live under `role`/`roles`, sometimes nested in a `medias` array).
function collectRoles(obj, out = new Set(), depth = 0) {
  if (!obj || depth > 6) return out;
  if (Array.isArray(obj)) { for (const v of obj) collectRoles(v, out, depth + 1); return out; }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      if (/^roles?$/i.test(k)) {
        if (typeof v === "string") out.add(v);
        else if (Array.isArray(v)) {
          for (const r of v) {
            if (typeof r === "string") out.add(r);
            else if (r?.role) out.add(String(r.role));
            else if (r?.name) out.add(String(r.name));
          }
        }
      }
      collectRoles(v, out, depth + 1);
    }
  }
  return out;
}

// Resolve the media role to tag reference images with for a given model. Roles
// VARY per model (Nano Banana Pro wants "image"; Seedance wants "image_references"),
// so we ask models_explore.get for the model's allowed roles and pick the first
// of `prefer` that it allows (falling back to any allowed role, then prefer[0]).
// Cached briefly in KV — a wrong role hard-fails the whole generation.
async function resolveMediaRole(env, userId, token, modelId, prefer) {
  let roles = [];
  const cacheKey = `visual:model-roles:${modelId}`;
  try {
    const cached = await env.AUTH_KV.get(cacheKey, "json");
    if (Array.isArray(cached)) roles = cached;
  } catch { /* ignore */ }
  if (!roles.length) {
    try {
      const data = await mcp(env, userId, token, "models_explore", { action: "get", model_id: modelId });
      roles = [...collectRoles(data)];
      try { await env.AUTH_KV.put(cacheKey, JSON.stringify(roles), { expirationTtl: 600 }); } catch { /* best effort */ }
    } catch { /* fall through to prefer[0] */ }
  }
  const hit = prefer.find((p) => roles.includes(p));
  return hit || roles[0] || prefer[0];
}

// Import a reference URL into Higgsfield → a media_id usable in generate_image
// medias[].value.
async function importRef(env, userId, token, url) {
  const data = await mcp(env, userId, token, "media_import_url", { url });
  const id = pickId(data, "media_id", "mediaId", "id");
  if (!id) throw new Error(`Higgsfield media import returned no id for ${url}`);
  return id;
}

// Resolve the image-model catalog (id + label) via models_explore, marking the
// Nano Banana default. Cached briefly in KV. Defensive about the shape.
// NOTE: Higgsfield renames model ids (e.g. nano_banana_flash → nano_banana_2), so
// match Nano Banana loosely (preferring "Pro") and keep the cache short — a stale
// catalog means we'd hand generate_image a dead id.
const NANO_RE = /nano[\s_-]*banana/i;
const PRO_RE = /\bpro\b/i;
const MODELS_CACHE_KEY = "visual:image-models:v2";
async function resolveModels(env, userId, token) {
  try {
    const cached = await env.AUTH_KV.get(MODELS_CACHE_KEY, "json");
    if (cached?.models?.length) return cached;
  } catch { /* ignore cache miss */ }

  const data = await mcp(env, userId, token, "models_explore", { action: "list", type: "image" });
  const raw = Array.isArray(data)
    ? data
    : data?.models || data?.items || data?.image_models || data?.results || [];
  const models = raw
    .map((m) => ({
      id: str(m?.id || m?.model || m?.slug || m?.model_id),
      label: str(m?.name || m?.title || m?.label || m?.display_name || m?.id),
    }))
    .filter((m) => m.id);
  // Prefer a Nano Banana "Pro"; else any Nano Banana; else the first image model.
  const nanos = models.filter((m) => NANO_RE.test(m.label) || NANO_RE.test(m.id));
  const nano = nanos.find((m) => PRO_RE.test(m.label) || PRO_RE.test(m.id)) || nanos[0];
  const defaultId = nano?.id || models[0]?.id || "";
  const out = { models, defaultId };
  try { await env.AUTH_KV.put(MODELS_CACHE_KEY, JSON.stringify(out), { expirationTtl: 600 }); } catch { /* best effort */ }
  return out;
}

// Resolve the VIDEO-model catalog (id + label) via models_explore, marking the
// Seedance default (image-to-video with identity). Same shape/caching as the
// image catalog. Seedance ids also churn, so match loosely and cache short.
const SEEDANCE_RE = /seedance/i;
const VIDEO_MODELS_CACHE_KEY = "visual:video-models:v1";
async function resolveVideoModels(env, userId, token) {
  try {
    const cached = await env.AUTH_KV.get(VIDEO_MODELS_CACHE_KEY, "json");
    if (cached?.models?.length) return cached;
  } catch { /* ignore cache miss */ }

  const data = await mcp(env, userId, token, "models_explore", { action: "list", type: "video" });
  const raw = Array.isArray(data)
    ? data
    : data?.models || data?.items || data?.video_models || data?.results || [];
  const models = raw
    .map((m) => ({
      id: str(m?.id || m?.model || m?.slug || m?.model_id),
      label: str(m?.name || m?.title || m?.label || m?.display_name || m?.id),
    }))
    .filter((m) => m.id);
  // Prefer a Seedance model (best for image-to-video identity); else the first.
  const seed = models.find((m) => SEEDANCE_RE.test(m.label) || SEEDANCE_RE.test(m.id));
  const defaultId = seed?.id || models[0]?.id || "seedance_2_0";
  const out = { models, defaultId };
  try { await env.AUTH_KV.put(VIDEO_MODELS_CACHE_KEY, JSON.stringify(out), { expirationTtl: 600 }); } catch { /* best effort */ }
  return out;
}

/* ------------------------------------------------------------------ *
 * Provider dispatch (Higgsfield MCP + fal queue API)                  *
 * ------------------------------------------------------------------ */

// Resolve the Higgsfield catalog when a token exists, tolerating auth failure
// (⇒ null) so a fal-only setup still works. Non-auth errors rethrow only when
// fal can't cover for the missing catalog.
async function resolveHfCatalog(env, userId, token, kind, falKey) {
  if (!token) return null;
  try {
    return await (kind === "video"
      ? resolveVideoModels(env, userId, token)
      : resolveModels(env, userId, token));
  } catch (e) {
    if (e instanceof HiggsfieldAuthError || falKey) return null;
    throw e;
  }
}

// The merged, provider-tagged model catalog for one media kind. The default
// stays Higgsfield's (Nano Banana Pro / Seedance) when available, else the
// first curated fal model.
function mergeCatalog(falKey, hf, kind) {
  const models = [
    ...(hf?.models || []).map((m) => ({ ...m, provider: "higgsfield" })),
    ...(falKey ? falCatalog(kind) : []),
  ];
  const defaultId = hf?.defaultId || (falKey ? falCatalog(kind)[0]?.id || "" : "");
  return { models, defaultId };
}

// Validate a picked model id against the merged catalog (a stale/renamed id
// falls back to the default) and check its provider is actually usable now.
// Returns the resolved id; throws with a user-facing message otherwise.
function resolveModelChoice(falKey, catalog, picked, token) {
  let model = str(picked);
  if (model && catalog.models.length && !catalog.models.some((m) => m.id === model)) model = "";
  if (!model) model = catalog.defaultId;
  if (!model) throw new Error("Could not resolve a model");
  if (isFalModel(model)) {
    if (!falKey) throw new Error("fal model selected but no fal API key on this request (set yours in Settings)");
  } else if (!token) {
    throw new HiggsfieldAuthError("Higgsfield sign-in required");
  }
  return model;
}

/* ------------------------------------------------------------------ *
 * Node-run reference resolution + job firing (the Nodes canvas)       *
 * ------------------------------------------------------------------ */

// Absolute, ungated /files URL for a ready generation's bytes (importable into
// Higgsfield as a media). Empty when the generation isn't ready.
function genRefUrl(env, pid, gen) {
  return gen?.file ? filesUrl(env, mediaKey(pid, "visual", gen.file)) : "";
}

// Resolve a node's wired inputs into the pieces a generation needs:
//   startFrameUrl — the image-output → start-frame source (video first frame),
//   imageRefUrls  — ordered image-output → image-input sources (references),
//   inheritedText — a text-output → text-input source's prompt (prepended).
// Sources must be READY; unresolved edges are skipped.
function resolveNodeInputs(env, pid, vw, node) {
  const nodeById = new Map(vw.board.nodes.map((n) => [n.id, n]));
  const genById = new Map(vw.generations.map((g) => [g.id, g]));
  const readyUrl = (srcNode) => {
    const g = srcNode?.currentGenId ? genById.get(srcNode.currentGenId) : null;
    return g && g.status === "ready" ? genRefUrl(env, pid, g) : "";
  };
  const inEdges = vw.board.edges
    .filter((e) => e.target === node.id)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  let startFrameUrl = "";
  let inheritedText = "";
  const imageRefUrls = [];
  for (const e of inEdges) {
    const src = nodeById.get(e.source);
    if (!src) continue;
    if (e.targetHandle === "start-frame") {
      startFrameUrl = startFrameUrl || readyUrl(src);
    } else if (e.targetHandle === "image-input") {
      const u = readyUrl(src);
      if (u) imageRefUrls.push(u);
    } else if (e.targetHandle === "text-input") {
      inheritedText = inheritedText || str(src.prompt);
    }
  }
  return { startFrameUrl, imageRefUrls, inheritedText };
}

// Fire ONE generation job for a node (image via generate_image, video via
// generate_video), importing wired references first. Returns the "processing"
// generation record to append (with jobId/kind/nodeId). Throws on a hard MCP
// error — the caller marks the node's run errored. Network only; NO doc writes.
async function fireNodeJob(env, userId, token, falKey, pid, vw, node) {
  const kind = node.type === "video" ? "video" : "image";
  const settings = node.settings || {};
  const { startFrameUrl, imageRefUrls, inheritedText } = resolveNodeInputs(env, pid, vw, node);

  // Assemble the prompt: inherited text (from a Text node), then the preset's
  // style block (image or motion), then the node's own prompt.
  const preset = settings.presetId ? vw.prompts.find((p) => p.id === settings.presetId) : null;
  const presetBlock = kind === "video" ? str(preset?.video) : str(preset?.image);
  const scene = str(node.prompt);
  const assembledPrompt = [inheritedText, presetBlock, scene].filter(Boolean).join("\n\n");
  const aspectRatio = str(settings.aspectRatio) || "16:9";

  const ts = new Date().toISOString();
  const base = {
    id: `gen-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`,
    kind,
    nodeId: node.id,
    prompt: scene,
    assembledPrompt,
    aspectRatio,
    presetId: str(settings.presetId),
    refs: [],
    ts,
  };

  if (kind === "video") {
    const catalog = mergeCatalog(falKey, await resolveHfCatalog(env, userId, token, "video", falKey), "video");
    const model = resolveModelChoice(falKey, catalog, settings.model, token);

    if (isFalModel(model)) {
      // fal Seedance: a single start image rides as `image_url` on the
      // image-to-video endpoint (no multi-reference role system).
      const entry = falModelEntry(model);
      const startUrl = startFrameUrl || imageRefUrls[0] || "";
      const { requestId } = await falSubmit(falKey, startUrl ? entry.i2vEndpoint : entry.t2vEndpoint, {
        prompt: assembledPrompt,
        aspect_ratio: aspectRatio,
        duration: String(clampDuration(settings.duration)),
        generate_audio: !!settings.generateAudio,
        ...(startUrl ? { image_url: startUrl } : {}),
      });
      return normalizeGeneration({ ...base, status: "processing", provider: "fal", model, jobId: requestId });
    }

    // Resolve the reference-image role this model actually accepts (Seedance:
    // "image_references"; others may want "start_image"/"image"). Start frame
    // leads, then image refs.
    const refUrls = [startFrameUrl, ...imageRefUrls].filter(Boolean);
    const medias = [];
    if (refUrls.length) {
      const role = await resolveMediaRole(env, userId, token, model, ["image_references", "start_image", "image"]);
      for (const url of refUrls) {
        const mediaId = await importRef(env, userId, token, url);
        medias.push({ role, value: mediaId });
      }
    }
    const data = await mcp(env, userId, token, "generate_video", {
      params: {
        model,
        prompt: assembledPrompt,
        aspect_ratio: aspectRatio,
        duration: clampDuration(settings.duration),
        generate_audio: !!settings.generateAudio,
        medias,
      },
    });
    const jobId = pickId(data, "jobId", "job_id", "id");
    if (!jobId) throw new Error(`Higgsfield generate_video returned no job id (got: ${JSON.stringify(data).slice(0, 220)})`);
    return normalizeGeneration({ ...base, status: "processing", model, jobId });
  }

  // image
  const catalog = mergeCatalog(falKey, await resolveHfCatalog(env, userId, token, "image", falKey), "image");
  const model = resolveModelChoice(falKey, catalog, settings.model, token);

  if (isFalModel(model)) {
    // fal Nano Banana: reference images go straight to the /edit endpoint as
    // `image_urls` (fal fetches our ungated /files URLs itself — no import step).
    const entry = falModelEntry(model);
    const { requestId } = await falSubmit(falKey, imageRefUrls.length ? entry.editEndpoint : entry.endpoint, {
      prompt: assembledPrompt,
      aspect_ratio: aspectRatio,
      num_images: 1,
      ...(imageRefUrls.length ? { image_urls: imageRefUrls } : {}),
    });
    return normalizeGeneration({ ...base, status: "processing", provider: "fal", model, jobId: requestId });
  }

  const medias = [];
  if (imageRefUrls.length) {
    const role = await resolveMediaRole(env, userId, token, model, ["image", "image_references"]);
    for (const url of imageRefUrls) {
      const mediaId = await importRef(env, userId, token, url);
      medias.push({ role, value: mediaId });
    }
  }
  const data = await mcp(env, userId, token, "generate_image", {
    params: { model, prompt: assembledPrompt, aspect_ratio: aspectRatio, medias },
  });
  const jobId = pickId(data, "jobId", "job_id", "id");
  if (!jobId) throw new Error(`Higgsfield generate_image returned no job id (got: ${JSON.stringify(data).slice(0, 220)})`);
  return normalizeGeneration({ ...base, status: "processing", model, jobId });
}

// ---- Run cascade (topological, driven by the client's /poll cycle) ----
// The graph runs like the reference: a node fires once all its in-run upstreams
// are `ready`. Since Higgsfield jobs are async, we don't block — the run state
// lives on `board.run` and is ADVANCED on every /poll (after job finalization):
// settle started nodes from their generation status, then fire every node whose
// upstreams are now ready. Drains (clears board.run) when all nodes settled.

// Downstream closure of a node (inclusive), following edges source → target.
function downstreamClosure(board, nodeId) {
  const seen = new Set([nodeId]);
  const stack = [nodeId];
  while (stack.length) {
    const cur = stack.pop();
    for (const e of board.edges) {
      if (e.source === cur && !seen.has(e.target)) { seen.add(e.target); stack.push(e.target); }
    }
  }
  return seen;
}

// In-run upstream node ids feeding `nodeId` via any input edge.
function upstreamRunDeps(board, nodeId, runSet) {
  const set = new Set(runSet);
  const deps = [];
  for (const e of board.edges) {
    if (e.target === nodeId && set.has(e.source)) deps.push(e.source);
  }
  return deps;
}

// Advance the active run one step: settle started nodes from generation status,
// then fire every runnable node (upstreams ready). Does its own read → network →
// write. A no-op when no run is active. Returns nothing.
async function advanceRun(env, userId, token, falKey, pid) {
  const vw = await readVW(env, pid);
  const run = vw.board.run;
  if (!run?.active) return;

  const genById = new Map(vw.generations.map((g) => [g.id, g]));
  const nodeById = new Map(vw.board.nodes.map((n) => [n.id, n]));
  const ready = new Set(run.ready);
  const errored = new Set(run.errored);
  const started = new Set(run.started);

  // 1. Settle: a started node whose current generation reached a terminal state.
  for (const id of started) {
    if (ready.has(id) || errored.has(id)) continue;
    const node = nodeById.get(id);
    const gen = node?.currentGenId ? genById.get(node.currentGenId) : null;
    if (!gen) { errored.add(id); continue; }
    if (gen.status === "ready") ready.add(id);
    else if (gen.status === "error") errored.add(id);
    // else still processing — leave it.
  }

  // 2. Fire: nodes not yet started whose in-run upstreams are all ready (and none
  //    errored). A node with an errored/missing upstream is itself errored.
  const fired = []; // { nodeId, gen }
  let attempted = 0;
  for (const id of run.runSet) {
    if (started.has(id) || ready.has(id) || errored.has(id)) continue;
    const node = nodeById.get(id);
    if (!node) { errored.add(id); continue; }
    const deps = upstreamRunDeps(vw.board, id, run.runSet);
    if (deps.some((d) => errored.has(d) || !nodeById.has(d))) { errored.add(id); continue; }
    if (!deps.every((d) => ready.has(d))) continue; // wait
    attempted++;
    try {
      const gen = await fireNodeJob(env, userId, token, falKey, pid, vw, node);
      fired.push({ nodeId: id, gen });
      started.add(id);
    } catch {
      errored.add(id);
    }
  }

  // Deadlock breaker: if no fire was even ATTEMPTED this pass and no node is still
  // processing, the remaining nodes can never run (an edge cycle, or all blocked
  // by a failed upstream). Error them so the run drains instead of polling
  // forever. (A pass that attempted a fire but hit a transient error retries.)
  const stillProcessing = [...started].some((id) => {
    if (ready.has(id) || errored.has(id)) return false;
    const node = nodeById.get(id);
    const gen = node?.currentGenId ? genById.get(node.currentGenId) : null;
    return gen?.status === "processing";
  });
  if (!attempted && !stillProcessing) {
    for (const id of run.runSet) {
      if (!ready.has(id) && !errored.has(id)) errored.add(id);
    }
  }

  const drained = run.runSet.every((id) => ready.has(id) || errored.has(id));

  await updateVW(env, pid, (v) => {
    // Append newly-fired processing generations + bind them to their node.
    for (const { nodeId, gen } of fired) {
      v.generations.unshift(gen);
      const n = v.board.nodes.find((x) => x.id === nodeId);
      if (n) { n.currentGenId = gen.id; if (!n.genIds.includes(gen.id)) n.genIds.push(gen.id); }
    }
    if (v.board.run) {
      v.board.run.started = [...started];
      v.board.run.ready = [...ready];
      v.board.run.errored = [...errored];
      if (drained) v.board.run = null;
    }
  });
}

/* ------------------------------------------------------------------ *
 * Routes                                                              *
 * ------------------------------------------------------------------ */

export function registerVisualWorld(app) {
  // Read the whole visual world (seeds an empty skeleton on first use). Ready
  // generations carry a `/visual-media/<file>` url.
  app.get("/api/visual-world", async (c) => {
    const pid = c.get("projectId");
    const vw = await readVW(c.env, pid);
    return c.json({ ...vw, generations: vw.generations.map((g) => withUrls(c.env, pid, g)) });
  });

  // The model catalog for the composer / node model selectors: the live
  // Higgsfield catalog (when the user has a token) merged with the curated fal
  // registry (when FAL_KEY is set), each entry tagged with its `provider`.
  // `?type=video` returns the video catalog; anything else the image catalog.
  // 401 only when NEITHER provider is available.
  app.get("/api/visual-world/models", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in required" }, 401);
    const token = await getHiggsfieldToken(c.env, userId);
    const falKey = reqFalKey(c);
    if (!token && !falKey) return c.json({ error: "no_higgsfield_token" }, 401);
    const type = c.req.query("type") === "video" ? "video" : "image";
    try {
      const catalog = mergeCatalog(falKey, await resolveHfCatalog(c.env, userId, token, type, falKey), type);
      if (!catalog.models.length) return c.json({ error: "no_higgsfield_token" }, 401);
      return c.json(catalog);
    } catch (e) {
      if (e instanceof HiggsfieldAuthError) return c.json({ error: "no_higgsfield_token" }, 401);
      return c.json({ error: `Higgsfield: ${e.message || e}` }, 502);
    }
  });

  // Start N image jobs. Body: { prompt, model?, count?, aspectRatio?, refs?,
  // presetId?, cinematic? }. Appends N "processing" records; the client then
  // polls /poll. References are imported into Higgsfield as media_ids.
  app.post("/api/visual-world/generate", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in required" }, 401);
    const pid = c.get("projectId");
    const token = await getHiggsfieldToken(c.env, userId);
    const falKey = reqFalKey(c);
    if (!token && !falKey) return c.json({ error: "no_higgsfield_token" }, 401);

    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const prompt = str(body.prompt).trim();
    if (!prompt) return c.json({ error: "Missing 'prompt'" }, 400);
    const count = clampCount(body.count);
    const aspectRatio = str(body.aspectRatio) || "16:9";
    const presetId = str(body.presetId);
    const sheetType = ["character", "location", "prop"].includes(body.sheetType) ? body.sheetType : "";
    const inputRefs = Array.isArray(body.refs) ? body.refs.map(normalizeRef) : [];
    // A location sheet formalizes an EXISTING place — style prompt + reference
    // image, always. Without a reference it would just invent a new location.
    if (sheetType === "location" && inputRefs.length === 0) {
      return c.json({ error: "Location sheets require a reference image — add one before generating." }, 400);
    }

    try {
      // Resolve the model against the merged catalog. A selected id that
      // Higgsfield has since renamed (e.g. a saved `nano_banana_flash`) is no
      // longer in the catalog — fall back to the current default instead of
      // handing a dead id to generate_image. Empty selection ⇒ default.
      const catalog = mergeCatalog(falKey, await resolveHfCatalog(c.env, userId, token, "image", falKey), "image");
      let model;
      try {
        model = resolveModelChoice(falKey, catalog, body.model, token);
      } catch (e) {
        if (e instanceof HiggsfieldAuthError) throw e;
        return c.json({ error: e.message || "Could not resolve an image model" }, 502);
      }

      // Assemble the final prompt: preset style prefix (if chosen) + the sheet
      // prompt (when tagged as a character/location/prop sheet) + the scene.
      const vw = await readVW(c.env, pid);
      const preset = presetId ? vw.prompts.find((p) => p.id === presetId) : null;
      const sheetPrompt = sheetType ? vw.sheetPrompts[sheetType] : "";
      const assembledPrompt = [preset?.image, sheetPrompt, prompt].filter(Boolean).join("\n\n");

      // Resolve every reference to an ungated /files URL. fal fetches those URLs
      // directly; Higgsfield needs each imported → media_id with the role THIS
      // model accepts (Nano Banana Pro wants "image", others "image_references").
      const refUrls = [];
      for (const r of inputRefs) {
        let url = r.url;
        if (!url && r.kind === "library" && r.rel) {
          url = filesUrl(c.env, `media/${normalizeProjectId(pid)}/asset/${r.rel}`);
        } else if (!url && r.kind === "generation" && r.genId) {
          const g = vw.generations.find((x) => x.id === r.genId);
          if (g?.file) url = filesUrl(c.env, mediaKey(pid, "visual", g.file));
        }
        if (url) refUrls.push(url);
      }

      // Fire one job per requested image.
      const started = [];
      if (isFalModel(model)) {
        const entry = falModelEntry(model);
        const input = {
          prompt: assembledPrompt,
          aspect_ratio: aspectRatio,
          num_images: 1,
          ...(refUrls.length ? { image_urls: refUrls } : {}),
        };
        for (let i = 0; i < count; i++) {
          const { requestId } = await falSubmit(falKey, refUrls.length ? entry.editEndpoint : entry.endpoint, input);
          started.push({ jobId: requestId });
        }
      } else {
        const medias = [];
        const refRole = refUrls.length
          ? await resolveMediaRole(c.env, userId, token, model, ["image", "image_references"])
          : "image";
        for (const url of refUrls) {
          const mediaId = await importRef(c.env, userId, token, url);
          medias.push({ role: refRole, value: mediaId });
        }
        for (let i = 0; i < count; i++) {
          const data = await mcp(c.env, userId, token, "generate_image", {
            params: { model, prompt: assembledPrompt, aspect_ratio: aspectRatio, medias },
          });
          const jobId = pickId(data, "jobId", "job_id", "id");
          if (!jobId) throw new Error(`Higgsfield generate_image returned no job id (got: ${JSON.stringify(data).slice(0, 220)})`);
          started.push({ jobId });
        }
      }

      // Append the processing records.
      const ts = new Date().toISOString();
      const created = started.map((s, i) =>
        normalizeGeneration({
          id: `gen-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}-${i}`,
          status: "processing",
          provider: isFalModel(model) ? "fal" : "",
          prompt,
          assembledPrompt,
          model,
          aspectRatio,
          presetId,
          sheetType,
          jobId: s.jobId,
          refs: inputRefs,
          ts,
        }),
      );
      await updateVW(c.env, pid, (v) => {
        v.generations.unshift(...created);
        v.settings = { ...v.settings, model, aspectRatio, count, presetId };
        v.generatedAt = ts;
        v.source = "app";
      });
      return c.json({ ok: true, generations: created.map((g) => withUrls(c.env, pid, g)) });
    } catch (e) {
      if (e instanceof HiggsfieldAuthError) return c.json({ error: "no_higgsfield_token" }, 401);
      return c.json({ error: `Generation: ${e.message || e}` }, 502);
    }
  });

  // Download a finished job's bytes into R2 and record the "ready" update (or an
  // "error" one on a failed fetch). Shared by the Higgsfield and fal poll paths.
  async function finalizeResult(c, pid, g, rawUrl, updates) {
    const res = await fetch(rawUrl);
    if (!res.ok) {
      updates[g.id] = { status: "error", error: `${g.kind === "video" ? "Video" : "Image"} fetch failed (${res.status})` };
      return;
    }
    const isVideo = g.kind === "video";
    const ct = res.headers.get("content-type") || (isVideo ? "video/mp4" : "image/png");
    const ext = isVideo
      ? (/webm/.test(ct) ? "webm" : /quicktime|mov/.test(ct) ? "mov" : "mp4")
      : (/webp/.test(ct) ? "webp" : /jpe?g/.test(ct) ? "jpg" : "png");
    const file = `${g.id}.${ext}`;
    await putMedia(c.env, pid, "visual", file, await res.arrayBuffer(), ct);
    // Generate the thumbnail in the same pass (images only) so a gen
    // attached straight as a character sheet renders a real thumb.
    if (!isVideo) c.executionCtx.waitUntil(ensureImageThumb(c.env, { pid, kind: "visual", file }));
    updates[g.id] = { status: "ready", file, source: rawUrl };
  }

  // Poll every pending job; on completion download bytes into R2 and flip the
  // record to "ready". Network work happens BEFORE updateDoc (mutate may re-run).
  // Higgsfield jobs go through job_status (MCP); fal jobs through the queue API.
  app.get("/api/visual-world/poll", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in required" }, 401);
    const pid = c.get("projectId");
    const token = await getHiggsfieldToken(c.env, userId);
    const falKey = reqFalKey(c);
    if (!token && !falKey) return c.json({ error: "no_higgsfield_token" }, 401);

    const vw = await readVW(c.env, pid);
    const pending = vw.generations.filter((g) => g.status === "processing" && g.jobId);

    const updates = {}; // id -> partial
    for (const g of pending) {
      try {
        if (g.provider === "fal") {
          const entry = falModelEntry(g.model);
          if (!entry) {
            updates[g.id] = { status: "error", error: "fal model no longer in the curated registry" };
            continue;
          }
          if (!falKey) continue; // no key on this request — poll again from a tab that has one
          const st = await falPoll(falKey, entry.endpoint || entry.t2vEndpoint, g.jobId);
          if (!st.done) continue; // still queued/running — re-poll next tick
          if (st.failed || !st.url) {
            updates[g.id] = { status: "error", error: st.error || "Generation ended with no result" };
          } else {
            await finalizeResult(c, pid, g, st.url, updates);
          }
          continue;
        }

        const st = await mcp(c.env, userId, token, "job_status", { jobId: g.jobId, sync: true });
        // The generation may be nested under `generation` (or returned bare).
        const gen = (st && typeof st === "object" && st.generation && typeof st.generation === "object")
          ? st.generation : st;
        const status = str(gen?.status || gen?.state || st?.status || st?.state).toLowerCase();
        const rawUrl = resultMediaUrl(st);
        const inProgress = JOB_IN_PROGRESS.has(status);
        const failed = JOB_FAILED.has(status);

        if (failed) {
          updates[g.id] = { status: "error", error: str(gen?.error || gen?.error_message || st?.error) || "Generation failed" };
        } else if (!inProgress && rawUrl) {
          // Terminal (or unknown) status with a result URL → download + finalize.
          await finalizeResult(c, pid, g, rawUrl, updates);
        } else if (!inProgress && !failed && status) {
          // Reached a terminal state we don't recognize, with no media URL.
          updates[g.id] = { status: "error", error: `Generation ended (${status}) with no result` };
        }
        // else: still in progress — leave as-is; re-poll next tick.
      } catch (e) {
        if (e instanceof HiggsfieldAuthError) return c.json({ error: "no_higgsfield_token" }, 401);
        // Transient poll error — keep the record processing, try again next tick.
      }
    }

    if (Object.keys(updates).length) {
      await updateVW(c.env, pid, (v) => {
        for (const g of v.generations) {
          const u = updates[g.id];
          if (u) Object.assign(g, u);
        }
      });
    }
    // Advance any active node-run cascade: settle just-finalized nodes and fire
    // the next runnable ones (may append new processing generations this tick).
    try {
      await advanceRun(c.env, userId, token, falKey, pid);
    } catch (e) {
      if (e instanceof HiggsfieldAuthError) return c.json({ error: "no_higgsfield_token" }, 401);
      // Transient cascade error — retried next tick.
    }
    const fresh = await readVW(c.env, pid);
    return c.json({
      generations: fresh.generations.map((g) => withUrls(c.env, pid, g)),
      board: fresh.board,
    });
  });

  // Run a canvas node (and, mode "from-here", its downstream descendants). Kicks
  // the first runnable job(s), records the run on `board.run`, and lets /poll
  // advance the cascade. Image/video nodes only; text/upload are input sources.
  app.post("/api/visual-world/node/run", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in required" }, 401);
    const pid = c.get("projectId");
    const token = await getHiggsfieldToken(c.env, userId);
    const falKey = reqFalKey(c);
    if (!token && !falKey) return c.json({ error: "no_higgsfield_token" }, 401);

    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const nodeId = str(body.nodeId);
    const mode = body.mode === "from-here" ? "from-here" : "this";
    if (!nodeId) return c.json({ error: "Missing 'nodeId'" }, 400);

    const vw = await readVW(c.env, pid);
    const start = vw.board.nodes.find((n) => n.id === nodeId);
    if (!start) return c.json({ error: `no node ${nodeId}` }, 404);

    // The run set: this node (or its downstream closure), restricted to the
    // runnable generator types (text/upload only feed inputs, never "run").
    const closure = mode === "this" ? new Set([nodeId]) : downstreamClosure(vw.board, nodeId);
    const runSet = vw.board.nodes
      .filter((n) => closure.has(n.id) && (n.type === "image" || n.type === "video"))
      .map((n) => n.id);
    if (runSet.length === 0) return c.json({ error: "Nothing runnable in this run" }, 400);

    // Nodes with no in-run upstream fire immediately; the rest wait for /poll.
    const ready = new Set();
    const errored = new Set();
    const started = new Set();
    const fired = [];
    try {
      for (const id of runSet) {
        const deps = upstreamRunDeps(vw.board, id, runSet);
        if (deps.length > 0) continue; // waits for upstreams (advanced by /poll)
        const node = vw.board.nodes.find((n) => n.id === id);
        const gen = await fireNodeJob(c.env, userId, token, falKey, pid, vw, node);
        fired.push({ nodeId: id, gen });
        started.add(id);
      }
    } catch (e) {
      if (e instanceof HiggsfieldAuthError) return c.json({ error: "no_higgsfield_token" }, 401);
      return c.json({ error: `Generation: ${e.message || e}` }, 502);
    }

    const ts = new Date().toISOString();
    await updateVW(c.env, pid, (v) => {
      for (const { nodeId: nid, gen } of fired) {
        v.generations.unshift(gen);
        const n = v.board.nodes.find((x) => x.id === nid);
        if (n) { n.currentGenId = gen.id; if (!n.genIds.includes(gen.id)) n.genIds.push(gen.id); }
      }
      v.board.run = {
        active: true, mode, runSet,
        started: [...started], ready: [...ready], errored: [...errored], ts,
      };
      v.generatedAt = ts;
      v.source = "app";
    });
    const fresh = await readVW(c.env, pid);
    return c.json({
      ok: true,
      generations: fresh.generations.map((g) => withUrls(c.env, pid, g)),
      board: fresh.board,
    });
  });

  // Agent attach route (parallels /api/storyboard/image): the flue agent already
  // ran generate_image itself and POSTs the result URL here so it lands live on
  // the Visual tab. Downloads the bytes into R2 immediately.
  app.post("/api/visual-world/image", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const url = str(body.url);
    if (!url) return c.json({ error: "Missing 'url'" }, 400);

    const id = `gen-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`;
    let file = "";
    let downloadError = "";
    const source = url;
    // Only fetch from allowed media hosts (higgsfield / cloudfront / fal.media),
    // same gate as /poll — the agent should POST the raw result URL. This blocks
    // SSRF and, together with the content-type check below, stops a non-image
    // body (e.g. a 200 HTML error/redirect page) being stored as a corrupt
    // "ready" image the tab then renders broken.
    if (!isAllowedMediaUrl(url) && !isAllowedFalMediaUrl(url)) {
      downloadError = "url must be an https Higgsfield/CloudFront or fal.media result URL";
    } else {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          downloadError = `Image fetch failed (${res.status})`;
        } else {
          const ct = res.headers.get("content-type") || "";
          if (!/^image\//i.test(ct)) {
            downloadError = `Not an image (content-type ${ct || "unknown"}) — pass the raw result_url, not a page URL`;
          } else {
            const ext = /webp/i.test(ct) ? "webp" : /jpe?g/i.test(ct) ? "jpg" : /gif/i.test(ct) ? "gif" : "png";
            file = `${id}.${ext}`;
            await putMedia(c.env, pid, "visual", file, await res.arrayBuffer(), ct);
            // Thumbnail in the same pass — see /poll. This is the agent's attach
            // route, the exact path that produced the broken-thumb sheets.
            c.executionCtx.waitUntil(ensureImageThumb(c.env, { pid, kind: "visual", file }));
          }
        }
      } catch (e) {
        downloadError = `Image download failed: ${e?.message || e}`;
      }
    }

    const gen = normalizeGeneration({
      id,
      status: file ? "ready" : "error",
      error: file ? "" : (downloadError || "Image download failed"),
      prompt: str(body.prompt),
      assembledPrompt: str(body.assembledPrompt) || str(body.prompt),
      model: str(body.model),
      aspectRatio: str(body.aspectRatio) || "16:9",
      presetId: str(body.presetId),
      sheetType: str(body.sheetType),
      file,
      source,
      refs: Array.isArray(body.refs) ? body.refs : [],
      ts: new Date().toISOString(),
    });
    await updateVW(c.env, pid, (v) => { v.generations.unshift(gen); });
    return c.json({ ok: true, generation: withUrls(c.env, pid, gen) });
  });

  // Delete a generation record + its R2 object.
  app.delete("/api/visual-world/generation/:id", async (c) => {
    const pid = c.get("projectId");
    const id = c.req.param("id");
    let file = "";
    const result = await updateVW(c.env, pid, (v) => {
      const g = v.generations.find((x) => x.id === id);
      if (!g) return { abort: true, notFound: true };
      file = g.file;
      v.generations = v.generations.filter((x) => x.id !== id);
      // Unbind the generation from any canvas node's history/preview. An `upload`
      // source node that pointed ONLY at this generation is now empty — drop it
      // (and its edges); generator nodes keep their prompt/settings.
      const orphanNodeIds = new Set();
      for (const n of v.board.nodes) {
        n.genIds = n.genIds.filter((gid) => gid !== id);
        if (n.currentGenId === id) n.currentGenId = n.genIds[n.genIds.length - 1] || "";
        if (n.type === "upload" && n.genIds.length === 0) orphanNodeIds.add(n.id);
      }
      if (orphanNodeIds.size) v.board.nodes = v.board.nodes.filter((n) => !orphanNodeIds.has(n.id));
      const nodeIds = new Set(v.board.nodes.map((n) => n.id));
      v.board.edges = v.board.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
    });
    if (result?.notFound) return c.json({ error: `no generation ${id}` }, 404);
    if (file) { try { await c.env.BUCKET.delete(mediaKey(pid, "visual", file)); } catch { /* ignore */ } }
    return c.json({ ok: true });
  });

  // Replace the prompt library (add/edit/delete presets). Optionally carries the
  // character/location sheet prompts too (the composer's prompt dialog edits
  // both), so one save lands as ONE revision. Every save appends a numbered
  // revision snapshot (see pushPromptRevision).
  app.put("/api/visual-world/prompts", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const list = Array.isArray(body.prompts) ? body.prompts : Array.isArray(body) ? body : null;
    if (!list) return c.json({ error: "Expected { prompts: [...] }" }, 400);
    const prompts = list.map(normalizePrompt);
    let revision = null;
    await updateVW(c.env, pid, (v) => {
      v.prompts = prompts;
      if (body.sheetPrompts && typeof body.sheetPrompts === "object") {
        const next = { ...v.sheetPrompts };
        if (typeof body.sheetPrompts.character === "string") next.character = body.sheetPrompts.character;
        if (typeof body.sheetPrompts.location === "string") next.location = body.sheetPrompts.location;
        if (typeof body.sheetPrompts.prop === "string") next.prop = body.sheetPrompts.prop;
        v.sheetPrompts = normalizeSheetPrompts(next);
      }
      revision = pushPromptRevision(v);
    });
    return c.json({ ok: true, prompts, revision: revision && { rev: revision.rev, ts: revision.ts } });
  });

  // Merge-patch the generation defaults (Settings page): the image model and
  // aspect ratio the composer AND the agent skills use when the user doesn't
  // override per-generation. `model: ""` means the server default (Nano Banana
  // Pro); aspectRatio falls back to 16:9 on read (normalize).
  app.put("/api/visual-world/settings", async (c) => {
    const pid = c.get("projectId");
    let patch;
    try { patch = await c.req.json(); } catch { patch = {}; }
    await updateVW(c.env, pid, (v) => {
      const next = { ...v.settings };
      if (typeof patch.model === "string") next.model = patch.model;
      if (typeof patch.aspectRatio === "string" && patch.aspectRatio) next.aspectRatio = patch.aspectRatio;
      v.settings = next;
    });
    const fresh = await readVW(c.env, pid);
    return c.json({ ok: true, settings: fresh.settings });
  });

  // Merge-patch the character/location/prop sheet prompts (Settings page). Sending
  // an empty string resets that prompt to its seed default (normalizeSheetPrompts).
  app.put("/api/visual-world/sheet-prompts", async (c) => {
    const pid = c.get("projectId");
    let patch;
    try { patch = await c.req.json(); } catch { patch = {}; }
    let revision = null;
    await updateVW(c.env, pid, (v) => {
      const next = { ...v.sheetPrompts };
      if (typeof patch.character === "string") next.character = patch.character;
      if (typeof patch.location === "string") next.location = patch.location;
      if (typeof patch.prop === "string") next.prop = patch.prop;
      v.sheetPrompts = normalizeSheetPrompts(next);
      revision = pushPromptRevision(v);
    });
    const fresh = await readVW(c.env, pid);
    return c.json({ ok: true, sheetPrompts: fresh.sheetPrompts, revision: revision && { rev: revision.rev, ts: revision.ts } });
  });

  // Merge-patch the composer's remembered defaults.
  app.put("/api/visual-world/settings", async (c) => {
    const pid = c.get("projectId");
    let patch;
    try { patch = await c.req.json(); } catch { patch = {}; }
    await updateVW(c.env, pid, (v) => {
      if (typeof patch.model === "string") v.settings.model = patch.model;
      if (typeof patch.aspectRatio === "string") v.settings.aspectRatio = patch.aspectRatio;
      if (patch.count != null) v.settings.count = clampCount(patch.count);
      if (typeof patch.cinematic === "boolean") v.settings.cinematic = patch.cinematic;
      if (typeof patch.presetId === "string") v.settings.presetId = patch.presetId;
    });
    return c.json({ ok: true });
  });

  // Persist the generator canvas (nodes / edges / viewport). The active run
  // (`board.run`) is SERVER-owned — a client structure save never touches it, so
  // an in-flight cascade survives edits/drags. Node currentGenId/genIds ARE
  // client-writable (history picks), so we take them from the incoming board.
  app.put("/api/visual-world/board", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const board = normalizeBoard(body.board || body);
    await updateVW(c.env, pid, (v) => {
      const run = v.board?.run ?? null;
      v.board = board;
      v.board.run = run; // preserve the server-owned run across client saves
    });
    const fresh = await readVW(c.env, pid);
    return c.json({ ok: true, board: fresh.board });
  });

  // Promote a generation into the shared asset library so it can be linked as a
  // character sheet on the written World tab. Copies the R2 bytes to the asset
  // key; returns the library `rel`.
  app.post("/api/visual-world/save-to-library", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const id = str(body.id);
    const vw = await readVW(c.env, pid);
    const gen = vw.generations.find((x) => x.id === id);
    if (!gen || !gen.file) return c.json({ error: `no ready generation ${id}` }, 404);

    const obj = await c.env.BUCKET.get(mediaKey(pid, "visual", gen.file));
    if (!obj) return c.json({ error: "Image bytes missing" }, 404);
    const dir = str(body.folder).replace(/[^a-zA-Z0-9._/-]/g, "").replace(/^\/+|\/+$/g, "");
    const base = (str(body.name).replace(/[^a-zA-Z0-9._-]/g, "") || gen.file).replace(/\.[^.]*$/, "");
    const ext = (/\.([^.]+)$/.exec(gen.file) || [, "png"])[1];
    const rel = `${dir ? dir + "/" : ""}${base}.${ext}`;
    const safePid = normalizeProjectId(pid);
    await c.env.BUCKET.put(`media/${safePid}/asset/${rel}`, obj.body, {
      httpMetadata: { contentType: obj.httpMetadata?.contentType || "image/png" },
    });
    // Remember the library rel on the generation so the tab renders a persistent
    // "Saved to library" state (and broadcasts it live to other clients).
    await updateVW(c.env, pid, (v) => {
      const g = v.generations.find((x) => x.id === id);
      if (g) g.savedRel = rel;
    });
    return c.json({ ok: true, rel, name: `${base}.${ext}`, folder: dir || ".", url: `/asset/${rel}` });
  });
}
