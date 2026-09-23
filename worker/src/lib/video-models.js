// Model-agnostic generation specs — the normalizer that turns ONE raw
// Higgsfield `models_explore` item into the shape the composer can render, and
// the validator that turns the composer's answers back into a params bag the
// provider will accept.
//
// WHY THIS EXISTS. The video composer used to offer exactly three controls —
// a duration from a hardcoded list, a `generateAudio` checkbox and an aspect
// ratio — because those are SEEDANCE's parameters. Every other model on the
// provider takes a different set: "audio" is spelled `generate_audio` (bool) on
// Seedance and Wan, `sound` (bool) on Kling 2.6 and Cinema Studio, and `sound`
// ("on"/"off", a STRING) on Kling 3.0; duration is a range on Seedance, an enum
// on Veo 3.1, and ABSENT on Veo 3. Hardcoding is not fixable by adding more
// hardcoding — so the catalog carries each model's own declared controls and
// the composer renders whatever it finds.
//
// Everything here is PURE and dependency-free on purpose: it is the one place
// that decides what a model looks like, so it has to be readable and testable
// on its own. The route layer (worker/src/routes/visual-world.js) owns the KV
// caching, the provider dispatch and the doc writes.
//
// NOTE: this is a different key space from `worker/src/lib/video-defaults.js`.
// That file is the Seedance RENDER defaults (model + resolution) the skills and
// the episode packer read; this file is the live provider catalog the composer
// browses. See the comment on `settings.videoComposer` in the route.

const str = (v) => (v == null ? "" : String(v));
const clampNum = (n, min, max) => Math.min(max, Math.max(min, n));

/* ------------------------------------------------------------------ *
 * The two denylists — exported so the reasons are greppable            *
 * ------------------------------------------------------------------ */

// Params that are PLUMBING, not creative controls: ids the composer has no way
// to source, and prompt fields the route already owns. They are never rendered
// and never forwarded, even when their declared type is perfectly renderable.
// A model that REQUIRES one of these is dropped entirely (see below) — we could
// not fill it in.
export const HIDDEN_PARAMS = new Set([
  "folder_id",
  "preset_id",
  "assets",
  "avatar_ids",
  "avatars",
  "product_ids",
  "hook_id",
  "setting_id",
  "ad_reference_id",
  "urls",
  // `model` is chosen by the picker, and the three prompt fields are assembled
  // by the route from the style preset + the author's text.
  "model",
  "user_prompt",
  "system_prompt",
  "multi_prompt",
]);

// Catalog entries whose `output_type` is "video" but which are NOT generators:
// upscalers, deflickers, background removers, lipsync, a YouTube clipper and an
// LLM shim. Left in, the model picker offers "Video Deflicker" as a way to make
// a clip.
//
// `marketing_studio_video` is here for a different reason: it is a real
// generator, but it only makes sense with product/avatar ids the composer has
// no UI to pick (all of them are in HIDDEN_PARAMS). The live catalog marks
// those ids `optional`, so the required-param rule below does NOT catch it —
// hence the explicit entry. If a Marketing Studio surface is ever built, delete
// this line rather than working around it.
export const UTILITY_MODEL_IDS = new Set([
  "video_upscale",
  "bytedance_video_upscale",
  "topaz_video",
  "video_deflicker",
  "video_background_remover",
  "sam_3_video",
  "sync_so",
  "clipify",
  "llm_text",
  "marketing_studio_video",
]);

// A model that consumes a video or an audio FILE as its subject is a
// post-processing pipeline, not a generator — the composer has no such input.
// This is the rule that keeps the list from rotting: new upscalers the provider
// adds are excluded without anyone updating a denylist.
const POST_PROCESS_ROLES = new Set(["input_video", "input_audio"]);

/* ------------------------------------------------------------------ *
 * Parameter normalization                                             *
 * ------------------------------------------------------------------ */

