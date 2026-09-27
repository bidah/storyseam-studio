// The Director tools — writing a cue sheet, and everything that hangs off one.
//
// Grouped in one file rather than split nine ways because they are a single
// subsystem that arrived together and are read together: what a Series is, and
// the eight things you can do to one. The tool names are still the flat,
// one-name-one-capability names every other tool uses, and `tools/index.ts`
// imports them by name.
//
// THE THING TO KNOW BEFORE USING ANY OF THESE. The Director endpoint does not
// refuse a bad beat — it refuses the WHOLE SESSION, at `configure`, after the
// sheet was saved and after the frames were drawn. So every write here comes
// back with an `issues` map, and an empty one is the only signal that a sitting
// is worth paying for. Read it. A tool call that "succeeded" with issues on it
// has saved a cue sheet that cannot be played.
import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import { consumeApproval, gateAction } from "../lib/approval.js";
import type { Api } from "../lib/api.js";
import {
  MAX_DIRECTIONS,
  MAX_END_IMAGES,
  MIN_END_IMAGE_GAP_SECONDS,
  MIN_OPENING_END_IMAGE_SECONDS,
} from "../lib/series.js";

/** The ceilings, written into the descriptions from the one place they live. */
const CEILINGS =
  `Per REEL, not per Series: at most ${MAX_DIRECTIONS} beats and ${MAX_END_IMAGES} pinned frames; ` +
  `pinned frames at least ${MIN_END_IMAGE_GAP_SECONDS}s apart; the first pin of a reel no earlier ` +
  `than ${MIN_OPENING_END_IMAGE_SECONDS}s in, because the opening chunk is longer than the rest.`;

const seriesId = d(
  v.string(),
  "The Series id (from get_director). Never invent one.",
);

/** A beat, as the model writes one. */
const beat = v.object({
  offset: d(
    v.pipe(v.number(), v.integer(), v.minValue(0)),
    "Whole seconds from the film's FIRST GENERATED FRAME — the video's own clock, not the wall clock. This is the beat's identity: writing the same offset twice edits one beat, it does not add two.",
  ),
  prompt: d(
    v.optional(v.union([v.string(), v.record(v.string(), v.string())])),
    "What happens from this second until the next beat that carries a prompt. Either one string, or SECTIONS keyed by purpose — `range` (the window this beat covers), `style` (how it is shot), `scene` (what is in frame), `score` (what the music does). Sections are strongly preferred: the Series' `prompts.sections` list decides which are actually sent, so a whole layer can be dropped from the piece later by editing one list instead of forty-eight beats.",
  ),
  endImageUrl: d(
    v.optional(v.nullable(v.string())),
    "The EXACT final frame of the chunk that ENDS at this offset. Note what that means: the pin belongs to the beat the picture ends on, not the beat whose prompt describes it. A project media path (`/director-media/…`, `/visual-media/…`, `/storyboard-media/…`) or an absolute url.",
  ),
  audioUrl: d(
    v.optional(v.nullable(v.string())),
    "Audio the Director GENERATES AGAINST from this second — not a layer played over the film. Usually left alone: the Series' target audio rides the first beat on its own.",
  ),
});

export const getDirector = (api: Api) =>
  defineTool({
    name: "get_director",
    description:
      "Read the Director tab. With no `seriesId`: every Series on this project — title, status, how many beats and pinned frames each has, whether it has target audio — plus which one is open. With a `seriesId`: that Series in full, PLUS everything derived from it — the exact `configure` message a sitting would open with, how the cue sheet cuts into reels, how many seconds of film it amounts to, what to generate its art at, and `issues`: every reason the endpoint would refuse it. Read this before writing anything, and read it again after: a cue sheet that saved with issues on it is a cue sheet that cannot be played. " +
      CEILINGS,
    input: v.object({
      seriesId: d(v.optional(v.string()), "Read one Series in full instead of listing them all."),
      art: d(
        v.optional(v.boolean()),
        "Also fetch what to generate this Series' sheets and stills at (aspect ratio per art kind). Ask rather than remember — a Series that changed shape changed these.",
      ),
    }),
    async run({ data: input, signal }) {
      if (!input.seriesId) return { output: await api.get("/api/director", signal) };
      const id = encodeURIComponent(String(input.seriesId));
      const series = await api.get(`/api/director/series/${id}`, signal);
      if (!input.art) return { output: series };
      const art = await api.get(`/api/director/series/${id}/art`, signal);
      return { output: { ...(series as object), art } };
    },
  });

