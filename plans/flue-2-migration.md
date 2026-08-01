# Migration: flue `1.0.0-beta.9` → flue `2.0.1`

**Status:** proposed
**Owner:** —
**Scope:** `flue-agent/` (the `shot-studio-flue` Worker) — full rewrite of the agent
definition; `worker/src/index.js` (`/eve` proxy routing); `src/` and `mobile-app/`
(the `@flue/sdk` / `@flue/react` clients); `test/flue/`, `evals/`.
**Not in scope:** the D1 doc stores, R2, auth secrets, the GUI's own routes, the
`render-fn` / genui / schema sync pipelines.

Companion document: the [Flue 2 opportunity report][report] covers what to *build*
once this lands. This file covers only how to get there without breaking anything.

[report]: https://claude.ai/code/artifact/a13d619d-6077-4002-844e-0fb30f80158e

---

## 0. Read this first — the three facts that shape the whole plan

### 0.1 The persisted schema resets. Every existing conversation dies.

Flue 2 uses persisted schema **version 8**; beta.9 wrote **version 5**. Per the
migration guide: *"Pre-1.0 persisted schemas are reset-only — the runtime rejects an
older database before any application code runs."*

Our transcripts live in the `FlueWhistlewoodAgent` Durable Object's SQLite (the
Cloudflare target does not use `db.ts`). So an in-place upgrade of
`shot-studio-flue` **destroys every chat transcript in production**, and no
application code gets a chance to read them first.

The chat *registry* (titles, recency) is unaffected — it lives in D1 behind
`/api/chats` — which makes the failure mode worse, not better: the sidebar would
still list every past chat, and each would open empty.

