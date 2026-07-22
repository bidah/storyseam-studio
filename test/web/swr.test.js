import { describe, it, expect, beforeEach } from "vitest";
import { swr } from "@/lib/swr";
import { clearTabCache, readTabCache, writeTabCache } from "@/lib/tabCache";

beforeEach(() => clearTabCache());

describe("swr (stale-while-revalidate loader helper)", () => {
  it("awaits the fetch on a cache miss and writes the result into the cache", async () => {
    const data = await swr("k", async () => ({ v: 1 }));
    expect(data).toEqual({ v: 1 });
    expect(readTabCache("k")).toEqual({ v: 1 });
  });

  it("returns the cached payload immediately when one exists", async () => {
    writeTabCache("k", { v: "cached" });
    const data = await swr("k", async () => ({ v: "fresh" }));
    expect(data).toEqual({ v: "cached" }); // served stale, revalidates in background
  });

  it("refreshes the cache in the background after serving stale", async () => {
    writeTabCache("k", { v: "cached" });
    await swr("k", async () => ({ v: "fresh" }));
    // background revalidation resolves on the next microtasks
    await new Promise((r) => setTimeout(r, 0));
    expect(readTabCache("k")).toEqual({ v: "fresh" });
  });

  it("rethrows a fetch error when there is no cached fallback", async () => {
    await expect(swr("k", async () => {
      throw new Error("boom");
    })).rejects.toThrow("boom");
  });

  it("falls back to the cached payload when the fetch fails transiently", async () => {
    writeTabCache("k", { v: "cached" });
    const data = await swr("k", async () => {
      throw new Error("network");
    });
    expect(data).toEqual({ v: "cached" });
  });
});
