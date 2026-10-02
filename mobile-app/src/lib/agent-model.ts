import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { HIDE_EXTRA_MODELS } from './model-flags';
import {
  DEFAULT_CHAT_PROVIDER,
  getChatProvider,
  useChatProviderStore,
  type ChatProviderId,
} from './chat-provider';

// The chat agent's model picker (port of the web src/lib/agentModel.js).
// The selected model's full specifier (`spec`) rides every /eve request as the
// x-flue-model header (fetch shim); the Worker's /eve proxy forwards it and the
// flue agent persists it per conversation. `group` is the Settings › Chat
// provider (lib/chat-provider.ts) the model belongs to — the picker only shows
// the active group. Cloudflare Workers AI models (`cloudflare/@cf/…`) need no
// key; Cerebras (`cerebras/…`) needs CEREBRAS_API_KEY on the flue worker. Keep in
// lockstep with flue-agent/src/lib/models.ts + web src/lib/agentModel.js.
//
// The Claude (`anthropic/…`) entries were REMOVED: their specifiers don't resolve
// in the agent's model catalog, and offering an unresolvable model wedges the
// conversation that picks it — permanently, on "Thinking…". See the long note in
// flue-agent/src/lib/models.ts before adding any of them back.

export const AGENT_MODELS = [
  { id: 'glm-5.3', spec: 'cloudflare/@cf/zai-org/glm-5.3', label: 'GLM-5.3', hint: 'Default · reasoning · 1M ctx', group: 'cloudflare' },
  { id: 'qwen-3.8', spec: 'cloudflare/@cf/qwen/qwen3.8-27b', label: 'Qwen 3.8', hint: 'Reasoning · fast', group: 'cloudflare' },
  { id: 'kimi-k2.6', spec: 'cloudflare/@cf/moonshotai/kimi-k2.6', label: 'Kimi K2.6', hint: 'Economical', group: 'cloudflare' },
  // Cerebras (Settings › Chat provider = Cerebras). Gemma is the default.
  { id: 'cerebras-gemma-4-31b', spec: 'cerebras/gemma-4-31b', label: 'Gemma 4 31B', hint: 'Default · 131k ctx · vision', group: 'cerebras' },
  { id: 'cerebras-glm-4.7', spec: 'cerebras/zai-glm-4.7', label: 'GLM 4.7', hint: 'Z.AI · reasoning', group: 'cerebras' },
  { id: 'cerebras-gpt-oss-120b', spec: 'cerebras/gpt-oss-120b', label: 'GPT-OSS 120B', hint: 'Reasoning · fast', group: 'cerebras' },
  // OpenRouter (Settings › Chat provider = OpenRouter). Needs OPENROUTER_API_KEY
  // on the flue worker (+ OPENROUTER_GATEWAY_URL for the gateway).
  { id: 'deepseek-v4-pro-0813', spec: 'openrouter/deepseek/deepseek-v4-pro-0813', label: 'DeepSeek V4 Pro', hint: '0813 · 1M ctx · reasoning', group: 'openrouter' },
] as const;

export type AgentModelId = (typeof AGENT_MODELS)[number]['id'];

// The default model per provider group is the FIRST entry tagged with it — GLM-5.3
// for cloudflare, Gemma for cerebras. Switching provider snaps to that default.
export function modelGroupOf(id: string): ChatProviderId {
  return (AGENT_MODELS.find((m) => m.id === id)?.group as ChatProviderId) ?? DEFAULT_CHAT_PROVIDER;
}
export function defaultModelForProvider(providerId: ChatProviderId): AgentModelId {
  return (AGENT_MODELS.find((m) => m.group === providerId) ?? AGENT_MODELS[0]).id;
}
// lib/model-flags.ts HIDE_EXTRA_MODELS: the pickers offer only GLM-5.3, a stored
// pick of anything else isn't hydrated, and the header always names GLM-5.3.
export function modelsForProvider(providerId: ChatProviderId) {
  return AGENT_MODELS.filter(
    (m) => m.group === providerId && (!HIDE_EXTRA_MODELS || m.id === AGENT_MODELS[0].id),
  );
}

export const DEFAULT_AGENT_MODEL: AgentModelId = defaultModelForProvider(DEFAULT_CHAT_PROVIDER);

const STORAGE_KEY = 'shot-studio:agentModel';

function isKnown(id: string | null | undefined): id is AgentModelId {
  return AGENT_MODELS.some((m) => m.id === id);
}

type AgentModelState = {
  model: AgentModelId;
  setModel: (id: AgentModelId) => void;
};

export const useAgentModelStore = create<AgentModelState>((set) => ({
  model: DEFAULT_AGENT_MODEL,
  setModel: (id) => {
    if (!isKnown(id)) return;
    set({ model: id });
    AsyncStorage.setItem(STORAGE_KEY, id).catch(() => {});
  },
}));

export function getAgentModel(): AgentModelId {
  return useAgentModelStore.getState().model;
}

// The full flue specifier for the current selection (e.g.
// `cloudflare/@cf/moonshotai/kimi-k2.6`) — the value sent as `x-flue-model`.
// Derived against the active chat provider so the header always agrees with
// Settings › Chat provider even across a hydration race (falls back to that
// provider's default when the stored model belongs to another group).
export function getAgentModelSpecifier(): string {
  if (HIDE_EXTRA_MODELS) return AGENT_MODELS[0].spec;
  const provider = getChatProvider();
  const id = useAgentModelStore.getState().model;
  const m = AGENT_MODELS.find((x) => x.id === id);
  const eff = m && m.group === provider ? m : AGENT_MODELS.find((x) => x.group === provider) ?? AGENT_MODELS[0];
  return eff.spec;
}

export function hydrateAgentModel(): Promise<void> {
  return AsyncStorage.getItem(STORAGE_KEY)
    .then((v) => {
      if (isKnown(v) && !HIDE_EXTRA_MODELS) useAgentModelStore.setState({ model: v });
    })
    .catch(() => {});
}

// Keep the selection inside the active provider's catalog: when Settings › Chat
// provider changes (incl. its hydration), snap the model to that provider's
// default unless the current one already belongs to it. setModel persists +
// notifies, so both pickers re-render with the right selection highlighted.
useChatProviderStore.subscribe((s) => {
  const cur = useAgentModelStore.getState().model;
  if (modelGroupOf(cur) !== s.active) {
    useAgentModelStore.getState().setModel(defaultModelForProvider(s.active));
  }
});
