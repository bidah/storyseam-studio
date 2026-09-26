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

// `duckWindows` — where the film's own audio is loud enough that the score
// must get out from under it — is shared with the Auto Film job's server-side
// mix, so it lives in src/lib/score-mix.ts and is re-exported here.
export { duckWindows } from '../lib/score-mix';
