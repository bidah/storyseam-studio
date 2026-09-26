import { CHUNK_MAX_MS, CHUNK_MIN_MS, type Chunk, MAX_CHUNKS, type Plan, styleTags, validatePlan } from './music-plan';
import {
  MAX_SILENCES,
  type PictureTurn,
  SILENCE_CLEAR_END_MS,
  SILENCE_CLEAR_START_MS,
  SILENCE_MAX_MS,
  SILENCE_MIN_MS,
  SILENCE_NEGATIVE,
  SILENCE_POSITIVE,
  type Silence,
  momentsOnFilm,
} from './score-mix';

// THE MUSIC CUE LAYER — the score's pacing, written WITH the shot list.
//
// The Auto Film's Shot list stage asks the writing model for a second layer
// beside the shots: where the music turns, named from ONE fixed vocabulary
// (`MUSIC_CUES`), at the shot the story turns on, with an energy 1–5. A cue
// runs from its first shot until the next cue. Written there — by the model
// that is deciding what happens — rather than guessed afterwards from a
// finished film, the music turns where the STORY turns.
//
// The Score stage then lays the cues on the MEASURED film (`cuesOnFilm`:
// scaled by measured/planned, snapped to the nearest real picture cut) and
// groups them into PIECES (`piecesFromCues`): cues of one family stay one
// render, chunk by chunk; a change of family starts a new render; a silence
// is a gap nobody renders. Each piece is its own ElevenLabs composition plan,
// and the mix lays them at their offsets, crossfaded where they meet.
//
// Pure, and vendored by `npm run series:sync` into the Worker and the agent.

/** A cue's family: what stays one piece of music. `none` is the silence. */
export type CueFamily = 'tension' | 'drive' | 'light' | 'warm' | 'none';

export type CueSpec = {
  label: string;
  family: CueFamily;
  /** Style tags handed to ElevenLabs as positive_styles. */
  styles: string[];
  /** What this cue must not carry — handed on as negative_styles. */
  avoid: string[];
};

/** The fixed cue vocabulary. The writing model picks from these names and nothing else. */
export const MUSIC_CUES = {
  suspense: {
    label: 'Suspense',
    family: 'tension',
    styles: ['suspenseful underscore', 'low sustained strings', 'ticking pulse', 'sparse piano notes'],
    avoid: ['upbeat', 'major key melody', 'full drum kit'],
  },
  dread: {
    label: 'Dread',
    family: 'tension',
    styles: ['dark ambient drone', 'ominous low brass swells', 'dissonant strings', 'slow heartbeat percussion'],
    avoid: ['upbeat', 'bright melody', 'major key'],
  },
  adventure: {
    label: 'Adventure',
    family: 'drive',
    styles: ['adventurous orchestral', 'driving string ostinato', 'bold french horns', 'propulsive percussion'],
    avoid: ['sad', 'ambient drone'],
  },
  action: {
    label: 'Action',
    family: 'drive',
    styles: ['high-energy action score', 'pounding drums', 'staccato strings', 'brass hits', 'fast tempo'],
    avoid: ['slow tempo', 'ambient', 'solo piano'],
  },
  party: {
    label: 'Party',
    family: 'drive',
    styles: ['upbeat groove', 'funky bass', 'hand claps', 'bright synths', 'danceable rhythm'],
    avoid: ['dark', 'ominous', 'slow tempo'],
  },
  wonder: {
    label: 'Wonder',
    family: 'light',
    styles: ['magical', 'shimmering celesta', 'harp arpeggios', 'airy string pads', 'sense of awe'],
    avoid: ['heavy drums', 'distorted', 'dark'],
  },
  whimsy: {
    label: 'Whimsy',
    family: 'light',
    styles: ['playful', 'pizzicato strings', 'bouncy woodwinds', 'light glockenspiel', 'quirky rhythm'],
    avoid: ['heavy drums', 'dark', 'ominous'],
  },
  tender: {
    label: 'Tender',
    family: 'warm',
    styles: ['tender', 'warm solo piano', 'soft strings', 'intimate', 'gentle'],
    avoid: ['drums', 'percussion', 'brass stabs'],
  },
  triumph: {
    label: 'Triumph',
    family: 'warm',
    styles: ['triumphant', 'full orchestra', 'soaring brass', 'big timpani', 'major key'],
    avoid: ['dark', 'dissonant', 'minor key'],
  },
  sad: {
    label: 'Sad',
    family: 'warm',
    styles: ['melancholic', 'slow solo cello', 'sparse piano', 'minor key', 'rubato'],
    avoid: ['drums', 'upbeat', 'major key'],
  },
  silence: {
    label: 'Silence',
    family: 'none',
    styles: [],
    avoid: [],
  },
} as const satisfies Record<string, CueSpec>;

