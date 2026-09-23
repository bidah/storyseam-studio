// The Upscale tools — a finished Stage sitting or Editor Deliver render, taken
// to a higher resolution on fal. Same three calls the tab makes: read what can
// be upscaled, start a job, poll it until the file is copied into the project.
import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";
import { inputSchema } from "../lib/schema-to-valibot.js";
import upscaleSchema from "../schemas/upscale.json";

export const listUpscales = (api: Api) =>
  defineTool({
    name: "list_upscales",
    description:
      "Everything the Upscale tab shows: `sources` — every video that can be upscaled (kept Stage sittings as `sitting:<id>`, their scored versions as `scored:<id>`, Editor Deliver renders as `render:<file>`), newest first — the `models` with the resolutions each one offers, and `jobs`, every upscale this project has started with its status and, once done, the upscaled file's url. Read it before upscale_video, and to answer \"is my upscale done\" or \"where is the 4K version\".",
    input: v.object({}),
    async run({ signal }) {
      return { output: await api.get("/api/upscale", signal) };
    },
  });

// Description and input both come from the SHARED contract
// (shared/schemas/upscale.json) — the same file POST /api/upscale validates.
export const upscaleVideo = (api: Api) =>
  defineTool({
    name: "upscale_video",
    description: upscaleSchema.description,
    input: inputSchema(upscaleSchema),
    async run({ data, signal }) {
      return { output: await api.post("/api/upscale", data, signal) };
    },
  });

export const getUpscale = (api: Api) =>
  defineTool({
    name: "get_upscale",
    description:
      "Check one upscale job. `status` is `running` (still on fal — `queue` says IN_QUEUE or IN_PROGRESS), `done` (the upscaled file is in the project; `job.url` plays it) or `error` (with the reason). The first poll that finds it finished copies the file into the project, so poll until it settles rather than assuming. A pass usually takes a few minutes; a long film at 4K can take much longer — tell the author it is running and check back instead of polling in a tight loop.",
    input: v.object({
      jobId: d(v.string(), "The job id upscale_video returned (or one from list_upscales)."),
    }),
    async run({ data: input, signal }) {
      return { output: await api.get(`/api/upscale/jobs/${encodeURIComponent(String(input.jobId))}`, signal) };
    },
  });
