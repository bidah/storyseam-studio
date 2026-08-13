// Chat AI provider selection: which model catalog the chat model picker draws
// from. Radio semantics (exactly one selected), like lib/providers.js /
// lib/sandboxMode.js.
//
//   "cloudflare" — DEFAULT. The Cloudflare Workers AI models (Kimi, GPT-OSS,
//                  GLM Flash) plus the key-gated Claude models. Auto-routed
//                  through Cloudflare AI Gateway; no external key for the CF
//                  models.
//   "cerebras"   — Cerebras-hosted models (Gemma 4 31B, Z.AI GLM-4.7, GPT-OSS
//                  120B) served via Cloudflare AI Gateway. Opt-in: needs a
//                  CEREBRAS_API_KEY on the flue worker (Settings gates it behind
//                  the /eve/health probe).
//
// Client-side only — a UX filter over the model catalog. It rides NO header: the
// SELECTED MODEL already carries its provider in the specifier (`cerebras/…` vs
// `cloudflare/…`), which is what `x-flue-model` sends. Switching provider just
// changes which models the picker offers; lib/agentModel.js reconciles the
// selected model into the active provider's catalog.

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "shot-studio:chatProvider";

export const CHAT_PROVIDERS = [
  {
    id: "cloudflare",
    label: "Cloudflare Workers AI",
    blurb:
      "Kimi, GPT-OSS and GLM Flash, billed to the worker's Cloudflare account — no key needed. The default.",
  },
  {
    id: "cerebras",
    label: "Cerebras",
    blurb:
      "Gemma 4 31B, Z.AI GLM-4.7 and GPT-OSS 120B on Cerebras' ultra-fast inference, served through Cloudflare AI Gateway. Needs a Cerebras key configured on the worker.",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    blurb:
      "DeepSeek V4 Pro (0813) via OpenRouter, served through Cloudflare AI Gateway. Needs an OpenRouter key configured on the worker.",
  },
];
const IDS = CHAT_PROVIDERS.map((p) => p.id);

export const DEFAULT_CHAT_PROVIDER = "cloudflare";

function normalize(raw) {
  return IDS.includes(raw) ? raw : DEFAULT_CHAT_PROVIDER;
}

let current = (() => {
  try { return normalize(localStorage.getItem(STORAGE_KEY)); }
  catch { return DEFAULT_CHAT_PROVIDER; }
})();
const listeners = new Set();

export function getChatProvider() {
  return current;
}

export function setChatProvider(id) {
  if (!IDS.includes(id) || id === current) return;
  current = id;
  try { localStorage.setItem(STORAGE_KEY, id); } catch { /* private mode */ }
  for (const fn of listeners) { try { fn(id); } catch { /* ignore */ } }
}

// subscribe(cb) → unsubscribe. lib/agentModel.js uses this to reconcile the
// selected model when the provider changes; the Settings panel uses the hook.
export function onChatProviderChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Reactive read for the Settings panel + the composer's model picker.
export function useChatProvider() {
  return useSyncExternalStore(onChatProviderChange, getChatProvider, getChatProvider);
}
