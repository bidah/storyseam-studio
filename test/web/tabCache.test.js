import { describe, it, expect, beforeEach } from "vitest";
import {
  readTabCache,
  writeTabCache,
  clearTabCache,
  invalidateTabCache,
} from "@/lib/tabCache";

// The store is process-global, so reset it before each case.
beforeEach(() => clearTabCache());

describe("tabCache", () => {
  it("writes then reads a payload back by key", () => {
    writeTabCache("episode", { a: 1 });
    expect(readTabCache("episode")).toEqual({ a: 1 });
  });

  it("returns undefined for an unknown key (the cache-miss signal)", () => {
    expect(readTabCache("nope")).toBeUndefined();
  });

  it("can cache a falsy payload distinctly from a miss", () => {
    writeTabCache("k", null);
    expect(readTabCache("k")).toBeNull();
    expect(readTabCache("k")).not.toBeUndefined();
  });

  it("invalidateTabCache(key) drops just that key", () => {
    writeTabCache("a", 1);
    writeTabCache("b", 2);
    invalidateTabCache("a");
    expect(readTabCache("a")).toBeUndefined();
    expect(readTabCache("b")).toBe(2);
  });

  it("invalidateTabCache() with no key clears everything (project switch)", () => {
    writeTabCache("a", 1);
    writeTabCache("b", 2);
    invalidateTabCache();
    expect(readTabCache("a")).toBeUndefined();
    expect(readTabCache("b")).toBeUndefined();
  });

  it("clearTabCache wipes the whole store", () => {
    writeTabCache("a", 1);
    clearTabCache();
    expect(readTabCache("a")).toBeUndefined();
  });
});
