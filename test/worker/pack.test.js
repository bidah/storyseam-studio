import { describe, it, expect } from "vitest";
import { MAX, packShots, buildBundles, packPreview } from "../../worker/src/lib/pack.js";

// Minimal shot rows. Same beat + same location group + fits 15s stay together.
const shot = (o) => ({
  id: "01",
  dur: 5,
  location: "school-clearing",
  beat: "b1",
  beatTitle: "Opening",
  characters: [],
  camera: "wide",
  action: "…",
  dialogue: "",
  prompt: "p",
  ...o,
});

describe("packShots", () => {
  it("keeps shots in one bundle while beat, location group and 15s budget hold", () => {
    const bundles = packShots([
      shot({ id: "01", dur: 5 }),
      shot({ id: "02", dur: 5 }),
      shot({ id: "03", dur: 4 }), // total 14 <= 15
    ]);
    expect(bundles).toHaveLength(1);
    expect(bundles[0].shots.map((s) => s.id)).toEqual(["01", "02", "03"]);
    expect(bundles[0].total).toBeCloseTo(14);
  });

  it("breaks to a new bundle when the 15s single-clip cap would overflow", () => {
    const bundles = packShots([
      shot({ id: "01", dur: 8 }),
      shot({ id: "02", dur: 8 }), // 16 > 15 → new bundle
    ]);
    expect(bundles).toHaveLength(2);
  });

  it("breaks on a beat change even if the budget would allow it", () => {
    const bundles = packShots([shot({ id: "01", beat: "b1", dur: 2 }), shot({ id: "02", beat: "b2", dur: 2 })]);
    expect(bundles).toHaveLength(2);
  });

  it("breaks when the location group changes", () => {
    // school-clearing (group school-clearing) → kings-house-entrance (group kings-house)
    const bundles = packShots([
      shot({ id: "01", location: "school-clearing", dur: 2 }),
      shot({ id: "02", location: "kings-house-entrance", dur: 2 }),
    ]);
    expect(bundles).toHaveLength(2);
  });

  it("keeps two locations that share a packing group together", () => {
    // kings-house-entrance and kings-house-window both map to group 'kings-house'
    const bundles = packShots([
      shot({ id: "01", location: "kings-house-entrance", dur: 3 }),
      shot({ id: "02", location: "kings-house-window", dur: 3 }),
    ]);
    expect(bundles).toHaveLength(1);
  });

  it("never exceeds the 15s cap", () => {
    expect(MAX).toBe(15);
  });
});

describe("buildBundles", () => {
  it("assigns MS-NN ids and a ready-to-paste skill prompt with the locked style", () => {
    const [b] = buildBundles([shot({ id: "01", characters: ["Sara"] })]);
    expect(b.id).toBe("MS-01");
    expect(b.skillPrompt).toContain("Use the generate-multishot skill to render MS-01");
    expect(b.skillPrompt).toContain("STYLE:");
    expect(b.skillPrompt).toContain("NO VISUAL EFFECTS AND NO BACKGROUND MUSIC.");
    expect(b.duration).toBeLessThanOrEqual(MAX);
  });

  it("resolves character + location image references, marking availability", () => {
    const [b] = buildBundles([shot({ location: "school-clearing", characters: ["Sara"] })]);
    const keys = b.images.map((im) => im.key);
    expect(keys).toContain("sara"); // Sara → sara (character ref, available)
    expect(keys).toEqual(expect.arrayContaining(["forest", "school"])); // location bg refs
    const sara = b.images.find((im) => im.key === "sara");
    expect(sara).toMatchObject({ role: "character", available: true, url: "/refs/character/sara.png" });
  });

  it("lists unavailable references under `missing`", () => {
    // boundary-stone-hollow bg refs include forest-hollow (null → unavailable)
    const [b] = buildBundles([shot({ location: "boundary-stone-hollow" })]);
    expect(b.missing).toContain("forest-hollow");
  });
});

describe("packPreview", () => {
  it("summarizes each pack: ids, from/to, count and capped duration", () => {
    const preview = packPreview([shot({ id: "01", dur: 6 }), shot({ id: "02", dur: 6 })]);
    expect(preview).toHaveLength(1);
    expect(preview[0]).toMatchObject({
      id: "MS-01",
      from: "01",
      to: "02",
      count: 2,
      shotIds: ["01", "02"],
    });
    expect(preview[0].duration).toBeLessThanOrEqual(MAX);
  });
});
