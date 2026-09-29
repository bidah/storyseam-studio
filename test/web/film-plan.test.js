// The Film plan — the quote an Auto prompt gets before anything is paid for:
// the length (2:00–5:00 in 30s steps, rounded up, capped and SAID so), the
// beats and pins at ~4s, the reels they need, and a cost by stage.
import { describe, expect, it } from "vitest";
import {
  FILM_MAX_SECONDS,
  FILM_RATES_USD,
  FILM_STEPS,
  MAX_SEAMS,
  beatSpacing,
  filmLength,
  formatLength,
  parseLength,
  planFilm,
  planH3,
  QUOTE_CHARACTERS,
  QUOTE_STORY_SHEETS,
  quoteFilm,
  reelsOnGrid,
} from "@/lib/film-plan";
import { MINIMAX_USD_PER_SECOND } from "@/lib/music-plan";
import { MAX_DIRECTIONS, MAX_END_IMAGES } from "@/lib/series";

describe("parseLength", () => {
  it.each([
    ["a three-minute short about a mecha", 180],
    ["3 min mecha fight", 180],
    ["3 minutes", 180],
    ["3-minute", 180],
    ["90 seconds of rain", 90],
    ["90 sec", 90],
    ["make it 3:10", 190],
    ["ten minutes long", 600],
    ["two and a half minutes", 150],
    ["a minute and a half", 90],
    ["half a minute", 30],
    ["2.5 minutes", 150],
    ["3 minutes 30 seconds", 210],
    ["2 min and 45 sec", 165],
    ["twenty-five seconds", 25],
    ["an hour-long epic", 3600],
    ["a robot in a garden", null],
    ["vertical 9:16, a robot", null],
    ["meet at 3:30 pm, a heist", null],
    ["", null],
    [null, null],
  ])("%j → %j", (prompt, seconds) => {
    expect(parseLength(prompt)).toBe(seconds);
  });

  it("takes the first length stated", () => {
    expect(parseLength("a 3 minute film with 20 seconds of credits")).toBe(180);
  });
});

describe("filmLength — round up to the next 30s step, 2:00 floor, 5:00 cap", () => {
  it.each([
    [null, 120, false],
    [0, 120, false],
    [30, 120, false],
    [90, 120, false],
    [120, 120, false],
    [121, 150, false],
    [150, 150, false],
    [151, 180, false],
    [180, 180, false],
    [190, 210, false],
    [210, 210, false],
    [211, 240, false],
    [240, 240, false],
    [241, 270, false],
    [270, 270, false],
    [271, 300, false],
    [300, 300, false],
    [301, 300, true],
    [600, 300, true],
  ])("%j → %is (capped %j)", (requested, seconds, capped) => {
    expect(filmLength(requested)).toEqual({ seconds, capped });
  });
});

describe("planFilm — the acceptance examples", () => {
  it.each([
    ["a three-minute short", 180, "3:00", false],
    ["90 seconds", 120, "2:00", false],
    ["3:10", 210, "3:30", false],
    ["a mecha in the rain", 120, "2:00", false],
    ["ten minutes", 300, "5:00", true],
    ["four and a half minutes", 270, "4:30", false],
    ["five minutes", 300, "5:00", false],
  ])("%j → %s", (prompt, seconds, length, capped) => {
    const plan = planFilm({ prompt });
    expect(plan.seconds).toBe(seconds);
    expect(plan.length).toBe(length);
    expect(plan.capped).toBe(capped);
  });

  it("an explicit length wins over the prompt", () => {
    const plan = planFilm({ prompt: "a three-minute short", seconds: 240 });
    expect(plan.seconds).toBe(240);
    expect(plan.requestedSeconds).toBe(240);
  });

  it("reports what was asked for, or null", () => {
    expect(planFilm({ prompt: "ten minutes" }).requestedSeconds).toBe(600);
    expect(planFilm({ prompt: "a robot" }).requestedSeconds).toBeNull();
  });
});

