import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Host, Picker, Switch } from '@expo/ui';
import {
  Cable,
  ChevronRight,
  Cpu,
  Globe,
  KeyRound,
  Palette,
  SlidersHorizontal,
  TerminalSquare,
  UserRound,
} from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { Card, Eyebrow } from '@/components/ui/card';
import { Segmented } from '@/components/ui/segmented';
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

const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
];

// A card whose first row is the section's explanatory footnote (the RN stand-in
// for a SwiftUI Section footer, which has no equivalent here).
function NoteCard({
  icon,
  note,
  children,
}: {
  icon: ReactNode;
  note: string;
  children: ReactNode;
}) {
  return (
    <Card className="gap-3">
      <View className="flex-row items-center gap-3">
        {icon}
        <Text className="flex-1 text-[12px] leading-4 text-muted-foreground">{note}</Text>
      </View>
      {children}
    </Card>
  );
}

// One radio-style row: label + subtitle + the native switch. `nonce` remounts
// the switch back to store state when a flip must not commit.
function ToggleRow({
  label,
  subtitle,
  isOn,
  nonce,
  disabled = false,
  onToggle,
  children,
}: {
  label: string;
  subtitle: string;
  isOn: boolean;
  nonce: number;
  disabled?: boolean;
  onToggle: (on: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <View
      className={`gap-2 rounded-xl border p-3 ${isOn ? 'border-primary/40' : 'border-border opacity-70'}`}
    >
      <View className="flex-row items-center gap-2">
        <View className="flex-1">
          <Text className="text-[14px] font-medium text-foreground">{label}</Text>
          <Text className="text-[12px] text-muted-foreground">{subtitle}</Text>
        </View>
        <View pointerEvents={disabled ? 'none' : 'auto'} className={disabled ? 'opacity-40' : ''}>
          <Host matchContents key={nonce}>
            <Switch value={isOn} onValueChange={onToggle} />
          </Host>
        </View>
      </View>
      {children}
    </View>
  );
}

function KeyLink({ hasKey, onPress }: { hasKey: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable className="flex-row items-center gap-1" onPress={onPress} accessibilityRole="button">
      <Text className="text-[12px] font-medium text-primary">{hasKey ? 'Manage key' : 'Add key'}</Text>
      <ChevronRight size={12} color={colors.primary} />
    </Pressable>
  );
}

// A disclosure row pushing an editor screen (the prompt editors).
function LinkRow({ label, value, onPress }: { label: string; value?: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      className="flex-row items-center gap-2 rounded-xl border border-border p-3"
      onPress={onPress}
      accessibilityRole="button"
    >
      <Text className="flex-1 text-[14px] font-medium text-foreground">{label}</Text>
      {value ? <Text className="text-[12px] text-muted-foreground">{value}</Text> : null}
      <ChevronRight size={14} color={colors.mutedForeground} />
    </Pressable>
  );
}

// Cross-platform fallback for the settings sheet (the .ios.tsx sibling renders
// one native SwiftUI Form). Same props, RN cards.
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
  const colors = useColors();
  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="grow gap-4 px-5 pt-6">
      <Eyebrow>Account</Eyebrow>
      <Card className="flex-row items-center gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-full bg-secondary">
          <UserRound size={18} color={colors.mutedForeground} />
        </View>
        <View className="flex-1">
          <Text className="text-[15px] font-semibold text-foreground" numberOfLines={1}>
            {name}
          </Text>
          {email && email !== name ? (
            <Text className="text-[13px] text-muted-foreground" numberOfLines={1}>
              {email}
            </Text>
          ) : null}
        </View>
      </Card>

      <Eyebrow className="mt-2">Appearance</Eyebrow>
      <Card className="gap-2">
        <Text className="text-[15px] text-foreground">Theme</Text>
        <Segmented value={themePref} onChange={onThemeChange} options={THEME_OPTIONS} />
      </Card>

      <Eyebrow className="mt-2">Chat provider</Eyebrow>
      <NoteCard icon={<Cpu size={18} color={colors.primary} />} note={CHAT_PROVIDERS_FOOTNOTE}>
        {chatProviders.map((cp) => (
          <ToggleRow
            key={cp.id}
            label={cp.label}
            subtitle={cp.subtitle}
            isOn={cp.isOn}
            nonce={switchNonce}
            disabled={!cp.available}
            onToggle={(on) => onToggleChatProvider(cp.id, on)}
          />
        ))}
      </NoteCard>

      <Eyebrow className="mt-2">Agent</Eyebrow>
      <Card className="gap-2">
        <Text className="text-[15px] text-foreground">Chat model</Text>
        <Host matchContents>
          <Picker selectedValue={modelId} onValueChange={(v) => onModelChange(String(v))} appearance="menu">
            {models.map((m) => (
              <Picker.Item key={m.id} label={m.label} value={m.id} />
            ))}
          </Picker>
        </Host>
      </Card>

      <Eyebrow className="mt-2">Web search</Eyebrow>
      <NoteCard icon={<Globe size={18} color={colors.primary} />} note={SEARCH_FOOTNOTE}>
        {searchProviders.map((sp) => (
          <ToggleRow
            key={sp.id}
            label={sp.label}
            subtitle={sp.subtitle}
            isOn={sp.isOn}
            nonce={switchNonce}
            onToggle={(on) => onToggleSearchProvider(sp.id, on)}
          >
            <KeyLink hasKey={sp.hasKey} onPress={() => onManageSearchKey(sp.id)} />
          </ToggleRow>
        ))}
      </NoteCard>

      <Eyebrow className="mt-2">Sandbox providers</Eyebrow>
      <NoteCard icon={<TerminalSquare size={18} color={colors.primary} />} note={SANDBOXES_FOOTNOTE}>
        {sandboxes.map((sb) => (
          <ToggleRow
            key={sb.id}
            label={sb.label}
            subtitle={sb.subtitle}
            isOn={sb.isOn}
            nonce={switchNonce}
            onToggle={(on) => onToggleSandbox(sb.id, on)}
          />
        ))}
      </NoteCard>

      <Eyebrow className="mt-2">Connectors</Eyebrow>
      <NoteCard icon={<Cable size={18} color={colors.primary} />} note={CONNECTORS_FOOTNOTE}>
        <View className="gap-2 rounded-xl border border-border p-3">
          <View className="flex-row items-center gap-2">
            <Text className="flex-1 text-[14px] font-medium text-foreground">Higgsfield</Text>
            <Text className="text-[12px] text-muted-foreground">
              {higgsfieldLinked === true
                ? 'Connected'
                : higgsfieldLinked === false
                  ? 'Not connected'
                  : higgsfieldLinked === 'error'
                    ? 'Status unknown'
                    : 'Checking…'}
            </Text>
          </View>
          {higgsfieldLinked === true ? (
            <Button
              variant="outline"
              title="Disconnect Higgsfield"
              loading={connectorBusy}
              onPress={onDisconnectHiggsfield}
            />
          ) : (
            <Button
              title="Connect Higgsfield"
              loading={connectorBusy}
              disabled={higgsfieldLinked === null}
              onPress={onConnectHiggsfield}
            />
          )}
        </View>
      </NoteCard>

      <Eyebrow className="mt-2">Render providers</Eyebrow>
      <NoteCard icon={<KeyRound size={18} color={colors.primary} />} note={PROVIDERS_FOOTNOTE}>
        {providers.map((p) => (
          <ToggleRow
            key={p.id}
            label={p.label}
            subtitle={p.subtitle}
            isOn={p.isOn}
            nonce={switchNonce}
            onToggle={(on) => onToggleProvider(p.id, on)}
          >
            {p.byok ? <KeyLink hasKey={p.hasKey} onPress={() => onManageKey(p.id)} /> : null}
          </ToggleRow>
        ))}
      </NoteCard>

      <Eyebrow className="mt-2">Generation defaults</Eyebrow>
      <NoteCard
        icon={<SlidersHorizontal size={18} color={colors.primary} />}
        note={GEN_DEFAULTS_FOOTNOTE}
      >
        <View className="gap-1">
          <Text className="text-[13px] text-foreground">Image model</Text>
          <Host matchContents>
            <Picker
              selectedValue={imageModelTag}
              onValueChange={(v) => onImageModelChange(String(v))}
              appearance="menu"
            >
              <Picker.Item label={DEFAULT_MODEL_LABEL} value={DEFAULT_MODEL} />
              {imageModels.map((m) => (
                <Picker.Item key={m.id} label={m.label} value={m.id} />
              ))}
            </Picker>
          </Host>
        </View>
        <View className="gap-1">
          <Text className="text-[13px] text-foreground">Aspect ratio</Text>
          <Host matchContents>
            <Picker
              selectedValue={aspectRatio}
              onValueChange={(v) => onAspectRatioChange(String(v))}
              appearance="menu"
            >
              {ASPECTS.map((a) => (
                <Picker.Item key={a} label={a} value={a} />
              ))}
            </Picker>
          </Host>
        </View>
      </NoteCard>

      <Eyebrow className="mt-2">Prompts</Eyebrow>
      <NoteCard icon={<Palette size={18} color={colors.primary} />} note={PROMPTS_FOOTNOTE}>
        {promptLinks.map((l) => (
          <LinkRow key={l.key} label={l.label} value={l.value} onPress={() => onOpenPrompt(l.key)} />
        ))}
      </NoteCard>

      <View className="mt-auto gap-3 pb-10">
        <Text className="text-center text-xs text-muted-foreground">{apiOrigin}</Text>
        <Button variant="destructive" title="Sign out" onPress={onSignOut} />
      </View>
    </ScrollView>
  );
}