export const openSeries = (api: Api) =>
  defineTool({
    name: "open_series",
    description:
      "Make this the Series the Director, Stage, Shot sheet and Musicalized tabs are pointed at. Project-level, not per-user: two people on one project are working on the same film, and only one Director session can exist at a time anyway. Call it when the author asks to work on a different Series, so what you do next and what they are looking at are the same thing.",
    input: v.object({ seriesId }),
    async run({ data: input, signal }) {
      return { output: await api.req("/api/director/selected", "PUT", { seriesId: input.seriesId }, signal) };
    },
  });

export const createSeries = (api: Api) =>
  defineTool({
    name: "create_series",
    description:
      "Start a new Director Series: a title, the opening prompt, and the shape it is written for. The opening prompt is the piece's standing brief — the style, the film stock, the identity locks — and it governs every beat under it, so write it as the thing that is true for the whole film rather than as the first shot. The Series starts as a draft with no cue sheet; add beats with derive_cue_sheet or save_cue_sheet. It has no first frame yet either, and a Series cannot be published without one.",
    input: v.object({
      title: d(v.string(), "What this piece is called."),
      prompt: d(
        v.string(),
        "The opening prompt: style, look lock, identity locks — what is true for the WHOLE film. Not the first shot.",
      ),
      aspectRatio: d(
        v.optional(v.picklist(["16:9", "9:16"])),
        "The shape this Series is written for. Defaults to 16:9, which is what the Stage plays. This is not a crop setting: the reference image is the exact first frame, so the same Series at another shape is a different opening frame.",
      ),
      resolution: d(
        v.optional(v.picklist(["480p", "720p", "768p", "1080p"])),
        "What the film renders at. Defaults to 480p because a sitting bills per generated second and most of what an author does is LOOK at the thing while writing it.",
      ),
      imageUrl: d(
        v.optional(v.string()),
        "The exact first frame, if there is one already — a project media path or an absolute url.",
      ),
    }),
    async run({ data: input, signal }) {
      return { output: await api.post("/api/director/series", input, signal) };
    },
  });

