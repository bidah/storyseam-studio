import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const attachEpisodeVideo = (api: Api) =>
  defineTool({
    name: "attach_episode_video",
    description:
      "Attach a rendered Seedance clip to an episode bundle by URL. Appends a new generation (keeps prior takes) — downloads the clip into the bundle's generations. This is the video equivalent of attach_sound, used after rendering with the generate-multishot / continue-video skills.",
    input: v.object({
      bundle: d(v.pipe(v.string(), v.minLength(1)), "Bundle id, e.g. MS-01."),
      url: d(v.pipe(v.string(), v.url()), "Remote URL of the rendered mp4."),
      jobId: v.optional(
        d(v.string(), "Optional Higgsfield job id for reference."),
      ),
    }),
    async run({ data: input, signal }) {
      const { bundle, url, jobId } = input;
      return {
        output: await api.post(
          "/api/episode/video",
          { bundle, url, jobId },
          signal,
        ),
      };
    },
  });
