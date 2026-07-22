import { describe, it, expect } from "vitest";
import { MAX_VERSIONS, nextVersion, appendCapped } from "../../worker/src/lib/versions.js";

describe("nextVersion", () => {
  it("is 1 for an empty / missing list", () => {
    expect(nextVersion([])).toBe(1);
    expect(nextVersion(null)).toBe(1);
    expect(nextVersion(undefined)).toBe(1);
  });

  it("is one past the HIGHEST v ever seen, not the list length", () => {
    // A pruned list can be short but still carry a high v — length-based numbering
    // would recycle v and collide with an open version.
    expect(nextVersion([{ v: 8 }, { v: 9 }, { v: 10 }])).toBe(11);
    expect(nextVersion([{ v: 3 }])).toBe(4);
  });

  it("ignores non-numeric v entries", () => {
    expect(nextVersion([{ v: "x" }, { v: 2 }, {}])).toBe(3);
  });
});

describe("appendCapped", () => {
  it("appends without pruning while under the cap", () => {
    const list = [{ v: 1 }];
    const { pruned } = appendCapped(list, { v: 2 }, 5);
    expect(pruned).toBe(0);
    expect(list.map((e) => e.v)).toEqual([1, 2]);
  });

  it("prunes the oldest entries beyond the cap and reports the count", () => {
    const list = [{ v: 1 }, { v: 2 }, { v: 3 }];
    const { pruned } = appendCapped(list, { v: 4 }, 3);
    expect(pruned).toBe(1);
    expect(list.map((e) => e.v)).toEqual([2, 3, 4]); // dropped the oldest (v1)
  });

  it("defaults the cap to MAX_VERSIONS", () => {
    const list = [];
    for (let v = 1; v <= MAX_VERSIONS + 3; v++) appendCapped(list, { v });
    expect(list).toHaveLength(MAX_VERSIONS);
    expect(list[0].v).toBe(4); // first three pruned
    expect(list[list.length - 1].v).toBe(MAX_VERSIONS + 3);
  });
});