export const updateSeries = (api: Api) =>
  defineTool({
    name: "update_series",
    description:
      "Change fields on a Series. A patch changes only what it NAMES — an omitted field is untouched, and clearing one takes an explicit null. Use it for the title, the opening prompt, the first frame, the shape, the resolution, the seed, publishing, and the two standing briefs (`prompts.musicStyle` for the score, `prompts.shotSheet` for the house clause every shot sheet is asked with). Publishing needs a first frame; the call comes back with `issues` if it would be refused.",
    input: v.object({
      seriesId,
      title: d(v.optional(v.string()), "Rename the piece."),
      prompt: d(v.optional(v.string()), "Rewrite the opening prompt — the brief that governs every beat."),
      imageUrl: d(v.optional(v.string()), "The exact first frame."),
      aspectRatio: d(v.optional(v.picklist(["16:9", "9:16"])), "The shape. Changing it changes what the first frame means."),
      resolution: d(v.optional(v.picklist(["480p", "720p", "768p", "1080p"])), "What the film renders at."),
      seed: d(v.optional(v.nullable(v.number())), "Fix the seed so two sittings start from the same place. The endpoint is still not deterministic — this narrows the drift, it does not remove it."),
      memory: d(v.optional(v.number()), "How many seconds of its own output the Director keeps in view. Higher holds a design longer and costs more."),
      status: d(v.optional(v.picklist(["draft", "published"])), "A Series is never deleted, it is unpublished."),
      reelChanges: d(
        v.optional(v.array(v.number())),
        "The offsets where the cue sheet is cut into REELS. Each entry must be the offset of a beat that exists. A cut costs exactly one frame — the beat that opens an appended reel gives up its pin, because no chunk ends at second zero — and it is what makes a sheet too long for one script legal in two.",
      ),
      prompts: d(
        v.optional(
          v.object({
            musicStyle: d(v.optional(v.nullable(v.string())), "The standing music brief. Empty is a real answer: a piece can be carried entirely by its sound design."),
            shotSheet: d(v.optional(v.nullable(v.string())), "The house clause every shot sheet is asked for with. `{count}`, `{span}` and `{shots}` are substituted."),
            sections: d(
              v.optional(v.nullable(v.array(v.string()))),
              "Which sections of a sectioned beat prompt are SENT, in this order. Null sends every section. This is the list that drops a whole layer from the film without touching a beat.",
            ),
          }),
        ),
        "The standing briefs — how the NEXT render is made from a cue sheet that does not itself change.",
      ),
    }),
    async run({ data: input, signal }) {
      const { seriesId: id, ...patch } = input;
      return { output: await api.req(`/api/director/series/${encodeURIComponent(String(id))}`, "PUT", patch, signal) };
    },
  });

const SAVE_CUE_OP = "save_cue_sheet";

export const saveCueSheet = (api: Api) =>
  defineTool({
    name: "save_cue_sheet",
    description:
      "Write beats onto a Series' cue sheet. THREE MODES. `merge` (prefer this) matches by offset and edits those beats, leaving every other beat alone — it is how you reword one beat without resending forty. `replace` overwrites the whole sheet, which is destructive and only right when you are writing a sheet from scratch. `remove` drops the beats at the offsets you name. Offsets are the beat's identity, so they are how every mode addresses beats. The whole sheet is re-validated on every write and comes back with `issues`; a sheet that saved with issues on it cannot be played. GATED IN ONE CASE ONLY: a \"replace\" that would leave FEWER beats than the sheet already has needs the author's go-ahead — that call returns `approved:false` with an `approvalToken` and performs nothing, and you must draw the confirm card (see the **destructive-approval** skill) before calling again with that token. " +
      CEILINGS,
    input: v.object({
      seriesId,
      mode: d(
        v.optional(v.picklist(["merge", "replace", "remove"])),
        "merge (edit beats by offset, leave the rest) · replace (overwrite the whole sheet) · remove (drop the beats at these offsets). Defaults to replace, so pass merge explicitly when you mean to edit.",
      ),
      beats: d(
        v.optional(v.array(beat)),
        "The beats to write, or — in `remove` mode — the offsets to drop. Optional ONLY on a confirming call that carries an approval_token.",
      ),
      approval_token: d(
        v.optional(v.string()),
        "ONLY for the confirming second call, and ONLY after the author has actually said yes: the `approvalToken` a previous gated call returned. Never invent one, never reuse a spent one, never send one on a first call. When you pass it, OMIT `beats` — what you already sent is replayed from the approval, so the author gets exactly what they approved.",
      ),
    }),
    async run({ data: input, signal }) {
      const { seriesId: id, mode, beats, approval_token } = input;
      const seriesPath = `/api/director/series/${encodeURIComponent(String(id))}/cue`;

      // Phase two: the author confirmed. Burn the token and replay the beats
      // THEY approved, not what the model re-typed — which is how a card
      // reading "24 → 9" could otherwise execute as "24 → 0".
      if (approval_token) {
        const params = await consumeApproval(api, String(approval_token), SAVE_CUE_OP, signal);
        return { output: await api.post(seriesPath, params, signal) };
      }

      if (!Array.isArray(beats)) {
        throw new Error(
          "save_cue_sheet needs `beats` unless you are passing an approval_token. Send the beats you want written.",
        );
      }
      const writeMode = mode === "merge" ? "merge" : mode === "remove" ? "remove" : "replace";
      const body = { mode: writeMode, beats };

      // Exactly ONE shape of this call destroys work: a "replace" that lands a
      // SHORTER sheet over an existing one. Everything else is the normal way a
      // cue sheet gets written — a first sheet, a merge, a same-size rewrite —
      // and gating those would put a card in front of every step of authoring,
      // which trains the author to tap through without reading. A gate that
      // fires constantly stops being a gate.
      //
      // Shrinkage is the fingerprint of the real accident: the model rewrites
      // the sheet from a partial view and silently drops the beats it did not
      // know about — along with the pinned frames those beats carried.
      if (writeMode === "replace") {
        const current = await api.get(`/api/director/series/${encodeURIComponent(String(id))}`, signal);
        const directions = (current as { series?: { directions?: unknown[] } })?.series?.directions;
        const had = Array.isArray(directions) ? directions.length : 0;
        if (had > 0 && beats.length < had) {
          return {
            output: await gateAction(
              api,
              {
                op: SAVE_CUE_OP,
                summary: `Replace the whole cue sheet: ${had} beats become ${beats.length}, so ${had - beats.length} are deleted along with any frames pinned to them.`,
                params: body,
                facts: {
                  "Beats now": String(had),
                  "Beats after": String(beats.length),
                  "Beats deleted": String(had - beats.length),
                },
              },
              signal,
            ),
          };
        }
      }

      return { output: await api.post(seriesPath, body, signal) };
    },
  });

