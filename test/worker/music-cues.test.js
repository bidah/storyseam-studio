// The music cue layer (src/lib/music-cues.ts): the cues the Shot list stage
// writes, repaired; laid on the MEASURED film; grouped into the pieces the
// Score stage renders — every piece a plan fal will take — and the mix that
// lays several pieces under the picture.
import { describe, it, expect } from "vitest";
import {
  MUSIC_CUES,
  MUSIC_CUE_NAMES,
  MAX_PIECES,
  cueName,
  cuesOnFilm,
  musicCueRange,
  piecesFromCues,
  piecesSummary,
  repairMusicCues,
  sameMusic,
} from "../../worker/src/lib/music-cues.ts";
import { validatePlan, planTotalMs, CHUNK_MIN_MS } from "../../worker/src/lib/music-plan.ts";
import { mixArgs, mixJobScript, piecesBedGraph } from "../../worker/src/lib/film-score.js";
import { DEFAULT_MIX, bedVolumeExpression } from "../../worker/src/lib/score-mix.ts";

const fc = (cue, at, energy = 3) => ({ startShot: 1, cue, energy, note: "", startSec: at, at, snapped: false });

describe("the cue vocabulary", () => {
  it("is fixed, each cue with a family and (except silence) style tags", () => {
    expect(MUSIC_CUE_NAMES).toEqual([
      "suspense", "dread", "adventure", "action", "party", "wonder", "whimsy", "tender", "triumph", "sad", "silence",
    ]);
    expect(MUSIC_CUES.suspense.family).toBe("tension");
    expect(MUSIC_CUES.party.family).toBe("drive");
    expect(MUSIC_CUES.whimsy.family).toBe("light");
    expect(MUSIC_CUES.sad.family).toBe("warm");
    expect(MUSIC_CUES.silence.family).toBe("none");
    for (const n of MUSIC_CUE_NAMES.filter((n) => n !== "silence")) expect(MUSIC_CUES[n].styles.length).toBeGreaterThan(2);
  });

  it("reads a model's near-misses through aliases, and nothing else", () => {
    expect(cueName("Suspense")).toBe("suspense");
    expect(cueName("[Chase]")).toBe("action");
    expect(cueName("melancholy")).toBe("sad");
    expect(cueName("a quiet moment")).toBe("silence");
    expect(cueName("kazoo solo")).toBeNull();
    expect(cueName(42)).toBeNull();
  });

  it("asks for 4–8 cues at 2–3 minutes, more for longer films", () => {
    expect(musicCueRange(120)).toEqual([4, 8]);
    expect(musicCueRange(180)).toEqual([5, 8]);
    const [lo, hi] = musicCueRange(300);
    expect(lo).toBeGreaterThan(5);
    expect(hi).toBeGreaterThan(8);
  });
});

describe("repairMusicCues", () => {
  const durs = Array.from({ length: 30 }, () => 4); // 120 s of shots
  it("sorts, dedupes, clamps and scales to the plan's seconds", () => {
    const cues = repairMusicCues(
      [
        { startShot: 12, cue: "action", energy: 7 },
        { startShot: 3, cue: "wonder", energy: 0 }, // the first becomes shot 1
        { startShot: 12, cue: "sad" }, // same shot again: the first written wins
        { startShot: 99, cue: "triumph", energy: 4 }, // clamped to the last shot… then too short, joins
        { startShot: 20, cue: "kazoo" }, // dropped
        { startShot: 22, cue: "tender", energy: "2" },
      ],
      { durs, plannedSec: 180, ids: durs.map((_, i) => String(i + 1).padStart(2, "0")) },
    );
    expect(cues).toEqual([
      { startShot: 1, cue: "wonder", energy: 1, note: "", startSec: 0, shotId: "01" },
      { startShot: 12, cue: "action", energy: 5, note: "", startSec: 66, shotId: "12" },
      { startShot: 22, cue: "tender", energy: 2, note: "", startSec: 126, shotId: "22" },
    ]);
  });

  it("never opens or closes on a silence, joins repeats and short cues into the one before", () => {
    const cues = repairMusicCues(
      [
        { startShot: 1, cue: "silence" },
        { startShot: 2, cue: "adventure" },
        { startShot: 6, cue: "adventure" }, // carrying on
        { startShot: 10, cue: "dread" }, // 4 s — too short: Adventure plays on
        { startShot: 11, cue: "action" },
        { startShot: 15, cue: "silence" }, // 8 s — a silence may be short
        { startShot: 17, cue: "triumph" },
        { startShot: 29, cue: "silence" }, // the last cue: plays through
      ],
      { durs, plannedSec: 120 },
    );
    expect(cues.map((c) => [c.startShot, c.cue])).toEqual([[1, "adventure"], [11, "action"], [15, "silence"], [17, "triumph"]]);
  });

  it("no music is no cues", () => {
    expect(repairMusicCues(undefined, { durs, plannedSec: 120 })).toEqual([]);
    expect(repairMusicCues([{ cue: "kazoo", startShot: 1 }], { durs, plannedSec: 120 })).toEqual([]);
    expect(repairMusicCues([{ cue: "wonder", startShot: 1 }], { durs: [], plannedSec: 120 })).toEqual([]);
  });
});

