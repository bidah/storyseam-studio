// Shared model wiring for the root agent AND every subagent.
//
// Subagents are isolated — each `agent/subagents/<id>/` directory is its own
// agent root and inherits NO config from the parent (docs/subagents.mdx). So
// each subagent's agent.ts calls modelConfig() to get the exact same model
// wiring the root uses, in one place:
//
//   - default: anthropic/claude-sonnet-5 via the Vercel AI Gateway
//     (set AI_GATEWAY_API_KEY or run `vercel link`).
//   - offline fallback: set OLLAMA_MODEL (e.g. `llama3.1`) to run every agent —
//     root and subagents — against a local Ollama server with no cloud key.
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const ollama = createOpenAICompatible({
  name: "ollama",
  baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
  apiKey: "ollama",
});

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
    : { model: "anthropic/claude-sonnet-5" as const };
}
