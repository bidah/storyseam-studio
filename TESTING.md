# Testing

shot-studio has three independently-deployed code bases in one repo, so the test
setup mirrors that: one Vitest config with three **projects**, plus Playwright for
the SPA and a `vitest-evals` harness for the agent.

```
test/web/      → the Vite + React SPA (src/)            jsdom,  @/ alias
test/worker/   → the Cloudflare Worker API (worker/)    node,   in-memory R2 fake
test/flue/     → the flue chat agent (flue-agent/)      node,   TypeScript
e2e/           → Playwright flow tests (mocked backend, the SPA)
evals/         → vitest-evals against a running agent   (opt-in, needs FLUE_BASE_URL)
```

## Commands

| command                 | what it runs                                            |
| ----------------------- | ------------------------------------------------------- |
| `npm test`              | all three unit/integration projects (web + worker + flue) |
| `npm run test:watch`    | the same, in watch mode                                 |
| `npm run test:coverage` | all projects + a v8 coverage report (`coverage/`)       |
| `npm run test:web`      | only the SPA logic project                              |
| `npm run test:worker`   | only the Worker project                                 |
| `npm run test:flue`     | only the agent project                                  |
| `npm run test:e2e`      | Playwright smoke suite (first run: `npx playwright install chromium`) |
| `npm run test:evals`    | agent behaviour evals — **needs `FLUE_BASE_URL`** (see `evals/README.md`) |

`npm test` is **offline and deterministic** — no network, no live Worker, no model
credits. Everything that would need those (media streaming to R2, the agent's
model turns, prod data) is either faked (the in-memory R2 bucket in
`test/worker/_fakes.js`) or lives in the opt-in E2E / evals suites.

## Coverage

253 tests. Coverage is scoped (in `vitest.config.js`) to the **logic layer** of
all three code bases — the functions where a unit test is meaningful — and gated
by `coverage.thresholds` so a regression fails the run instead of silently
eroding:

```
Statements : ~81%   Branches : ~86%   Functions : ~73%

  flue-agent/src/lib   ~95%     (agent lib bridges)
  flue-agent/src/tools ~85%     (all 54 tool definitions + a run/schema subset)
  worker/src/lib       ~86%
  src/editor           100%
  src/lib              ~82%
```

The giant React route/editor components, the React data hooks, and the route
handlers that need a live Worker/DO are covered by Playwright (`e2e/`) and the
agent evals (`evals/`) instead of unit tests, so they're deliberately outside the
coverage denominator. Two MCP/live-service bridges (the flue Higgsfield MCP
client, the ffmpeg/proxy shims) are also excluded — they're integration surface,
not logic.

## What's covered, by feature

**Editor / animatic timeline** (`src/editor/timeline.js`, `worker/src/lib/fcpxml.js`,
`worker/src/lib/versions.js`)
- the timeline model: frame/second conversion, `isImageItem`/`isSlateItem`, the
  image-kind invariants (`normalizeItemKind`), `timelineDuration`, `emptyTimeline`.
- FCPXML export for DaVinci Resolve: gap-backbone spine, video↔positive /
  audio↔negative lanes, overlap lane-spill, still `hasAudio=0`, volume/fades, XML
  escaping, zip-name collision handling, slate/disabled-clip dropping.
- bounded "sent to editor" version lists: `nextVersion` (highest-ever, not length),
  `appendCapped` pruning.

**Script tab** (`src/lib/scriptDiff.js`, `src/components/notes/schema.js`,
`flue-agent/src/lib/script.ts`, `worker/src/lib/script-store.js`)
- the review diff: line LCS → rows → hunks, per-hunk accept/reject resolution,
  word-level diff, diff stats.
- the screenplay vocabulary + `buildInitialContent` (title/body split, legacy
  title migration).
- agent ↔ ProseMirror conversion (`elementsToDoc` / `docToElements`) round-trips.
- the draft store: `normalizeStore` (v2 / legacy / empty), drafts, proposals,
  `countLines`, pin resolution, R2 read/write.

**Shot list & multishot packing** (`worker/src/lib/pack.js`, `worker/src/lib/shots.js`)
- `normalizeShot` field coercion.
- ≤15s bundle packing: break on beat / location-group / overflow, shared-group
  merging, MS-NN ids, reference resolution + `missing`, the skill prompt.

**Storyboard stills → animatic** (`worker/src/lib/stills.js`)
- `pickTake` (selected vs newest, missing-bytes → slate, legacy shape).
- shot→bundle resolution: manifest-authoritative, first-bundle-wins, packPreview
  fallback, unmatched → null; the full `readStillsContext` join.

**Media & storage** (`worker/src/lib/media.js`, `worker/src/lib/docs.js`)
- `mediaKey`/`proxyKey`/`kindForPrefix`/`filesUrl`/`assetRefUrl` (traversal guards,
  prefix mapping, absolute URL gating).
- `streamKey`: Range → 206, if-none-match → 304, immutable vs `final/*` no-cache.
- the JSON doc store: `normalizeProjectId`, `docKey`, read/write, and `updateDoc`
  optimistic-concurrency (create / mutate / abort).

