// Validate a request body against a shared capability schema
// (`shared/schemas/*.json`, vendored into `src/schemas/`).
//
// Until this existed, the only schema for a capability lived inside the flue
// tool — so the AGENT path was strictly typed while the GUI path and any direct
// HTTP caller went completely unchecked. `POST /api/shotlist` verified
// `Array.isArray(shots)` and nothing else: a shot missing `dur` sailed through
// and surfaced later as a broken pack preview, and a field the tool promised
// could quietly stop matching what the route accepted with nothing failing.
//
// One contract, validated here at the boundary every caller crosses. The agent
// builds its valibot input from the same file
// (flue-agent/src/lib/schema-to-valibot.ts), so tool and route can no longer
// disagree about what a capability takes.
//
// Deliberately permissive about EXTRA keys: routes legitimately accept more
// than the contract names (a shot carries editor-only fields, callers pass
// provenance). The job here is catching a malformed or missing field, not
// locking the payload down.

// The value is absent in the "the caller didn't send it" sense. `null` counts:
// JSON has no undefined, so a client that clears a field sends null.
const absent = (value) => value === undefined || value === null;

function typeName(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

// Depth-first check of one node. Pushes readable, path-prefixed messages onto
// `errors` — `shots[3].dur: expected number, got string` beats "invalid body"
// by enough to be worth the plumbing.
function checkNode(node, value, path, errors) {
  if (absent(value)) {
    if (!node.optional) errors.push(`${path || "body"}: required`);
    return;
  }

  switch (node.type) {
    case "string":
      if (typeof value !== "string") {
        errors.push(`${path}: expected string, got ${typeName(value)}`);
      }
      break;

    case "number":
    case "integer": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        errors.push(`${path}: expected ${node.type}, got ${typeName(value)}`);
        break;
      }
      if (node.type === "integer" && !Number.isInteger(value)) {
        errors.push(`${path}: expected an integer, got ${value}`);
      }
      break;
    }

    case "boolean":
      if (typeof value !== "boolean") {
        errors.push(`${path}: expected boolean, got ${typeName(value)}`);
      }
      break;

    case "enum":
      if (!node.values.includes(value)) {
        errors.push(`${path}: expected one of ${node.values.map((v) => `"${v}"`).join(", ")}, got ${JSON.stringify(value)}`);
      }
      break;

    case "array": {
      if (!Array.isArray(value)) {
        errors.push(`${path}: expected array, got ${typeName(value)}`);
        break;
      }
      if (!node.items) break;
      value.forEach((item, i) => checkNode(node.items, item, `${path}[${i}]`, errors));
      break;
    }

    case "object": {
      if (typeName(value) !== "object") {
        errors.push(`${path}: expected object, got ${typeName(value)}`);
        break;
      }
      for (const [key, field] of Object.entries(node.fields || {})) {
        checkNode(field, value[key], path ? `${path}.${key}` : key, errors);
      }
      break;
    }

    default:
      // An unknown type in the contract is a bug in the contract, not in the
      // request — say so loudly rather than silently passing the value through.
      errors.push(`${path}: schema declares unknown type "${node.type}"`);
  }
}

// `{ ok: true, value }` or `{ ok: false, errors: [...] }`.
export function validate(schema, body) {
  const errors = [];
  checkNode(schema.input, body, "", errors);
  // A long list of complaints about one malformed batch is noise; the first few
  // tell the caller everything they need to fix it.
  return errors.length
    ? { ok: false, errors: errors.slice(0, 8), total: errors.length }
    : { ok: true, value: body };
}

// The same contract as JSON Schema, which is what MCP puts on the wire for a
// tool's `inputSchema`.
//
// A third rendering of one contract sounds like exactly the duplication this
// file exists to remove, and it would be — if it were hand-written. Deriving it
// means the MCP surface, the HTTP route and the flue tool all describe the
// capability identically, including the field descriptions the model reads.
export function toJsonSchema(node) {
  const base = node.description ? { description: node.description } : {};
  switch (node.type) {
    case "string":
      return { ...base, type: "string" };
    case "number":
      return { ...base, type: "number" };
    case "integer":
      return { ...base, type: "integer" };
    case "boolean":
      return { ...base, type: "boolean" };
    case "enum":
      return { ...base, type: "string", enum: node.values };
    case "array":
      return {
        ...base,
        type: "array",
        ...(node.items ? { items: toJsonSchema(node.items) } : {}),
      };
    case "object": {
      const properties = {};
      const required = [];
      for (const [key, field] of Object.entries(node.fields || {})) {
        properties[key] = toJsonSchema(field);
        if (!field.optional) required.push(key);
      }
      return {
        ...base,
        type: "object",
        properties,
        ...(required.length ? { required } : {}),
      };
    }
    default:
      throw new Error(`toJsonSchema: unknown node type "${node.type}"`);
  }
}

// Route-level convenience: parse the JSON body and validate it in one step.
// Returns `{ ok: true, value }` or `{ ok: false, response }` where `response` is
// the 400 to return — so a handler reads:
//
//   const parsed = await validateBody(c, schema);
//   if (!parsed.ok) return parsed.response;
//
// The error names the capability, because a caller staring at a 400 from a tool
// call needs to know WHICH contract it failed.
export async function validateBody(c, schema) {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return { ok: false, response: c.json({ error: "Invalid JSON body" }, 400) };
  }
  const result = validate(schema, body);
  if (result.ok) return { ok: true, value: result.value };
  return {
    ok: false,
    response: c.json(
      {
        error: `Body does not match the ${schema.capability} contract`,
        issues: result.errors,
        ...(result.total > result.errors.length
          ? { truncated: `${result.total - result.errors.length} more` }
          : {}),
      },
      400,
    ),
  };
}
