import { Fragment } from 'react';
import { Host } from '@expo/ui';
import { Button, Form, HStack, Picker, Section, Spacer, Text, Toggle, VStack } from '@expo/ui/swift-ui';
import { background, foregroundStyle, pickerStyle, scrollContentBackground, tag } from '@expo/ui/swift-ui/modifiers';
import { PROVIDERS_FOOTNOTE, type SettingsFormProps } from './settings-form.types';

// The app's near-black page background (parity with the web app + the RN nav
// theme). SwiftUI Forms default to systemGroupedBackground (dark gray), so we
// hide that and paint this behind the grouped cells to match every other screen.
const PAGE_BG = '#0a0a0b';

// Native SwiftUI settings (iOS): one grouped Form for the whole sheet —
// account, chat-model menu picker, provider toggles, sign-out. iOS-only
// imports live here (.ios.tsx); settings-form.tsx is the fallback.
export default function SettingsForm({
  name,
  email,
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
  return (
    <Host style={{ flex: 1 }}>
      <Form modifiers={[scrollContentBackground('hidden'), background(PAGE_BG)]}>
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
