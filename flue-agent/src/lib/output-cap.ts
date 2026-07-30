// Explicit output-token cap for Workers AI turns.
//
// Neither flue's agent loop nor pi-agent-core ever sets `options.maxTokens`,
// and the runtime's Workers AI provider only sends `max_completion_tokens`
// when that option is present (`if (options?.maxTokens) …`). With the field
// absent, the Workers AI endpoint applies its own SMALL default completion cap
// (256–2048 tokens depending on model), and a completion that hits it comes
// back with finish_reason "length" — which the loop treats as a NORMAL stop
// for text, not an error. The visible symptom: a subagent that answers with
// one long message (story_architect returning a beat-by-beat outline) gets
// silently truncated mid-sentence, the parent sees a clipped answer, and the
// whole delegation's work is lost. Tool calls in a "length" turn are failed
// with "truncated arguments" (same root cause as the old big-shotlist
// failures).
//
// Fix: re-register the `cloudflare-ai-binding` API provider with a wrapper
// that defaults `maxTokens` on every call. pi-ai's API-provider registry is
// documented module-scoped last-write-wins, so re-registering the same slug
// replaces flue's handler. ORDER MATTERS: the flue-generated worker entry
// calls `registerApiProvider(getCloudflareAIBindingApiProvider())` in its
// module body, which runs AFTER app.ts's module body (user imports are
// hoisted above it) — so app.ts must install this via queueMicrotask, which
// runs after the entire module graph evaluates and before any request/alarm
// is dispatched.
import { registerApiProvider } from "@flue/runtime";
import { getCloudflareAIBindingApiProvider } from "@flue/runtime/cloudflare/internal";

// Generous for a full outline/draft (~12k words) yet ≤ every allowed model's
// documented completion cap (smallest: @cf/openai/gpt-oss-120b at 16384).
// Explicit per-call `maxTokens` (e.g. flue's compaction summarizer) wins.
export const DEFAULT_MAX_COMPLETION_TOKENS = 16384;

type AnyStreamFn = (
  model: { maxTokens?: number },
  context: unknown,
  options?: { maxTokens?: number },
) => unknown;

function withOutputCap(stream: AnyStreamFn): AnyStreamFn {
  return (model, context, options) => {
    if (options?.maxTokens) return stream(model, context, options);
    // Never exceed the model's own documented completion cap when the
    // catalog knows it (0 = unknown).
    const modelCap =
      typeof model.maxTokens === "number" && model.maxTokens > 0
        ? model.maxTokens
        : DEFAULT_MAX_COMPLETION_TOKENS;
    const maxTokens = Math.min(DEFAULT_MAX_COMPLETION_TOKENS, modelCap);
    return stream(model, context, { ...options, maxTokens });
  };
}

let installed = false;

export function installWorkersAiOutputCap(): void {
  if (installed) return;
  installed = true;
  const base = getCloudflareAIBindingApiProvider();
  registerApiProvider({
    api: base.api,
    stream: withOutputCap(base.stream as AnyStreamFn),
    streamSimple: withOutputCap(base.streamSimple as AnyStreamFn),
  } as unknown as Parameters<typeof registerApiProvider>[0]);
}