// `generate_audio` → "Generate audio". Deliberately dumb: the provider's names
// are already snake_case English, and a lookup table would go stale the moment
// a new model lands.
function humanize(name) {
  const s = str(name).replace(/[_-]+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

const isRequired = (raw) => raw?.required === "required" || raw?.required === true;

// One raw `parameters[]` entry → a renderable control, or null when it isn't
// one (a free string, a `string_array`, a nullable id, an unbounded number).
//
// Beyond the four documented fields each control also carries:
//   `required`   — the provider marked it required, so we always send it.
//   `hasDefault` — the provider declared a default, so sending ours is safe.
// Together they decide whether `coerceParams` emits a key the author never
// touched. Without them we would either drop `gemini_omni_flash_1_1`'s required
// `mode` (job rejected) or invent Seedance 2.5's `extension_mode`, which is an
// error outside `video_extension` mode.
function normalizeParam(raw) {
  const name = str(raw?.name);
  if (!name) return null;

  const hint = str(raw?.description).trim();
  const required = isRequired(raw);
  const hasDefault = raw?.default !== undefined && raw?.default !== null;
  // The hint is the ONLY per-model documentation that exists: it is what tells
  // the author that Seedance's `fast` mode caps at 720p, or that Hailuo's "512"
  // is incompatible with an end frame. It must survive to the client.
  const base = { name, label: humanize(name), ...(hint ? { hint } : {}), required, hasDefault };

  const type = str(raw?.type);
  const options = Array.isArray(raw?.options) ? raw.options : null;
  // Duration is the one param whose unit the composer can label; everything
  // else is unitless as far as we can tell from the catalog.
  const unit = name === "duration" ? { unit: "s" } : {};

  if (type === "bool") {
    return { ...base, kind: "bool", default: hasDefault ? !!raw.default : false };
  }

  if (type === "string" && options?.length) {
    const opts = options.map(str).filter(Boolean);
    if (!opts.length) return null;
    const dflt = str(raw?.default);
    return { ...base, kind: "enum", options: opts, default: opts.includes(dflt) ? dflt : opts[0] };
  }

  if (type === "number") {
    if (options?.length) {
      const opts = options.map(Number).filter((n) => Number.isFinite(n));
      if (!opts.length) return null;
      const dflt = Number(raw?.default);
      return { ...base, kind: "choice", options: opts, default: opts.includes(dflt) ? dflt : opts[0], ...unit };
    }
    const min = Number(raw?.min);
    const max = Number(raw?.max);
    // A number with only a floor (or neither) is a free field, not a slider.
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
    // Integer bounds ⇒ whole steps (seconds, clip counts). Fractional bounds
    // (`cfg_scale` 0–1) get a fine step so the slider can reach its default.
    const step = Number.isInteger(min) && Number.isInteger(max) ? 1 : 0.01;
    const dflt = Number(raw?.default);
    const fallback = name === "duration" ? 5 : min; // 5s is the house default clip
    return {
      ...base,
      kind: "range",
      min,
      max,
      step,
      default: clampNum(Number.isFinite(dflt) ? dflt : fallback, min, max),
      ...unit,
    };
  }

  return null; // free string, string_array, nullable id → not renderable
}

// Duration does NOT always arrive as a `parameters[]` entry: some models put it
// on the item itself as `durations: [5, 10]` (Cinema Studio Video) or
// `duration_range: { min, max }` (Cinema Studio 3.0, Marketing Studio). Fold
// those into a `duration` control of the right kind so the composer sees ONE
// uniform shape and never has to know which dialect a model speaks.
function foldTopLevelDuration(m) {
  const base = {
    name: "duration",
    label: "Duration",
    hint: "Clip length in seconds.",
    unit: "s",
    required: false,
    hasDefault: true,
  };
  const list = (Array.isArray(m?.durations) ? m.durations : []).map(Number).filter((n) => Number.isFinite(n));
  if (list.length) return { ...base, kind: "choice", options: list, default: list[0] };

  const min = Number(m?.duration_range?.min);
  const max = Number(m?.duration_range?.max);
  if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
    return { ...base, kind: "range", min, max, step: 1, default: clampNum(5, min, max) };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Model normalization                                                 *
 * ------------------------------------------------------------------ */

// One raw `models_explore` item → the normalized spec, or null when the model
// must be dropped from the catalog. A model is dropped when:
//   1. its id is a known non-generator (UTILITY_MODEL_IDS),
//   2. it eats a video/audio FILE (post-processing, not generation),
//   3. it REQUIRES a param we cannot render or are not allowed to send.
// Rule 3 is what keeps `higgsfield_preset` (required `preset_id`) out while
// keeping `gemini_omni_flash_1_1` (required `mode`, but WITH options, so it
// renders as an ordinary select) in.
export function normalizeModelSpec(rawModel) {
  const m = rawModel || {};
  const id = str(m.id || m.model || m.slug || m.model_id);
  if (!id) return null;
  if (UTILITY_MODEL_IDS.has(id)) return null;

  // Media roles, flattened across every `medias[]` group and deduped: what the
  // composer may attach (start_image / end_image / image_references / …).
  const roles = [];
  for (const media of Array.isArray(m.medias) ? m.medias : []) {
    for (const r of Array.isArray(media?.roles) ? media.roles : []) {
      const role = str(r);
      if (role && !roles.includes(role)) roles.push(role);
    }
  }
  if (roles.some((r) => POST_PROCESS_ROLES.has(r))) return null;

  const params = [];
  let batch = null;
  for (const raw of Array.isArray(m.parameters) ? m.parameters : []) {
    const name = str(raw?.name);
    if (!name) continue;
    const required = isRequired(raw);

    // Plumbing: never rendered, never sent. Required plumbing is fatal — we
    // have no id to put there, so the job would be rejected.
    if (HIDDEN_PARAMS.has(name)) {
      if (required) return null;
      continue;
    }

    const p = normalizeParam(raw);

    // `batch_size` is "how many clips", which the composer already has a
    // control for. Two knobs meaning the same thing is worse than one, so it is
    // lifted OUT of params into `batch` and the route fans out N jobs.
    if (name === "batch_size") {
      if (p?.kind === "range") batch = { name, min: p.min, max: p.max, default: p.default };
      else if (p?.kind === "choice") {
        batch = { name, min: Math.min(...p.options), max: Math.max(...p.options), default: p.default };
      }
      continue;
    }

    if (!p) {
      if (required) return null; // e.g. `higgsfield_preset`'s free-string preset_id
      continue;
    }
    params.push(p);
  }

  // Fold a top-level durations/duration_range in only when the model didn't
  // already declare duration as a real parameter.
  if (!params.some((p) => p.name === "duration")) {
    const folded = foldTopLevelDuration(m);
    if (folded) params.unshift(folded);
  }

  return {
    id,
    label: str(m.name || m.title || m.label || m.display_name || id),
    params,
    // [] means the model takes no aspect_ratio (Hailuo, Grok 1.5) — the
    // composer hides the control and the route omits the field.
    aspectRatios: (Array.isArray(m.aspect_ratios) ? m.aspect_ratios : []).map(str).filter(Boolean),
    roles,
    batch,
    // UNCHANGED for image models: the existing image composer reads this to
    // drive its resolution picker, and it is still just the `resolution`
    // parameter's options. Video models also carry it, harmlessly — for them
    // resolution is an ordinary `params` entry as well.
    resolutions: (Array.isArray(m.parameters)
      ? m.parameters.find((p) => p?.name === "resolution")?.options
      : null) || [],
  };
}

// Map + filter, PRESERVING the provider's ordering (it puts its flagships
// first, and the composer's default is "the first one that survives").
export function normalizeCatalog(rawList) {
  return (Array.isArray(rawList) ? rawList : []).map(normalizeModelSpec).filter(Boolean);
}

/* ------------------------------------------------------------------ *
 * Param validation (the safety net in front of every submit)          *
 * ------------------------------------------------------------------ */

const truthy = new Set(["true", "1", "on", "yes"]);
const toBool = (v) => (typeof v === "boolean" ? v : truthy.has(str(v).toLowerCase()));

// Coerce ONE incoming value to the control's declared shape, or undefined when
// it can't be salvaged (the caller then falls back to the declared default).
function coerceOne(p, v) {
  if (p.kind === "bool") return toBool(v);

  if (p.kind === "enum") {
    // Kling 3.0 spells its audio switch as the STRING "on"/"off" while every
    // other model uses a bool, so a client that sends a checkbox value here is
    // being reasonable — translate rather than throw it away.
    if (typeof v === "boolean" && p.options.length === 2 && p.options.includes("on") && p.options.includes("off")) {
      return v ? "on" : "off";
    }
    const s = str(v);
    return p.options.includes(s) ? s : undefined;
  }

  if (p.kind === "choice") {
    const n = Number(v);
    if (!Number.isFinite(n)) return undefined;
    // Snap to the nearest declared option: a stale "8s" from another model
    // becomes Hailuo's 10 rather than a rejected job.
    return p.options.reduce((best, o) => (Math.abs(o - n) < Math.abs(best - n) ? o : best), p.options[0]);
  }

  if (p.kind === "range") {
    const n = Number(v);
    if (!Number.isFinite(n)) return undefined;
    const clamped = clampNum(n, p.min, p.max);
    return p.step === 1 ? Math.round(clamped) : clamped;
  }

  return undefined;
}

// The safety net: a validated `{ name: value }` bag ready to send.
//
// Unknown names are DROPPED — a param the model didn't declare is never
// forwarded, which is the whole bug this file exists to fix. Values are coerced
// and clamped, enums/choices snap to a declared option, and a missing value
// falls back to the declared default (but only when the provider declared one,
// or marked the param required — see `normalizeParam` for why).
export function coerceParams(spec, input) {
  const params = Array.isArray(spec?.params) ? spec.params : [];
  const src = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const out = {};
  for (const p of params) {
    const raw = Object.prototype.hasOwnProperty.call(src, p.name) ? src[p.name] : undefined;
    if (raw === undefined || raw === null || raw === "") {
      if (p.hasDefault || p.required) out[p.name] = p.default;
      continue;
    }
    const v = coerceOne(p, raw);
    out[p.name] = v === undefined ? p.default : v;
  }
  return out;
}

// Back-compat: fold the OLD top-level `duration` / `generateAudio` fields into
// a params bag using THIS model's own names, before the caller merges the
// modern `params` over the top. The Nodes canvas node settings and the episode
// path still speak that dialect, and a node pointed at Kling would otherwise
// lose its audio switch entirely (Kling calls it `sound`).
export function legacyVideoParams(spec, legacy) {
  const o = legacy || {};
  const params = Array.isArray(spec?.params) ? spec.params : [];
  const byName = (n) => params.find((p) => p.name === n);
  const out = {};
  if (o.duration != null && byName("duration")) out.duration = o.duration;
  if (o.generateAudio != null) {
    const audio = byName("generate_audio") || byName("sound");
    if (audio) out[audio.name] = o.generateAudio;
  }
  return out;
}

// How many clips one submission produces. Models that declare `batch_size` let
// the author ask for several takes at once (we fan out N jobs rather than
// sending batch_size, so each take gets its own generation record); models that
// don't stay at one.
export function batchCount(spec, requested) {
  const b = spec?.batch;
  if (!b) return 1;
  const n = Number(requested);
  return Math.round(clampNum(Number.isFinite(n) && n > 0 ? n : b.default, b.min, b.max));
}

/* ------------------------------------------------------------------ *
 * BYOK catalogs (fal / Atlas)                                         *
 * ------------------------------------------------------------------ */

// The fal and Atlas registries are hardcoded endpoints, not a discoverable
// catalog, so their specs are written by hand HERE rather than in
// worker/src/lib/{fal,atlas}.js — those files own the transport, this one owns
// the shape.
//
// The rule for what to declare: ONLY what the matching `submitVideoJob` branch
// actually forwards. Declaring a `resolution` the fal branch never sends would
// draw a control that silently does nothing, which is worse than no control.
const BYOK_ASPECTS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];

// Both BYOK entries are Seedance 2.0 behind a fixed image-to-video endpoint:
// one start frame, a duration and a native-audio switch. `generate_audio`
// defaults to FALSE (not the provider's true) because that is what this route
// has always sent for a BYOK job, and audio costs the user's own credits.
const byokSeedanceParams = (durationHint) => [
  {
    name: "duration",
    label: "Duration",
    hint: durationHint,
    kind: "range",
    min: 4,
    max: 15,
    step: 1,
    default: 5,
    unit: "s",
    required: false,
    hasDefault: true,
  },
  {
    name: "generate_audio",
    label: "Generate audio",
    hint: "Generate a native audio track for the clip. Off keeps it silent.",
    kind: "bool",
    default: false,
    required: false,
    hasDefault: true,
  },
];

const BYOK_VIDEO_SPECS = {
  "fal:bytedance/seedance-2.0/fast": {
    params: byokSeedanceParams("Clip length in seconds (4-15). fal's Seedance Fast endpoint caps output at 720p."),
    aspectRatios: BYOK_ASPECTS,
    roles: ["start_image"],
    batch: null,
    resolutions: [],
  },
  "atlas:bytedance/seedance-2.0": {
    params: byokSeedanceParams("Clip length in seconds (4-15)."),
    aspectRatios: BYOK_ASPECTS,
    roles: ["start_image"],
    batch: null,
    resolutions: [],
  },
};

// A BYOK entry the registry doesn't have a hand-written spec for still gets the
// two controls every branch forwards, so adding an endpoint to fal.js/atlas.js
// never leaves the composer with an empty control row.
const BYOK_VIDEO_FALLBACK = {
  params: byokSeedanceParams("Clip length in seconds."),
  aspectRatios: BYOK_ASPECTS,
  roles: ["start_image"],
  batch: null,
  resolutions: [],
};

// Decorate a `{ id, label, provider }` BYOK catalog entry with its spec.
export function decorateByokVideo(entry) {
  return { ...entry, ...(BYOK_VIDEO_SPECS[entry?.id] || BYOK_VIDEO_FALLBACK) };
}