export type MusicCueName = keyof typeof MUSIC_CUES;
export const MUSIC_CUE_NAMES = Object.keys(MUSIC_CUES) as MusicCueName[];

/** Words a model reaches for instead of the vocabulary → the cue they mean. */
const CUE_ALIASES: Record<string, MusicCueName> = {
  tension: 'suspense', tense: 'suspense', mystery: 'suspense', mysterious: 'suspense', suspenseful: 'suspense',
  fear: 'dread', horror: 'dread', ominous: 'dread', dark: 'dread', danger: 'dread', menace: 'dread',
  journey: 'adventure', quest: 'adventure', heroic: 'adventure', explore: 'adventure', exploration: 'adventure',
  chase: 'action', fight: 'action', battle: 'action', combat: 'action', escape: 'action',
  dance: 'party', celebration: 'party', celebrate: 'party', fun: 'party', groove: 'party',
  magic: 'wonder', magical: 'wonder', awe: 'wonder', discovery: 'wonder', dream: 'wonder', dreamy: 'wonder',
  playful: 'whimsy', comedy: 'whimsy', comic: 'whimsy', quirky: 'whimsy', mischief: 'whimsy',
  love: 'tender', romance: 'tender', warm: 'tender', calm: 'tender', peaceful: 'tender', gentle: 'tender',
  victory: 'triumph', triumphant: 'triumph', epic: 'triumph', hope: 'triumph', hopeful: 'triumph',
  melancholy: 'sad', melancholic: 'sad', grief: 'sad', sorrow: 'sad', loss: 'sad',
  quiet: 'silence', none: 'silence', rest: 'silence', breath: 'silence', pause: 'silence', 'held breath': 'silence',
};

/** A name as the model wrote it → a cue of the vocabulary, or null. */
export function cueName(v: unknown): MusicCueName | null {
  const s = (typeof v === 'string' ? v : '').toLowerCase().replace(/[[\]]/g, '').trim();
  if (!s) return null;
  if ((MUSIC_CUE_NAMES as string[]).includes(s)) return s as MusicCueName;
  if (CUE_ALIASES[s]) return CUE_ALIASES[s];
  const word = s.split(/[^a-z]+/).find((w) => (MUSIC_CUE_NAMES as string[]).includes(w) || CUE_ALIASES[w]);
  if (!word) return null;
  return (MUSIC_CUE_NAMES as string[]).includes(word) ? (word as MusicCueName) : CUE_ALIASES[word];
}

export const familyOf = (cue: MusicCueName): CueFamily => MUSIC_CUES[cue]?.family ?? 'none';

/** A cue, as the Shot list stage keeps it. `startSec` is on the PLANNED clock. */
export type MusicCue = {
  /** 1-based index into the shot list. */
  startShot: number;
  cue: MusicCueName;
  /** 1 (barely there) – 5 (everything). */
  energy: number;
  note: string;
  /** The planned second it starts at: shot durations scaled to the Film plan's length. */
  startSec: number;
  /** The shot's id, when the caller knows it. */
  shotId?: string;
};

/** A music cue shorter than this reads as a sting, not a cue — it joins the one before. */
export const MIN_CUE_MS = 8_000;

