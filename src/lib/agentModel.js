// The chat agent's model picker.
//
// Per-turn model selection (flue). flue's client can only send `{ message,
// images }`, so the choice rides the `x-flue-model` header instead: the
// projectFetch shim stamps it on every `/eve/*` request (see projectFetch.js),
// the worker proxy forwards it, and the flue app persists it to the
// conversation's Durable Object before admitting the prompt — so each turn runs
// on the selected model with unified history. (Under eve this rode along as the
// `x-eve-model` header the same way.)
import { useSyncExternalStore } from "react";

// Option ids are the anthropic model ids; the flue specifier is `anthropic/<id>`
// (see getAgentModelSpecifier). Keep in lockstep with flue-agent/src/lib/models.ts.
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

// The full flue model specifier for the current selection, e.g.
// `anthropic/claude-sonnet-5` — the value sent as the `x-flue-model` header.
export function getAgentModelSpecifier() {
  return `anthropic/${current}`;
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
