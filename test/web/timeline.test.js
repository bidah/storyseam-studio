import { describe, it, expect } from "vitest";
import {
  FPS,
  WIDTH,
  HEIGHT,
  secToFrames,
  framesToSec,
  isImageItem,
  isSlateItem,
  normalizeItemKind,
  timelineDuration,
  emptyTimeline,
} from "@/editor/timeline";

describe("timeline constants", () => {
  it("exposes the fixed 24fps / 1280x720 composition dims", () => {
    expect(FPS).toBe(24);
    expect(WIDTH).toBe(1280);
    expect(HEIGHT).toBe(720);
  });
});

describe("secToFrames / framesToSec", () => {
  it("rounds seconds to whole frames at the given fps", () => {
    expect(secToFrames(1)).toBe(24);
    expect(secToFrames(0.5)).toBe(12);
    expect(secToFrames(1, 30)).toBe(30);
    expect(secToFrames(1.02)).toBe(24); // 24.48 → 24
  });

  it("never returns fewer than 1 frame (Remotion needs >= 1)", () => {
    expect(secToFrames(0)).toBe(1);
    expect(secToFrames(-5)).toBe(1);
    expect(secToFrames(undefined)).toBe(1);
    expect(secToFrames(0.001)).toBe(1);
  });

  it("framesToSec is the inverse and tolerates nullish", () => {
    expect(framesToSec(24)).toBe(1);
    expect(framesToSec(12)).toBe(0.5);
    expect(framesToSec(60, 30)).toBe(2);
    expect(framesToSec(undefined)).toBe(0);
  });
});

describe("isImageItem / isSlateItem", () => {
  it("treats a kind:image item as an image", () => {
    expect(isImageItem({ kind: "image", src: "/x.png" })).toBe(true);
  });

  it("treats absent kind (every legacy doc) as video, not image", () => {
    expect(isImageItem({ src: "/x.mp4" })).toBe(false);
    expect(isImageItem({ kind: "video" })).toBe(false);
  });

  it("is null-safe", () => {
    expect(isImageItem(null)).toBe(false);
    expect(isImageItem(undefined)).toBe(false);
  });

  it("a slate is an image item with no src", () => {
    expect(isSlateItem({ kind: "image", src: null })).toBe(true);
    expect(isSlateItem({ kind: "image", src: "" })).toBe(true);
    expect(isSlateItem({ kind: "image", src: "/x.png" })).toBe(false);
    expect(isSlateItem({ src: null })).toBe(false); // a video with no src is not a slate
  });
});

describe("normalizeItemKind", () => {
  it("leaves non-image items untouched", () => {
    const item = { kind: "video", offsetFrames: 10, sourceDurationInFrames: 100 };
    expect(normalizeItemKind(item)).toBe(item);
    expect(item.offsetFrames).toBe(10);
    expect(item.sourceDurationInFrames).toBe(100);
  });

  it("forces the image invariants: offsetFrames 0, no sourceDurationInFrames", () => {
    const item = { kind: "image", offsetFrames: 42, sourceDurationInFrames: 999 };
    normalizeItemKind(item);
    expect(item.offsetFrames).toBe(0);
    expect("sourceDurationInFrames" in item).toBe(false);
  });

  it("is idempotent", () => {
    const item = { kind: "image", offsetFrames: 5 };
    normalizeItemKind(item);
    normalizeItemKind(item);
    expect(item.offsetFrames).toBe(0);
  });
});

describe("timelineDuration", () => {
  it("returns the furthest clip end across all tracks", () => {
    const tl = {
      fps: 24,
      tracks: [
        { type: "video", items: [{ from: 0, durationInFrames: 48 }] },
        { type: "audio", items: [{ from: 24, durationInFrames: 60 }] }, // ends at 84
      ],
    };
    expect(timelineDuration(tl)).toEqual({ durationInFrames: 84, fps: 24 });
  });

  it("never returns 0 (Remotion requires >= 1)", () => {
    expect(timelineDuration(emptyTimeline()).durationInFrames).toBe(1);
    expect(timelineDuration({}).durationInFrames).toBe(1);
    expect(timelineDuration(null)).toEqual({ durationInFrames: 1, fps: 24 });
  });

  it("defaults fps to 24 when the timeline omits it", () => {
    expect(timelineDuration({ tracks: [] }).fps).toBe(24);
  });

  it("tolerates items missing from/duration", () => {
    const tl = { tracks: [{ items: [{}, { from: 10 }, { durationInFrames: 5 }] }] };
    expect(timelineDuration(tl).durationInFrames).toBe(10);
  });
});

describe("emptyTimeline", () => {
  it("builds a video picture lane + a music audio lane, both empty", () => {
    const tl = emptyTimeline();
    expect(tl.fps).toBe(24);
    expect(tl.width).toBe(1280);
    expect(tl.height).toBe(720);
    expect(tl.tracks).toHaveLength(2);
    expect(tl.tracks[0]).toMatchObject({ id: "video", type: "video", items: [] });
    expect(tl.tracks[1]).toMatchObject({ id: "music", type: "audio", items: [] });
  });

  it("returns a fresh object each call (no shared mutable state)", () => {
    const a = emptyTimeline();
    const b = emptyTimeline();
    a.tracks[0].items.push({ from: 0 });
    expect(b.tracks[0].items).toHaveLength(0);
  });
});
