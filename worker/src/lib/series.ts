// VENDORED from src/lib/series.ts — DO NOT EDIT HERE.
// Edit the canonical file, then run `npm run series:sync`
// (scripts/sync-series.mjs).

import { z } from "zod";

// A SERIES is a saved Director recipe: what the author wrote in the Director
// tab, and what the Stage plays. A RECIPE is the `configure` message derived
// from one — a pure function, never stored, because a stored copy is a second
// truth that goes stale the moment the Series is edited.
//
// This module is the only place the wire format lives. It is the canonical copy,
// vendored by `npm run series:sync` into the two packages that cannot reach
// across the repo root:
//
//   · worker/src/lib/series.ts      — validates PUT /api/director/series/:id
//                                     and derives the recipe the Stage asks for
//   · flue-agent/src/lib/series.ts  — the agent's cue-sheet tools check the same
//                                     ceilings before they spend a sitting
//
// Edit THIS file, then run `npm run series:sync`. `npm run guards` fails when a
// copy drifts. Three surfaces therefore agree about what a valid Series is by
// construction rather than by review.
//
// Ported from the story-smash-director repo, where it was written against the
// endpoint's refusals one expensive sitting at a time. Every ceiling here is a
// number the endpoint enforces, with the reasoning kept beside it — a Series
// that breaks one is refused WHOLE, after the sheet was saved and after the
// frames were drawn, which is the most expensive possible way to find out.
//
// Orientation IS a field. A Series declares which shape it was written for,
// because `imageUrl` is the exact first frame: a 9:16 reference image opened at
// 16:9 is not the same Series in a wider window — it is a different opening
// frame, so it is a different Series.

