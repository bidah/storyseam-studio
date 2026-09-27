// VENDORED from src/lib/film-plan.ts — DO NOT EDIT HERE.
// Edit the canonical file, then run `npm run series:sync`
// (scripts/sync-series.mjs).

import {
  MAX_DIRECTIONS,
  MAX_END_IMAGES,
  MIN_END_IMAGE_GAP_SECONDS,
  MIN_OPENING_END_IMAGE_SECONDS,
} from './series';
import { USD_PER_MINUTE as SCORE_USD_PER_MINUTE } from './music-plan';

// THE FILM PLAN — what a prompt amounts to before anything is paid for: how
// long the Film is, how many beats and pins that is, how many reels it takes,
// and roughly what it will cost.
//
// A Film is 2:00–5:00 in 30s steps (CONTEXT.md, "Film"). No length stated means
// 2:00; a stated length rounds UP to the next step, so "3:10" is 3:30 and
// "90 seconds" is 2:00; anything past 5:00 is capped there, and the cap is
// REPORTED — an author who asked for ten minutes should be told they are
// getting five, not find out by watching.
//
// Pure, and vendored by `npm run series:sync` into the Worker and the agent:
// the confirm card shows the same plan the job runs and the chat quotes.
//
// The reel count here is an ESTIMATE on an even ~4s pin grid (wider when 4s
// would pass the Series' 64-beat ceiling — see `beatSpacing`), made against the
// same per-reel ceilings the Series enforces (16 pins, first ≥5s in, ≥3s
// apart; a seam drops its opening beat's pin and any pin <5s after it — ADR
// 0002). The Reel planner is what cuts the real cue sheet; this is what the
// author is quoted before there is one.

/** The Film's length steps (CONTEXT.md). */
export const FILM_MIN_SECONDS = 120;
export const FILM_MAX_SECONDS = 300;
export const FILM_STEP_SECONDS = 30;
export const FILM_DEFAULT_SECONDS = FILM_MIN_SECONDS;
/** Every length a Film can be: 120, 150, … 300. */
export const FILM_STEPS: readonly number[] = Array.from(
  { length: (FILM_MAX_SECONDS - FILM_MIN_SECONDS) / FILM_STEP_SECONDS + 1 },
  (_, i) => FILM_MIN_SECONDS + i * FILM_STEP_SECONDS,
);

/** "Pinned about every 4s" — one beat, closing on one pin, per this many seconds. */
export const PIN_INTERVAL_SECONDS = 4;

/**
 * The beat spacing a Film of this length is actually cut at: every 4s, unless
 * that would put more beats on the cue sheet than a Series takes
 * (`MAX_DIRECTIONS`, 64 — a whole-sheet ceiling, not a per-reel one). Then the
 * grid widens to the smallest whole second that fits: 4:30 and 5:00 are cut
 * every 5s, 54 and 60 beats. The plan and the Auto job's cue sheet both read this, so the beat
 * count the author was quoted is the one the Series gets.
 */
export function beatSpacing(seconds: number): number {
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  return Math.max(PIN_INTERVAL_SECONDS, Math.ceil(s / MAX_DIRECTIONS));
}
/** A plan needing more seams than this is refused (PRD #59, Reel planner). */
export const MAX_SEAMS = 4;
/** How far one seam may move the film: up to one Director chunk (ADR 0002). */
export const SEAM_DRIFT_SECONDS = 15;
/** A Sitting is billed at least this much from `configure`. */
export const SITTING_MIN_BILLED_SECONDS = 60;
/** A shot sheet clip: each frame held this long, and at most this long a clip. */
export const CLIP_SHOT_SECONDS = 0.8;
export const CLIP_MIN_SECONDS = 5;
export const CLIP_MAX_SECONDS = 15;
/** Reference images per run: fal's ceiling, and the default the quote assumes. */
export const MAX_REFERENCE_SHEETS = 9;
export const DEFAULT_REFERENCE_SHEETS = 6;

/**
 * EVERY RATE THE ESTIMATE USES, IN ONE PLACE.
 *
 * PLACEHOLDER ESTIMATES in USD — not prices anyone has quoted us, except the
 * score, which is fal's own per-minute price for the music model (imported
 * from `music-plan.ts` so it can't drift). Replace them here when the real
 * spend per stage has been recorded (PRD #59, story 28); nothing else in this
 * file names a price.
 */
