import { describe, it, expect, vi, afterEach } from "vitest";
import { createApi } from "../../flue-agent/src/lib/api";

// Build a fake fetch that records the call and returns a Response-like object.
function fakeFetch(res: { ok?: boolean; status?: number; statusText?: string; body?: string }) {
  const calls: Array<{ url: string; init: any }> = [];
  const fn = vi.fn(async (url: string, init: any) => {
    calls.push({ url, init });
    return {
      ok: res.ok ?? true,
      status: res.status ?? 200,
      statusText: res.statusText ?? "OK",
      text: async () => res.body ?? "",
    };
  });
  return { fn, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SHOT_STUDIO_API;
});

describe("createApi", () => {
  it("GET builds base+path, sets x-project-id, and omits content-type (no body)", async () => {
    const { fn, calls } = fakeFetch({ body: JSON.stringify({ ok: true }) });
    vi.stubGlobal("fetch", fn);
    const api = createApi("p1");

    const data = await api.get("/api/world");
    expect(data).toEqual({ ok: true });
    expect(calls[0].url).toBe("http://localhost:3334/api/world");
    expect(calls[0].init.method).toBe("GET");
    const headers = calls[0].init.headers as Headers;
    expect(headers.get("x-project-id")).toBe("p1");
    expect(headers.get("content-type")).toBeNull();
  });

  it("omits x-project-id when the project is null", async () => {
    const { fn, calls } = fakeFetch({ body: "{}" });
    vi.stubGlobal("fetch", fn);
    await createApi(null).get("/api/world");
    expect((calls[0].init.headers as Headers).get("x-project-id")).toBeNull();
  });

  it("POST serializes the body and sets content-type", async () => {
    const { fn, calls } = fakeFetch({ body: JSON.stringify({ saved: 1 }) });
    vi.stubGlobal("fetch", fn);
    const api = createApi("p1");

    const data = await api.post("/api/shotlist", { shots: [] });
    expect(data).toEqual({ saved: 1 });
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBe(JSON.stringify({ shots: [] }));
    expect((calls[0].init.headers as Headers).get("content-type")).toBe("application/json");
  });

  it("req() drives an arbitrary verb (PUT/PATCH/DELETE)", async () => {
    const { fn, calls } = fakeFetch({ body: "{}" });
    vi.stubGlobal("fetch", fn);
    await createApi("p1").req("/api/sounds/x", "DELETE");
    expect(calls[0].init.method).toBe("DELETE");
  });

  it("throws with the server's error message on a non-ok response", async () => {
    const { fn } = fakeFetch({ ok: false, status: 400, body: JSON.stringify({ error: "bad shots" }) });
    vi.stubGlobal("fetch", fn);
    await expect(createApi("p1").post("/api/shotlist", {})).rejects.toThrow(/bad shots/);
  });

  it("throws with status text when the error body has no `error`", async () => {
    const { fn } = fakeFetch({ ok: false, status: 500, statusText: "Server Error", body: "" });
    vi.stubGlobal("fetch", fn);
    await expect(createApi("p1").get("/api/world")).rejects.toThrow(/500 Server Error/);
  });

  it("wraps a non-JSON ok body as { raw }", async () => {
    const { fn } = fakeFetch({ body: "not json at all" });
    vi.stubGlobal("fetch", fn);
    expect(await createApi("p1").get("/api/world")).toEqual({ raw: "not json at all" });
  });

  it("returns {} for an empty ok body", async () => {
    const { fn } = fakeFetch({ body: "" });
    vi.stubGlobal("fetch", fn);
    expect(await createApi("p1").get("/api/world")).toEqual({});
  });

  it("honors SHOT_STUDIO_API for the base URL and forwards the abort signal", async () => {
    process.env.SHOT_STUDIO_API = "https://api.prod.example";
    const { fn, calls } = fakeFetch({ body: "{}" });
    vi.stubGlobal("fetch", fn);
    const ctrl = new AbortController();
    await createApi("p1").get("/api/world", ctrl.signal);
    expect(calls[0].url).toBe("https://api.prod.example/api/world");
    expect(calls[0].init.signal).toBe(ctrl.signal);
  });
});
