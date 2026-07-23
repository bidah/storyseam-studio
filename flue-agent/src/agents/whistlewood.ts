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
import { createSandbox } from "../lib/sandbox.js";
import { skills } from "../skills.js";
import { createSubagents } from "../subagents.js";
import {
  DEFAULT_MODEL,
  readSelectedModel,
  writeSelectedModel,
} from "../lib/models.js";
import { readFalKey, writeFalKey } from "../lib/fal-key.js";

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

// Native Agents SDK extension for this agent's generated Durable Object. Adds
// `setModel` / `setFalKey` RPCs that persist the caller-selected chat model and
// fal API key for the conversation; app.ts invokes them (whitelisted /
// shape-checked) before admitting each prompt.
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
  const higgsfieldTools = await createHiggsfieldTools(userId);
  const falTools = createFalTools(storedFalKey());
  const sandbox = await createSandbox(id);

  return {
    model: selectedModel(),
    instructions,
    tools: [...tools, ...higgsfieldTools, ...falTools],
    skills,
    subagents: createSubagents(api),
    ...(sandbox ? { sandbox, cwd: "/workspace" } : {}),
  };
});