/** How many cues to ask for, for a film this long: 4–8 at 2–3 minutes, scaling with length. */
export function musicCueRange(seconds: number): [number, number] {
  const s = Math.max(0, Number(seconds) || 0);
  const lo = Math.max(3, Math.min(4, Math.round(s / 30)), Math.round(s / 45) + 1);
  const hi = Math.max(lo + 2, 8, Math.round(s / 22));
  return [Math.min(lo, hi), hi];
}

const clean = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Each shot's start second on the planned clock: durations scaled to `plannedSec`. */
export function shotStarts(durs: number[], plannedSec: number): number[] {
  const d = durs.map((x) => Math.max(0, Number(x) || 0));
  const sum = d.reduce((a, b) => a + b, 0);
  const len = (i: number) => (sum > 0 ? (d[i] * plannedSec) / sum : plannedSec / Math.max(1, d.length));
  const out: number[] = [];
  let at = 0;
  d.forEach((_, i) => {
    out.push(at);
    at += len(i);
  });
  return out;
}

/**
 * The writing model's `music` answer → a cue layer that holds together. Sorted
 * by shot, one cue per shot, a repeat of the cue before it dropped (it is the
 * same cue carrying on), the first at shot 1, never opening or closing on a
 * silence, at most `MAX_SILENCES` silences, and every cue long enough to be
 * heard as one (`MIN_CUE_MS`; a silence, `SILENCE_MIN_MS`–`SILENCE_MAX_MS`) —
 * a short one joins the cue before it. Unknown cue names are read through the
 * aliases or dropped. Never throws: a missing or broken answer is no cues.
 *
 * `durs` are the saved shots' durations, `plannedSec` the Film plan's length;
 * `ids` (optional) the shots' ids, by index.
 */
export function repairMusicCues(
  answer: unknown,
  { durs, plannedSec, ids }: { durs: number[]; plannedSec: number; ids?: (string | undefined)[] },
): MusicCue[] {
  const raw = Array.isArray(answer) ? answer : [];
  const count = durs.length;
  if (!raw.length || !count || !(plannedSec > 0)) return [];
  const starts = shotStarts(durs, plannedSec);

  type Draft = { startShot: number; cue: MusicCueName; energy: number; note: string };
  let drafts: Draft[] = [];
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue;
    const cue = cueName((c as any).cue ?? (c as any).name ?? (c as any).mood);
    const shot = Math.round(Number((c as any).startShot ?? (c as any).shot));
    if (!cue || !Number.isFinite(shot)) continue;
    const e = Math.round(Number((c as any).energy));
    drafts.push({
      startShot: Math.min(count, Math.max(1, shot)),
      cue,
      energy: cue === 'silence' ? 1 : Number.isFinite(e) ? Math.min(5, Math.max(1, e)) : 3,
      note: clip(clean((c as any).note), 120),
    });
  }
  // Sorted, one per shot (the first written wins).
  drafts.sort((a, b) => a.startShot - b.startShot);
  drafts = drafts.filter((d, i) => i === 0 || d.startShot !== drafts[i - 1].startShot);

  const endOf = (i: number) => (i + 1 < drafts.length ? starts[drafts[i + 1].startShot - 1] : plannedSec) * 1000;
  const startOf = (i: number) => starts[drafts[i].startShot - 1] * 1000;

  // Repeat until nothing changes: each rule can make another one fire.
  for (let guard = 0; guard < 200; guard++) {
    if (!drafts.length) break;
    // Never open or close on a silence.
    if (drafts[0].cue === 'silence') { drafts.shift(); continue; }
    if (drafts.length && drafts[drafts.length - 1].cue === 'silence') { drafts.pop(); continue; }
    // The first cue starts at shot 1.
    if (drafts[0].startShot !== 1) { drafts[0] = { ...drafts[0], startShot: 1 }; continue; }
    // The same cue again is the cue carrying on.
    const repeat = drafts.findIndex((d, i) => i > 0 && d.cue === drafts[i - 1].cue);
    if (repeat > 0) { drafts.splice(repeat, 1); continue; }
    // Too short → joins the cue before (the first swallows the one after it).
    const short = drafts.findIndex((d, i) => {
      const len = endOf(i) - startOf(i);
      return d.cue === 'silence' ? len < SILENCE_MIN_MS || len > SILENCE_MAX_MS : len < MIN_CUE_MS;
    });
    if (short >= 0 && drafts.length > 1) {
      drafts.splice(short === 0 ? 1 : short, 1);
      continue;
    }
    // Too many silences → the latest ones play through.
    const silent = drafts.map((d, i) => (d.cue === 'silence' ? i : -1)).filter((i) => i >= 0);
    if (silent.length > MAX_SILENCES) { drafts.splice(silent[silent.length - 1], 1); continue; }
    break;
  }

  return drafts.map((d) => {
    const id = ids?.[d.startShot - 1];
    return { ...d, startSec: round1(starts[d.startShot - 1]), ...(id ? { shotId: String(id) } : {}) };
  });
}

