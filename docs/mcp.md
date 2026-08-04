# MCP server — driving shot-studio from Claude Desktop / Claude Code / Cursor

The Worker exposes a small **Model Context Protocol** server at
`POST /api/mcp` (`worker/src/routes/mcp.js`), so an external client that brings
its own model can read the pipeline and write the shot list without switching to
the app.

This is a **fourth surface**, not a replacement for the parity rule in
`CLAUDE.md`. The flue agent is still the in-app assistant that owns the skills,
the render pipeline, and the project context. MCP is the read-heavy slice for
authors who are already in an editor. Nothing that spends money or runs ffmpeg is
exposed here.

## Tools

| Tool | Kind | What it does |
| --- | --- | --- |
| `get_status` | read | The whole-pipeline digest — counts and flags, plus `stage`, the one word for what's blocking progress. Cheapest first call. |
| `get_world` | read | The World bible: story map, story depth, character + location rosters, linked sheets and voices. |
| `get_script` | read | The pinned screenplay draft, the drafts index, sign-off, pending proposal, specialist review state. |
| `get_shotlist` | read | Every per-shot entry plus the live `<=15s` multishot pack preview. |
| `get_episode` | read | The packed bundles, rendered takes, prompt overrides, sign-offs, and per-bundle scene-needs. Large payload. |
| `get_cuts` | read | The ordered stitch plan with timecodes, the music layout, and the cut version history. |
| `save_shotlist` | **write** | Replace or append shots. Preserves shot ids and canonicalizes character names against the World roster. |
| `list_history` | read | Saved earlier versions of a document, newest first. |
| `restore_version` | **write** | Put a saved version back. Parks the current one first, so it is reversible. |

Every tool calls the same exported helper the GUI route calls (`buildStatus`,
`buildWorldView`, `saveShotlist`, …) — there is no second implementation to drift.
When adding a tool, export the logic from the route file rather than copying it.

## Auth — `MCP_TOKEN`

The endpoint is reachable from the public internet, so unlike the rest of
`/api/*` it does **not** tolerate an anonymous caller. Two things are required:

1. **`Authorization: Bearer <MCP_TOKEN>`**, compared constant-time against the
   `MCP_TOKEN` secret. If the secret is **unset**, the endpoint is closed — the
   check fails rather than passes, so a deploy that forgets it does not ship an
   open write API.
2. **An explicit project id**, as `?projectId=<id>` or an `x-project-id` header.
   There is no fallback on purpose: `normalizeProjectId(null)` resolves to
   `p_default`, which is a *real* project, so an unscoped write lands in
   somebody's actual episode. The id is also checked against the `projects`
   table, so a typo fails loudly.

Set the secret:

```sh
cd worker
npx wrangler secret put MCP_TOKEN     # paste a long random string
npx wrangler deploy                   # or: npm run worker:deploy from the repo root
```

Generate one with `openssl rand -hex 32`. Rotating it is just another
`wrangler secret put` — clients then need the new value.

List your project ids with `GET /api/projects` (signed in), or read the
`projectId` out of the app URL.

## Connecting a client

**Claude Code:**

```sh
claude mcp add --transport http shot-studio \
  "https://storyseam.app/api/mcp?projectId=p_xxxxxxxx" \
  --header "Authorization: Bearer $MCP_TOKEN"
```

**Claude Desktop / Cursor** — in the MCP servers config:

```json
{
  "mcpServers": {
    "shot-studio": {
      "type": "http",
      "url": "https://storyseam.app/api/mcp?projectId=p_xxxxxxxx",
      "headers": { "Authorization": "Bearer YOUR_MCP_TOKEN" }
    }
  }
}
```

One project per server entry. To work on two projects, add two entries with
different `projectId` values and names.

## Wire protocol

Streamable HTTP, JSON only — one JSON-RPC 2.0 message per POST, one JSON
response back. No SSE (nothing here streams) and no JSON-RPC batching (removed in
the `2025-06-18` revision, so an array body is an invalid request). Methods:
`initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`;
anything else is `-32601`.

Two behaviors worth knowing when debugging a client that hangs:

- A **notification** (a message with no `id`) gets **HTTP 202 and an empty
  body**. Returning a JSON-RPC result to one is a protocol violation that strict
  clients disconnect over.
- A **tool that fails** comes back as a normal result with `isError: true`, not a
  protocol error — so the model can read the message and correct itself. Protocol
  error codes are reserved for messages the server could not dispatch at all.

Smoke-test it by hand:

```sh
curl -sX POST "$BASE/api/mcp?projectId=p_xxxxxxxx" \
  -H "Authorization: Bearer $MCP_TOKEN" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools[].name'
```

A `401` means the token is wrong or `MCP_TOKEN` is unset; an `isError` result
mentioning "No project selected" means the `projectId` never reached the Worker.

## Wiring in `worker/src/index.js`

Besides `registerMcp(app)`, two middleware exemptions are needed — both because
**every MCP message is a POST, reads included**, and the middleware stack reasons
about POSTs as mutations:

1. **Exempt `/api/mcp` from the "no active project" write guard**, the way
   `/api/extract` already is. Otherwise a client that hasn't been given a project
   yet gets a bare `400` on `initialize`, never completes the handshake, and so
   can never show the user the message telling them to add `?projectId=`.
   Scoping is enforced inside the route instead — per tool call, with no fallback
   and an existence check, which is stricter than the middleware's.
2. **Skip `/api/mcp` in the post-mutation live-sync firehose**, alongside
   `/api/chat-title`. Left in, every `get_status` from an editor would announce a
   data change and churn every open tab. The write tools broadcast for themselves
   (`announce()` in `mcp.js`), so nothing is lost. Until the skip is added, the
   two simply broadcast twice per write — a duplicate revalidate and nothing else.
