# Fix: flue agent can't call the Higgsfield MCP on Cloudflare Workers

**Status:** proposed
**Owner:** —
**Scope:** `flue-agent/` only (the `shot-studio-flue` Worker). No changes to the main
`shot-studio-uploads` worker, the token bridge, or auth.

---

## 1. Problem

After the eve → flue migration, **Higgsfield login works** (the app's "Sign in with
Higgsfield" OAuth, and the worker token bridge `GET /api/agent/higgsfield-token`), but the
chat agent **cannot call the Higgsfield generation MCP** — from the model's point of view the
`generate_image` / `generate_video` / `generate_audio` tools simply aren't there, so every
render request fails or is refused.

This is the first time a live authenticated Higgsfield turn has actually run against the flue
worker — the migration verified auth boundaries and routing, but never a real MCP round-trip
(see `flue-agent/DEPLOYMENT-STATUS.md`).

## 2. Root cause

There are **two independent defects**. Either one alone breaks generation; both must be fixed.

### 2a. PRIMARY — flue's MCP client can't initialize on the Workers runtime (Ajv `eval`)

`flue-agent/src/lib/higgsfield.ts` builds the tool set with flue's `connectMcpServer`. That
helper (in `@flue/runtime`) constructs tools through the official
`@modelcontextprotocol/sdk`, and for **every tool that declares an `outputSchema`** it compiles
a JSON-Schema validator with **Ajv**:

```js
// @flue/runtime/dist/index.mjs  → createMcpTools()
const validator = new AjvJsonSchemaValidator();
const outputValidator = tool.outputSchema ? validator.getValidator(tool.outputSchema) : undefined;
```

```js
// @modelcontextprotocol/sdk/dist/cjs/validation/ajv-provider.js → getValidator()
? (this._ajv.getSchema(schema.$id) ?? this._ajv.compile(schema))
: this._ajv.compile(schema);
```

`Ajv.compile()` generates a validator function via **`new Function(...)`**. **Cloudflare
Workers forbid runtime code generation** (`eval` / `new Function`) — and `nodejs_compat` does
**not** lift that; it's a hard platform restriction. So the compile throws
`EvalError: Code generation from strings disallowed for this context`.

That throw happens at **connect/init time** inside `createMcpTools`, so it rejects the whole
`connectMcpServer(...)` promise — it kills the **entire** Higgsfield tool set, not one call.

And it is **swallowed silently**:

```ts
// flue-agent/src/lib/higgsfield.ts  (current)
try {
  const connection = await connectMcpServer("higgsfield", { url, transport, headers });
  return connection.tools;
} catch {
  return [];               // <-- eats the EvalError; agent gets ZERO higgsfield tools
}
```

`createHiggsfieldTools` returns `[]`, so `whistlewood.ts` registers no generation tools and the
model has nothing to call. This matches the symptom exactly ("cannot call the mcp", not "one
tool failed").

**Why eve never hit this:** eve ran on **Vercel (Node.js)**, where `new Function` is allowed, so
Ajv compiles fine; eve also used its own `eve/connections` MCP client, not the MCP-SDK-Ajv path.
The move to **Cloudflare Workers** is precisely what exposed it. The proof that raw MCP works on
Workers is already in this repo: `worker/src/lib/higgsfield.js` (`mcpToolCall`) talks to the
**same** endpoint successfully from the main Worker using **raw JSON-RPC over `fetch`, no Ajv**.

### 2b. SECONDARY — the render skills call the wrong tool names

Even once tools are registered, flue's `connectMcpServer("higgsfield", …)` names them
`mcp__higgsfield__<tool>` (server name `higgsfield`). But the ported skill bodies still instruct
the model to call `mcp__claude_ai_higgsfield__<tool>` (the claude.ai connector prefix) and to
`ToolSearch "select:…"` to load them — both are stale Claude-Code / eve-era conventions that do
**not** exist in flue (flue exposes tools directly; there is no deferred `ToolSearch`).

Affected files (16 occurrences of the wrong prefix + a `ToolSearch` line each):

- `src/skills/seed-audio/SKILL.md`
- `src/skills/continue-video/SKILL.md`
- `src/skills/generate-multishot/SKILL.md`
- `src/skills/generate-storyboard/SKILL.md`

The operating manual (`src/agents/whistlewood.md`) is already correct — it says the skills call
"the **Higgsfield MCP** (the `higgsfield` connection)". Only the skill bodies drifted.

## 3. Solution overview

1. **Replace flue's `connectMcpServer` for Higgsfield with a Workers-safe, hand-rolled MCP
   client** that mirrors the proven `worker/src/lib/higgsfield.js` `mcpToolCall`: raw
   streamable-HTTP JSON-RPC (`initialize → notifications/initialized → tools/list | tools/call`),
   **zero Ajv / zero `new Function`**. Discover tools once at agent init, wrap each as a flue
   `defineTool` named identically to today (`mcp__higgsfield__<tool>`), and stop swallowing
   errors silently.
2. **Fix the skill bodies** to call `mcp__higgsfield__<tool>` and drop the `ToolSearch` lines.

Contained to `flue-agent/`. The token bridge, `HIGGSFIELD_MCP_URL`, `FLUE_PROXY_SECRET`, and
auth are all correct and unchanged.

## 4. Implementation

### 4a. Rewrite `flue-agent/src/lib/higgsfield.ts`

New shape (self-contained; keeps the `createHiggsfieldTools(userId)` signature so
`whistlewood.ts` is untouched):

```ts
import { defineTool, type ToolDefinition } from "@flue/runtime";
import * as v from "valibot";
import { workerHiggsfieldToken } from "./worker-token.js";

const MCP_URL = () => process.env.HIGGSFIELD_MCP_URL;
const PROTOCOL_VERSION = "2025-03-26";

// --- raw streamable-HTTP JSON-RPC (mirrors worker/src/lib/higgsfield.js) ---

async function rpcPost(url: string, token: string, sessionId: string | null, body: unknown) {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
}

// Parse a JSON-RPC reply from either a plain-JSON or SSE (text/event-stream) body.
async function parseRpc(res: Response): Promise<any | null> {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/event-stream")) {
    const text = await res.text();
    let msg: any = null;
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        const j = JSON.parse(line.slice(5).trim());
        if (j && (j.result !== undefined || j.error)) msg = j;
      } catch { /* keep-alives / partial lines */ }
    }
    return msg;
  }
  if (res.status === 202) return null; // accepted notification, no body
  try { return await res.json(); } catch { return null; }
}

// Fresh, stateless initialize handshake → returns the mcp-session-id (may be null).
async function handshake(url: string, token: string): Promise<string | null> {
  const init = await rpcPost(url, token, null, {
    jsonrpc: "2.0", id: 0, method: "initialize",
    params: { protocolVersion: PROTOCOL_VERSION, capabilities: {},
              clientInfo: { name: "shot-studio-flue", version: "1.0.0" } },
  });
  if (!init.ok) throw new Error(`Higgsfield MCP initialize failed (${init.status})`);
  const sessionId = init.headers.get("mcp-session-id");
  await parseRpc(init); // drain
  try {
    await rpcPost(url, token, sessionId, { jsonrpc: "2.0", method: "notifications/initialized" });
  } catch { /* optional */ }
  return sessionId;
}

// tools/list (paginated) — parsed by us, NO schema compilation.
async function listTools(url: string, token: string): Promise<any[]> {
  const sessionId = await handshake(url, token);
  const out: any[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const res = await rpcPost(url, token, sessionId, {
      jsonrpc: "2.0", id: 1, method: "tools/list",
      params: cursor ? { cursor } : {},
    });
    if (!res.ok) throw new Error(`Higgsfield MCP tools/list failed (${res.status})`);
    const msg = await parseRpc(res);
    if (msg?.error) throw new Error(msg.error.message || "tools/list error");
    const r = msg?.result || {};
    out.push(...(r.tools || []));
    cursor = r.nextCursor;
    if (cursor && seen.has(cursor)) break;
    if (cursor) seen.add(cursor);
  } while (cursor);
  return out;
}

// tools/call — stateless (fresh handshake per call, like the worker). Re-fetches
// the bearer through the bridge each call so a long conversation never uses a
// stale token; force-refreshes once on an auth failure.
async function callTool(userId: string, name: string, args: Record<string, unknown>) {
  const url = MCP_URL()!;
  const run = async (force: boolean) => {
    const bridged = await workerHiggsfieldToken(userId, force);
    if (!bridged?.token) throw new Error("No Higgsfield credential for this user.");
    const sessionId = await handshake(url, bridged.token);
    const res = await rpcPost(url, bridged.token, sessionId, {
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name, arguments: args || {} },
    });
    return res;
  };
  let res = await run(false);
  if (res.status === 401 || res.status === 403) res = await run(true); // stale bearer → refresh once
  if (!res.ok) throw new Error(`Higgsfield MCP call failed (${res.status})`);
  const msg = await parseRpc(res);
  if (!msg) throw new Error("Empty Higgsfield MCP response");
  if (msg.error) throw new Error(msg.error.message || "Higgsfield MCP error");
  const r = msg.result || {};
  if (r.isError) {
    const t = (r.content || []).map((p: any) => p.text || "").join(" ").trim();
    throw new Error(t || "Higgsfield tool error");
  }
  if (r.structuredContent !== undefined) return r.structuredContent;
  const text = (r.content || []).find((p: any) => p.type === "text")?.text;
  try { return JSON.parse(text); } catch { return text; }
}

// --- public: discover tools once, wrap each as a flue tool ---

export async function createHiggsfieldTools(userId: string): Promise<ToolDefinition[]> {
  const url = MCP_URL();
  if (!url || !userId) return [];
  const bridged = await workerHiggsfieldToken(userId);
  if (!bridged?.token) return [];              // user has no Higgsfield credential — tools absent by design

  let discovered: any[];
  try {
    discovered = await listTools(url, bridged.token);
  } catch (err) {
    console.error("[flue] Higgsfield MCP discovery failed:", err); // was silently swallowed
    return [];
  }

  return discovered.map((tool) =>
    defineTool({
      name: `mcp__higgsfield__${tool.name}`,
      description: describeMcpTool(tool),  // tool.description + a summary of inputSchema props
      input: v.record(v.string(), v.unknown()),  // permissive; Higgsfield validates server-side
      async run({ input }) {
        return await callTool(userId, tool.name, (input ?? {}) as Record<string, unknown>);
      },
    }),
  );
}
```

Notes / decisions baked into the sketch above:

- **No Ajv anywhere.** We parse `tools/list` and `tools/call` results ourselves. This is the
  entire fix for 2a.
- **Tool names unchanged** (`mcp__higgsfield__<tool>`) so nothing else needs to know.
- **Input schema:** flue `defineTool` needs a valibot schema, and `@flue/runtime` does **not**
  export its internal `normalizeInputSchema` / `registerPreparedToolAdapter`, so we can't hand it
  the raw JSON Schema. Use a permissive `v.record(v.string(), v.unknown())` and fold the real
  parameter docs into the **description** (`describeMcpTool` — small helper that appends each
  `inputSchema.properties[k].description` + which are `required`). Higgsfield validates args
  server-side, so a bad shape returns a normal tool error, not a crash. *(Optional later
  enhancement: a small JSON-Schema→valibot converter for the common object/string/enum subset to
  get real client-side arg validation — not required for the fix.)*
- **Token freshness:** re-fetch the bearer through `workerHiggsfieldToken` **per call** (not once
  in closure) so long chats don't send a stale token; on `401/403` force-refresh once via the
  bridge's `?force=1`. This restores eve's lazy-`getToken` + refresh behavior.
- **Stateless per call** (fresh `initialize` each `tools/call`), exactly like the worker — simple
  and correct on a stateless runtime; avoids holding an MCP session across DO hibernation.
- **Errors surface** via `console.error` (visible in `wrangler tail`) instead of the blind
  `catch { return [] }`.

### 4b. Extend `workerHiggsfieldToken` to accept a `force` flag

`flue-agent/src/lib/worker-token.ts` — add an optional `force` param that appends `?force=1` to
the bridge URL (the worker route already supports it: `getHiggsfieldToken` vs
`forceRefreshHiggsfieldToken`):

```ts
export async function workerHiggsfieldToken(
  userId: string,
  force = false,
): Promise<{ token: string; expiresAt?: number } | null> {
  // …unchanged…
  const res = await fetch(
    `${api}/api/agent/higgsfield-token${force ? "?force=1" : ""}`,
    { headers: { authorization: `Bearer ${assertion}` } },
  );
  // …unchanged…
}
```

### 4c. Fix the skill bodies (defect 2b)

In the four files below, replace `mcp__claude_ai_higgsfield__` → `mcp__higgsfield__` and delete
the `ToolSearch "select:…"` lines (flue has no deferred tool loading — the tools are already on
the agent):

- `src/skills/seed-audio/SKILL.md`
- `src/skills/continue-video/SKILL.md`
- `src/skills/generate-multishot/SKILL.md`
- `src/skills/generate-storyboard/SKILL.md`

Mechanical: `grep -rl 'mcp__claude_ai_higgsfield__' src/skills | xargs sed -i '' 's/mcp__claude_ai_higgsfield__/mcp__higgsfield__/g'`
then remove the now-orphaned `ToolSearch` lines. Re-read each to confirm surrounding prose still
reads correctly.

### 4d. Remove the dead dependency path (optional cleanup)

Once `connectMcpServer` is no longer used, nothing in `flue-agent/src` imports the MCP-SDK Ajv
path directly, but `@flue/runtime` still bundles it. No action needed on deps; just delete the
old `connectMcpServer` import from `higgsfield.ts`.

## 5. Files touched

| File | Change |
|---|---|
| `flue-agent/src/lib/higgsfield.ts` | Rewrite: raw JSON-RPC MCP client + `defineTool` wrappers; drop `connectMcpServer`; `console.error` on failure |
| `flue-agent/src/lib/worker-token.ts` | Add `force` param → `?force=1` |
| `flue-agent/src/skills/seed-audio/SKILL.md` | `mcp__claude_ai_higgsfield__` → `mcp__higgsfield__`; drop `ToolSearch` |
| `flue-agent/src/skills/continue-video/SKILL.md` | same |
| `flue-agent/src/skills/generate-multishot/SKILL.md` | same |
| `flue-agent/src/skills/generate-storyboard/SKILL.md` | same |

`whistlewood.ts` unchanged (`createHiggsfieldTools(userId)` signature preserved).

## 6. Edge cases

- **No credential** (`workerHiggsfieldToken` → null): return `[]` — generation tools absent this
  turn, by design. (Consider a future in-chat "Sign in with Higgsfield" card — eve's interactive
  fallback was never ported; out of scope here.)
- **Token expiry mid-conversation:** handled by per-call re-fetch + one force-refresh on 401/403.
  Note Higgsfield also answers an *expired* bearer with a generic tool error (not always 401) —
  the bridge already refreshes 60s early and caps `expiresAt` at 10 min, so the per-call fetch
  cycles the token regularly.
- **SSE vs JSON replies:** `parseRpc` handles both (Higgsfield's streamable-HTTP endpoint returns
  `text/event-stream`).
- **Pagination:** `tools/list` cursor loop with a seen-set guard against a repeating cursor.
- **Discovery latency:** `createHiggsfieldTools` runs on every agent init (per turn). Discovery is
  one `initialize` + one `tools/list`. Acceptable; can be memoized on the DO later if needed.

## 7. Verification

1. `cd flue-agent && npx tsc --noEmit && npm run build` (or `flue build`) — compiles clean, no
   `connectMcpServer`/Ajv path referenced.
2. Deploy: `cd flue-agent && npx wrangler deploy`.
3. `npx wrangler tail shot-studio-flue` in one terminal; run a real render request from the app
   (a signed-in user on e.g. the Sound tab: "generate this line"). Confirm:
   - no `EvalError: Code generation from strings disallowed` in the tail;
   - if anything fails, the new `console.error("[flue] Higgsfield MCP discovery failed…")` shows
     the real reason (was previously invisible);
   - the model actually calls `mcp__higgsfield__generate_audio` / `…generate_video` and the
     result flows back through `attach_sound` / `attach_episode_video` / `attach_still`.
4. Sanity-check tool discovery independently with a real bearer (mirror of `worker`'s call):
   `initialize → tools/list` against `https://mcp.higgsfield.ai/mcp` returns the tool set.

## 8. Rollout

- Single `wrangler deploy` of `shot-studio-flue`. No main-worker redeploy, no secret/var changes,
  no schema/migration changes. Fully reversible (revert the commit + redeploy).

## 9. Out of scope / follow-ups

- Interactive in-chat Higgsfield OAuth fallback (eve's `AuthorizationCard`) — not ported.
- JSON-Schema→valibot converter for real client-side arg validation (currently permissive
  passthrough).
- Other stale eve-isms in skill bodies (`load_skill`, `ask_question` wording) — cosmetic, tracked
  separately in `flue-agent/DEPLOYMENT-STATUS.md`.
</content>
</invoke>
