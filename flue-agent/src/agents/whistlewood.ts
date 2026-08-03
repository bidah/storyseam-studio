"use agent";
import {
  useMcpConnection,
  useModel,
  useSandbox,
  useSkill,
  useSubagent,
  useTool,
  type AgentProps,
} from "@flue/runtime";
import {
  extend,
  getCloudflareContext,
  type CloudflareAgentLike,
} from "@flue/runtime/cloudflare";
import instructions from "./whistlewood.md";
import { decodeInstanceId } from "../lib/instance-id.js";
import { createApi } from "../lib/api.js";
import { createTools } from "../tools/index.js";
import { upgradeSandbox } from "../tools/upgrade_sandbox.js";
import { workerHiggsfieldToken } from "../lib/worker-token.js";
import { createFalTools } from "../lib/fal.js";
import { createAtlasTools } from "../lib/atlas.js";
import { selectSearchTools } from "../lib/search.js";
import {
  daytonaAvailable,
  daytonaFactory,
  memorySandbox,
} from "../lib/sandbox.js";
import { skills } from "../skills.js";
import { createSubagents } from "../subagents.js";
import {
  DEFAULT_MODEL,
  readSelectedModel,
  writeSelectedModel,
} from "../lib/models.js";
import { readFalKey, writeFalKey } from "../lib/fal-key.js";
import { readAtlasKey, writeAtlasKey } from "../lib/atlas-key.js";
import {
  readRenderPrefs,
  writeRenderPrefs,
  type RenderPrefs,
} from "../lib/render-prefs.js";
import {
  EMPTY_SEARCH_PREFS,
  mergeSearchPrefs,
  readSearchPrefs,
  writeSearchPrefs,
  type SearchPrefs,
} from "../lib/search-prefs.js";
import {
  DEFAULT_SANDBOX_MODE,
  readSandboxMode,
  writeSandboxMode,
  type SandboxMode,
} from "../lib/sandbox-prefs.js";

// HTTP exposure is app.ts's job now: `createAgentRouter(Whistlewood)` mounted at
// /agents/whistlewood, with the auth middleware registered before the mount.
// The module-level `route` and `description` conventions are gone in flue 2.

// Read this conversation's per-turn model from its Durable Object storage
// (written by app.ts's setModel just before the prompt was admitted — see
// lib/models.js). The agent function re-renders before every model call, so a
// fresh selection is picked up each turn. Falls back to the default off the
// Cloudflare runtime (e.g. build-time analysis) or when nothing valid is stored.
function selectedModel(): string {
  try {
    return readSelectedModel(getCloudflareContext().storage.sql);
  } catch {
    return DEFAULT_MODEL;
  }
}

// This conversation's stored fal key (BYOK — written by app.ts's setFalKey just
// before the prompt was admitted, like the model selection above). Empty when
// the user hasn't provided one; createFalTools then falls back to the FAL_KEY
// env secret or omits the fal tools entirely.
function storedFalKey(): string {
  try {
    return readFalKey(getCloudflareContext().storage.sql);
  } catch {
    return "";
  }
}

// Same for the Atlas Cloud key (app.ts setAtlasKey → lib/atlas-key.ts).
function storedAtlasKey(): string {
  try {
    return readAtlasKey(getCloudflareContext().storage.sql);
  } catch {
    return "";
  }
}

// The Settings provider selection (app.ts setRenderPrefs → lib/render-prefs.ts):
// exactly one provider is in use at a time; the selection steers the default
// backend via the instructions. Tools for the other providers stay AVAILABLE —
// Higgsfield-only pipelines (multishot lip-sync, Seed Audio scenes) must keep
// working whatever the selection, and in-flight jobs may still need polling.
function storedRenderPrefs(): RenderPrefs {
  try {
    return readRenderPrefs(getCloudflareContext().storage.sql);
  } catch {
    return { active: "", disabled: [] };
  }
}

