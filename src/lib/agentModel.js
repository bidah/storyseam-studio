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

// The chat models. `spec` is the full flue specifier sent as the x-flue-model
// header; `id` is the short handle persisted in localStorage. The Cloudflare
// Workers AI models (`cloudflare/@cf/…`) need no external key and auto-route
// through CF AI Gateway; the Claude models (`anthropic/…`) need ANTHROPIC_API_KEY
// on the flue worker (and ANTHROPIC_GATEWAY_URL to also route via CF AI Gateway).
// Keep in lockstep with flue-agent/src/lib/models.ts + mobile agent-model.ts.
export const AGENT_MODELS = [
  { id: "kimi-k2.6", spec: "cloudflare/@cf/moonshotai/kimi-k2.6", label: "Kimi K2.6", hint: "Default · economical" },
  { id: "gpt-oss-120b", spec: "cloudflare/@cf/openai/gpt-oss-120b", label: "GPT-OSS 120B", hint: "Reasoning" },
  { id: "glm-4.7-flash", spec: "cloudflare/@cf/zai-org/glm-4.7-flash", label: "GLM 4.7 Flash", hint: "Fast · 131k ctx" },
  { id: "claude-sonnet-5", spec: "anthropic/claude-sonnet-5", label: "Sonnet 5", hint: "Claude · needs key" },
  { id: "claude-opus-4.6", spec: "anthropic/claude-opus-4.6", label: "Opus 4.6", hint: "Claude · most capable" },
  { id: "claude-fable-5", spec: "anthropic/claude-fable-5", label: "Fable 5", hint: "Claude · creative" },
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

// The full flue model specifier for the current selection (e.g.
// `cloudflare/@cf/moonshotai/kimi-k2.6`) — the value sent as `x-flue-model`.
export function getAgentModelSpecifier() {
  const m = AGENT_MODELS.find((m) => m.id === current);
  return (m ?? AGENT_MODELS[0]).spec;
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

// --- provider availability -------------------------------------------------
// Key-gated model providers (anything that isn't Cloudflare Workers AI) only
// work when the flue worker holds the matching key — and the SPA can't read
// worker secrets. So probe the flue worker's /health (proxied at /eve/health, no
// auth) once; it reports `providers: { anthropic: bool, … }`. Keyless providers
// (`cloudflare/…`) are always available. Until the probe resolves, key-gated
// providers stay hidden, so we never offer a model that would just error on send.
const KEYLESS_PROVIDERS = new Set(["cloudflare"]);

function providerOf(spec) {
  return String(spec).split("/")[0];
}

let providerAvailability = null; // null until probed; then { anthropic: bool, … }
const availListeners = new Set();

function isSpecAvailable(spec) {
  if (KEYLESS_PROVIDERS.has(providerOf(spec))) return true;
  if (!providerAvailability) return false; // unprobed → hide key-gated
  return Boolean(providerAvailability[providerOf(spec)]);
}

function isModelAvailable(id) {
  const m = AGENT_MODELS.find((x) => x.id === id);
  return m ? isSpecAvailable(m.spec) : false;
}

let probeStarted = false;
function ensureProbe() {
  if (probeStarted) return;
  probeStarted = true;
  fetch("/eve/health", { headers: { accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((data) => {
      providerAvailability =
        data && typeof data.providers === "object" && data.providers ? data.providers : {};
      // A persisted selection that's no longer available falls back to the first
      // available model (the keyless default is always available).
      if (!isModelAvailable(current)) {
        const fallback = isModelAvailable(DEFAULT_AGENT_MODEL)
          ? DEFAULT_AGENT_MODEL
          : (AGENT_MODELS.find((m) => isSpecAvailable(m.spec))?.id ?? DEFAULT_AGENT_MODEL);
        setAgentModel(fallback);
      }
      for (const fn of availListeners) {
        try {
          fn();
        } catch {
          /* ignore */
        }
      }
    });
}

// React binding: the availability-filtered model list. Kicks off the one-shot
// provider probe on first use and re-renders when it resolves.
export function useAvailableAgentModels() {
  ensureProbe();
  useSyncExternalStore(
    (cb) => {
      availListeners.add(cb);
      return () => availListeners.delete(cb);
    },
    () => providerAvailability,
    () => providerAvailability,
  );
  return AGENT_MODELS.filter((m) => isSpecAvailable(m.spec));
}
