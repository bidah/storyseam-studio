// The Reel planner — how a run of the Shot sheet cuts the chosen frames into
// reels, places the seams, and draws one clip per reel.
//
// Every frame the planner lets through is a frame paid for, and every seam it
// places costs pins the Director would otherwise refuse at pin time. So the
// two things checked here are the ones that cost money when wrong: every clip
// it emits passes the sheet's own validation, and the Series — with the seams
// written in — accepts every pin the run draws. See docs/adr/0002.
import { describe, expect, it } from "vitest";
import {
  MAX_END_IMAGES,
  MAX_REEL_CHANGES,
  MIN_OPENING_END_IMAGE_SECONDS,
  seriesFields,
  seriesInput,
} from "@/lib/series";
import { planReels, planSheets, reelCapacity, slotsOf, validateSheet, withSeams } from "@/lib/shot-sheet";

/** Pins every `step` seconds from `first` to `last`, plus the opening frame. */
const frames = (first, last, step = 4, opening = true) => [
  ...(opening ? [{ offset: 0, kind: "opening", text: "the first frame" }] : []),
  ...Array.from({ length: Math.floor((last - first) / step) + 1 }, (_, i) => ({
    offset: first + i * step,
    kind: "pin",
    text: `frame ${first + i * step}`,
  })),
];

/** A Series with a beat every `step` seconds up to `last`, nothing pinned. */
const seriesOf = (last, step = 4, over = {}) =>
  seriesFields.parse({
    title: "Test",
    prompt: "a hangar at dawn, painted cel style",
    imageUrl: "/visual-media/open.png",
    aspectRatio: "16:9",
    directions: Array.from({ length: Math.floor(last / step) + 1 }, (_, i) => ({
      offset: i * step,
      prompt: `Beat ${i}. End on the mecha at the hangar door, frame ${i}.`,
    })),
    ...over,
  });

const pinsOf = (clip) => clip.filter((s) => s.kind === "pin").map((s) => s.offset);

/** The Series' rules, checked on every reel a plan draws. */
function expectLegal(plan) {
  plan.reels.forEach((reel, index) => {
    const pins = pinsOf(reel.shots);
    expect(pins.length).toBeLessThanOrEqual(MAX_END_IMAGES);
    if (pins.length) expect(pins[0] - reel.opensAt).toBeGreaterThanOrEqual(MIN_OPENING_END_IMAGE_SECONDS);
    for (let i = 1; i < pins.length; i++) expect(pins[i] - pins[i - 1]).toBeGreaterThanOrEqual(3);
    if (index > 0) expect(pins.every((p) => p >= reel.opensAt)).toBe(true);
    const next = plan.reels[index + 1];
    if (next) expect(pins.every((p) => p < next.opensAt)).toBe(true);
  });
}

