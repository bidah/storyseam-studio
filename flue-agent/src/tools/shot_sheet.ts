// The Shot Sheet tools — drawing a whole cue sheet's pins as one short film.
//
// WHY THIS SURFACE EXISTS AT ALL. A pinned frame is the exact picture the
// Director continues a chunk from. Draw it in an image model and you hand the
// Director a frame it has to TRANSLATE — a richer painted still, a flatter cel
// still, either way a hand it did not draw, and the translation shows as a jump
// at every pin. Ask the video model for one short clip that is nothing but N
// finished frames, hard cut, and every pin is natively in its hand, from one
// pass, under one lighting and one palette, for the price of one clip.
//
// WHAT THE AGENT DOES AND DOES NOT DO. It writes the shot lines, checks the
// sheet, and spends the render. It does NOT cut the frames back out: that
// happens in the browser, which already has the clip decoded on screen, and the
// author pins them from there with pin_beat_frame. So the honest end of a render
// is "the take is ready — open the Shot sheet tab to cut it", not a claim that
// the pins are placed.
import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";
import { MAX_DURATION_SECONDS, MAX_REFERENCE_IMAGES, MIN_DURATION_SECONDS, MIN_SHOT_SECONDS } from "../lib/shot-sheet.js";
import { MAX_END_IMAGES } from "../lib/series.js";

const seriesId = d(v.string(), "The Series whose pins are being drawn (from get_director).");

const SHEET_RULES =
  `A sheet is ${MIN_DURATION_SECONDS}–${MAX_DURATION_SECONDS} whole seconds long and each shot needs ` +
  `${MIN_SHOT_SECONDS}s to settle on a drawing, so the number of frames a sheet can hold is bounded by its ` +
  `length; at most ${MAX_REFERENCE_IMAGES} reference images ride along. More frames than one clip holds (or more than ` +
  `${MAX_END_IMAGES} pins) are NOT refused: they are drawn as a RUN of several clips in running order, each its own ` +
  `sheet with its own references and grab times.`;

export const getShotSheet = (api: Api) =>
  defineTool({
    name: "get_shot_sheet",
    description:
      "Every frame this Series' cue sheet needs drawn: the opening frame and one slot per pinned beat, each with the second it belongs to, the shot line the cue sheet's own prompt suggests for it, whether it is already drawn, and whether it is REFUSED (a slot that cannot legally be pinned — too early in a reel, or too close to the pin before it). Also the standing house clause and every take rendered so far. Read it before rendering: the slots are the choice, and a sheet that draws a refused slot has spent a render on a frame that cannot be used. " +
      SHEET_RULES,
    input: v.object({ seriesId }),
    async run({ data: input, signal }) {
      return { output: await api.get(`/api/shotsheet/${encodeURIComponent(String(input.seriesId))}`, signal) };
    },
  });

export const previewShotSheet = (api: Api) =>
  defineTool({
    name: "preview_shot_sheet",
    description:
      "Rehearse a shot sheet without paying for it: the assembled prompt exactly as the video model will receive it, which endpoint it goes to, the grab times each frame will be cut at, and every reason it would be refused. Free. When the frames need more than one clip, `parts` lists every clip's prompt, endpoint and grab times. Use it whenever you have reworded a shot line or changed which slots are drawn — the prompt is ASSEMBLED from the same list of shots the grab times come from, so reading it back is how you confirm the model is being asked for the frames you think it is. A sheet with sixteen shots in the prompt and seventeen grabs taken out of it is a film whose every pin is one beat wrong, and nothing about that looks like a bug.",
    input: v.object({
      seriesId,
      slots: d(
        v.optional(v.array(v.number())),
        "Which offsets to draw. Omit for every slot the cue sheet offers that is not refused.",
      ),
      duration: d(
        v.optional(v.pipe(v.number(), v.integer())),
        `How long the clip is, in whole seconds (${MIN_DURATION_SECONDS}–${MAX_DURATION_SECONDS}). This is the one number that trades how many frames fit against how long each is held.`,
      ),
    }),
    async run({ data: input, signal }) {
      const { seriesId: id, ...body } = input;
      return { output: await api.post(`/api/shotsheet/${encodeURIComponent(String(id))}/preview`, body, signal) };
    },
  });

export const renderShotSheet = (api: Api) =>
  defineTool({
    name: "render_shot_sheet",
    description:
      "Spend a render: draw the chosen frames as one clip, with the Series' model sheets handed over as references and named in the prompt. Costs real money, so preview_shot_sheet first and show the author the prompt. Returns immediately with `takes` (one per clip of the run — usually one, several when the frames don't fit one clip), each `running`; pass each take's `takeId` back to poll, and keep polling every one — the poll is what finalizes the take, so a render nobody asks about never lands. When it is done the clip is kept in the project and filed on the Series as a style model sheet carrying the whole prompt, so the next sheet can be asked for with this one in front of it. THE FRAMES ARE NOT PINNED BY THIS. Cutting them out happens in the browser — finish by telling the author the take is ready and to open the Shot sheet tab, or by pinning frames they have already cut with pin_beat_frame.",
    input: v.object({
      seriesId,
      takeId: d(
        v.optional(v.string()),
        "Instead of rendering: poll the take with this id and report where it has got to.",
      ),
      slots: d(v.optional(v.array(v.number())), "Which offsets to draw. Omit for every slot that is not refused."),
      duration: d(v.optional(v.pipe(v.number(), v.integer())), `The clip's length in whole seconds (${MIN_DURATION_SECONDS}–${MAX_DURATION_SECONDS}).`),
      seed: d(v.optional(v.pipe(v.number(), v.integer())), "Fix the seed to re-render the same sheet with one shot reworded."),
    }),
    async run({ data: input, signal }) {
      if (input.takeId) {
        return { output: await api.get(`/api/shotsheet/take/${encodeURIComponent(String(input.takeId))}`, signal) };
      }
      const { seriesId: id, takeId: _unused, ...body } = input;
      return { output: await api.post(`/api/shotsheet/${encodeURIComponent(String(id))}/render`, body, signal) };
    },
  });
