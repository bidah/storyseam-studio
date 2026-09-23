import {
  MAX_END_IMAGES,
  MAX_PROMPT_CHARS,
  MIN_END_IMAGE_GAP_SECONDS,
  MIN_OPENING_END_IMAGE_SECONDS,
  SECTION_JOIN,
  sectionOrder,
  type AspectRatio,
  type Direction,
  type Series,
} from './series';

// THE SHOT SHEET — the cue sheet asked for as one short film, so its pins can
// be cut out of it.
//
// A pinned frame is the exact picture the Director starts a chunk from, and the
// cheapest way for it to hold a style is for the picture to have been drawn by
// the model that has to continue it. Generating the pins in an image model
// gives frames the Director must TRANSLATE — a richer painted still, a flatter
// cel still, either way a style it did not draw. Asking the video model for one
// short video that is nothing but N finished frames, hard cut, gives pins that
// are by construction in a style it renders natively, all from one pass, all
// lit and designed the same way, for the price of one fifteen-second clip.
//
// This module is the sheet itself: which frames the cue sheet needs, what each
// shot says, when in the video each one lands, and the request that renders it.
// Pure, and shared — vendored by `npm run series:sync` into the Worker and the
// agent, so a sheet the page would refuse is refused before a render is spent,
// and refused in ONE place rather than three.
//
// **The sheet is assembled, never typed.** The grab times are derived from the
// same list of shots that the prompt is written from, so a prompt with sixteen
// shots in it and seventeen grabs taken out of it is a film whose every pin is
// one beat wrong. The shot TEXT is the author's; the count, the spans and the
// order are the sheet's.

/** fal's ceiling and floor on one h3-max render. */
export const MIN_DURATION_SECONDS = 5;
export const MAX_DURATION_SECONDS = 15;

/**
 * How little of the video one shot may have.
 *
 * Seventeen shots over fifteen seconds — 0.88s each — is the spacing that was
 * measured to hold: every cut landed, in order, at roughly the time it was
 * asked for. Tighter than this and a shot has fewer frames than the model
 * needs to settle on a drawing, and the grab in the middle of it catches the
 * dissolve rather than the frame.
 */
export const MIN_SHOT_SECONDS = 0.8;

/** `reference_image_urls` on the endpoint. Images, videos and audio together may be 12; images alone, 9. */
export const MAX_REFERENCE_IMAGES = 9;

/**
 * The two endpoints this door opens, and nothing else.
 *
 * `reference-to-video` when the Series has model sheets to hand it — the
 * sheets go in as `Image 1, Image 2…` and the prompt names them, which is what
 * keeps a design the same across seventeen shots that were never drawn side by
 * side. `text-to-video` when it has none, which is the take this was learned
 * from: the locks carried in prose alone.
 */
export const REFERENCE_ENDPOINT = 'minimax/h3-max/reference-to-video';
export const TEXT_ENDPOINT = 'minimax/h3-max/text-to-video';
export type ShotSheetEndpoint = typeof REFERENCE_ENDPOINT | typeof TEXT_ENDPOINT;

export const RESOLUTIONS = ['480P', '768P', '1080P'] as const;
export type SheetResolution = (typeof RESOLUTIONS)[number];

/**
 * What the model would do to the prompt if it were allowed to.
 *
 * Pinned to `disabled` and not offered as a choice. Expansion rewrites the
 * prompt before generation, and the thing being rewritten here is a numbered
 * list of times — a sheet whose shot list has been "improved" is a sheet whose
 * cuts no longer land where the grabs are taken.
 */
export const PROMPT_EXPANSION = 'disabled';

/**
 * ONE FRAME the cue sheet needs, and one shot of the sheet that will draw it.
 *
 * `kind` is where it lands, and the two are not the same write. An `opening`
 * frame is the Series' `imageUrl` — the picture the film starts on. A `pin` is
 * `directions[n].endImageUrl` at `offset`, which is the exact final frame of
 * the chunk ENDING there.
 */
