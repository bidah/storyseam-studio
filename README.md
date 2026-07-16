# shot-studio

A browser studio for building the Whistlewood episode end-to-end: write the
screenplay, break it into shots, generate audio/video via Higgsfield, assemble
cuts, and drive the whole pipeline from a built-in chat agent. Multi-project,
with per-user accounts.

The header tabs are the workflow: **Script**, **Shot list**, **Episode**,
**Complete cuts**, **Editor**, **Library**, **Sound studio** — plus a project
switcher and the **Studio agent** chat panel on the right.

The **Radio** tab is the audio-only pass (every line voiced), and **Build
animatic** there joins it to the storyboard: each shot's still on a picture
track, timed to the voiced dialogue, so the episode can be watched before any
video is rendered. Shots with no still yet become labelled *slates* you can fill
by right-clicking the timeline. Design record: [`docs/prd-animatic.md`](docs/prd-animatic.md).

Each tab is a real **URL route** (`/script`, `/episode`, …) — React Router v7 in
data mode, with per-route lazy loading + loader-driven SWR caching. Architecture,
the revalidation rule, and gotchas are in [`docs/routing.md`](docs/routing.md).

## Architecture

Three processes, no Express server (the old Express/Render backend was retired):

- **Vite + React front-end** (`src/`, port **3333**). Renders the studio and
  proxies all data/media paths to the Worker (see `vite.config.js`). `/eve` is
  proxied to the agent so the chat is same-origin (no CORS).
- **Cloudflare Worker** (`worker/`, name `shot-studio-uploads`) — the backend.
  `src/index.js` + `src/routes/*` serve the JSON API and stream media; auth is
  Better Auth (`src/auth.js`). Storage: **D1** (`DB`) for project/script/shot
  data, **R2** (`BUCKET`) for media bytes, **KV** (`AUTH_KV`) for sessions. A
  Durable Object (`ProjectEvents`) fans out live-update SSE so edits sync across
  tabs. It also serves the built `dist/` as static `ASSETS` in production.
  Deployed at `https://shot-studio-uploads.rodrigofigueroa-name.workers.dev`.
- **Studio agent** (`agent/`, port **2000**) — an [eve](https://eve.dev) chat
  agent (model `anthropic/claude-sonnet-5`) that drives the pipeline through
  typed tools (`agent/tools/*.ts`) and render skills (`agent/skills/*`), calling
  the Higgsfield MCP (`agent/connections/`) to actually render audio/video.

By default the front-end talks to the **deployed** Worker, so `npm run dev` alone
gives a working app — no local backend needed.

## Running it

From this `shot-studio/` directory (`npm install` already done):

```bash
npm run dev        # front-end only on http://localhost:3333 → deployed Worker backend
```

To run the chat agent too (needs **Node ≥ 24**; the UI/Worker run on any Node):

```bash
cp .env.example .env   # fill in AI_GATEWAY_API_KEY (see Credentials)
npm run stack          # eve agent (:2000) + Vite (:3333) together
```

Or start pieces individually:

```bash
npm run dev                                 # UI on :3333
npm run agent:build && npm run agent:start  # eve agent on :2000
npm run worker:dev                          # local Worker on :8787 (wrangler dev)
```

To point the UI at a **local** Worker instead of the deployed one, set `WORKER`:

```bash
npm run worker:dev                          # terminal 1 → :8787
WORKER=http://localhost:8787 npm run dev    # terminal 2
```

### Production / deploy

```bash
npm run worker:deploy   # builds dist/ then `wrangler deploy` (Worker serves dist/ as ASSETS)
```

## Credentials (`.env`)

- `AI_GATEWAY_API_KEY` — **required** for the chat to reply (the model routes
  through the Vercel AI Gateway; create a key at
  https://vercel.com/dashboard/ai/api-keys, or run `vercel link` for OIDC).
- `HIGGSFIELD_MCP_URL` / `HIGGSFIELD_MCP_TOKEN` — required for **live**
  audio/video rendering via the skills; without them the pipeline management
  (script, shots, cuts, library) still works.

Worker-side secrets (R2 keys, Better Auth, D1) live in `worker/wrangler.jsonc`
vars and `wrangler secret`; see `.env.example`.

## API (proxied paths → Worker)

`vite.config.js` proxies these to the Worker (routes in `worker/src/routes/`):

- `/api` — JSON API: `projects`, `script`, `shotlist`, `episode`, `cuts`,
  `library`, `sounds`, `timeline`, `render`, `auth`.
- `/api/script/events`, `/api/timeline/events` — live-update **SSE** streams
  (no proxy buffering) backed by the `ProjectEvents` Durable Object.
- `/media`, `/multishot-media`, `/sound-media`, `/refs`, `/asset`, `/final`,
  `/gen`, `/files` — media served from R2.
- `/eve` — the Studio agent (proxied to `http://localhost:2000`).

## UI stack

Tailwind CSS v4 + shadcn/ui (New York, zinc base, emerald accent), Vite alias
`@/` → `src/`. See `CLAUDE.md` for component conventions (shadcn primitives,
lucide-react icons only, shared helpers in `src/components/shared.jsx`; each tab
lives in `src/routes/`).
