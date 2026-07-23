// fal.ai generation tools — the second render backend beside the Higgsfield
// MCP. Unlike Higgsfield (per-user OAuth bearer bridged from the worker), fal
// is a plain HTTP API keyed by the USER'S OWN fal key (BYOK): the browser keeps
// it in localStorage, sends it as `x-flue-fal-key` on each prompt, and app.ts
// persists it into this conversation's Durable Object (lib/fal-key.ts) before
// admission — whistlewood.ts reads it back and passes it in here. The FAL_KEY
// env secret is an optional operator fallback (dev / single-tenant). No MCP
// handshake — jobs go through the queue API (https://queue.fal.run):
// submit → poll status → fetch result.
//
// The tool set is TYPED and curated (we control the endpoints, so real valibot
// schemas instead of the Higgsfield wrapper's permissive looseObject): one tool
// per medium plus a shared job poller. When FAL_KEY is unset the tools are
// simply absent, mirroring createHiggsfieldTools' no-credential behavior.
//
// Result URLs live on fal.media — pass them to the same attach routes as
// Higgsfield results (attach_still, attach_visual_generation, …); the worker's
// URL gates accept fal.media.

import { defineTool } from "@flue/runtime";
import type { ToolDefinition } from "@flue/runtime";
import * as v from "valibot";

const FAL_QUEUE = "https://queue.fal.run";

// Curated endpoints (keep in sync with worker/src/lib/fal.js). Image references
// ride on dedicated sibling endpoints (…/edit, …/image-to-video).
const IMAGE_ENDPOINT = "fal-ai/nano-banana-pro";
const IMAGE_EDIT_ENDPOINT = "fal-ai/nano-banana-pro/edit";
const VIDEO_T2V_ENDPOINT = "bytedance/seedance-2.0/fast/text-to-video";
const VIDEO_I2V_ENDPOINT = "bytedance/seedance-2.0/fast/image-to-video";
const AUDIO_SFX_ENDPOINT = "fal-ai/elevenlabs/sound-effects";

// fal_job_status only ever polls endpoints this module submitted to.
const KNOWN_ENDPOINTS = new Set([
  IMAGE_ENDPOINT,
  IMAGE_EDIT_ENDPOINT,
  VIDEO_T2V_ENDPOINT,
  VIDEO_I2V_ENDPOINT,
  AUDIO_SFX_ENDPOINT,
]);

// Queue request URLs are addressed by the APP id (owner/alias — the first two
// path segments), not the full endpoint subpath.
const queueBase = (endpoint: string) => endpoint.split("/").slice(0, 2).join("/");

// Generic (unlike the tools' local `d` helpers) so input property types survive
// into run({ input }).
const d = <T extends v.GenericSchema>(schema: T, text: string) =>
  v.pipe(schema, v.description(text));

