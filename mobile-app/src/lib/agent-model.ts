import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

// The chat agent's model picker (port of the web src/lib/agentModel.js).
// The selected id rides every /eve request as the x-flue-model header (fetch
// shim); the Worker's /eve proxy forwards it into the flue agent, which maps it
// to a Vercel AI Gateway model per turn.
// Keep ids in sync with the flue agent's chat-model map.

export const AGENT_MODELS = [
  { id: 'claude-sonnet-5', label: 'Sonnet 5', hint: 'Fast · default' },
  { id: 'claude-opus-4.6', label: 'Opus 4.6', hint: 'Most capable' },
  { id: 'claude-fable-5', label: 'Fable 5', hint: 'Creative' },
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

export function hydrateAgentModel() {
  AsyncStorage.getItem(STORAGE_KEY)
    .then((v) => {
      if (isKnown(v)) useAgentModelStore.setState({ model: v });
    })
    .catch(() => {});
}