export const RESOLUTIONS = ['480p', '768p', '1080p'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

/**
 * The two shapes a Series can be written for. The endpoint also offers `1:1`;
 * nothing here has a surface for it, so it is not offered.
 */
export const ASPECT_RATIOS = ['9:16', '16:9'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

/**
 * Vertical, because that is the shape this came from. In Shot Studio the Stage
 * is a browser and the useful default is landscape, so Director setup offers
 * 16:9 first — but the SCHEMA default stays 9:16, because a Series written
 * elsewhere and imported here must not silently change its opening frame.
 */
export const DEFAULT_ASPECT_RATIO: AspectRatio = '9:16';

export const STATUSES = ['draft', 'published'] as const;
export type SeriesStatus = (typeof STATUSES)[number];

/**
 * The media prefixes this project serves its own bytes under.
 *
 * Kept in step with the routes mounted in `worker/src/index.js`; a prefix that
 * is not mounted is a path that 404s, so adding one here without adding the
 * route is how a beat silently pins nothing.
 */
export const MEDIA_PREFIXES = [
  'sound-media', 'visual-media', 'director-media', 'storyboard-media',
  'multishot-media', 'moodboard-media', 'gen', 'media', 'stills', 'final',
  'refs', 'asset',
] as const;

const MEDIA_PATH = new RegExp(`^/(?:${MEDIA_PREFIXES.join('|')})/.+`);

/**
 * A picture or a sound this Series points at: an absolute url, OR one of this
 * project's own media paths.
 *
 * The repo this came from took absolute urls only, because its bytes sat in a
 * public bucket and its rows were written by hand. Here the author PICKS from
 * what the project already made — a Library asset, a generation, a Sound Studio
 * take — and those arrive as `/sound-media/take.mp3`. Storing the absolute form
 * instead would bake this week's public hostname into every row, and a project
 * cloned or a Worker renamed would come back with a cue sheet full of pins
 * pointing at nothing.
 *
 * So rows stay project-relative and portable, and `absolutize()` in
 * `worker/src/lib/director.js` resolves them on the way OUT — because the
 * Director is on fal's network and a relative path there is a 404 nobody sees
 * until the frame comes back wrong.
 */
export const mediaRef = z
  .string()
  .trim()
  .refine(
    (value) => /^https?:\/\//i.test(value) || MEDIA_PATH.test(value),
    'must be a url, or a path to this project\u2019s own media',
  );

/** The endpoint's own ceiling. A longer prompt is refused before it costs anything. */
export const MAX_PROMPT_CHARS = 50_000;
/** The endpoint's `max_audio_source_seconds`. Director setup checks it before uploading. */
export const MAX_AUDIO_SECONDS = 600;

/**
 * 480p, not 768p.
 *
 * A session bills per generated second with a sixty-second minimum, so the
 * cheapest useful default is the one that costs least to LOOK at while a Series
 * is being written — and most of what an author does is look. An author who
 * wants the stream to be handsome sets it per Series; nothing stops them.
 */
export const DEFAULT_RESOLUTION: Resolution = '480p';
export const DEFAULT_MEMORY = 12;

/**
 * Each field's rule, with NO defaults attached.
 *
 * Defaults belong to a create — "the author did not choose a resolution, so it
 * is 768p" — and are actively wrong for a patch, where a missing key means "not
 * mentioned". Declared once here and given defaults only in `seriesFields`
 * below, because a `.partial()` of a schema carrying defaults still applies
 * them: a PUT of `{ status: 'published' }` would have come back out of zod as a
 * patch that also reset the resolution, the memory, the running order, and the
 * reference image.
 */

/**
 * A BEAT of the script: one direction pinned to a second of the video's own
 * clock.
 *
 * The whole cue sheet rides inside `configure` (`script`), so the Director
 * plans the arc before it generates a frame — it is not a message we send while
 * the stream runs. `offset` is "whole seconds from the start of the first video
 * generated under this script", which is the video's clock and not the wall
 * clock: a slow negotiation does not shift a beat, and a beat cannot land late
 * because a timer fired late.
 *
 * A beat needs at least one of the three things a beat can carry. `prompt`
 * alone is the common one — it directs from its offset until the next text
 * beat. `endImageUrl` alone is how a piece pins its last frame, which is why
 * the prompt is optional rather than required.
 *
 * The endpoint's own wording for all of this arrives as `session_info`, its
 * first message of a sitting — ask the system rather than trusting this copy.
 */
/**
 * A section key: what one part of a beat's prompt is FOR — `style`, `scene`,
 * `score`, `range`. Lower-case, so the include list and the beats cannot
 * disagree over case, and short, because it is typed into a list by hand.
 */
export const SECTION_KEY = /^[a-z][a-z0-9-]{0,31}$/;
export const sectionKey = z
  .string()
  .regex(SECTION_KEY, 'a section key is lower-case letters, digits and dashes');

/**
 * A beat's prompt as SECTIONS: one text per key, in authored order.
 *
 * A beat used to be one string, and it still may be. But the string was
 * already several things run together — the time range, the style clause,
 * the shot, and lately a score cue — and taking one of them out of forty-eight
 * beats meant editing forty-eight strings. As sections, each part is written
 * once per beat and the Series' `prompts.sections` says which of them are
 * SENT (see `beatText`): dropping the score from a whole piece is a change to
 * one list, and the beats keep the score for the next screening.
 */
export const promptSections = z.record(sectionKey, z.string().trim().max(MAX_PROMPT_CHARS));
export type PromptSections = z.infer<typeof promptSections>;

/** What a beat's `prompt` may hold: the old string, or sections. */
export const beatPrompt = z.union([
  z.string().trim().min(1).max(MAX_PROMPT_CHARS),
  promptSections,
]);
export type BeatPrompt = z.infer<typeof beatPrompt>;

/** Sections joined into the one paragraph block the Director is sent. */
export const SECTION_JOIN = '\n\n';

/**
 * The keys of a sectioned prompt in the order they are sent.
 *
 * The include list's order when there is one, else the object's. The list is
 * what decides, because it is the one place an order is WRITTEN DOWN rather
 * than inherited. The object's own key order survives this doc store (D1 keeps
 * the JSON text we hand it), but it did not survive the jsonb column this came
 * from — which sorted keys by length then bytes, so `style` landed after
 * `score` whatever was typed. Relying on it is relying on a property of
 * whatever is storing the row this week.
 */
export function sectionOrder(
  prompt: PromptSections,
  include?: readonly string[] | null,
): string[] {
  if (!include) return Object.keys(prompt);
  return include.filter((key) => key in prompt);
}

/**
 * The text a beat's prompt amounts to.
 *
 * A string is itself. Sections are the ones named in `include`, in the list's
 * order (see `sectionOrder`); `null` or absent sends them all. Empty sections
 * are dropped rather than sent as blank paragraphs. A beat whose every section
 * is excluded comes out as '' — the Director then sees a beat with no prompt,
 * which is the honest result of asking for that.
 */
export function beatText(
  prompt: BeatPrompt | null | undefined,
  include?: readonly string[] | null,
): string {
  if (!prompt) return '';
  if (typeof prompt === 'string') return prompt;
  return sectionOrder(prompt, include)
    .map((key) => prompt[key].trim())
    .filter(Boolean)
    .join(SECTION_JOIN);
}

export const direction = z
  .object({
    /** Whole seconds from the first generated frame. Zero is the opening beat. */
    offset: z.number().int().min(0).max(86_400),
    prompt: beatPrompt.nullish(),
    /** The exact final frame of the chunk ending at this offset. */
    endImageUrl: mediaRef.nullish(),
    /**
     * What made that frame, kept beside it for the same reason a model sheet
     * keeps its prompt: a pin whose prompt was lost is a shot that cannot be
     * redrawn in the same hand. `endImageRefs` are the sheets it was drawn
     * from — urls this app can reach — and `endImageModel` is the image model
     * as its maker writes it. None of it goes to the Director (`script()`
     * sends the url alone; the endpoint forbids extra fields).
     */
    endImagePrompt: z.string().trim().max(MAX_PROMPT_CHARS).nullish(),
    endImageModel: z.string().trim().max(200).nullish(),
    endImageRefs: z.array(mediaRef).max(8).nullish(),
    /** Audio that starts playing exactly at this offset. */
    audioUrl: mediaRef.nullish(),
  })
  .refine(
    (beat) => Boolean(beatText(beat.prompt) || beat.endImageUrl || beat.audioUrl),
    { message: 'a beat needs a prompt, an end image or audio' },
  );

export type Direction = z.infer<typeof direction>;

/** The endpoint's own ceiling on `configure.script` (`script_max_beats`). */
export const MAX_DIRECTIONS = 64;

/**
 * How many of those beats may PIN A FRAME, and how many may carry audio.
 *
 * `script_max_end_images` and `script_max_audio_beats` from the endpoint's
 * `session_info`, and neither is the beat ceiling: a 64-beat script may pin
 * only 16 frames and place only 8 pieces of audio. A script that breaks either
 * is refused whole, at `configure`, with `invalid_message` — no chunk, no film,
 * and (until the error text was being read) no reason either. Mecha Launch
 * (extended wide) is where this was found: 33 pinned beats out of 34, every
 * sitting dead at nine seconds of wall clock and zero seconds of film.
 *
 * So it is checked here, next to the spacing rule, for the same reason: the
 * cue sheet is being typed, and the alternative is paying to be told.
 */
export const MAX_END_IMAGES = 16;
export const MAX_AUDIO_BEATS = 8;

/**
 * The three things a model sheet can be about.
 *
 * `character` is one figure held still across a piece — a person, a mecha, a
 * ship. `location` is one place, held the same every time the film returns to
 * it. `style` is what is neither: the palette, the film stock, the grain, the
 * lighting.
 *
 * A location is not a character with scenery in it, and not a style with walls.
 * A turnaround fixes a figure's proportions from four angles; a location sheet
 * fixes an architecture's layout and colour across the views a camera will find
 * it from. They are one shape and three sections because an author looks for
 * them separately and writes them the same way.
 */
export const SHEET_KINDS = ['character', 'location', 'style'] as const;
export type SheetKind = (typeof SHEET_KINDS)[number];

/** A sheet is a long prompt like any other, and gets the same ceiling. */
export const MAX_SHEET_CHARS = MAX_PROMPT_CHARS;
export const MAX_MODEL_SHEETS = 32;
/**
 * How many pictures a sheet may name as its own input.
 *
 * Small on purpose. These are the references a sheet was generated FROM — the
 * turnaround it matched, the frame whose light it borrowed — and a sheet
 * claiming twelve of them is a sheet whose provenance nobody is going to read.
 */
export const MAX_SHEET_REFS = 8;

/**
 * A MODEL SHEET: an image this Series uses, and the prompt that made it.
 *
 * Not sent anywhere. The Director takes `configure` and rejects properties it
 * does not know, and these are not for the Director in any case — they are
 * prompts for an IMAGE model, kept so the next frame can be made in the same
 * hand as the last one. A reference image whose prompt was lost is a look that
 * cannot be extended.
 *
 * `model` is free text on purpose. It names whatever made the picture — "GPT
 * Image 2.5 Flare", "Nano Banana Pro", a version nobody has shipped yet — and
 * an enum here would be a list this repo has to chase.
 */
export const modelSheet = z.object({
  kind: z.enum(SHEET_KINDS),
  /** What it is a sheet OF. "Kai's mecha", "the 80s cel look". */
  name: z.string().trim().min(1, 'a sheet needs a name').max(200),
  /** The prompt the image was generated from, verbatim. */
  prompt: z.string().trim().max(MAX_SHEET_CHARS).nullish(),
  /** What that prompt produced. */
  imageUrl: z.union([z.literal(''), mediaRef]).nullish(),
  /** The image model used, as its maker writes it. */
  model: z.string().trim().max(200).nullish(),
  /**
   * The pictures this one was made FROM, where it was made from any.
   *
   * The same argument as `prompt`, one step back: a sheet kept without the
   * prompt that made it is a look that cannot be extended, and a sheet made by
   * feeding a model two other pictures cannot be remade from the prompt alone
   * either. Optional because plenty of sheets are text-to-image and have none —
   * an empty list is the honest answer, not a missing one.
   *
   * Urls rather than records. They point at pictures that already exist
   * somewhere this app can reach; what a reference MEANT is in the prompt.
   */
  refs: z.array(mediaRef).max(MAX_SHEET_REFS).default([]),
});

export type ModelSheet = z.infer<typeof modelSheet>;

/**
 * Seed Audio's own ceiling on a prompt, and it counts BYTES.
 *
 * Documented as 2048. Measured: a 2047-byte prompt was refused with a bare 422
 * and a 1989-byte one rendered, so the last few bytes are not ours to use and
 * the number here is a limit to stay well under rather than to fill.
 *
 * Bytes, not characters: one em dash is three of them. A prompt that counts
 * 2040 characters can be 2100 bytes on the wire and come back 422 with nothing
 * to explain why, which is exactly how this was found.
 */
export const MAX_AUDIO_PROMPT_BYTES = 2048;

/**
 * Where the form starts warning — the largest prompt actually observed to
 * render, rather than advice about where to start trimming.
 *
 * It was 1800, taken from the skill this was written from, and that made the
 * form disagree with the measurement two lines up: Mecha Launch's own audio
 * version is 1964 bytes and was flagged as "close to the ceiling" while sitting
 * comfortably under the 1989 that is KNOWN to have worked. A warning that fires
 * on a prompt you have already rendered is a warning you learn to scroll past,
 * and then it is not there for the one that matters.
 *
 * So the line is the evidence: warn above 1989, because above 1989 we genuinely
 * do not know. That is one observation, not a distribution — if a prompt under
 * this ever comes back 422, this number is the thing that was wrong, and the
 * fix is to lower it to whatever failed rather than to go back to guessing.
 */
export const SAFE_AUDIO_PROMPT_BYTES = 1989;
/**
 * What the RECORD holds, which is not the same number: an audio version can be
 * more than one render joined — a track and a coda made separately and
 * crossfaded — and the record keeps every prompt that made it, or the version
 * cannot be made again. The per-render cap above is what the counter warns at.
 */
export const MAX_AUDIO_VERSION_PROMPT_BYTES = 8192;

/** What `MAX_AUDIO_PROMPT_BYTES` actually measures. */
export function promptBytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * The prompts of each render inside an audio version's prompt.
 *
 * A version made from several renders joined keeps every prompt, separated by
 * a line beginning `[JOINED`. The per-render ceiling applies to each part, not
 * to the record — so the counter measures the largest part.
 */
export function renderPrompts(text: string): string[] {
  return text
    .split(/\n(?=\[JOINED\b)/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Bytes of the largest single render's prompt inside an audio version. */
export function largestRenderPromptBytes(text: string): number {
  return Math.max(0, ...renderPrompts(text).map(promptBytes));
}

/**
 * A fingerprint of the cue sheet's TIMING — what an audio version has to match.
 *
 * An audio version is the piece heard instead of seen, and the thing that makes
 * the two the same piece is that the sound lands on the cuts. So the question
 * "does this render still fit this cue sheet" is a question about **offsets and
 * how many of them**, and about nothing else: reword a beat's prompt or re-pin
 * the frame it ends on and the sound still lands exactly where it did.
 *
 * Fingerprinting the whole of `directions` would be easier and would cry wolf
 * on every prompt edit — and a drift warning that fires when nothing drifted is
 * a warning people learn to click past, which is worse than not having one.
 *
 * Stable across key order and formatting because it is built from the offsets
 * alone, in order. Not a cryptographic hash: it is a change detector, and the
 * only thing that could "attack" it is a beat moved to the same second it was
 * already on, which is not a change.
 */
export function cueTimingFingerprint(directions: Pick<Direction, 'offset'>[]): string {
  const offsets = directions.map((beat) => beat.offset);
  // FNV-1a over the offsets — short, dependency-free, and enough for "did this
  // list of numbers change".
  let hash = 0x811c9dc5;
  for (const offset of offsets) {
    for (const ch of String(offset)) {
      hash ^= ch.charCodeAt(0);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hash ^= 0x2c; // a separator, so [1,23] and [12,3] differ
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${offsets.length}:${hash.toString(16).padStart(8, '0')}`;
}

/**
 * The cue sheet an audio version was rendered against.
 *
 * Recorded ON the version rather than derived, because the cue sheet moves and
 * the render does not: once a beat is added the Series can no longer tell you
 * what it looked like when the sound was made. Without this the drift is
 * invisible — which is exactly how a 179.2 s render ended up under a 34-beat
 * sheet whose last beat starts at 180 s.
 *
 * `null` on a version written before this existed. That is "not recorded", NOT
 * "in sync" — and the UI has to say so, because guessing in-sync is the failure
 * this record exists to prevent.
 */
export const cueTiming = z.object({
  /** `cueTimingFingerprint` of the cue sheet at the moment of the render. */
  fingerprint: z.string().trim().max(64),
  /** How many beats that was, kept human-readable for the UI. */
  beats: z.number().int().min(0).max(MAX_DIRECTIONS),
});

export type CueTiming = z.infer<typeof cueTiming>;

/** Does this version still match the cue sheet as it stands? */
export type CueMatch = 'match' | 'drifted' | 'unrecorded';

export function cueMatchOf(
  series: Pick<Series, 'directions'>,
  version: Pick<AudioVersion, 'cueTiming'> | null | undefined,
): CueMatch {
  if (!version?.cueTiming) return 'unrecorded';
  return version.cueTiming.fingerprint === cueTimingFingerprint(series.directions)
    ? 'match'
    : 'drifted';
}

/**
 * An AUDIO VERSION: the episode as sound alone, and the prompt that made it.
 *
 * The same script, the same timing, the same cast — voices, foley, room tone
 * and score rendered together as one mixed clip, so the piece can be LISTENED
 * to before anyone pays for a sitting. A Director Session bills from its first
 * second (ADR-0010) and is not deterministic; an audio version costs one render
 * and plays the same way every time, which makes it the cheap way to hear
 * whether a cue sheet has an arc.
 *
 * Not the soundtrack. `audioUrl` on the Series is a bed the Director is handed
 * and generates against; this is a finished mix OF the Series and goes nowhere
 * near `configure` — the same reason the model sheets do not, and the same
 * reason both keep their prompt: a render whose prompt was lost cannot be made
 * again in the same hand.
 *
 * `prompt` is required, and that is the whole point of the record. A clip in a
 * bucket with no prompt beside it is a take nobody can iterate on.
 *
 * WHERE ONE COMES FROM, HERE. The Director repo grew its own Audio Version
 * panel — render a mix, keep the past ones, select between them. Shot Studio
 * already has that surface twice over: Sound Studio keeps versioned takes with
 * a liked pick, and the Radio pass voices the dialogue. So Director setup does
 * NOT render audio; it POINTS at a sound this project already made, and
 * `audioUrl` holds that sound's absolute `/files/...` url. The archival
 * machinery below still runs, because swapping which sound a Series is shot
 * against is exactly the move `pastAudioVersions` was written for.
 */
export const audioVersion = z.object({
  /** The prompt the audio was generated from, verbatim. */
  prompt: z
    .string()
    .trim()
    .min(1, 'an audio version keeps the prompt that made it')
    .max(
      MAX_AUDIO_VERSION_PROMPT_BYTES,
      `an audio version keeps at most ${MAX_AUDIO_VERSION_PROMPT_BYTES} bytes of prompt`,
    ),
  /** What that prompt produced. Empty until the render is uploaded. */
  audioUrl: z.union([z.literal(''), mediaRef]).nullish(),
  /** The audio model used, as its maker writes it. */
  model: z.string().trim().max(200).nullish(),
  /** Seconds of finished audio — what the render actually came back as. */
  seconds: z.number().min(0).max(MAX_AUDIO_SECONDS).nullish(),
  /** When the render was made, ISO 8601. */
  renderedAt: z.string().trim().max(40).nullish(),
  /**
   * The cue sheet this render was made against. See `cueTiming`.
   *
   * Stamped by `stampCueTiming` on every write, so no caller has to remember —
   * a version whose stamp depended on the UI remembering would be missing on
   * exactly the renders made by a script.
   */
  cueTiming: cueTiming.nullish(),
});

export type AudioVersion = z.infer<typeof audioVersion>;

/** How many replaced renders a Series keeps. Past that, the oldest is let go. */
export const MAX_PAST_AUDIO_VERSIONS = 20;

/**
 * How long a STANDING prompt may be. Not `MAX_PROMPT_CHARS` — a standing prompt
 * is a style brief a person rereads and edits by hand, not a generated script.
 */
export const MAX_STANDING_PROMPT_CHARS = 4000;

/**
 * The prompts a Series KEEPS, as opposed to the ones it produced.
 *
 * `prompt`, `directions[].prompt` and `audioVersion.prompt` all record
 * something that was already made: send this text, get that file. These are the
 * other kind — a standing brief that says HOW the next thing should be made,
 * carried on the Series so every render of it sounds like the same show.
 *
 * `musicStyle` is the first and, today, the only one: the band, the key, the
 * tempo and the room for every music cue laid under this Series' audio version.
 * It is deliberately NOT stored per cue. Two cues in one episode scored by two
 * different briefs is two shows; one brief rendered at two lengths is a score.
 * The per-cue decisions — where a cue enters, how long it runs, how far under
 * the dialogue it sits — belong to the cue, not to the style.
 *
 * An object rather than a list because these are looked up by name and there is
 * at most one of each. When a second kind arrives (a voice brief, a colour
 * brief), it is a new key here, and an older Series simply has no value for it.
 */
export const seriesPrompts = z.object({
  /**
   * The music brief, verbatim, as it is sent to the music model.
   *
   * Empty or absent means this Series has no score — which is a real answer,
   * not a missing one. A piece can be carried entirely by its sound design.
   */
  musicStyle: z
    .string()
    .trim()
    .max(MAX_STANDING_PROMPT_CHARS, `a standing prompt is at most ${MAX_STANDING_PROMPT_CHARS} characters`)
    .nullish(),
  /**
   * The house clause every SHOT SHEET is asked for with, verbatim.
   *
   * A shot sheet is one short video whose whole job is to be cut up: N finished
   * frames, one per pin of the cue sheet, each held for under a second and hard
   * cut to the next, so every pin is a frame the video model drew rather than a
   * frame it has to translate. The shot LINES come from the cue sheet and are
   * different every time; this is the part that is the same every time — how to
   * shoot it, and what must never appear.
   *
   * Standing for the same reason `musicStyle` is: it says how the next sheet is
   * made, and the cue sheet does not change when it does. Empty or absent means
   * the built-in house clause, which is what the first sheet of a Series is
   * asked for with.
   */
  shotSheet: z
    .string()
    .trim()
    .max(MAX_STANDING_PROMPT_CHARS, `a standing prompt is at most ${MAX_STANDING_PROMPT_CHARS} characters`)
    .nullish(),
  /**
   * Which sections of a sectioned beat prompt are SENT to the Director.
   *
   * A standing brief in the same sense as the music style: it says how the
   * next film is made from the cue sheet, and nothing in the sheet changes
   * when it does. `null` or absent sends every section. A key listed here that
   * no beat carries is harmless; a beat whose sections are all left out is
   * sent with no prompt (see `beatText`). String prompts ignore it.
   */
  sections: z.array(sectionKey).max(32).nullish(),
});

export type SeriesPrompts = z.infer<typeof seriesPrompts>;

/**
 * How many generations a Series keeps. Past that, the oldest is let go.
 *
 * Bigger than `MAX_PAST_AUDIO_VERSIONS` because these are the INGREDIENTS, not
 * the dishes: one finished version is made of three scene parts and three music
 * cues, so a piece that kept only twenty would forget the components of its
 * fourth mix.
 */
export const MAX_AUDIO_PIECES = 64;

/** What a generated piece of audio IS, which decides how it is mixed. */
export const PIECE_KINDS = ['scene', 'music'] as const;
export type PieceKind = (typeof PIECE_KINDS)[number];

/**
 * ONE GENERATION: a single render, kept with everything needed to place it.
 *
 * An audio version is a MIX, and until now its ingredients existed only in the
 * prose of its own prompt — the renders themselves lived in a scratch directory
 * and on a provider CDN with no stated retention. That makes a finished version
 * un-remixable by construction: generation is not deterministic, so "the same
 * cue 3 dB louder" means regenerating the cue and getting a different
 * performance, which is a different piece of music.
 *
 * So every render is kept, in OUR bucket, with the numbers that put it back
 * where it was. The ffmpeg chain is then DERIVED from these rows rather than
 * retyped from a recipe string — and a level change costs an ffmpeg pass
 * instead of a generation.
 *
 * `kind` decides the arithmetic, not the taste:
 * - `scene`  the spoken piece itself. Laid end to end, crossfaded, at full level.
 * - `music`  a cue laid UNDER the scene, at `levelDb`, ducked under dialogue.
 */
export const audioPiece = z.object({
  /** Stable across edits, so a mix can name its ingredients. */
  id: z.string().trim().min(1).max(64),
  kind: z.enum(PIECE_KINDS),
  /** What to call it in a list — "part 2 of 3", "alert", "launch". */
  label: z.string().trim().max(120).default(''),
  /**
   * The prompt that made it, verbatim. Required for the same reason an audio
   * version's is: a clip in a bucket with no prompt beside it is a take nobody
   * can iterate on.
   */
  prompt: z.string().trim().min(1, 'a generation keeps the prompt that made it').max(MAX_AUDIO_VERSION_PROMPT_BYTES),
  /** The model that made it, as its maker writes it, plus how it was reached. */
  model: z.string().trim().max(200).nullish(),
  /** Our copy. A provider url is scratch space and is never stored here. */
  audioUrl: z.union([z.literal(''), mediaRef]).nullish(),
  /**
   * MEASURED length, never the requested one.
   *
   * `music_length_ms` is advisory on at least one model here: 28 000 ms came
   * back as 31.03 s, and a verbatim retry as 37.03 s. A span computed from the
   * request rather than the file is a cue that overruns the beat it was cut for.
   */
  seconds: z.number().min(0).max(MAX_AUDIO_SECONDS).nullish(),
  /** The second this piece starts, on the finished piece's own clock. */
  offset: z.number().min(0).max(MAX_AUDIO_SECONDS).default(0),
  /**
   * How far under the scene it sits, in dB. `0` for a scene part.
   *
   * Measured on this project: -21 dB inside (a hangar's mid is already full of
   * siren) and -16 dB outside (vacuum is thin and near-empty, and a cue at -21
   * simply vanishes). See the `add-bg-music-to-radio-version` skill.
   */
  levelDb: z.number().min(-60).max(12).default(0),
  /** Seconds of fade-in. A cue that starts at full level announces itself. */
  fadeInSec: z.number().min(0).max(30).default(0),
  /**
   * Where the dialogue is, as [from, to] pairs, so the cue can duck under it.
   *
   * These come from MEASURED voiced onsets, never from the cue sheet's beat
   * times — the script and the render disagree by enough that windows taken
   * from the script ducked over silence and left every line open.
   */
  ducks: z.array(z.tuple([z.number(), z.number()])).max(64).default([]),
  /** The cue sheet this was made against. See `cueTiming`. */
  cueTiming: cueTiming.nullish(),
  /** When the render was made, ISO 8601. */
  createdAt: z.string().trim().max(40).nullish(),
});

export type AudioPiece = z.infer<typeof audioPiece>;

/**
 * Add a generation to the library, newest first, and let the oldest go.
 *
 * Newest first because the list is read by a person looking for what they just
 * made, and capped because a Series is a row rather than an archive.
 */
export function addAudioPiece<T extends { audioPieces: AudioPiece[] }>(series: T, piece: AudioPiece): T {
  return { ...series, audioPieces: [piece, ...series.audioPieces].slice(0, MAX_AUDIO_PIECES) };
}

/** The pieces that make up one mix, in the order they enter. */
export function piecesInOrder(pieces: AudioPiece[], kind?: PieceKind): AudioPiece[] {
  return pieces.filter((p) => !kind || p.kind === kind).sort((a, b) => a.offset - b.offset);
}

/** The fields, with the rules above applied to each. See the note over them. */
const rules = {
  title: z.string().trim().min(1, 'a title is required').max(200),
  prompt: z
    .string()
    .trim()
    .min(1, 'a prompt is required')
    .max(MAX_PROMPT_CHARS, `the Director takes at most ${MAX_PROMPT_CHARS} characters`),
  /**
   * The exact first frame the Director starts from AND the poster the Director
   * shows before anyone presses play. The runner fetches it by URL, so it has
   * to be publicly reachable — which is what card 03's uploads are for.
   *
   * Empty is allowed ON A DRAFT and only there (see `seriesInput`). Not because
   * a Series without a first frame is a real thing, but because an upload needs
   * a Series to attach to: Create saves the row, then puts the file
   * on it. A draft is half-written by definition; publishing is where the rule
   * bites.
   */
  imageUrl: z.union([z.literal(''), mediaRef]),
  endImageUrl: mediaRef.nullish(),
  audioUrl: mediaRef.nullish(),
  resolution: z.enum(RESOLUTIONS),
  /**
   * Which surface this Series was written for — and therefore which one asks
   * for it. See the note at the top of this file: it is a property of the
   * reference image as much as of the window.
   */
  aspectRatio: z.enum(ASPECT_RATIOS),
  seed: z.number().int().nullish(),
  memory: z.number().int().min(1).max(50),
  status: z.enum(STATUSES),
  /** Where this Series sits in the project's list. A plain integer the author edits. */
  order: z.number().int(),
  /**
   * The cue sheet, in the order the author wrote it.
   *
   * Read whole, with its Series, and never queried across Series — which is
   * why a Series is one `docs` row rather than a table of beats. It reaches
   * the endpoint inside `configure.script`, all of it at once, so the Director
   * plans the arc before it generates a frame.
   */
  directions: z.array(direction).max(MAX_DIRECTIONS),
  /**
   * Where the Cue Sheet is cut into REELS.
   *
   * Each entry is the offset of a beat that OPENS a reel; the beats before it
   * close the one before. Empty — the common case — means one reel, which is
   * the design every Series had before a cue sheet grew past sixteen pins.
   *
   * A reel exists because `script_max_end_images` is 16 and a long cut needs
   * more. The first reel rides in the Recipe as `configure.script`; every later
   * one is sent as a `prompt` message carrying `script` with `script_mode:
   * 'append'`, and the endpoint gives each its own sixteen. Offsets inside a
   * reel are rebased to that reel's own clock, because the endpoint reads them
   * as "whole seconds from the start of the first video generated under THIS
   * script" — not from the start of the sitting.
   *
   * The price is the reel change, and it is not free: an appended reel starts
   * "at the chunk boundary after the running script's last text beat is
   * represented and its audio tails have finished", so the seam lands on the
   * chunk grid rather than on the second written here. See `reels()`.
   */
  reelChanges: z.array(z.number().int().min(1).max(86_400)).max(4),
  /**
   * The model sheets, in the order the author wrote them.
   *
   * The second JSON column, and it earns the exception the same way
   * `directions` does: read whole with its Series, never queried or sorted,
   * and — unlike every other field here — never sent anywhere at all.
   */
  modelSheets: z.array(modelSheet).max(MAX_MODEL_SHEETS),
  /**
   * The SELECTED audio version, or `null` where nobody has rendered one.
   *
   * Singular where the other JSON columns are lists, because the question "what
   * does this Series sound like" has one answer at a time: this record is it,
   * and it is what the Recipe carries as its audio (see `script`). Earlier
   * renders live in `pastAudioVersions`; a replaced render is archived there
   * rather than overwritten, because a render cannot be made again in the same
   * hand — same prompt, different performance, every time.
   */
  /**
   * Every generation this Series has made — scene parts and music cues — with
   * the numbers that place each one. The INGREDIENTS of its audio versions.
   *
   * The fifth JSON column, and it earns the exception the same way the others
   * do: read whole with its Series, never queried, never sorted by the store.
   */
  audioPieces: z.array(audioPiece).max(MAX_AUDIO_PIECES),
  /**
   * The standing prompts — the briefs this Series is made BY. See above.
   *
   * The fourth JSON column, and it earns the exception the same way the others
   * do: read whole with its Series, never queried, never sorted.
   */
  prompts: seriesPrompts,
  audioVersion: audioVersion.nullable(),
  /**
   * Every audio version this Series had before the selected one, most recent
   * first, each beside the prompt that made it. Selecting one swaps it back
   * into `audioVersion` and the previous selection joins this list.
   */
  pastAudioVersions: z.array(audioVersion).max(MAX_PAST_AUDIO_VERSIONS),
};

/**
 * Stamp the cue sheet's timing onto a render that has audio but no stamp yet.
 *
 * Applied on EVERY write path (see the store's `merged`), so a version gets its
 * stamp whether it was uploaded through Director setup, patched by a script, or
 * swapped in from the archive. The alternative — asking each caller to stamp —
 * guarantees the stamp is missing on precisely the renders nobody was watching.
 *
 * Two rules, both about not lying:
 *
 * 1. **Only a version with audio is stamped.** An unrendered version is a
 *    prompt waiting for a file; stamping it would claim a render happened
 *    against this sheet when none has happened at all.
 * 2. **An existing stamp is never rewritten.** The stamp records the sheet the
 *    SOUND was made against, and editing the cue sheet afterwards does not
 *    change that history — it is the very drift we are trying to show. Re-stamp
 *    on save and every version would read "in sync" forever, which is how you
 *    build a warning that can never fire.
 *
 * So a version stamped `null` stays `null`: "not recorded" is the honest answer
 * for a render made before this existed, and `cueMatchOf` reports it as such.
 */
export function stampCueTiming<T extends { directions: Direction[]; audioVersion: AudioVersion | null }>(
  next: T,
): T {
  const version = next.audioVersion;
  if (!version?.audioUrl || version.cueTiming) return next;
  return {
    ...next,
    audioVersion: {
      ...version,
      cueTiming: {
        fingerprint: cueTimingFingerprint(next.directions),
        beats: next.directions.length,
      },
    },
  };
}

/**
 * A patch that would replace a rendered audio version archives it first.
 *
 * The rule that keeps `pastAudioVersions` honest, applied wherever a Series is
 * written: if the patch changes `audioVersion.audioUrl` away from a render the
 * Series has, that render goes to the front of the past list — unless the
 * patch already put it there itself, which is what selecting an old version
 * from the versions list does. Metadata edits on the selected version (its duration,
 * its model) change no url and archive nothing.
 */
export function archiveReplacedAudio<
  P extends { audioVersion?: AudioVersion | null; pastAudioVersions?: AudioVersion[] },
>(
  existing: { audioVersion: AudioVersion | null; pastAudioVersions: AudioVersion[] },
  patch: P,
): P & { pastAudioVersions?: AudioVersion[] } {
  const replaced = existing.audioVersion;
  if (patch.audioVersion === undefined || !replaced?.audioUrl) return patch;
  if (patch.audioVersion?.audioUrl === replaced.audioUrl) return patch;
  const past = patch.pastAudioVersions ?? existing.pastAudioVersions;
  if (past.some((v) => v.audioUrl === replaced.audioUrl)) return patch;
  return { ...patch, pastAudioVersions: [replaced, ...past].slice(0, MAX_PAST_AUDIO_VERSIONS) };
}

/**
 * What an author writes. `id`, `createdAt` and `updatedAt` belong to the store,
 * so they are not here.
 */
export const seriesFields = z.object({
  ...rules,
  imageUrl: rules.imageUrl.default(''),
  resolution: rules.resolution.default(DEFAULT_RESOLUTION),
  aspectRatio: rules.aspectRatio.default(DEFAULT_ASPECT_RATIO),
  memory: rules.memory.default(DEFAULT_MEMORY),
  status: rules.status.default('draft'),
  order: rules.order.default(0),
  directions: rules.directions.default([]),
  reelChanges: rules.reelChanges.default([]),
  modelSheets: rules.modelSheets.default([]),
  audioPieces: rules.audioPieces.default([]),
  prompts: rules.prompts.default({}),
  audioVersion: rules.audioVersion.default(null),
  pastAudioVersions: rules.pastAudioVersions.default([]),
});

/**
 * The fields plus the one rule that spans them: a PUBLISHED Series has a first
 * frame. Validate a whole Series with this — including the result of applying a
 * patch, which is how "publish" gets checked against a row whose image was
 * uploaded in an earlier request.
 *
 * Separate from `seriesFields` because `.partial()` exists only on a plain
 * object schema, not on one carrying a cross-field refinement.
 */
export const MIN_END_IMAGE_GAP_SECONDS = 3;

/**
 * How far into a reel its FIRST pin may sit.
 *
 * The endpoint's own words, refusing a Series whose first end image was at 4s:
 * `invalid_initial_script — infeasible_timing: a chunk cannot end 4 s after
 * the previous boundary; the opening minimum is 5 s`. The opening chunk of a
 * script is longer than the ones after it, so a pin closer than this to the
 * reel's start is a session that dies at `configure` — after the sheet was
 * saved, and after the frame was drawn. Checked per reel, like the rest,
 * because an appended reel opens a script of its own.
 */
export const MIN_OPENING_END_IMAGE_SECONDS = 5;

export const seriesInput = seriesFields.superRefine((series, ctx) => {
  // EVERY CEILING HERE IS PER REEL, NOT PER SERIES.
  //
  // The endpoint applies them to one `script` message, and a Series sends one
  // script per reel — so a 33-pin cue sheet is legal cut in two and refused
  // whole. Checking the flat sheet instead was briefly the rule here and it
  // rejected exactly the Series this was built for.
  //
  // `reels()` is what the wire will carry, so it is what gets checked: it has
  // already rebased the offsets and already dropped the pin the opening beat
  // of an appended reel cannot keep.
  const cut = reels(series);
  const many = cut.length > 1;
  const where = (reel: number) => (many ? `reel ${reel + 1}: ` : '');

  cut.forEach((beats, reel) => {
    const pinned = beats.filter((beat) => beat.end_image_url);
    // The count, a separate ceiling from the spacing and from the beat ceiling.
    // Said with the number, because "too many" leaves whoever reads it counting
    // rows by hand to find out how many pins have to go.
    if (pinned.length > MAX_END_IMAGES) {
      ctx.addIssue({
        code: 'custom',
        path: ['directions'],
        message:
          `${where(reel)}${pinned.length} beats pin an end image; the Director takes ` +
          `${MAX_END_IMAGES} per reel — ${pinned.length - MAX_END_IMAGES} of them have to ` +
          `lose their pin, or the reel has to be cut`,
      });
    }
    // `reels()` has already placed the selected audio version on the opening
    // beat, so this counts what the wire carries rather than guessing at it.
    const sounded = beats.filter((beat) => beat.audio_url);
    if (sounded.length > MAX_AUDIO_BEATS) {
      ctx.addIssue({
        code: 'custom',
        path: ['directions'],
        message: `${where(reel)}${sounded.length} beats carry audio; the Director takes ${MAX_AUDIO_BEATS} per reel`,
      });
    }
    if (beats.length > MAX_DIRECTIONS) {
      ctx.addIssue({
        code: 'custom',
        path: ['directions'],
        message: `${where(reel)}${beats.length} beats; the Director takes ${MAX_DIRECTIONS} per reel`,
      });
    }
    // The opening chunk of a script has its own, longer minimum.
    if (pinned.length && pinned[0].offset < MIN_OPENING_END_IMAGE_SECONDS) {
      ctx.addIssue({
        code: 'custom',
        path: ['directions'],
        message:
          `${where(reel)}the first end image is ${pinned[0].offset}s into the reel; ` +
          `the Director's opening chunk is at least ${MIN_OPENING_END_IMAGE_SECONDS}s`,
      });
    }
    // "Offsets of successive end images must be at least three seconds apart."
    // The endpoint rejects the whole session for this, which is an expensive
    // way to find out, so the form says it while the sheet is still being typed.
    for (let i = 1; i < pinned.length; i++) {
      if (pinned[i].offset - pinned[i - 1].offset < MIN_END_IMAGE_GAP_SECONDS) {
        ctx.addIssue({
          code: 'custom',
          path: ['directions'],
          message:
            `${where(reel)}end images at ${pinned[i - 1].offset}s and ${pinned[i].offset}s are ` +
            `closer than ${MIN_END_IMAGE_GAP_SECONDS}s apart`,
        });
        break;
      }
    }
  });

  // A reel change that lands where no beat does cuts nothing: `reels()` splits
  // on "the first beat at or after this offset", so a stray number silently
  // produces the reel the author did not ask for. Named here instead.
  const offsets = new Set((series.directions ?? []).map((beat) => beat.offset));
  for (const change of series.reelChanges ?? []) {
    if (!offsets.has(change)) {
      ctx.addIssue({
        code: 'custom',
        path: ['reelChanges'],
        message: `there is no beat at ${change}s for a reel to open on`,
      });
    }
  }

  if (series.status === 'published' && !series.imageUrl) {
    ctx.addIssue({
      code: 'custom',
      path: ['imageUrl'],
      message: 'a published Series needs its reference image',
    });
  }
});

export type SeriesInput = z.infer<typeof seriesFields>;

/** Every field optional, and none of them defaulted: a PUT changes what it names. */
export const seriesPatch = z.object(rules).partial();
export type SeriesPatch = z.infer<typeof seriesPatch>;

/**
 * A patch applied to a Series, ignoring keys it did not name.
 *
 * `undefined` in a patch means "not mentioned", never "clear this" — a form
 * that omits a field must not erase it. Clearing is `null`, which the optional
 * fields accept.
 */
export function applyPatch<T extends SeriesInput>(series: T, patch: SeriesPatch): T {
  const next = { ...series };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) (next as Record<string, unknown>)[key] = value;
  }
  return next;
}

