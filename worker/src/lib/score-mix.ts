// VENDORED from src/lib/score-mix.ts — DO NOT EDIT HERE.
// Edit the canonical file, then run `npm run series:sync`
// (scripts/sync-series.mjs).

import {
  ADHERENCE,
  type Adherence,
  CHUNK_MAX_MS,
  CHUNK_MIN_MS,
  type Chunk,
  MAX_CHUNKS,
  type Plan,
  fitToFilm,
  splitAt,
  starterPlan,
  styleTags,
  validatePlan,
} from './music-plan';

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

/**
 * A stretch of the film where the bed sits at a different level: exteriors,
 * mostly — and the Score's SILENCES, where it sits at nothing at all.
 *
 * `rampSec`, when set, makes the span's edges linear ramps instead of steps:
 * the level travels from the BASE level to the span's over the first `rampSec`
 * seconds inside the span and back over the last. A silence that slammed shut
 * would be heard as an edit; one that breathes out over a second and a half is
 * heard as the score choosing to stop. Ramps are measured against the base
 * level, not against whatever span might overlap — spans are meant not to.
 */
export type LevelSpan = { from: number; to: number; db: number; rampSec?: number };

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

/** A span's ramp, in seconds — never more than half the span, so the two ramps cannot cross. */
export function rampOf(span: LevelSpan): number {
  const r = Number(span.rampSec);
  if (!Number.isFinite(r) || r <= 0) return 0;
  return Math.min(r, Math.max(0, (span.to - span.from) / 2));
}

/**
 * The bed's linear level at second `t` from the spans alone (no ducks, no
 * fade): the FIRST span that holds `t` decides, as the nested ffmpeg `if`
 * does, and a ramped span's edges travel linearly (in gain) from the base.
 * `levelAt` in src/director/mix.ts and `levelExpression` below are this one
 * function, in samples and in ffmpeg's expression language.
 */
export function spanGainAt(settings: MixSettings, t: number): number {
  const base = dbToGain(settings.baseDb);
  for (const span of settings.spans) {
    if (t < span.from || t > span.to) continue;
    const gain = dbToGain(span.db);
    const r = rampOf(span);
    if (r <= 0) return gain;
    const w = Math.min(1, (t - span.from) / r, (span.to - t) / r);
    return base + (gain - base) * w;
  }
  return base;
}

/** True while `t` is inside a span's ramp — where the level is a slope, not a step. */
export function inRamp(settings: MixSettings, t: number): boolean {
  return settings.spans.some((span) => {
    const r = rampOf(span);
    return r > 0 && ((t >= span.from && t < span.from + r) || (t > span.to - r && t <= span.to));
  });
}