export type Shot = {
  /** The second on the cue sheet's own clock this frame belongs to. */
  offset: number;
  kind: 'opening' | 'pin';
  /** The shot, as one finished frame described. Becomes `SHOT n (a–bs) — …`. */
  text: string;
};

/** One reference image, and what the prompt will say it IS. */
export type Reference = { url: string; label: string };

export type Sheet = {
  /** The Series' own prompt, verbatim: the style, the look lock, the identity locks. */
  premise: string;
  /** The sheets handed to the model, in the order the prompt numbers them. */
  references: Reference[];
  /** The house clause — how to shoot it and what must not appear. See `HOUSE_CLAUSE`. */
  clause: string;
  shots: Shot[];
  duration: number;
  aspectRatio: AspectRatio;
  resolution: SheetResolution;
  /** Set once a sheet is worth rendering again with one shot reworded. */
  seed?: number;
};

/**
 * The part of a shot-sheet prompt that is the same every time.
 *
 * Kept on the Series as `prompts.shotSheet` once it is edited; this is what a
 * Series that has never been asked for a sheet starts from. Three substitutions
 * are made when it is rendered:
 *
 * - `{count}` how many shots this sheet has
 * - `{span}`  how long each one is held, in seconds
 * - `{shots}` the numbered shot list itself, with its time ranges
 *
 * `{shots}` is a placeholder rather than an append so the NEGATIVES can sit
 * after the list, which is where the take this was learned from had them.
 */
export const HOUSE_CLAUSE = `[HOW TO SHOOT IT] This is a SHOT SHEET: {count} separate finished frames, one after another, each held for just under {span} seconds and then a HARD CUT to the next. No dissolves, no wipes, no montage, no split screen, no camera moves beyond a slow drift inside a shot. Each shot is a complete, cleanly drawn frame that could be printed as a still. Keep the frame size each shot names for its whole span.

{shots}

[NEGATIVES] No grid, no chart, no model sheet, no plain studio background and no printed lettering anywhere. No identity or wardrobe drift, no text or subtitles, no on-screen lettering of any kind.`;

/** How long each shot is held. */
export function shotSpan(sheet: Pick<Sheet, 'duration' | 'shots'>): number {
  return sheet.shots.length ? sheet.duration / sheet.shots.length : 0;
}

/**
 * The second to grab shot `index` at: the MIDDLE of its span.
 *
 * Not its start. A cut lands at roughly the asked-for time and not exactly, so
 * a grab on a boundary is a coin toss between two shots; a grab halfway through
 * is the drawing that shot settled on.
 */
export function grabTime(sheet: Pick<Sheet, 'duration' | 'shots'>, index: number): number {
  return (index + 0.5) * shotSpan(sheet);
}

/** Every grab time, in order — what the frames are cut at. */
export function grabTimes(sheet: Pick<Sheet, 'duration' | 'shots'>): number[] {
  return sheet.shots.map((_, index) => grabTime(sheet, index));
}

function seconds(value: number): string {
  return value.toFixed(1);
}

/** `SHOT 3 (1.8–2.6s) — …`, one per line, as the model is given them. */
export function shotLines(sheet: Pick<Sheet, 'duration' | 'shots'>): string[] {
  const span = shotSpan(sheet);
  return sheet.shots.map(
    (shot, index) =>
      `SHOT ${index + 1} (${seconds(index * span)}–${seconds((index + 1) * span)}s) — ${shot.text.trim()}`,
  );
}

/** `[IMAGE REFERENCES] Image 1 is …`, or nothing when there are none. */
export function referenceBlock(references: Reference[]): string {
  if (!references.length) return '';
  const named = references
    .map((reference, index) => `Image ${index + 1} is ${reference.label.trim()}.`)
    .join(' ');
  return `[IMAGE REFERENCES] ${named} These are the DESIGN, not a scene: every shot below is drawn with the same figures, machines, places and palette these show, from whatever angle the shot names.`;
}

/**
 * The prompt, assembled.
 *
 * Premise first, because the style and the identity locks govern everything
 * under them; then what the reference images are; then the house clause with
 * the shot list inside it.
 */
