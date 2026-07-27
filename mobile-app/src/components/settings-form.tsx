import { Pressable, ScrollView, Text, View } from 'react-native';
import { Host, Picker, Switch } from '@expo/ui';
import { ChevronRight, KeyRound, TerminalSquare, UserRound } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { Card, Eyebrow } from '@/components/ui/card';
import { Segmented } from '@/components/ui/segmented';
import { useColors } from '@/lib/colors';
import type { ThemePref } from '@/lib/theme';
import { PROVIDERS_FOOTNOTE, SANDBOXES_FOOTNOTE, type SettingsFormProps } from './settings-form.types';

const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
];

// Cross-platform fallback for the settings sheet (the .ios.tsx sibling
// renders one native SwiftUI Form). Same props, RN cards.
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
  sandboxes,
  onToggleSandbox,
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

      <Eyebrow className="mt-2">Agent</Eyebrow>
      <Card className="gap-2">
        <Text className="text-[15px] text-foreground">Chat model</Text>
        <Host matchContents>
          <Picker
            selectedValue={modelId}
            onValueChange={(v) => onModelChange(String(v))}
            appearance="menu"
          >
            {models.map((m) => (
              <Picker.Item key={m.id} label={m.label} value={m.id} />
            ))}
          </Picker>
        </Host>
      </Card>

      <Eyebrow className="mt-2">Render providers</Eyebrow>
      <Card className="gap-3">
        <View className="flex-row items-center gap-3">
          <KeyRound size={18} color={colors.primary} />
          <Text className="flex-1 text-[12px] leading-4 text-muted-foreground">{PROVIDERS_FOOTNOTE}</Text>
        </View>
        {providers.map((p) => (
          <View
            key={p.id}
            className={`gap-2 rounded-xl border p-3 ${p.isOn ? 'border-primary/40' : 'border-border opacity-70'}`}
          >
            <View className="flex-row items-center gap-2">
              <View className="flex-1">
                <Text className="text-[14px] font-medium text-foreground">{p.label}</Text>
                <Text className="text-[12px] text-muted-foreground">{p.subtitle}</Text>
              </View>
              <Host matchContents key={switchNonce}>
                <Switch value={p.isOn} onValueChange={(on) => onToggleProvider(p.id, on)} />
              </Host>
            </View>
            {p.byok ? (
              <Pressable
                className="flex-row items-center gap-1"
                onPress={() => onManageKey(p.id)}
                accessibilityRole="button"
              >
                <Text className="text-[12px] font-medium text-primary">
                  {p.hasKey ? 'Manage key' : 'Add key'}
                </Text>
                <ChevronRight size={12} color={colors.primary} />
              </Pressable>
            ) : null}
          </View>
        ))}
      </Card>

      <Eyebrow className="mt-2">Sandbox providers</Eyebrow>
      <Card className="gap-3">
        <View className="flex-row items-center gap-3">
          <TerminalSquare size={18} color={colors.primary} />
          <Text className="flex-1 text-[12px] leading-4 text-muted-foreground">{SANDBOXES_FOOTNOTE}</Text>
        </View>
        {sandboxes.map((sb) => (
          <View
            key={sb.id}
            className={`gap-2 rounded-xl border p-3 ${sb.isOn ? 'border-primary/40' : 'border-border opacity-70'}`}
          >
            <View className="flex-row items-center gap-2">
              <View className="flex-1">
                <Text className="text-[14px] font-medium text-foreground">{sb.label}</Text>
                <Text className="text-[12px] text-muted-foreground">{sb.subtitle}</Text>
              </View>
              <Host matchContents key={switchNonce}>
                <Switch value={sb.isOn} onValueChange={(on) => onToggleSandbox(sb.id, on)} />
              </Host>
            </View>
          </View>
        ))}
      </Card>

      <View className="mt-auto gap-3 pb-10">
        <Text className="text-center text-xs text-muted-foreground">{apiOrigin}</Text>
        <Button variant="destructive" title="Sign out" onPress={onSignOut} />
      </View>
    </ScrollView>
  );
}