export type Series = SeriesInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

/** One beat on the wire. Snake case, and only the four keys the endpoint knows. */
export type ScriptBeat = {
  offset: number;
  prompt: string | null;
  end_image_url: string | null;
  audio_url: string | null;
};

/**
 * A later reel on the wire: the `prompt` message that appends one.
 *
 * Note what is NOT here. `protocol_version` is forbidden on a `prompt` and
 * takes the session with it; `prompt`, `end_image_url` and `audio_url` are
 * exclusive with `script` and must be absent, not null. Written out as its own
 * type rather than reusing the improvisation `prompt` for that reason: they are
 * the same wire type and almost disjoint messages.
 */
export type AppendedReel = {
  type: 'prompt';
  prompt_version: number;
  script: ScriptBeat[];
  script_mode: 'append';
};

/**
 * Everything one sitting sends, in the order it sends it.
 *
 * A Series with no reel change is a `configure` and nothing else, which is
 * every Series this repo had before a cue sheet grew past sixteen pins. A
 * Series with one is a `configure` and one append — same cue sheet, same
 * pictures, cut into reels because the ceiling is per script.
 */
export type Screening = {
  configure: Recipe;
  reels: AppendedReel[];
  /**
   * The AUTHORED length of the whole cue sheet, before a reel change moves it.
   *
   * Carried rather than derived from `configure.script`, which after a cut
   * holds only the first reel and would report a 180-second film as a 92-second
   * one. It is what the Series says the film is; what it actually runs to is
   * the authored length plus however much each seam slid, which is why the
   * session treats this as the number to AIM at and not as a stop.
   */
  filmSeconds: number;
};

