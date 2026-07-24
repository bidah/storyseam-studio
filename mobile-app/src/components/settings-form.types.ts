import type { ProviderId } from '@/lib/providers';
import type { ThemePref } from '@/lib/theme';

// Shared contract between the settings route (owns state + navigation) and
// the two SettingsForm implementations (.ios.tsx native SwiftUI Form, .tsx
// RN fallback).
export type SettingsFormProps = {
  name: string;
  email: string;
  themePref: ThemePref;
  onThemeChange: (pref: ThemePref) => void;
  models: readonly { id: string; label: string }[];
  modelId: string;
  onModelChange: (id: string) => void;
  providers: {
    id: ProviderId;
    label: string;
    subtitle: string;
    isOn: boolean;
    byok: boolean;
    hasKey: boolean;
  }[];
  // Native toggles flip optimistically; bumping this remounts them back to
  // store state when a flip must not commit (keyless on / active off).
  switchNonce: number;
  onToggleProvider: (id: ProviderId, on: boolean) => void;
  onManageKey: (id: ProviderId) => void;
  apiOrigin: string;
  onSignOut: () => void;
};

export const PROVIDERS_FOOTNOTE =
  'Renders bill your accounts. Keys are stored only on this device (secure keychain) and ' +
  'sent per-request — never on our servers. One provider is in use at a time: switching ' +
  'one on switches the others off. Jobs already running on another provider still finish.';
