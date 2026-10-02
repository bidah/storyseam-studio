import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { HIDE_EXTRA_MODELS } from './model-flags';

// Chat AI provider selection — RN port of the web src/lib/chatProvider.js. Radio
// semantics like the render providers / sandbox: exactly ONE provider is in use
// at a time, and it decides which model catalog the chat model picker offers
// (lib/agent-model.ts filters by `group` and reconciles the selected model).
//
//   'cloudflare' — DEFAULT. Cloudflare Workers AI models (Kimi, GPT-OSS, GLM
//                  Flash) plus the Claude models. No external key for the CF ones.
//   'cerebras'   — Cerebras-hosted models (Gemma 4 31B, Z.AI GLM-4.7, GPT-OSS
//                  120B) via Cloudflare AI Gateway. Opt-in: needs CEREBRAS_API_KEY
//                  on the flue worker; selecting a cerebras model without it
//                  errors on send (same as Claude without a key).
//
// It rides NO header of its own: the SELECTED MODEL already names its provider in
// the specifier (`cerebras/…` vs `cloudflare/…`), which is what x-flue-model
// sends (fetch-shim.ts). This is purely a client-side catalog filter.

const STORAGE_KEY = 'shot-studio.chatProvider';

export const CHAT_PROVIDERS = [
  { id: 'cloudflare', label: 'Cloudflare Workers AI' },
  { id: 'cerebras', label: 'Cerebras' },
  { id: 'openrouter', label: 'OpenRouter' },
] as const;
export type ChatProviderId = (typeof CHAT_PROVIDERS)[number]['id'];
const IDS = CHAT_PROVIDERS.map((p) => p.id);

export const DEFAULT_CHAT_PROVIDER: ChatProviderId = 'cloudflare';

// Only Workers AI (GLM-5.3) while lib/model-flags.ts HIDE_EXTRA_MODELS is on;
// Settings hides the Chat provider section when this has one entry.
export const OFFERED_CHAT_PROVIDERS = HIDE_EXTRA_MODELS
  ? CHAT_PROVIDERS.filter((p) => p.id === DEFAULT_CHAT_PROVIDER)
  : CHAT_PROVIDERS;

function normalizeActive(raw: unknown): ChatProviderId {
  if (HIDE_EXTRA_MODELS) return DEFAULT_CHAT_PROVIDER;
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  return IDS.includes(o.active) ? o.active : DEFAULT_CHAT_PROVIDER;
}

type ChatProviderState = {
  active: ChatProviderId;
  hydrated: boolean;
  setActive: (id: ChatProviderId) => void;
};

export const useChatProviderStore = create<ChatProviderState>((set) => ({
  active: DEFAULT_CHAT_PROVIDER,
  hydrated: false,
  setActive: (id) => {
    if (!IDS.includes(id)) return;
    set({ active: id });
    SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify({ active: id })).catch(() => {});
  },
}));

// Sync read for the fetch shim / agent-model derivation.
export function getChatProvider(): ChatProviderId {
  return useChatProviderStore.getState().active;
}

export function hydrateChatProvider(): Promise<void> {
  return SecureStore.getItemAsync(STORAGE_KEY)
    .then((v) => {
      useChatProviderStore.setState({ active: normalizeActive(v ? JSON.parse(v) : null), hydrated: true });
    })
    .catch(() => {
      useChatProviderStore.setState({ hydrated: true });
    });
}
