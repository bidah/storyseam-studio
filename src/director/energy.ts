// Checking a rendered cue WITHOUT listening: `energy-profile.py`, in the browser.
//
// Per window it reports RMS, kick-band transients (below 150 Hz) and
// snare-band transients (2–5 kHz). A calm chunk reads as a low RMS and ~0
// snare transients; drums arriving reads as both bands jumping; a drop reads
// as both falling. Plain onset counting cannot do this — an arpeggiated
// sequencer makes as many onsets as a drum kit, which is how the first h3-ref
// render's "calm" opening passed by ear and by count with a full kit in it.
//
// The filters are second-order Butterworth biquads applied in JS rather than
// an OfflineAudioContext, so this is pure and the numbers are the same in a
// test as on screen.

export type EnergyWindow = {
  from: number;
  to: number;
  rmsDb: number;
  kick: number;
  snare: number;
};

/** The envelope grain of the script: 50 frames a second. */
const ENVELOPE_HZ = 50;

type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

function lowpass(sampleRate: number, hz: number): Biquad {
  const w0 = (2 * Math.PI * hz) / sampleRate;
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const cos = Math.cos(w0);
  const a0 = 1 + alpha;
  return {
    b0: (1 - cos) / 2 / a0,
    b1: (1 - cos) / a0,
    b2: (1 - cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

function highpass(sampleRate: number, hz: number): Biquad {
  const w0 = (2 * Math.PI * hz) / sampleRate;
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const cos = Math.cos(w0);
  const a0 = 1 + alpha;
  return {
    b0: (1 + cos) / 2 / a0,
    b1: -(1 + cos) / a0,
    b2: (1 + cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

function filter(samples: Float32Array, coef: Biquad): Float32Array {
  const out = new Float32Array(samples.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = coef.b0 * x0 + coef.b1 * x1 + coef.b2 * x2 - coef.a1 * y1 - coef.a2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    out[i] = y0;
  }
  return out;
}

/** RMS per 20 ms hop — the envelope the transient count is taken from. */
export function envelope(samples: Float32Array, sampleRate: number): Float32Array {
  const hop = Math.max(1, Math.floor(sampleRate / ENVELOPE_HZ));
  const frames = Math.floor(samples.length / hop);
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const start = f * hop;
    for (let i = start; i < start + hop; i++) sum += samples[i] * samples[i];
    env[f] = Math.sqrt(sum / hop);
  }
  return env;
}

/**
 * Transients per window: rises in the envelope over 15 % of its peak. The
 * threshold is relative to the whole piece, which is what makes a quiet
 * opening read as quiet — its rises are small against the battle's.
 */
export function transientsPerWindow(env: Float32Array, windowSec: number): number[] {
  let peak = 0;
  for (const v of env) peak = Math.max(peak, v);
  const threshold = peak * 0.15;
  const perWindow = windowSec * ENVELOPE_HZ;
  const windows = Math.ceil(env.length / perWindow);
  const counts: number[] = [];
  for (let w = 0; w < windows; w++) {
    let count = 0;
    const start = Math.max(1, w * perWindow);
    const end = Math.min(env.length, (w + 1) * perWindow);
    for (let i = start; i < end; i++) {
      if (env[i] - env[i - 1] > threshold) count++;
    }
    counts.push(count);
  }
  return counts;
}

export function energyProfile(samples: Float32Array, sampleRate: number, windowSec = 10): EnergyWindow[] {
  const full = envelope(samples, sampleRate);
  const kick = transientsPerWindow(envelope(filter(samples, lowpass(sampleRate, 150)), sampleRate), windowSec);
  const snare = transientsPerWindow(
    envelope(filter(filter(samples, highpass(sampleRate, 2000)), lowpass(sampleRate, 5000)), sampleRate),
    windowSec,
  );
  const perWindow = windowSec * ENVELOPE_HZ;
  const out: EnergyWindow[] = [];
  for (let w = 0; w < kick.length; w++) {
    const start = w * perWindow;
    const end = Math.min(full.length, (w + 1) * perWindow);
    let sum = 0;
    for (let i = start; i < end; i++) sum += full[i];
    const mean = sum / Math.max(1, end - start);
    out.push({
      from: w * windowSec,
      to: Math.min((w + 1) * windowSec, full.length / ENVELOPE_HZ),
      rmsDb: mean <= 0 ? -99 : 20 * Math.log10(mean),
      kick: kick[w],
      snare: snare[w] ?? 0,
    });
  }
  return out;
}
