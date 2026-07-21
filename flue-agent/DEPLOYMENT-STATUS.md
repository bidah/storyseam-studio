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

## OPEN ISSUE — prod `/eve/*` proxy returns 404 (blocks prod chat)

**Symptom.** Against the deployed main worker:
- `GET /` → `200` (SPA), `GET /api/projects` → `401` (worker handling `/api/*` ✓)
- `GET /eve` (bare) → `200`
- `GET /eve/health` → **`404`** (Cloudflare HTML error page, `server: cloudflare`,
  no worker headers) — but the flue worker's `/health` is `200` **directly**.
- `GET /eve/agents/whistlewood/<id>` → **`404`** — but flue direct is `401`.
- It returned `200 {"ok":true}` **once** right after the cutover, then consistently
  `404`.

**So:** the flue worker is healthy; the main worker runs (`/api/*` works); but the
`/eve/*` reverse-proxy is not reaching flue in production. A discriminator test
showed unknown routes (`/totally-random-xyz`) → `200` SPA index.html, so
`/eve/health`'s `404` is anomalous (a hard 404, not the SPA fallback).

**Leading hypotheses (unverified):**
1. **Worker-to-worker public-URL fetch is failing.** The proxy does
   `fetch(new Request(target, c.req.raw))` to the flue worker's `workers.dev` URL.
   Rebuilding from `c.req.raw` may carry a stale `Host` header, and CF worker→worker
   routing over the public URL can 404 on that. The eve setup worked because eve was
   on **Vercel** (different origin); flue is another **Cloudflare Worker**, which is
   the new variable.
   - **Recommended fix:** replace the public-URL proxy with a Cloudflare **service
     binding** to `shot-studio-flue` (the pattern the migration plan called for):
     add `"services": [{ "binding": "FLUE", "service": "shot-studio-flue" }]` to
     `worker/wrangler.jsonc`, and change the `/eve/*` handler in
     `worker/src/index.js` to `return c.env.FLUE.fetch(proxied)` (fallback to
     `fetch(proxied)` when the binding is absent, e.g. local dev). Redeploy the main
     worker. This avoids DNS/Host worker-to-worker issues entirely and is faster.
2. **`run_worker_first` not routing deep `/eve/*` to the worker.** `run_worker_first`
   lists `"/eve/*"`, and `/api/*` (also listed) works — but confirm the deep
   multi-segment `/eve/agents/<name>/<id>` paths are actually served worker-first and
   not intercepted by the assets layer. If needed, re-verify the glob semantics and
   the `app.all("/eve/*")` route ordering vs the `app.get("*")` assets catch-all.

**Next step:** try fix #1 (service binding) first — it's the most likely root cause
and the cleaner architecture — then re-test:
`curl -s -o /dev/null -w "%{http_code}\n" https://shot-studio-uploads.<...>.workers.dev/eve/health` (expect `200`).

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
  `load_skill` / `ask_question` — cosmetic wording cleanup.
- Optional: single-worker consolidation (fold flue into the main worker; drop the
  proxy + reverse HMAC; tools call bindings directly).
