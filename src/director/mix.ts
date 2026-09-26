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

// The level model — dB, spans, ducks, the default mix and the ffmpeg
// expression — is shared with the Auto Film job's server-side mix, so it lives
// in src/lib/score-mix.ts (vendored into the Worker) and is re-exported here.
import {
  DEFAULT_MIX,
  dbToGain,
  gainToDb,
  inRamp,
  levelExpression,
  rampOf,
  spanGainAt,
  type LevelSpan,
  type MixSettings,
} from '../lib/score-mix';
export { DEFAULT_MIX, dbToGain, gainToDb, levelExpression };
export type { LevelSpan, MixSettings };

/**
 * The bed's linear gain at one second of the film. The span level (with its
 * ramps — a Score silence fades out and back in) is `spanGainAt`, the same
 * function the server's ffmpeg expression is written from.
 */
export function levelAt(settings: MixSettings, t: number): number {
  let gain = spanGainAt(settings, t);
  for (const [from, to] of settings.ducks) {
    if (t >= from && t < to) gain *= dbToGain(settings.duckDb);
  }
  if (settings.fadeInSec > 0 && t < settings.fadeInSec) gain *= Math.max(0, t / settings.fadeInSec);
  return gain;
}

/**
 * The seconds at which the gain changes, in order — what a GainNode is
 * scheduled with and what the render steps through. Between two of these the
 * level is flat, except inside the fade and a span's ramps, which are slopes.
 */
export function levelBreakpoints(settings: MixSettings): number[] {
  const points = new Set<number>([0, settings.fadeInSec]);
  for (const span of settings.spans) {
    points.add(span.from);
    points.add(span.to);
    const r = rampOf(span);
    if (r > 0) {
      points.add(span.from + r);
      points.add(span.to - r);
    }
  }
  for (const [from, to] of settings.ducks) {
    points.add(from);
    points.add(to);
  }
  return [...points].filter((t) => Number.isFinite(t) && t >= 0).sort((a, b) => a - b);
}

/** True when the level ARRIVES at `t` along a ramp (so a GainNode should ramp to it, not step). */
export function endsRamp(settings: MixSettings, t: number): boolean {
  return settings.spans.some((span) => {
    const r = rampOf(span);
    return r > 0 && (Math.abs(t - (span.from + r)) < 1e-9 || Math.abs(t - span.to) < 1e-9);
  });
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
    // Inside the fade (and a span's ramps) the gain is a slope and is
    // recomputed per sample; elsewhere, only at a breakpoint.
    if (t < settings.fadeInSec || inRamp(settings, t)) {
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