/** A music cue on the MEASURED film. */
export type FilmCue = MusicCue & {
  /** The second it starts at in the finished film. */
  at: number;
  /** True when `at` is a measured picture cut, false when only the scaled time. */
  snapped: boolean;
};

/**
 * Cues from the planned clock onto the MEASURED film: scaled by
 * measured/planned, then snapped to the nearest real picture cut within the
 * window `momentsOnFilm` uses (1 s early, 4 s late — the film only runs late).
 * The first cue stays at 0; a cue landing within 3 s of the one before, or
 * past the end, is dropped (the cue before plays on).
 */
export function cuesOnFilm(
  cues: MusicCue[],
  { plannedSec, filmMs, cuts = [] }: { plannedSec: number; filmMs: number; cuts?: PictureTurn[] },
): FilmCue[] {
  const moments = (cues || []).map((c, i) => ({
    ...c,
    at: i === 0 ? 0 : c.startSec,
    planned: i === 0 ? 0 : c.startSec,
    title: MUSIC_CUES[c.cue]?.label || c.cue,
    what: c.note,
    dialogue: false,
  }));
  return momentsOnFilm(moments, { plannedSec, filmMs, cuts }).map((m) => {
    const { planned: _p, title: _t, what: _w, dialogue: _d, ...cue } = m as typeof m & MusicCue;
    return { ...(cue as MusicCue), at: m.at, snapped: Boolean(m.snapped) };
  });
}

// ── Pieces: several renders, not one song ────────────────────────────────

/** The overlap a piece runs past its end where the next piece starts, for the crossfade. */
export const PIECE_OVERLAP_MS = 1_000;
/** A Film's score is at most this many renders — past it, the shortest joins a neighbour. */
export const MAX_PIECES = 4;
/** The fade into and out of a silence, at a piece's edge. */
export const SILENCE_EDGE_FADE_SEC = 1.5;

const ENERGY_WORDS: Record<number, string[]> = {
  1: ['very soft', 'pianissimo', 'sparse'],
  2: ['soft', 'restrained'],
  3: ['moderate intensity'],
  4: ['intense', 'building'],
  5: ['full intensity', 'fortissimo', 'climactic'],
};
const ALWAYS_NEGATIVE = ['vocals', 'lyrics', 'singing'];

/** Two cues that can be one render: the same family, or drive/light a step apart in energy. */
export function sameMusic(a: { cue: MusicCueName; energy: number }, b: { cue: MusicCueName; energy: number }): boolean {
  const fa = familyOf(a.cue);
  const fb = familyOf(b.cue);
  if (fa === 'none' || fb === 'none') return false;
  if (fa === fb) return true;
  const lively = (f: CueFamily) => f === 'drive' || f === 'light';
  return lively(fa) && lively(fb) && Math.abs(a.energy - b.energy) <= 1;
}

/** One stretch of the film under one cue (or a silence). Milliseconds, film clock. */
export type CueSegment = { cue: MusicCueName; energy: number; note: string; startMs: number; endMs: number };

