// The Film plan — the quote an Auto prompt gets before anything is paid for:
// the length (2:00–4:30 in 30s steps, rounded up, capped and SAID so), the
// beats and pins at ~4s, the reels they need, and a cost by stage.
import { describe, expect, it } from "vitest";
import {
  FILM_MAX_SECONDS,
  FILM_RATES_USD,
  FILM_STEPS,
  MAX_SEAMS,
  filmLength,
  formatLength,
  parseLength,
  planFilm,
  reelsOnGrid,
} from "@/lib/film-plan";
import { MAX_END_IMAGES } from "@/lib/series";

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

describe("filmLength — round up to the next 30s step, 2:00 floor, 4:30 cap", () => {
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
    [271, 270, true],
    [600, 270, true],
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
    ["ten minutes", 270, "4:30", true],
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
  it("the steps are 2:00 … 4:30", () => {
    expect(FILM_STEPS.map(formatLength)).toEqual(["2:00", "2:30", "3:00", "3:30", "4:00", "4:30"]);
  });

  it.each(FILM_STEPS.map((s) => [s]))("%is: beats at ~4s, pins fit the reel ceilings in ≤5 reels", (seconds) => {
    const plan = planFilm({ seconds });
    expect(plan.seconds).toBe(seconds);
    expect(plan.capped).toBe(false);
    expect(plan.beats).toBe(Math.ceil(seconds / 4));
    expect(plan.reels).toBeLessThanOrEqual(5);
    expect(plan.seams).toBe(plan.reels - 1);
    expect(plan.seams).toBeLessThanOrEqual(MAX_SEAMS);
    expect(plan.clips).toBe(plan.reels);
    expect(plan.pins + plan.skippedFrames).toBe(Math.floor(seconds / 4));
    expect(plan.pins).toBeLessThanOrEqual(plan.reels * MAX_END_IMAGES);
    // Each reel is full before the next opens.
    expect(plan.pins).toBeGreaterThan((plan.reels - 1) * MAX_END_IMAGES);
  });

  it("step table: pins / reels", () => {
    const rows = FILM_STEPS.map((seconds) => {
      const { pins, reels, seams, skippedFrames } = planFilm({ seconds });
      return [seconds, pins, reels, seams, skippedFrames];
    });
    expect(rows).toEqual([
      // A 4s grid loses the 4s pin (inside the opening 5s) and two per seam:
      // the seam beat's own pin and the next one, 4s after it.
      [120, 27, 2, 1, 3],
      [150, 32, 2, 1, 5], // the grid ends inside what would be reel 3's opening 5s
      [180, 40, 3, 2, 5],
      [210, 47, 3, 2, 5],
      [240, 53, 4, 3, 7],
      [270, 60, 4, 3, 7],
    ]);
  });
});

describe("reelsOnGrid", () => {
  it("47 pins at 4s → 3 reels, 2 seams, 4 frames lost to seams (plus the one inside the opening 5s)", () => {
    const grid = reelsOnGrid(47 * 4);
    expect(grid.reels).toBe(3);
    expect(grid.seams).toBe(2);
    expect(grid.skippedFrames).toBe(1 + 4);
    expect(grid.pinsPerReel).toEqual([16, 16, 10]);
  });

  it("4:30 fits in at most 5 reels", () => {
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
    expect(perStage.score.rate).toBe(FILM_RATES_USD.scoreMinute);
    expect(perStage.sandbox.rate).toBe(FILM_RATES_USD.sandboxMinute);
  });

  it("the sitting is billed at least 60s and budgets a chunk of drift per seam", () => {
    const plan = planFilm({ seconds: 120 });
    expect(plan.estimate.perStage.sitting.units).toBe(Math.max(60, 120 + plan.seams * 15));
  });

  it("one clip per reel, each 5–15s", () => {
    const plan = planFilm({ seconds: 270 });
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
