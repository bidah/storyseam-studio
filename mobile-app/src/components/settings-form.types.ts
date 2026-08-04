import type { ChatProviderId } from '@/lib/chat-provider';
import type { ProviderId } from '@/lib/providers';
import type { SandboxModeId } from '@/lib/sandbox-mode';
import type { SearchProviderId } from '@/lib/search-provider';
import type { ThemePref } from '@/lib/theme';

// Shared contract between the settings route (owns state + navigation) and
// the two SettingsForm implementations (.ios.tsx native SwiftUI Form, .tsx
// RN fallback).

// A row that pushes an editor screen within the settings stack — the native way
// to hold text too long for a Form cell (the prompt editors).
export type SettingsLink = {
  key: string;
  label: string;
  // Right-aligned secondary text: a count, or a one-line preview.
  value?: string;
};

export type SettingsFormProps = {
  name: string;
  email: string;
  themePref: ThemePref;
  onThemeChange: (pref: ThemePref) => void;
  models: readonly { id: string; label: string }[];
  modelId: string;
  onModelChange: (id: string) => void;
  // Which model catalog the picker above offers. Radio semantics — one at a
  // time; switching snaps the selected model into that provider's catalog. It
  // shares `switchNonce` with the render/sandbox toggles so flipping the active
  // one OFF (not a valid state) remounts it back on. `available` is false while
  // the flue worker reports no key for a key-gated provider (/eve/health).
  chatProviders: {
    id: ChatProviderId;
    label: string;
    subtitle: string;
    isOn: boolean;
    available: boolean;
  }[];
  onToggleChatProvider: (id: ChatProviderId, on: boolean) => void;
  providers: {
    id: ProviderId;
    label: string;
    subtitle: string;
    isOn: boolean;
    byok: boolean;
    hasKey: boolean;
  }[];
  // Connectors: external accounts LINKED to the signed-in (Google) user — only
  // Higgsfield today. null while the linked-account list is loading, 'error'
  // when it couldn't be fetched (lib/higgsfield-account.ts).
  higgsfieldLinked: boolean | null | 'error';
  connectorBusy: boolean;
  onConnectHiggsfield: () => void;
  onDisconnectHiggsfield: () => void;
  // Native toggles flip optimistically; bumping this remounts them back to
  // store state when a flip must not commit (keyless on / active off).
  switchNonce: number;
  onToggleProvider: (id: ProviderId, on: boolean) => void;
  onManageKey: (id: ProviderId) => void;
  // Where the agent reaches the open web. Radio semantics again, but a key is
  // OPTIONAL on every row — the flue worker carries operator keys, so a backend
  // can work with no key of yours at all.
  searchProviders: {
    id: SearchProviderId;
    label: string;
    subtitle: string;
    isOn: boolean;
    hasKey: boolean;
  }[];
  onToggleSearchProvider: (id: SearchProviderId, on: boolean) => void;
  onManageSearchKey: (id: SearchProviderId) => void;
  // Where the agent's bash / skills run. Same radio semantics as the render
  // providers, and it shares `switchNonce` for the same reason (flipping the
  // active one off must not commit).
  sandboxes: {
    id: SandboxModeId;
    label: string;
    subtitle: string;
    isOn: boolean;
  }[];
  onToggleSandbox: (id: SandboxModeId, on: boolean) => void;
  // Project-wide image-generation defaults (the visual-world doc). Unlike the
  // device settings above these are SERVER state, so the pickers save on change
  // — no Save button, which is the native settings idiom.
  imageModels: { id: string; label: string }[];
  imageModelTag: string;
  onImageModelChange: (tag: string) => void;
  aspectRatio: string;
  onAspectRatioChange: (ratio: string) => void;
  // Rows pushing the prompt editors (style presets + the three sheet prompts).
  promptLinks: SettingsLink[];
  onOpenPrompt: (key: string) => void;
  apiOrigin: string;
  onSignOut: () => void;
};

export const SANDBOXES_FOOTNOTE =
  'Where the agent runs shell commands and multi-step skills. In-memory resets between ' +
  'messages — files the agent writes in one reply are gone by the next. A container keeps ' +
  'its files for the whole conversation and is billed per conversation. One is in use at a ' +
  'time: switching one on switches the other off.';

export const CHAT_PROVIDERS_FOOTNOTE =
  'Which models the chat picker offers. One provider is in use at a time; switching snaps the ' +
  'picker and the next message to that provider. Cerebras serves Gemma, GLM and GPT-OSS through ' +
  "Cloudflare AI Gateway and needs a Cerebras key on the agent worker.";

export const CONNECTORS_FOOTNOTE =
  'External accounts linked to your sign-in. Connecting Higgsfield runs a one-tap OAuth flow ' +
  'and lets Shot Studio render images, video & audio on your Higgsfield account — and browse ' +
  'your past generations in the library. Disconnecting stops Higgsfield renders until you ' +
  'reconnect.';

export const PROVIDERS_FOOTNOTE =
  'Renders bill your accounts. Keys are stored only on this device (secure keychain) and ' +
  'sent per-request — never on our servers. One provider is in use at a time: switching ' +
  'one on switches the others off. Jobs already running on another provider still finish.';

export const SEARCH_FOOTNOTE =
  'How the agent reaches the open web — research, fact-checking, and reading links you paste. ' +
  'One provider is in use at a time, and the agent’s tools are named the same either way, so ' +
  'switching changes nothing else. Your own key is optional and takes precedence when set; ' +
  'keys stay on this device.';

export const GEN_DEFAULTS_FOOTNOTE =
  'The image model and aspect ratio used by default — by the World composer and by the agent ' +
  'whenever it generates images (concept art, character sheets, location sheets), unless a ' +
  'generation overrides them. Saved to the project, so it applies wherever you sign in.';

export const PROMPTS_FOOTNOTE =
  'Project-wide prompts for image generation: the style presets prepended to every generation ' +
  'as the house look, and the sheet prompts layered on top when a generation is tagged as a ' +
  'character, location, or prop sheet.';
