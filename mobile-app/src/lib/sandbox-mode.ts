import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

// Sandbox-provider selection — RN port of the web src/lib/sandboxMode.js. Same
// radio semantics as the render providers (lib/providers.ts): exactly ONE
// backend is in use at a time, and switching one on switches the other off.
//
//   'memory'  — flue's built-in virtual filesystem. DEFAULT. Rebuilt EMPTY on
//               every turn, so the agent can't write a file in one message and
//               read it in the next. Free and instant.
//   'daytona' — a real Linux container whose files last the whole conversation.
//               Opt-in: billed per conversation, and the first message waits on
//               a container cold-start.
//
// The fetch shim sends the selection on `/eve/*` sends as `x-flue-sandbox`; the
// flue worker persists it into the conversation's Durable Object
// (flue-agent/src/lib/sandbox-prefs.ts) and the agent initializer decides per
// turn whether to attach a container. Agent-only — no `/api/*` route reads it.

const STORAGE_KEY = 'shot-studio.sandboxMode';

export const SANDBOXES = [
  { id: 'memory', label: 'In-memory sandbox' },
  { id: 'daytona', label: 'Daytona container' },
] as const;
export type SandboxModeId = (typeof SANDBOXES)[number]['id'];
const IDS = SANDBOXES.map((s) => s.id);

export const DEFAULT_SANDBOX_MODE: SandboxModeId = 'memory';

function normalizeActive(raw: unknown): SandboxModeId {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  return IDS.includes(o.active) ? o.active : DEFAULT_SANDBOX_MODE;
}

type SandboxState = {
  active: SandboxModeId;
  hydrated: boolean;
  setActive: (id: SandboxModeId) => void;
};

export const useSandboxStore = create<SandboxState>((set) => ({
  active: DEFAULT_SANDBOX_MODE,
  hydrated: false,
  setActive: (id) => {
    if (!IDS.includes(id)) return;
    set({ active: id });
    SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify({ active: id })).catch(() => {});
  },
}));

// Sync read for the fetch shim.
export function getSandboxMode(): SandboxModeId {
  return useSandboxStore.getState().active;
}

export function hydrateSandboxMode(): Promise<void> {
  return SecureStore.getItemAsync(STORAGE_KEY)
    .then((v) => {
      useSandboxStore.setState({ active: normalizeActive(v ? JSON.parse(v) : null), hydrated: true });
    })
    .catch(() => {
      useSandboxStore.setState({ hydrated: true });
    });
}
