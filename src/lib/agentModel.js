// The chat agent's model picker.
//
// The selected model id is persisted in localStorage and injected into every
// /eve request as the `x-eve-model` header by the fetch shim
// (src/lib/projectFetch.js). The agent reads that header per turn and maps the
// id to a Vercel AI Gateway model (agent/lib/model.ts → CHAT_MODELS). Sonnet is
// the default; the picker can switch the chat to Opus 4.6 or Fable 5.
//
// Keep this list's ids in sync with CHAT_MODELS in agent/lib/model.ts.
import { useSyncExternalStore } from "react";

export const AGENT_MODELS = [
  { id: "claude-sonnet-5", label: "Sonnet 5", hint: "Fast · default" },
  { id: "claude-opus-4.6", label: "Opus 4.6", hint: "Most capable" },
  { id: "claude-fable-5", label: "Fable 5", hint: "Creative" },
];

export const DEFAULT_AGENT_MODEL = AGENT_MODELS[0].id;

const STORAGE_KEY = "shot-studio:agentModel";

function isKnown(id) {
  return AGENT_MODELS.some((m) => m.id === id);
}

let current = (() => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isKnown(v) ? v : DEFAULT_AGENT_MODEL;
  } catch {
    return DEFAULT_AGENT_MODEL;
  }
})();

const listeners = new Set();

export function getAgentModel() {
  return current;
}

export function setAgentModel(id) {
  if (!isKnown(id) || id === current) return;
  current = id;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
  for (const fn of listeners) {
    try {
      fn(id);
    } catch {
      /* ignore */
    }
  }
}

// subscribe(cb) → unsubscribe. The callback is invoked on every change; its id
// argument is ignored by useSyncExternalStore (which re-reads via getSnapshot).
export function onAgentModelChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// React binding: re-renders the component whenever the selection changes.
export function useAgentModel() {
  return useSyncExternalStore(onAgentModelChange, getAgentModel, getAgentModel);
}