export const deriveCueSheet = (api: Api) =>
  defineTool({
    name: "derive_cue_sheet",
    description:
      "Turn this project's shot list into a cue sheet, in one call. Each shot becomes a beat: its offset is the accumulated duration of every shot before it, and its prompt is written as SECTIONS — `range` (the window it covers, which is what stops one beat inventing three shots), `style` (the camera language), `scene` (the location, action and dialogue), `score` (the audio-sync note). Where a shot has a storyboard still, that still is PINNED as the exact frame the chunk ends on. This REPLACES the existing cue sheet, so read the Series first if it has beats worth keeping. Pins that cannot legally be placed come back in `skippedPins` with the reason — they are reported rather than dropped quietly, because the fix is the author's: move the beat, or let the shot go unpinned.",
    input: v.object({
      seriesId,
      pin: d(
        v.optional(v.boolean()),
        "Pin each shot's storyboard still as its end frame. Default true. Pass false to derive the timing and the prompts alone — which is what you want if the pins are going to be drawn as a shot sheet instead.",
      ),
    }),
    async run({ data: input, signal }) {
      const { seriesId: id, ...body } = input;
      return { output: await api.post(`/api/director/series/${encodeURIComponent(String(id))}/derive`, body, signal) };
    },
  });

export const attachModelSheet = (api: Api) =>
  defineTool({
    name: "attach_model_sheet",
    description:
      "Put a reference sheet on a Series, or replace one by name. A model sheet is a picture the whole film is drawn against — a character (one figure held still across the piece), a location (one place, the same every time the film returns to it), or a style (the palette, the film stock, the grain). It is NEVER sent to the Director: `configure` rejects fields it does not know. It is carried so the next frame can be made in the same hand as the last, and it is what the shot sheet hands the video model as references. The picture comes from somewhere this project already has one — the Images tab, the Library, a character sheet on the Bible. Generate it there; name it here.",
    input: v.object({
      seriesId,
      sheet: d(
        v.optional(
          v.object({
            kind: d(v.picklist(["character", "location", "style"]), "What sort of sheet this is. The shot sheet numbers style first, then characters, then locations."),
            name: d(v.string(), "What it is a sheet OF — \"Kai's mecha\", \"the 80s cel look\". Beats refer to sheets by this, and replacing by name is what keeps those references pointing at the same thing."),
            imageUrl: d(v.optional(v.string()), "The picture — a project media path or an absolute url."),
            prompt: d(v.optional(v.string()), "The prompt that made it, verbatim. A sheet kept without its prompt is a look that cannot be extended."),
            model: d(v.optional(v.string()), "The image model, as its maker writes it."),
            refs: d(v.optional(v.array(v.string())), "The pictures this one was made FROM, if any. A sheet made by feeding a model two other pictures cannot be remade from the prompt alone."),
          }),
        ),
        "The sheet to add, or to replace the one with this name.",
      ),
      remove: d(v.optional(v.string()), "Instead: the name of the sheet to take off this Series."),
    }),
    async run({ data: input, signal }) {
      const { seriesId: id, ...body } = input;
      return { output: await api.post(`/api/director/series/${encodeURIComponent(String(id))}/sheets`, body, signal) };
    },
  });

