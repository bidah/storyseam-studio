// The Seedance video models the render skills default to, and the resolutions
// each one can actually render. Set on the Settings page, stored on the
// `visual-world` doc's `settings` (videoModel / videoResolution), and read back
// by the agent (get_visual_world), the episode skill prompts (lib/pack.js) and
// the Nodes canvas video runner.
//
// A choice here is a (model id + mode) PAIR, because "Seedance 2.0 Fast" is not
// a model id — verified against the live Higgsfield `models_explore` specs:
//
//   seedance_2_0       resolution 480p|720p|1080p|4k, mode std|fast
//                      — 1080p/4k REQUIRE mode "std"; mode "fast" caps at 720p
//                        AND rejects any job carrying `audio_references`
//                        (see the seed-audio skill) — so Fast can't do lip-sync.
//   seedance_2_0_mini  resolution 480p|720p, no `mode` parameter at all.
//
// That's why the resolution picker is driven off the chosen model: switching to
// Mini or Fast clamps 1080p away instead of submitting a job the API refuses.
//
// 4k is deliberately NOT offered as a project default — it only exists on the
// std path and is expensive enough to want per-render, not as a standing setting.
// Seedance-only on purpose: the render skills are written around Seedance's
// reference roles (start_image / image_references / audio_references).

export const VIDEO_MODELS = [
  {
    id: "seedance_2_0",
    label: "Seedance 2.0",
    model: "seedance_2_0",
    mode: "std",
    resolutions: ["480p", "720p", "1080p"],
    audioRefs: true,
    blurb: "Full quality. The only one that reaches 1080p, and the only one that accepts voice references — so lip-synced shots need it.",
  },
  {
    id: "seedance_2_0_fast",
    label: "Seedance 2.0 Fast",
    model: "seedance_2_0",
    mode: "fast",
    resolutions: ["480p", "720p"],
    audioRefs: false,
    blurb: "Cheaper and quicker, capped at 720p. Rejects audio references, so a render that carries a voice track falls back to Seedance 2.0.",
  },
  {
    id: "seedance_2_0_mini",
    label: "Seedance 2.0 Mini",
    model: "seedance_2_0_mini",
    mode: null,
    resolutions: ["480p", "720p"],
    audioRefs: true,
    blurb: "Budget variant, capped at 720p. Good for blocking passes and cheap alternate takes.",
  },
];

export const DEFAULT_VIDEO_MODEL = "seedance_2_0";
export const DEFAULT_VIDEO_RESOLUTION = "720p";

export function videoModelEntry(id) {
  return VIDEO_MODELS.find((m) => m.id === id) || VIDEO_MODELS[0];
}

// Clamp a stored/incoming (model, resolution) pair to something renderable: an
// unknown model falls back to Seedance 2.0, and a resolution the chosen model
// doesn't offer snaps to 720p (every model has it). Both the normalizer on read
// and the Settings PUT go through here, so a doc written before this setting
// existed — or by an older client — still reads back as a valid pair.
export function normalizeVideoDefaults(model, resolution) {
  const entry = videoModelEntry(typeof model === "string" ? model : "");
  const res = typeof resolution === "string" ? resolution : "";
  return {
    videoModel: entry.id,
    videoResolution: entry.resolutions.includes(res) ? res : DEFAULT_VIDEO_RESOLUTION,
  };
}

// The `generate_video` params for the project's configured default. `mode` is
// omitted for models that take none (Mini), because sending it is an error.
export function videoGenerateParams(settings) {
  const s = settings || {};
  const { videoModel, videoResolution } = normalizeVideoDefaults(s.videoModel, s.videoResolution);
  const entry = videoModelEntry(videoModel);
  return {
    model: entry.model,
    resolution: videoResolution,
    ...(entry.mode ? { mode: entry.mode } : {}),
  };
}

// Human-readable params for the ready-to-paste skill prompts (lib/pack.js) and
// anywhere else the defaults are shown as prose rather than sent as JSON.
export function videoParamsText(settings) {
  const p = videoGenerateParams(settings);
  return `model ${p.model}${p.mode ? `, mode ${p.mode}` : ""}, resolution ${p.resolution}`;
}
