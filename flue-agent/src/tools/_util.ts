import * as v from "valibot";

// Zod's `.describe("…")` → Valibot. Attaches a model-facing description to a
// schema. Use everywhere a Zod field had `.describe(...)`.
export const d = (schema: v.GenericSchema, text: string) =>
  v.pipe(schema, v.description(text));
