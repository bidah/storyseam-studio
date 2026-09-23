// Where the film's clock actually turns. `probe-film.sh`, pure.
//
// The cue sheet says where a beat was WRITTEN to land; the film lands it two
// to seven seconds later, and by the end a plan built from the sheet resolves
// while the mecha is still landing. So the plan is built from the film: one
// loudness figure per second, and the frames beside it. The loudness finds the
// candidates — a jump into something loud, a quiet hole before a reveal — and
// the frames say which of those it was.

/** One loudness figure per second, in dBFS RMS. */
export function loudnessPerSecond(samples: Float32Array, sampleRate: number): number[] {
  const seconds = Math.floor(samples.length / sampleRate);
  const row: number[] = [];
  for (let s = 0; s < seconds; s++) {
    let sum = 0;
    const start = s * sampleRate;
    for (let i = start; i < start + sampleRate; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / sampleRate);
    row.push(rms <= 0 ? -99 : Math.round(20 * Math.log10(rms)));
  }
  return row;
}

export type Turn = {
  at: number;
  kind: 'jump' | 'dip';
  /** dB of the change, for the label. */
  by: number;
};

/**
 * The seconds worth looking at: a rise of 8 dB or more in one second (a cut
 * into something loud — the klaxon, the first hit, the launch), or a fall of
 * 10 dB or more held for two seconds (the quiet hole before a reveal — the
 * alien rising, the moment before the kill shot, the landing).
 */
export function findTurns(loudness: number[], jumpDb = 8, dipDb = 10): Turn[] {
  const turns: Turn[] = [];
  for (let s = 1; s < loudness.length; s++) {
    const delta = loudness[s] - loudness[s - 1];
    if (delta >= jumpDb) {
      turns.push({ at: s, kind: 'jump', by: delta });
    } else if (-delta >= dipDb && s + 1 < loudness.length && loudness[s - 1] - loudness[s + 1] >= dipDb) {
      turns.push({ at: s, kind: 'dip', by: delta });
    }
  }
  // Two turns a second apart are one turn; keep the first.
  return turns.filter((turn, i) => i === 0 || turn.at - turns[i - 1].at > 1);
}

/** `1:08`, how a second of film is spoken about. */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * Where the film's own audio is doing something the score must get out from
 * under — its dialogue and its impacts, MEASURED.
 *
 * The mix's `ducks` used to be a hand-typed list, which is fine for one film
 * and wrong for every one after it: the windows are a property of the take, and
 * a take is not deterministic. So they are read off the film instead.
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