/** One render: where it sits in the film and the plan it is rendered from. */
export type ScorePiece = {
  index: number;
  /** Where it starts in the film. */
  startMs: number;
  /** Where it ends, INCLUDING any crossfade overlap into the next piece. */
  endMs: number;
  /** The render's length: `endMs - startMs`, what the plan adds up to. */
  lengthMs: number;
  fadeInSec: number;
  fadeOutSec: number;
  /** The cues it plays, in order (a silence inside a merged piece is `silence`). */
  cues: MusicCueName[];
  plan: Plan;
};

/** A stable 31-bit seed from a string — each piece its own, the same Film the same seeds. */
export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2_147_483_647;
}

const unionCi = (a: string[], b: string[]) => {
  const have = new Set(a.map((s) => s.toLowerCase()));
  const out = [...a];
  for (const s of b) if (!have.has(s.toLowerCase())) { have.add(s.toLowerCase()); out.push(s); }
  return out;
};

/** The film cues → stretches of the film, each at least a chunk long, silences where they can be. */
export function cueSegments(cues: FilmCue[], filmMs: number): CueSegment[] {
  const list = (cues || []).filter((c) => c && MUSIC_CUES[c.cue]);
  let segs: CueSegment[] = list.map((c, i) => ({
    cue: c.cue,
    energy: c.energy,
    note: c.note,
    startMs: i === 0 ? 0 : Math.round(c.at * 1000),
    endMs: i + 1 < list.length ? Math.round(list[i + 1].at * 1000) : filmMs,
  })).filter((s) => s.endMs > s.startMs);
  if (!segs.length) return [];
  segs[0] = { ...segs[0], startMs: 0 };
  segs[segs.length - 1] = { ...segs[segs.length - 1], endMs: filmMs };

  // `i` joins its neighbour: the one before (or, for the first, the one after) takes its time.
  const absorb = (i: number) => {
    if (segs.length < 2) return;
    if (i > 0) segs.splice(i - 1, 2, { ...segs[i - 1], endMs: segs[i].endMs });
    else segs.splice(0, 2, { ...segs[1], startMs: 0 });
  };
  for (let guard = 0; guard < 200 && segs.length > 1; guard++) {
    const bad = segs.findIndex((s, i) => {
      const len = s.endMs - s.startMs;
      if (s.cue !== 'silence') return len < CHUNK_MIN_MS;
      return i === 0 || i === segs.length - 1 || len < SILENCE_MIN_MS || len > SILENCE_MAX_MS ||
        s.startMs < SILENCE_CLEAR_START_MS || s.endMs > filmMs - SILENCE_CLEAR_END_MS;
    });
    if (bad >= 0) { absorb(bad); continue; }
    const repeat = segs.findIndex((s, i) => i > 0 && s.cue === segs[i - 1].cue);
    if (repeat > 0) { segs.splice(repeat - 1, 2, { ...segs[repeat - 1], endMs: segs[repeat].endMs }); continue; }
    break;
  }
  if (segs.length === 1 && segs[0].cue === 'silence') return [];
  return segs;
}

/** A segment as a chunk of a piece's plan. */
function chunkOf(seg: CueSegment, durationMs: number, opts: { first: boolean; genre: string[]; prev?: CueSegment; ending?: 'film' | 'fade' | null }): Chunk {
  if (seg.cue === 'silence') {
    return {
      text: '[Held breath]',
      duration_ms: durationMs,
      positive_styles: [...SILENCE_POSITIVE],
      negative_styles: [...SILENCE_NEGATIVE],
      context_adherence: 'high',
    };
  }
  const spec = MUSIC_CUES[seg.cue];
  let pos = unionCi(opts.first ? opts.genre : [], [...spec.styles, ...(ENERGY_WORDS[seg.energy] || ENERGY_WORDS[3])]);
  if (opts.ending === 'film') pos = unionCi(pos, ['final sustained chord', 'clean ending']);
  // What LEAVES: the styles of the cue before that this one does not carry, then its own avoid list.
  const leaving = opts.prev && opts.prev.cue !== 'silence'
    ? MUSIC_CUES[opts.prev.cue].styles.filter((s) => !spec.styles.includes(s as never)).slice(0, 3)
    : [];
  const neg = unionCi(unionCi([...ALWAYS_NEGATIVE], [...spec.avoid]), leaving)
    .filter((s) => !pos.some((p) => p.toLowerCase() === s.toLowerCase()));
  const changesFamily = opts.prev && opts.prev.cue !== 'silence' && familyOf(opts.prev.cue) !== familyOf(seg.cue);
  return {
    text: `[${spec.label}]`,
    duration_ms: durationMs,
    positive_styles: pos,
    negative_styles: neg,
    context_adherence: changesFamily ? 'medium' : 'high',
  };
}

