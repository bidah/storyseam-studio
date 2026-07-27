import { defineAgent, type AgentRouteHandler } from "@flue/runtime";
import {
  extend,
  getCloudflareContext,
  type CloudflareAgentLike,
} from "@flue/runtime/cloudflare";
import instructions from "./whistlewood.md" with { type: "markdown" };
import { decodeInstanceId } from "../lib/instance-id.js";
import { createApi } from "../lib/api.js";
import { createTools } from "../tools/index.js";
import { createHiggsfieldTools } from "../lib/higgsfield.js";
import { createFalTools } from "../lib/fal.js";
import { createAtlasTools } from "../lib/atlas.js";
import { createExaTools } from "../lib/exa.js";
import { createSandbox } from "../lib/sandbox.js";
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

export const description =
  "Whistlewood production agent — drives the script → shots → renders → cuts → library pipeline.";

// HTTP exposure at POST/GET /agents/whistlewood/:id. Auth (HMAC proxy-user verify
// + instance-id ownership) is enforced by app.ts middleware, so this is a
// pass-through.
export const route: AgentRouteHandler = async (_c, next) => next();

// Read this conversation's per-turn model from its Durable Object storage
// (written by app.ts's setModel just before the prompt was admitted — see
// lib/models.js). The initializer re-runs on every harness init, so a fresh
// selection is picked up each turn. Falls back to the default off the Cloudflare
// runtime (e.g. build-time analysis) or when nothing valid is stored.
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
      },
  },
);

// The instance id carries the conversation's scope: `userId~projectId~chatId`.
// We decode it here to build project-scoped tools and per-user credentials via
// closure, since a flue tool's `run({ input, signal })` gets no ambient context.
export default defineAgent(async ({ id }) => {
  const decoded = decodeInstanceId(id);
  const projectId = decoded?.projectId ?? null;
  const userId = decoded?.userId ?? "";

  const api = createApi(projectId);
  const tools = createTools(api);
  // All credentialed provider tools load regardless of the Settings selection
  // (see storedRenderPrefs above) — the selection only steers the default.
  const prefs = storedRenderPrefs();
  const higgsfieldTools = await createHiggsfieldTools(userId);
  const falTools = createFalTools(storedFalKey());
  const atlasTools = createAtlasTools(storedAtlasKey());
  // Web search / page reading (Exa). Operator-keyed off EXA_API_KEY, absent
  // without it — not tied to the render-provider selection.
  const exaTools = createExaTools();
  const sandbox = await createSandbox(id);

  const PROVIDER_TOOLS: Record<string, string> = {
    higgsfield: "the Higgsfield tools (generate_image / generate_video / generate_audio)",
    fal: "the fal tools (fal_generate_image / fal_generate_video)",
    atlas: "the Atlas Cloud tools (atlas_generate_image / atlas_generate_video)",
  };
  const providerNote =
    prefs.active && PROVIDER_TOOLS[prefs.active]
      ? `\n\n## Render provider\n\nThe user has SELECTED **${prefs.active}** as their render provider — use ${PROVIDER_TOOLS[prefs.active]} for image/video renders. Only use another backend when a skill is hard-bound to it (multishot lip-sync and Seed Audio scenes are Higgsfield-only) or the user explicitly asks.`
      : "";

  return {
    model: selectedModel(),
    instructions: providerNote ? `${instructions}${providerNote}` : instructions,
    tools: [...tools, ...higgsfieldTools, ...falTools, ...atlasTools, ...exaTools],
    skills,
    subagents: createSubagents(api),
    ...(sandbox ? { sandbox, cwd: "/workspace" } : {}),
  };
});
