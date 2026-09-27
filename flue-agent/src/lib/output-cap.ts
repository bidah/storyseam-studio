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
// Fix: build the `cloudflare` binding provider ourselves and register it with
// a `stream` / `streamSimple` pair that defaults `maxTokens` on every call.
// setProvider() is keyed by provider id and the latest write wins — the
// generated Worker entry SKIPS any id already registered, and app.ts's imports
// are hoisted above its body, so this registration always beats the default
// one. (In flue 1 the same thing needed a queueMicrotask to win the ordering
// race; that hack is gone.)
import { setProvider } from "@flue/runtime";
import {
  cloudflareBindingProvider,
  type CloudflareAIBinding,
} from "@flue/runtime/cloudflare/workers-ai";
import { env } from "cloudflare:workers";

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

// Deliberately loose in the parameters: this wraps pi-ai's `stream` and
// `streamSimple`, whose signatures differ in their option types and are generic
// over the model's API. `T` carries the real signature through to the caller;
// the body only ever reads `model.maxTokens` and `options.maxTokens`, which both
// shapes have.
type AnyStreamFn = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: any,
  options?: { maxTokens?: number },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) => any;

function withOutputCap<T extends AnyStreamFn>(stream: T): T {
  return ((model, context, options) => {
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
  }) as T;
}

let installed = false;

export function installWorkersAiOutputCap(): void {
  if (installed) return;
  installed = true;
  // A Pi provider carries `stream` / `streamSimple` at the top level (the
  // `api` field is only `createProvider`'s input), so the cap wraps those two.
  // Spreading is safe: `createProvider` returns a plain object literal, and the
  // binding provider's dynamic-model-template symbol is an own enumerable key.
  // `env` is untyped here (no generated worker-configuration.d.ts in this
  // project); wrangler.jsonc's `"ai": { "binding": "AI" }` is what supplies it.
  const binding = (env as unknown as { AI: CloudflareAIBinding }).AI;
  const base = cloudflareBindingProvider({ binding });
  // `cloudflare/anthropic/…` (the Film's writers' room runs on Claude Fable)
  // goes through the binding too, but on AI Gateway's Unified Billing:
  // Cloudflare holds the Anthropic credential and bills the account's gateway
  // credits, which needs an AUTHENTICATED gateway — the `default` one is not.
  // The main worker's Claude writer uses the same one (worker/src/lib/writer.js
  // CLAUDE_GATEWAY). One binding provider takes one gateway, so the anthropic
  // family gets its own and every other model keeps the default route.
  const claudeGateway =
    (process.env.CLAUDE_GATEWAY_ID as string | undefined) || "auto-look";
  const claude = cloudflareBindingProvider({ binding, gateway: { id: claudeGateway } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byFamily = <K extends "stream" | "streamSimple">(key: K) => ((model: any, context: any, options: any) =>
    (String(model?.id ?? "").startsWith("anthropic/") ? claude[key] : base[key])(model, context, options)) as typeof base[K];
  setProvider({
    ...base,
    stream: withOutputCap(byFamily("stream")),
    streamSimple: withOutputCap(byFamily("streamSimple")),
  });
}
