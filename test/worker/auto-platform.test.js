import { describe, it, expect, vi, afterEach } from "vitest";
import { groqChat, groqJSON, GroqError, GROQ_DEFAULT_MODEL, GROQ_DIRECT_BASE } from "../../worker/src/lib/groq.js";
import { autoAvailable, AUTO_PAUSE_KEY } from "../../worker/src/lib/auto-availability.js";

const GATEWAY = "https://gateway.ai.cloudflare.com/v1/acct/gw/groq";
const answer = (content, finish = "stop") =>
  new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: finish }] }), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

describe("groqChat", () => {
  it("posts an OpenAI-compatible chat completion to the AI Gateway /groq base", async () => {
    const fetch = vi.fn(async () => answer("hello"));
    vi.stubGlobal("fetch", fetch);
    const text = await groqChat(
      { GROQ_API_KEY: "gsk_x", GROQ_GATEWAY_URL: GATEWAY + "/" },
      { messages: [{ role: "user", content: "hi" }], maxTokens: 100 },
    );
    expect(text).toBe("hello");
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${GATEWAY}/chat/completions`);
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer gsk_x");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: GROQ_DEFAULT_MODEL, max_completion_tokens: 100 });
    expect(body.response_format).toBeUndefined();
  });

  it("falls back to Groq direct when no gateway URL is set", async () => {
    const fetch = vi.fn(async () => answer("x"));
    vi.stubGlobal("fetch", fetch);
    await groqChat({ GROQ_API_KEY: "k" }, { messages: [{ role: "user", content: "hi" }] });
    expect(fetch.mock.calls[0][0]).toBe(`${GROQ_DIRECT_BASE}/chat/completions`);
  });

  it("fails clearly without a key, before any network call", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(groqChat({}, { messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(/GROQ_API_KEY/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("surfaces the provider's error message and status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 })));
    const err = await groqChat({ GROQ_API_KEY: "k" }, { messages: [{ role: "user", content: "hi" }] }).catch((e) => e);
    expect(err).toBeInstanceOf(GroqError);
    expect(err.status).toBe(429);
    expect(err.message).toMatch(/rate limited/);
  });

  it("refuses a truncated answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer("{\"a\":", "length")));
    await expect(groqChat({ GROQ_API_KEY: "k" }, { messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(/cut off/);
  });

  it("groqJSON asks for JSON mode and parses the answer", async () => {
    const fetch = vi.fn(async () => answer('```json\n{"idea":"a fox"}\n```'));
    vi.stubGlobal("fetch", fetch);
    const out = await groqJSON({ GROQ_API_KEY: "k" }, { messages: [{ role: "user", content: "hi" }] });
    expect(out).toEqual({ idea: "a fox" });
    expect(JSON.parse(fetch.mock.calls[0][1].body).response_format).toEqual({ type: "json_object" });
  });
});

const KEYS = { FAL_KEY: "f", DAYTONA_API_KEY: "d", GROQ_API_KEY: "g" };
const kv = (map = {}) => ({ get: vi.fn(async (k) => map[k] ?? null) });

describe("autoAvailable", () => {
  it("is available with every key set and no pause", async () => {
    const r = await autoAvailable({ ...KEYS, AUTH_KV: kv() });
    expect(r).toMatchObject({ ok: true, reason: null, paused: false, missing: [] });
    expect(r.keys).toEqual({ FAL_KEY: true, DAYTONA_API_KEY: true, GROQ_API_KEY: true });
  });

  it("reports missing keys by name", async () => {
    const r = await autoAvailable({ FAL_KEY: "f", AUTH_KV: kv() });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["DAYTONA_API_KEY", "GROQ_API_KEY"]);
    expect(r.reason).toMatch(/set up/);
  });

  it("the KV kill switch refuses, with its value as the reason", async () => {
    const r = await autoAvailable({ ...KEYS, AUTH_KV: kv({ [AUTO_PAUSE_KEY]: "Back at 5pm." }) });
    expect(r).toMatchObject({ ok: false, paused: true, reason: "Back at 5pm." });
  });

  it("a bare '1' gets a generic reason; '0' does not pause", async () => {
    expect((await autoAvailable({ ...KEYS, AUTH_KV: kv({ [AUTO_PAUSE_KEY]: "1" }) })).reason).toMatch(/paused/);
    expect((await autoAvailable({ ...KEYS, AUTH_KV: kv({ [AUTO_PAUSE_KEY]: "0" }) })).ok).toBe(true);
  });

  it("honours an AUTO_PAUSED var, and survives a KV failure", async () => {
    expect((await autoAvailable({ ...KEYS, AUTO_PAUSED: "true" })).paused).toBe(true);
    const broken = { get: vi.fn(async () => { throw new Error("kv down"); }) };
    expect((await autoAvailable({ ...KEYS, AUTH_KV: broken })).ok).toBe(true);
  });
});
