# Testing

shot-studio has three independently-deployed code bases in one repo, so the test
setup mirrors that: one Vitest config with three **projects**, plus Playwright for
the SPA and a `vitest-evals` harness for the agent.

```
test/web/      → the Vite + React SPA (src/)            jsdom,  @/ alias
test/worker/   → the Cloudflare Worker API (worker/)    node,   in-memory R2 fake
test/flue/     → the flue chat agent (flue-agent/)      node,   TypeScript
e2e/           → Playwright smoke tests (the app shell)
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

209 tests. Coverage is scoped (in `vitest.config.js`) to the **pure logic layer**
of all three code bases — the functions where a unit test is meaningful:

```
Statements : ~73%   Branches : ~85%   Functions : ~79%
```

The giant React route/editor components, the React data hooks, and the route
handlers that need a live Worker/DO are covered by Playwright (`e2e/`) and the
agent evals (`evals/`) instead of unit tests, so they're deliberately outside the
coverage denominator. A handful of external-service bridges (D1 token refresh,
Daytona sandbox, the ffmpeg/proxy shims) are also excluded — they're integration
surface, not logic.

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

**Agent (flue)** (`flue-agent/src/lib/*`)
- instance-id codec, model whitelist + DO-backed persistence, voice-track
  detection + attachable-voice flattening, proxy-token HMAC verification, and the
  worker Higgsfield-token bridge (env resolution, force refresh, failure paths).

**Chat / model picker** (`src/lib/chat-store.js`, `src/lib/agentModel.js`,
`src/lib/tabCache.js`, `src/lib/swr.js`)
- per-project chat history: make/list/active/adopt, capping, v1→v2 migration,
  title derivation.
- the model store: get/set/subscribe, localStorage persistence, unknown-id guard.
- the stale-while-revalidate cache + loader helper.

**App shell** (`e2e/smoke.spec.js`) — boots, mounts React into `#root`, reaches an
interactive state, no uncaught errors, dark-theme default.

**Agent behaviour** (`evals/whistlewood.eval.ts`) — routes prompts to the right
tools (script/shotlist/world reads), stays conversational for a greeting, reports
its model. Opt-in against a live agent.

## Notes & fakes

- `test/worker/_fakes.js` is a small in-memory R2 bucket implementing the slice of
  the binding the storage helpers use — `get` (with Range + `json()`), `put` (with
  `onlyIf.etagMatches` for `updateDoc`), `head`, and a prefix-scan `list`.
- The web project aliases `@/components/notes` to the pure `schema.js` so a
  headless test of `scriptDiff` doesn't pull in the TipTap SlashCommand UI.
- flue tests run the TypeScript sources directly (Vitest/esbuild) against fakes —
  no build step, no wrangler.