export const FILM_RATES_USD = {
  /** One reference / model sheet in an image model. ESTIMATE. */
  referenceSheet: 0.08,
  /** One second of shot sheet clip (h3-max, reference-to-video). ESTIMATE. */
  clipSecond: 0.05,
  /** One billed second of a Director Sitting. ESTIMATE. */
  sittingSecond: 0.02,
  /** One minute of score, rounded up per render (fal's price). */
  scoreMinute: SCORE_USD_PER_MINUTE,
  /** One minute of Daytona sandbox (cut stills, the Sitting runner, the mix). ESTIMATE. */
  sandboxMinute: 0.01,
} as const;

/** Sandbox minutes the job spends outside the Sitting itself (cutting + mixing + boot). ESTIMATE. */
export const SANDBOX_OVERHEAD_MINUTES = 8;

export type StageEstimate = {
  /** How many of `unit` this stage spends. */
  units: number;
  unit: 'sheet' | 'clip second' | 'sitting second' | 'score minute' | 'sandbox minute';
  /** USD per unit, from `FILM_RATES_USD`. */
  rate: number;
  usd: number;
};

export type FilmEstimate = {
  currency: 'USD';
  perStage: {
    referenceSheets: StageEstimate;
    clips: StageEstimate;
    sitting: StageEstimate;
    score: StageEstimate;
    sandbox: StageEstimate;
  };
  total: number;
};

export type FilmPlan = {
  /** The Film's length: one of `FILM_STEPS`. */
  seconds: number;
  /** "2:00" … "5:00". */
  length: string;
  /** What was asked for, in seconds, or null when nothing was stated. */
  requestedSeconds: number | null;
  /** True when the request was longer than 5:00 and was cut down to it. */
  capped: boolean;
  /** Beats on the cue sheet, one per `spacing` seconds (the last may be shorter). ≤ 64. */
  beats: number;
  /** Seconds between beats: 4, or wider when 4 would pass the 64-beat ceiling. */
  spacing: number;
  /** Pins actually drawn and pinned, after the reel rules take theirs. */
  pins: number;
  /** Frames on the 4s grid the reel rules make unpinnable — never drawn. */
  skippedFrames: number;
  reels: number;
  seams: number;
  /** One clip per reel. */
  clips: number;
  estimate: FilmEstimate;
};

export type FilmPlanInput = {
  prompt?: string | null;
  /** An explicit length; wins over anything the prompt says. */
  seconds?: number | null;
  /** How many reference sheets the run will make (default 6, at most 9). */
  referenceSheets?: number | null;
};

// ── Length parsing ────────────────────────────────────────────────────────

const SMALL: Record<string, number> = {
  zero: 0, a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
};
const ONES = 'one|two|three|four|five|six|seven|eight|nine';
const byLength = (words: string[]) => [...words].sort((a, b) => b.length - a.length).join('|');
const NUM =
  `(?:\\d+(?:\\.\\d+)?|(?:${byLength(Object.keys(TENS))})(?:[- ](?:${ONES}))?|` +
  `${byLength(Object.keys(SMALL))})`;
const HOUR = 'h(?:ou)?rs?';
const MIN = 'min(?:ute)?s?';
const SEC = 'sec(?:ond)?s?';
const HALF = '\\s+and\\s+a\\s+half';

/** "3 minutes 30 seconds", "two and a half minutes", "a minute and a half", "90 sec". */
const SPOKEN = new RegExp(
  `\\b(${NUM})(${HALF})?[\\s-]*(${HOUR}|${MIN}|${SEC})\\b(${HALF})?` +
    `(?:,?\\s*(?:and\\s+)?(${NUM})[\\s-]*(?:${SEC})\\b)?`,
  'i',
);
/** "half a minute", "half-minute". */
const HALF_UNIT = new RegExp(`\\bhalf(?:[\\s-]+an?)?[\\s-]+(${HOUR}|${MIN})\\b`, 'i');
/** "3:10" — but not a time of day ("3:30 pm") or an aspect ratio ("9:16"). */
const CLOCK = /\b(\d{1,2}):([0-5]\d)\b(?!\s*[ap]\.?m\b)/gi;
const ASPECT_RATIOS = new Set(['9:16', '16:10', '10:16', '21:09', '09:16']);

