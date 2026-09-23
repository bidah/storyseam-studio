// Laying the cue under the film: the arithmetic of `mix-under-film.sh`, in
// samples instead of an ffmpeg filter graph.
//
//   [cue] fade in 1 s → level per span → ducks → [bed]
//   [film] untouched, full level
//   mix = film + bed, then a limiter at 0.98
//
// The film's own audio is never moved. The one thing this file is careful
// about is that the null test of the script still holds: where the bed is
// silent, the mix IS the film.
//
// Pure functions over Float32Array, so the schedule and the limiter are tested
// without an AudioContext, and the same code drives the live preview (a
// GainNode scheduled from `levelAt`) and the final render.

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

/** The bed's linear gain at one second of the film. */
export function levelAt(settings: MixSettings, t: number): number {
  let db = settings.baseDb;
  for (const span of settings.spans) {
    if (t >= span.from && t < span.to) db = span.db;
  }
  let gain = dbToGain(db);
  for (const [from, to] of settings.ducks) {
    if (t >= from && t < to) gain *= dbToGain(settings.duckDb);
  }
  if (settings.fadeInSec > 0 && t < settings.fadeInSec) gain *= Math.max(0, t / settings.fadeInSec);
  return gain;
}

/**
 * The seconds at which the gain changes, in order — what a GainNode is
 * scheduled with and what the render steps through. Between two of these the
 * level is flat (except inside the fade, which is a ramp from 0).
 */
export function levelBreakpoints(settings: MixSettings): number[] {
  const points = new Set<number>([0, settings.fadeInSec]);
  for (const span of settings.spans) {
    points.add(span.from);
    points.add(span.to);
  }
  for (const [from, to] of settings.ducks) {
    points.add(from);
    points.add(to);
  }
  return [...points].filter((t) => Number.isFinite(t) && t >= 0).sort((a, b) => a - b);
}

/** The ffmpeg expression the script would have been given — for the record on the row. */
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
 * A peak limiter: the last thing the mix goes through, so a loud scene plus a
 * loud bar of the cue cannot clip. Fast attack, slower release, gain computed
 * from the running peak. Not transparent — nothing this short is — but it is
 * only ever working during the few frames the sum goes over, which is the deal
 * `alimiter=limit=0.98:level=false` made.
 */
export function limit(samples: Float32Array, sampleRate: number, ceiling = 0.98): Float32Array {
  const out = new Float32Array(samples.length);
  const releaseCoef = Math.exp(-1 / (sampleRate * 0.05));
  let reduction = 1;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const peak = Math.abs(x);
    const wanted = peak > ceiling ? ceiling / peak : 1;
    // Attack is instant; release relaxes back to unity.
    reduction = wanted < reduction ? wanted : reduction + (1 - reduction) * (1 - releaseCoef);
    out[i] = x * reduction;
  }
  return out;
}

/**
 * The mix itself. `film` and `cue` are mono at `sampleRate`; the result is the
 * film's length, the cue cut or padded to it.
 */
export function mixDown(
  film: Float32Array,
  cue: Float32Array,
  sampleRate: number,
  settings: MixSettings,
): Float32Array {
  const out = new Float32Array(film.length);
  const breakpoints = levelBreakpoints(settings);
  let next = 0;
  let gain = levelAt(settings, 0);
  for (let i = 0; i < film.length; i++) {
    const t = i / sampleRate;
    // Inside the fade the gain is a ramp and is recomputed per sample; past it,
    // only at a breakpoint. Cheap enough either way; the fade is a second.
    if (t < settings.fadeInSec) {
      gain = levelAt(settings, t);
    } else if (next < breakpoints.length && t >= breakpoints[next]) {
      while (next < breakpoints.length && t >= breakpoints[next]) next++;
      gain = levelAt(settings, t);
    }
    const bed = i < cue.length ? cue[i] * gain : 0;
    out[i] = film[i] + bed;
  }
  return limit(out, sampleRate);
}

/** RMS in dBFS of a stretch, for the null test and the meters. */
export function rmsDb(samples: Float32Array, from = 0, to = samples.length): number {
  let sum = 0;
  const n = Math.max(1, to - from);
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return gainToDb(Math.sqrt(sum / n));
}

/**
 * The null test: the RMS of (mix − film). It cannot be −90 dB here because the
 * bed plays throughout; what is checked is that it sits near the bed's own
 * level (around −40 dBFS) and not near 0 dB, which would mean the scene
 * itself was moved.
 */
export function nullTestDb(mix: Float32Array, film: Float32Array): number {
  const n = Math.min(mix.length, film.length);
  const diff = new Float32Array(n);
  for (let i = 0; i < n; i++) diff[i] = mix[i] - film[i];
  return rmsDb(diff);
}