// Settings › Web search: the default search provider plus this conversation's
// BYOK Exa / Firecrawl keys (app.ts setSearchPrefs → lib/search-prefs.ts).
// Exactly one backend's tools load — see lib/search.ts.
function storedSearchPrefs(): SearchPrefs {
  try {
    return readSearchPrefs(getCloudflareContext().storage.sql);
  } catch {
    return { ...EMPTY_SEARCH_PREFS };
  }
}

// Settings › Sandbox: whether this conversation gets a persistent Daytona
// container or flue's per-turn in-memory filesystem (app.ts setSandboxMode →
// lib/sandbox-prefs.ts). Defaults to in-memory — Daytona is opt-in per chat.
function storedSandboxMode(): SandboxMode {
  try {
    return readSandboxMode(getCloudflareContext().storage.sql);
  } catch {
    return DEFAULT_SANDBOX_MODE;
  }
}

// Native Agents SDK extension for this agent's generated Durable Object. Adds
// `setModel` / `setFalKey` / `setAtlasKey` / `setRenderPrefs` RPCs that persist
// the caller-selected chat model, BYOK render keys, and provider toggles for
// the conversation; app.ts invokes them (whitelisted / shape-checked) before
// admitting each prompt.
export const cloudflare = extend<CloudflareAgentLike & { ctx: DurableObjectState }>(
  {
    base: (Base) =>
      class extends Base {
        async setModel(model: string): Promise<void> {
          writeSelectedModel(this.ctx.storage.sql, model);
        }
        async setFalKey(key: string): Promise<void> {
          writeFalKey(this.ctx.storage.sql, key);
        }
        async setAtlasKey(key: string): Promise<void> {
          writeAtlasKey(this.ctx.storage.sql, key);
        }
        async setRenderPrefs(prefs: RenderPrefs): Promise<void> {
          writeRenderPrefs(this.ctx.storage.sql, prefs);
        }
        // MERGES rather than replaces: an absent header must leave the stored
        // key alone (a client that doesn't send keys can't wipe them), while a
        // present-but-empty one clears it — see mergeSearchPrefs.
        async setSearchPrefs(incoming: {
          provider?: unknown;
          exaKey?: unknown;
          firecrawlKey?: unknown;
        }): Promise<void> {
          const sql = this.ctx.storage.sql;
          writeSearchPrefs(sql, mergeSearchPrefs(readSearchPrefs(sql), incoming));
        }
        async setSandboxMode(mode: string): Promise<void> {
          writeSandboxMode(this.ctx.storage.sql, mode);
        }
      },
  },
);

const PROVIDER_TOOLS: Record<string, string> = {
  higgsfield: "the Higgsfield tools (generate_image / generate_video / generate_audio)",
  fal: "the fal tools (fal_generate_image / fal_generate_video)",
  atlas: "the Atlas Cloud tools (atlas_generate_image / atlas_generate_video)",
};