async function falFetch(key: string, url: string, init: RequestInit = {}): Promise<Response> {
  if (!key) throw new Error("No fal API key for this conversation");
  return fetch(url, {
    ...init,
    headers: {
      authorization: `Key ${key}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...((init.headers as Record<string, string>) || {}),
    },
  });
}

async function falErrorText(res: Response): Promise<string> {
  try {
    const body: any = await res.json();
    const detail = body?.detail ?? body?.error ?? body?.message;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) return detail.map((e: any) => e?.msg || JSON.stringify(e)).join("; ");
    if (detail) return JSON.stringify(detail);
  } catch {
    /* non-JSON body */
  }
  return "";
}

// Submit → { endpoint, request_id } (the exact pair fal_job_status needs back).
async function submit(key: string, endpoint: string, input: Record<string, unknown>) {
  const res = await falFetch(key, `${FAL_QUEUE}/${endpoint}`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const detail = await falErrorText(res);
    throw new Error(`fal submit failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  const data: any = await res.json();
  if (!data?.request_id) throw new Error("fal submit returned no request_id");
  return {
    provider: "fal",
    endpoint,
    request_id: data.request_id as string,
    status: "submitted",
    note: "Poll with fal_job_status (endpoint + request_id) until status COMPLETED; the result contains the fal.media output URL.",
  };
}

// `userKey` is this conversation's stored BYOK key (whistlewood.ts reads it
// from DO storage each init); the env secret is the operator fallback.
export function createFalTools(userKey?: string): ToolDefinition[] {
  const key = (userKey || "").trim() || process.env.FAL_KEY || "";
  if (!key) return []; // no fal key for this conversation — tools absent by design

  const generateImage = defineTool({
    name: "fal_generate_image",
    description:
      "Generate an image with fal.ai (Nano Banana Pro). Async: returns a request_id to poll with fal_job_status. Pass reference images (character/location sheets, prior stills) as absolute public URLs in image_urls — the edit endpoint is used automatically. Use fal when the user asks for it or when Higgsfield is unavailable; prompts work the same as Higgsfield's generate_image.",
    input: v.object({
      prompt: d(v.string(), "The full image prompt (style block + scene)."),
      aspect_ratio: v.optional(
        d(v.picklist(["21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16"]), "Aspect ratio. Default 16:9."),
      ),
      image_urls: v.optional(
        d(v.array(v.pipe(v.string(), v.url())), "Reference image URLs (absolute, publicly fetchable — e.g. /files/... URLs from refUrl fields). Max ~4."),
      ),
      num_images: v.optional(d(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(4)), "How many images (1-4). Default 1.")),
    }),
    async run({ input }) {
      const refs = input.image_urls?.filter(Boolean) ?? [];
      return await submit(key, refs.length ? IMAGE_EDIT_ENDPOINT : IMAGE_ENDPOINT, {
        prompt: input.prompt,
        aspect_ratio: input.aspect_ratio || "16:9",
        num_images: input.num_images ?? 1,
        ...(refs.length ? { image_urls: refs } : {}),
      });
    },
  });

  const generateVideo = defineTool({
    name: "fal_generate_video",
    description:
      "Generate a video with fal.ai (Seedance 2.0 Fast). Async: returns a request_id to poll with fal_job_status. Pass a start frame (a shot's still) as image_url — the image-to-video endpoint is used automatically, which is the preferred path for shot renders (identity + composition lock).",
    input: v.object({
      prompt: d(v.string(), "The full motion prompt (style/motion block + action)."),
      image_url: v.optional(d(v.pipe(v.string(), v.url()), "Start-frame image URL (absolute, publicly fetchable). Strongly recommended for shot renders.")),
      aspect_ratio: v.optional(d(v.picklist(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]), "Aspect ratio. Default 16:9.")),
      duration: v.optional(d(v.pipe(v.number(), v.integer(), v.minValue(4), v.maxValue(15)), "Duration in seconds (4-15). Default 5.")),
      generate_audio: v.optional(d(v.boolean(), "Generate synchronized audio. Default false (dialogue/SFX usually come from the Radio track).")),
      resolution: v.optional(d(v.picklist(["480p", "720p"]), "Video resolution. Default 720p.")),
    }),
    async run({ input }) {
      return await submit(key, input.image_url ? VIDEO_I2V_ENDPOINT : VIDEO_T2V_ENDPOINT, {
        prompt: input.prompt,
        aspect_ratio: input.aspect_ratio || "16:9",
        duration: String(input.duration ?? 5),
        generate_audio: input.generate_audio ?? false,
        resolution: input.resolution || "720p",
        ...(input.image_url ? { image_url: input.image_url } : {}),
      });
    },
  });

  const generateAudio = defineTool({
    name: "fal_generate_audio",
    description:
      "Generate a sound effect with fal.ai (ElevenLabs SFX). Async: returns a request_id to poll with fal_job_status. NOTE: fal has no Seed Audio equivalent — this makes single sound effects/ambiences from a text description, not multi-voice dialogue scenes; for those keep using the Higgsfield seed-audio flow.",
    input: v.object({
      prompt: d(v.string(), "Text description of the sound effect to generate."),
      duration_seconds: v.optional(d(v.pipe(v.number(), v.minValue(0.5), v.maxValue(22)), "Duration in seconds (0.5-22). Omit to auto-fit.")),
    }),
    async run({ input }) {
      return await submit(key, AUDIO_SFX_ENDPOINT, {
        text: input.prompt,
        ...(input.duration_seconds != null ? { duration_seconds: input.duration_seconds } : {}),
      });
    },
  });

  const jobStatus = defineTool({
    name: "fal_job_status",
    description:
      "Check a fal.ai job started by a fal_generate_* tool. Pass back the endpoint + request_id that tool returned. While running returns { status: IN_QUEUE | IN_PROGRESS }; when COMPLETED also returns the model output (images[].url / video.url / audio.url on fal.media) — attach that URL with the usual attach tools. Poll every ~5s (images) / ~15s (video).",
    input: v.object({
      endpoint: d(v.string(), "The endpoint id returned by the fal_generate_* tool."),
      request_id: d(v.string(), "The request_id returned by the fal_generate_* tool."),
    }),
    async run({ input }): Promise<any> {
      const endpoint = input.endpoint.trim();
      if (!KNOWN_ENDPOINTS.has(endpoint)) {
        throw new Error(`Unknown fal endpoint '${endpoint}' — pass the endpoint a fal_generate_* tool returned.`);
      }
      const base = queueBase(endpoint);
      const id = encodeURIComponent(input.request_id.trim());
      const stRes = await falFetch(key, `${FAL_QUEUE}/${base}/requests/${id}/status`);
      if (!stRes.ok) {
        const detail = await falErrorText(stRes);
        throw new Error(`fal status failed (${stRes.status})${detail ? `: ${detail}` : ""}`);
      }
      const st: any = await stRes.json();
      const status = String(st?.status || "IN_PROGRESS").toUpperCase();
      if (status !== "COMPLETED") {
        return { status, ...(st?.queue_position != null ? { queue_position: st.queue_position as number } : {}) };
      }
      const outRes = await falFetch(key, `${FAL_QUEUE}/${base}/requests/${id}`);
      if (!outRes.ok) {
        // A completed-but-failed job surfaces here (422 with the failure detail).
        const detail = await falErrorText(outRes);
        return { status: "FAILED", error: detail || `fal job failed (${outRes.status})` };
      }
      return { status: "COMPLETED", result: (await outRes.json()) as any };
    },
  });

  return [generateImage, generateVideo, generateAudio, jobStatus];
}