/** Cut chunks over the maximum into equal parts; join the shortest pairs past the chunk ceiling. */
function fitChunks(chunks: Chunk[]): Chunk[] {
  let out = chunks.flatMap((c) => {
    if (c.duration_ms <= CHUNK_MAX_MS) return [c];
    const parts = Math.ceil(c.duration_ms / CHUNK_MAX_MS);
    const each = Math.floor(c.duration_ms / parts);
    return Array.from({ length: parts }, (_, i) => ({
      ...c,
      text: i === 0 ? c.text : `${c.text.replace(/\]\s*$/, '')} ${i + 1}]`,
      duration_ms: i === parts - 1 ? c.duration_ms - each * (parts - 1) : each,
    }));
  });
  while (out.length > MAX_CHUNKS) {
    let at = 1;
    for (let i = 2; i < out.length; i++) {
      if (out[i].duration_ms + out[i - 1].duration_ms < out[at].duration_ms + out[at - 1].duration_ms) at = i;
    }
    if (out[at].duration_ms + out[at - 1].duration_ms > CHUNK_MAX_MS) break;
    out = [...out.slice(0, at - 1), { ...out[at - 1], duration_ms: out[at - 1].duration_ms + out[at].duration_ms }, ...out.slice(at + 1)];
  }
  return out;
}

/**
 * Cues on the film → the pieces to render, and the silences to mute.
 *
 * Consecutive cues that are the same music (`sameMusic`) are ONE piece, one
 * chunk per cue; a change of family starts a new piece; a silence is a gap no
 * piece covers. A piece that runs straight into the next one runs
 * `PIECE_OVERLAP_MS` past it, for the crossfade (never into a silence). Past
 * `MAX_PIECES`, the shortest piece joins a neighbour — the one it touches when
 * it touches one, otherwise across the silence between (which then becomes a
 * `[Held breath]` chunk in the joined piece, still muted by the mix). Each
 * piece has its own seed. Returns null when no cue survives, or a plan comes
 * out that fal would refuse — the caller then scores the old way.
 */
