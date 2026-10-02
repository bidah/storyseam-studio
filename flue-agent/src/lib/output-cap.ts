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

// Qwen 3.8 27B (the studio's default Film writer, and so the model a Deep
// Film's writers' room reads on) is not in pi-ai's Workers AI catalog. flue
// resolves an unknown `@cf/…` id with ZERO metadata, and zero metadata means
// `reasoning: false` — so no `reasoning_effort` ever reaches the wire and Qwen
// thinks at its own default, which is xhigh (worker/src/lib/writer.js). A room
// pass measured 139 s and 289 s of thinking PER TURN that way, and
// story_architect's pass took 50 minutes (film-a45e1cb9, 2026-09-29). Declared
// here as reasoning-capable, a `thinkingLevel` reaches it as `reasoning_effort`.
// Workers AI takes "low" and "medium" for this model and REFUSES "high"
// (measured), so the map has no high rung — keep callers at low/medium.
export const WORKERS_AI_QWEN_ID = "@cf/qwen/qwen3.8-27b";
const QWEN_MODEL = {
  id: WORKERS_AI_QWEN_ID,
  name: "Qwen 3.8 27B",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 131072,
  maxTokens: 32000,
  thinkingLevelMap: { off: null, minimal: "low", low: "low", medium: "medium", high: null, xhigh: null, max: null },
};

// GLM-5.3 (the studio's default Film writer since 2026-09-29, for its prose)
// is not in pi-ai's catalog either, and unregistered it would resolve with
// `reasoning: false` like Qwen did — no `reasoning_effort` on the wire, so it
// thinks at its own default, which is `max` and cannot be switched off. At
// `low` it answers straight with no reasoning tokens; `medium` spent ~500 and
// `max` ~1,000 on a one-line answer (measured 2026-09-29). Workers AI takes
// none/low/medium/high/max and refuses xhigh, so xhigh rides up to max. A turn
// with NO thinking level sends no effort at all (pi-ai only sends one when a
// level is set) and gets max — the writers' room always sets `low`.
export const WORKERS_AI_GLM_ID = "@cf/zai-org/glm-5.3";
const GLM_MODEL = {
  id: WORKERS_AI_GLM_ID,
  name: "GLM-5.3",
  reasoning: true,
  input: ["text"],
  cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
  contextWindow: 1048576,
  maxTokens: 32000,
  thinkingLevelMap: { off: null, minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "max", max: "max" },
};

// Workers AI models the catalog doesn't ship, added to it with their metadata.
const EXTRA_MODELS = [QWEN_MODEL, GLM_MODEL];

// flue fails a model stream as a RETRYABLE interruption after this long with
// no bytes (its default is 300 s). Workers AI streams reasoning deltas, so a
// thinking model is never silent for long; two minutes of nothing is a stalled
// stream, and each stall used to cost five minutes before the retry.
export const STREAM_IDLE_TIMEOUT_MS = 120_000;

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
  const base = cloudflareBindingProvider({ binding, streamIdleTimeoutMs: STREAM_IDLE_TIMEOUT_MS });
  // `cloudflare/anthropic/…` (a Film whose writer is Claude runs its writers' room on it)
  // goes through the binding too, but on AI Gateway's Unified Billing:
  // Cloudflare holds the Anthropic credential and bills the account's gateway
  // credits, which needs an AUTHENTICATED gateway — the `default` one is not.
  // The main worker's Claude writer uses the same one (worker/src/lib/writer.js
  // CLAUDE_GATEWAY). One binding provider takes one gateway, so the anthropic
  // family gets its own and every other model keeps the default route.
  const claudeGateway =
    (process.env.CLAUDE_GATEWAY_ID as string | undefined) || "auto-look";
  const claude = cloudflareBindingProvider({ binding, gateway: { id: claudeGateway }, streamIdleTimeoutMs: STREAM_IDLE_TIMEOUT_MS });
  // Qwen 3.8 and GLM-5.3 join the catalog as binding models (same `api`
  // marker the binding gives every catalog entry), so they resolve WITH their
  // metadata. A later catalog that ships one keeps its own entry.
  const template = base.getModels().find((m) => m.id === "@cf/moonshotai/kimi-k2.6") ?? base.getModels()[0];
  const baseModels = base.getModels();
  const models = [
    ...baseModels,
    ...EXTRA_MODELS.filter((extra) => !baseModels.some((m) => m.id === extra.id))
      .map((extra) => ({ ...template, ...extra }) as typeof template),
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byFamily = <K extends "stream" | "streamSimple">(key: K) => ((model: any, context: any, options: any) =>
    (String(model?.id ?? "").startsWith("anthropic/") ? claude[key] : base[key])(model, context, options)) as typeof base[K];
  setProvider({
    ...base,
    getModels: () => models,
    stream: withOutputCap(byFamily("stream")),
    streamSimple: withOutputCap(byFamily("streamSimple")),
  });
}