export function renderPrompt(sheet: Sheet): string {
  const span = shotSpan(sheet);
  const list = shotLines(sheet).join('\n');
  const clause = (sheet.clause || HOUSE_CLAUSE)
    .replace(/\{count\}/g, String(sheet.shots.length))
    .replace(/\{span\}/g, seconds(span));
  const tail = clause.includes('{shots}') ? clause.replace(/\{shots\}/g, list) : `${clause}\n\n${list}`;
  return [sheet.premise.trim(), referenceBlock(sheet.references), tail]
    .filter(Boolean)
    .join('\n\n');
}

/** Which of the two endpoints this sheet is for: it has references, or it has not. */
export function endpointFor(sheet: Pick<Sheet, 'references'>): ShotSheetEndpoint {
  return sheet.references.length ? REFERENCE_ENDPOINT : TEXT_ENDPOINT;
}

/** The body fal is sent, derived — so the prompt and the grab times cannot disagree. */
export function renderBody(sheet: Sheet): Record<string, unknown> {
  return {
    prompt: renderPrompt(sheet),
    duration: sheet.duration,
    resolution: sheet.resolution,
    aspect_ratio: sheet.aspectRatio,
    prompt_expansion_mode: PROMPT_EXPANSION,
    ...(sheet.references.length
      ? { reference_image_urls: sheet.references.map((reference) => reference.url) }
      : {}),
    ...(sheet.seed === undefined ? {} : { seed: sheet.seed }),
  };
}

export type SheetError = { shot?: number; message: string };

/** How many shots fit in a video of this length at all. */
export function maxShots(duration: number): number {
  return Math.floor(duration / MIN_SHOT_SECONDS);
}

/** Every reason this sheet cannot be rendered, or none. */
export function validateSheet(sheet: unknown): SheetError[] {
  const errors: SheetError[] = [];
  const draft = sheet as Partial<Sheet> | null;
  const shots = draft?.shots;
  if (!Array.isArray(shots) || shots.length < 1) {
    return [{ message: 'a shot sheet needs at least one shot' }];
  }

  const duration = draft?.duration;
  if (!Number.isInteger(duration) || (duration as number) < MIN_DURATION_SECONDS || (duration as number) > MAX_DURATION_SECONDS) {
    errors.push({ message: `a shot sheet is ${MIN_DURATION_SECONDS}–${MAX_DURATION_SECONDS} whole seconds long` });
  } else if (shots.length > maxShots(duration as number)) {
    errors.push({
      message:
        `${shots.length} shots in ${duration}s is ${((duration as number) / shots.length).toFixed(2)}s each; ` +
        `a shot needs ${MIN_SHOT_SECONDS}s to settle on a drawing, so this video holds ${maxShots(duration as number)}`,
    });
  }

  if (!draft?.premise?.trim()) errors.push({ message: 'the Series’ own prompt is the sheet’s style and identity locks — it cannot be empty' });

  shots.forEach((raw, index) => {
    const shot = raw as Partial<Shot> | null;
    if (!shot?.text?.trim()) errors.push({ shot: index, message: 'a shot is one finished frame, described' });
    if (!Number.isInteger(shot?.offset) || (shot?.offset as number) < 0) {
      errors.push({ shot: index, message: 'a shot lands on a whole second of the cue sheet' });
    }
    if (shot?.kind !== 'opening' && shot?.kind !== 'pin') {
      errors.push({ shot: index, message: 'a shot is the opening frame or a pin' });
    }
  });

  // The frames this sheet would WRITE, checked against the rules that would
  // refuse them — here, where a render has not been paid for yet, rather than
  // at the save afterwards or at `configure` after that.
  const pins = shots
    .filter((shot) => (shot as Shot).kind === 'pin')
    .map((shot) => (shot as Shot).offset)
    .sort((a, b) => a - b);
  if (pins.length > MAX_END_IMAGES) {
    errors.push({ message: `a script may pin ${MAX_END_IMAGES} frames; this sheet draws ${pins.length}` });
  }
  if (pins.length && pins[0] < MIN_OPENING_END_IMAGE_SECONDS) {
    errors.push({ message: `a frame cannot be pinned before ${MIN_OPENING_END_IMAGE_SECONDS}s — the Director’s opening chunk is at least that long` });
  }
  for (let i = 1; i < pins.length; i++) {
    if (pins[i] - pins[i - 1] < MIN_END_IMAGE_GAP_SECONDS) {
      errors.push({ message: `pinned frames at ${pins[i - 1]}s and ${pins[i]}s are closer than ${MIN_END_IMAGE_GAP_SECONDS}s apart` });
    }
  }
  if (new Set(pins).size !== pins.length) errors.push({ message: 'two shots draw the frame at the same second' });

  const references = draft?.references;
  if (references !== undefined) {
    if (!Array.isArray(references) || references.length > MAX_REFERENCE_IMAGES) {
      errors.push({ message: `a sheet hands the model at most ${MAX_REFERENCE_IMAGES} reference images` });
    } else {
      references.forEach((reference, index) => {
        const url = (reference as Reference | null)?.url;
        // fal fetches these itself, from the public internet.
        if (!url || !/^https?:\/\//.test(url)) {
          errors.push({ message: `reference Image ${index + 1} is not a url fal can fetch` });
        }
        if (!(reference as Reference | null)?.label?.trim()) {
          errors.push({ message: `reference Image ${index + 1} has no label — the prompt has to say what it IS` });
        }
      });
    }
  }

  if (draft?.aspectRatio !== '16:9' && draft?.aspectRatio !== '9:16') {
    errors.push({ message: 'a sheet is rendered in the Series’ own shape' });
  }
  if (!RESOLUTIONS.includes(draft?.resolution as SheetResolution)) {
    errors.push({ message: `resolution is one of ${RESOLUTIONS.join(', ')}` });
  }
  if (draft?.seed !== undefined && draft?.seed !== null && !Number.isInteger(draft.seed)) {
    errors.push({ message: 'a seed is a whole number' });
  }

  if (errors.length === 0 && renderPrompt(draft as Sheet).length > MAX_PROMPT_CHARS) {
    errors.push({ message: `the assembled prompt is longer than ${MAX_PROMPT_CHARS} characters` });
  }
  return errors;
}

