// The Musicalized tools — one continuous cue written under a kept sitting.
//
// THE ONE RULE THAT MAKES OR BREAKS A SCORE HERE. The plan is measured from the
// FILM, never from the cue sheet. The Director's chunks run long, so a plan
// built from `directions[]` is early by two to seven seconds — and that is not a
// rounding error, it is the score arriving before the cut it was written for,
// every time, getting worse as the piece goes on. The browser measures the
// finished file and hands the length here. If you find yourself deriving chunk
// boundaries from beat offsets, stop: you are writing a score for a film that
// was never made.
//
// What the agent does: writes the plan — the sections, what arrives, what
// leaves, how hard the model holds to each — and spends the render; then
// `score_sitting` has the Worker measure the film, duck the cue under the
// dialogue it actually found, and write the new file by COPYING the picture's
// packets rather than re-encoding them (ffmpeg in a sandbox — the same mix the
// Auto Film job's Score stage runs; the Musicalized tab does it in the browser).
import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";
import { ADHERENCE, CHUNK_MAX_MS, CHUNK_MIN_MS, MAX_CHUNKS, USD_PER_MINUTE } from "../lib/music-plan.js";

const chunk = v.object({
  text: d(
    v.string(),
    "The section's name in square brackets and nothing else — \"[Cold open]\", \"[The bay, quiet]\", \"[It turns]\". Named for what that stretch of the PICTURE is, because the picture is what it has to turn with. This is a label, not lyrics.",
  ),
  duration_ms: d(
    v.pipe(v.number(), v.integer(), v.minValue(CHUNK_MIN_MS), v.maxValue(CHUNK_MAX_MS)),
    `How long this chunk runs, in milliseconds (${CHUNK_MIN_MS}–${CHUNK_MAX_MS}). The chunks must add up to the film's MEASURED length — audio is never stretched or trimmed to fit afterwards, so a plan that is short is fixed in the plan.`,
  ),
  positive_styles: d(
    v.array(v.string()),
    "What ARRIVES here — instruments, texture, motion. At least one. The first chunk's styles also set the genre for the whole piece, so the Series' standing music brief (`musicStyle` from get_musicalized) goes in it as tags.",
  ),
  negative_styles: d(
    v.optional(v.array(v.string())),
    "What LEAVES here, or must not appear. As load-bearing as the positives: a cue that never drops anything never turns.",
  ),
  context_adherence: d(
    v.optional(v.picklist(ADHERENCE)),
    "How hard the model holds this chunk to what came before it: `high` keeps one continuous piece (the default for a score), `low` lets the chunk break away — a hard turn in the picture.",
  ),
});

const plan = v.object({
  chunks: d(v.array(chunk), "The cue, in order, from the first frame of the film to the last."),
  seed: d(
    v.optional(v.pipe(v.number(), v.integer())),
    "Set once a take is good enough to iterate on — reuse the seed from the Series' earlier cue (get_musicalized `series[id].cues[].prompt`) so \"the same but quieter\" is a small change rather than a new piece.",
  ),
});

export const getMusicalized = (api: Api) =>
  defineTool({
    name: "get_musicalized",
    description:
      "Every kept sitting that can be scored: which Series it is of, how long it ran, whether it already has a scored version; and per Series (`series[id]`) the standing music brief (`musicStyle`) and every cue already rendered for it (`cues[]`, each with the plan it was made from, verbatim, as its `prompt` — start the next take from it). The brief is changed with update_series `prompts.musicStyle` (send the whole `prompts` object back). Read it first — scoring is done to a FILM, and which film is the whole question. An empty music brief is a real answer rather than a missing one: a piece can be carried entirely by its sound design, and offering to score one that was meant to be dry is a way of not listening.",
    input: v.object({}),
    async run({ signal }) {
      return { output: await api.get("/api/musicalized", signal) };
    },
  });