**This is the blocking decision of the migration.** See [§1](#1-phase-0--decide-the-history-story-blocking).

### 0.2 There is no implicit sandbox anymore — and our default path relies on one

`flue-agent/src/lib/sandbox.ts:4-6` states the current contract plainly:

> "Gated on `DAYTONA_API_KEY`: without it we return `undefined` and **flue falls back
> to its in-memory `just-bash` sandbox**, which is rebuilt EMPTY on every harness
> init."

`DEFAULT_SANDBOX_MODE = "memory"` (`src/lib/sandbox-prefs.ts:33`), so
`whistlewood.ts:180` passes `sandbox: undefined` for **the default path of every
conversation**. In flue 2, an agent with no `useSandbox()` call has *no filesystem
and no `read`/`write`/`edit`/`bash`/`grep`/`glob` tools at all*. Left as-is, the
migration silently removes bash from every chat that hasn't opted into Daytona —
which is most of them, and which is where the ffmpeg/media skills run.

This must be fixed **in** the migration, not after. It is also the natural place to
land the self-upgrading sandbox (see [§10](#10-phase-7--sandbox-explicit-in-memory-default--daytona-escalation)).

### 0.3 Two of our biggest workarounds may be retired for free

- **The hand-rolled Higgsfield MCP client.** `plans/flue-higgsfield-mcp-workers-fix.md`
  documents the root cause: flue beta's MCP path went through
  `@modelcontextprotocol/sdk`, which compiles output schemas with **Ajv →
  `new Function()` → banned on Workers**. Flue 2 depends on
  **`@modelcontextprotocol/client@2.0.0`**, which has **no `ajv` dependency**
  (verified against the npm manifest; the old `@modelcontextprotocol/sdk` lists
  `ajv ^8.17.1`). If `useMcpConnection()` initializes on workerd, all ~330 lines of
  `src/lib/higgsfield.ts` become one hook call. **Verify before assuming** — see
  [§11](#11-phase-8--mcp-try-to-retire-the-hand-rolled-higgsfield-client).
- **The output-cap microtask hack.** `src/lib/output-cap.ts` re-registers a flue
  *internal* API provider through `queueMicrotask` to beat the generated entry's
  module body. Flue 2's `setProvider()` in `app.ts` is documented to win over the
  generated entry, so the ordering hack disappears; only the `withOutputCap`
  wrapper survives, moved onto `createProvider()`'s `api` field.

---

## 1. Phase 0 — decide the history story (BLOCKING)

Three options. **Recommended: C.**

| | Approach | Data loss | Rollback | Effort |
|---|---|---|---|---|
| A | Drain: announce, freeze, upgrade in place | **Total** — all transcripts | Redeploy beta.9, still no data | S |
| B | Export transcripts to D1/R2 first, render archived read-only | None, but one-shot and irreversible | Poor | L |
| C | **Deploy flue 2 as a second Worker; route by chat** | **None** | Instant (flip the route) | M |

### Option C in detail — parallel workers, routed per chat

1. Deploy the migrated agent as a **new Worker**, `shot-studio-flue-v2`, with its own
   DO namespace. `shot-studio-flue` (beta.9) stays deployed, untouched, still holding
   every existing transcript.
2. Add an `engine` column to the chat registry (`worker/src/routes/chats.js`, D1),
   default `"flue1"` for existing rows and `"flue2"` for newly created chats.
3. The `/eve` proxy (`worker/src/index.js:580-632`) already parses
   `/agents/:name/:id`. Extend it to look the chat up and pick the origin:

   ```js
   // worker/src/index.js — inside app.all("/eve/*")
   const engine = await chatEngine(c, chatIdFrom(path));   // "flue1" | "flue2"
   const origin =
     engine === "flue2"
       ? (c.env.FLUE_V2_ORIGIN || DEFAULT_FLUE_V2_ORIGIN)
       : (c.env.FLUE_ORIGIN || DEFAULT_FLUE_ORIGIN);
   ```
   Add a second service binding (`FLUE_V2 → shot-studio-flue-v2`) alongside the
   existing `FLUE` binding in `worker/wrangler.jsonc:47-49`.
4. Old chats keep working on the old engine. New chats get flue 2. Nothing is
   exported, nothing is lost, and rollback is one `engine` default flip.
5. Retire `shot-studio-flue` when old chats stop being opened (add a "this chat runs
   on the previous engine" badge, and let the author start a fresh one).

**Cost of C:** both Workers stay deployed for a while, and any subsequent
agent-side feature must be applied to whichever engine you care about (in practice:
only v2 — v1 is frozen). The two workers share the same `FLUE_PROXY_SECRET` and the
same `SHOT_STUDIO_API`, so no new credential plumbing.

> Everything from §2 onward assumes the migrated code ships as `shot-studio-flue-v2`.
> If you choose A instead, the only differences are: keep the Worker name, and add
> a `deleted_classes` migration for `FlueRegistry` (removed in flue 2).

---

## 2. Blast radius — what actually has to change

Counts are from a full audit of `flue-agent/src` at commit `0c03249`.

| Area | Sites | Nature |
|---|---|---|
| `run()` returns → `{ output }` envelope | **77** run bodies (64 tool modules + 5 provider libs) | mechanical, codemod-able |
| `run({ input })` → `run({ data })` | **58** destructures | mechanical |
| `run({ signal })` | 68 bodies | unchanged, verify only |
| Import attributes dropped (`with { type: … }`) | 18 skill + 10 markdown + 1 json = **29** | mechanical + `src/env.d.ts` split |
| `defineAgentProfile` → `useSubagent` | **9** profiles + the `createSubagents()` factory | real rewrite |
| `defineAgent` → agent function + hooks | 1 file (`agents/whistlewood.ts`, 210 lines) | real rewrite |
| `registerProvider` → `setProvider` | 2 call sites (`app.ts:151`, `:167`) | rewrite against pi-ai |
| `registerApiProvider` → provider `api` field | `lib/output-cap.ts` (whole file) | rewrite, simplifies |
| Routing: `flue()` → `createAgentRouter` | `app.ts:291` + middleware paths | small |
| Sandbox: implicit → explicit | `whistlewood.ts:180,203`, `lib/sandbox.ts:165`, `sandboxes/daytona.ts:117` | design change (§0.2) |
| MCP: hand-rolled → `useMcpConnection` | `lib/higgsfield.ts` (~330 lines) | delete-if-verified |
| Build: `flue build` → `vite build` | `package.json`, new `vite.config.ts`, `flue.config.ts` | small |
| Clients | `src/main.jsx:25,33`, `src/components/AgentProvider.jsx:51,310-352`; `mobile-app/src/lib/agent/provider.tsx:65,70,437,541,553,627` | small — see §14 |
| Tests | `test/flue/_stubs/flue-runtime.ts`, tool behavior tests, `evals/` | small |

**Not affected:** `harness` / `session()` — grep finds zero live usages (only a dead
JSDoc block at `sandboxes/daytona.ts:17-18` and ~8 prose comments). No workflows, no
channels (`.flue-vite/_entry.ts` generates empty `workflowModules` /
`channelModules`). No `dispatchId` / `runId` / `/workflows` on any client.

---

## 3. Phase 1 — toolchain: deps, Vite, config, scripts

### 3.1 Dependencies (`flue-agent/package.json`)

```jsonc
{
  "dependencies": {
    "@daytona/sdk": "^0.200.0",
    "@earendil-works/pi-ai": "^0.83.0",   // NEW — providers moved to Pi
    "@flue/runtime": "^2.0.1",            // was ^1.0.0-beta.9
    "@openuidev/lang-core": "^0.2.10",
    "agents": "^0.17.4",
    "hono": "^4.8.3",                     // flue 2 wants ^4.8.3
    "just-bash": "^3.2.0",                // NEW — the in-memory sandbox (§0.2)
    "valibot": "^1.1.0",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@cloudflare/vite-plugin": "^1",      // NEW
    "@cloudflare/workers-types": "^5.20260714.1",
    "@flue/cli": "^2.0.1",
    "typescript": "^5.6.0",
    "vite": "^8.0.0",                     // NEW — @flue/vite peer-requires ^8
    "@flue/vite": "^2.0.1",               // NEW
    "wrangler": "^4.0.0"
  },
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "deploy": "vite build && wrangler deploy",
    "typecheck": "tsc --noEmit"
  }
}
```

> `flue-agent` has its own `node_modules`, so Vite 8 here does **not** collide with
> the SPA's Vite 5 at the repo root. Do not bump the root.

Root `package.json` scripts (`flue:dev` / `flue:build` / `flue:deploy`) delegate via
`npm --prefix flue-agent`, so they need no change — but `npm run stack` now starts
Vite on **5173** instead of flue dev's 3583. Check nothing hardcodes 3583.

### 3.2 New `flue-agent/vite.config.ts`

```ts
import { cloudflare } from '@cloudflare/vite-plugin';
import { flue } from '@flue/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  // flue() MUST come before cloudflare().
  // `providers` is an exhaustive allowlist — narrowing the build to what
  // ALLOWED_MODELS actually references (src/lib/models.ts).
  plugins: [flue({ providers: ['cloudflare', 'cerebras', 'anthropic'] }), cloudflare()],
});
```

### 3.3 `flue-agent/flue.config.ts`

```ts
import { defineConfig } from '@flue/runtime/config';   // was '@flue/cli/config'

export default defineConfig({ target: 'cloudflare' });
```

Remove any `root` / `output` fields (Vite owns both). Ours has neither.

### 3.4 `.gitignore`

Already lists `.flue-vite/` and `.flue-vite.wrangler.jsonc` — good. `.flue/` can go
once `.flue/cloudflare.ts` moves to `src/cloudflare.ts` (we have no `.flue/` dir
today, so nothing to move).

**Verify:** `npm --prefix flue-agent run build` produces `dist/` and a merged
`.flue-vite.wrangler.jsonc`. Do not deploy yet.

---

## 4. Phase 2 — providers

### 4.1 Replace the two `registerProvider` gateway overrides (`src/app.ts:151-172`)

```ts
import { setProvider } from '@flue/runtime';
import { createProvider } from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';

// Same intent as before: keep clean `anthropic/claude-*` specifiers everywhere
// while routing through Cloudflare AI Gateway when configured.
if (process.env.ANTHROPIC_GATEWAY_URL) {
  setProvider(
    createProvider({
      id: 'anthropic',
      auth: {
        apiKey: {
          name: 'CF AI Gateway',
          resolve: async () => ({ auth: { apiKey: process.env.ANTHROPIC_API_KEY } }),
        },
      },
      models: anthropicProvider()
        .getModels()
        .map((m) => ({ ...m, baseUrl: process.env.ANTHROPIC_GATEWAY_URL! })),
      api: anthropicMessagesApi(),
    }),
  );
}
```

Repeat for `cerebras` (openai-completions wire — use
`@earendil-works/pi-ai/api/openai-completions.lazy` and the `cerebras` catalog
provider). Both stay env-guarded exactly as today.

### 4.2 Rewrite `src/lib/output-cap.ts` against `cloudflareBindingProvider`

The reason the file exists is unchanged (flue never sets `options.maxTokens`, and
Workers AI's default completion cap silently truncates long subagent answers with
`finish_reason: "length"`). Keep `withOutputCap`, `DEFAULT_MAX_COMPLETION_TOKENS =
16384` and `MAX_COMPLETION_TOKENS_CEILING = 65536` verbatim — those constants encode
two production incidents and their reasoning comments must survive.

What changes: the plumbing, and the ordering hack goes away.

```ts
// src/lib/output-cap.ts (new tail)
import { setProvider } from '@flue/runtime';
import { cloudflareBindingProvider } from '@flue/runtime/cloudflare/workers-ai';
import { env } from 'cloudflare:workers';

export function installWorkersAiOutputCap(): void {
  const base = cloudflareBindingProvider({ binding: env.AI });
  setProvider({
    ...base,
    api: {
      ...base.api,
      stream: withOutputCap(base.api.stream),
      streamSimple: withOutputCap(base.api.streamSimple),
    },
  });
}
```

Then in `app.ts`, replace `queueMicrotask(installWorkersAiOutputCap)` (`app.ts:18`)
with a plain top-level `installWorkersAiOutputCap()` — the docs state *"app.ts
registration still wins"* over the generated entry's auto-registration, so no
microtask is needed.

**Open question (verify against the built runtime):** the exact shape
`cloudflareBindingProvider()` returns, and whether `api.stream` / `api.streamSimple`
are the right seam. If the shape differs, fall back to the documented
`createProvider({ ..., api: { stream, streamSimple } })` form. Delete the whole
`queueMicrotask` comment block (`output-cap.ts:16-24`) once the new ordering is
confirmed — it documents a constraint that no longer exists.

**Verify:** `tsc --noEmit` clean; one Workers AI turn returns a >16k-token answer
without `finish_reason: "length"`.

---

## 5. Phase 3 — the agent: `defineAgent` → agent function + hooks

This is the centerpiece. `src/agents/whistlewood.ts` becomes:

```ts
'use agent';
import {
  useModel, useTool, useSkill, useSubagent, useSandbox,
  useMcpConnection, usePersistentState, type AgentProps,
} from '@flue/runtime';
import { extend, getCloudflareContext, type CloudflareAgentLike } from '@flue/runtime/cloudflare';
import instructions from './whistlewood.md';        // plain string, no import attribute
// …

export function Whistlewood({ id }: AgentProps) {
  const decoded = decodeInstanceId(id);
  const projectId = decoded?.projectId ?? null;
  const userId = decoded?.userId ?? '';
  const api = createApi(projectId, userId, decoded?.chatId ?? null);

  useModel(selectedModel());

  for (const tool of createTools(api)) useTool(tool);
  for (const skill of skills) useSkill(skill);
  for (const sub of createSubagents(api, searchTools)) useSubagent(sub);

  return providerNote ? `${instructions}${providerNote}` : instructions;
}
Whistlewood.agentName = 'whistlewood';    // pin the storage identity
```

### 5.1 The hard constraint: **the agent function must be synchronous**

The current initializer is `async` and awaits two things
(`whistlewood.ts:163,173,186`). Both have clean flue 2 homes:

| Today (awaited in the initializer) | Flue 2 home |
|---|---|
| `await createHiggsfieldTools(userId)` — fetches the MCP tool list | `useMcpConnection({ name: 'higgsfield', url, auth: async () => …, optional: true })` — the runtime connects during submission init, off the render path (§11) |
| `await createSandbox(id)` — creates/resumes the Daytona container | moves **inside** the factory's `async createSessionEnv(options)`, where `options.id` is the conversation id (§10) |

Everything else the initializer does is already synchronous (`readSelectedModel`,
`readFalKey`, `readAtlasKey`, `readRenderPrefs`, `readSearchPrefs`,
`readSandboxMode` — all `getCloudflareContext().storage.sql` reads).

### 5.2 Keep `agentName = 'whistlewood'`

The generated class is derived from the function name. `Whistlewood` →
`FlueWhistlewoodAgent` / `FLUE_WHISTLEWOOD_AGENT`, matching what `app.ts`'s
`AGENT_BINDINGS` and `wrangler.jsonc` already declare. Pin it with the
`agentName` static anyway so a later rename can't silently orphan storage.

### 5.3 `extend()` survives — keep the settings RPCs for now

The Cloudflare target guide documents `export const cloudflare = extend({ base })`
in flue 2 with the same signature. Keep `setModel` / `setFalKey` / `setAtlasKey` /
`setRenderPrefs` / `setSearchPrefs` / `setSandboxMode` **unchanged** for this
migration — they are the per-turn settings channel and rewriting them to
`usePersistentState` at the same time as everything else is how migrations fail.

> Follow-up (post-migration): these six RPCs plus the six `x-flue-*` headers are
> exactly what `usePersistentState` + `initialData` exist for. Do it as its own PR,
> after v2 is stable. See the [report][report], "What migration retires".

**Verify:** `tsc --noEmit`; `vite build` emits `FlueWhistlewoodAgent` in the
generated entry.

---

## 6. Phase 4 — subagents: 9 profiles → 9 agent functions

`defineAgentProfile({ name, description, instructions, tools?, subagents? })` is
gone. Flue 2's `useSubagent({ name, description, agent, model?, thinkingLevel? })`
takes an **agent function**, and the instructions become that function's return
value. Nested subagents become nested `useSubagent` calls inside the parent's
function.

```ts
// src/subagents.ts — the arc experts (no tools, per today's design)
import { defineSubagent } from '@flue/runtime';
import herosJourney from './subagents/heros-journey.md';   // plain string now

export const herosJourneySub = defineSubagent({
  name: 'heros_journey',
  description: "Hero's Journey (Campbell / Vogler, 12 stages) structure expert. …",
  agent: () => herosJourney,     // no useModel — subagent renders inherit the parent's
});

// …and the one nesting site
export function createSubagents(api: Api, searchTools: ToolDefinition[] = []) {
  const readTools = [...createReadTools(api), ...searchTools];
  const doctorTools = [...readTools, recordScriptReview(api)];

  const storyArchitect = defineSubagent({
    name: 'story_architect',
    description: 'Story architect for building a new story or restructuring …',
    agent: () => {
      for (const t of doctorTools) useTool(t);
      for (const s of [herosJourneySub, storyCircleSub, threeActSub, saveTheCatSub, kishotenketsuSub]) {
        useSubagent(s);
      }
      return storyArchitectInstructions;
    },
  });

  return [dialogueDoctor, motivationDoctor, plotDoctor, storyArchitect];
}
```

Rules that bite here, from the hooks reference:

- **`useModel` throws in a subagent render.** Delegates take the model from their
  `SubagentDefinition` (or inherit the parent's). Our 9 profiles deliberately omit
  `model` today — keep omitting it, and the inheritance is identical.
- **`usePersistentState`, `useDataWriter`, `useDispatchMessage`, `useSandbox`,
  `useMcpConnection` all throw in subagent renders.** None of our profiles use them.
- Subagents are isolated: **only final text returns**. That matches the existing
  advisor contract (`record_script_review` is the doctor's own log book).
- `render_ui` must stay off every subagent's tool list — it is not in
  `createReadTools`, and `whistlewood.md` already states "a subagent can't pause".

The `createSubagents(api, searchTools)` factory shape survives; only its return
type changes from `AgentProfile[]` to `SubagentDefinition[]`.

**Verify:** delegate to `story_architect` in a live chat and confirm all 5 arc
experts appear in its "Available Agents" roster.

---

## 7. Phase 5 — tools: the envelope and the `data` rename

Two mechanical changes across **77** `run()` bodies. Do them as one commit with a
codemod, not by hand.

### 7.1 `run({ input })` → `run({ data })` — 58 sites

Every tool uses the shorthand `async run({ … })` form, so a scoped rename is safe:

```bash
cd flue-agent/src
# tools + the five provider libs
rg -l 'async run\(\{[^}]*\binput\b' tools lib \
  | xargs sed -i '' -E 's/async run\(\{([^}]*)\binput\b/async run({\1data/'
# then fix the body references
rg -n '\binput\b' tools lib   # review each remaining hit by hand
```

Also update the two comments that hardcode the old shape: `src/lib/api.ts:5` and
`src/agents/whistlewood.ts:157` ("a flue tool's `run({ input, signal })` gets no
ambient context" → `run({ data, signal })`).

`signal` is unchanged (68 sites). `log` and `toolCallId` are now always present —
useful later, no action now.

### 7.2 Wrap every return in `{ output }` — 77 sites

**All 77 run bodies currently return a bare object, which throws in flue 2.**
Three shapes:

```ts
// 53 pass-throughs
- return await api.get("/api/status", signal);
+ return { output: await api.get("/api/status", signal) };

// 11 object literals + 4 approval envelopes
- return { ok: true, lines };
+ return { output: { ok: true, lines } };
- return await gateAction(...);
+ return { output: await gateAction(...) };

// the provider libs (fal 4, atlas 3, exa 2, firecrawl 2)
- return submit(...);
+ return { output: await submit(...) };
```

### 7.3 The two latent hazards — do not skip these

1. **`src/lib/higgsfield.ts:257` is the riskiest site in the repo.** It is one code
   path that produces *N* runtime tools (one per discovered MCP tool), and
   `callTool` can return an object, a **bare string**, a **bare array**, or
   `undefined` depending on the MCP response:
   ```ts
   const text = (r.content || []).find((p) => p.type === 'text')?.text;
   try { return JSON.parse(text); } catch { return text; }     // higgsfield.ts:160-166
   ```
   Under flue 2 a bare array or `undefined` throws. If §11 succeeds this file is
   deleted and the problem evaporates. If it does not, wrap defensively:
   ```ts
   const result = withPendingJobNote(await callTool(...));
   return { output: typeof result === 'undefined' ? null : result };
   ```
2. **The 53 `api.*` pass-throughs are typed `Json`** (`src/lib/api.ts:22-29`), which
   includes `string | number | boolean | null | Json[]`. Nothing guarantees an
   object — any Shot Studio endpoint returning a **top-level array** would have
   thrown. Wrapping in `{ output: … }` fixes this class outright, which is a real
   robustness win, not just compliance.

### 7.4 Two tools take their contract from `shared/schemas/`

`save_shotlist` (← `src/schemas/shotlist.json`) and `edit_timeline` (←
`src/schemas/timeline.json`) build their valibot input via
`src/lib/schema-to-valibot.ts`. Nothing about that changes — but re-run
`npm run schemas:sync` and `npm run guards` after the migration so the vendored
copies are confirmed in sync.

**Verify:** `npm run test:flue` after updating the stub (§15) — the tool behavior
tests are the cheapest proof that 77 returns were wrapped correctly.

---

## 8. Phase 6 — skills and markdown imports

Import attributes are removed. 29 sites.

```ts
// src/skills.ts — 18 imports
- import worldCreation from "./skills/world-creation/SKILL.md" with { type: "skill" };
+ import worldCreation from "./skills/world-creation/SKILL.md";
//   SKILL.md auto-packages its whole directory → SkillReference. No other change.

// src/subagents.ts — 9 imports, and agents/whistlewood.ts — 1
- import herosJourney from "./subagents/heros-journey.md" with { type: "markdown" };
+ import herosJourney from "./subagents/heros-journey.md";
//   a non-SKILL.md .md import is a plain string, inlined at build time.

// src/tools/render_ui.ts:5 — verify whether the json attribute is still needed
  import schema from "../lib/genui-schema.json" with { type: "json" };
```

**`src/env.d.ts:1-7` must be split.** It currently declares *every* `*.md` as
`string`, which would mistype the 18 auto-packaged `SKILL.md` imports:

```ts
declare module '*/SKILL.md' {
  const skill: import('@flue/runtime').SkillReference;
  export default skill;
}
declare module '*.md' {
  const content: string;
  export default content;
}
```

`npm run genui:sync` regenerates `flue-agent/src/skills/generative-ui/SKILL.md` from
`SKILL.template.md` — re-run it after the migration and confirm the generated file
still imports cleanly.

---

## 9. Phase 7 — routing and `app.ts`

The `flue()` auto-router is gone. `app.ts:291` becomes an explicit mount, and the
middleware paths lose the `:name` param.

```ts
import { createAgentRouter } from '@flue/runtime/routing';
import { Whistlewood } from './agents/whistlewood.js';

const app = new Hono();

app.get('/health', /* unchanged */);

// Auth boundary — unchanged logic, concrete path. `c.req.param("name")` is gone;
// applyModelSelection hardcodes the one binding it ever used.
app.use('/agents/whistlewood/:id', requireProxyUser);
app.use('/agents/whistlewood/:id/*', requireProxyUser);
app.use('/agents/whistlewood/:id', applyModelSelection);

app.route('/agents/whistlewood', createAgentRouter(Whistlewood));

export default app;
```

`createAgentRouter` serves `POST /:id`, `GET|HEAD /:id`, `POST /:id/abort`,
`GET /:id/attachments/:attachmentId` — the same four surfaces the clients use today,
at the same paths. **The `/eve` proxy's rewrite regex
(`worker/src/index.js:592-596`) needs no change**, and `src/lib/routeTable.js:49`
(`{ prefix: "/eve", kind: "sse" }`) stays as-is.

Delete `export const route` and `export const description` from
`agents/whistlewood.ts` — both conventions are removed in flue 2.

### 9.1 `applyModelSelection` needs one verification

It reaches the DO directly: `ns.get(ns.idFromName(id))` (`app.ts:232`). Confirm flue
2 still keys the agent DO by `idFromName(instanceId)`. If the keying changed, the
settings RPCs silently write to the wrong object — a *silent* failure, so test it
explicitly: set a non-default model in the picker and assert the turn actually runs
on it (Workers Logs will name the model).

### 9.2 Message body

Flue 2 accepts `{ message: { kind: 'user', body }, initialData?, uid? }`. The SDK
builds this — no server-side work — but any curl/eval that posts by hand must move
off the old `{ message: "…" }` shape.

---

## 10. Phase 8 — sandbox: explicit in-memory default + Daytona escalation

This closes §0.2 and lands the capability the author asked for.

### 10.1 Make the default path explicit

```ts
// src/agents/whistlewood.ts
import { bash } from '@flue/runtime';            // verify the exact export path
import { Bash, InMemoryFs } from 'just-bash';

const [tier, setTier] = usePersistentState<'memory' | 'daytona'>(
  'sandboxTier',
  storedSandboxMode(),          // seed from the existing Settings toggle
);

useSandbox(tier === 'daytona' ? daytonaFactory(id) : bash(() => new Bash({ fs: new InMemoryFs() })));
```

Two notes carried over from the current code and still binding:

- **No `cwd` override.** `whistlewood.ts:198-202` documents why: `/workspace`
  silently broke every bash call on Daytona because the non-root `daytona` user can
  only write `/home/daytona`. Pass `useSandbox(factory)` with **no options** for the
  Daytona tier; the in-memory tier can take a `cwd` freely.
- **Daytona failures must degrade, not fail the turn** (`lib/sandbox.ts:188-192`).
  Keep that catch; it now returns the in-memory factory instead of `undefined`.

### 10.2 Move the async work inside the factory

`createSessionEnv` now receives `options.id` — the conversation id — which is
exactly what `createSandbox(id)` needed. `sandboxes/daytona.ts:117-125` becomes:

```ts
export function daytonaFactory(): SandboxFactory {
  return {
    async createSessionEnv(options) {
      const sandbox = await ensureSandboxFor(options.id);   // was createSandbox(id)
      const cwd = (await sandbox.getWorkDir()) ?? '/home/daytona';
      return createSandboxSessionEnv(new DaytonaSandboxApi(sandbox), cwd);
    },
  };
}
```

Everything valuable in `lib/sandbox.ts` survives unchanged and just moves behind
this call: the DO-storage-persisted sandbox id (not a module Map — that was the
"sandbox keeps resetting" bug), the cross-isolate CAS that converges a conversation
on exactly one sandbox, the `inFlight` dedupe, `useDeprecatedPolling: true`, and the
`autoStopInterval` / `autoDeleteInterval` settings. Delete the dead `defineWorkflow`
JSDoc example at `sandboxes/daytona.ts:17-18`.

### 10.3 The escalation tool (the point of all this)

```ts
useTool({
  name: 'upgrade_sandbox',
  description:
    'Escalate this conversation to a persistent Daytona sandbox. Call this when ' +
    'local exec has failed for want of resources — an ffmpeg mix that ran out of ' +
    'memory, a missing binary, a download too large for the in-memory filesystem, ' +
    'or a file that must survive to a later turn. Do not call it for ordinary ' +
    'command errors. The environment swaps at the next turn and files staged in ' +
    'the old one are gone.',
  run: () => {
    setTier('daytona');
    return { output: 'Upgraded to a persistent sandbox. It takes effect on the next turn; re-stage any files you need.' };
  },
});
```

Three details that make this correct rather than merely clever:

- `useSandbox` **presence and factory identity are re-read at every turn boundary**,
  and a flip emits an `environment` signal that tells the model its old files may be
  unreachable and re-states the tool roster. The model is told, not surprised.
- `usePersistentState` writes commit atomically with the tool batch, so a crash
  between the upgrade and the next turn cannot leave the tier half-set.
- The write is durable and per-instance, so a conversation never regresses — but it
  is also never global: a different chat starts back on the free tier.

**Gate it honestly.** `DAYTONA_API_KEY` is optional and Daytona is a paid, shared
account (see the `agent-sandbox-model` note). Mount `upgrade_sandbox` only when the
key is present, and keep the Settings › Sandbox toggle as the manual override —
this adds an escalation path, it does not replace the switch.

---

## 11. Phase 9 — MCP: try to retire the hand-rolled Higgsfield client

**Verify first, in this order. Do not delete anything until step 2 passes.**

1. Confirm `@flue/runtime@2.0.1` pulls `@modelcontextprotocol/client@2.0.0` and that
   nothing in its graph reaches `ajv` (`npm ls ajv` inside `flue-agent`).
2. Stand up a throwaway agent with only `useMcpConnection({ name: 'higgsfield', … })`
   and run it on **`wrangler dev`, not `vite dev`** — the docs warn that Workers
   restrictions surface only under workerd. Confirm `tools/list` completes and one
   `mcp__higgsfield__*` call round-trips.
3. Only then replace the ~330-line client:

```ts
useMcpConnection({
  name: 'higgsfield',
  url: process.env.HIGGSFIELD_MCP_URL!,
  // Resolved fresh per request, and re-resolved once on a 401 — which is
  // exactly the bridged per-user token's lifecycle (lib/worker-token.ts).
  auth: async () => (await higgsfieldToken(userId)) ?? '',
  // Today a missing token yields [] and the generation tools are simply absent.
  // `optional` preserves that: a failed connect mounts zero tools and announces
  // the gap to the model, instead of failing the submission.
  optional: true,
});
```

Tool names stay `mcp__higgsfield__<tool>`, so every skill that references them
(`generate-storyboard`, `generate-multishot`, `seed-audio`, `radio`, …) is untouched.

**If step 2 fails:** keep `lib/higgsfield.ts`, apply §7.3's defensive wrap, and note
in `plans/flue-higgsfield-mcp-workers-fix.md` that flue 2 did not resolve it. Do not
let this block the migration — it is a bonus, not a dependency.

Also update `vitest.config.js`'s coverage `exclude` list, which names
`flue-agent/src/lib/higgsfield.ts`, if the file goes away.

---

## 12. Phase 10 — observability

`observe()` survives; the event vocabulary changes. `src/app.ts:41-97`:

| Today | Flue 2 |
|---|---|
| `case "run_end"` | `case "agent_end"` |
| (`run_start`) | `agent_start` |
| `event.runId` | `event.instanceId` + `event.submissionId` |
| `submission_settled`, `operation`, `compaction`, `log` | unchanged |

Keep the subscriber synchronous and I/O-free — the constraint documented at
`app.ts:27-29` still holds.

**Additive win:** flue 2 offers `createCloudflareTracing()` for zero-config Workers
Traces with conversation content, metadata, and **token cost**. Add it in a
follow-up, not in the migration commit.

---

## 13. Phase 11 — Cloudflare deploy config

`flue-agent/wrangler.jsonc`:

```jsonc
{
  "name": "shot-studio-flue-v2",              // new worker, per §1 option C
  "compatibility_date": "2026-07-21",         // ≥ 2026-04-01, validated at build — ours passes
  "compatibility_flags": ["nodejs_compat"],
  "migrations": [
    // Fresh worker = fresh history. FlueRegistry is GONE in flue 2 — do not declare it.
    { "tag": "v1", "new_sqlite_classes": ["FlueWhistlewoodAgent"] }
  ],
  "ai": { "binding": "AI" },
  "observability": { "enabled": true },
  "vars": { "SHOT_STUDIO_API": "…", "HIGGSFIELD_MCP_URL": "…" }
}
```

- **Do not hand-author `FLUE_*` bindings** — flue generates them and merges into the
  gitignored `.flue-vite.wrangler.jsonc`. Our authored file already only declares
  migrations, so this is already right.
- **No `run_worker_first` on this Worker** — it serves no static assets. The
  *main* worker's `run_worker_first` already includes `/eve/*`
  (`worker/wrangler.jsonc:65`) and needs no change.
- Deploy with `wrangler deploy` **from the project root, no `--config` flag** —
  `vite build` writes the finalized config into `dist/` with a deploy redirect.
- Secrets to set on the new Worker: `FLUE_PROXY_SECRET` (must match the main
  worker), `CEREBRAS_API_KEY`, optional `ANTHROPIC_API_KEY`,
  `*_GATEWAY_URL`, `DAYTONA_API_KEY`, `FAL_KEY`, `ATLAS_KEY`, `EXA_API_KEY`,
  `FIRECRAWL_API_KEY`.

If you chose §1 option A (in-place) instead, append rather than rewrite:

```jsonc
{ "tag": "v2", "deleted_classes": ["FlueRegistry"] }
```

---

## 14. Phase 12 — clients (web + mobile)

Good news: `useFlueAgent`'s **result shape is unchanged** — `messages`, `status`,
`historyReady`, `error`, `refresh()`, and `sendMessage(message, { images })` all keep
their current signatures (verified against `@flue/react@2.0.1` typings). So nothing
that decodes message parts changes: `src/components/AgentChat.jsx:537-608`,
`mobile-app/src/components/chat/message.tsx:428-511`, both `genui/StudioUI`,
`chat-store`, `helpers.ts`, `transcript-cache.ts` — all untouched.

What changes is only how the hook is addressed. `FlueProvider` and the
deployment-wide client are **removed**; clients are conversation-scoped.

### 14.1 Web

```jsx
// src/main.jsx — DELETE lines 25 and 33
- const flueClient = createFlueClient({ baseUrl: "/eve" });
- <FlueProvider client={flueClient}> … </FlueProvider>

// src/components/AgentProvider.jsx:310-312
  const id = `${projectId ?? ""}~${activeId}`;
+ const url = `/eve/agents/${AGENT_NAME}/${id}`;
+ // Memoize: a new client instance replaces the session.
+ const client = useMemo(() => createFlueClient({ url }), [url]);
- const flueAgent = useFlueAgent({ name: AGENT_NAME, id });
+ const flueAgent = useFlueAgent({ client });

// :350-352 — abort moves onto the conversation client
- stop: () => { client.agents.abort(AGENT_NAME, idRef.current).catch(() => {}); },
+ stop: () => { client.abort().catch(() => {}); },
```

`send({ message, images })` at `AgentProvider.jsx:342-343` is unchanged — it already
calls `sendMessage(message, { images })`, which is still the v2 signature. The two
image-construction sites (`AgentChat.jsx:1706-1717`, `:1791-1798`) build
`{ type: 'image', data, mimeType }`, which is exactly `DeliveredAttachment` in v2.
The ~20 text-only `agent.send({ message })` call sites across routes are untouched.

### 14.2 Mobile

Identical shape, at `mobile-app/src/lib/agent/provider.tsx:65,70,437,438,541,553,627`.
`API_ORIGIN` prefixes the URL there: `` `${API_ORIGIN}/eve/agents/whistlewood/${id}` ``.

The header side-channels keep working untouched — `src/lib/projectFetch.js:51-113`
and `mobile-app/src/lib/fetch-shim.ts:34-85` patch `fetch` itself, and
`createFlueClient` accepts an explicit `fetch` / `headers` if that ever needs to be
made non-ambient.

### 14.3 Root `package.json` (both apps)

Bump `@flue/react` and `@flue/sdk` from `^1.0.0-beta.9` to `^2.0.1` in **both**
`package.json` and `mobile-app/package.json`. Peer requirement is `react >= 18` —
root is React 18.3, mobile is 19.2, both fine.

### 14.4 Two additive things worth taking immediately

`useFlueAgent` now also returns **`failedSends`** (optimistic messages whose send
failed, retained for a retry affordance) and **`settlements`** (terminal outcomes per
`submissionId`). Mobile's remount-to-resync watchdog
(`provider.tsx:357-421`) exists precisely because a failed/aborted turn used to be
invisible — `settlements` may let that heuristic be replaced with a fact. Evaluate
after the migration lands; do not bundle it in.

### 14.5 Desktop

No work. The Electron shell hosts the same Vite build, and `/eve` is already in
`src/lib/routeTable.js:49`. Run `npm --prefix desktop run sync` as usual so the
vendored copy stays identical (the parity test in `test/web/routeTable.test.js`
enforces it).

---

## 15. Phase 13 — tests, evals, guards

- **`test/flue/_stubs/flue-runtime.ts`** — replace `defineAgentProfile` with
  `defineSubagent`, drop `registerProvider`, add `setProvider` / `useTool` / `useSkill`
  / `useSubagent` no-ops if any test imports them. Keep `defineTool` as the identity
  factory; the stub's rationale (we test *our* definitions, not flue's registration)
  is still correct.
- **Tool behavior tests** (`test/flue/tools-behavior.test.ts`,
  `tools-registry.test.ts`, `script.test.ts`, `voices.test.ts`) invoke `run()` and
  assert on the returned value. They must now unwrap `.output`. Add a tiny helper
  rather than editing every assertion:
  ```ts
  const out = async (tool, ctx) => (await tool.run(ctx)).output;
  ```
  This is the cheapest end-to-end proof that all 77 returns were wrapped.
- **`evals/`** uses the beta SDK — update `evals/harness.ts` to the
  conversation-scoped client alongside §14.
- **`npm run guards`** — `agent-parity.mjs` and `vendored-in-sync.mjs` both read
  `flue-agent/src/`. Run them after the tool rewrite; if `agent-parity` starts
  reporting new gaps, the rewrite changed a tool signature it parses.
- **New capability worth wiring:** `flue run src/agents/whistlewood.ts --message "…"
  --id <id>` executes an agent headlessly. There is no `.github/workflows/` in this
  repo yet — that is the natural home for a skill-regression job. Out of scope here;
  noted in the [report][report].

---

## 16. Cutover

1. Deploy `shot-studio-flue-v2` (Phase 1–13 complete, secrets set). **Do not** touch
   the proxy yet — the new Worker is live but unaddressed.
2. Smoke-test it directly with a hand-minted proxy token against a scratch project:
   a `get_status` turn, a `render_ui` card, one subagent delegation, one bash call
   (proves §10.1), one Higgsfield render (proves §11), one gated
   `restore_version` (proves the two-phase approval still spans two turns).
3. Ship the `engine` column + proxy routing (§1 option C) with **`"flue2"` behind a
   flag defaulting off**. Verify existing chats still route to v1.
4. Flip the default for *new* chats to `"flue2"`. Existing chats stay on v1.
5. Deploy the client bump (§14) — it is compatible with both engines, since only the
   addressing changed and the `/eve` path is identical.
6. Watch Workers Logs on both Workers for a week. `submission_settled` with a
   non-`completed` outcome is the signal that matters.

### Rollback

Flip the `engine` default back to `"flue1"`. New chats return to the old Worker
immediately; chats already created on v2 keep working on v2 (their transcripts live
there). No data migration, no redeploy of the main worker required if the flag is
read from D1 or an env var.

---

## 17. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Schema reset destroys transcripts | **Certain** if upgraded in place | Severe — users lose their work | §1 option C: parallel Workers, zero loss |
| Default chats lose bash entirely (§0.2) | **Certain** if unaddressed | High — media skills break silently | §10.1 explicit in-memory sandbox; smoke-test a bash call at cutover |
| `higgsfield.ts:257` returns a bare array/undefined → throw | Medium | High — all generation dies | §7.3 defensive wrap, or delete the file per §11 |
| An `/api` endpoint returns a top-level array → throw | Low | Medium | The `{ output }` wrap fixes this class outright |
| `idFromName` keying changed → settings RPCs write to a dead DO | Low | Medium, **silent** | §9.1 explicit test: pick a non-default model, assert the turn used it |
| `useMcpConnection` still can't run on workerd | Medium | Low — status quo | §11 is optional; verify before deleting |
| `cloudflareBindingProvider` shape differs from assumed | Medium | Medium — long answers truncate again | §4.2 fallback to `createProvider({ api: { stream, streamSimple } })`; test a >16k answer |
| Subagent rewrite loses the read-only advisor contract | Low | Medium — a doctor starts writing | Assert each delegate's tool list; `render_ui` must be absent from all 9 |
| `flue-agent` on Vite 8 vs root SPA on Vite 5 | Low | Low | Separate `node_modules`; do not hoist |
| Both Workers drift after cutover | Medium | Low | v1 is frozen by policy — no feature lands there |

---

## 18. Sequencing summary

| Phase | Blocks on | Effort | Deployable alone |
|---|---|---|---|
| 0 · history decision (§1) | — | discussion | n/a — **blocking** |
| 1 · toolchain (§3) | 0 | S | no |
| 2 · providers (§4) | 1 | M | no |
| 3 · agent function (§5) | 1 | M | no |
| 4 · subagents (§6) | 3 | M | no |
| 5 · tools (§7) | 1 | M (bulk, codemod) | no |
| 6 · skills/markdown (§8) | 1 | S | no |
| 7 · routing (§9) | 3 | S | no |
| 8 · sandbox (§10) | 3 | M | no |
| 9 · MCP (§11) | 3 | S–L (verify first) | no |
| 10 · observability (§12) | 3 | S | no |
| 11 · deploy config (§13) | 1 | S | no |
| 12 · clients (§14) | — | S | **yes**, after v2 is live |
| 13 · tests/evals (§15) | 5 | S | with the rest |
| 14 · cutover (§16) | all | — | — |

Phases 1–11 land as **one branch, one deploy** — they are not independently
shippable, because the agent does not compile until the whole set is done. Phase 12
is a separate PR that can ship after the new Worker is verified.

---

## 19. Follow-ups deliberately excluded from this migration

Each is a real improvement, and each is a way to make this migration fail if bundled
into it. Detail and rationale in the [report][report].

1. **The Callboard** — pipeline stage in `usePersistentState`, stage-scoped
   `useSkill` / `useTool` mounting. Turns "one stage per turn" from a prompt
   paragraph into a state machine, and shrinks the always-on skill catalog from 18
   lines to ~4.
2. **Retire the `extend()` RPCs + `x-flue-*` headers** in favour of
   `usePersistentState` and validated `initialData`.
3. **Durable render tools** (`durable: true` + `step.do()`) and worker→agent
   `dispatch()` of a `render.completed` signal, replacing "never end a turn with a
   render in flight".
4. **`useAgentFinish`** as an enforcement seam for the pipeline covenant.
5. **`harness.prompt()` with valibot `result` schemas** for structured doctor
   coverage instead of prose.
6. **`useDataWriter`** for live render/stage progress parts on both clients.
7. **Workers Traces** (`createCloudflareTracing()`) replacing most of the
   `observe()` logging, plus per-conversation token cost.
8. **`flue run` in CI** for skill-regression evals.
