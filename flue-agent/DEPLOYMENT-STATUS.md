# flue migration — deployment status & open issues

_Snapshot of the eve → flue migration deployment. See `DEPLOY.md` for the runbook
and the repo commits (`2fa82d5`, `89af771`, `7a67b82`) for the code._

## What's deployed

- **`shot-studio-flue` Worker — LIVE** at
  `https://shot-studio-flue.rodrigofigueroa-name.workers.dev`.
  - Durable Objects created (`FlueWhistlewoodAgent`, `FlueRegistry`).
  - `AI` binding (Workers AI) enabled; vars `SHOT_STUDIO_API`, `HIGGSFIELD_MCP_URL`.
  - Secret set: **`FLUE_PROXY_SECRET`** (same value on both workers).
  - **Verified directly**: `GET /health` → `200`; `GET /agents/whistlewood/<id>`
    with no proxy header → `401`; wrong-owner id → `403`; bad id → `400`; a POST
    with a valid HMAC → `202` durable submission. The auth boundary + routing work.
- **`shot-studio-uploads` Worker — cutover deployed**: `/eve/*` now targets
  `FLUE_ORIGIN` (the flue worker), injects the session `userId` into the instance
  id, and mints `x-flue-proxy-user`. `FLUE_PROXY_SECRET` set (falls back to
  `EVE_PROXY_SECRET`). New flue web client shipped as the SPA `dist/`.

## Model config

- **Default: `cloudflare/@cf/moonshotai/kimi-k2.6`** (Cloudflare Workers AI —
  no external key, billed to the CF account, auto-routed through CF AI Gateway).
- Picker (web + mobile): **Kimi K2.6** (default), **GPT-OSS 120B**, **GLM 4.7 Flash**
  — all Workers AI, no key — plus **Claude Sonnet 5 / Opus 4.6 / Fable 5**
  (`anthropic/*`), which require `ANTHROPIC_API_KEY` on the flue worker (not yet
  set; selecting a Claude model errors until it is). Set it with:
  `cd flue-agent && npx wrangler secret put ANTHROPIC_API_KEY` (+ optional
  `ANTHROPIC_GATEWAY_URL` to route Claude through CF AI Gateway too).

### Key/gateway clarification
CF AI Gateway is a **proxy** in front of provider APIs — it does not remove the
need for a provider key. Two paths:
- **Workers AI (`cloudflare/@cf/…`)** → runs on Cloudflare, **no external key**,
  auto through AI Gateway. This is what the default (Kimi) uses.
- **Anthropic via CF AI Gateway (`anthropic/*`)** → still needs an Anthropic key
  (from console.anthropic.com); the gateway just adds caching/logging/limits.

## RESOLVED — prod `/eve/*` proxy now reaches flue (service binding)

**Was:** against the deployed main worker, `/eve/health` → `404` (Cloudflare HTML
error page, no worker headers) and `/eve/agents/whistlewood/<id>` → `404`, even
though flue direct was `200` / `401`. It returned `200 {"ok":true}` once right
after cutover, then consistently `404` — the classic symptom of a flaky
worker→worker **public-URL** fetch (hypothesis #1).

**Fix applied (hypothesis #1 — service binding):**
- `worker/wrangler.jsonc`: added
  `"services": [{ "binding": "FLUE", "service": "shot-studio-flue" }]`.
- `worker/src/index.js` `/eve/*` handler: rebuilt the proxied `Request` with an
  explicit `Headers` copy that **drops the inbound `Host`** (a stale Host was the
  likely 404 trigger over the public URL), streams the body with `duplex:"half"`
  for non-GET, and dispatches through the binding —
  `c.env.FLUE.fetch(proxied)` — with a `fetch(proxied)` fallback. The binding is
  **gated to non-localhost origins** so local dev (flue as its own `flue dev`
  process reached over a localhost `FLUE_ORIGIN`) still uses `fetch()`, since a
  `wrangler dev` service binding would try to resolve a local `shot-studio-flue`.

**Verified in prod** (`shot-studio-uploads.rodrigofigueroa-name.workers.dev`):
- `/eve/health` → `200 {"ok":true}` (10/10 stable, no intermittent 404)
- `/eve/agents/whistlewood/<id>` no-auth → `401 {"error":"Unauthorized"}` (10/10)
- `/api/projects` → `401`, `/` → `200` (SPA) — unchanged.

The auth boundary is now reachable end-to-end through the proxy. A real
authenticated turn (session cookie → minted `x-flue-proxy-user`) is exercised by
the manual app test. Both workers have `FLUE_PROXY_SECRET` set (same value).

## Local dev

- `flue dev` boots (`http://127.0.0.1:<port>`), agent `whistlewood` registered;
  the auth boundary was verified locally (`401`/`403`/`400`/`202`).
- The web `/eve` Vite proxy now points at the **main Worker** (`wrangler dev`), so
  the local chain is Vite → main Worker → flue Worker. Set `FLUE_ORIGIN` in
  `worker/.dev.vars` to the `flue dev` URL.
- **Mobile:** run Metro from the `feat/flue-migration` checkout (code + `node_modules`
  must both be flue — a symlinked master `node_modules` caused an `eve/react`
  red-screen). Typecheck is clean; the app boots. Real chat is blocked on the same
  `/eve` proxy issue above.

## Not done / follow-ups

- Fix the prod `/eve/*` proxy (above) — **the one blocker for prod chat.**
- Set `ANTHROPIC_API_KEY` (+ `ANTHROPIC_GATEWAY_URL`) only if the Claude picker
  options are wanted.
- Retire the old Vercel `shot-studio-agent` project (agent code + root `vercel.json`
  already removed from the repo).
- Higgsfield interactive-OAuth fallback was not ported (token-bridge path only).
- Skill bodies (`radio`, `script-writing`, `world-creation`) still mention eve's
  `load_skill` — cosmetic wording cleanup. (The `ask_question` references are now
  valid — see below.)

## DONE — interactive question cards (`ask_question`) rebuilt

eve's blocking HITL `ask_question` is back as a **non-blocking recreation** (flue
can't suspend a turn — a tool's `run` only returns JSON). New `ask_question` tool
(`flue-agent/src/tools/ask_question.ts`, input `{ question, options:[{id,label,style}] }`)
surfaces as a `dynamic-tool` part the clients render as an interactive card; the
agent ends its turn and the user's pick (or a typed reply) arrives as the next
message. Whistlewood prompt "Asking the user" updated; root-agent only (subagents
can't pause). Web (`src/components/AgentChat.jsx` — `QuestionCard`/`deriveQA`) and
mobile (`mobile-app/src/components/chat/*`) both done. **Verified live on
`/world`:** card renders, option click sends the answer + collapses to
"Responded: …", agent continues. Deployed to the flue worker. NOTE: a pre-existing
non-fatal Streamdown streaming warning ("Maximum update depth") surfaces on plain
text parts during streaming — independent of this feature; follow-up.
- Optional: single-worker consolidation (fold flue into the main worker; drop the
  proxy + reverse HMAC; tools call bindings directly).
