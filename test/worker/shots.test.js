import { describe, it, expect } from "vitest";
import { normalizeShot } from "../../worker/src/lib/shots.js";

describe("normalizeShot", () => {
  it("fills the canonical field set and 1-based / 0-based numbering", () => {
    const s = normalizeShot({ id: "07", location: "forest", dur: "3.5" }, 6);
    expect(s.n).toBe(7);
    expect(s.id).toBe("07");
    expect(s.dur).toBe(3.5); // coerced to number
    expect(s.location).toBe("forest");
  });

  it("derives id/src from the 1-based index when missing (zero-padded)", () => {
    const s = normalizeShot({}, 0);
    expect(s.id).toBe("01");
    expect(s.src).toBe("01");
    expect(s.n).toBe(1);
  });

  it("coerces a scalar `characters` into an array and defaults to []", () => {
    expect(normalizeShot({ characters: "Sara" }, 0).characters).toEqual(["Sara"]);
    expect(normalizeShot({}, 0).characters).toEqual([]);
    expect(normalizeShot({ characters: ["A", "B"] }, 0).characters).toEqual(["A", "B"]);
  });

  it("prefers `action`, falling back to `summary`", () => {
    expect(normalizeShot({ summary: "did a thing" }, 0).action).toBe("did a thing");
    expect(normalizeShot({ action: "explicit", summary: "ignored" }, 0).action).toBe("explicit");
  });

  it("defaults an unparseable duration to 0", () => {
    expect(normalizeShot({ dur: "abc" }, 0).dur).toBe(0);
    expect(normalizeShot({}, 0).dur).toBe(0);
  });
});