// ------------------------------------------------------- reading a Series

/**
 * The sections of a beat that describe a PICTURE.
 *
 * A sectioned prompt (ADR-0013) is not all scenery. `range` is a time span,
 * `style` is the house clause repeated on every beat, `score` asks for music
 * and `shot` is the standing instruction about how to hold the frame — none of
 * them is a thing to draw, and all four of them at the top of a shot line is
 * how a sheet ends up asking for "0-4s" as a picture. Only what is left is.
 *
 * Read off the live h3-ref row, where the first slot came out as the time range
 * followed by the style clause.
 */
export const UNDRAWN_SECTIONS = ['range', 'style', 'score', 'shot'];

/** What a beat's prompt DESCRIBES, sections and all — its scene, and nothing standing. */
export function visibleText(
  prompt: Direction['prompt'],
  include?: readonly string[] | null,
): string {
  if (!prompt) return '';
  if (typeof prompt === 'string') return prompt;
  const drawn = sectionOrder(prompt, include).filter((key) => !UNDRAWN_SECTIONS.includes(key));
  // `scene` alone when there is one: it is the convention, and a Series that
  // has invented other visual keys is better served by all of them than by a
  // guess about which.
  const keys = drawn.includes('scene') ? ['scene'] : drawn;
  return keys
    .map((key) => prompt[key].trim())
    .filter(Boolean)
    .join(SECTION_JOIN);
}

