# MCP server — driving shot-studio from Claude Desktop / Claude Code / Cursor

There are **two** MCP surfaces, for two different needs:

| | `POST /api/mcp` (token) | `/mcp` (OAuth connector) |
| --- | --- | --- |
| File | `worker/src/routes/mcp.js` | `worker/src/mcp-agent.js` |
| Auth | one shared `MCP_TOKEN` bearer | **per-user OAuth** (sign in once, approve) |
| Scope | **one** project (`?projectId=`) | the user's **whole account** — every project they own or can reach |
| Setup | CLI / secret only | a **Connector card in Settings** (paste URL, connect) |
| Surface | 9 mostly-read tools | reads + writes across the whole pipeline, generation kickoffs, and the skills as MCP **prompts** |
| Built on | hand-rolled JSON-RPC | Cloudflare `McpAgent` DO + `@cloudflare/workers-oauth-provider` |

The rest of this doc's older sections describe the **token** server; the OAuth
**connector** is documented in [The per-user OAuth connector](#the-per-user-oauth-connector)
below. Both are the same capabilities re-pointed at an external client that
brings its own model — a fourth surface, not a replacement for the `CLAUDE.md`
parity rule. The flue agent is still the in-app assistant.

The token server deliberately stays small (read-heavy, one project, nothing that
spends money). The connector is the opposite: it is what a user turns on to let
their own Claude/Cursor drive their whole StorySeam account.

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

---

# The per-user OAuth connector

`worker/src/mcp-agent.js` is a second MCP server, exposed at `/mcp` (streamable
HTTP) and `/sse` (legacy). Unlike the token server it is **per user** and scoped
to the user's **whole account**, and it is what the **Settings › MCP connector**
card wires up: a user pastes `https://storyseam.app/mcp` into any MCP client,
signs in once with Google, approves, and their client can then read and drive the
whole pipeline across all their projects.

## How it's built

- **`McpAgent`** (Cloudflare `agents` SDK) — a Durable Object, one instance per
  MCP session (`MCP_OBJECT` binding, class `ShotStudioMCP`, its own
  `new_sqlite_classes` migration in `wrangler.jsonc`).
- **`@cloudflare/workers-oauth-provider`** wraps the *entire* Worker
  (`export default` in `worker/src/index.js`). It serves `/mcp` + `/sse` only for
  a request bearing a valid access token, handles `/oauth/token` +
  `/oauth/register` itself, and passes everything else (the whole app) through to
  the Hono app as `defaultHandler`. Grants live in the **`OAUTH_KV`** namespace.
- **`/oauth/authorize`** (a Hono route in `index.js`) is the only custom OAuth
  step: it reuses the existing **Better Auth (Google)** session for the consent
  screen. Signed out → it kicks off Google sign-in returning to the authorize
  URL; signed in → an "Allow access" screen. On approval it calls
  `completeAuthorization({ props: { userId, email } })` — those props become the
  agent's `this.props`, which is what scopes every tool call.

## How tools reach data — no second implementation

Every tool is a thin call to the app's **own JSON API** (`worker/src/routes/*`),
dispatched through the **`SELF`** service binding (the Worker bound to itself, an
in-process worker→worker hop) with a freshly-minted `x-flue-agent-user` assertion
for the OAuth'd user — the same identity mechanism `flue-agent/src/lib/api.ts`
uses (`lib/proxy-token.js`, issuer `shot-studio-agent`). That single detail buys:

- the app's **fail-closed ownership middleware** scopes the caller to their own
  projects, cross-project, with zero new access-control code;
- writes are **attributed** (`actor=agent`) and episode-scoped, landing in
  `doc_history` like any other write;
- the tool surface **can't drift** from the GUI, because it *is* the GUI's API.

`SELF` falls back to a public-URL `fetch(WORKER_PUBLIC_URL)` when the binding is
absent (local dev). Write tools are **permissively typed** on purpose — the real
contract lives server-side in the shared schemas (`worker/src/lib/validate.js`),
and duplicating it in the MCP input schema is the exact drift the shared schemas
exist to prevent. A bad body comes back as the route's own 4xx for the model to
correct.

## Tool + prompt surface

Reads across the whole pipeline (`list_projects`, `get_status`, `get_world`,
`get_script`, `list_drafts`, `lint_script`, `get_script_reviews`, `get_shotlist`,
`list_shots`, `get_episode`, `list_episodes`, `get_radio`, `get_sounds`,
`get_cuts`, `get_storyboard`, `get_visual_world`, `list_library`, `get_musical`,
`list_history`, `list_doc_history`); session context (`use_project`,
`use_episode`, `create_project`); writes (`add_world_character`/`_location`,
`update_world_character`/`_location`, `save_script`, `new_draft`, `pin_draft`,
`sign_script`, `save_shotlist`, `create_episode`, `set_episode_style`,
`save_episode_prompt`, `select_take`, `restore_version`); the image surfaces
below; and the long jobs (`render_timeline_video`, `stitch_cut`, polled via
`get_job`). The flue **skills** are exposed as MCP **prompts**
(`worker/src/mcp-prompts.js`) — `orient`, `script-writing`, `world-creation`,
`shot-list`, `generate-storyboard`, `generate-multishot`, `complete-cut`,
`recover-lost-content` — so the client's model can load a playbook and then
drive the tools the way flue does.

## Images — getting one IN, then pinning it to something

Every image picker the app itself ships starts from something already inside the
project: a library `rel`, a Visual-tab generation id, a still's file. A remote
MCP client starts from **neither** — it holds a URL its model just produced, or
the bytes of a file the user pointed it at. That mismatch was a real hole: the
connector shipped with no upload tool and no attach tools, so a client asked to
set a character's sheet image could only put an image field on
`add_world_character` — where it normalized to `null` and the call still
answered `ok`. Two silent failures, and a duplicate roster entry from the retry.

The fix is one entry point plus one input shape:

- **`upload_image`** brings an image in from outside — `url` (a direct https
  image URL) or `data` (base64 bytes / a data: URI), png/jpeg/webp/gif, 20MB.
  It walks the same two steps the browser's MediaPicker Upload tab does —
  `POST /api/upload` then `POST /api/library/import` — and returns the library
  `rel`, plus `refUrl`, the absolute full-resolution URL an external image model
  can fetch.
- Every attach tool takes **either** `rel` (an image already in the project) or
  `url` / `data` (imported in the same call), and `clear: true` to unlink. So the
  one-call path a model reaches for first is the path that works.

The attach surfaces, one per image-reference use case the app has:

| Use case | Tool |
| --- | --- |
| Character sheet (the World portrait; rides into every render they're in) | `attach_character_sheet` |
| Wide-shot miniature (full-figure, for establishing shots) | `attach_character_miniature` |
| Location sheet (auto-supplied to shots at that location) | `attach_location_sheet` |
| Storyboard still for a shot (the animatic's picture) | `attach_still` → `select_still` |
| A bundle's scene references (what its render is conditioned on) | `select_reference`, `link_reference`, `auto_assign_refs` |
| The still a bundle's video opens on | `set_first_frame` |
| Style-reference video, episode-wide or per scene | `set_video_reference` |
| Concept art on the World › Visual tab | `attach_visual_generation` → `save_generation_to_library` |
| Moodboard reference cards | `add_moodboard_card` |
| The final-selection shortlist | `toggle_library` |

Two supporting server-side changes make that surface honest, and they apply to
**every** caller, not just MCP:

- `normalizeSheetImage` (`worker/src/routes/world.js`) now accepts a bare URL
  string, `refUrl`/`src` aliases, and a `rel` alone (deriving `/asset/` +
  `/thumb/`). The GUI always sent the full `{ rel, url, thumb, name }`; agents
  hold exactly one of those fields, and a strict reading turned them into `null`.
- The character/location create + update routes now **400** on an image field
  that carries no usable reference, instead of storing `null` — silence there is
  indistinguishable from "no image", which is what let a caller report success
  and link nothing.

The one thing an MCP client still can't do is upload a **video** from local
bytes; `set_video_reference` and `attach_episode_video` take a public URL.

Note the token server (`POST /api/mcp`) does **not** carry any of this — it is
the deliberately small read-only slice described at the top of this file.

## Approval / spend

We rely on the **MCP client's native per-tool-call approval** (every client
prompts the user before running a tool) rather than re-implementing the in-app
two-phase approval, which needs a chat-transcript round-trip a remote client has
no equivalent of. Credit-spending tools say so in their descriptions.

## Provisioning + deploy

The connector needs an OAuth KV namespace and the same proxy secret the flue hop
already uses. One-time:

```sh
# 1. Create the grants store, then paste the returned id into wrangler.jsonc
#    (kv_namespaces → OAUTH_KV, replacing REPLACE_WITH_OAUTH_KV_NAMESPACE_ID).
cd worker && npx wrangler kv namespace create OAUTH_KV

# 2. FLUE_PROXY_SECRET must already be set (it signs the flue hop too). If not:
#    npx wrangler secret put FLUE_PROXY_SECRET
```

Then ship it — this touches only the API/UI Worker, not the flue worker:

```sh
npm run worker:deploy
```

Nothing to deploy on `shot-studio-flue-v2`: the MCP tools call `/api` directly
rather than going through flue.