/**
 * How much a single reel change may push the film past its authored length.
 *
 * An appended reel starts at a chunk boundary, and `max_chunk_duration` is 15 —
 * so one seam can add up to a chunk's worth of film that nobody wrote. The
 * ceiling has to allow for it per cut, or the film clock reaches the target
 * while the last reel is still playing and `finish()` cuts it off mid-scene.
 */
/**
 * One chunk of room for a last beat that still has something to say.
 *
 * The endpoint advertises `chunk_seconds: 10`, and a direction cannot be
 * realised in less than the chunk it lands in. It lives here rather than beside
 * the session because it is a fact about a CUE SHEET's length — which is what
 * `screening()` has to state, and what a reel change then moves.
 */
export const SCRIPT_TAIL_SECONDS = 10;

export const REEL_CHANGE_ALLOWANCE_SECONDS = 15;

/** The `configure` message. Snake case, because this is fal's vocabulary. */
export type Recipe = {
  protocol_version: 1;
  type: 'configure';
  prompt_version: 1;
  aspect_ratio: AspectRatio;
  resolution: Resolution;
  prompt: string;
  image_url: string;
  end_image_url: string | null;
  audio_url: string | null;
  seed: number | null;
  memory: number;
  script: ScriptBeat[] | null;
};

/**
 * The cue sheet on the wire, in offset order, or `null` when there is none.
 *
 * Sorted rather than taken as authored: `offset` is the beat's identity to the
 * Director, so a row typed out of order is a typo, not an instruction — and the
 * end-image spacing rule is only checkable against a sorted list anyway.
 */