function numberValue(text: string): number {
  const t = text.toLowerCase();
  if (/^\d/.test(t)) return Number(t);
  return t.split(/[- ]/).reduce((sum, word) => sum + (TENS[word] ?? SMALL[word] ?? 0), 0);
}

function unitSeconds(unit: string): number {
  const u = unit.toLowerCase();
  if (u.startsWith('h')) return 3600;
  if (u.startsWith('m')) return 60;
  return 1;
}

/**
 * The length a prompt asks for, in seconds, or null when it states none.
 * When several are stated, the first one wins.
 */
export function parseLength(prompt: string | null | undefined): number | null {
  if (!prompt) return null;
  const found: Array<{ index: number; seconds: number }> = [];

  const spoken = SPOKEN.exec(prompt);
  if (spoken) {
    const [, num, halfBefore, unit, halfAfter, extraSeconds] = spoken;
    const per = unitSeconds(unit);
    let seconds = numberValue(num) * per;
    if (halfBefore || halfAfter) seconds += per / 2;
    if (extraSeconds) seconds += numberValue(extraSeconds);
    found.push({ index: spoken.index, seconds });
  }
  const half = HALF_UNIT.exec(prompt);
  if (half) found.push({ index: half.index, seconds: unitSeconds(half[1]) / 2 });
  for (const clock of prompt.matchAll(CLOCK)) {
    if (ASPECT_RATIOS.has(clock[0])) continue;
    found.push({ index: clock.index ?? 0, seconds: Number(clock[1]) * 60 + Number(clock[2]) });
    break;
  }

  const first = found.filter((f) => f.seconds > 0).sort((a, b) => a.index - b.index)[0];
  return first ? first.seconds : null;
}

