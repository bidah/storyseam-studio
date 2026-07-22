import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import type { Api } from "../lib/api.js";

const d = (schema: v.GenericSchema, text: string) =>
  v.pipe(schema, v.description(text));

export const editTimeline = (api: Api) =>
  defineTool({
    name: "edit_timeline",
    description:
      "Edit the video editor timeline by applying a list of ops (call get_timeline first for item ids, track ids, and frame positions; times are FRAMES at the timeline fps, usually 24). Ops:\n" +
      "- move: set a clip's start frame — { op:'move', id, from, track? }. Optional `track` also re-homes the item onto another track of the SAME media type (the Editor is multi-track — e.g. move a line onto a second dialogue lane so two takes can overlap; items on ONE track must never overlap)\n" +
      "- resize: set a clip's length in frames — { op:'resize', id, durationInFrames, edge? }. Default edge 'end' trims/extends the tail; edge:'start' trims/extends the HEAD (the clip's end stays anchored and its source in-point `offsetFrames` slides with the start)\n" +
      "- split: razor a clip in two at an absolute timeline frame — { op:'split', id, at }. `at` must fall strictly inside the clip. The right half is a NEW item; re-read the returned timeline for its id\n" +
      "- replace: swap an item's MEDIA in place, keeping its position, length, kind and links — { op:'replace', id, src, stillFile?, name? }. This is how a still you just generated lands on the animatic: fill the SLATE with the url + file returned by attach_still. Never use move/remove to place a generated still\n" +
      "- remove: delete a clip/music item — { op:'remove', id }\n" +
      "- volume: set gain 0..2 (1 = unity, 0 = silent) — { op:'volume', id, volume }\n" +
      "- mute: mute/unmute an item — { op:'mute', id, muted }\n" +
      "- disable: disable/enable a clip — skipped in playback but kept on the timeline (greyed) — { op:'disable', id, disabled }\n" +
      "- reorder: set the play order of a track then close gaps — { op:'reorder', track:'video', order:[id,id,...] }\n" +
      "- repack: close gaps in a track so clips play back-to-back — { op:'repack', track:'video' }\n" +
      "- addTrack: append an empty track — { op:'addTrack', type:'audio'|'video', id?, name? } (id must be new; omit it for an auto id). Add a lane BEFORE moving items onto it\n" +
      "Track ids are 'video' and 'music' on a cut, 'picture' and 'dialogue' on an animatic (plus any added lanes). Returns { ok, timeline } with the updated timeline.",
    input: v.object({
      ops: d(
        v.array(
          v.object({
            op: d(
              v.picklist([
                "move",
                "resize",
                "split",
                "replace",
                "remove",
                "volume",
                "mute",
                "disable",
                "reorder",
                "repack",
                "addTrack",
              ]),
              "The edit operation.",
            ),
            id: v.optional(d(v.string(), "Target item id (move/resize/split/replace/remove/volume/mute/disable), or the new track's id (addTrack — must not collide; omit for an auto id).")),
            track: v.optional(d(v.string(), "Target track id — 'video'/'music' on a cut, 'picture'/'dialogue' on an animatic (reorder/repack; on move it re-homes the item onto that same-type track).")),
            type: v.optional(d(v.picklist(["audio", "video"]), "New track's media type (for addTrack).")),
            src: v.optional(d(v.string(), "New media URL (for replace), e.g. the `url` attach_still returned.")),
            stillFile: v.optional(d(v.string(), "The still take's `file` (for replace) — records which take is on screen.")),
            name: v.optional(d(v.string(), "New label for the item (for replace) or the new track (for addTrack).")),
            from: v.optional(d(v.number(), "Start frame (for move).")),
            durationInFrames: v.optional(d(v.number(), "Length in frames (for resize).")),
            edge: v.optional(d(v.picklist(["start", "end"]), "Which edge resize trims (default 'end').")),
            at: v.optional(d(v.number(), "Absolute timeline frame to cut at (for split) — strictly inside the clip.")),
            volume: v.optional(d(v.number(), "Gain 0..2 (for volume).")),
            muted: v.optional(d(v.boolean(), "Mute flag (for mute).")),
            disabled: v.optional(d(v.boolean(), "Disable flag (for disable) — true greys out the clip and skips it in playback.")),
            order: v.optional(d(v.array(v.string()), "Ordered item ids (for reorder).")),
          }),
        ),
        "The ordered list of edit ops to apply.",
      ),
    }),
    async run({ input, signal }) {
      return await api.post("/api/timeline/edit", { ops: input.ops }, signal);
    },
  });
