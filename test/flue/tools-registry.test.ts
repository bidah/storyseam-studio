import { describe, it, expect } from "vitest";
import * as v from "valibot";
import { createTools, createReadTools } from "../../flue-agent/src/tools/index";

// A fake project-scoped api — the tools are factories over it; we only need it to
// exist so `createTools(api)` instantiates every tool module (which is what gives
// this file its broad coverage across all ~54 tool definitions).
const fakeApi: any = {
  get: async () => ({}),
  post: async () => ({}),
  req: async () => ({}),
};

const tools = createTools(fakeApi);
const readTools = createReadTools(fakeApi);

describe("tool registry", () => {
  it("registers the full Whistlewood tool set", () => {
    expect(tools.length).toBeGreaterThanOrEqual(50);
  });

  it("every tool has a unique, snake_case name", () => {
    const names = tools.map((t: any) => t.name);
    expect(new Set(names).size).toBe(names.length); // unique
    for (const n of names) expect(n).toMatch(/^[a-z][a-z0-9_]+$/);
  });

  it("every tool has a substantive model-facing description", () => {
    for (const t of tools as any[]) {
      expect(typeof t.description).toBe("string");
      expect(t.description.length).toBeGreaterThan(20);
    }
  });

  it("every tool exposes a callable run()", () => {
    for (const t of tools as any[]) expect(typeof t.run).toBe("function");
  });

  it("every tool that takes input carries a valibot object schema", () => {
    for (const t of tools as any[]) {
      if (!t.input) continue; // read tools legitimately take none
      // A valibot schema exposes the standard-schema marker.
      expect(t.input).toHaveProperty("~standard");
      // ...and object schemas validate an empty-ish object without throwing on shape.
      expect(() => v.safeParse(t.input, {})).not.toThrow();
    }
  });

  it("read tools are a read-only subset of the full set (no writers leak in)", () => {
    const allNames = new Set(tools.map((t: any) => t.name));
    for (const rt of readTools as any[]) expect(allNames.has(rt.name)).toBe(true);

    // Ingestion tools should never be mutating verbs.
    for (const rt of readTools as any[]) {
      expect(rt.name).not.toMatch(/^(save|attach|create|delete|edit|stitch|score|toggle|commit|trim|sign|cast|pin|new|select|apply|add|rename|auto|load|like|remove)/);
    }
  });

  it("read tools cover the core sections (world, script, shotlist, timeline)", () => {
    const names = readTools.map((t: any) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(["get_world", "get_script", "get_shotlist", "get_timeline"]),
    );
  });
});