/** A sentence with speech in it. Somebody's line is not a frame. */
function spoken(sentence: string): boolean {
  return /["“”]/.test(sentence);
}

function sentences(text: string): string[] {
  return text
    .trim()
    .split(/(?<=[.!?]["”]?)\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/**
 * The sentence a beat ENDS on — the brief for the frame that follows it.
 *
 * Beat prompts in this repo end with "End on…", "End with…" or "Arrive
 * naturally at…", and that sentence is the picture the Director was told to
 * arrive at. It is therefore the picture to draw, and it is looked for first.
 *
 * A beat that carries no such sentence falls back to its most DESCRIBED
 * sentence rather than its last one, which is what the live rows forced: half
 * the beats of a dialogue-heavy cue sheet end on a line of speech, and the
 * last sentence of those is `Now."` or `Time to go."` — a beat of the scene,
 * not a frame of it. Speech is dropped and the longest of what is left is the
 * guess, which the author then edits. It is a starting point either way.
 */
export function endBrief(text: string): string {
  const named = text.match(/((?:End (?:on|with)|Arrive naturally at)\b[^.]*\.)/i);
  if (named) return named[1].trim();
  const drawn = sentences(text).filter((sentence) => !spoken(sentence));
  if (!drawn.length) return text.trim();
  return drawn.reduce((longest, sentence) => (sentence.length > longest.length ? sentence : longest));
}

/**
 * ONE SLOT of the cue sheet: a frame the film could be pinned to, and what the
 * cue sheet already says about it.
 *
 * `from` is the beat this frame is the END of, which is the whole reason this
 * function exists. The endpoint's rule is that text at an offset STARTS there
 * and an end image at an offset is the exact final frame AT it — so a beat's
 * closing frame is the pin on the NEXT beat's offset, and a slot's brief comes
 * from the beat ABOVE it, never from the beat it is stored on. Getting this
 * backwards pins every picture a beat early, which is expensive and invisible
 * until the film is watched.
 */
export type Slot = {
  offset: number;
  kind: 'opening' | 'pin';
  /** The index in `series.directions` of the beat this frame closes. */
  from: number | null;
  /** That beat's own end sentence: the brief for this frame. */
  brief: string;
  /** Is there a picture here already? */
  filled: boolean;
  /** Why this second cannot be pinned, when it cannot. */
  refused: string | null;
};

/**
 * Every frame this Series could pin, in running order, opening frame first.
 *
 * Offered, not chosen: a sheet longer than sixteen beats cannot pin every beat
 * (`MAX_END_IMAGES`), so which of them to spend a shot on is the author's call
 * and `defaultChoice` only suggests it.
 */
export function slotsOf(series: Pick<Series, 'directions' | 'imageUrl' | 'prompts'>): Slot[] {
  const beats = [...series.directions].sort((a, b) => a.offset - b.offset);
  const sections = series.prompts?.sections;
  const slots: Slot[] = [];

  // The opening frame is not a pin and has no beat above it: the film starts
  // on it, and the beat at 0s runs FORWARD from it. Its brief is therefore
  // that beat's own opening, not its ending.
  const opening = beats.find((beat) => beat.offset === 0) ?? beats[0];
  const openingText = visibleText(opening?.prompt, sections);
  slots.push({
    offset: 0,
    kind: 'opening',
    from: opening ? beats.indexOf(opening) : null,
    brief: sentences(openingText)[0] ?? '',
    filled: Boolean(series.imageUrl),
    refused: null,
  });

  beats.forEach((beat, index) => {
    if (beat.offset === 0) return;
    const above = beats[index - 1];
    slots.push({
      offset: beat.offset,
      kind: 'pin',
      from: above ? index - 1 : null,
      brief: above ? endBrief(visibleText(above.prompt, sections)) : '',
      filled: Boolean(beat.endImageUrl),
      refused:
        beat.offset < MIN_OPENING_END_IMAGE_SECONDS
          ? `a frame cannot be pinned before ${MIN_OPENING_END_IMAGE_SECONDS}s`
          : null,
    });
  });
  return slots;
}

/**
 * Which slots a sheet should draw when nobody has said.
 *
 * The ones that already carry a picture, so a re-render redraws the take that
 * exists. A Series with no art yet gets an even spread across what fits —
 * because the sixteen pins are spent on the cuts that drift, and evenly spread
 * is the honest default when nothing knows which those are.
 */
export function defaultChoice(slots: Slot[], duration = MAX_DURATION_SECONDS): number[] {
  const usable = slots.filter((slot) => !slot.refused);
  // Sixteen pins plus the opening frame, or fewer if the clip is short.
  const room = Math.min(maxShots(duration), MAX_END_IMAGES + 1);
  const filled = usable.filter((slot) => slot.filled);
  return trim(filled.length ? filled : spread(usable, room), room).map((slot) => slot.offset);
}

/**
 * At most `room` shots, of which at most `MAX_END_IMAGES` are pins.
 *
 * The two ceilings are separate, and counting only the first would suggest a
 * sheet the form then refuses: a Series with no reference image and seventeen
 * pinned beats has seventeen FILLED slots and no opening frame among them, so
 * "the first seventeen" is seventeen pins and one too many. A default that
 * cannot be rendered is worse than a short one.
 */
function trim(slots: Slot[], room: number): Slot[] {
  const kept: Slot[] = [];
  let pins = 0;
  for (const slot of slots) {
    if (kept.length >= room) break;
    if (slot.kind === 'pin') {
      if (pins >= MAX_END_IMAGES) continue;
      pins += 1;
    }
    kept.push(slot);
  }
  return kept;
}

/** `count` of these, evenly, always including the first and the last. */
function spread<T>(items: T[], count: number): T[] {
  if (count <= 1) return items.slice(0, Math.max(0, count));
  if (items.length <= count) return items;
  const step = (items.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => items[Math.round(i * step)]);
}

/**
 * What to hand the model as references, and what to tell it they are.
 *
 * Style sheets first — the look governs every shot — then characters and
 * locations in the order the Series lists them, which is the order an author
 * put them in. Capped at the endpoint's nine; a Series with more sheets than
 * that has to choose, and choosing the style plus the cast is the choice that
 * keeps a film looking like itself.
 */
export function referencesOf(series: Pick<Series, 'modelSheets'>): Reference[] {
  const order = { style: 0, character: 1, location: 2 } as const;
  return [...series.modelSheets]
    .filter((sheet) => Boolean(sheet.imageUrl))
    .sort((a, b) => order[a.kind] - order[b.kind])
    .slice(0, MAX_REFERENCE_IMAGES)
    .map((sheet) => ({
      url: sheet.imageUrl as string,
      label: sheet.kind === 'style' ? `the house style — ${sheet.name}` : sheet.name,
    }));
}

/**
 * What to render a sheet at, given what the Series is.
 *
 * The SHAPE is the Series', with no choice offered: a pin is the exact frame
 * the Director continues from, so a 16:9 grab on a vertical Series is a
 * different opening image rather than a crop. The RESOLUTION is the film's own
 * rounded up to what the endpoint offers — there is nothing to gain above the
 * resolution the film renders at, and a still is cut from this video rather
 * than delivered from it.
 */
export function renderSettings(
  series: Pick<Series, 'aspectRatio' | 'resolution'>,
): { aspectRatio: AspectRatio; resolution: SheetResolution } {
  return {
    aspectRatio: series.aspectRatio,
    resolution: series.resolution === '1080p' ? '1080P' : '768P',
  };
}

/** The sheet a Series and a choice of slots amount to. */
export function sheetFrom(
  series: Pick<Series, 'prompt' | 'directions' | 'imageUrl' | 'modelSheets' | 'aspectRatio' | 'resolution' | 'prompts'>,
  chosen: number[],
  duration = MAX_DURATION_SECONDS,
): Sheet {
  const wanted = new Set(chosen);
  return {
    premise: series.prompt,
    references: referencesOf(series),
    clause: series.prompts?.shotSheet?.trim() || HOUSE_CLAUSE,
    shots: slotsOf(series)
      .filter((slot) => wanted.has(slot.offset) && !slot.refused)
      .map((slot) => ({ offset: slot.offset, kind: slot.kind, text: slot.brief })),
    duration,
    ...renderSettings(series),
  };
}
