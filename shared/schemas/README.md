# Shared capability schemas

**One schema per capability, shared by the worker route and the flue tool.**

A capability used to be described twice: once implicitly by whatever a
`worker/src/routes/*.js` handler happened to accept, and once explicitly by the
valibot schema inside `flue-agent/src/tools/*.ts`. Nothing linked them. The tool
could promise a field the route ignored, or the route could start requiring one
the tool never sends, and neither a build nor a test would notice — the failure
showed up as a confusing 400 in a chat transcript.

Worse, only the tool had a schema at all. `POST /api/shotlist` validated nothing
beyond `Array.isArray(shots)`, so the GUI path and any direct HTTP caller went
completely unchecked while the agent path was strictly typed.

These files are the single description. They are **plain JSON on purpose** — the
worker is JavaScript bundled by wrangler, the agent is TypeScript bundled by
flue, and a data file is the one form both consume without a syntax or
type-checking argument. (Same trade `flue-agent/src/lib/genui-schema.json`
already makes.)

## Shape

```jsonc
{
  "capability": "shotlist.save",     // stable id
  "route": "POST /api/shotlist",     // the worker route that implements it
  "tool": "save_shotlist",           // the flue tool that exposes it
  "description": "…",                // model-facing; becomes the tool description
  "input": { "type": "object", "fields": { … } }
}
```

Field types: `string`, `number`, `integer`, `boolean`, `enum` (+ `values`),
`array` (+ `items`), `object` (+ `fields`). Every node takes `description`
(model-facing text) and `optional`.

Unknown keys pass through. These schemas exist to catch a malformed or missing
field, not to lock the payload down — routes legitimately accept more than the
contract names.

## The two interpreters

| Side | Module | Job |
| --- | --- | --- |
| Worker | `worker/src/lib/validate.js` | validate an incoming body, return 400 with a readable path on failure |
| Agent | `flue-agent/src/lib/schema-to-valibot.ts` | build the tool's valibot input schema, descriptions and all |

The interpreters are per-package because each runtime wants a different thing
from the same contract. They are small and stable; the contract is what moves.

## Editing

Edit the file here, then:

```bash
npm run schemas:sync   # vendors into worker/src/schemas/ and flue-agent/src/schemas/
```

Vendoring (rather than a cross-package import) is the same call the rest of this
repo already makes for `render-fn`, `mobile-app/src/genui`, and
`desktop/main/routeTable.js`: each package's bundler resolves from its own root.
`npm run guards` fails if a copy drifts, so the sync can't be silently skipped.
