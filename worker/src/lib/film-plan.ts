// VENDORED from src/lib/film-plan.ts — DO NOT EDIT HERE.
// Edit the canonical file, then run `npm run series:sync`
// (scripts/sync-series.mjs).

import {
  MAX_DIRECTIONS,
  MAX_END_IMAGES,
  MIN_END_IMAGE_GAP_SECONDS,
  MIN_OPENING_END_IMAGE_SECONDS,
} from './series';
import { USD_PER_MINUTE as SCORE_USD_PER_MINUTE, MINIMAX_USD_PER_SECOND, type MusicModel } from './music-plan';
import { SPECIALIST_BY_ID } from './specialists';

// THE FILM PLAN — what a prompt amounts to before anything is paid for: how
// long the Film is, how many beats and pins that is, how many reels it takes,
// and roughly what it will cost.
//
// A Film is 0:30–5:00 in 30s steps (CONTEXT.md, "Film"). No length stated means
// 2:00 — the shorter steps are for shorter stories, not the default; a stated
// length rounds UP to the next step, so "3:10" is 3:30 and "45 seconds" is
// 1:00; anything past 5:00 is capped there, and the cap is
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
export const FILM_MIN_SECONDS = 30;
export const FILM_MAX_SECONDS = 300;
export const FILM_STEP_SECONDS = 30;
export const FILM_DEFAULT_SECONDS = 120;
/** Every length a Film can be: 30, 60, 90, 120, … 300. */
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
  /**
   * One reference / model sheet (fal, GPT Image 2.5 Flare at high quality:
   * $0.04 a 1920×1080 text-to-image; an /edit against other sheets also bills
   * its input images, so this budgets the dearer one). ESTIMATE.
   */
  referenceSheet: 0.08,
  /** One second of shot sheet clip (fal, minimax/h3-max/reference-to-video: $0.05/s at 480p). */
  clipSecond: 0.05,
  /**
   * One billed second of a Director Sitting (fal, minimax/h3-max/director: $0.08
   * a second of video at list price — the $0.02 launch promo ended Sep 14 2026;
   * 1080p is 2×, which a Film never opens at).
   */
  sittingSecond: 0.08,
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
  unit: 'sheet' | 'voice' | 'clip second' | 'sitting second' | 'score minute' | 'score second' | 'sandbox minute';
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
  /** What the Series is opened at — the sitting streams at it. */
  resolution: FilmResolution;
  estimate: FilmEstimate;
};

export type FilmPlanInput = {
  prompt?: string | null;
  /** An explicit length; wins over anything the prompt says. */
  seconds?: number | null;
  /** What the video renders at (FILM_RESOLUTIONS); absent is 480p. */
  resolution?: string | null;
  /** How many reference sheets the run will make (default 6, at most 9). */
  referenceSheets?: number | null;
  /** Whether the Score stage runs (a continuous cue under the finished film); absent is on. */
  score?: boolean | null;
  /** The model the score renders on (FILM_MUSIC); absent is the default, MiniMax Music 3. */
  music?: string | null;
  /** The Voices pass (FILM_VOICES) a story engine runs; absent or unknown is none (a Film from before). */
  voices?: string | null;
  /** How many characters get a voice — the World's cast; used with `voices`. */
  characters?: number | null;
};

// ── The score: every engine's last stage, unless switched off ───────────────
//
// Every Film ends with the Score stage (film-stages/score.js): the finished
// film measured, one continuous cue written and rendered to it, laid under
// the picture. The video models are told NO MUSIC and NO SUBTITLES in every
// prompt so the score never fights music they baked in. The input's Score
// switch turns it off (`score: false` on the job); absent is on.
export const DEFAULT_FILM_SCORE = true;
export const filmScoreOf = (score?: boolean | null): boolean => score !== false;

// The model the score is rendered on. MiniMax Music 3 is billed per second of
// music; ElevenLabs Music per STARTED minute of every piece, so a score cut
// into three short pieces paid for three minutes. A NEW Film names its model
// (MiniMax unless the author picks ElevenLabs); a job stored before the choice
// existed has none and keeps ElevenLabs, which is what it was scored on.
export const FILM_MUSIC: readonly { id: MusicModel; label: string; blurb: string }[] = [
  { id: 'minimax', label: 'MiniMax Music 3', blurb: 'billed per second of music — about $0.12 a minute' },
  { id: 'elevenlabs', label: 'ElevenLabs Music', blurb: 'billed per started minute of every piece — $0.60 each' },
];
export const FILM_MUSIC_IDS: readonly string[] = FILM_MUSIC.map((x) => x.id);
export const DEFAULT_FILM_MUSIC: MusicModel = 'minimax';
/** A job's stored `music` → the model its score renders on (absent: a job from before, ElevenLabs). */
export const filmMusicOf = (music?: string | null): MusicModel =>
  FILM_MUSIC_IDS.includes(music as MusicModel) ? (music as MusicModel) : 'elevenlabs';