describe("every 30s step", () => {
  it("the steps are 2:00 … 5:00", () => {
    expect(FILM_STEPS.map(formatLength)).toEqual(["2:00", "2:30", "3:00", "3:30", "4:00", "4:30", "5:00"]);
  });

  it.each(FILM_STEPS.map((s) => [s]))("%is: beats at ~4s (≤64), pins fit the reel ceilings in ≤5 reels", (seconds) => {
    const plan = planFilm({ seconds });
    expect(plan.seconds).toBe(seconds);
    expect(plan.capped).toBe(false);
    expect(plan.spacing).toBe(beatSpacing(seconds));
    expect(plan.beats).toBe(Math.ceil(seconds / plan.spacing));
    // A Series takes at most 64 beats, whole-sheet.
    expect(plan.beats).toBeLessThanOrEqual(MAX_DIRECTIONS);
    expect(plan.reels).toBeLessThanOrEqual(5);
    expect(plan.seams).toBe(plan.reels - 1);
    expect(plan.seams).toBeLessThanOrEqual(MAX_SEAMS);
    expect(plan.clips).toBe(plan.reels);
    // Every beat but the first opens on a pin or loses it — and nothing more:
    // the Film's last second closes the last beat, it is no pin (#71).
    expect(plan.pins + plan.skippedFrames).toBe(plan.beats - 1);
    expect(plan.pins).toBeLessThanOrEqual(plan.reels * MAX_END_IMAGES);
    // Each reel is full before the next opens.
    expect(plan.pins).toBeGreaterThan((plan.reels - 1) * MAX_END_IMAGES);
  });

  it("step table: pins / reels", () => {
    const rows = FILM_STEPS.map((seconds) => {
      const { spacing, beats, pins, reels, seams, skippedFrames } = planFilm({ seconds });
      return [seconds, spacing, beats, pins, reels, seams, skippedFrames];
    });
    expect(rows).toEqual([
      // A 4s grid loses the 4s pin (inside the opening 5s) and two per seam:
      // the seam beat's own pin and the next one, 4s after it.
      [120, 4, 30, 26, 2, 1, 3],
      [150, 4, 38, 32, 2, 1, 5], // the grid ends inside what would be reel 3's opening 5s
      [180, 4, 45, 39, 3, 2, 5],
      [210, 4, 53, 47, 3, 2, 5],
      [240, 4, 60, 52, 4, 3, 7],
      // 4:30 at 4s is 68 beats — past the Series' 64 — so it is cut every 5s.
      // At 5s a seam loses only its own pin (the next is 5s on, clear of the opening).
      [270, 5, 54, 50, 4, 3, 3],
      // 5:00 at 5s is 60 beats: still under 64, still 4 reels.
      [300, 5, 60, 56, 4, 3, 3],
    ]);
  });
});

describe("beatSpacing", () => {
  it("is 4s until 4s would pass 64 beats, then the smallest whole second that fits", () => {
    expect(beatSpacing(120)).toBe(4);
    expect(beatSpacing(256)).toBe(4);
    expect(beatSpacing(257)).toBe(5);
    expect(beatSpacing(270)).toBe(5);
    expect(beatSpacing(300)).toBe(5);
    for (const s of FILM_STEPS) expect(Math.ceil(s / beatSpacing(s))).toBeLessThanOrEqual(MAX_DIRECTIONS);
  });
});

describe("reelsOnGrid", () => {
  it("48 beats at 4s → 3 reels, 2 seams, 4 frames lost to seams (plus the one inside the opening 5s)", () => {
    const grid = reelsOnGrid(48 * 4, 4);
    expect(grid.reels).toBe(3);
    expect(grid.seams).toBe(2);
    expect(grid.skippedFrames).toBe(1 + 4);
    expect(grid.pinsPerReel).toEqual([16, 16, 10]);
  });

  it("lays no pin at the Film's last second — beats open before the end, never on it (#71)", () => {
    // 120s at 4s: beats open at 0…116; the 120s mark closes the last one.
    const grid = reelsOnGrid(120, 4);
    expect(grid.pins + grid.skippedFrames).toBe(120 / 4 - 1);
    expect(reelsOnGrid(12, 4).pins).toBe(1); // beats at 0, 4, 8 → pin at 8 only (4 is inside the opening 5s)
  });

  it("5:00 fits in at most 5 reels", () => {
    expect(FILM_MAX_SECONDS).toBe(300);
    expect(reelsOnGrid(FILM_MAX_SECONDS).reels).toBeLessThanOrEqual(5);
  });
});

