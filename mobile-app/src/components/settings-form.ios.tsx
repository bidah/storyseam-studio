import { Fragment } from 'react';
import { Host } from '@expo/ui';
import { Button, Form, HStack, Picker, Section, Spacer, Text, Toggle, VStack } from '@expo/ui/swift-ui';
import { background, foregroundStyle, pickerStyle, scrollContentBackground, tag } from '@expo/ui/swift-ui/modifiers';
import { useColors } from '@/lib/colors';
import type { ThemePref } from '@/lib/theme';
import { PROVIDERS_FOOTNOTE, type SettingsFormProps } from './settings-form.types';

// Appearance options, ordered System → Dark → Light (tags are the ThemePref).
const THEME_OPTIONS: { id: ThemePref; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
];

// Native SwiftUI settings (iOS): one grouped Form for the whole sheet —
// account, appearance, chat-model menu picker, provider toggles, sign-out.
// iOS-only imports live here (.ios.tsx); settings-form.tsx is the fallback.
export default function SettingsForm({
  name,
  email,
  themePref,
  onThemeChange,
  models,
  modelId,
  onModelChange,
  providers,
  switchNonce,
  onToggleProvider,
  onManageKey,
  apiOrigin,
  onSignOut,
}: SettingsFormProps) {
  // SwiftUI Forms default to systemGroupedBackground; hide it and paint our own
  // scheme-aware grouped background behind the cells. It must differ from the
  // native cell color (white in light, gray in dark) or the cards vanish — hence
  // `groupedBg`, not `pageBg` (which equals the white cell color in light mode).
  const colors = useColors();
  return (
    <Host style={{ flex: 1 }}>
      <Form modifiers={[scrollContentBackground('hidden'), background(colors.groupedBg)]}>
        <Section title="Account">
          <VStack alignment="leading" spacing={2}>
            <Text>{name}</Text>
            {email && email !== name ? (
              <Text modifiers={[foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>
                {email}
              </Text>
            ) : null}
          </VStack>
        </Section>

        <Section title="Appearance">
          <Picker
            label="Theme"
            selection={themePref}
            onSelectionChange={(id) => onThemeChange((id as ThemePref) ?? 'system')}
            modifiers={[pickerStyle('segmented')]}
          >
            {THEME_OPTIONS.map((o) => (
              <Text key={o.id} modifiers={[tag(o.id)]}>
                {o.label}
              </Text>
            ))}
          </Picker>
        </Section>

        <Section title="Agent">
          <Picker
            label="Chat model"
            selection={modelId}
            onSelectionChange={(id) => onModelChange(String(id))}
            modifiers={[pickerStyle('menu')]}
          >
            {models.map((m) => (
              <Text key={m.id} modifiers={[tag(m.id)]}>
                {m.label}
              </Text>
            ))}
          </Picker>
        </Section>

        <Section title="Render providers" footer={<Text>{PROVIDERS_FOOTNOTE}</Text>}>
          {providers.map((p) => (
            <Fragment key={`${p.id}-${switchNonce}`}>
              <Toggle isOn={p.isOn} onIsOnChange={(on) => onToggleProvider(p.id, on)}>
                <Text>{p.label}</Text>
                <Text>{p.subtitle}</Text>
              </Toggle>
              {p.byok ? (
                <Button
                  label={p.hasKey ? `Manage ${p.label} key…` : `Add ${p.label} key…`}
                  onPress={() => onManageKey(p.id)}
                />
              ) : null}
            </Fragment>
          ))}
        </Section>

        <Section footer={<Text>{apiOrigin}</Text>}>
          <HStack>
            <Spacer />
            <Button role="destructive" label="Sign out" onPress={onSignOut} />
            <Spacer />
          </HStack>
        </Section>
      </Form>
    </Host>
  );
}