export const setTargetAudio = (api: Api) =>
  defineTool({
    name: "set_target_audio",
    description:
      "Point a Series at the audio it is SHOT AGAINST. This is not a soundtrack laid over the film: the endpoint shapes every chunk it generates by the next window of this recording, so changing it changes what the Director draws, and a refused one is not a quieter sitting but a different one. The audio comes from Sound Studio or the Radio pass — generate or cast it there, pass its `/sound-media/…` path here. The version being replaced is ARCHIVED, never overwritten: a render whose prompt was lost cannot be made again in the same hand, so swapping back is always possible.",
    input: v.object({
      seriesId,
      audioUrl: d(v.optional(v.string()), "The take's path, e.g. `/sound-media/take_3.mp3` (from list_sounds or get_radio)."),
      prompt: d(v.optional(v.string()), "The prompt that produced this audio, verbatim. Required when setting one — it is the whole point of the record."),
      model: d(v.optional(v.string()), "The audio model, as its maker writes it."),
      seconds: d(v.optional(v.number()), "How long the finished audio actually is."),
      clear: d(v.optional(v.boolean()), "Instead: take the target audio off this Series. The one it had is archived, not lost."),
    }),
    async run({ data: input, signal }) {
      const { seriesId: id, ...body } = input;
      return { output: await api.post(`/api/director/series/${encodeURIComponent(String(id))}/audio`, body, signal) };
    },
  });

export const pinBeatFrame = (api: Api) =>
  defineTool({
    name: "pin_beat_frame",
    description:
      "Pin the exact frame a beat lands on. THE TRAP THIS TOOL EXISTS AROUND: a pin belongs to the beat whose chunk ENDS at that second, which is not the beat whose prompt describes the picture. Pin by the offset the picture is the END of. The picture comes from wherever this project made one — a shot sheet take, a still from the Images tab, a storyboard still. The prompt and references that made it are kept beside the pin and never sent to the Director, so the frame can be redrawn in the same hand later. The whole sheet is re-validated: a pin too close to the one before it, or inside a reel's opening chunk, comes back as an issue instead of being saved.",
    input: v.object({
      seriesId,
      offset: d(v.pipe(v.number(), v.integer()), "The second the pinned picture is the FINAL FRAME OF. A beat must already exist there."),
      imageUrl: d(v.optional(v.string()), "The frame — a project media path or an absolute url."),
      prompt: d(v.optional(v.string()), "What made this frame, verbatim."),
      model: d(v.optional(v.string()), "The model that drew it."),
      refs: d(v.optional(v.array(v.string())), "The sheets it was drawn from."),
      clear: d(v.optional(v.boolean()), "Instead: take the pin off this beat. The beat keeps its prompt and its audio."),
    }),
    async run({ data: input, signal }) {
      const { seriesId: id, ...body } = input;
      return { output: await api.post(`/api/director/series/${encodeURIComponent(String(id))}/pin`, body, signal) };
    },
  });