export function piecesFromCues(
  cues: FilmCue[],
  filmMs: number,
  brief: string,
  { seedBase = '' }: { seedBase?: string } = {},
): { pieces: ScorePiece[]; silences: Silence[] } | null {
  if (!(filmMs >= CHUNK_MIN_MS)) return null;
  const segs = cueSegments(cues, filmMs);
  if (!segs.length) return null;
  const tags = styleTags(brief || '');
  const genre = tags.length ? tags : ['instrumental score'];

  // Runs of segment indices. Silences split; a family change splits.
  let groups: number[][] = [];
  segs.forEach((s, i) => {
    if (s.cue === 'silence') return;
    const last = groups[groups.length - 1];
    const prev = segs[i - 1];
    if (last && last[last.length - 1] === i - 1 && prev && sameMusic(prev, s)) last.push(i);
    else groups.push([i]);
  });
  const span = (g: number[]) => segs[g[g.length - 1]].endMs - segs[g[0]].startMs;
  const touches = (a: number[], b: number[]) => a[a.length - 1] + 1 === b[0];
  const join = (a: number[], b: number[]) => {
    const out: number[] = [];
    for (let i = a[0]; i <= b[b.length - 1]; i++) out.push(i);
    return out;
  };
  while (groups.length > 1) {
    let shortest = 0;
    groups.forEach((g, i) => { if (span(g) < span(groups[shortest])) shortest = i; });
    if (groups.length <= MAX_PIECES && span(groups[shortest]) >= CHUNK_MIN_MS) break;
    const g = groups[shortest];
    const before = groups[shortest - 1];
    const after = groups[shortest + 1];
    let into: number;
    if (before && touches(before, g)) into = shortest - 1;
    else if (after && touches(g, after)) into = shortest + 1;
    else into = before ? shortest - 1 : shortest + 1;
    const [a, b] = into < shortest ? [into, shortest] : [shortest, into];
    groups = [...groups.slice(0, a), join(groups[a], groups[b]), ...groups.slice(b + 1)];
  }

  const pieces: ScorePiece[] = [];
  for (let p = 0; p < groups.length; p++) {
    const g = groups[p];
    const startMs = segs[g[0]].startMs;
    const lastSeg = segs[g[g.length - 1]];
    const next = groups[p + 1];
    const intoNext = Boolean(next && touches(g, next));
    const endsFilm = lastSeg.endMs >= filmMs;
    const overlap = intoNext ? Math.min(PIECE_OVERLAP_MS, filmMs - lastSeg.endMs) : 0;
    const endMs = lastSeg.endMs + overlap;
    const prevGroup = groups[p - 1];
    const fromPrev = Boolean(prevGroup && touches(prevGroup, g));

    let chunks: Chunk[] = g.map((si, k) => {
      const seg = segs[si];
      const dur = seg.endMs - seg.startMs + (k === g.length - 1 ? overlap : 0);
      return chunkOf(seg, dur, {
        first: k === 0,
        genre,
        prev: k > 0 ? segs[g[k - 1]] : undefined,
        ending: k === g.length - 1 && endsFilm ? 'film' : null,
      });
    });
    chunks = fitChunks(chunks);
    const plan: Plan = { chunks, seed: seedOf(`${seedBase}|${brief}|${p}|${startMs}`) };
    const lengthMs = endMs - startMs;
    if (validatePlan(plan, lengthMs).length) return null;
    pieces.push({
      index: p,
      startMs,
      endMs,
      lengthMs,
      fadeInSec: startMs === 0 ? 1 : fromPrev ? PIECE_OVERLAP_MS / 1000 : SILENCE_EDGE_FADE_SEC,
      fadeOutSec: endsFilm ? 0 : intoNext ? PIECE_OVERLAP_MS / 1000 : SILENCE_EDGE_FADE_SEC,
      cues: g.map((i) => segs[i].cue),
      plan,
    });
  }
  if (!pieces.length) return null;

  const silences: Silence[] = segs
    .filter((s) => s.cue === 'silence')
    .map((s) => ({ from: s.startMs / 1000, to: s.endMs / 1000, section: '[Held breath]' }));
  return { pieces, silences };
}

/**
 * The pieces as one line: `3 pieces: Adventure → Party | silence | Suspense → Dread | Tender · 2 silences`.
 * A `|` alone is a crossfade; `| silence |` a gap.
 */
export function piecesSummary(pieces: Pick<ScorePiece, 'startMs' | 'endMs' | 'cues'>[], silences: Silence[] = []): string {
  if (!pieces.length) return 'no pieces';
  const label = (c: MusicCueName) => (c === 'silence' ? '(silence)' : MUSIC_CUES[c]?.label || c);
  let line = '';
  pieces.forEach((p, i) => {
    if (i > 0) {
      // A crossfade overlaps the next piece; a silence leaves a gap before it.
      line += pieces[i - 1].endMs < p.startMs ? ' | silence | ' : ' | ';
    }
    line += p.cues.map(label).join(' → ');
  });
  const n = silences.length;
  return `${pieces.length} piece${pieces.length === 1 ? '' : 's'}: ${line}${n ? ` · ${n} silence${n === 1 ? '' : 's'}` : ''}`;
}
