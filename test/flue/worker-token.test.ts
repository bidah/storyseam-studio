import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { workerHiggsfieldToken } from "../../flue-agent/src/lib/worker-token";

const ENV_KEYS = ["FLUE_PROXY_SECRET", "EVE_PROXY_SECRET", "SHOT_STUDIO_API"] as const;

describe("workerHiggsfieldToken", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    process.env.FLUE_PROXY_SECRET = "shared-secret";
    process.env.SHOT_STUDIO_API = "https://api.example.com";
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.unstubAllGlobals();
  });

  it("returns null when no shared secret is configured", async () => {
    delete process.env.FLUE_PROXY_SECRET;
    delete process.env.EVE_PROXY_SECRET;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await workerHiggsfieldToken("user-1")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null when there is no user id", async () => {
    vi.stubGlobal("fetch", vi.fn());
    expect(await workerHiggsfieldToken("")).toBeNull();
  });

  it("mints an HMAC assertion and returns the token on a 200", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ token: "hf-bearer", expiresAt: 123 }),
    }));
    vi.stubGlobal("fetch", fetchSpy as any);

    const result = await workerHiggsfieldToken("user-1");
    expect(result).toEqual({ token: "hf-bearer", expiresAt: 123 });

    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.example.com/api/agent/higgsfield-token");
    expect(opts.headers.authorization).toMatch(/^Bearer .+\..+$/); // payload.sig
  });

  it("adds ?force=1 when refreshing unconditionally", async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ token: "t" }) }));
    vi.stubGlobal("fetch", fetchSpy as any);
    await workerHiggsfieldToken("user-1", true);
    expect(fetchSpy.mock.calls[0][0]).toBe("https://api.example.com/api/agent/higgsfield-token?force=1");
  });

  it("returns null on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })) as any);
    expect(await workerHiggsfieldToken("user-1")).toBeNull();
  });

  it("returns null when the worker reports no token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })) as any);
    expect(await workerHiggsfieldToken("user-1")).toBeNull();
  });

  it("swallows a fetch failure and returns null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }) as any);
    expect(await workerHiggsfieldToken("user-1")).toBeNull();
  });

  it("falls back to EVE_PROXY_SECRET when FLUE_PROXY_SECRET is absent", async () => {
    delete process.env.FLUE_PROXY_SECRET;
    process.env.EVE_PROXY_SECRET = "legacy-secret";
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ token: "t" }) }));
    vi.stubGlobal("fetch", fetchSpy as any);
    expect(await workerHiggsfieldToken("user-1")).toEqual({ token: "t", expiresAt: undefined });
  });
});