/** The ffmpeg expression for the bed's level per span (no ducks, no fade). */
export function levelExpression(settings: MixSettings): string {
  const baseGain = dbToGain(settings.baseDb);
  const base = baseGain.toFixed(3);
  if (settings.spans.length === 0) return base;
  const nested = settings.spans.reduceRight((inner, span) => {
    const gain = dbToGain(span.db);
    const r = rampOf(span);
    if (r <= 0) return `if(between(t,${span.from},${span.to}),${gain.toFixed(3)},${inner})`;
    // base + (gain − base) · w, where w climbs 0→1 over the first r seconds and
    // falls 1→0 over the last: a linear fade in and out of the span's level.
    const delta = (gain - baseGain).toFixed(4);
    const w = `min(1,min((t-${span.from})/${r},(${span.to}-t)/${r}))`;
    return `if(between(t,${span.from},${span.to}),${base}+(${delta})*${w},${inner})`;
  }, base);
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

// ── The story, on the film's clock ─────────────────────────────────────────
//
// The picture's cuts say WHERE the music may turn; only the script says WHY.
// A cut from one angle of the girl to another and the cut where the mecha takes
// her score the same on ffmpeg's scene meter, so a plan split at the hardest
// cuts turns at random places and never with the story. The shot list is the
// script: its beats and scene changes are the story's moments, each with a line
// saying what happens. They are written on the PLANNED clock (the cue sheet's
// length); the sitting that was kept runs two to seven seconds long, drifting
// later as it goes. So each moment is scaled onto the measured length and then
// snapped to the nearest real picture cut — the cut is where the moment
// actually landed.

/** The shot-list fields a story moment is read from. */
export type ScriptShot = {
  id?: string;
  beat?: string;
  beatTitle?: string;
  dur?: number;
  action?: string;
  dialogue?: string;
  audioSync?: string;
  location?: string;
  characters?: string[];
};

/** One turn of the story: where it was written (`planned`) and where it landed (`at`). */
export type StoryMoment = {
  at: number;
  planned: number;
  title: string;
  what: string;
  dialogue: boolean;
  /** True when `at` is a measured picture cut, false when it is only the scaled time. */
  snapped?: boolean;
};

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const clean = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();

/**
 * The shot list's story moments on the PLANNED clock: one per beat (or, in a
 * list with no beats, per change of location; with neither, per shot). The
 * shots' durations are scaled to `plannedSec`, exactly as the cue sheet laid
 * them (`beatsOnGrid`), so a moment's `planned` second is the one the sheet
 * directed it at.
 */
export function storyMoments(shots: ScriptShot[], plannedSec: number): StoryMoment[] {
  const list = (shots || []).filter(Boolean);
  if (!list.length || !(plannedSec > 0)) return [];
  const durs = list.map((s) => Math.max(0, Number(s.dur) || 0));
  const sum = durs.reduce((a, b) => a + b, 0);
  const lenOf = (i: number) => (sum > 0 ? (durs[i] * plannedSec) / sum : plannedSec / list.length);
  const beatKey = (s: ScriptShot) => clean(s.beat) || clean(s.beatTitle);
  const keyOf = list.some((s) => beatKey(s))
    ? beatKey
    : list.some((s) => clean(s.location))
      ? (s: ScriptShot) => clean(s.location)
      : (s: ScriptShot, i?: number) => String(i);

  type Group = { planned: number; shots: ScriptShot[] };
  const groups: Group[] = [];
  let clock = 0;
  let last: string | null = null;
  list.forEach((shot, i) => {
    const key = keyOf(shot, i);
    if (last === null || key !== last) groups.push({ planned: clock, shots: [] });
    groups[groups.length - 1].shots.push(shot);
    last = key;
    clock += lenOf(i);
  });

  return groups.map(({ planned, shots: group }) => {
    const head = group[0];
    const title = clean(head.beatTitle) || clean(head.beat) || clean(head.location) || `Shot ${clean(head.id) || '?'}`;
    const place = clean(head.location);
    const who = [...new Set(group.flatMap((s) => (Array.isArray(s.characters) ? s.characters.map(clean) : [])).filter(Boolean))];
    const actions = group.map((s) => clean(s.action)).filter(Boolean).join(' / ');
    const sound = group.map((s) => clean(s.audioSync)).filter(Boolean).join(' / ');
    const what = [
      place && title !== place ? `${place}.` : '',
      who.length ? `(${who.join(', ')})` : '',
      actions,
      sound ? `Sound: ${sound}` : '',
    ].filter(Boolean).join(' ');
    const at = Math.round(planned * 10) / 10;
    return { at, planned: at, title: clip(title, 80), what: clip(what, 260), dialogue: group.some((s) => clean(s.dialogue).length > 0) };
  });
}

/**
 * Story moments from the planned clock onto the MEASURED one. Each is scaled
 * by measured/planned, then snapped to the nearest measured picture cut no more
 * than `earlySec` before the scaled time or `lateSec` after it — the film only
 * ever runs LATE, so the window leans forward. A moment with no cut in reach
 * keeps its scaled time. Moments stay in order and at least `minGapSec` apart;
 * the first stays at 0.
 */
export function momentsOnFilm(
  moments: StoryMoment[],
  { plannedSec, filmMs, cuts = [], earlySec = 1, lateSec = 4, minGapSec = 3 }:
    { plannedSec: number; filmMs: number; cuts?: PictureTurn[]; earlySec?: number; lateSec?: number; minGapSec?: number },
): StoryMoment[] {
  const filmSec = filmMs / 1000;
  const scale = plannedSec > 0 ? filmSec / plannedSec : 1;
  const usable = (cuts || []).filter((c) => Number.isFinite(c?.at));
  const out: StoryMoment[] = [];
  for (const moment of moments) {
    const scaled = moment.planned * scale;
    let at = scaled;
    let snapped = false;
    if (moment.planned > 0) {
      let best: PictureTurn | null = null;
      for (const cut of usable) {
        if (cut.at < scaled - earlySec || cut.at > scaled + lateSec) continue;
        const d = Math.abs(cut.at - scaled);
        const bd = best ? Math.abs(best.at - scaled) : Infinity;
        if (d < bd || (d === bd && best && cut.score > best.score)) best = cut;
      }
      if (best) {
        at = best.at;
        snapped = true;
      }
    } else {
      at = 0;
    }
    const prev = out[out.length - 1];
    if (prev && at - prev.at < minGapSec) continue;
    if (at >= filmSec) continue;
    out.push({ ...moment, at: Math.round(at * 10) / 10, snapped });
  }
  return out;
}

// ── The plan the writing model answers, made renderable ───────────────────
//
// The Score stage asks the writing model for the plan — sections named for what
// the picture IS, styles that arrive and styles that leave, and which sections
// are SILENCE. A model's arithmetic is not to be trusted, so everything that is
// a number is repaired here: the durations are scaled to the measured length
// and rounded on cumulative boundaries (so they add up to the millisecond), a
// chunk under the minimum joins its neighbour, one over the maximum is cut, a
// plan over the chunk ceiling loses its shortest chunks, and a silence that
// breaks the silence rules is played instead. What cannot be repaired returns
// null and the caller falls back to the picture-only plan.

/** A silence: at least this long to be heard as one (the ramps take 1.5 s at each end). */
export const SILENCE_MIN_MS = 4_000;
/** …and at most this long before it reads as the score having broken. */
export const SILENCE_MAX_MS = 20_000;
/** Never inside the opening seconds — the score has to exist before it can stop. */
export const SILENCE_CLEAR_START_MS = 3_000;
/** Never inside the ending — the last six seconds are the ending's. */
export const SILENCE_CLEAR_END_MS = 6_000;
export const MAX_SILENCES = 4;
/** How far a silence mutes the bed: -80 dB, which ffmpeg writes as a gain of 0. */
export const SILENCE_DB = -80;
/** The fade out of the music into a silence, and back in out of it. */
export const SILENCE_RAMP_SEC = 1.5;

export const SILENCE_POSITIVE = ['near silence', 'room tone only', 'single sustained very soft note fading to nothing'];
export const SILENCE_NEGATIVE = ['drums', 'percussion', 'melody', 'pads', 'strings', 'bass', 'rhythm', 'vocals', 'lyrics'];
const ALWAYS_NEGATIVE = ['vocals', 'lyrics'];

/** A silence the plan holds, in seconds on the film's clock. */
export type Silence = { from: number; to: number; section: string };

type Draft = { name: string; silence: boolean; pos: string[]; neg: string[]; adh?: Adherence; dur: number };

const styleList = (v: unknown, max = 8): string[] => {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const s = clean(item);
    if (!s || s.length > 80 || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
};
const union = (a: string[], b: string[]) => {
  const have = new Set(a.map((s) => s.toLowerCase()));
  return [...a, ...b.filter((s) => !have.has(s.toLowerCase()))];
};
const sectionName = (v: unknown) => clip(clean(v).replace(/^\[+|\]+$/g, '').replace(/[[\]]/g, '').trim(), 60);

/** Two neighbours become one: the one that PLAYS survives a silence; otherwise the earlier one. */
function joined(a: Draft, b: Draft): Draft {
  const keep = a.silence && !b.silence ? b : a;
  return { ...keep, dur: a.dur + b.dur };
}

/**
 * The writing model's answer → a plan fal will take, plus the silences in it.
 * `answer` is `{ chunks: [{ section, silence, positive_styles, negative_styles,
 * context_adherence, duration_ms }] }`. Returns null when nothing renderable
 * can be made of it.
 */
export function repairScorePlan(
  answer: unknown,
  { brief, filmMs }: { brief: string; filmMs: number },
): { plan: Plan; silences: Silence[] } | null {
  const raw = (answer as { chunks?: unknown } | null)?.chunks;
  if (!Array.isArray(raw) || !raw.length || !(filmMs >= CHUNK_MIN_MS)) return null;
  const tags = styleTags(brief || '');
  const genre = tags.length ? tags : ['instrumental score'];

  let drafts: Draft[] = raw
    .map((c: any): Draft => ({
      name: sectionName(c?.section ?? c?.text ?? c?.name),
      silence: c?.silence === true || c?.silence === 'true',
      pos: styleList(c?.positive_styles),
      neg: styleList(c?.negative_styles, 10),
      adh: ADHERENCE.includes(c?.context_adherence) ? c.context_adherence : undefined,
      dur: Number(c?.duration_ms),
    }))
    .filter((d) => Number.isFinite(d.dur) && d.dur > 0 && (d.name || d.pos.length || d.silence));
  if (!drafts.length) return null;

  // Scale to the film and round on cumulative boundaries: they add up exactly.
  const sum = drafts.reduce((a, d) => a + d.dur, 0);
  let cum = 0;
  let prevEnd = 0;
  drafts = drafts.map((d, i) => {
    cum += d.dur;
    const end = i === drafts.length - 1 ? filmMs : Math.round((cum * filmMs) / sum);
    const out = { ...d, dur: end - prevEnd };
    prevEnd = end;
    return out;
  }).filter((d) => d.dur > 0);

  // Too short to be a chunk → joins a neighbour.
  for (let i = 0; i < drafts.length && drafts.length > 1; ) {
    if (drafts[i].dur >= CHUNK_MIN_MS) { i++; continue; }
    if (i > 0) drafts.splice(i - 1, 2, joined(drafts[i - 1], drafts[i]));
    else drafts.splice(0, 2, joined(drafts[0], drafts[1]));
    i = Math.max(0, i - 1);
  }

  // Silences that break the rules are played instead, quietly, in the genre.
  let at = 0;
  let silences = 0;
  drafts = drafts.map((d) => {
    const start = at;
    at += d.dur;
    if (!d.silence) return d;
    const ok = start >= SILENCE_CLEAR_START_MS && at <= filmMs - SILENCE_CLEAR_END_MS &&
      d.dur >= SILENCE_MIN_MS && d.dur <= SILENCE_MAX_MS && silences < MAX_SILENCES;
    if (ok) { silences++; return d; }
    return { ...d, silence: false, pos: [...genre.slice(0, 3), 'sparse', 'very quiet'], neg: ['drums', 'percussion'] };
  });

  // Too long for one chunk → cut into equal parts of the same section.
  drafts = drafts.flatMap((d) => {
    if (d.dur <= CHUNK_MAX_MS) return [d];
    const parts = Math.ceil(d.dur / CHUNK_MAX_MS);
    const each = Math.floor(d.dur / parts);
    return Array.from({ length: parts }, (_, i) => ({
      ...d,
      name: i === 0 ? d.name : `${d.name || 'Section'} ${i + 1}`,
      dur: i === parts - 1 ? d.dur - each * (parts - 1) : each,
    }));
  });

  // Over the ceiling → the shortest chunk joins the one before it, until it fits.
  while (drafts.length > MAX_CHUNKS) {
    let shortest = 1;
    for (let i = 2; i < drafts.length; i++) if (drafts[i].dur < drafts[shortest].dur) shortest = i;
    drafts.splice(shortest - 1, 2, joined(drafts[shortest - 1], drafts[shortest]));
  }

  const chunks: Chunk[] = drafts.map((d, i) => {
    let pos = d.pos;
    let neg = d.neg;
    if (d.silence) {
      pos = pos.length ? pos : [...SILENCE_POSITIVE];
      neg = union(neg, SILENCE_NEGATIVE);
    } else {
      if (!pos.length) pos = [...genre];
      // The first chunk's styles set the genre of the whole piece.
      if (i === 0) pos = union(genre, pos);
      neg = union(neg, ALWAYS_NEGATIVE).filter((s) => !pos.some((p) => p.toLowerCase() === s.toLowerCase()));
    }
    return {
      text: `[${d.name || (d.silence ? 'Silence' : `Section ${i + 1}`)}]`,
      duration_ms: d.dur,
      positive_styles: pos,
      negative_styles: neg,
      context_adherence: d.adh || 'high',
    };
  });

  const plan = fitToFilm({ chunks }, filmMs);
  if (validatePlan(plan, filmMs).length) return null;
  const out: Silence[] = [];
  let clock = 0;
  plan.chunks.forEach((chunk, i) => {
    const from = clock;
    clock += chunk.duration_ms;
    if (drafts[i]?.silence) out.push({ from: from / 1000, to: clock / 1000, section: chunk.text });
  });
  return { plan, silences: out };
}

/** The silences as mix spans: the bed at nothing, faded out and back in. */
export function silenceSpans(silences: Silence[]): LevelSpan[] {
  return (silences || []).map((s) => ({ from: s.from, to: s.to, db: SILENCE_DB, rampSec: SILENCE_RAMP_SEC }));
}
