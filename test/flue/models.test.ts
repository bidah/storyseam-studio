import { describe, it, expect } from "vitest";
import {
  DEFAULT_MODEL,
  ALLOWED_MODELS,
  isAllowedModel,
  writeSelectedModel,
  readSelectedModel,
} from "../../flue-agent/src/lib/models";

// A tiny in-memory stand-in for the DO's ctx.storage.sql handle. It only needs to
// honor the three statements models.ts issues: CREATE TABLE (noop), an upsert
// keyed by `key`, and a SELECT value WHERE key.
function makeSql() {
  const rows = new Map<string, string>();
  return {
    exec(query: string, ...bindings: unknown[]) {
      const q = query.trim().toUpperCase();
      if (q.startsWith("CREATE TABLE")) return { toArray: () => [] };
      if (q.startsWith("INSERT")) {
        rows.set(String(bindings[0]), String(bindings[1]));
        return { toArray: () => [] };
      }
      if (q.startsWith("SELECT")) {
        const v = rows.get(String(bindings[0]));
        return { toArray: () => (v === undefined ? [] : [{ value: v }]) };
      }
      return { toArray: () => [] };
    },
  };
}

describe("isAllowedModel", () => {
  it("accepts every whitelisted specifier", () => {
    for (const m of ALLOWED_MODELS) expect(isAllowedModel(m)).toBe(true);
  });

  it("rejects unknown / non-string specifiers", () => {
    expect(isAllowedModel("openai/gpt-5")).toBe(false);
    expect(isAllowedModel("")).toBe(false);
    expect(isAllowedModel(null)).toBe(false);
    expect(isAllowedModel(42)).toBe(false);
  });

  it("the default model is itself whitelisted", () => {
    expect(isAllowedModel(DEFAULT_MODEL)).toBe(true);
  });
});

describe("writeSelectedModel / readSelectedModel", () => {
  it("defaults to DEFAULT_MODEL when nothing is stored", () => {
    expect(readSelectedModel(makeSql())).toBe(DEFAULT_MODEL);
  });

  it("persists and reads back a whitelisted selection", () => {
    const sql = makeSql();
    // Any allowed specifier that ISN'T the default, so a pass can't be the
    // fallback in disguise. (This used to name an `anthropic/*` model; those
    // were removed from ALLOWED_MODELS — see the comment block in
    // flue-agent/src/lib/models.ts — and the test has been red since.)
    const pick = [...ALLOWED_MODELS].find((m) => m !== DEFAULT_MODEL) as string;
    writeSelectedModel(sql, pick);
    expect(readSelectedModel(sql)).toBe(pick);
  });

  it("coerces an un-whitelisted write down to the default (never pushes arbitrary models)", () => {
    const sql = makeSql();
    writeSelectedModel(sql, "openai/gpt-5-turbo");
    expect(readSelectedModel(sql)).toBe(DEFAULT_MODEL);
  });

  it("reading an out-of-whitelist stored value still yields the default", () => {
    const sql = makeSql();
    // Simulate a stale/tampered value already in storage.
    sql.exec("INSERT INTO app_settings (key,value) VALUES (?,?)", "model", "evil/model");
    expect(readSelectedModel(sql)).toBe(DEFAULT_MODEL);
  });
});