export function script(
  series: Pick<Series, 'directions'> & {
    audioVersion?: Series['audioVersion'];
    prompts?: Series['prompts'] | null;
  },
): ScriptBeat[] | null {
  const beats = series.directions ?? [];
  if (beats.length === 0) return null;
  // The selected audio version is the piece's soundtrack: it rides on the
  // first beat, where the endpoint starts audio placed "at this second", unless
  // that beat carries a bed of its own. Selecting a different version in the
  // author therefore changes what the Director generates against.
  const soundtrack = series.audioVersion?.audioUrl || null;
  return [...beats]
    .sort((a, b) => a.offset - b.offset)
    .map((beat, index) => ({
      offset: beat.offset,
      // Sections become the one text the endpoint takes, filtered by the
      // Series' include list; a plain string goes as written.
      prompt: beatText(beat.prompt, series.prompts?.sections) || null,
      end_image_url: beat.endImageUrl ?? null,
      audio_url: beat.audioUrl ?? (index === 0 ? soundtrack : null),
    }));
}

/**
 * The cue sheet cut into REELS, each already on its own clock.
 *
 * One reel unless the Series names a reel change, and that one reel is exactly
 * what `script()` returns — so a Series that never grew past sixteen pins sends
 * byte for byte what it sent before this existed.
 *
 * Two things happen at a cut, and both are the endpoint's doing rather than
 * ours:
 *
 * **Offsets rebase.** A beat's offset is "whole seconds from the start of the
 * first video generated under THIS script", so the beat that opens a reel
 * becomes offset 0 and every beat after it is measured from there. The reel's
 * internal timing is therefore exact — what floats is where the whole reel
 * lands, because an appended script starts at a CHUNK BOUNDARY after the
 * previous reel's last text beat is represented and its audio has finished.
 * That seam is the reel change, and like a projectionist's it is visible.
 *
 * **The opening beat loses its pin.** An end image is "the exact final frame of
 * the chunk that ENDS at this offset", and no chunk ends at offset 0 — there is
 * nothing before it in this script to be the final frame of. So the beat that
 * opens a reel keeps its prompt and its audio and gives up its picture. That is
 * the real cost of a cut, and it is one frame per reel change: the alternative
 * for a 33-pin sheet was giving up seventeen.
 */
