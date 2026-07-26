import { describe, it, expect } from "vitest";
import { makeEnv } from "./_fakes.js";
import {
  normalizeProjectId,
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

describe("readDoc / writeDoc", () => {
  it("round-trips a JSON document through D1", async () => {
    const env = makeEnv();
    await writeDoc(env, "p1", "selections", { library: { a: 1 } });
    expect(await readDoc(env, "p1", "selections")).toEqual({ library: { a: 1 } });
  });

  it("returns the fallback for a missing doc", async () => {
    const env = makeEnv();
    expect(await readDoc(env, "p1", "missing", { d: true })).toEqual({ d: true });
    expect(await readDoc(env, "p1", "missing")).toBeNull();
  });

  it("returns the fallback when the stored value is not valid JSON", async () => {
    const env = makeEnv();
    await env.DB.prepare(
      "INSERT INTO docs (project_id, name, json, version, updated_at) VALUES (?, ?, ?, 1, ?)",
    ).bind("p1", "corrupt", "{not json", new Date().toISOString()).run();
    expect(await readDoc(env, "p1", "corrupt", { safe: 1 })).toEqual({ safe: 1 });
  });

  it("scopes documents per project — one tenant cannot see another's", async () => {
    const env = makeEnv();
    await writeDoc(env, "p1", "world", { title: "One" });
    await writeDoc(env, "p2", "world", { title: "Two" });
    expect(await readDoc(env, "p1", "world")).toEqual({ title: "One" });
    expect(await readDoc(env, "p2", "world")).toEqual({ title: "Two" });
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

describe("updateDoc under contention", () => {
  it("lands every concurrent mutation instead of dropping some", async () => {
    // The compare-and-swap is the whole point: a plain read-then-write is
    // last-writer-wins, which silently dropped roster entries when the agent
    // added a cast in one burst.
    const env = makeEnv();
    await writeDoc(env, "p1", "world", { characters: [] });
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        updateDoc(env, "p1", "world", { characters: [] }, (doc) => {
          doc.characters.push({ name: `C${i}` });
        }),
      ),
    );
    const doc = await readDoc(env, "p1", "world");
    expect(doc.characters).toHaveLength(12);
  });
});

describe("updateDoc `also` — multi-document atomicity", () => {
  // Some operations span two documents and are only correct together. The
  // episode rebuild re-keys every pick/still/render in `selections` from old
  // bundle ids to new ones AND writes the new bundle definitions to
  // `episode-manifest`; bundle ids are positional, so if one lands without the
  // other the surviving picks point at the WRONG scenes.
  it("writes every document together", async () => {
    const env = makeEnv();
    await writeDoc(env, "p1", "selections", { episode: { "MS-01": ["a.png"] } });
    await writeDoc(env, "p1", "manifest", { bundles: ["old"] });
    await updateDoc(env, "p1", "selections", {}, (db) => { db.episode = { "MS-02": ["a.png"] }; },
      { also: [{ name: "manifest", value: { bundles: ["new"] } }] });
    expect(await readDoc(env, "p1", "selections")).toEqual({ episode: { "MS-02": ["a.png"] } });
    expect(await readDoc(env, "p1", "manifest")).toEqual({ bundles: ["new"] });
  });

  it("never writes the secondary when the primary's compare-and-swap loses", async () => {
    const env = makeEnv();
    await writeDoc(env, "p1", "selections", { v: 0 });
    await writeDoc(env, "p1", "manifest", { bundles: ["old"] });
    await expect(
      updateDoc(env, "p1", "selections", {}, (db) => {
        // Bump the version on EVERY attempt so the CAS can never win. Note it
        // moves by exactly one, which is what defeats a naive "the primary's
        // version is now what I expected plus one" guard — hence the nonce.
        env.DB.prepare("UPDATE docs SET version = version + 1 WHERE project_id = ? AND name = ?")
          .bind("p1", "selections").run();
        db.v = 99;
      }, { also: [{ name: "manifest", value: { bundles: ["new"] } }] }),
    ).rejects.toThrow(/concurrent-write conflicts/);
    // Neither half may have landed.
    expect((await readDoc(env, "p1", "selections")).v).toBe(0);
    expect(await readDoc(env, "p1", "manifest")).toEqual({ bundles: ["old"] });
  });

  it("creates a secondary that does not exist yet (the first rebuild)", async () => {
    const env = makeEnv();
    await updateDoc(env, "p1", "selections", { fresh: true }, (db) => { db.fresh = true; },
      { also: [{ name: "manifest", value: { bundles: ["first"] } }] });
    expect(await readDoc(env, "p1", "manifest")).toEqual({ bundles: ["first"] });
  });

  it("keeps a concurrent writer's change instead of reverting it", async () => {
    const env = makeEnv();
    await writeDoc(env, "p1", "selections", { episode: {} });
    let first = true;
    await updateDoc(env, "p1", "selections", {}, (db) => {
      if (first) {
        first = false;
        env.DB.prepare("UPDATE docs SET json = ?, version = version + 1 WHERE project_id = ? AND name = ?")
          .bind(JSON.stringify({ episode: {}, intruder: true }), "p1", "selections").run();
      }
      db.episode = { "MS-02": ["a.png"] };
    }, { also: [{ name: "manifest", value: { bundles: ["new"] } }] });
    const sel = await readDoc(env, "p1", "selections");
    expect(sel.intruder).toBe(true);
    expect(sel.episode).toEqual({ "MS-02": ["a.png"] });
    expect(await readDoc(env, "p1", "manifest")).toEqual({ bundles: ["new"] });
  });
});