/** The model a NEW Film's score renders on: the one asked for, or the default. */
export const newFilmMusic = (music?: string | null): MusicModel =>
  FILM_MUSIC_IDS.includes(music as MusicModel) ? (music as MusicModel) : DEFAULT_FILM_MUSIC;

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
  score?: boolean | null;
  music?: string | null;
}): FilmEstimate {
  const R = FILM_RATES_USD;
  // Budget the worst case: every seam may push the film on by up to a chunk,
  // and the score is written to the kept film's measured length, not the plan.
  const sittingSeconds = Math.max(SITTING_MIN_BILLED_SECONDS, args.seconds + args.seams * SEAM_DRIFT_SECONDS);
  const sandboxMinutes = Math.ceil(sittingSeconds / 60) + SANDBOX_OVERHEAD_MINUTES;
  const clipTotal = args.pinsPerReel.reduce((sum, pins) => sum + clipSeconds(pins), 0);

  const perStage = {
    referenceSheets: stage(args.referenceSheets, 'sheet', R.referenceSheet),
    clips: stage(clipTotal, 'clip second', R.clipSecond),
    sitting: stage(sittingSeconds, 'sitting second', R.sittingSecond),
    score: scoreEstimate(sittingSeconds, args.score, args.music),
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
    // The sitting's rate is quoted per second whatever the resolution: the
    // Director's price at 720p is not published separately. ESTIMATE.
    resolution: filmResolutionOf(input.resolution),
    estimate: estimateFilm({ seconds, seams: grid.seams, pinsPerReel: grid.pinsPerReel, referenceSheets, score: input.score, music: input.music }),
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
//   SEGMENTS (one Seedance generation each, up to 30s, written as staged
//   narrative — no pinned frame every few seconds) → the segment prompts (the
//   reference map: which sheet is @Image1, @Image2 … for THIS segment) →
//   the video run (segment 1 from the sheets alone; every later one a
//   Seedance `extension` of a cut of the previous segment's last seconds,
//   plus its sheets) → the final cut (the segments joined into one film).
//
// Everything is rendered at 480p: Seedance 2.5 bills per output pixel-second.
// Seedance writes the sound itself (dialogue, ambience, effects — never music,
// which the prompt forbids), and the Score stage lays the music under the final
// cut afterwards, as for every engine (film-plan.ts › The score). And a story
// can be ONE MINUTE — the cheap way to test one.
//
// ── The H3 FLOW — the same story on MiniMax H3 (`engine: "h3"`) ─────────────
//
// The third engine, and the second that is not live: fal's
// `minimax/h3/reference-to-video`, prompted the story flow's way (the sheets
// go in as reference images, a shot list of ≤15s segments), with three
// differences the recipe has to carry:
//
//   - H3 has no `task: extension`, and a reference VIDEO is a performance it
//     re-enacts (handed segment 3's last 3s as Video 1, segment 4 of
//     film-1fd51691 replayed the fall it ended on). So segment k is handed the
//     LAST FRAME of segment k−1 (a jpeg cut on the box, beside the tail Seedance
//     extends) as one more reference image, and the prompt says to open on it
//     exactly; Video 1 survives only as the fallback for a job in flight whose
//     previous segment was cut before frames were.
//   - H3 takes at most 9 reference images (12 files with the video) and cites
//     them by ORDER — "Image 1, Image 2…", not Seedance's @Image1 — so a
//     segment binds at most four characters (two images each) beside its plate.
//   - Its prompt is written to a different skill (film-stages/h3/h3-skill.js,
//     vendored from promptsama): the same staged content from the writer,
//     compiled in H3's production order ([REFERENCE USE] → [IDENTITY /
//     CONTINUITY LOCKS] → [SCENE] → [DIALOGUE] → [SHOT LIST] → … → [NEGATIVES]).
//
// Like Seedance, H3 writes the sound itself (dialogue, room tone, effects);
// the Score stage lays the music under it afterwards, as for every engine
// (film-plan.ts › The score). 480p and 720p map onto H3's 480P and 768P (its
// native modes; 2K and 4K only upscale a 768P base). Prompt expansion is off:
// the prompt is a timed shot list and a reference map, which a rewrite would
// loosen.

// ── The writer: which LLM writes a Film ─────────────────────────────────────
//
// Every writing step of a Film — the Idea and World, the Script's passes, a
// Deep Film's writers' room (its passes and rewrites), the sheet prompts, the
// Shot list, the Cue sheet and the score's music cues — goes through ONE model,
// and the author picks it with the prompt. Three run on Cloudflare Workers AI
// through the Worker's `AI` binding (no key): `glm` — GLM-5.3, the default:
// the strongest prose of any open model Cloudflare hosts (EQ-Bench Creative
// Writing v3 Elo 2075, 2026-09, ahead of Kimi K2.6's 1725 and Qwen 3.8's 1671,
// with the least slop) — `kimi` — Kimi K2.6 — and `qwen` — Qwen 3.8 27B, fast
// and cheap. `claude` is Claude Fable 5.1 through AI Gateway's Unified Billing
// (no Anthropic key). The Look stage is a classifier, not a writer, and is not
// affected.
//
// `default` is not offered any more but still accepted: it is the Worker's
// AUTO_WRITER (Groq / Cerebras / Kimi), what a Film started before the writer
// was explicit runs on — a job that stored no writer keeps it.
export type FilmWriter = 'glm' | 'qwen' | 'kimi' | 'claude' | 'default';
export const FILM_WRITERS: readonly { id: FilmWriter; label: string; blurb: string }[] = [
  { id: 'glm', label: 'GLM-5.3', blurb: 'on Cloudflare — the strongest open writer' },
  { id: 'kimi', label: 'Kimi K2.6', blurb: 'on Cloudflare — a bigger model, a little slower' },
  { id: 'qwen', label: 'Qwen 3.8', blurb: 'on Cloudflare — quick and cheap' },
  { id: 'claude', label: 'Claude Fable 5.1', blurb: 'slower, stronger writing' },
];
export const FILM_WRITER_IDS: readonly string[] = [...FILM_WRITERS.map((w) => w.id), 'default'];
export const DEFAULT_FILM_WRITER: FilmWriter = 'glm';

// ── The model-hiding switch ─────────────────────────────────────────────────
//
// ONE switch for every model choice the product offers: true = only GLM-5.3 is
// offered, as the Film's writer (prompt box, make_film) AND as the chat's model
// (web/mobile pickers, Settings › Chat provider, and the flue worker's model
// allowlist, which all import this). A stale stored pick of anything else
// coerces back to GLM-5.3 on the client, the Worker and the agent. The other
// models stay wired — flip this to false and run `npm run series:sync` to offer
// them again. (mobile-app keeps its own copy in lib/film.ts.)
export const HIDE_EXTRA_MODELS = true;

/** The writers the prompt box and make_film offer right now. */
export const OFFERED_FILM_WRITERS: readonly { id: FilmWriter; label: string; blurb: string }[] =
  HIDE_EXTRA_MODELS ? FILM_WRITERS.filter((w) => w.id === DEFAULT_FILM_WRITER) : FILM_WRITERS;

/** Coerce a requested writer to one that may run: under the switch, every writer is GLM-5.3. */
export function offeredFilmWriter<T>(writer: T): T | FilmWriter {
  return HIDE_EXTRA_MODELS ? DEFAULT_FILM_WRITER : writer;
}

// ── The depth: how much STORY work a Film gets before anything is drawn ─────
//
// Every Film is written from a SCREENPLAY now (the Script stage, right after
// the World): an outline, a draft and a revision against the core
// specialists' rules, saved as the project's pinned draft, which the Shot list
// is then cut from.
// That is `fast`. `deep` adds the WRITERS' ROOM stage after it: the chosen
// specialists (src/lib/specialists.ts — the same fifteen the chat delegates to)
// each read the draft and hand back findings, then one rewrite applies the
// room's notes as a second draft. The room is unpaid (LLM only) but slow — one
// pass per specialist — so the picker quotes its time from the selection.
export type FilmDepth = 'fast' | 'deep';
export const FILM_DEPTHS: readonly { id: FilmDepth; label: string; blurb: string }[] = [
  { id: 'fast', label: 'Fast', blurb: 'A fast screen writing pass' },
  { id: 'deep', label: 'Deep', blurb: 'A deep pass of script writing' },
];
export const FILM_DEPTH_IDS: readonly string[] = FILM_DEPTHS.map((d) => d.id);
export const DEFAULT_FILM_DEPTH: FilmDepth = 'fast';
/** The room a Deep Film opens with when nobody picks: the arc first, then the three passes that move a first draft most. */
export const DEFAULT_DEEP_SPECIALISTS: readonly string[] = ['story_architect', 'scene_doctor', 'motivation_doctor', 'dialogue_doctor'];
/** How long each part of the story work takes, in seconds — on Claude, the slow writer; the default writer is far quicker. */
export const SCRIPT_WRITE_SECONDS = 75;
/** One specialist's pass: a flue agent reading the draft with its tools, on the Film's writer. A round's passes run side by side. */
export const ROOM_PASS_SECONDS = 150;
/** One round's rewrite: the Film's writer applying that round's notes as a new pinned draft. */
export const ROOM_REWRITE_SECONDS = 120;

/**
 * What a room of `specialists` costs in wall-clock. The room runs in ROUNDS, one
 * per roster stage with anyone in it (outline → draft → polish → lock): a
 * round's passes read side by side, then one rewrite, then the next round.
 */
export function roomEstimate(specialists: readonly string[]): { passes: number; rounds: number; seconds: number; label: string } {
  const ids = [...new Set(specialists.filter((s) => typeof s === 'string' && s))];
  const passes = ids.length;
  const rounds = new Set(ids.map((id) => SPECIALIST_BY_ID.get(id)?.stage ?? id)).size;
  const seconds = rounds * (ROOM_PASS_SECONDS + ROOM_REWRITE_SECONDS);
  const minutes = Math.max(1, Math.round(seconds / 60));
  return { passes, rounds, seconds, label: passes ? `≈ ${minutes} min` : '—' };
}

export type FilmEngine = 'director' | 'seedance' | 'h3';
export const FILM_ENGINES: readonly FilmEngine[] = ['director', 'seedance', 'h3'];
export const DEFAULT_FILM_ENGINE: FilmEngine = 'director';
/**
 * The engines that make a Film as a chain of SEGMENTS from a story (Seedance
 * 2.5 and MiniMax H3), as against the live Director: they share the story
 * flow's sheets, its shot list and its final cut.
 */
export const isStoryEngine = (engine?: string | null): boolean => engine === 'seedance' || engine === 'h3';

// ── Resolution: what a Film's video renders at ──────────────────────────────
//
// Both pipelines take it: the Director's Series is opened at it (the sitting
// streams at it), and every Seedance segment is rendered at it. 480p is the
// default because both bill by what they generate — Seedance per output
// pixel-second, so 720p costs (720/480)² = 2.25× as much per second.
export type FilmResolution = '480p' | '720p';
export const FILM_RESOLUTIONS: readonly FilmResolution[] = ['480p', '720p'];
export const DEFAULT_FILM_RESOLUTION: FilmResolution = '480p';
/** A job's stored resolution → one of FILM_RESOLUTIONS (absent or unknown is the default). */
export const filmResolutionOf = (resolution?: string | null): FilmResolution =>
  FILM_RESOLUTIONS.includes(resolution as FilmResolution) ? (resolution as FilmResolution) : DEFAULT_FILM_RESOLUTION;
/** How much more a second of Seedance costs at this resolution than at 480p (pixels ∝ cost). */
export const seedanceRateScale = (resolution?: string | null): number =>
  filmResolutionOf(resolution) === '720p' ? 2.25 : 1;

/** fal's Seedance 2.5 endpoint every segment goes to (reference / extension). */
export const SEEDANCE_ENDPOINT = 'bytedance/seedance-2.5/reference-to-video';
/** The default resolution a segment renders at; a job's own is `filmResolutionOf(job.resolution)`. */
export const SEEDANCE_RESOLUTION = DEFAULT_FILM_RESOLUTION;
export const SEEDANCE_ASPECT_RATIO = '16:9';
/** A story-flow Film takes the same lengths as every Film: 0:30–5:00, 2:00 by default. */
export const STORY_FLOW_MIN_SECONDS = FILM_MIN_SECONDS;
export const STORY_FLOW_DEFAULT_SECONDS = FILM_DEFAULT_SECONDS;
export const STORY_FLOW_STEPS: readonly number[] = FILM_STEPS;
/**
 * One Seedance generation: fal takes 4–30s, and Seedance 2.5 holds a staged
 * narrative for the whole 30 (the 15s ceiling was Seedance 2.0's), so a Film
 * is cut into as FEW segments as fit — every seam is a paid extension tail and
 * a chance for the likeness to drift, and a 30s take is a whole scene.
 */
export const SEGMENT_MIN_SECONDS = 4;
export const SEGMENT_MAX_SECONDS = 30;
/**
 * The stages a segment of `dur` seconds may hold: one visible change per ~5s,
 * at least four (a 12s segment still gets a beginning, a turn and an end) and
 * at most six (past that a 30s take is a shot list again, and the Seedance
 * skill's stages are scenes, not shots).
 */
export const SEGMENT_STAGE_SECONDS = 5;
export const maxStagesFor = (dur: number): number =>
  Math.min(6, Math.max(4, Math.round((Number(dur) || 0) / SEGMENT_STAGE_SECONDS)));
/**
 * How much of the previous segment an extension is handed (@Video1): its LAST
 * seconds. fal takes 1.8s at least; three carry the motion and the framing,
 * and every input second is billed, so no more.
 */
export const EXTENSION_TAIL_SECONDS = 3;
/**
 * Sheets a story-flow Film draws (style anchor included). fal takes 30 images a
 * generation. 16 since props became their own sheets: 4 characters × 2 views +
 * a few places + a few props + the style frame.
 */
export const MAX_STORY_FLOW_SHEETS = 16;

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
  isStoryEngine(engine) ? STORY_FLOW_STEPS : FILM_STEPS;
export const filmDefaultSecondsFor = (engine?: string | null): number =>
  isStoryEngine(engine) ? STORY_FLOW_DEFAULT_SECONDS : FILM_DEFAULT_SECONDS;

// ── MiniMax H3 (film-plan.ts › The H3 FLOW) ─────────────────────────────────

/** fal's MiniMax H3 endpoint every H3 segment goes to. */
export const H3_ENDPOINT = 'minimax/h3/reference-to-video';
export const H3_ASPECT_RATIO = '16:9';
/** The Film's resolution → H3's `resolution` (its two NATIVE modes; 2K/4K are upscales of 768P). */
export const H3_RESOLUTION: Record<FilmResolution, '480P' | '768P'> = { '480p': '480P', '720p': '768P' };
export const h3ResolutionOf = (resolution?: string | null): '480P' | '768P' => H3_RESOLUTION[filmResolutionOf(resolution)];
/** One H3 generation: fal takes 5–15s (H3's own ceiling — Seedance's 30 does not carry over). */
export const H3_SEGMENT_MIN_SECONDS = 5;
export const H3_SEGMENT_MAX_SECONDS = 15;
/** `reference_image_urls`: at most 9 images; images, videos and audio together at most 12 files. */
export const MAX_H3_REFERENCE_IMAGES = 9;
export const MAX_H3_REFERENCE_FILES = 12;
/** The first 5 reference images of a request are free; each one past that is billed. */
export const H3_FREE_REFERENCE_IMAGES = 5;
/** Pinned off — see The H3 FLOW. */
export const H3_PROMPT_EXPANSION = 'disabled';

/**
 * MiniMax H3 on fal, per OUTPUT second (fal's model page, Sept 2026): $0.05 at
 * 480P, $0.06 at 768P; reference images past the free five, $0.08 each.
 */
export const H3_RATES_USD = {
  referenceSheet: FILM_RATES_USD.referenceSheet,
  second: { '480P': 0.05, '768P': 0.06 } as const,
  extraImage: 0.08,
  sandboxMinute: FILM_RATES_USD.sandboxMinute,
} as const;

/** What one H3 segment of `dur` seconds with `images` references costs. */
export function h3SegmentUsd(dur: number, images: number, resolution?: string | null): number {
  const R = H3_RATES_USD;
  const extra = Math.max(0, (Number(images) || 0) - H3_FREE_REFERENCE_IMAGES);
  return (Number(dur) || 0) * R.second[h3ResolutionOf(resolution)] + extra * R.extraImage;
}

/** A requested length → the story-flow length (next step up, capped at 5:00). */
export function storyFlowLength(requested: number | null | undefined): { seconds: number; capped: boolean } {
  if (requested == null || !Number.isFinite(requested) || requested <= 0) {
    return { seconds: STORY_FLOW_DEFAULT_SECONDS, capped: false };
  }
  const step = STORY_FLOW_STEPS.find((s) => s >= requested);
  return { seconds: step ?? FILM_MAX_SECONDS, capped: requested > FILM_MAX_SECONDS };
}

/**
 * The Film cut into generations: as few as fit under `maxSeconds` each (the
 * engine's ceiling — Seedance's 30 by default, H3 passes its 15), as even as
 * whole seconds allow, longest first. 60 → [30, 30]; 150 → [30, 30, 30, 30, 30];
 * at 15: 60 → [15, 15, 15, 15].
 */
export function segmentDurations(seconds: number, maxSeconds: number = SEGMENT_MAX_SECONDS): number[] {
  const total = Math.max(SEGMENT_MIN_SECONDS, Math.round(Number(seconds) || 0));
  const n = Math.ceil(total / Math.max(SEGMENT_MIN_SECONDS, maxSeconds));
  const base = Math.floor(total / n);
  const extra = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

// ── Voices: one voice per character, auditioned once, referenced by every segment ──
//
// A story engine writes the sound itself, so a character's voice is whatever
// the model happened to give them in THAT segment — and the next segment,
// prompted afresh, gives them another. Seedance 2.5 and MiniMax H3 both take
// AUDIO REFERENCES (`@Audio1` / "Audio 1": a clip that "defines <Name>'s voice
// timbre, accent, cadence and delivery"), which is the only way the same voice
// reaches every segment. So a story-engine Film runs a VOICES stage after its
// sheets (film-stages/story-flow/voices.js): every character in the World is
// AUDITIONED — the SAME lines (AUDITION_LINES), read in their own voice as the
// World describes it, as a clean voice-only recording (no ambience, no room
// tone, no music, no effects) — and the take is filed as an mp3 that every
// later segment they appear in binds as their voice.
//
// Three ways to run the audition, all on fal, chosen on the input's Voices
// setting (`job.voices`) and by make_film's `voices`:
//   video       the Film's OWN video model (Seedance / H3) generates a 5s
//               audition to camera against the character's sheets; the box
//               cuts its audio track to an mp3. The voice is exactly what the
//               engine gives that face, so it persists best — and it costs a
//               5s generation per character.
//   seedaudio   ByteDance Seed Audio on fal renders the lines from the voice
//               note alone (text-to-speech with a voice description).
//   elevenlabs  ElevenLabs on fal DESIGNS a voice from the note and reads the
//               lines with it.
// The Director cannot take a voice reference (its live stream has no audio
// input), so the Director engine ignores the setting and runs no stage.
// Absent on a job (one from before this stage existed) means no stage either:
// steps map onto stages by POSITION, so a running job's list must not change
// under it.
export type FilmVoices = 'video' | 'seedaudio' | 'elevenlabs';
export const FILM_VOICES: readonly { id: FilmVoices; label: string; blurb: string }[] = [
  { id: 'video', label: 'Audition', blurb: "a 5s audition on the Film's own video model, its voice cut to an mp3" },
  { id: 'seedaudio', label: 'Seed Audio', blurb: 'the same lines read by ByteDance Seed Audio from the voice note' },
  { id: 'elevenlabs', label: 'ElevenLabs', blurb: 'a voice designed on ElevenLabs from the voice note, reading the lines' },
];
export const FILM_VOICE_IDS: readonly string[] = FILM_VOICES.map((x) => x.id);
export const DEFAULT_FILM_VOICES: FilmVoices = 'video';
/** A job's stored `voices` → the pass it runs, or null for none (absent, unknown, or not a story engine). */
export const filmVoicesOf = (voices?: string | null, engine?: string | null): FilmVoices | null =>
  isStoryEngine(engine) && FILM_VOICE_IDS.includes(voices as FilmVoices) ? (voices as FilmVoices) : null;
/**
 * One audition: what the video engines generate for it, and what every filed
 * voice is TRIMMED to on the box — long enough to carry a voice, short enough
 * that three fit H3's 15s audio budget exactly.
 */
export const AUDITION_SECONDS = 5;
/**
 * What the filed voice reference is cut to — shorter than the audition that
 * was rendered (H3 renders no less than 5s). A reference past ~4s makes H3
 * mumble for half a second at the start of a take (MiniMax-H3 HF discussion
 * #76), and timbre is all a reference is for.
 */
export const VOICE_REF_SECONDS = 4;
/**
 * What every character reads — the SAME lines, so the auditions compare.
 * Neutral, about six seconds spoken, and at least 100 characters because
 * ElevenLabs' voice design refuses a shorter text; the filed mp3 is cut to
 * AUDITION_SECONDS anyway (a voice reference carries timbre, not a sentence).
 */
export const AUDITION_LINES = "I came back for the lantern. Nobody remembers where we left it, but I do. It's still down by the river.";
/** Seedance 2.5 `audio_urls`: up to 10 files, 1.8–30.2s each, 30.2s combined. */
export const MAX_SEEDANCE_AUDIO_REFS = 10;
export const SEEDANCE_AUDIO_MAX_SECONDS = 30.2;
/** MiniMax H3 `reference_audio_urls`: up to 3 files, 2–15s each, 15s combined; audio counts toward the 12 files. */
export const MAX_H3_REFERENCE_AUDIO = 3;
export const H3_AUDIO_MAX_SECONDS = 15;

/** What one audition costs, per mode, beside the engine's own second rate for `video`. ESTIMATES. */
export const VOICE_RATES_USD = {
  /** One Seed Audio render of the lines (fal: $0.1875 a minute of audio — a few seconds). ESTIMATE. */
  seedaudio: 0.02,
  /** One ElevenLabs voice design reading the lines (fal: $0.10 per 1,000 characters performed). ESTIMATE. */
  elevenlabs: 0.02,
  sandboxMinute: FILM_RATES_USD.sandboxMinute,
} as const;

/**
 * The Voices stage's estimate for `characters` on `engine`: nothing when the
 * pass is off; a 5s generation per character (plus one box job to cut the
 * audio) for `video`; a flat rate per character otherwise.
 */
export function voicesEstimate(
  voices: string | null | undefined,
  engine: string | null | undefined,
  characters: number | null | undefined,
  resolution?: string | null,
): StageEstimate {
  const mode = filmVoicesOf(voices, engine);
  const n = Math.max(0, Math.round(Number(characters) || 0));
  if (!mode || !n) return stage(0, 'voice', 0);
  if (mode === 'video') {
    const perSecond = engine === 'h3'
      ? H3_RATES_USD.second[h3ResolutionOf(resolution)]
      : STORY_FLOW_RATES_USD.seedanceSecond * seedanceRateScale(resolution);
    const usd = n * AUDITION_SECONDS * perSecond + VOICE_RATES_USD.sandboxMinute;
    return { units: n, unit: 'voice', rate: cents(AUDITION_SECONDS * perSecond), usd: cents(usd) };
  }
  return stage(n, 'voice', VOICE_RATES_USD[mode]);
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
  /** The Voices pass this Film runs, or null. */
  voices: FilmVoices | null;
  estimate: {
    currency: 'USD';
    perStage: { referenceSheets: StageEstimate; voices: StageEstimate; video: StageEstimate; score: StageEstimate; sandbox: StageEstimate };
    total: number;
  };
};

/**
 * The score's estimate for a film of `seconds`, or nothing when it is off:
 * MiniMax per second of music, ElevenLabs one cue per started minute.
 */
const scoreEstimate = (seconds: number, score?: boolean | null, music?: string | null): StageEstimate => {
  if (!filmScoreOf(score)) return stage(0, 'score minute', FILM_RATES_USD.scoreMinute);
  return newFilmMusic(music) === 'minimax'
    ? stage(Math.ceil(seconds), 'score second', MINIMAX_USD_PER_SECOND)
    : stage(Math.ceil(seconds / 60), 'score minute', FILM_RATES_USD.scoreMinute);
};
/** Box jobs the score adds when it is on: the measure and the mix. */
const scoreSandboxJobs = (score?: boolean | null): number => (filmScoreOf(score) ? 2 : 0);

/** A prompt (and optionally an explicit length) → the story-flow Film it will make. */
export function planStoryFlow(input: FilmPlanInput = {}): StoryFlowPlan {
  const explicit =
    typeof input.seconds === 'number' && Number.isFinite(input.seconds) && input.seconds > 0 ? input.seconds : null;
  const requestedSeconds = explicit ?? parseLength(input.prompt);
  const { seconds, capped } = storyFlowLength(requestedSeconds);
  const durations = segmentDurations(seconds);
  const sheets = Math.min(MAX_STORY_FLOW_SHEETS, Math.max(1, Math.round(input.referenceSheets ?? DEFAULT_REFERENCE_SHEETS)));
  const R = STORY_FLOW_RATES_USD;
  const resolution = filmResolutionOf(input.resolution);
  const scale = seedanceRateScale(resolution);
  const videoUsd = durations.reduce(
    (sum, d, i) => sum + (i === 0 ? d * R.seedanceSecond : (d + EXTENSION_TAIL_SECONDS) * R.seedanceVideoRefSecond) * scale,
    0,
  );
  const video: StageEstimate = { units: seconds, unit: 'clip second', rate: R.seedanceSecond * scale, usd: cents(videoUsd) };
  const score = scoreEstimate(seconds, input.score, input.music);
  // One box job per segment (fetch + cut), one for the final cut, and the score's two.
  const sandbox = stage(durations.length + 2 + scoreSandboxJobs(input.score), 'sandbox minute', R.sandboxMinute);
  const referenceSheets = stage(sheets, 'sheet', R.referenceSheet);
  const voices = voicesEstimate(input.voices, 'seedance', input.characters, resolution);
  const total = cents(video.usd + score.usd + sandbox.usd + referenceSheets.usd + voices.usd);
  return {
    engine: 'seedance',
    seconds,
    length: formatLength(seconds),
    requestedSeconds,
    capped,
    resolution,
    segments: durations.length,
    durations,
    sheets,
    voices: filmVoicesOf(input.voices, 'seedance'),
    estimate: { currency: 'USD', perStage: { referenceSheets, voices, video, score, sandbox }, total },
  };
}

export type H3Plan = {
  engine: 'h3';
  seconds: number;
  length: string;
  requestedSeconds: number | null;
  capped: boolean;
  resolution: FilmResolution;
  /** H3's own name for it: 480P or 768P. */
  h3Resolution: '480P' | '768P';
  segments: number;
  durations: number[];
  sheets: number;
  /** The Voices pass this Film runs, or null. */
  voices: FilmVoices | null;
  estimate: {
    currency: 'USD';
    perStage: { referenceSheets: StageEstimate; voices: StageEstimate; video: StageEstimate; score: StageEstimate; sandbox: StageEstimate };
    total: number;
  };
};

/**
 * A prompt (and optionally an explicit length) → the H3 Film it will make: the
 * story flow's lengths, cut to H3's own segments (5–15s: its ceiling is half
 * Seedance's, so a 1:00 story is four takes here and two there; every
 * story-flow length cuts to ≥12s, so the floor never binds), priced at H3's
 * per-second rate.
 */
export function planH3(input: FilmPlanInput = {}): H3Plan {
  const explicit =
    typeof input.seconds === 'number' && Number.isFinite(input.seconds) && input.seconds > 0 ? input.seconds : null;
  const requestedSeconds = explicit ?? parseLength(input.prompt);
  const { seconds, capped } = storyFlowLength(requestedSeconds);
  const durations = segmentDurations(seconds, H3_SEGMENT_MAX_SECONDS);
  const sheets = Math.min(MAX_STORY_FLOW_SHEETS, Math.max(1, Math.round(input.referenceSheets ?? DEFAULT_REFERENCE_SHEETS)));
  const R = H3_RATES_USD;
  const resolution = filmResolutionOf(input.resolution);
  const h3Resolution = h3ResolutionOf(resolution);
  // Each segment binds about the free five (two characters' views, a plate);
  // a crowded segment pays for its extras when it renders.
  const videoUsd = durations.reduce((sum, d) => sum + h3SegmentUsd(d, H3_FREE_REFERENCE_IMAGES, resolution), 0);
  const video: StageEstimate = { units: seconds, unit: 'clip second', rate: R.second[h3Resolution], usd: cents(videoUsd) };
  const score = scoreEstimate(seconds, input.score, input.music);
  // One box job per segment (fetch + cut the tail), one for the final cut, and the score's two.
  const sandbox = stage(durations.length + 2 + scoreSandboxJobs(input.score), 'sandbox minute', R.sandboxMinute);
  const referenceSheets = stage(sheets, 'sheet', R.referenceSheet);
  const voices = voicesEstimate(input.voices, 'h3', input.characters, resolution);
  const total = cents(video.usd + score.usd + sandbox.usd + referenceSheets.usd + voices.usd);
  return {
    engine: 'h3',
    seconds,
    length: formatLength(seconds),
    requestedSeconds,
    capped,
    resolution,
    h3Resolution,
    segments: durations.length,
    durations,
    sheets,
    voices: filmVoicesOf(input.voices, 'h3'),
    estimate: { currency: 'USD', perStage: { referenceSheets, voices, video, score, sandbox }, total },
  };
}

// ── The quote: what the prompt box shows before anything is paid for ──────────
//
// One entry point over the three plans, so the input's price follows every
// setting that moves it — engine, length (chosen, or stated in the prompt),
// resolution, the Voices pass, the Score and its model. What is not known yet
// (how many characters the World will cast, how many sheets it takes) is
// assumed at a typical Film's size and said so. Writing (the LLM passes) is
// not in it: it is not a fal model and costs cents next to the video.

/** Characters a quote assumes before the World exists (each is a voice and two sheets). */
export const QUOTE_CHARACTERS = 3;
/** Sheets a story-engine quote assumes: a style frame, two views per character, a few places. */
export const QUOTE_STORY_SHEETS = 1 + 2 * QUOTE_CHARACTERS + 3;

export type FilmQuoteLine = { key: string; label: string; detail: string; usd: number };
export type FilmQuote = { engine: FilmEngine; seconds: number; length: string; total: number; lines: FilmQuoteLine[] };

const money = (usd: number) => `$${usd.toFixed(2)}`;

export function quoteFilm(input: FilmPlanInput & { engine?: string | null } = {}): FilmQuote {
  const engine: FilmEngine = FILM_ENGINES.includes(input.engine as FilmEngine) ? (input.engine as FilmEngine) : DEFAULT_FILM_ENGINE;
  const music = newFilmMusic(input.music);
  const musicLabel = FILM_MUSIC.find((m) => m.id === music)?.label ?? music;
  const scoreLine = (s: StageEstimate): FilmQuoteLine => ({
    key: 'score',
    label: 'Score',
    detail: s.usd > 0 ? `${musicLabel} · ${s.units}${s.unit === 'score second' ? 's' : ' min'}` : 'off',
    usd: s.usd,
  });
  if (engine === 'director') {
    const plan = planFilm(input);
    const e = plan.estimate.perStage;
    const lines: FilmQuoteLine[] = [
      { key: 'sheets', label: 'Reference sheets', detail: `${e.referenceSheets.units} × ${money(e.referenceSheets.rate)}`, usd: e.referenceSheets.usd },
      { key: 'clips', label: 'Shot sheet clips', detail: `${e.clips.units}s · H3 Max`, usd: e.clips.usd },
      { key: 'sitting', label: 'Director sitting', detail: `${e.sitting.units}s × ${money(e.sitting.rate)}`, usd: e.sitting.usd },
      scoreLine(e.score),
      { key: 'sandbox', label: 'Cutting + mixing', detail: `${e.sandbox.units} box min`, usd: e.sandbox.usd },
    ];
    return { engine, seconds: plan.seconds, length: plan.length, total: plan.estimate.total, lines };
  }
  const characters = input.characters ?? QUOTE_CHARACTERS;
  const referenceSheets = input.referenceSheets ?? QUOTE_STORY_SHEETS;
  const plan = engine === 'h3'
    ? planH3({ ...input, characters, referenceSheets })
    : planStoryFlow({ ...input, characters, referenceSheets });
  const e = plan.estimate.perStage;
  const model = engine === 'h3' ? 'MiniMax H3' : 'Seedance 2.5';
  const voiceMode = FILM_VOICES.find((v) => v.id === plan.voices)?.label;
  const lines: FilmQuoteLine[] = [
    { key: 'sheets', label: 'Reference sheets', detail: `${e.referenceSheets.units} × ${money(e.referenceSheets.rate)}`, usd: e.referenceSheets.usd },
    { key: 'voices', label: 'Voices', detail: voiceMode ? `${voiceMode} · ${e.voices.units} characters` : 'off', usd: e.voices.usd },
    { key: 'video', label: 'Video', detail: `${model} · ${plan.segments} × ${plan.durations[0]}s · ${plan.resolution}`, usd: e.video.usd },
    scoreLine(e.score),
    { key: 'sandbox', label: 'Cutting + mixing', detail: `${e.sandbox.units} box min`, usd: e.sandbox.usd },
  ];
  return { engine, seconds: plan.seconds, length: plan.length, total: plan.estimate.total, lines };
}
