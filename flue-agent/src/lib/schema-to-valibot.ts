// Build a tool's valibot input schema from a shared capability contract
// (`shared/schemas/*.json`, vendored into `src/schemas/`).
//
// The agent side of the same contract the worker validates against
// (worker/src/lib/validate.js). Before this existed, a capability was described
// twice — once by the valibot schema hand-written in the tool, once implicitly
// by whatever the route happened to accept — with nothing linking them. Two
// descriptions of one thing drift, and the drift is invisible until a tool call
// comes back 400 in a chat transcript.
//
// The `description` on every node is what the MODEL reads to decide how to fill
// the field, so it has to survive the translation intact — that is most of what
// this file does.

import * as v from "valibot";

// The contract node shapes, mirroring shared/schemas/README.md.
export interface SchemaNode {
  type: "string" | "number" | "integer" | "boolean" | "enum" | "array" | "object";
  description?: string;
  optional?: boolean;
  values?: string[];
  items?: SchemaNode;
  fields?: Record<string, SchemaNode>;
}

// What flue's defineTool accepts for `input`: a schema whose output is an
// object. Every capability contract roots in one.
type ObjectSchema = v.GenericSchema<Record<string, unknown>>;

export interface CapabilitySchema {
  capability: string;
  route: string;
  tool: string;
  description: string;
  input: SchemaNode;
}

const describe = (schema: v.GenericSchema, text?: string): v.GenericSchema =>
  text ? (v.pipe(schema, v.description(text)) as unknown as v.GenericSchema) : schema;

function build(node: SchemaNode): v.GenericSchema {
  switch (node.type) {
    case "string":
      return describe(v.string(), node.description);
    case "number":
      return describe(v.number(), node.description);
    case "integer":
      return describe(
        v.pipe(v.number(), v.integer()) as unknown as v.GenericSchema,
        node.description,
      );
    case "boolean":
      return describe(v.boolean(), node.description);
    case "enum":
      return describe(v.picklist(node.values ?? []), node.description);
    case "array":
      return describe(
        v.array(node.items ? build(node.items) : v.unknown()),
        node.description,
      );
    case "object": {
      const entries: Record<string, v.GenericSchema> = {};
      for (const [key, field] of Object.entries(node.fields ?? {})) {
        const inner = build(field);
        // `optional` has to wrap the DESCRIBED schema, not the other way round —
        // valibot keeps the description on whatever it is piped onto, and a
        // description lost here is a field the model fills by guessing.
        entries[key] = field.optional
          ? (v.optional(inner) as unknown as v.GenericSchema)
          : inner;
      }
      return describe(v.object(entries) as unknown as v.GenericSchema, node.description);
    }
    default:
      // An unrecognised type means the contract is ahead of this interpreter.
      // Fail at agent construction rather than shipping a tool whose schema
      // silently accepts anything.
      throw new Error(
        `schema-to-valibot: unknown node type "${(node as SchemaNode).type}"`,
      );
  }
}

// The tool's `input` schema, derived from the contract.
//
// `options` covers the two things a tool legitimately needs on top of the shared
// contract, and nothing else:
//
//   extend       fields that belong to the TOOL, not the capability — the
//                approval-gate's `approval_token` is the case in point: the
//                route neither sends nor understands it.
//   makeOptional fields the contract requires but that a particular call shape
//                omits. Again the gate: the confirming second call carries only
//                a token, because the payload it approves is replayed from the
//                stored approval rather than retyped by the model.
//
// Anything beyond those two is a sign the contract itself should change, so the
// route learns about it too.
export function inputSchema(
  // `unknown` rather than CapabilitySchema because a JSON module's inferred type
  // widens every literal — `"object"` becomes `string` — so the structural type
  // can never line up. The cast belongs here, once, next to the code that knows
  // the shape, rather than at each of the call sites.
  raw: unknown,
  options?: {
    extend?: Record<string, v.GenericSchema>;
    makeOptional?: string[];
  },
): ObjectSchema {
  const schema = raw as CapabilitySchema;
  const base = build(schema.input) as unknown as {
    entries?: Record<string, v.GenericSchema>;
  };
  if (!options || (!options.extend && !options.makeOptional)) {
    return base as unknown as ObjectSchema;
  }
  if (!base.entries) {
    throw new Error(
      `inputSchema(${schema.capability}): extend/makeOptional need an object input`,
    );
  }
  const entries: Record<string, v.GenericSchema> = { ...base.entries };
  for (const key of options.makeOptional ?? []) {
    if (!entries[key]) {
      throw new Error(
        `inputSchema(${schema.capability}): cannot make unknown field "${key}" optional`,
      );
    }
    entries[key] = v.optional(entries[key]) as unknown as v.GenericSchema;
  }
  Object.assign(entries, options.extend ?? {});
  return v.object(entries) as unknown as ObjectSchema;
}