describe("estimate", () => {
  it("per stage and a total that adds up", () => {
    const { estimate } = planFilm({ seconds: 180 });
    const stages = Object.values(estimate.perStage);
    expect(Object.keys(estimate.perStage)).toEqual(["referenceSheets", "clips", "sitting", "score", "sandbox"]);
    for (const s of stages) expect(s.usd).toBeCloseTo(s.units * s.rate, 2);
    expect(estimate.total).toBeCloseTo(stages.reduce((sum, s) => sum + s.usd, 0), 2);
    expect(estimate.currency).toBe("USD");
  });

  it("every rate comes from the one table", () => {
    const { perStage } = planFilm().estimate;
    expect(perStage.referenceSheets.rate).toBe(FILM_RATES_USD.referenceSheet);
    expect(perStage.clips.rate).toBe(FILM_RATES_USD.clipSecond);
    expect(perStage.sitting.rate).toBe(FILM_RATES_USD.sittingSecond);
    expect(perStage.score.rate).toBe(MINIMAX_USD_PER_SECOND);
    expect(planFilm({ music: "elevenlabs" }).estimate.perStage.score.rate).toBe(FILM_RATES_USD.scoreMinute);
    expect(perStage.sandbox.rate).toBe(FILM_RATES_USD.sandboxMinute);
  });

  it("the sitting is billed at least 60s and budgets a chunk of drift per seam", () => {
    const plan = planFilm({ seconds: 120 });
    expect(plan.estimate.perStage.sitting.units).toBe(Math.max(60, 120 + plan.seams * 15));
  });

  it("one clip per reel, each 5–15s", () => {
    const plan = planFilm({ seconds: 300 });
    expect(plan.estimate.perStage.clips.units).toBeLessThanOrEqual(plan.reels * 15);
    expect(plan.estimate.perStage.clips.units).toBeGreaterThanOrEqual(plan.reels * 5);
  });

  it("reference sheets default to 6 and clamp to 1–9", () => {
    expect(planFilm().estimate.perStage.referenceSheets.units).toBe(6);
    expect(planFilm({ referenceSheets: 20 }).estimate.perStage.referenceSheets.units).toBe(9);
    expect(planFilm({ referenceSheets: 0 }).estimate.perStage.referenceSheets.units).toBe(1);
  });

  it("a longer Film never costs less", () => {
    const totals = FILM_STEPS.map((seconds) => planFilm({ seconds }).estimate.total);
    for (let i = 1; i < totals.length; i++) expect(totals[i]).toBeGreaterThanOrEqual(totals[i - 1]);
  });
});

describe("quoteFilm — the prompt box's price", () => {
  const total = (q) => quoteFilm(q).total;
  it("sums its lines and follows the engine's own plan", () => {
    const q = quoteFilm({ engine: "h3", seconds: 60, voices: "video" });
    expect(q.total).toBeCloseTo(q.lines.reduce((a, l) => a + l.usd, 0), 2);
    expect(q.total).toBe(planH3({ seconds: 60, voices: "video", characters: QUOTE_CHARACTERS, referenceSheets: QUOTE_STORY_SHEETS }).estimate.total);
  });
  it("moves with every setting", () => {
    const base = { engine: "h3", seconds: 60, voices: "video" };
    expect(total({ ...base, seconds: 120 })).toBeGreaterThan(total(base));
    expect(total({ ...base, resolution: "720p" })).toBeGreaterThan(total(base));
    expect(total({ ...base, engine: "seedance" })).toBeGreaterThan(total(base));
    expect(total({ ...base, music: "elevenlabs" })).toBeGreaterThan(total(base));
    expect(total({ ...base, score: false })).toBeLessThan(total(base));
    expect(total({ ...base, voices: "seedaudio" })).toBeLessThan(total(base));
  });
  it("reads a length stated in the prompt when none is chosen", () => {
    expect(quoteFilm({ engine: "h3", prompt: "a 3 minute film about a fox" }).length).toBe("3:00");
  });
  it("an unknown engine quotes the Director", () => {
    expect(quoteFilm({ engine: null }).engine).toBe("director");
  });
});
