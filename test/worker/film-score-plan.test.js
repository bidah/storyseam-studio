// The Score stage's WRITTEN plan, as pure arithmetic: story moments from the
// shot list laid on the measured clock, the writing model's answer repaired
// into a plan fal will take (silences included), and the silences reaching the
// mix as faded spans — the same level in ffmpeg's expression and the browser's.
import { describe, it, expect } from "vitest";
import {
  DEFAULT_MIX,
  SILENCE_DB,
  bedVolumeExpression,
  levelExpression,
  momentsOnFilm,
  repairScorePlan,
  silenceSpans,
  spanGainAt,
  storyMoments,
} from "../../worker/src/lib/score-mix.ts";
import { planTotalMs, validatePlan, CHUNK_MIN_MS } from "../../worker/src/lib/music-plan.ts";
import { mixArgs, mixSettings } from "../../worker/src/lib/film-score.js";
import { scorePlanMessages } from "../../worker/src/lib/film-stages/score.js";
import { levelAt, levelBreakpoints, mixDown } from "../../src/director/mix.ts";

const SHOTS = [
  { id: "01", beat: "1", beatTitle: "The hangar", dur: 10, location: "Hangar", characters: ["Mia"], action: "Mia wakes the mecha." },
  { id: "02", beat: "1", beatTitle: "The hangar", dur: 10, location: "Hangar", action: "It powers up.", dialogue: "MIA: Wake up." },
  { id: "03", beat: "2", beatTitle: "The mecha takes the girl", dur: 20, location: "Rooftop", characters: ["Mia"], action: "The mecha grabs Mia and leaps." },
  { id: "04", beat: "3", beatTitle: "Flight", dur: 20, location: "Sky", action: "They soar over the city." },
];

describe("story moments", () => {
  it("one per beat, on the planned clock the cue sheet laid them on", () => {
    const m = storyMoments(SHOTS, 120); // 60 s of shots scaled to a 120 s plan
    expect(m.map((x) => x.planned)).toEqual([0, 40, 80]);
    expect(m.map((x) => x.title)).toEqual(["The hangar", "The mecha takes the girl", "Flight"]);
    expect(m[0].dialogue).toBe(true);
    expect(m[1].dialogue).toBe(false);
    expect(m[0].what).toContain("Mia wakes the mecha. / It powers up.");
    expect(m[1].what).toContain("Rooftop.");
  });

  it("falls back to location changes, then to shots, when there are no beats", () => {
    const noBeats = SHOTS.map(({ beat, beatTitle, ...s }) => s);
    expect(storyMoments(noBeats, 60)).toHaveLength(3);
    const bare = SHOTS.map(({ beat, beatTitle, location, ...s }) => s);
    expect(storyMoments(bare, 60)).toHaveLength(4);
    expect(storyMoments([], 60)).toEqual([]);
  });

  it("scales onto the measured length, then snaps to the real cut where the moment landed", () => {
    const moments = storyMoments(SHOTS, 120);
    // The film ran 126 s: scaled, the turns land at 42 and 84.
    const cuts = [
      { at: 40.5, score: 0.9 }, // 1.5 s before 42 — too early to be it
      { at: 43.2, score: 0.4 }, // the nearest cut in the forward window
      { at: 45.9, score: 0.95 },
      { at: 99, score: 0.9 }, // nowhere near 84
    ];
    const on = momentsOnFilm(moments, { plannedSec: 120, filmMs: 126_000, cuts });
    expect(on.map((m) => m.at)).toEqual([0, 43.2, 84]);
    expect(on.map((m) => m.snapped)).toEqual([false, true, false]);
    expect(on[1].planned).toBe(40);
  });
});

/** A plausible model answer for a 127.4 s film, deliberately NOT adding up. */
const ANSWER = {
  chunks: [
    { section: "Cold open", positive_styles: ["soft pads", "celesta"], negative_styles: ["drums"], duration_ms: 30000 },
    { section: "[Held breath]", silence: true, positive_styles: ["near silence"], negative_styles: [], duration_ms: 8000 },
    { section: "It turns", positive_styles: ["driving taiko", "brass"], negative_styles: ["celesta"], context_adherence: "low", duration_ms: 50000 },
    { section: "Flight", positive_styles: ["soaring strings"], negative_styles: ["taiko"], duration_ms: 30000 },
    { section: "End", positive_styles: ["final sustained chord"], duration_ms: 6000 },
  ],
};

