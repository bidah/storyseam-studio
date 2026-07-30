# shot-studio

Vite + React front-end (`src/`, port 3333) backed by a Cloudflare Worker
(`worker/`, name `shot-studio-uploads` — D1 for ALL per-project JSON state + R2
for media blobs only + KV + a `ProjectEvents`
Durable Object for live-sync SSE) for building the Whistlewood episode: script,
shots, audio/video renders, cuts, and library. A [flue](https://flueframework.com)
chat agent (`flue-agent/`, its own Cloudflare Worker `shot-studio-flue`, proxied at
`/eve`) drives the pipeline via typed tools + render skills. See `README.md` for
architecture and how to run it.

## Storage — D1 for state, R2 for bytes

**Per-project JSON state lives in D1, never as objects in R2.** Every doc store
(world, shotlist, sounds, selections, cuts, episode-manifest, visual-world,
radio, stills, script, …) is a row in the `docs` table keyed `(project_id,
name)`, reached ONLY through `worker/src/lib/docs.js`. This is a multi-tenant
app: per-tenant state belongs in the database, where it gets transactional
writes, per-row scoping, and D1 **Time Travel** (30-day point-in-time recovery).
R2 holds media bytes — images, audio, video, uploads — and nothing else. Do not
add a new `*.json` object to R2 for app state.

- **Mutations use `updateDoc`, not `readDoc` + `writeDoc`.** `updateDoc` is a
  compare-and-swap on the row's `version` with jittered retry; a bare
  read-then-write is last-writer-wins and silently drops concurrent edits (a
  burst of parallel roster adds used to lose about half of them). Reserve
  `writeDoc` for a genuine whole-document replace.
  A `writeDoc` call needs a `guard:allow-write-doc — <why>` comment above it or
  the `doc-mutations` guard fails.
- **Every write is versioned AND attributed.** `docs.js` parks the value it
  replaced in `doc_history` (`worker/src/lib/history.js`), surfaced by
  `/api/history/*`, the `<DocHistory>` dialog, and the agent's `list_history` /
  `restore_version`. Time Travel is whole-database and destructive, so it can't
  serve per-document undo — that's what this is for. Each entry also records
  `actor` / `caller` / `chat_id`, read from the request's AsyncLocalStorage store
  (`worker/src/lib/request-context.js`) so no call site has to pass them.
- Schema lives in `worker/schema.sql`; apply with
  `npx wrangler d1 execute shot-studio-uploads --remote --file=schema.sql`.

## Guards — `npm run guards`

The rules in this file that fail SILENTLY are mechanised in `scripts/guards/`
and run by `npm run guards`: a stale vendored copy, an `/api` route the agent
can't reach, a read-then-write mutation, app state written back to R2. Run it
before a commit that touches the worker, the agent, or anything vendored.

Two of them keep a ledger under `scripts/guards/baselines/`. A baseline is debt,
not an exemption: the guard reports entries that no longer fire so they get
deleted. `baselines/agent-parity.txt` in particular is the live list of routes
the GUI can reach and the agent can't — the parity backlog, in one file.

## Auth — everything that reaches `/api` is authenticated

The ownership middleware in `worker/src/index.js` **fails closed**: no identity
means 401, and an identity that doesn't own the project means 403. Two
credentials satisfy it — the Better Auth session cookie, and the flue agent's
signed `x-flue-agent-user` assertion (`worker/src/lib/proxy-token.js` ⇄
`flue-agent/src/lib/agent-identity.ts`), minted from the user id encoded in the
conversation's instance id.

**A new caller of `/api` must carry one of the two.** Agent tools get it for free
by going through `flue-agent/src/lib/api.ts`; a call path that bypasses that
client needs the header itself. The exempt prefixes (`/api/auth/`,
`/api/projects`, `/api/extract`, `/api/agent/`, `/api/mcp`) each carry their own
credential — the list is commented at the middleware.

## Shared capability schemas

`shared/schemas/*.json` describes a capability ONCE: the worker route validates
incoming bodies against it (`worker/src/lib/validate.js`) and the flue tool
builds its valibot input from it (`flue-agent/src/lib/schema-to-valibot.ts`),
descriptions included. Edit the file in `shared/schemas/`, then
**`npm run schemas:sync`** to vendor it into both packages (`npm run guards`
fails if a copy drifts).

Before this existed the only schema for a capability lived inside the tool, so
the agent path was strictly typed and the GUI path was unchecked. When you add
validation to a route, put the contract here rather than inline.

## Feature parity — GUI AND agent, always

Every feature must work **both** ways: through the GUI **and** through the flue
agent, which must be able to run the whole pipeline by itself. A new `/api/...`
capability therefore ships with three parts, and a feature is not done until all
three exist:

1. the worker route (`worker/src/routes/`),
2. the GUI surface (`src/routes/`),
3. the agent surface — a typed tool (`flue-agent/src/tools/` + registration in
   `tools/index.ts`) and, when the flow has more than one step, a skill playbook
   (`flue-agent/src/skills/<name>/SKILL.md` + registration in `src/skills.ts`)
   that wires the tools together the same way the GUI does.

When touching an existing feature, check the agent side didn't fall behind
(e.g. a GUI button calling a route no tool exposes = a parity gap — close it).
The `agent-parity` guard now catches this for you. Skill descriptions carry the
behavioral rules (the agent model leans on them), so put hard constraints in the
SKILL.md `description:` too, not just the body.

### Context awareness — the agent can see the screen, and move it

The client reports its current tab and selection to `PUT /api/appstate` on every
route change (`src/lib/appState.js`, wired in `RootLayout`). The agent reads it
back through the **`view_screen`** tool, which re-fetches the LIVE records those
ids point at rather than trusting the stored copy — so "make this shot wider"
resolves without a round-trip. What's stored is ids and short labels only; the
route enforces that with a size cap.

State is keyed **per user** (doc name `appstate:<userId>`), because two
collaborators on one project are looking at different screens.

The return leg is **`navigate`** → `POST /api/navigate` → the `nav` SSE channel
→ `RootLayout` moves the tab. It's a one-shot command, deliberately not stored:
replaying "go to Radio" on a reconnect would yank the author out of whatever
they moved on to.

### Destructive tools are gated

`save_shotlist` (a shrinking `replace` only), `stitch_cuts`, `restore_version`
and `delete_sound_version` don't execute on the first call. They register a
pending op (`POST /api/approvals`) and return an `approvalToken`; the agent draws
a `render_ui` confirm card, and only a second call carrying that token executes —
replaying the STORED params, not what the model re-typed. See the
`destructive-approval` skill. flue can't suspend a turn, so the transcript
round-trip is the suspend mechanism.

Keep this list short. A gate that fires often trains the author to tap through
without reading, which is worse than no gate.

### The pipeline is also an MCP server

`POST /api/mcp` exposes the read tools plus `save_shotlist` / `restore_version`
to Claude Desktop, Claude Code and Cursor. It authenticates with its own bearer
(`MCP_TOKEN`) and requires an explicit `?projectId=` — it never falls back to a
default project. Details in `docs/mcp.md`. The tools reuse the same route
helpers the HTTP surface does (`buildStatus`, `buildShotlistView`, `saveShotlist`,
…), so there is no second implementation to drift.

## Deploying — ship BOTH workers

A feature usually spans **both** Cloudflare Workers: the API/UI in `worker/` **and**
the agent skill/tools in `flue-agent/`. **Deploy both, or the feature is
half-broken** — e.g. a new `/api/...` route deploys but the agent can't call it
(the `attach_*` tool lives in the stale flue worker), or vice versa. When a change
touches only one, deploy only that one — but check.

- **API + SPA worker** (`shot-studio-uploads`): `npm run worker:deploy` (builds
  Vite, then `wrangler deploy` in `worker/`). Worker-only route changes tested via
  local web don't strictly need the rebuild — `cd worker && npx wrangler deploy`
  suffices — but a full `worker:deploy` keeps prod's SPA in sync too.
- **Flue agent worker** (`shot-studio-flue`): `npm run flue:deploy` (`flue build`
  then `wrangler deploy`). Required whenever you add/change a skill (`src/skills/`),
  a tool (`src/tools/`), or `agents/*.md`.
- **Local-dev caveat:** `npm run dev` / `npm run stack` proxies `/api` to the
  **deployed prod** worker by default (`WORKER` unset in `vite.config.js`), so a new
  worker route won't appear locally until it's deployed (symptom: existing routes
  return JSON, the new one returns `text/html` SPA fallback). Deploy the worker, or
  run a local one with `WORKER=http://localhost:8787 npm run dev` + `cd worker &&
  npx wrangler dev`.

### Mobile OTA after a commit

After **any commit that touches `mobile-app/`**, **ask** whether to publish an EAS
**preview** OTA update — do NOT publish on your own. A `PostToolUse` hook in
`.claude/settings.json` fires on exactly those commits and is what raises the
question, so the prompt comes from the hook rather than from remembering this
rule. On a yes, run `cd mobile-app && npm run update:preview` (i.e. `eas update
--channel preview --platform ios --environment preview`) and tell the user it
shipped. (Renderer/JS-only changes ship over-the-air; a native/config change
instead needs a fresh build, not an OTA — in that case say so instead of offering
the OTA.)

## Desktop app (macOS, `desktop/`)

Electron shell hosting the SAME Vite build on a privileged `app://` origin; an
origin bridge forwards backend paths to the deployed Worker. The proxy path
list is **`src/lib/routeTable.js`** — the single source of truth shared by
`vite.config.js` and the bridge (vendored into `desktop/main/` by
`npm --prefix desktop run sync`, auto-run by desktop scripts; parity test in
`test/web/routeTable.test.js`). Add a new backend prefix ONLY there.
`npm run desktop:dev` (HMR) / `desktop:start` (prod mode) / `desktop:dist`
(signed build) / `desktop:publish` (upload update feed to R2). Details:
`desktop/README.md`. Desktop-only renderer behavior hangs off `window.desktop`
(`src/lib/desktop.js` seam) — the web build must stay unaffected.

## Routing & data

URL routing is **React Router v7 in data mode** (`src/router.jsx` → `RootLayout` +
one lazy-loaded route per tab in `src/routes/*.jsx`, each exporting `{ Component,
loader }`). Tabs fetch through their route **`loader`** (stale-while-revalidate via
`src/lib/swr.js`), **not** `useEffect`; components read data with `useLoaderData()`,
and load errors render through the route's `ErrorBoundary` (`RouteError`).

**After any mutation: `invalidateTabCache(key); revalidate()`** — the canonical
pair. `RootLayout` wires that same pair to the three "data changed" signals (the
`/api/data/events` SSE firehose, the Refresh button, and project switch). `reloadKey`
survives **only** as a media cache-bust nonce (`?v=` on `<video>`/`<img>`/`<audio>`),
not for data. Do NOT loaderize the Script (TipTap) or Editor (Remotion) surfaces —
they own their document state. Full route tree, gotchas, and the Worker
`run_worker_first` caveat: **`docs/routing.md`**.

## Timeline model (Editor / animatic)

`src/editor/timeline.js` is the canonical shape and is **vendored** into
`render-fn/` — after editing anything in `src/editor/*`, run
`cd render-fn && npm run sync`, or the Vercel render path silently renders the old
composition.

**Media kind belongs to the ITEM, not the track.** A `type:"video"` track is the
*picture* lane; `item.kind` decides what each item is (absent ⇒ `"video"`):

- `kind:"image"` — a storyboard still held on screen (the animatic's picture).
  It has **no source timeline**: `offsetFrames` is always 0 and
  `sourceDurationInFrames` is always absent (so resize is uncapped). Any code
  doing in-point math (head-trim, split) **must** branch on it — `isImageItem()`
  in `src/editor/timeline.js`, `isImage()` in `worker/src/routes/timeline.js`.
- `kind:"image"` with `src:null` — a **slate**: a shot whose still isn't
  generated yet. An ordinary item that renders as a labelled placeholder.
- Stills and videos are peers on one picture lane on purpose: a still is a
  placeholder for that shot's video, so the upgrade must not cross tracks.

Two unrelated things are called "still": **storyboard stills**
(`db.stills[bundle][shot]`, `/storyboard-media/`, per shot, has takes — this is
the animatic's picture) and **grabbed stills** (the `stills` doc,
`/stills/`, frames captured from the preview). Don't mix them up.

**Shot ids are a public key space.** `shot.id` keys `db.stills`; rewriting it
orphans generated media. `POST /api/shotlist` preserves stored ids and warns
when it has to invent one — never "fix" that by renumbering.

## Generative chat UI (`render_ui`)

The agent asks the author things by calling **`render_ui`**, whose input is an
**OpenUI Lang** program rendered client-side through one shared component
contract. Tapping a component posts its `send` string as the next user message —
flue can't suspend a turn, so that transcript round-trip *is* the answer channel
(`deriveQA` decides which card is still live). `ask_question` is gone; its parts
still render in old transcripts.

**`src/genui/contract.ts` is canonical** — component names, zod schemas, prop
types, descriptions. Two renderer sets implement it: `src/genui/renderers.jsx`
(shadcn) and `mobile-app/src/genui/renderers.tsx` (React Native, Galeria
previews, `SemiPillButton` CTA). Same names, same props, different pixels.

A client-side companion renders through the same `<StudioUI>`, so it is
indistinguishable from a card the agent drew:

- **`detect-options.ts`** rescues a trailing `A)`/`1.` choice list the model
  wrote as prose into a real `OptionList`. Heuristics are deliberately strict
  (trailing position, sequential markers, 2–6 short items, a cue word or `?`
  above, newest settled turn only, no card already drawn) — a false positive
  turns a recap into buttons that post nonsense.

There was a second one — "where to go next" follow-up chips under a finished
turn (`next-questions.ts` + `POST /api/next-questions`, a small Workers AI model
grounded on `buildStatus`). **Removed**, and don't rebuild it: the pattern comes
from AI search engines, where every answer is a dead end. Here a turn usually
ISN'T the end of anything — the agent is mid-pipeline and the author already
knows the next move — so the chips offered detours from work in progress, and a
turn that ended with a render still running got them at the worst moment.
`buildSuggestions` survives on its own for the Home landing deck, where a cold
start really does need somewhere to go.

**After ANY contract edit, run `npm run genui:sync`** — it vendors the contract
into `mobile-app/src/genui/`, regenerates the agent's `generative-ui` SKILL.md
from `SKILL.template.md`, and re-emits `flue-agent/src/lib/genui-schema.json`
(which `render_ui` parses against, so a malformed program comes back to the
model as a correctable error instead of a broken card). Skip the sync and the
agent gets prompted with components the renderers don't have — the same silent
drift the `render-fn` sync rule exists to prevent. Edit
`src/genui/contract.ts` and `SKILL.template.md`, never the generated copies.

## UI stack

The front-end is built on **Tailwind CSS v4** + **shadcn/ui** (New York style, zinc base,
emerald accent). Key files:

- `src/index.css` — Tailwind entry + the theme tokens (`:root` = light, `.dark` = dark,
  which is the default via `class="dark"` on `<html>`). Colors are OKLCH CSS variables
  mapped through `@theme inline`.
- `src/components/ui/*` — shadcn primitives (`button`, `card`, `dialog`, `tabs`, `badge`,
  `input`, `textarea`, `label`, `checkbox`, `slider`, `tooltip`, `separator`, …). Add more
  with `npx shadcn@latest add <name>`. `Badge` is extended with `success` / `warning` /
  `info` / `muted` variants for status pills.
- `@/` is aliased to `src/` (see `vite.config.js` + `jsconfig.json`), `cn()` lives in
  `src/lib/utils.js`.

**Prefer shadcn components + Tailwind utility classes** over bespoke CSS. Reuse the small
in-file helpers in `App.jsx` (`Empty`, `Eyebrow`, `Chip`, `Panel`, `Spinner`, `ErrorNote`)
for consistency. All modals are shadcn `Dialog` (Esc / overlay-click close for free).

## UI conventions

- **Always use [lucide-react](https://lucide.dev) icons — never emojis or Unicode glyphs**
  (no 🔊 ✕ ✓ ＋ ▾ ★ ↺ ⧉, etc.) in JSX. Import the named icon from `lucide-react` and
  render it as a component, e.g. `import { Volume2 } from "lucide-react"` →
  `<Volume2 size={14} />`. Size icons in px to match the surrounding text, and give
  icon-only buttons an `aria-label`.
- Typographic characters that are punctuation, not icons (e.g. `→`, `·`, `–` inside
  text like "MS-01 → MS-22"), are fine to keep as text.
