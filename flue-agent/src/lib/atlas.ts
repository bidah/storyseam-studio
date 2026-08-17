// Atlas Cloud generation tools — the third render backend beside the
// Higgsfield MCP and fal. Same BYOK model as fal (lib/fal.ts): the browser
// keeps the user's Atlas key in localStorage, sends it as `x-flue-atlas-key`
// on each prompt, and app.ts persists it into this conversation's Durable
// Object (lib/atlas-key.ts) before admission — whistlewood.ts reads it back
// and passes it in here. The ATLAS_KEY env secret is an optional operator
// fallback (dev / single-tenant).
//
// Unlike fal's queue API, Atlas is one prediction API
// (https://www.atlascloud.ai/docs): POST /api/v1/model/generateImage,
// /generateVideo or /generateAudio with a `model` body field → prediction id,
// then GET /api/v1/model/prediction/<id> until status leaves "processing".
// Atlas hosts ByteDance Seed Audio 1.0, so unlike fal it CAN run the seed-audio
// / radio flows natively (not just single SFX) — see atlas_generate_audio.
//
// The tool set is TYPED and curated (keep the endpoints in sync with
// worker/src/lib/atlas.js). When no key exists the tools are simply absent,
// mirroring createFalTools' no-credential behavior.
//
// Result URLs come from the authenticated prediction response — pass
// outputs[0] to the same attach routes as Higgsfield/fal results
// (attach_still, attach_visual_generation, …).

import { defineTool } from "@flue/runtime";
import type { ToolDefinition } from "@flue/runtime";
import * as v from "valibot";

const ATLAS_API = "https://api.atlascloud.ai/api/v1";

// Curated models (keep in sync with worker/src/lib/atlas.js). Reference images
// ride on dedicated sibling models (…/edit, …/image-to-video).
const IMAGE_MODEL = "google/nano-banana-2/text-to-image";
const IMAGE_EDIT_MODEL = "google/nano-banana-2/edit";
// Seedance 2.0 (the full model, NOT the -fast variant — fast trades quality and,
// like Higgsfield's mode:fast, is the wrong pick for reference+audio work).
const VIDEO_T2V_MODEL = "bytedance/seedance-2.0/text-to-video";
const VIDEO_I2V_MODEL = "bytedance/seedance-2.0/image-to-video";
// Multimodal "omni-reference" Seedance: reference IMAGES (identity/location
// stills, ≤9), reference VIDEOS (≤3) and reference AUDIOS (speech stems, ≤3)
// in one job, referred to in the prompt positionally ("image 1", "audio 1").
// This is the multishot / lip-sync path — pass the dialogue stem as
// reference_audios and Seedance lip-syncs to it (with generate_audio:true it
// embeds that voice), with NO black-MP4 workaround and NO upload/confirm step
// (the reference arrays take plain public URLs directly).
const VIDEO_REF_MODEL = "bytedance/seedance-2.0/reference-to-video";
// ByteDance Seed Audio 1.0 — the SAME model Higgsfield exposes as `seed_audio`,
// so the seed-audio / radio skills work on Atlas with identical prompt craft.
// Cinematic text-to-audio: one prompt → a full mixed scene (multi-voice
// dialogue + SFX + ambience + music), plus voice cloning from reference clips.
const AUDIO_MODEL = "bytedance/seed-audio-1.0";

// Generic so input property types survive into run({ input }).
const d = <T extends v.GenericSchema>(schema: T, text: string) =>
  v.pipe(schema, v.description(text));

