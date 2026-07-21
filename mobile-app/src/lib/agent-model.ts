import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

// The chat agent's model picker (port of the web src/lib/agentModel.js).
// The selected model's full specifier (`spec`) rides every /eve request as the
// x-flue-model header (fetch shim); the Worker's /eve proxy forwards it and the
// flue agent persists it per conversation. Cloudflare Workers AI models
// (`cloudflare/@cf/…`) need no key; Claude (`anthropic/…`) needs ANTHROPIC_API_KEY
// on the flue worker. Keep in lockstep with flue-agent/src/lib/models.ts + web.

export const AGENT_MODELS = [
  { id: 'kimi-k2.6', spec: 'cloudflare/@cf/moonshotai/kimi-k2.6', label: 'Kimi K2.6', hint: 'Default · economical' },
  { id: 'gpt-oss-120b', spec: 'cloudflare/@cf/openai/gpt-oss-120b', label: 'GPT-OSS 120B', hint: 'Reasoning' },
  { id: 'glm-4.7-flash', spec: 'cloudflare/@cf/zai-org/glm-4.7-flash', label: 'GLM 4.7 Flash', hint: 'Fast · 131k ctx' },
  { id: 'claude-sonnet-5', spec: 'anthropic/claude-sonnet-5', label: 'Sonnet 5', hint: 'Claude · needs key' },
  { id: 'claude-opus-4.6', spec: 'anthropic/claude-opus-4.6', label: 'Opus 4.6', hint: 'Claude · most capable' },
  { id: 'claude-fable-5', spec: 'anthropic/claude-fable-5', label: 'Fable 5', hint: 'Claude · creative' },
] as const;

export type AgentModelId = (typeof AGENT_MODELS)[number]['id'];

export const DEFAULT_AGENT_MODEL: AgentModelId = AGENT_MODELS[0].id;

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
export function getAgentModelSpecifier(): string {
  const id = useAgentModelStore.getState().model;
  const m = AGENT_MODELS.find((x) => x.id === id);
  return (m ?? AGENT_MODELS[0]).spec;
}

export function hydrateAgentModel() {
  AsyncStorage.getItem(STORAGE_KEY)
    .then((v) => {
      if (isKnown(v)) useAgentModelStore.setState({ model: v });
    })
    .catch(() => {});
}