/** 150 → "2:30". */
export function formatLength(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Any requested length → the Film length it becomes, and whether it was capped. */
export function filmLength(requested: number | null | undefined): { seconds: number; capped: boolean } {
  if (requested == null || !Number.isFinite(requested) || requested <= 0) {
    return { seconds: FILM_DEFAULT_SECONDS, capped: false };
  }
  const stepped = Math.ceil(requested / FILM_STEP_SECONDS) * FILM_STEP_SECONDS;
  return {
    seconds: Math.min(FILM_MAX_SECONDS, Math.max(FILM_MIN_SECONDS, stepped)),
    capped: requested > FILM_MAX_SECONDS,
  };
}

// ── Reels on an even pin grid ─────────────────────────────────────────────

/**
 * Lay pins every `spacing` seconds (default: `beatSpacing(seconds)`) and cut
 * reels greedily under the per-reel rules: a reel closes at 16 pins; the next
 * opens on the following grid beat (a seam), whose pin is dropped along with
 * any pin < 5s after it.
 *
 * A pin sits where a BEAT starts — the cue sheet's beats open at 0, spacing,
 * 2·spacing … and the last one opens before the Film's end. So the grid stops
 * short of `seconds`: the Film's very last second closes the last beat, it
 * does not open one, and quoting a pin there promised one more frame than the
 * run ever draws (#67 found it; #71 fixed it).
 */
export function reelsOnGrid(seconds: number, spacing: number = beatSpacing(seconds)): {
  pins: number;
  skippedFrames: number;
  reels: number;
  seams: number;
  pinsPerReel: number[];
} {
  const pinsPerReel: number[] = [0];
  let reelStart = 0;
  let lastPin = -Infinity;
  let skipped = 0;
  for (let t = spacing; t < seconds; t += spacing) {
    const current = pinsPerReel.length - 1;
    if (pinsPerReel[current] >= MAX_END_IMAGES) {
      // Seam: this beat opens the next reel and loses its pin.
      pinsPerReel.push(0);
      reelStart = t;
      skipped += 1;
      continue;
    }
    if (t - reelStart < MIN_OPENING_END_IMAGE_SECONDS || t - lastPin < MIN_END_IMAGE_GAP_SECONDS) {
      skipped += 1;
      continue;
    }
    pinsPerReel[current] += 1;
    lastPin = t;
  }
  // A seam whose reel would hold no pin (the film ends inside its opening 5s)
  // is not a reel at all: those last beats simply close on no pin.
  if (pinsPerReel.length > 1 && pinsPerReel[pinsPerReel.length - 1] === 0) pinsPerReel.pop();
  const pins = pinsPerReel.reduce((a, b) => a + b, 0);
  return { pins, skippedFrames: skipped, reels: pinsPerReel.length, seams: pinsPerReel.length - 1, pinsPerReel };
}

// ── Cost ──────────────────────────────────────────────────────────────────

const cents = (usd: number) => Math.round(usd * 100) / 100;

function stage(units: number, unit: StageEstimate['unit'], rate: number): StageEstimate {
  return { units, unit, rate, usd: cents(units * rate) };
}

/** Clip seconds for one reel's pins: 0.8s a frame, within fal's 5–15s. */
export function clipSeconds(pins: number): number {
  return Math.min(CLIP_MAX_SECONDS, Math.max(CLIP_MIN_SECONDS, Math.ceil(pins * CLIP_SHOT_SECONDS)));
}

export function estimateFilm(args: {
  seconds: number;
  seams: number;
  pinsPerReel: number[];
  referenceSheets: number;
}): FilmEstimate {
  const R = FILM_RATES_USD;
  // Budget the worst case: every seam may push the film on by up to a chunk,
  // and the score is written to the kept film's measured length, not the plan.
  const sittingSeconds = Math.max(SITTING_MIN_BILLED_SECONDS, args.seconds + args.seams * SEAM_DRIFT_SECONDS);
  const scoreMinutes = Math.ceil(sittingSeconds / 60);
  const sandboxMinutes = Math.ceil(sittingSeconds / 60) + SANDBOX_OVERHEAD_MINUTES;
  const clipTotal = args.pinsPerReel.reduce((sum, pins) => sum + clipSeconds(pins), 0);

  const perStage = {
    referenceSheets: stage(args.referenceSheets, 'sheet', R.referenceSheet),
    clips: stage(clipTotal, 'clip second', R.clipSecond),
    sitting: stage(sittingSeconds, 'sitting second', R.sittingSecond),
    score: stage(scoreMinutes, 'score minute', R.scoreMinute),
    sandbox: stage(sandboxMinutes, 'sandbox minute', R.sandboxMinute),
  };
  const total = cents(Object.values(perStage).reduce((sum, s) => sum + s.usd, 0));
  return { currency: 'USD', perStage, total };
}

// ── The plan ──────────────────────────────────────────────────────────────

/** A prompt (and optionally an explicit length) → the Film it will make. */
export function planFilm(input: FilmPlanInput = {}): FilmPlan {
  const explicit =
    typeof input.seconds === 'number' && Number.isFinite(input.seconds) && input.seconds > 0
      ? input.seconds
      : null;
  const requestedSeconds = explicit ?? parseLength(input.prompt);
  const { seconds, capped } = filmLength(requestedSeconds);
  const spacing = beatSpacing(seconds);
  const grid = reelsOnGrid(seconds, spacing);
  const referenceSheets = Math.min(
    MAX_REFERENCE_SHEETS,
    Math.max(1, Math.round(input.referenceSheets ?? DEFAULT_REFERENCE_SHEETS)),
  );
  return {
    seconds,
    length: formatLength(seconds),
    requestedSeconds,
    capped,
    beats: Math.ceil(seconds / spacing),
    spacing,
    pins: grid.pins,
    skippedFrames: grid.skippedFrames,
    reels: grid.reels,
    seams: grid.seams,
    clips: grid.reels,
    estimate: estimateFilm({ seconds, seams: grid.seams, pinsPerReel: grid.pinsPerReel, referenceSheets }),
  };
}

// ── The Film's LOOK ─────────────────────────────────────────────────────────
//
// A Film used to have the look the art department's model happened to write,
// and a prompt that said "pixar" came back as whatever it invented. So the look
// is CHOSEN — the /director-story gear, make_film's `style` — from a short list
// of house looks written once, each carried verbatim: the style sheet is drawn
// from it, every sheet's render clause names it, and the Series' prompt (what
// the Director opens every sitting with, and what every shot sheet's premise
// is) states it with its lock. Nothing downstream re-describes it.
//
// `anime-80s` is the look the Mecha Launch shot sheet was drawn in (the one
// that came closest); the other three are the studio's own style presets
// (Settings › style presets: preset-3d-pixar, preset-live-action, preset-2d).
//
// When nobody chooses, the Film's first stage (Look) asks a classifier which
// of these the premise is, from each one's `fits` — see film-stages/look.js.
export type FilmStyle = {
  id: string;
  label: string;
  /** What kind of story wears this look — the classifier's criterion for it. */
  fits: string;
  /** The look, as the style sheet and the premise state it. */
  look: string;
  /** What it must never become, stated as a lock. */
  lock: string;
};

export const FILM_STYLES: readonly FilmStyle[] = [
  {
    id: 'anime-80s',
    label: '80s anime',
    fits:
      'Anime or Japanese animation: mecha, robots, pilots, space battles, sci-fi action, cyberpunk, shonen ' +
      'adventure, magical girls, or anything asked for as anime, cel animation or the 80s.',
    look:
      '1980s cel-animated anime OVA. Style: hand-painted cel animation in the spirit of Macross, Gundam and ' +
      'Bubblegum Crisis — flat cel shading with hard shadow shapes, thin ink outlines, gouache-textured painted ' +
      'backgrounds, muted-but-saturated palette, soft airbrushed bloom, subtle film grain and slight VHS colour bleed.',
    lock:
      '[LOOK LOCK] This piece is ANIMATION, drawn by hand, in every shot and at every second. It is never live ' +
      'action, never photographic, never 3D CGI, and it never becomes any of those part way through. If a shot ' +
      'could be mistaken for live-action footage, it is wrong: draw it as a cel.',
  },
  {
    id: 'pixar',
    label: '3D Pixar',
    fits:
      'A 3D animated family film in the Pixar / DreamWorks tradition: kids, toys, talking animals, pets, ' +
      'whimsical comedy adventures, heartfelt family stories, or anything asked for as Pixar, 3D or CGI.',
    look:
      'Stylized 3D CG animation in the Pixar / DreamWorks tradition: appealing rounded character design with ' +
      'expressive faces and clean silhouettes, soft global illumination with a warm motivated key light and gentle ' +
      'fill, subsurface scattering on skin, physically-based materials, believable cloth and hair, a rich but ' +
      'controlled cinematic colour palette, shallow depth of field with soft bokeh, a polished high-quality render. ' +
      'Motion with real weight, anticipation and follow-through.',
    lock:
      '[LOOK LOCK] This piece is 3D CG ANIMATION, in every shot and at every second. It is never flat 2D, never ' +
      'hand-drawn linework, never photoreal live action, never uncanny realism, and it never becomes any of those ' +
      'part way through. No morphing, no warping, no jitter.',
  },
  {
    id: 'live-action',
    label: 'Live action',
    fits:
      'Live action with real people: realistic drama, thriller, crime, romance, documentary-style or grounded ' +
      'stories, historical pieces, or anything asked for as live action, cinematic, realistic or photoreal.',
    look:
      'Photorealistic live-action cinematography shot on a full-frame cinema camera with a fast prime lens, natural ' +
      'motivated lighting, soft shallow depth of field with gentle bokeh, a filmic colour grade with true-to-life skin ' +
      'tones, subtle film grain, realistic skin texture and fabric detail, natural human proportions, grounded practical ' +
      'locations, strong cinematic composition. Naturalistic motion with controlled camera work and realistic motion blur.',
    lock:
      '[LOOK LOCK] This piece is LIVE ACTION, photographed, in every shot and at every second. It is never an ' +
      'illustration, never a cartoon, never flat 2D shading, never a 3D-render or CGI plastic look, and it never ' +
      'becomes any of those part way through. No morphing, no warping, no unnatural speed-ramping.',
  },
  {
    id: '2d-folklore',
    label: '2D folklore',
    fits:
      'A 2D hand-drawn storybook tale: folklore, fairy tales, fables, myths, forest spirits, quiet or melancholic ' +
      'journeys, bedtime stories, or anything asked for as 2D, hand-drawn, storybook or illustrated.',
    look:
      'Flat 2D hand-drawn animation, clean confident vector linework, a strictly limited muted palette of teal, mustard ' +
      'yellow and dusty rose, gouache-textured flat painterly backgrounds with subtle paper grain, Scandinavian folklore ' +
      'storybook illustration style, soft diffused light, flat ambient shading with no gradients, minimalist rounded ' +
      'character design with simple sparse facial features, strong graphic composition with generous negative space. ' +
      'Cozy, adventurous, slightly melancholic atmosphere. Slow gentle camera with layered parallax, no orbiting.',
    lock:
      '[LOOK LOCK] This piece is FLAT 2D ANIMATION, hand-drawn, in every shot and at every second. It is never 3D ' +
      'rendering, never photorealism, never CGI shading or volumetric depth, and it never becomes any of those part ' +
      'way through.',
  },
];

export const FILM_STYLE_IDS: readonly string[] = FILM_STYLES.map((s) => s.id);
export const DEFAULT_FILM_STYLE = 'anime-80s';

/**
 * The Film's look without a classifier: the one CHOSEN, else the one the
 * prompt names outright ("a pixar like story", "80s anime"), else the default.
 * The Look stage's fallback when the classifier cannot answer. Never null.
 */
export function filmStyleFor({ style, prompt }: { style?: string | null; prompt?: string | null }): FilmStyle {
  const chosen = FILM_STYLES.find((s) => s.id === style);
  if (chosen) return chosen;
  const text = String(prompt || '').toLowerCase();
  if (/\bpixar\b|dreamworks|\b3d\b|\bcgi?\b/.test(text)) return FILM_STYLES.find((s) => s.id === 'pixar')!;
  if (/live[- ]action|photoreal|realistic\b/.test(text)) return FILM_STYLES.find((s) => s.id === 'live-action')!;
  if (/\b2d\b|folklore|fairy ?tale|storybook|hand[- ]drawn/.test(text)) return FILM_STYLES.find((s) => s.id === '2d-folklore')!;
  if (/\banime\b|\b(19)?80s\b|\bcel\b|macross|gundam/.test(text)) return FILM_STYLES.find((s) => s.id === 'anime-80s')!;
  return FILM_STYLES.find((s) => s.id === DEFAULT_FILM_STYLE)!;
}

// ── The STORY FLOW — the same one-prompt Film on Seedance 2.5 ────────────────
//
// /director-story makes a Film with the live Director: a cue sheet pinned with
// a drawn frame every ~4s, played as one Sitting, scored afterwards.
// /story-flow makes one from the same prompt on a different MODEL, and so with a
// different recipe (the ROUTE is what selects it — `engine` on the job):
//
//   Look → Idea + World → character & location sheets → a shot list of
//   SEGMENTS (one Seedance generation each, up to 15s, written as staged
//   narrative — no pinned frame every few seconds) → the segment prompts (the
//   reference map: which sheet is @Image1, @Image2 … for THIS segment) →
//   the video run (segment 1 from the sheets alone; every later one a
//   Seedance `extension` of a cut of the previous segment's last seconds,
//   plus its sheets) → the final cut (the segments joined into one film).
//
// Everything is rendered at 480p: Seedance 2.5 bills per output pixel-second.
// Seedance writes the sound itself (dialogue, ambience, effects), so there is no
// separate score. And a story can be ONE MINUTE — the cheap way to test one.

// ── The writer: which LLM writes a Film ─────────────────────────────────────
//
// Every writing step of a Film — the Idea and World, the sheet prompts, the
// Shot list, the Cue sheet and the score's music cues — goes through ONE model,
// and the author picks it with the prompt. `default` is the studio's own writer
// (the Worker's AUTO_WRITER — fast and cheap); `claude` is Claude Fable 5.1
// through AI Gateway's Unified Billing (no Anthropic key). The Look stage is a
// classifier, not a writer, and is not affected.
export type FilmWriter = 'default' | 'claude';
export const FILM_WRITERS: readonly { id: FilmWriter; label: string; blurb: string }[] = [
  { id: 'default', label: 'Studio', blurb: "the studio's default writer — quick and cheap" },
  { id: 'claude', label: 'Claude Fable 5.1', blurb: 'slower, stronger writing' },
];
export const FILM_WRITER_IDS: readonly string[] = FILM_WRITERS.map((w) => w.id);
export const DEFAULT_FILM_WRITER: FilmWriter = 'default';

// ── The depth: how much STORY work a Film gets before anything is drawn ─────
//
// Every Film is written from a SCREENPLAY now (the Script stage, right after
// the World): one screenwriter prompt carrying the core specialists' rules,
// saved as the project's pinned draft, which the Shot list is then cut from.
// That is `fast`. `deep` adds the WRITERS' ROOM stage after it: the chosen
// specialists (src/lib/specialists.ts — the same fifteen the chat delegates to)
// each read the draft and hand back findings, then one rewrite applies the
// room's notes as a second draft. The room is unpaid (LLM only) but slow — one
// pass per specialist — so the picker quotes its time from the selection.
export type FilmDepth = 'fast' | 'deep';
export const FILM_DEPTHS: readonly { id: FilmDepth; label: string; blurb: string }[] = [
  { id: 'fast', label: 'Fast', blurb: 'one screenwriter writes the script, then it is shot' },
  { id: 'deep', label: 'Deep', blurb: 'the specialists read the script and it is rewritten on their notes' },
];
export const FILM_DEPTH_IDS: readonly string[] = FILM_DEPTHS.map((d) => d.id);
export const DEFAULT_FILM_DEPTH: FilmDepth = 'fast';
/** The room a Deep Film opens with when nobody picks: the arc first, then the three passes that move a first draft most. */
export const DEFAULT_DEEP_SPECIALISTS: readonly string[] = ['story_architect', 'scene_doctor', 'motivation_doctor', 'dialogue_doctor'];
/** How long each part of the story work takes, in seconds. ESTIMATES against the default writer. */
export const SCRIPT_WRITE_SECONDS = 75;
export const ROOM_PASS_SECONDS = 45;
export const ROOM_REWRITE_SECONDS = 90;

/** What a room of `specialists` costs in wall-clock: its passes plus the one rewrite. */
export function roomEstimate(specialists: readonly string[]): { passes: number; seconds: number; label: string } {
  const passes = new Set(specialists.filter((s) => typeof s === 'string' && s)).size;
  const seconds = passes ? passes * ROOM_PASS_SECONDS + ROOM_REWRITE_SECONDS : 0;
  const minutes = Math.max(1, Math.round(seconds / 60));
  return { passes, seconds, label: passes ? `≈ ${minutes} min` : '—' };
}

export type FilmEngine = 'director' | 'seedance';
export const FILM_ENGINES: readonly FilmEngine[] = ['director', 'seedance'];
export const DEFAULT_FILM_ENGINE: FilmEngine = 'director';

/** fal's Seedance 2.5 endpoint every segment goes to (reference / extension). */
export const SEEDANCE_ENDPOINT = 'bytedance/seedance-2.5/reference-to-video';
export const SEEDANCE_RESOLUTION = '480p';
export const SEEDANCE_ASPECT_RATIO = '16:9';
/** A story-flow Film is 1:00, then the Film's usual 2:00–5:00 in 30s steps. */
export const STORY_FLOW_MIN_SECONDS = 60;
export const STORY_FLOW_DEFAULT_SECONDS = 60;
export const STORY_FLOW_STEPS: readonly number[] = [STORY_FLOW_MIN_SECONDS, ...FILM_STEPS];
/** One Seedance generation: fal takes 4–30s; past ~15s a take drifts, so a segment is at most 15. */
export const SEGMENT_MIN_SECONDS = 4;
export const SEGMENT_MAX_SECONDS = 15;
/**
 * How much of the previous segment an extension is handed (@Video1): its LAST
 * seconds. fal takes 1.8s at least; three carry the motion and the framing,
 * and every input second is billed, so no more.
 */
export const EXTENSION_TAIL_SECONDS = 3;
/** Sheets a story-flow Film draws (style anchor included). fal takes 30 images a generation. */
export const MAX_STORY_FLOW_SHEETS = 12;

/**
 * Seedance 2.5 on fal at 480p, per OUTPUT second (fal's model page, Sept 2026:
 * tokens = h × w × (input + output seconds) × 24 / 1024 at $0.0214 per 1k).
 * With a video reference the rate drops ×0.6 but the INPUT video's seconds are
 * billed too — so an extension costs (tail + segment) × the video rate.
 */
export const STORY_FLOW_RATES_USD = {
  referenceSheet: FILM_RATES_USD.referenceSheet,
  seedanceSecond: 0.221,
  seedanceVideoRefSecond: 0.132,
  sandboxMinute: FILM_RATES_USD.sandboxMinute,
} as const;

export const filmStepsFor = (engine?: string | null): readonly number[] =>
  engine === 'seedance' ? STORY_FLOW_STEPS : FILM_STEPS;
export const filmDefaultSecondsFor = (engine?: string | null): number =>
  engine === 'seedance' ? STORY_FLOW_DEFAULT_SECONDS : FILM_DEFAULT_SECONDS;

/** A requested length → the story-flow length (next step up, capped at 5:00). */
export function storyFlowLength(requested: number | null | undefined): { seconds: number; capped: boolean } {
  if (requested == null || !Number.isFinite(requested) || requested <= 0) {
    return { seconds: STORY_FLOW_DEFAULT_SECONDS, capped: false };
  }
  const step = STORY_FLOW_STEPS.find((s) => s >= requested);
  return { seconds: step ?? FILM_MAX_SECONDS, capped: requested > FILM_MAX_SECONDS };
}

/**
 * The Film cut into Seedance generations: as few as fit under 15s each, as
 * even as whole seconds allow, longest first. 60 → [15, 15, 15, 15].
 */
export function segmentDurations(seconds: number): number[] {
  const total = Math.max(SEGMENT_MIN_SECONDS, Math.round(Number(seconds) || 0));
  const n = Math.ceil(total / SEGMENT_MAX_SECONDS);
  const base = Math.floor(total / n);
  const extra = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

export type StoryFlowPlan = {
  engine: 'seedance';
  seconds: number;
  length: string;
  requestedSeconds: number | null;
  capped: boolean;
  resolution: string;
  segments: number;
  durations: number[];
  sheets: number;
  estimate: {
    currency: 'USD';
    perStage: { referenceSheets: StageEstimate; video: StageEstimate; sandbox: StageEstimate };
    total: number;
  };
};

/** A prompt (and optionally an explicit length) → the story-flow Film it will make. */
export function planStoryFlow(input: FilmPlanInput = {}): StoryFlowPlan {
  const explicit =
    typeof input.seconds === 'number' && Number.isFinite(input.seconds) && input.seconds > 0 ? input.seconds : null;
  const requestedSeconds = explicit ?? parseLength(input.prompt);
  const { seconds, capped } = storyFlowLength(requestedSeconds);
  const durations = segmentDurations(seconds);
  const sheets = Math.min(MAX_STORY_FLOW_SHEETS, Math.max(1, Math.round(input.referenceSheets ?? DEFAULT_REFERENCE_SHEETS)));
  const R = STORY_FLOW_RATES_USD;
  const videoUsd = durations.reduce(
    (sum, d, i) => sum + (i === 0 ? d * R.seedanceSecond : (d + EXTENSION_TAIL_SECONDS) * R.seedanceVideoRefSecond),
    0,
  );
  const video: StageEstimate = { units: seconds, unit: 'clip second', rate: R.seedanceSecond, usd: cents(videoUsd) };
  // One box job per segment (fetch + cut) and one for the final cut.
  const sandbox = stage(durations.length + 2, 'sandbox minute', R.sandboxMinute);
  const referenceSheets = stage(sheets, 'sheet', R.referenceSheet);
  const total = cents(video.usd + sandbox.usd + referenceSheets.usd);
  return {
    engine: 'seedance',
    seconds,
    length: formatLength(seconds),
    requestedSeconds,
    capped,
    resolution: SEEDANCE_RESOLUTION,
    segments: durations.length,
    durations,
    sheets,
    estimate: { currency: 'USD', perStage: { referenceSheets, video, sandbox }, total },
  };
}