async function atlasFetch(key: string, path: string, init: RequestInit = {}): Promise<Response> {
  if (!key) throw new Error("No Atlas Cloud API key for this conversation");
  return fetch(`${ATLAS_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${key}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...((init.headers as Record<string, string>) || {}),
    },
  });
}

async function atlasErrorText(res: Response): Promise<string> {
  try {
    const body: any = await res.json();
    const detail = body?.error ?? body?.message ?? body?.msg ?? body?.detail ?? body?.data?.error;
    if (typeof detail === "string") return detail;
    if (detail) return JSON.stringify(detail);
  } catch {
    /* non-JSON body */
  }
  return "";
}

// Responses may wrap the prediction under `data` or return it bare.
const unwrap = (j: any) => (j && typeof j === "object" && j.data && typeof j.data === "object" ? j.data : j || {});

// Submit → { prediction_id } (what atlas_job_status needs back). Fast image
// models may complete synchronously — pass outputs through when present.
const SUBMIT_ROUTE: Record<"image" | "video" | "audio", string> = {
  image: "/model/generateImage",
  video: "/model/generateVideo",
  audio: "/model/generateAudio",
};
async function submit(key: string, kind: "image" | "video" | "audio", model: string, input: Record<string, unknown>) {
  const res = await atlasFetch(key, SUBMIT_ROUTE[kind], {
    method: "POST",
    body: JSON.stringify({ model, ...input }),
  });
  if (!res.ok) {
    const detail = await atlasErrorText(res);
    throw new Error(`Atlas submit failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  const p = unwrap(await res.json());
  if (!p?.id) throw new Error("Atlas submit returned no prediction id");
  const status = String(p.status || "processing").toLowerCase();
  return {
    provider: "atlas",
    prediction_id: p.id as string,
    status,
    ...(status === "completed" && Array.isArray(p.outputs) ? { outputs: p.outputs as string[] } : {}),
    note: "Poll with atlas_job_status (prediction_id) until status completed; outputs[0] is the result media URL.",
  };
}

// `userKey` is this conversation's stored BYOK key (whistlewood.ts reads it
// from DO storage each init); the env secret is the operator fallback.
export function createAtlasTools(userKey?: string): ToolDefinition[] {
  const key = (userKey || "").trim() || process.env.ATLAS_KEY || "";
  if (!key) return []; // no Atlas key for this conversation — tools absent by design

  const generateImage = defineTool({
    name: "atlas_generate_image",
    description:
      "Generate an image with Atlas Cloud (Nano Banana 2). Async: returns a prediction_id to poll with atlas_job_status. Pass reference images (character/location sheets, prior stills) as absolute public URLs in image_urls — the edit model is used automatically. Use Atlas when it is the active provider, when the user asks for it, or when the other backends are unavailable; prompts work the same as generate_image.",
    input: v.object({
      prompt: d(v.string(), "The full image prompt (style block + scene)."),
      aspect_ratio: v.optional(
        d(v.picklist(["21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16"]), "Aspect ratio. Default 16:9."),
      ),
      image_urls: v.optional(
        d(v.array(v.pipe(v.string(), v.url())), "Reference image URLs (absolute, publicly fetchable — e.g. /files/... URLs from refUrl fields). Max ~14."),
      ),
    }),
    async run({ data: input }) {
      const refs = input.image_urls?.filter(Boolean) ?? [];
      return {
        output: await submit(key, "image", refs.length ? IMAGE_EDIT_MODEL : IMAGE_MODEL, {
          prompt: input.prompt,
          aspect_ratio: input.aspect_ratio || "16:9",
          ...(refs.length ? { images: refs } : {}),
        }),
      };
    },
  });

  const generateVideo = defineTool({
    name: "atlas_generate_video",
    description:
      "Generate a video with Atlas Cloud (Seedance 2.0). Async: returns a prediction_id to poll with atlas_job_status. THREE modes, picked automatically: (1) plain text→video; (2) pass a start frame (a shot's still) as image_url → image-to-video, the preferred path for a single shot render (identity + composition lock); (3) pass any of reference_image_urls / reference_video_urls / reference_audio_urls → the multimodal 'omni-reference' model for multishot & lip-sync. For lip-sync, put the shot's SPEECH stem in reference_audio_urls and the character/location stills in reference_image_urls, keep generate_audio true, and in the prompt refer to them positionally ('image 1 is Sara …; lip-sync exactly to audio 1'). Seedance embeds that voice — no black-MP4 trick, no upload step (URLs go straight in).",
    input: v.object({
      prompt: d(v.string(), "The full motion prompt (style/motion block + action). For reference jobs, describe each reference positionally ('image 1', 'video 1', 'audio 1') and say to lip-sync to the audio."),
      image_url: v.optional(d(v.pipe(v.string(), v.url()), "Start-frame image URL (absolute, publicly fetchable). Use for a single-shot image-to-video render — NOT for multishot identity refs (use reference_image_urls for those).")),
      reference_image_urls: v.optional(d(v.array(v.pipe(v.string(), v.url())), "Up to 9 reference image URLs (character/location stills) for the omni-reference model — identity/composition anchors, distinct from a start frame.")),
      reference_video_urls: v.optional(d(v.array(v.pipe(v.string(), v.url())), "Up to 3 reference video URLs (motion/style clips) for the omni-reference model.")),
      reference_audio_urls: v.optional(d(v.array(v.pipe(v.string(), v.url())), "Up to 3 reference audio URLs (the SPEECH stem to lip-sync to — WAV/MP3, ≤30s each). Triggers lip-sync on the omni-reference model.")),
      aspect_ratio: v.optional(d(v.picklist(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "adaptive"]), "Aspect ratio. Default adaptive (matches the first reference/frame), else 16:9.")),
      duration: v.optional(d(v.pipe(v.number(), v.integer(), v.minValue(4), v.maxValue(15)), "Duration in seconds (4-15). Default 5. For a lip-sync shot use max(4, round(speech length)).")),
      generate_audio: v.optional(d(v.boolean(), "Embed synchronized audio. Default false for plain text/image jobs; default TRUE when reference_audio_urls is present so the lip-synced voice is embedded.")),
      resolution: v.optional(d(v.picklist(["480p", "720p", "1080p", "1440p-SR", "4k"]), "Video resolution. Default 720p.")),
    }),
    async run({ data: input }) {
      const refImgs = (input.reference_image_urls ?? []).filter(Boolean).slice(0, 9);
      const refVids = (input.reference_video_urls ?? []).filter(Boolean).slice(0, 3);
      const refAuds = (input.reference_audio_urls ?? []).filter(Boolean).slice(0, 3);
      const isRef = refImgs.length > 0 || refVids.length > 0 || refAuds.length > 0;
      const model = isRef ? VIDEO_REF_MODEL : input.image_url ? VIDEO_I2V_MODEL : VIDEO_T2V_MODEL;
      return {
        output: await submit(key, "video", model, {
          prompt: input.prompt,
          ratio: input.aspect_ratio || (isRef || input.image_url ? "adaptive" : "16:9"),
          duration: input.duration ?? 5,
          // Reference jobs carrying a speech stem default to embedding audio (the
          // lip-synced voice); plain text/image jobs stay silent unless asked.
          generate_audio: input.generate_audio ?? (refAuds.length > 0),
          resolution: input.resolution || "720p",
          ...(isRef
            ? {
                ...(refImgs.length ? { reference_images: refImgs } : {}),
                ...(refVids.length ? { reference_videos: refVids } : {}),
                ...(refAuds.length ? { reference_audios: refAuds } : {}),
              }
            : input.image_url
              ? { image: input.image_url }
              : {}),
        }),
      };
    },
  });

  const generateAudio = defineTool({
    name: "atlas_generate_audio",
    description:
      "Generate cinematic audio with Atlas Cloud (ByteDance Seed Audio 1.0 — the SAME Seed Audio model Higgsfield exposes as seed_audio). Async: returns a prediction_id to poll with atlas_job_status; outputs[0] is the audio URL — attach it with attach_sound / attach_radio_take. One text prompt renders a full mixed scene (multi-voice dialogue, SFX, ambience, music), NOT plain TTS. Use it when Atlas is the active provider; prompt craft is identical to the seed-audio skill (structure the scene, ≤2048 chars). For voice-consistent takes pass reference clip URLs in reference_audio_urls (absolute public /files/... URLs) and refer to them in the prompt as @Audio1/@Audio2/@Audio3.",
    input: v.object({
      prompt: d(v.string(), "The audio scene description / dialogue script (Seed Audio 'text'). Keep ≤2048 chars; structure it like the seed-audio skill."),
      format: v.optional(d(v.picklist(["mp3", "wav", "pcm", "ogg_opus"]), "Output audio format. Default mp3 (web-playable; wav is lossless).")),
      sample_rate: v.optional(d(v.picklist([8000, 16000, 24000, 32000, 44100, 48000]), "Output sample rate in Hz. Default 24000; 48000 for film fidelity.")),
      speech_rate: v.optional(d(v.pipe(v.number(), v.integer(), v.minValue(-50), v.maxValue(100)), "Speaking speed. 0 = default, +faster / −slower.")),
      loudness_rate: v.optional(d(v.pipe(v.number(), v.integer(), v.minValue(-50), v.maxValue(100)), "Overall loudness/gain. 0 = default, + louder.")),
      pitch_rate: v.optional(d(v.pipe(v.number(), v.integer(), v.minValue(-12), v.maxValue(12)), "Pitch shift. − deeper voices, + higher/younger.")),
      reference_audio_urls: v.optional(
        d(v.array(v.pipe(v.string(), v.url())), "Up to 3 reference voice-clip URLs (absolute, publicly fetchable — e.g. /files/... links) to clone voices; map each to a character in the prompt via @Audio1/@Audio2/@Audio3."),
      ),
    }),
    async run({ data: input }) {
      const refs = (input.reference_audio_urls ?? []).filter(Boolean).slice(0, 3);
      return {
        output: await submit(key, "audio", AUDIO_MODEL, {
          text: input.prompt,
          format: input.format || "mp3",
          sample_rate: input.sample_rate ?? 24000,
          speech_rate: input.speech_rate ?? 0,
          loudness_rate: input.loudness_rate ?? 0,
          pitch_rate: input.pitch_rate ?? 0,
          ...(refs.length ? { references: refs.map((u) => ({ audio_url: u })) } : {}),
        }),
      };
    },
  });

  const jobStatus = defineTool({
    name: "atlas_job_status",
    description:
      "Check an Atlas Cloud prediction started by an atlas_generate_* tool. Pass back the prediction_id that tool returned. While running returns { status: processing }; when completed also returns outputs (result media URLs — attach outputs[0] with the usual attach tools). status failed/timeout carries the error. Poll every ~5s (images) / ~15s (video).",
    input: v.object({
      prediction_id: d(v.string(), "The prediction_id returned by the atlas_generate_* tool."),
    }),
    async run({ data: input }): Promise<any> {
      const res = await atlasFetch(key, `/model/prediction/${encodeURIComponent(input.prediction_id.trim())}`);
      if (!res.ok) {
        const detail = await atlasErrorText(res);
        throw new Error(`Atlas prediction failed (${res.status})${detail ? `: ${detail}` : ""}`);
      }
      const p = unwrap(await res.json());
      const status = String(p?.status || "processing").toLowerCase();
      if (status === "completed") {
        return { output: { status, outputs: Array.isArray(p.outputs) ? p.outputs : [] } };
      }
      if (status === "failed" || status === "timeout") {
        return { output: { status, error: String(p?.error || `Atlas prediction ${status}`) } };
      }
      return { output: { status } };
    },
  });

  return [generateImage, generateVideo, generateAudio, jobStatus];
}
