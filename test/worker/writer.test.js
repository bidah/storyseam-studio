import { describe, it, expect, vi } from "vitest";
import { parseJSONAnswer, writerModel, writerProvider, WORKERS_AI_WRITER_MODEL } from "../../worker/src/lib/writer.js";

describe("writer", () => {
  it("defaults to Workers AI Kimi and switches to Groq by setting", () => {
    expect(writerProvider({})).toBe("workers-ai");
    expect(writerProvider({ AUTO_WRITER: "groq" })).toBe("groq");
  });

  it("runs Kimi through the AI binding and the default gateway, and parses the JSON answer", async () => {
    const run = vi.fn(async () => ({ choices: [{ message: { content: '<think>hm</think>```json\n{"idea":"x"}\n```' }, finish_reason: "stop" }] }));
    const out = await writerModel({ AI: { run } }).json({ messages: [{ role: "user", content: "go" }], maxTokens: 8000 });
    expect(out).toEqual({ idea: "x" });
    const [model, inputs, opts] = run.mock.calls[0];
    expect(model).toBe(WORKERS_AI_WRITER_MODEL);
    expect(inputs.max_tokens).toBe(8000);
    expect(opts).toEqual({ gateway: { id: "default" } });
  });

  it("accepts the older { response } shape, and fails loudly when cut off", async () => {
    await expect(writerModel({ AI: { run: async () => ({ response: { a: 1 } }) } }).json({ messages: [{ role: "user", content: "x" }] })).resolves.toEqual({ a: 1 });
    await expect(writerModel({ AI: { run: async () => ({ choices: [{ message: { content: "{" }, finish_reason: "length" }] }) } }).json({ messages: [{ role: "user", content: "x" }] })).rejects.toThrow(/cut off/);
  });

  it("pulls the object out of prose around it", () => {
    expect(parseJSONAnswer('Sure! Here it is: {"a": [1,2]} Hope that helps')).toEqual({ a: [1, 2] });
    expect(() => parseJSONAnswer("no json here")).toThrow(/did not parse/);
  });
});

describe("cerebras writer", () => {
  it("posts Qwen 3.8 27B to the Cerebras gateway base and parses the answer", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }] })));
    vi.stubGlobal("fetch", fetch);
    const env = { AUTO_WRITER: "cerebras", CEREBRAS_API_KEY: "csk", CEREBRAS_GATEWAY_URL: "https://gw/cerebras/" };
    expect(await writerModel(env).json({ messages: [{ role: "user", content: "x" }], maxTokens: 8000 })).toEqual({ ok: true });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://gw/cerebras/chat/completions");
    expect(JSON.parse(init.body)).toMatchObject({ model: "qwen-3.8-27b", max_completion_tokens: 8000 });
    expect(init.headers.authorization).toBe("Bearer csk");
    vi.unstubAllGlobals();
  });

  it("fails clearly without its key", async () => {
    await expect(writerModel({ AUTO_WRITER: "cerebras" }).json({ messages: [{ role: "user", content: "x" }] })).rejects.toThrow(/CEREBRAS_API_KEY/);
  });
});
