// VENDORED from src/lib/score-mix.ts — DO NOT EDIT HERE.
// Edit the canonical file, then run `npm run series:sync`
// (scripts/sync-series.mjs).

import { CHUNK_MIN_MS, type Plan, fitToFilm, splitAt, starterPlan, validatePlan } from './music-plan';

// THE SCORE'S MIX AND ITS PLAN, AS NUMBERS — the part of scoring a sitting that
// is arithmetic rather than decoding.
//
// Two places lay a cue under a kept sitting: the Musicalized tab, in the
// browser (src/director/mix.ts runs these settings over decoded samples), and
// the Auto Film job's Score stage, in a Daytona sandbox (ffmpeg runs the same
// settings as a filter expression). Both read the bed's level, its ducks and
// its fade from HERE, so a Film scored by the job and a sitting scored by hand
// are mixed by one set of numbers.
//
// Pure, and vendored by `npm run series:sync` into the Worker and the agent.

/** dB → linear gain. -16 dB → 0.158, -21 dB → 0.089, -4.5 dB → 0.6. */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function gainToDb(gain: number): number {
  return gain <= 0 ? -99 : 20 * Math.log10(gain);
}

/** A stretch of the film where the bed sits at a different level: exteriors, mostly. */
export type LevelSpan = { from: number; to: number; db: number };

export type MixSettings = {
  /** The bed's level everywhere a span does not say otherwise. -21 dB, measured in interiors. */
  baseDb: number;
  /** Where it sits elsewhere: -16 dB in vacuum, where -21 vanishes. */
  spans: LevelSpan[];
  /** Dialogue windows, MEASURED, where the bed drops by `duckDb`. */
  ducks: [number, number][];
  duckDb: number;
  fadeInSec: number;
};

export const DEFAULT_MIX: MixSettings = {
  baseDb: -21,
  spans: [],
  ducks: [],
  duckDb: -4.5,
  fadeInSec: 1,
};

/** The ffmpeg expression for the bed's level per span (no ducks, no fade). */
export function levelExpression(settings: MixSettings): string {
  const base = dbToGain(settings.baseDb).toFixed(3);
  if (settings.spans.length === 0) return base;
  const nested = settings.spans.reduceRight(
    (inner, span) => `if(between(t,${span.from},${span.to}),${dbToGain(span.db).toFixed(3)},${inner})`,
    base,
  );
  return nested;
}

/**
 * The whole bed gain as ONE ffmpeg `volume` expression (evaluated per frame):
 * the level per span, times the duck under every measured window. The fade-in
 * is left to `afade`, which ramps sample-accurately. Same arithmetic as
 * `levelAt` in src/director/mix.ts, minus the fade.
 */
export function bedVolumeExpression(settings: MixSettings): string {
  const level = levelExpression(settings);
  if (!settings.ducks.length) return level;
  const inside = settings.ducks.map(([from, to]) => `between(t,${from},${to})`).join('+');
  return `${level}*if(${inside},${dbToGain(settings.duckDb).toFixed(3)},1)`;
}

/**
 * Where the film's own audio is doing something the score must get out from
 * under — its dialogue and its impacts, MEASURED from one loudness figure per
 * second (dBFS RMS).
 *
 * `withinDb` of the film's own peak, because what matters is loud RELATIVE to
 * this film — a quiet vacuum scene and a shouted corridor should both duck on
 * their own terms. Windows closer than `joinSec` are merged: a bed that lifts
 * for half a second between two lines pumps, which is more distracting than
 * either level on its own.
 */
export function duckWindows(
  loudness: number[],
  { withinDb = 6, joinSec = 1.5, minSec = 0.5 } = {},
): [number, number][] {
  if (!loudness.length) return [];
  const peak = Math.max(...loudness);
  const floor = peak - withinDb;

  const raw: [number, number][] = [];
  let start: number | null = null;
  loudness.forEach((db, second) => {
    if (db >= floor) {
      if (start === null) start = second;
    } else if (start !== null) {
      raw.push([start, second]);
      start = null;
    }
  });
  if (start !== null) raw.push([start, loudness.length]);

  const out: [number, number][] = [];
  for (const [from, to] of raw) {
    const last = out[out.length - 1];
    if (last && from - last[1] <= joinSec) last[1] = to;
    else out.push([from, to]);
  }
  return out.filter(([from, to]) => to - from >= minSec);
}

/** A cut the picture makes: the second it lands at, and how hard (ffmpeg's scene score, 0–1). */
export type PictureTurn = { at: number; score: number };

/**
 * The picture's turns worth writing the music around. A sitting cuts every few
 * seconds; a cue that turned at every cut would never settle into anything. So
 * the hardest cuts win, at least `minGapSec` apart, clear of both ends (a chunk
 * is at least 3 s, and the ending owns the last six), at most `maxTurns`.
 * Returned in film order, as whole seconds.
 */
export function pickTurns(
  cuts: PictureTurn[],
  filmMs: number,
  { minGapSec = 12, maxTurns = 10, endSec = 6 } = {},
): number[] {
  const filmSec = filmMs / 1000;
  const edge = CHUNK_MIN_MS / 1000;
  const picked: number[] = [];
  const ranked = [...cuts]
    .filter((c) => Number.isFinite(c?.at) && c.at >= edge && c.at <= filmSec - endSec - edge)
    .sort((a, b) => b.score - a.score || a.at - b.at);
  for (const cut of ranked) {
    if (picked.length >= maxTurns) break;
    const at = Math.round(cut.at);
    if (picked.every((p) => Math.abs(p - at) >= minGapSec)) picked.push(at);
  }
  return picked.sort((a, b) => a - b);
}

/**
 * The composition plan for a film, from its MEASUREMENTS: the Series' brief as
 * the starter, split at every turn the picture makes, fitted to the measured
 * length. Never from the cue sheet — the film lands a beat two to seven seconds
 * after the sheet wrote it. Throws when the result would be refused, naming why.
 */
export function planFromFilm({ brief, filmMs, turns }: { brief: string; filmMs: number; turns: number[] }): Plan {
  let plan = starterPlan(brief, filmMs);
  for (const at of turns) plan = splitAt(plan, at);
  plan = fitToFilm(plan, filmMs);
  const errors = validatePlan(plan, filmMs);
  if (errors.length) throw new Error(`the score's plan would be refused: ${errors.map((e) => e.message).join('; ')}`);
  return plan;
}
