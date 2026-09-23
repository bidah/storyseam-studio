// The Stage tools.
//
// WHAT AN AGENT CANNOT DO HERE, and why that is not a gap. A Director sitting is
// a WebRTC peer connection between the BROWSER and fal, recorded frame by frame
// as it arrives. There is no request to make and no job to poll — the film is
// only kept because something was decoding it on screen while it played. So the
// agent's half of this surface is everything either side of the sitting: saying
// whether one is worth paying for, and reading what the ones already run
// produced.
//
// That first half is the valuable one. A sitting bills from its first second and
// a refused `configure` bills for it anyway, so the most useful thing an agent
// can do on this tab is tell the author, before they press play, that the sheet
// they just wrote will be thrown out at the door.
import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

type SeriesView = {
  series?: { title?: string; imageUrl?: string; directions?: unknown[]; modelSheets?: unknown[] };
  issues?: Record<string, string>;
  reels?: { reel: number; beats: number; pins: number; seconds: number }[];
  screening?: { filmSeconds?: number };
};

export const getStage = (api: Api) =>
  defineTool({
    name: "get_stage",
    description:
      "What a sitting of this Series would actually send: the exact `configure` message, the appended reels after it, how many seconds of film it comes to, and the cap past which the session's heartbeat stops being forwarded. Read it when the author asks what will happen if they press play, or how long the piece runs. Two sittings of one Series are DIFFERENT FILMS — the endpoint is not deterministic — so this describes what will be attempted, never what will come back.",
    input: v.object({
      seriesId: d(v.string(), "The Series to be played (from get_director)."),
    }),
    async run({ data: input, signal }) {
      return { output: await api.get(`/api/stage/series/${encodeURIComponent(String(input.seriesId))}`, signal) };
    },
  });

export const preflightSitting = (api: Api) =>
  defineTool({
    name: "preflight_sitting",
    description:
      "Is this Series worth paying for a sitting of? Checks everything the endpoint would refuse it for — the per-reel ceilings on beats and pinned frames, the spacing between pins, the opening chunk each reel's first pin has to clear — plus the things that are not refusals but are almost always mistakes: no first frame, no beats at all, no reference sheets to hold a design still. Run this BEFORE telling an author to press play. A session bills from its first second and a `configure` the endpoint throws out bills for it too, so a refusal found here is the difference between a warning and an invoice.",
    input: v.object({
      seriesId: d(v.string(), "The Series to check (from get_director)."),
    }),
    async run({ data: input, signal }) {
      const id = encodeURIComponent(String(input.seriesId));
      const view = (await api.get(`/api/director/series/${id}`, signal)) as SeriesView;
      const series = view.series ?? {};
      const issues = view.issues ?? {};
      const refusals = Object.entries(issues).map(([field, message]) => ({ field, message }));

      // Not refusals. A Series can be legal and still be a waste of a sitting,
      // and the author would rather hear both in one answer than find the second
      // kind out by watching it.
      const warnings: string[] = [];
      const beats = Array.isArray(series.directions) ? series.directions.length : 0;
      if (!series.imageUrl) {
        warnings.push(
          "No first frame. The Director will invent an opening image, and every frame after it is generated from that one — so the piece will not look like itself.",
        );
      }
      if (!beats) {
        warnings.push(
          "No cue sheet. The film will drift from the opening prompt rather than following an arc. derive_cue_sheet turns the shot list into one.",
        );
      }
      if (!(Array.isArray(series.modelSheets) ? series.modelSheets.length : 0)) {
        warnings.push(
          "No model sheets. Nothing is holding a character or a place still across the piece, so designs will drift shot to shot.",
        );
      }
      return {
        output: {
          seriesId: String(input.seriesId),
          title: series.title ?? null,
          ready: refusals.length === 0,
          refusals,
          warnings,
          reels: view.reels ?? [],
          filmSeconds: view.screening?.filmSeconds ?? 0,
        },
      };
    },
  });

export const listSittings = (api: Api) =>
  defineTool({
    name: "list_sittings",
    description:
      "Every sitting this project has kept — which Series each is of, how long it ran, when it was recorded, and whether it has a scored version yet. A sitting is a FILE: fal keeps nothing, so a sitting that was not recorded while it played cannot be recovered, and re-running the Series does not get it back. These are what the Musicalized tab scores and what the Editor can cut with.",
    input: v.object({}),
    async run({ signal }) {
      return { output: await api.get("/api/stage/sittings", signal) };
    },
  });

export const forgetSitting = (api: Api) =>
  defineTool({
    name: "forget_sitting",
    description:
      "Take a sitting off the list. It drops the RECORD, not the file — the bytes stay exactly where they are, the same promise uninstalling a plugin makes. Say so when you offer it: an author deciding whether to tidy up is deciding whether something is gone forever, and here it is not. Use it for a sitting that failed early or that the author has replaced, never to clean up on your own initiative.",
    input: v.object({
      sittingId: d(v.string(), "The sitting's id, from list_sittings."),
    }),
    async run({ data: input, signal }) {
      return {
        output: await api.req(`/api/stage/sittings/${encodeURIComponent(String(input.sittingId))}`, "DELETE", undefined, signal),
      };
    },
  });
