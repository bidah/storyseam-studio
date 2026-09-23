// The Upscale plugin's model registry and ledger.
//
// A CURATED registry, like `fal.js`: fal hosts several video upscalers, each
// with its own idea of what "resolution" means — SeedVR2 takes a target height,
// ByteDance takes a named tier ("2k", "4k"), Topaz takes a multiplication
// factor. The author picks ONE vocabulary (a target height) and this file maps
// it onto each schema, so the picker never has to explain three.
import { readDoc, updateDoc } from "./docs.js";

/** Target heights, smallest first. The shared contract enumerates the same four. */
export const RESOLUTIONS = ["720p", "1080p", "1440p", "2160p"];
const HEIGHT = { "720p": 720, "1080p": 1080, "1440p": 1440, "2160p": 2160 };

/** What a source is assumed to be when nobody measured it: the Editor's and the Director's default. */
const DEFAULT_SOURCE_HEIGHT = 720;

export const UPSCALE_MODELS = [
  {
    id: "seedvr",
    label: "SeedVR2",
    blurb: "Diffusion restoration — the sharpest on AI-generated footage.",
    endpoint: "fal-ai/seedvr/upscale/video",
    resolutions: ["720p", "1080p", "1440p", "2160p"],
    input: (videoUrl, resolution) => ({
      video_url: videoUrl,
      upscale_mode: "target",
      target_resolution: resolution,
      output_format: "X264 (.mp4)",
      output_quality: "high",
    }),
  },
  {
    id: "bytedance",
    label: "ByteDance Upscaler",
    blurb: "Fast and clean, tuned for AI-generated video.",
    endpoint: "fal-ai/bytedance-upscaler/upscale/video",
    resolutions: ["1080p", "1440p", "2160p"],
    input: (videoUrl, resolution) => ({
      video_url: videoUrl,
      target_resolution: { "1080p": "1080p", "1440p": "2k", "2160p": "4k" }[resolution],
      enhancement_preset: "aigc",
    }),
  },
  {
    id: "topaz",
    label: "Topaz Proteus",
    blurb: "Conservative — invents the least detail.",
    endpoint: "fal-ai/topaz/upscale/video",
    resolutions: ["1080p", "1440p", "2160p"],
    // Topaz scales by a FACTOR, so the target height has to be divided by the
    // source's. Clamped to what the endpoint accepts; H.264 because its default
    // (H.265) will not play in most browsers.
    input: (videoUrl, resolution, sourceHeight) => ({
      video_url: videoUrl,
      model: "Proteus",
      upscale_factor: Math.min(4, Math.max(1, Math.round((HEIGHT[resolution] / (sourceHeight || DEFAULT_SOURCE_HEIGHT)) * 100) / 100)),
      H264_output: true,
    }),
  },
];

export const upscaleModel = (id) => UPSCALE_MODELS.find((m) => m.id === id) || null;

/** The registry as the GUI and the agent see it — no functions, no endpoints to misuse. */
export const modelCatalog = () =>
  UPSCALE_MODELS.map(({ id, label, blurb, endpoint, resolutions }) => ({ id, label, blurb, endpoint, resolutions }));

// ── The ledger ───────────────────────────────────────────────────────────────
// `upscales` — every job this project started, newest first. fal keeps a
// result for a while and then forgets it, so a finished job's bytes are copied
// into our bucket and THAT is the url the ledger keeps.
export const emptyUpscales = () => ({ jobs: [] });
export const readUpscales = (env, pid) => readDoc(env, pid, "upscales", emptyUpscales());
export const updateUpscales = (env, pid, mutate, opts) =>
  updateDoc(env, pid, "upscales", emptyUpscales(), mutate, opts);

/** How many jobs the ledger remembers. Older records drop; their files stay. */
export const MAX_JOBS = 100;