export function reels(
  series: Pick<Series, 'directions' | 'reelChanges'> & { audioVersion?: Series['audioVersion'] },
): ScriptBeat[][] {
  const whole = script(series);
  if (!whole) return [];
  const cuts = [...new Set(series.reelChanges ?? [])].sort((a, b) => a - b);
  if (cuts.length === 0) return [whole];

  // Split first, rebase second — the origins are the cuts themselves, so the
  // two steps do not need to know about each other.
  const spans: { origin: number; beats: ScriptBeat[] }[] = [];
  let rest = whole;
  let origin = 0;
  for (const cut of cuts) {
    const before = rest.filter((beat) => beat.offset < cut);
    const after = rest.filter((beat) => beat.offset >= cut);
    // A cut with nothing on one side of it is not a cut. Skipped rather than
    // rejected here, because `seriesInput` is where a bad reel change is
    // reported to whoever typed it.
    if (before.length === 0 || after.length === 0) continue;
    spans.push({ origin, beats: before });
    rest = after;
    origin = cut;
  }
  spans.push({ origin, beats: rest });

  return spans.map((span, reel) =>
    span.beats.map((beat, index) => ({
      ...beat,
      offset: beat.offset - span.origin,
      // The opening beat of an APPENDED reel: no chunk ends at second zero, so
      // there is no final frame for a pin there to be. The first reel is not
      // appended and its beat 0 never carried one anyway.
      end_image_url: reel > 0 && index === 0 ? null : beat.end_image_url,
    })),
  );
}