describe("repairing the model's plan", () => {
  it("scales the durations to the measured length exactly and keeps the silence", () => {
    const out = repairScorePlan(ANSWER, { brief: "orchestral, heroic", filmMs: 127_400 });
    expect(out).not.toBeNull();
    expect(planTotalMs(out.plan)).toBe(127_400);
    expect(validatePlan(out.plan, 127_400)).toEqual([]);
    expect(out.plan.chunks.map((c) => c.text)).toEqual(["[Cold open]", "[Held breath]", "[It turns]", "[Flight]", "[End]"]);
    // The first chunk carries the brief's genre; vocals are refused everywhere.
    expect(out.plan.chunks[0].positive_styles.slice(0, 2)).toEqual(["orchestral", "heroic"]);
    expect(out.plan.chunks.every((c) => c.negative_styles.includes("vocals"))).toBe(true);
    // The silence blocks the music outright.
    const quiet = out.plan.chunks[1];
    expect(quiet.negative_styles).toEqual(expect.arrayContaining(["drums", "melody", "pads"]));
    expect(out.plan.chunks[2].context_adherence).toBe("low");
    expect(out.silences).toHaveLength(1);
    const s = out.silences[0];
    expect(s.section).toBe("[Held breath]");
    expect(s.from).toBeCloseTo(30 * 127.4 / 124, 1);
    expect(s.to - s.from).toBeGreaterThan(8);
  });

  it("plays a silence that breaks the rules, and joins a too-short chunk to its neighbour", () => {
    const answer = {
      chunks: [
        { section: "Silence", silence: true, duration_ms: 2000 }, // too short, and at the very start
        { section: "Open", positive_styles: ["piano"], duration_ms: 40000 },
        { section: "Late hush", silence: true, duration_ms: 10000 }, // ends at 52 s of 56: inside the ending
        { section: "End", positive_styles: ["final chord"], duration_ms: 4000 },
      ],
    };
    const out = repairScorePlan(answer, { brief: "piano", filmMs: 56_000 });
    expect(validatePlan(out.plan, 56_000)).toEqual([]);
    expect(out.plan.chunks[0].text).toBe("[Open]"); // the 2 s silence joined the chunk that plays
    // "Late hush" ends at 52 s: inside the last 6 s → played, not silent.
    expect(out.silences).toEqual([]);
    expect(out.plan.chunks.every((c) => c.duration_ms >= CHUNK_MIN_MS)).toBe(true);
  });

  it("answers null for garbage, so the stage falls back", () => {
    expect(repairScorePlan(null, { brief: "x", filmMs: 60_000 })).toBeNull();
    expect(repairScorePlan({ tags: ["x"] }, { brief: "x", filmMs: 60_000 })).toBeNull();
    expect(repairScorePlan({ chunks: [{ section: "A", duration_ms: "soon" }] }, { brief: "x", filmMs: 60_000 })).toBeNull();
  });

  it("tells the model the measured length, the moments and the silence rules", () => {
    const [system, user] = scorePlanMessages({
      brief: "orchestral",
      filmMs: 127_400,
      moments: [{ at: 43.2, title: "The mecha takes the girl", what: "Rooftop.", dialogue: false }],
      ducks: [[40, 44]],
      turns: [31, 64],
    });
    expect(system.content).toMatch(/EXACTLY 127400/);
    expect(system.content).toMatch(/SILENCES/);
    expect(system.content).toMatch(/2–4 silences/);
    expect(user.content).toContain("43.2s — The mecha takes the girl");
    expect(user.content).toContain("40–44s");
  });
});

describe("silences in the mix", () => {
  const spans = silenceSpans([{ from: 30, to: 40, section: "[Held breath]" }]);
  const settings = { ...DEFAULT_MIX, spans };

  it("mutes the bed with 1.5 s linear ramps out and back in", () => {
    expect(spans).toEqual([{ from: 30, to: 40, db: SILENCE_DB, rampSec: 1.5 }]);
    const expr = levelExpression(settings);
    expect(expr).toBe("if(between(t,30,40),0.089+(-0.0890)*min(1,min((t-30)/1.5,(40-t)/1.5)),0.089)");
    expect(bedVolumeExpression({ ...settings, ducks: [[50, 52]] })).toContain(`${expr}*if(between(t,50,52)`);
    const base = spanGainAt(settings, 10);
    expect(spanGainAt(settings, 30)).toBeCloseTo(base, 6); // the ramp starts at the base level
    expect(spanGainAt(settings, 30.75)).toBeCloseTo(base / 2, 3); // halfway out
    expect(spanGainAt(settings, 35)).toBeLessThan(1e-3); // silent
    expect(spanGainAt(settings, 39.25)).toBeCloseTo(base / 2, 3); // halfway back in
    // A span without a ramp still switches hard.
    expect(levelExpression({ ...DEFAULT_MIX, spans: [{ from: 1, to: 2, db: -16 }] })).toBe("if(between(t,1,2),0.158,0.089)");
  });

  it("the browser mix reads the same level", () => {
    for (const t of [10, 30.75, 35, 39.25]) expect(levelAt(settings, t)).toBeCloseTo(spanGainAt(settings, t), 6);
    expect(levelBreakpoints(settings)).toEqual(expect.arrayContaining([30, 31.5, 38.5, 40]));
    // Render: the bed is silent in the middle of the span, audible either side.
    const rate = 100;
    const film = new Float32Array(50 * rate);
    const cue = new Float32Array(50 * rate).fill(0.5);
    const out = mixDown(film, cue, rate, settings);
    expect(out[35 * rate]).toBeCloseTo(0, 3);
    expect(out[20 * rate]).toBeCloseTo(0.5 * 0.0891, 3);
    expect(out[Math.round(30.75 * rate)]).toBeCloseTo(0.5 * 0.0891 / 2, 3);
  });

  it("the spans survive the server mix settings and reach ffmpeg", () => {
    expect(mixSettings({ spans }).spans).toEqual(spans);
    const args = mixArgs({ film: "f", cue: "c", out: "o.mp4", durationMs: 60000, hasAudio: true, mix: { spans, ducks: [] } });
    expect(args[args.indexOf("-filter_complex") + 1]).toContain("min((t-30)/1.5,(40-t)/1.5)");
  });
});