// The instance id carries the conversation's scope: `userId~projectId~chatId`.
// We decode it here to build project-scoped tools and per-user credentials via
// closure, since a flue tool's `run({ data, signal })` gets no ambient context.
//
// This function is a RENDER: flue runs it before every model call, and it must
// stay SYNCHRONOUS. The two things the old initializer awaited have moved to
// where flue 2 puts async work — the Higgsfield tool list to `useMcpConnection`
// (the runtime connects at submission init, off this path) and the Daytona
// container to the sandbox factory's own `createSessionEnv`. Everything left
// here is a `getCloudflareContext().storage.sql` read.
export function Whistlewood({ id }: AgentProps): string {
  const decoded = decodeInstanceId(id);
  const projectId = decoded?.projectId ?? null;
  const userId = decoded?.userId ?? "";

  const api = createApi(projectId, userId, decoded?.chatId ?? null);

  useModel(selectedModel());

  // Sandbox for bash/skill execution. There is no implicit environment in flue
  // 2 — without this call the agent has no filesystem and no bash/read/write/
  // grep/glob at all — so BOTH tiers are declared explicitly. Daytona is opt-in
  // per conversation (Settings › Sandbox, or the agent's own `upgrade_sandbox`);
  // everything else gets the free in-memory filesystem, which is also where
  // daytonaFactory degrades to if the container can't be reached.
  //
  // No `cwd`: flue then uses the provider's own working directory
  // (/home/daytona), the only place the sandbox's non-root `daytona` user can
  // actually write. A `/workspace` cwd silently broke every bash call on
  // Daytona — `mkdir /workspace` is Permission denied outside the home dir.
  const sandboxMode = storedSandboxMode();
  useSandbox(sandboxMode === "daytona" ? daytonaFactory() : memorySandbox());

  // Higgsfield generation, as a remote MCP server rather than the hand-rolled
  // client this file used to await. `optional` preserves the old behaviour for a
  // user with no Higgsfield credential: zero tools mounted and the gap announced
  // to the model, instead of a failed submission. Tool names are unchanged
  // (`mcp__higgsfield__<tool>`), so every skill that references them still works.
  //
  // One thing did NOT survive the swap: the hand-rolled client appended a "this
  // render is still RUNNING, poll job_status" note to every queued-job result.
  // flue owns the tool results now, so that belt is gone and only the braces
  // remain — the hard "Never end a turn with a render in flight" rule in
  // whistlewood.md. Re-arming it properly is a `useAgentFinish` job.
  const higgsfieldMcpUrl = process.env.HIGGSFIELD_MCP_URL;
  if (higgsfieldMcpUrl && userId) {
    useMcpConnection({
      name: "higgsfield",
      url: higgsfieldMcpUrl,
      // Resolved per request, which is exactly the bridged per-user token's
      // lifecycle: the shot-studio-uploads worker holds and refreshes each
      // user's bearer, and we fetch the current one (lib/worker-token.ts).
      auth: async () => (await workerHiggsfieldToken(userId))?.token ?? "",
      optional: true,
    });
  }

  // All credentialed provider tools load regardless of the Settings selection
  // (see storedRenderPrefs above) — the selection only steers the default.
  // Web search / page reading loads exactly ONE backend (Exa or Firecrawl), per
  // the Settings selection: both register the same `web_search` / `fetch_url`
  // names. Independent of the render-provider selection.
  const search = selectSearchTools(storedSearchPrefs());
  for (const tool of [
    ...createTools(api),
    ...createFalTools(storedFalKey()),
    ...createAtlasTools(storedAtlasKey()),
    ...search.tools,
  ]) {
    useTool(tool);
  }

  // The escalation hatch, offered only when there is somewhere to escalate TO
  // and the conversation isn't already there. Daytona is paid and shared, so a
  // deployment without the key never sees the tool at all.
  if (sandboxMode !== "daytona" && daytonaAvailable()) useTool(upgradeSandbox());

  for (const skill of skills) useSkill(skill);
  for (const subagent of createSubagents(api, search.tools)) useSubagent(subagent);

  const prefs = storedRenderPrefs();
  const providerNote =
    prefs.active && PROVIDER_TOOLS[prefs.active]
      ? `\n\n## Render provider\n\nThe user has SELECTED **${prefs.active}** as their render provider — use ${PROVIDER_TOOLS[prefs.active]} for image/video renders. Only use another backend when a skill is hard-bound to it (multishot lip-sync and Seed Audio scenes are Higgsfield-only) or the user explicitly asks.`
      : "";

  return providerNote ? `${instructions}${providerNote}` : instructions;
}

// Pin the storage identity. The generated Durable Object class and binding are
// derived from it — `whistlewood` → FlueWhistlewoodAgent / FLUE_WHISTLEWOOD_AGENT,
// which is what wrangler.jsonc's migration and app.ts's AGENT_BINDINGS declare.
// Without the pin, renaming this function would silently orphan every stored
// conversation.
Whistlewood.agentName = "whistlewood";