/**
 * Series → the exact message the Stage sends on open.
 *
 * Written out field by field rather than spread from the row, because the
 * endpoint forbids additional properties: a row that grows a column would
 * otherwise start failing every session with a validation error from fal rather
 * than from us. Absent optionals are `null`, not missing, for the same reason:
 * one shape, always.
 *
 * The whole cue sheet travels INSIDE this message. It used to be sent as timed
 * `prompt` messages from the Stage, which is the endpoint's improvisation path
 * and the wrong one for an authored piece: those land on the wall clock, so a
 * slow connection slid every beat, and a `prompt` cannot pin an exact frame at
 * a second that has not been generated yet. `script` is planned before the
 * first frame exists, on the video's own clock.
 *
 * `end_image_url` and `audio_url` go to null when there is a script, because
 * the endpoint refuses them together — "place them in the script" — and a
 * top-level end image means something narrower anyway: the final frame of the
 * FIRST chunk, not of the piece.
 */
export function recipe(series: Pick<Series, keyof SeriesInput>): Recipe {
  // The FIRST reel, which on a Series with no reel change is the whole sheet.
  const cut = reels(series);
  const beats = cut.length ? cut[0] : null;
  return {
    protocol_version: 1,
    type: 'configure',
    prompt_version: 1,
    aspect_ratio: series.aspectRatio,
    resolution: series.resolution,
    prompt: series.prompt,
    image_url: series.imageUrl,
    end_image_url: beats ? null : (series.endImageUrl ?? null),
    audio_url: beats ? null : (series.audioUrl ?? series.audioVersion?.audioUrl ?? null),
    seed: series.seed ?? null,
    memory: series.memory,
    script: beats,
  };
}

