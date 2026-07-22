import { describe, it, expect } from "vitest";
import { makeEnv } from "./_fakes.js";
import {
  normalizeProjectId,
  docKey,
  readDoc,
  writeDoc,
  updateDoc,
} from "../../worker/src/lib/docs.js";

describe("normalizeProjectId", () => {
  it("passes through a clean id", () => {
    expect(normalizeProjectId("p_abc-123.x")).toBe("p_abc-123.x");
  });

  it("falls back to p_default for empty / nullish ids", () => {
    expect(normalizeProjectId("")).toBe("p_default");
    expect(normalizeProjectId(null)).toBe("p_default");
    expect(normalizeProjectId(undefined)).toBe("p_default");
  });

  it("strips characters outside [A-Za-z0-9._-] (no path escapes)", () => {
    expect(normalizeProjectId("../evil")).not.toContain("/");
    expect(normalizeProjectId("a/b c")).toBe("abc");
    expect(normalizeProjectId("!!!")).toBe("p_default"); // nothing left → default
  });
});

describe("docKey", () => {
  it("builds the state/<pid>/<name>.json path", () => {
    expect(docKey("p1", "selections")).toBe("state/p1/selections.json");
    expect(docKey("", "sounds")).toBe("state/p_default/sounds.json");
  });
});

describe("readDoc / writeDoc", () => {
  it("round-trips a JSON document through R2", async () => {
    const env = makeEnv();
    await writeDoc(env, "p1", "selections", { library: { a: 1 } });
    expect(await readDoc(env, "p1", "selections")).toEqual({ library: { a: 1 } });
  });

  it("returns the fallback for a missing doc", async () => {
    const env = makeEnv();
    expect(await readDoc(env, "p1", "missing", { d: true })).toEqual({ d: true });
    expect(await readDoc(env, "p1", "missing")).toBeNull();
  });

  it("returns the fallback when the stored bytes are not valid JSON", async () => {
    const env = makeEnv();
    await env.BUCKET.put(docKey("p1", "corrupt"), "{not json", { httpMetadata: {} });
    expect(await readDoc(env, "p1", "corrupt", { safe: 1 })).toEqual({ safe: 1 });
  });
});

describe("updateDoc (read-modify-write with optimistic concurrency)", () => {
  it("creates from the fallback, applies the mutation, and persists", async () => {
    const env = makeEnv();
    const result = await updateDoc(env, "p1", "selections", { count: 0 }, (doc) => {
      doc.count += 5;
      return { added: 5 };
    });
    expect(result).toEqual({ added: 5 });
    expect(await readDoc(env, "p1", "selections")).toEqual({ count: 5 });
  });

  it("mutates an existing doc in place", async () => {
    const env = makeEnv();
    await writeDoc(env, "p1", "d", { items: ["a"] });
    await updateDoc(env, "p1", "d", { items: [] }, (doc) => {
      doc.items.push("b");
    });
    expect(await readDoc(env, "p1", "d")).toEqual({ items: ["a", "b"] });
  });

  it("honors an abort — no write happens", async () => {
    const env = makeEnv();
    await writeDoc(env, "p1", "d", { v: 1 });
    const result = await updateDoc(env, "p1", "d", {}, () => ({ abort: true, reason: "noop" }));
    expect(result).toMatchObject({ abort: true });
    expect(await readDoc(env, "p1", "d")).toEqual({ v: 1 }); // unchanged
  });
});