**Agent — the flue tools & runtime** (`flue-agent/src/lib/*`, `flue-agent/src/tools/*`)
- **the tool registry** (`tools/index.ts`): all 54 tool definitions instantiate;
  every tool has a unique snake_case name, a substantive description, a callable
  `run`, and (if it takes input) a valibot object schema. Read tools are verified
  a read-only subset — no mutating verb leaks into the ingestion set.
- **per-tool behaviour** for a representative set (`get_world`, `get_script`,
  `save_shotlist`, `ask_question`, `toggle_library`, `attach_still`,
  `edit_timeline`, `commit_pacing`, `select_reference`, `pin_draft`): the valibot
  schema accepts valid / rejects invalid input, and `run` dispatches to the right
  endpoint with the right body (incl. defaults, the two-step `pin_draft` resolve,
  and `ask_question`'s non-blocking card).
- **the API client** (`lib/api.ts`): `createApi` header logic (content-type only
  with a body, `x-project-id` only when scoped), GET/POST/req verbs, base-URL env,
  abort-signal forwarding, JSON parse, `{ raw }` fallback, and error throwing.
- **async render/stitch jobs** (`worker/src/lib/jobs.js`): `createJob`/`getJob`,
  `startSandboxJob` (session + detached command + handle recording), and `pollJob`
  across every terminal/transient branch (done, non-zero exit with tail logs,
  sandbox-gone, transient failure, still-running), plus `jobView` serialization.
- **lib bridges**: instance-id codec, model whitelist + DO-backed persistence,
  voice-track detection + attachable-voice flattening, proxy-token HMAC
  verification, the worker Higgsfield-token bridge, and the Daytona sandbox gate.

**Chat / model picker** (`src/lib/chat-store.js`, `src/lib/agentModel.js`,
`src/lib/tabCache.js`, `src/lib/swr.js`)
- per-project chat history: make/list/active/adopt, capping, v1→v2 migration,
  title derivation.
- the model store: get/set/subscribe, localStorage persistence, unknown-id guard.
- the stale-while-revalidate cache + loader helper.

**App shell & flows** (`e2e/`) — Playwright against the Vite dev server. The dev
server proxies `/api` to the deployed prod Worker and every tab is behind a Better
Auth session, so the flow specs install a **network mock** (`e2e/helpers/mock.js`,
`mockBackend(page)`) that serves a signed-in session, one project, quiet SSE
streams, and an empty-but-valid payload per tab loader — deterministic and offline.
Each tab has an empty-state, so minimal fixtures still mount the real route
component, loader, lazy chunk, and error boundary; specs pass `overrides` to seed
populated data.

- `smoke.spec.js` — real boot (no mock): mounts React into `#root`, reaches an
  interactive state, no uncaught errors, dark-theme default.
- `login.spec.js` — the auth gate: unauthenticated → branded homepage + Higgsfield
  sign-in (which kicks off the OAuth call); authenticated → gate drops, shell mounts.
- `shell.spec.js` — header chrome (project name, all ten visible tabs, the two
  hidden sample tabs absent, Refresh, account), the project switcher menu, the
  light/dark theme toggle + persistence, the Higgsfield link + sign-out call, and
  Refresh re-running the active tab's loader.
- `navigation.spec.js` — every tab mounts its landmark with no fatal error;
  click-through updates the URL + active-tab state (header-scoped, since Library
  renders its own in-content tabs); the Editor Remotion chunk loads; index → `/world`
  and unknown → `/script` redirects.
- `content.spec.js` — populated fixtures: the shot list groups shots by beat with
  counts, the library lists folders + the final-selection tally, empty-state prompts.
- `error-handling.spec.js` — a loader 500 renders the RouteError boundary while the
  shell survives, navigating away recovers, and a dead SSE firehose / `/eve` agent
  proxy doesn't break the studio.

First run installs the browser: `npx playwright install chromium`.

**Agent behaviour** (`evals/whistlewood.eval.ts`) — routes prompts to the right
tools (script/shotlist/world reads), stays conversational for a greeting, reports
its model. Opt-in against a live agent.

## Notes & fakes

- `test/worker/_fakes.js` provides an in-memory **R2 bucket** (`get` with Range +
  `json()`, `put` with `onlyIf.etagMatches` for `updateDoc`, `head`, prefix-scan
  `list`), a minimal **D1** stand-in for the `jobs` table, and a fake **Daytona
  sandbox** process handle.
- The web project aliases `@/components/notes` to the pure `schema.js` so a
  headless test of `scriptDiff` doesn't pull in the TipTap SlashCommand UI.
- flue tests run the TypeScript sources directly (Vitest/esbuild) against fakes —
  no build step, no wrangler. `@flue/runtime` isn't a normal install (the flue CLI
  provides it at build time), so `test/flue/_stubs/flue-runtime.ts` stubs the two
  thin `defineTool`/`defineAgentProfile` factories the tools use — letting the
  real valibot schemas and `run` functions be tested directly.