/**
 * Series → everything one sitting sends, in order.
 *
 * `prompt_version` is the session's, not the Series': it is monotonic per
 * sitting and `configure` is version 1, so the reels continue from 2. The
 * session does not renumber them — it sends what it is handed and carries on
 * counting from the last, which is what keeps a live `direct()` after a reel
 * change from colliding with one.
 */
export function screening(series: Pick<Series, keyof SeriesInput>): Screening {
  const cut = reels(series);
  // The whole sheet on its authored clock — not the reels, whose offsets have
  // been rebased and whose last one therefore ends at 88 rather than at 180.
  const whole = script(series);
  const last = whole?.at(-1);
  return {
    configure: recipe(series),
    reels: cut.slice(1).map((beats, index) => ({
      type: 'prompt',
      prompt_version: index + 2,
      script: beats,
      script_mode: 'append',
    })),
    filmSeconds: (last?.offset ?? 0) + (last?.prompt ? SCRIPT_TAIL_SECONDS : 0),
  };
}

/** `{ field: message }`, which is what a form needs to show the error in place. */
export type FieldErrors = Record<string, string>;

export function fieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

// ─── What to generate this Series' ART at ────────────────────────────────────
//
// Not a new fact about a Series — every value here is derived from
// `aspectRatio` and `resolution`, which the row already has. It is served as a
// route (`GET /api/director/series/:id/art`) because these numbers used to live
// in a skill and in a doc, which is to say in two places a Series cannot reach
// and that nothing updates when a Series changes shape. Ask the system.
//
// A still generated at the wrong aspect is not a cropping problem. `imageUrl`
// and a beat's `endImageUrl` are the EXACT frames the Director starts a chunk
// from, so a 9:16 frame on a 16:9 Series is a different opening image, not a
// letterboxed one.
//
// WHAT IS DELIBERATELY NOT HERE: the model. The repo this came from pinned one
// image model by name, because it had one provider. Shot Studio's whole premise
// is that the catalog is the author's provider's, live — so the model is chosen
// where every other generation chooses it, and this says only what the Director
// needs to be true of the picture whichever model draws it.

/** What a picture is generated as, and how much of it. */
export type ArtRecipe = {
  /** Passed straight to `POST /api/visual-world/generate`. */
  aspectRatio: AspectRatio;
  /** The design-sheet tag, when this art IS one. */
  sheetType?: 'character' | 'location' | 'prop';
  /** How many to fan out per ask. */
  count: number;
  /**
   * Does this art EDIT a picture that already exists, or make one from prose?
   *
   * A close-up pushed out of a wide, a detail insert, the same setup a beat
   * later — those are edits of the frame they come out of, and generating them
   * from prose instead gives a plausible room rather than THE room. So a still
   * that follows a pinned frame rides with that frame as its reference; a model
   * sheet is always made, never edited.
   */
  editsItsReference: boolean;
};

export type ArtSettings = {
  /** The Series' own two fields, echoed so a caller needs one request. */
  aspectRatio: AspectRatio;
  resolution: Resolution;
  /** Reference turnarounds. Always 16:9 — they are looked at, never played. */
  sheets: ArtRecipe;
  /** The pinned frames on the cue sheet. The Series' own shape, always. */
  stills: ArtRecipe;
  /** The Shot Sheet render: one clip, the Series' shape, the sheets as references. */
  shotSheet: { aspectRatio: AspectRatio; count: 1 };
};

export function artSettings(series: Pick<Series, 'aspectRatio' | 'resolution'>): ArtSettings {
  return {
    aspectRatio: series.aspectRatio,
    resolution: series.resolution,
    sheets: {
      // 16:9 whatever the Series is: a turnaround spends its width on four or
      // five views, and the same pixels in 9:16 leave each view too small to
      // reference — which is the only thing a sheet is for.
      aspectRatio: '16:9',
      sheetType: 'character',
      count: 4,
      editsItsReference: false,
    },
    stills: {
      aspectRatio: series.aspectRatio,
      count: 4,
      editsItsReference: true,
    },
    shotSheet: { aspectRatio: series.aspectRatio, count: 1 },
  };
}