describe("cuesOnFilm", () => {
  it("scales planned seconds by measured/planned and snaps to the nearest real cut", () => {
    const cues = [
      { startShot: 1, cue: "wonder", energy: 2, note: "", startSec: 0 },
      { startShot: 8, cue: "whimsy", energy: 3, note: "", startSec: 30 }, // → 31.85, snaps to 31.2
      { startShot: 16, cue: "silence", energy: 1, note: "", startSec: 60 }, // → 63.7, snaps to 64.1
      { startShot: 18, cue: "action", energy: 5, note: "", startSec: 66 }, // → 70.07, no cut in reach
    ];
    const cuts = [{ at: 31.2, score: 0.6 }, { at: 33, score: 0.3 }, { at: 64.1, score: 0.9 }, { at: 125, score: 0.9 }];
    const on = cuesOnFilm(cues, { plannedSec: 120, filmMs: 127400, cuts });
    expect(on.map((c) => [c.cue, c.at, c.snapped])).toEqual([
      ["wonder", 0, false], ["whimsy", 31.2, true], ["silence", 64.1, true], ["action", 70.1, false],
    ]);
    expect(on[1]).toMatchObject({ startShot: 8, startSec: 30, energy: 3 });
  });
});

describe("piecesFromCues", () => {
  const BRIEF = "warm strings, celesta, 90 BPM";
  const FILM = 150_000;
  const cues = [
    fc("adventure", 0, 3), fc("party", 20, 4), // drive → one piece
    fc("silence", 40), // a gap
    fc("suspense", 46, 2), fc("dread", 70, 3), // tension → one piece
    fc("tender", 100, 2), // warm → a new piece, crossfaded
  ];

  it("groups by family, gaps at silences, crossfades where pieces meet", () => {
    const { pieces, silences } = piecesFromCues(cues, FILM, BRIEF, { seedBase: "film-1" });
    expect(pieces.map((p) => [p.startMs, p.endMs, p.lengthMs])).toEqual([
      [0, 40_000, 40_000], // ends INTO a silence: no overlap
      [46_000, 101_000, 55_000], // runs 1 s into the Tender piece
      [100_000, 150_000, 50_000],
    ]);
    expect(pieces.map((p) => p.cues)).toEqual([["adventure", "party"], ["suspense", "dread"], ["tender"]]);
    expect(pieces.map((p) => [p.fadeInSec, p.fadeOutSec])).toEqual([[1, 1.5], [1.5, 1], [1, 0]]);
    expect(silences).toEqual([{ from: 40, to: 46, section: "[Held breath]" }]);
    expect(piecesSummary(pieces, silences)).toBe("3 pieces: Adventure → Party | silence | Suspense → Dread | Tender · 1 silence");
  });

  it("every piece is a plan fal takes: one chunk per cue, adding up to the piece, its own seed", () => {
    const { pieces } = piecesFromCues(cues, FILM, BRIEF, { seedBase: "film-1" });
    for (const p of pieces) {
      expect(validatePlan(p.plan, p.lengthMs)).toEqual([]);
      expect(planTotalMs(p.plan)).toBe(p.lengthMs);
      for (const c of p.plan.chunks) {
        expect(c.negative_styles).toEqual(expect.arrayContaining(["vocals", "lyrics"]));
      }
    }
    expect(pieces[0].plan.chunks.map((c) => [c.text, c.duration_ms])).toEqual([["[Adventure]", 20_000], ["[Party]", 20_000]]);
    // The brief's genre opens every piece; the cue's own tags and its energy follow.
    expect(pieces[0].plan.chunks[0].positive_styles.slice(0, 3)).toEqual(["warm strings", "celesta", "90 BPM"]);
    expect(pieces[0].plan.chunks[0].positive_styles).toEqual(expect.arrayContaining(MUSIC_CUES.adventure.styles));
    expect(pieces[0].plan.chunks[1].positive_styles).toEqual(expect.arrayContaining(["intense"]));
    expect(pieces[0].plan.chunks[1].positive_styles).not.toContain("warm strings");
    // What LEAVES: the Adventure tags Party does not carry.
    expect(pieces[0].plan.chunks[1].negative_styles).toContain("adventurous orchestral");
    expect(pieces[2].plan.chunks[0].positive_styles).toEqual(expect.arrayContaining(["warm strings", "final sustained chord"]));
    const seeds = pieces.map((p) => p.plan.seed);
    expect(new Set(seeds).size).toBe(3);
    expect(seeds.every(Number.isInteger)).toBe(true);
    // The same Film makes the same seeds.
    expect(piecesFromCues(cues, FILM, BRIEF, { seedBase: "film-1" }).pieces.map((p) => p.plan.seed)).toEqual(seeds);
  });

  it("drive and light a step apart in energy stay one piece; further apart they split", () => {
    expect(sameMusic({ cue: "action", energy: 4 }, { cue: "whimsy", energy: 3 })).toBe(true);
    expect(sameMusic({ cue: "action", energy: 5 }, { cue: "whimsy", energy: 2 })).toBe(false);
    expect(sameMusic({ cue: "tender", energy: 2 }, { cue: "triumph", energy: 5 })).toBe(true);
    expect(sameMusic({ cue: "tender", energy: 2 }, { cue: "wonder", energy: 2 })).toBe(false);
  });

  it(`never more than ${MAX_PIECES} pieces: the shortest joins the neighbour it touches`, () => {
    const many = [
      fc("action", 0, 5), fc("tender", 15, 2), fc("dread", 40, 3), fc("whimsy", 65, 3), fc("sad", 90, 2), fc("triumph", 115, 5),
    ];
    const { pieces } = piecesFromCues(many, FILM, BRIEF);
    expect(pieces).toHaveLength(4);
    expect(pieces[0].cues).toEqual(["action", "tender"]); // the 15 s Action piece joined Tender
    for (const p of pieces) expect(validatePlan(p.plan, p.lengthMs)).toEqual([]);
    // Consecutive pieces meet (crossfade) — the whole film is covered.
    expect(pieces[0].startMs).toBe(0);
    expect(pieces.at(-1).endMs).toBe(FILM);
    pieces.slice(1).forEach((p, i) => expect(pieces[i].endMs).toBe(p.startMs + 1000));
  });

  it("across a silence when nothing touches — the silence rides inside as a [Held breath] chunk", () => {
    const gaps = [
      fc("action", 0, 5), fc("silence", 20), fc("tender", 26, 2), fc("silence", 40), fc("dread", 46, 3),
      fc("silence", 60), fc("whimsy", 66, 3), fc("silence", 80), fc("sad", 86, 2),
    ];
    const { pieces, silences } = piecesFromCues(gaps, FILM, BRIEF);
    expect(pieces).toHaveLength(4);
    expect(silences).toHaveLength(4);
    const joined = pieces.find((p) => p.cues.includes("silence"));
    expect(joined.plan.chunks.map((c) => c.text)).toContain("[Held breath]");
    for (const p of pieces) expect(validatePlan(p.plan, p.lengthMs)).toEqual([]);
  });

  it("a cue shorter than a chunk joins the one before; a stray silence at an edge plays", () => {
    const { pieces, silences } = piecesFromCues(
      [fc("adventure", 0), fc("dread", 10), fc("tender", 11.5), fc("silence", 147)],
      FILM, BRIEF,
    );
    expect(silences).toEqual([]);
    expect(pieces.map((p) => [p.cues, p.startMs])).toEqual([[["adventure"], 0], [["tender"], 11_500]]);
    expect(pieces[1].endMs).toBe(FILM);
    for (const p of pieces) expect(p.lengthMs).toBeGreaterThanOrEqual(CHUNK_MIN_MS);
  });

  it("a piece longer than a chunk may be is cut into chunks of the same cue", () => {
    const { pieces } = piecesFromCues([fc("wonder", 0, 2)], 300_000, BRIEF);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].plan.chunks.map((c) => c.text)).toEqual(["[Wonder]", "[Wonder 2]", "[Wonder 3]"]);
    expect(validatePlan(pieces[0].plan, 300_000)).toEqual([]);
  });

  it("no cues → null (the Score stage scores the old way)", () => {
    expect(piecesFromCues([], FILM, BRIEF)).toBeNull();
    expect(piecesFromCues([fc("silence", 0)], FILM, BRIEF)).toBeNull();
  });
});