describe("planReels", () => {
  it("keeps a selection that fits one reel as one clip, with no seams", () => {
    const plan = planReels(frames(8, 68));
    expect(plan.reels).toHaveLength(1);
    expect(plan.seams).toEqual([]);
    expect(plan.skipped).toEqual([]);
    expect(plan.clips[0]).toHaveLength(17);
    expect(plan.refused).toBeNull();
  });

  it("plans a 47-frame selection at 4s as 3 reels, 2 seams, 4 skipped frames", () => {
    const shots = frames(8, 188);
    expect(shots).toHaveLength(47);
    const plan = planReels(shots);
    expect(plan.reels).toHaveLength(3);
    expect(plan.clips).toHaveLength(3);
    expect(plan.seams).toEqual([72, 144]);
    expect(plan.skipped.map((f) => f.offset)).toEqual([72, 76, 144, 148]);
    expect(plan.refused).toBeNull();
    expectLegal(plan);
    // Every chosen frame is either drawn once or skipped — none lost silently.
    const drawn = plan.clips.flat().map((s) => s.offset);
    expect(drawn.length + plan.skipped.length).toBe(shots.length);
    expect(new Set(drawn).size).toBe(drawn.length);
  });

  it("never draws a frame on a seam's opening beat nor within 5s after it", () => {
    const plan = planReels(frames(8, 188));
    const drawn = plan.clips.flat().map((s) => s.offset);
    for (const seam of plan.seams) {
      expect(drawn.filter((o) => o >= seam && o < seam + MIN_OPENING_END_IMAGE_SECONDS)).toEqual([]);
    }
  });

  it("fits a 4:30 cue sheet pinned every 4s in 5 reels", () => {
    const plan = planReels(frames(8, 268));
    expect(plan.reels.length).toBeLessThanOrEqual(5);
    expect(plan.seams.length).toBeLessThanOrEqual(MAX_REEL_CHANGES);
    expect(plan.refused).toBeNull();
    expectLegal(plan);
  });

  it("refuses a plan that needs 5 seams, naming the count", () => {
    const plan = planReels(frames(8, 400));
    expect(plan.seams).toHaveLength(5);
    expect(plan.refused).toMatch(/5 reel changes/);
    expect(plan.refused).toMatch(new RegExp(`takes ${MAX_REEL_CHANGES}`));
  });

  it("opens a reel on a beat nobody chose to draw when that costs nothing", () => {
    // 16 pins, then a gap at 72 (a beat, not chosen), then pins from 80 on.
    const shots = [...frames(8, 68), ...frames(80, 120, 4, false)];
    const plan = planReels(shots, { beats: Array.from({ length: 31 }, (_, i) => i * 4) });
    expect(plan.seams).toEqual([72]);
    expect(plan.skipped).toEqual([]);
    expect(plan.clips.flat()).toHaveLength(shots.length);
    expectLegal(plan);
  });

  it("drops a trailing reel that would draw nothing", () => {
    // 17 pins: the 17th has nowhere to go but a reel of its own, where it is
    // the opening beat and loses its pin — so no reel change is worth placing.
    const plan = planReels(frames(8, 72));
    expect(plan.reels).toHaveLength(1);
    expect(plan.seams).toEqual([]);
    expect(plan.skipped.map((f) => f.offset)).toEqual([72]);
  });

  it("holds fewer pins per reel when a shorter clip holds fewer frames", () => {
    expect(reelCapacity(15, true)).toBe(16);
    expect(reelCapacity(10, true)).toBe(11);
    expect(reelCapacity(10, false)).toBe(12);
    const plan = planReels(frames(8, 100), { duration: 10 });
    plan.clips.forEach((clip) => expect(clip.length).toBeLessThanOrEqual(12));
    expectLegal(plan);
  });
});

describe("planSheets", () => {
  it("emits one sheet per reel, every one of which passes the sheet validation", () => {
    const series = seriesOf(188);
    const chosen = slotsOf(series).filter((s) => !s.refused).map((s) => s.offset);
    expect(chosen).toHaveLength(47);
    const { plan, sheets } = planSheets(series, chosen);
    expect(sheets).toHaveLength(3);
    expect(plan.seams).toEqual([72, 144]);
    for (const sheet of sheets) expect(validateSheet(sheet)).toEqual([]);
  });

  it("writes seams the Director's Series validation accepts, with every drawn pin placed", () => {
    const series = seriesOf(188);
    const chosen = slotsOf(series).filter((s) => !s.refused).map((s) => s.offset);
    const { plan } = planSheets(series, chosen);
    const { reelChanges, directions } = withSeams(series, plan.seams);
    const drawn = new Set(plan.clips.flat().filter((s) => s.kind === "pin").map((s) => s.offset));
    const pinned = {
      ...series,
      reelChanges,
      directions: directions.map((beat) =>
        drawn.has(beat.offset) ? { ...beat, endImageUrl: `/director-media/pin_${beat.offset}.png` } : beat,
      ),
    };
    const check = seriesInput.safeParse(pinned);
    expect(check.success ? [] : check.error.issues.map((i) => i.message)).toEqual([]);
    expect(reelChanges).toEqual([72, 144]);
  });

  it("clears an old pin inside a seam's window, and keeps the rest", () => {
    const base = seriesOf(40);
    const series = {
      ...base,
      directions: base.directions.map((beat) =>
        [16, 20, 24].includes(beat.offset) ? { ...beat, endImageUrl: `/director-media/old_${beat.offset}.png` } : beat,
      ),
    };
    const { directions, cleared, reelChanges } = withSeams(series, [16]);
    expect(reelChanges).toEqual([16]);
    expect(cleared).toEqual([20]);
    const at = (o) => directions.find((b) => b.offset === o).endImageUrl;
    expect(at(16)).toBeTruthy();
    expect(at(20)).toBeNull();
    expect(at(24)).toBeTruthy();
  });
});
