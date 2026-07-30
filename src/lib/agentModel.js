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
import { getChatProvider, onChatProviderChange, useChatProvider, DEFAULT_CHAT_PROVIDER } from "./chatProvider";

// The chat models. `spec` is the full flue specifier sent as the x-flue-model
// header; `id` is the short handle persisted in localStorage; `group` is the
// Settings › Chat provider this model belongs to (lib/chatProvider.js) — the
// picker only shows the active group. The Cloudflare Workers AI models
// (`cloudflare/@cf/…`) need no external key and auto-route through CF AI Gateway;
// the Cerebras models (`cerebras/…`) need CEREBRAS_API_KEY (+ CEREBRAS_GATEWAY_URL
// for the gateway). Keep in lockstep with flue-agent/src/lib/models.ts + mobile
// agent-model.ts.
//
// The Claude (`anthropic/…`) entries were REMOVED: their specifiers don't resolve
// in the agent's model catalog, and offering an unresolvable model wedges the
// conversation that picks it — permanently, on "Thinking…". See the long note in
// flue-agent/src/lib/models.ts before adding any of them back.
export const AGENT_MODELS = [
  { id: "kimi-k2.6", spec: "cloudflare/@cf/moonshotai/kimi-k2.6", label: "Kimi K2.6", hint: "Default · economical", group: "cloudflare" },
  { id: "gpt-oss-120b", spec: "cloudflare/@cf/openai/gpt-oss-120b", label: "GPT-OSS 120B", hint: "Reasoning", group: "cloudflare" },
  { id: "glm-4.7-flash", spec: "cloudflare/@cf/zai-org/glm-4.7-flash", label: "GLM 4.7 Flash", hint: "Fast · 131k ctx", group: "cloudflare" },
  // Cerebras (Settings › Chat provider = Cerebras). Gemma is the default.
  { id: "cerebras-gemma-4-31b", spec: "cerebras/gemma-4-31b", label: "Gemma 4 31B", hint: "Default · 131k ctx · vision", group: "cerebras" },
  { id: "cerebras-glm-4.7", spec: "cerebras/zai-glm-4.7", label: "GLM 4.7", hint: "Z.AI · reasoning", group: "cerebras" },
  { id: "cerebras-gpt-oss-120b", spec: "cerebras/gpt-oss-120b", label: "GPT-OSS 120B", hint: "Reasoning · fast", group: "cerebras" },
];

// The default model per provider group is the FIRST entry tagged with it —
// Kimi for cloudflare, Gemma for cerebras. Switching provider snaps the
// selection to that group's default.
export function modelGroupOf(id) {
  return AGENT_MODELS.find((m) => m.id === id)?.group ?? DEFAULT_CHAT_PROVIDER;
}
export function defaultModelForProvider(providerId) {
  return (AGENT_MODELS.find((m) => m.group === providerId) ?? AGENT_MODELS[0]).id;
}

export const DEFAULT_AGENT_MODEL = defaultModelForProvider(DEFAULT_CHAT_PROVIDER);

const STORAGE_KEY = "shot-studio:agentModel";

function isKnown(id) {
  return AGENT_MODELS.some((m) => m.id === id);
}

let current = (() => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    const id = isKnown(v) ? v : DEFAULT_AGENT_MODEL;
    // Snap a persisted selection into the persisted provider's catalog so the
    // picker and the x-flue-model header always agree with Settings › Chat provider.
    return modelGroupOf(id) === getChatProvider() ? id : defaultModelForProvider(getChatProvider());
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

// Keep the selection inside the active provider's catalog: when Settings › Chat
// provider changes, snap to that provider's default unless the current model
// already belongs to it. setAgentModel persists + notifies, so the picker
// re-renders with the new catalog and the right selection highlighted.
onChatProviderChange(() => {
  const provider = getChatProvider();
  if (modelGroupOf(current) !== provider) setAgentModel(defaultModelForProvider(provider));
});

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
      // available model IN THE ACTIVE PROVIDER'S CATALOG (so the fallback never
      // crosses into another provider's group), then to any available model.
      if (!isModelAvailable(current)) {
        const provider = getChatProvider();
        const groupDefault = defaultModelForProvider(provider);
        const fallback = isModelAvailable(groupDefault)
          ? groupDefault
          : (AGENT_MODELS.find((m) => m.group === provider && isSpecAvailable(m.spec))?.id
            ?? AGENT_MODELS.find((m) => isSpecAvailable(m.spec))?.id
            ?? DEFAULT_AGENT_MODEL);
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

// React binding: the model list for the active Settings › Chat provider, further
// filtered by availability (a key-gated model stays hidden until /eve/health
// reports its key). Kicks off the one-shot provider probe on first use and
// re-renders when it resolves OR when the chat provider changes.
export function useAvailableAgentModels() {
  ensureProbe();
  const provider = useChatProvider();
  useSyncExternalStore(
    (cb) => {
      availListeners.add(cb);
      return () => availListeners.delete(cb);
    },
    () => providerAvailability,
    () => providerAvailability,
  );
  return AGENT_MODELS.filter((m) => m.group === provider && isSpecAvailable(m.spec));
}