describe("the mix of several pieces", () => {
  const pieces = [
    { offsetMs: 0, durationMs: 40_000, fadeInSec: 1, fadeOutSec: 1.5 },
    { offsetMs: 46_000, durationMs: 55_000, fadeInSec: 1.5, fadeOutSec: 1 },
    { offsetMs: 100_000, durationMs: 50_000, fadeInSec: 1, fadeOutSec: 0 },
  ];
  const mix = { ducks: [[40, 44]], spans: [{ from: 40, to: 46, db: -80, rampSec: 1.5 }] };

  it("fades each piece, delays it to its offset, sums them, then the bed level", () => {
    const settings = { ...DEFAULT_MIX, ...mix };
    expect(piecesBedGraph(pieces, { durationMs: 150_000, settings })).toBe(
      "[1:a]aresample=48000,atrim=0:40.000,afade=t=in:st=0:d=1,afade=t=out:st=38.500:d=1.5[p0];" +
      "[2:a]aresample=48000,atrim=0:55.000,afade=t=in:st=0:d=1.5,afade=t=out:st=54.000:d=1,adelay=delays=46000:all=1[p1];" +
      "[3:a]aresample=48000,atrim=0:50.000,afade=t=in:st=0:d=1,adelay=delays=100000:all=1[p2];" +
      `[p0][p1][p2]amix=inputs=3:duration=longest:normalize=0,apad,atrim=0:150.000,volume='${bedVolumeExpression(settings)}':eval=frame[bed]`,
    );
  });

  it("one input per piece, the picture copied, the film's own audio mixed as before", () => {
    const args = mixArgs({ film: "f.mp4", cues: ["c0.mp3", "c1.mp3", "c2.mp3"], pieces, out: "o.mp4", durationMs: 150_000, hasAudio: true, mix });
    expect(args.filter((a, i) => args[i - 1] === "-i")).toEqual(["f.mp4", "c0.mp3", "c1.mp3", "c2.mp3"]);
    expect(args[args.indexOf("-c:v") + 1]).toBe("copy");
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("[0:a]aresample=48000[film];[film][bed]amix=inputs=2:duration=first:normalize=0");
    expect(graph).toContain("if(between(t,40,46),"); // the silence, muted with its ramps
    // One piece: no amix of pieces.
    const one = mixArgs({ film: "f", cues: ["c0"], pieces: [pieces[0]], out: "o.mp4", durationMs: 40_000, hasAudio: false, mix: {} });
    expect(one[one.indexOf("-filter_complex") + 1]).toMatch(/^\[1:a\][^;]*\[p0\];\[p0\]apad,atrim=0:40\.000/);
  });

  it("the detached job downloads every piece", () => {
    const env = { WORKER_PUBLIC_URL: "https://studio.test", INGEST_TOKEN: "tok" };
    const script = mixJobScript(env, {
      filmKey: "media/p1/director/sitting.mp4",
      cues: pieces.map((p, i) => ({ ...p, key: `media/p1/director/cue${i}.mp3` })),
      outKey: "media/p1/director/scored.mp4",
      durationMs: 150_000,
      hasAudio: true,
      mix,
    });
    for (let i = 0; i < 3; i++) expect(script).toContain(`'https://studio.test/files/media/p1/director/cue${i}.mp3'`);
    expect(script).toMatch(/'-i' '\S+\/cue2\.mp3'/);
    expect(script).toContain("adelay=delays=100000:all=1");
  });
});
