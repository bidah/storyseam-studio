// Atlas Cloud generation tools — the third render backend beside the
// Higgsfield MCP and fal. Same BYOK model as fal (lib/fal.ts): the browser
// keeps the user's Atlas key in localStorage, sends it as `x-flue-atlas-key`
// on each prompt, and app.ts persists it into this conversation's Durable
// Object (lib/atlas-key.ts) before admission — whistlewood.ts reads it back
// and passes it in here. The ATLAS_KEY env secret is an optional operator
// fallback (dev / single-tenant).
//
// Unlike fal's queue API, Atlas is one prediction API
// (https://www.atlascloud.ai/docs): POST /api/v1/model/generateImage or
// /generateVideo with a `model` body field → prediction id, then
// GET /api/v1/model/prediction/<id> until status leaves "processing".
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
const VIDEO_T2V_MODEL = "bytedance/seedance-2.0-fast/text-to-video";
const VIDEO_I2V_MODEL = "bytedance/seedance-2.0-fast/image-to-video";

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
async function submit(key: string, kind: "image" | "video", model: string, input: Record<string, unknown>) {
  const res = await atlasFetch(key, kind === "video" ? "/model/generateVideo" : "/model/generateImage", {
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
    async run({ input }) {
      const refs = input.image_urls?.filter(Boolean) ?? [];
      return await submit(key, "image", refs.length ? IMAGE_EDIT_MODEL : IMAGE_MODEL, {
        prompt: input.prompt,
        aspect_ratio: input.aspect_ratio || "16:9",
        ...(refs.length ? { images: refs } : {}),
      });
    },
  });

  const generateVideo = defineTool({
    name: "atlas_generate_video",
    description:
      "Generate a video with Atlas Cloud (Seedance 2.0 Fast). Async: returns a prediction_id to poll with atlas_job_status. Pass a start frame (a shot's still) as image_url — the image-to-video model is used automatically, which is the preferred path for shot renders (identity + composition lock).",
    input: v.object({
      prompt: d(v.string(), "The full motion prompt (style/motion block + action)."),
      image_url: v.optional(d(v.pipe(v.string(), v.url()), "Start-frame image URL (absolute, publicly fetchable). Strongly recommended for shot renders.")),
      aspect_ratio: v.optional(d(v.picklist(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]), "Aspect ratio. Default 16:9 (with a start frame it adapts to the frame).")),
      duration: v.optional(d(v.pipe(v.number(), v.integer(), v.minValue(4), v.maxValue(15)), "Duration in seconds (4-15). Default 5.")),
      generate_audio: v.optional(d(v.boolean(), "Generate synchronized audio. Default false (dialogue/SFX usually come from the Radio track).")),
      resolution: v.optional(d(v.picklist(["480p", "720p", "1080p-SR"]), "Video resolution. Default 720p.")),
    }),
    async run({ input }) {
      return await submit(key, "video", input.image_url ? VIDEO_I2V_MODEL : VIDEO_T2V_MODEL, {
        prompt: input.prompt,
        ratio: input.aspect_ratio || (input.image_url ? "adaptive" : "16:9"),
        duration: input.duration ?? 5,
        generate_audio: input.generate_audio ?? false,
        resolution: input.resolution || "720p",
        ...(input.image_url ? { image: input.image_url } : {}),
      });
    },
  });

  const jobStatus = defineTool({
    name: "atlas_job_status",
    description:
      "Check an Atlas Cloud prediction started by an atlas_generate_* tool. Pass back the prediction_id that tool returned. While running returns { status: processing }; when completed also returns outputs (result media URLs — attach outputs[0] with the usual attach tools). status failed/timeout carries the error. Poll every ~5s (images) / ~15s (video).",
    input: v.object({
      prediction_id: d(v.string(), "The prediction_id returned by the atlas_generate_* tool."),
    }),
    async run({ input }): Promise<any> {
      const res = await atlasFetch(key, `/model/prediction/${encodeURIComponent(input.prediction_id.trim())}`);
      if (!res.ok) {
        const detail = await atlasErrorText(res);
        throw new Error(`Atlas prediction failed (${res.status})${detail ? `: ${detail}` : ""}`);
      }
      const p = unwrap(await res.json());
      const status = String(p?.status || "processing").toLowerCase();
      if (status === "completed") {
        return { status, outputs: Array.isArray(p.outputs) ? p.outputs : [] };
      }
      if (status === "failed" || status === "timeout") {
        return { status, error: String(p?.error || `Atlas prediction ${status}`) };
      }
      return { status };
    },
  });

  return [generateImage, generateVideo, jobStatus];
}
