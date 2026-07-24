import { Pressable, ScrollView, Text, View } from 'react-native';
import { Host, Picker, Switch } from '@expo/ui';
import { ChevronRight, KeyRound, UserRound } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { Card, Eyebrow } from '@/components/ui/card';
import { PROVIDERS_FOOTNOTE, type SettingsFormProps } from './settings-form.types';

// Cross-platform fallback for the settings sheet (the .ios.tsx sibling
// renders one native SwiftUI Form). Same props, RN cards.
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
    <ScrollView className="flex-1 bg-background" contentContainerClassName="grow gap-4 px-5 pt-6">
      <Eyebrow>Account</Eyebrow>
      <Card className="flex-row items-center gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-full bg-secondary">
          <UserRound size={18} color="#a1a1aa" />
        </View>
        <View className="flex-1">
          <Text className="text-[15px] font-semibold text-foreground" numberOfLines={1}>
            {name}
          </Text>
          <Text className="text-[13px] text-muted-foreground" numberOfLines={1}>
            {email}
          </Text>
        </View>
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
          <KeyRound size={18} color="#10b981" />
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
                <ChevronRight size={12} color="#10b981" />
              </Pressable>
            ) : null}
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
