import { Fragment } from 'react';
import { Host } from '@expo/ui';
import { Button, Form, HStack, Image, Picker, Section, Spacer, Text, Toggle, VStack } from '@expo/ui/swift-ui';
import {
  background,
  buttonStyle,
  disabled,
  foregroundStyle,
  pickerStyle,
  scrollContentBackground,
  tag,
} from '@expo/ui/swift-ui/modifiers';
import { useColors } from '@/lib/colors';
import { ASPECTS, DEFAULT_MODEL, DEFAULT_MODEL_LABEL } from '@/lib/gen-defaults';
import type { ThemePref } from '@/lib/theme';
import {
  CHAT_PROVIDERS_FOOTNOTE,
  CONNECTORS_FOOTNOTE,
  GEN_DEFAULTS_FOOTNOTE,
  PROMPTS_FOOTNOTE,
  PROVIDERS_FOOTNOTE,
  SANDBOXES_FOOTNOTE,
  SEARCH_FOOTNOTE,
  type SettingsFormProps,
} from './settings-form.types';

// Appearance options, ordered System → Dark → Light (tags are the ThemePref).
const THEME_OPTIONS: { id: ThemePref; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
];

const SECONDARY = foregroundStyle({ type: 'hierarchical', style: 'secondary' } as const);
const TERTIARY = foregroundStyle({ type: 'hierarchical', style: 'tertiary' } as const);

// A disclosure row — label, optional right-aligned value, chevron. SwiftUI's
// NavigationLink look, driven by a plain Button because navigation is
// expo-router's job (it pushes within the settings stack). `buttonStyle('plain')`
// keeps the label the normal cell color instead of tint blue.
function LinkRow({ label, value, onPress }: { label: string; value?: string; onPress: () => void }) {
  return (
    <Button onPress={onPress} modifiers={[buttonStyle('plain')]}>
      <HStack spacing={6}>
        <Text>{label}</Text>
        <Spacer />
        {value ? <Text modifiers={[SECONDARY]}>{value}</Text> : null}
        <Image systemName="chevron.right" size={12} modifiers={[TERTIARY]} />
      </HStack>
    </Button>
  );
}

// Native SwiftUI settings (iOS): one grouped Form for the whole sheet — account,
// appearance, the agent's chat provider / model / web search / sandbox, the
// render providers, the project's image-generation defaults, the prompt editors,
// and sign-out. Device settings write straight to their store; the project ones
// (generation defaults) save on change — no Save button, the native idiom. Text
// too long for a Form cell (the prompts) lives behind a LinkRow that pushes an
// editor screen. iOS-only imports live here (.ios.tsx); settings-form.tsx is the
// cross-platform fallback.
export default function SettingsForm({
  name,
  email,
  themePref,
  onThemeChange,
  models,
  modelId,
  onModelChange,
  chatProviders,
  onToggleChatProvider,
  providers,
  showConnectors,
  higgsfieldLinked,
  connectorBusy,
  onConnectHiggsfield,
  onDisconnectHiggsfield,
  switchNonce,
  onToggleProvider,
  onManageKey,
  searchProviders,
  onToggleSearchProvider,
  onManageSearchKey,
  sandboxes,
  onToggleSandbox,
  imageModels,
  imageModelTag,
  onImageModelChange,
  aspectRatio,
  onAspectRatioChange,
  promptLinks,
  onOpenPrompt,
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
            {email && email !== name ? <Text modifiers={[SECONDARY]}>{email}</Text> : null}
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

        <Section title="Chat provider" footer={<Text>{CHAT_PROVIDERS_FOOTNOTE}</Text>}>
          {chatProviders.map((cp) => (
            <Toggle
              key={`${cp.id}-${switchNonce}`}
              isOn={cp.isOn}
              onIsOnChange={(on) => onToggleChatProvider(cp.id, on)}
              modifiers={[disabled(!cp.available)]}
            >
              <Text>{cp.label}</Text>
              <Text>{cp.subtitle}</Text>
            </Toggle>
          ))}
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

        <Section title="Web search" footer={<Text>{SEARCH_FOOTNOTE}</Text>}>
          {searchProviders.map((sp) => (
            <Fragment key={`${sp.id}-${switchNonce}`}>
              <Toggle isOn={sp.isOn} onIsOnChange={(on) => onToggleSearchProvider(sp.id, on)}>
                <Text>{sp.label}</Text>
                <Text>{sp.subtitle}</Text>
              </Toggle>
              <Button
                label={sp.hasKey ? `Manage ${sp.label} key…` : `Add ${sp.label} key…`}
                onPress={() => onManageSearchKey(sp.id)}
              />
            </Fragment>
          ))}
        </Section>

        <Section title="Sandbox providers" footer={<Text>{SANDBOXES_FOOTNOTE}</Text>}>
          {sandboxes.map((sb) => (
            <Toggle
              key={`${sb.id}-${switchNonce}`}
              isOn={sb.isOn}
              onIsOnChange={(on) => onToggleSandbox(sb.id, on)}
            >
              <Text>{sb.label}</Text>
              <Text>{sb.subtitle}</Text>
            </Toggle>
          ))}
        </Section>

        {showConnectors ? (
        <Section title="Connectors" footer={<Text>{CONNECTORS_FOOTNOTE}</Text>}>
          <HStack spacing={6}>
            <Text>Higgsfield</Text>
            <Spacer />
            <Text modifiers={[SECONDARY]}>
              {higgsfieldLinked === true
                ? 'Connected'
                : higgsfieldLinked === false
                  ? 'Not connected'
                  : higgsfieldLinked === 'error'
                    ? 'Status unknown'
                    : 'Checking…'}
            </Text>
          </HStack>
          {higgsfieldLinked === true ? (
            <Button
              role="destructive"
              label="Disconnect Higgsfield"
              onPress={onDisconnectHiggsfield}
              modifiers={[disabled(connectorBusy)]}
            />
          ) : (
            <Button
              label={connectorBusy ? 'Connecting…' : 'Connect Higgsfield…'}
              onPress={onConnectHiggsfield}
              modifiers={[disabled(connectorBusy || higgsfieldLinked === null)]}
            />
          )}
        </Section>
        ) : null}

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

        <Section title="Generation defaults" footer={<Text>{GEN_DEFAULTS_FOOTNOTE}</Text>}>
          <Picker
            label="Image model"
            selection={imageModelTag}
            onSelectionChange={(id) => onImageModelChange(String(id))}
            modifiers={[pickerStyle('menu')]}
          >
            <Text modifiers={[tag(DEFAULT_MODEL)]}>{DEFAULT_MODEL_LABEL}</Text>
            {imageModels.map((m) => (
              <Text key={m.id} modifiers={[tag(m.id)]}>
                {m.label}
              </Text>
            ))}
          </Picker>
          <Picker
            label="Aspect ratio"
            selection={aspectRatio}
            onSelectionChange={(id) => onAspectRatioChange(String(id))}
            modifiers={[pickerStyle('menu')]}
          >
            {ASPECTS.map((a) => (
              <Text key={a} modifiers={[tag(a)]}>
                {a}
              </Text>
            ))}
          </Picker>
        </Section>

        <Section title="Prompts" footer={<Text>{PROMPTS_FOOTNOTE}</Text>}>
          {promptLinks.map((l) => (
            <LinkRow key={l.key} label={l.label} value={l.value} onPress={() => onOpenPrompt(l.key)} />
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
