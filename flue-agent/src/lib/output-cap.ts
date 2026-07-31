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

// Fallback when the catalog doesn't document the model's completion cap.
// When it DOES (pi-ai's `model.maxTokens`), we use that instead — clamping
// every model to this floor is what truncated a full-script `save_script`
// mid-arguments on Kimi (documented cap 256k, clamped to 16384; the turn
// died with "A canonical conversation record violates the conversation
// stream contract" and the chat stuck on a spinning tool chip).
// Explicit per-call `maxTokens` (e.g. flue's compaction summarizer) wins.
export const DEFAULT_MAX_COMPLETION_TOKENS = 16384;

// Upper bound even when the catalog allows more (Kimi K2.6: 256k). A runaway
// generation burns tokens for minutes before anyone can stop it; ~4× the
// biggest legitimate turn we've observed (reasoning + a chunked tool call)
// is headroom, not an invitation.
export const MAX_COMPLETION_TOKENS_CEILING = 65536;

type AnyStreamFn = (
  model: { maxTokens?: number },
  context: unknown,
  options?: { maxTokens?: number },
) => unknown;

function withOutputCap(stream: AnyStreamFn): AnyStreamFn {
  return (model, context, options) => {
    if (options?.maxTokens) return stream(model, context, options);
    // The model's own documented completion cap when the catalog knows it
    // (0 = unknown), bounded by the ceiling. gpt-oss-120b stays at its 16384;
    // Kimi / GLM get real headroom instead of the old global 16384 clamp.
    const modelCap =
      typeof model.maxTokens === "number" && model.maxTokens > 0
        ? model.maxTokens
        : DEFAULT_MAX_COMPLETION_TOKENS;
    const maxTokens = Math.min(modelCap, MAX_COMPLETION_TOKENS_CEILING);
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