export const planScore = (api: Api) =>
  defineTool({
    name: "plan_score",
    description:
      "Check a composition plan before spending anything: whether the chunks are legal, whether they add up to the film's measured length, and what the render will cost in dollars. Free. Write the plan in chunks that turn where the PICTURE turns — a chunk per movement of the film, not per beat of the cue sheet — and take `filmMs` from the measured sitting rather than from the cue sheet, which runs short. Show the author the cost before you render: it is the number that decides whether a plan is worth another pass. " +
      `Up to ${MAX_CHUNKS} chunks; roughly $${USD_PER_MINUTE} a minute of finished cue.`,
    input: v.object({
      plan: d(plan, "The composition plan."),
      filmMs: d(
        v.optional(v.pipe(v.number(), v.integer())),
        "The film's MEASURED length in milliseconds, from the sitting (get_musicalized). Pass it — without it the chunks are only checked against each other, and a plan that is internally consistent and thirty seconds short is the exact failure this checks for.",
      ),
    }),
    async run({ data: input, signal }) {
      return { output: await api.post("/api/musicalized/plan/check", input, signal) };
    },
  });

export const renderCue = (api: Api) =>
  defineTool({
    name: "render_cue",
    description:
      "Spend the render: one continuous cue, as long as the film, from this plan. Costs real money — run plan_score first and tell the author the figure. Returns a `requestId`; pass it back to poll. When it lands, the mp3 is kept in the project and filed on the Series with the plan verbatim as its prompt, so \"the same but quieter\" is a small edit rather than a new piece. THE CUE IS NOT THE SCORED FILM. Laying it under the picture — ducked beneath the dialogue, with the picture's packets copied rather than re-encoded — is score_sitting, with the `url` this returns when it reports `done`. (The Musicalized tab can also mix it by hand in the browser.)",
    input: v.object({
      seriesId: d(v.string(), "The Series this cue belongs to (from get_musicalized). It is what the finished piece is filed on."),
      requestId: d(v.optional(v.string()), "Instead of rendering: poll this request and report where it has got to."),
      plan: d(
        v.optional(plan),
        "The composition plan to render. Required unless polling.",
      ),
      filmMs: d(v.optional(v.pipe(v.number(), v.integer())), "The film's measured length in milliseconds, checked against the plan before a cent is spent."),
    }),
    async run({ data: input, signal }) {
      if (input.requestId) {
        const query = `?seriesId=${encodeURIComponent(String(input.seriesId))}`;
        return {
          output: await api.get(`/api/musicalized/cue/${encodeURIComponent(String(input.requestId))}${query}`, signal),
        };
      }
      const { requestId: _unused, ...body } = input;
      return { output: await api.post("/api/musicalized/cue", body, signal) };
    },
  });

export const scoreSitting = (api: Api) =>
  defineTool({
    name: "score_sitting",
    description:
      "Lay a finished cue under a kept sitting and file the scored film beside it — the last step of scoring, done on the server. The Worker measures the film in a sandbox, ducks the cue under the loud windows it measured off THIS take, and writes an mp4 with the picture's packets COPIED (never re-encoded), the film's own audio untouched and the cue faded in beneath it. The sitting itself is kept as it was. Run it after render_cue reports `done`, passing that poll's `url`. Takes a minute or two. No fal spend — the cue is already paid for.",
    input: v.object({
      sittingId: d(v.string(), "The kept sitting to score (get_musicalized `sittings[].id`)."),
      cueUrl: d(v.string(), "The finished cue's url, `/director-media/cue_….mp3` — the `url` render_cue returned when it reported `done`."),
      seriesId: d(v.optional(v.string()), "The sitting's Series; defaults to the sitting's own."),
      musicStyle: d(v.optional(v.string()), "The brief it was scored by — saved as the Series' standing `musicStyle`."),
      plan: d(v.optional(v.string()), "The composition plan the cue was rendered from, as JSON — kept on the sitting so the version can be argued with later."),
      silences: d(
        v.optional(v.array(v.object({ from: v.number(), to: v.number() }))),
        "The plan's SILENCE chunks, in seconds on the film's clock ({ from, to } = where each silence chunk starts and ends). The bed is faded out to nothing over each (1.5 s ramps) — ElevenLabs cannot render true silence, so the mix makes it.",
      ),
    }),
    async run({ data: input, signal }) {
      return { output: await api.post("/api/musicalized/scored", input, signal) };
    },
  });
