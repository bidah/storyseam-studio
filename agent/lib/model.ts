// Shared model wiring for the root agent AND every subagent.
//
// Subagents are isolated — each `agent/subagents/<id>/` directory is its own
// agent root and inherits NO config from the parent (docs/subagents.mdx). So
// each subagent's agent.ts calls modelConfig() to get the exact same model
// wiring the root uses, in one place:
//
//   - default: anthropic/claude-sonnet-5 via the Vercel AI Gateway
//     (set AI_GATEWAY_API_KEY or run `vercel link`), with the in-chat picker
//     able to switch the ROOT chat turn to Opus 4.6 or Fable 5 per turn.
//   - offline fallback: set OLLAMA_MODEL (e.g. `llama3.1`) to run every agent —
//     root and subagents — against a local Ollama server with no cloud key.
import { gateway, type LanguageModel } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { getModelId } from "./context";

// The concrete model object a gateway id resolves to (the `LanguageModel` union
// also allows a bare id string, which the router below can't forward through).
type ChatModel = ReturnType<typeof gateway>;

// The models the in-chat picker can choose between. `id` is the short handle the
// browser persists (localStorage) and sends on every turn via `x-eve-model`;
// `gatewayId` is the Vercel AI Gateway model it maps to. The FIRST entry is the
// default used when nothing is selected or the id is unknown. Keep this list in
// sync with the picker's copy in src/lib/agentModel.js.
export const CHAT_MODELS = [
  { id: "claude-sonnet-5", gatewayId: "anthropic/claude-sonnet-5" },
  { id: "claude-opus-4.6", gatewayId: "anthropic/claude-opus-4.6" },
  { id: "claude-fable-5", gatewayId: "anthropic/claude-fable-5" },
] as const;

const DEFAULT_MODEL = CHAT_MODELS[0];

// All chat models are Anthropic Claude models on the gateway, which share a
// ~200k-token context window. We pass a LanguageModel *object* (the router
// below) rather than a bare id string, so eve can't look the window up from the
// gateway catalog — supply it explicitly, same escape hatch as Ollama.
const CHAT_CONTEXT_TOKENS = 200_000;

const ollama = createOpenAICompatible({
  name: "ollama",
  baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
  apiKey: "ollama",
});

// Gateway model instances, built lazily and cached (one per id).
const instances = new Map<string, ChatModel>();
function instanceFor(id: string | null): ChatModel {
  const entry = CHAT_MODELS.find((m) => m.id === id) ?? DEFAULT_MODEL;
  let inst = instances.get(entry.id);
  if (!inst) {
    inst = gateway(entry.gatewayId) as ChatModel;
    instances.set(entry.id, inst);
  }
  return inst;
}

// The model for the current turn: read the per-session selection from durable
// state and resolve it to a gateway instance. `getModelId()` throws outside a
// managed runtime scope (e.g. very early init), so fall back to the default.
function selected(): ChatModel {
  let id: string | null = null;
  try {
    id = getModelId();
  } catch {
    id = null;
  }
  return instanceFor(id);
}

// A LanguageModel that forwards every call to whichever gateway model is
// selected for the current turn. eve holds this one reference for the agent's
// lifetime but invokes doStream/doGenerate afresh each turn, so switching the
// picker mid-conversation takes effect on the very next turn. Static props are
// getters so they always reflect the live selection (used only for logging).
const router = {
  get specificationVersion() {
    return selected().specificationVersion;
  },
  get provider() {
    return selected().provider;
  },
  get modelId() {
    return selected().modelId;
  },
  get supportedUrls() {
    return selected().supportedUrls;
  },
  doGenerate: (options: Parameters<ChatModel["doGenerate"]>[0]) =>
    selected().doGenerate(options),
  doStream: (options: Parameters<ChatModel["doStream"]>[0]) =>
    selected().doStream(options),
} as LanguageModel;

// Spread into a defineAgent(...) config, e.g. `defineAgent({ ...modelConfig(),
// description: "…" })`. A custom (non-gateway) provider has no known context
// window, which the compaction trigger needs, so we supply one explicitly.
export function modelConfig() {
  const ollamaModel = process.env.OLLAMA_MODEL;
  return ollamaModel
    ? {
        model: ollama.chatModel(ollamaModel),
        modelContextWindowTokens: Number(process.env.OLLAMA_CONTEXT_TOKENS ?? 8192),
      }
    : { model: router, modelContextWindowTokens: CHAT_CONTEXT_TOKENS };
}
