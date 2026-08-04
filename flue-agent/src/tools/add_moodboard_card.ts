import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const addMoodboardCard = (api: Api) =>
  defineTool({
    name: "add_moodboard_card",
    description:
      "Put ONE card on the project's Moodboard — the reference wall. Four kinds: `note` (a sticky note; `content` is its text — use this for tone, palette, texture and look notes), `image` (a reference picture; `url` is fetched and stored, so it keeps working when the source link dies), `video` (a reference clip; same fetch-and-store), and `link` (any web page; it is unfurled server-side into a preview card). Call get_moodboard first and skip anything already up there — this does NOT dedupe. Placement is automatic: a new card takes the first EMPTY spot on the canvas, so it can never cover the author's arrangement; only pass x/y if the author asked for a specific spot. One card per call. To add a still or generation that already exists in this project, pass its absolute /files/… URL as `url`. Adding a reference here does NOT make it a shot reference — the Moodboard is the look-and-feel wall, and select_reference is what binds art to a shot.",
    input: v.object({
      type: d(
        v.picklist(["note", "image", "video", "link"]),
        'What kind of card: "note" (sticky note), "image", "video", or "link".',
      ),
      content: v.optional(
        d(v.string(), "For a note: the text of the sticky. Ignored by the other types."),
      ),
      url: v.optional(
        d(
          v.string(),
          "For image / video / link: the URL. Images and videos are fetched and stored on our side; links are unfurled into a preview. Required for those three types.",
        ),
      ),
      color: v.optional(
        d(
          v.string(),
          'For a note: the paper color as a hex string, default "#fde047" (yellow). Use a different color only when the author is grouping notes by color.',
        ),
      ),
      x: v.optional(d(v.number(), "Optional exact canvas X. Omit to auto-place.")),
      y: v.optional(d(v.number(), "Optional exact canvas Y. Omit to auto-place.")),
    }),
    async run({ data: input, signal }) {
      return { output: await api.post("/api/moodboard/cards", input, signal) };
    },
  });

export const removeMoodboardCard = (api: Api) =>
  defineTool({
    name: "remove_moodboard_card",
    description:
      "Take ONE card off the project's Moodboard, by its id (get_moodboard lists them). Use it when the author says a reference is wrong or no longer the direction. It removes the card, not the underlying media — a stored image stays in the project. Only remove a card the author actually asked you to remove: the board is their arrangement, and a reference you judged off-brief may be there deliberately as a contrast.",
    input: v.object({
      id: d(v.pipe(v.string(), v.minLength(1)), "The card id from get_moodboard."),
    }),
    async run({ data: input, signal }) {
      return {
        output: await api.req(`/api/moodboard/cards/${input.id}`, "DELETE", undefined, signal),
      };
    },
  });
