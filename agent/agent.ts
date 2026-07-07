import { defineAgent } from "eve";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

// Default model: anthropic/claude-sonnet-5 via the Vercel AI Gateway.
//   Set AI_GATEWAY_API_KEY (or run `vercel link`) to use it.
//
// Local fallback for offline end-to-end testing: set OLLAMA_MODEL (e.g. `llama3.1`)
// and the agent runs against a local Ollama server — no cloud key required.
//   OLLAMA_MODEL=llama3.1 npm run agent:start
const ollamaModel = process.env.OLLAMA_MODEL;

const ollama = createOpenAICompatible({
  name: "ollama",
  baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
  apiKey: "ollama",
});

export default defineAgent(
  ollamaModel
    ? {
        model: ollama.chatModel(ollamaModel),
        // A custom (non-gateway) provider has no known context window, which the
        // compaction trigger needs — supply one explicitly.
        modelContextWindowTokens: Number(process.env.OLLAMA_CONTEXT_TOKENS ?? 8192),
      }
    : { model: "anthropic/claude-sonnet-5" },
);
