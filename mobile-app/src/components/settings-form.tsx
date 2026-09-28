import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
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
    <Card style={styles.noteCard}>
      <View style={styles.noteHeader}>
        {icon}
        <Text style={styles.noteText}>{note}</Text>
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
    <View style={[styles.toggleRow, isOn ? styles.toggleRowOn : styles.toggleRowOff]}>
      <View style={styles.rowGap2}>
        <View style={styles.flex1}>
          <Text style={styles.label14}>{label}</Text>
          <Text style={styles.subtitle12}>{subtitle}</Text>
        </View>
        <View pointerEvents={disabled ? 'none' : 'auto'} style={disabled ? styles.disabled : undefined}>
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
    <Pressable style={styles.rowGap1} onPress={onPress} accessibilityRole="button">
      <Text style={styles.keyLinkText}>{hasKey ? 'Manage key' : 'Add key'}</Text>
      <ChevronRight size={12} color={colors.primary} />
    </Pressable>
  );
}

// A disclosure row pushing an editor screen (the prompt editors).
function LinkRow({ label, value, onPress }: { label: string; value?: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      style={styles.linkRow}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Text style={styles.linkLabel}>{label}</Text>
      {value ? <Text style={styles.subtitle12}>{value}</Text> : null}
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
  const colors = useColors();
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <Eyebrow>Account</Eyebrow>
      <Card style={styles.accountCard}>
        <View style={styles.avatar}>
          <UserRound size={18} color={colors.mutedForeground} />
        </View>
        <View style={styles.flex1}>
          <Text style={styles.nameText} numberOfLines={1}>
            {name}
          </Text>
          {email && email !== name ? (
            <Text style={styles.emailText} numberOfLines={1}>
              {email}
            </Text>
          ) : null}
        </View>
      </Card>

      <Eyebrow style={styles.mt2}>Appearance</Eyebrow>
      <Card style={styles.gap2Card}>
        <Text style={styles.text15}>Theme</Text>
        <Segmented value={themePref} onChange={onThemeChange} options={THEME_OPTIONS} />
      </Card>

      <Eyebrow style={styles.mt2}>Chat provider</Eyebrow>
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

      <Eyebrow style={styles.mt2}>Agent</Eyebrow>
      <Card style={styles.gap2Card}>
        <Text style={styles.text15}>Chat model</Text>
        <Host matchContents>
          <Picker selectedValue={modelId} onValueChange={(v) => onModelChange(String(v))} appearance="menu">
            {models.map((m) => (
              <Picker.Item key={m.id} label={m.label} value={m.id} />
            ))}
          </Picker>
        </Host>
      </Card>

      <Eyebrow style={styles.mt2}>Web search</Eyebrow>
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

      <Eyebrow style={styles.mt2}>Sandbox providers</Eyebrow>
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

      {showConnectors ? (
      <>
      <Eyebrow style={styles.mt2}>Connectors</Eyebrow>
      <NoteCard icon={<Cable size={18} color={colors.primary} />} note={CONNECTORS_FOOTNOTE}>
        <View style={styles.connectorBox}>
          <View style={styles.rowGap2}>
            <Text style={styles.linkLabel}>Higgsfield</Text>
            <Text style={styles.subtitle12}>
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
      </>
      ) : null}

      <Eyebrow style={styles.mt2}>Render providers</Eyebrow>
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

      <Eyebrow style={styles.mt2}>Generation defaults</Eyebrow>
      <NoteCard
        icon={<SlidersHorizontal size={18} color={colors.primary} />}
        note={GEN_DEFAULTS_FOOTNOTE}
      >
        <View style={styles.gap1}>
          <Text style={styles.text13}>Image model</Text>
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
        <View style={styles.gap1}>
          <Text style={styles.text13}>Aspect ratio</Text>
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

      <Eyebrow style={styles.mt2}>Prompts</Eyebrow>
      <NoteCard icon={<Palette size={18} color={colors.primary} />} note={PROMPTS_FOOTNOTE}>
        {promptLinks.map((l) => (
          <LinkRow key={l.key} label={l.label} value={l.value} onPress={() => onOpenPrompt(l.key)} />
        ))}
      </NoteCard>

      <View style={styles.footer}>
        <Text style={styles.footerText}>{apiOrigin}</Text>
        <Button variant="destructive" title="Sign out" onPress={onSignOut} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  noteCard: { gap: 12 },
  noteHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  noteText: { flex: 1, fontSize: 12, lineHeight: 16, color: theme.colors.mutedForeground },
  toggleRow: { gap: 8, borderRadius: 0, borderWidth: 1, padding: 12 },
  toggleRowOn: { borderColor: `${theme.colors.primary}66` },
  toggleRowOff: { borderColor: theme.colors.border, opacity: 0.7 },
  rowGap2: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowGap1: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  flex1: { flex: 1 },
  label14: { fontSize: 14, fontWeight: '500', color: theme.colors.foreground },
  subtitle12: { fontSize: 12, color: theme.colors.mutedForeground },
  disabled: { opacity: 0.4 },
  keyLinkText: { fontSize: 12, fontWeight: '500', color: theme.colors.primary },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 12,
  },
  linkLabel: { flex: 1, fontSize: 14, fontWeight: '500', color: theme.colors.foreground },
  scroll: { flex: 1, backgroundColor: theme.colors.background },
  scrollContent: { flexGrow: 1, gap: 16, paddingHorizontal: 20, paddingTop: 24 },
  accountCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    height: 40,
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: theme.colors.secondary,
  },
  nameText: { fontSize: 15, fontWeight: '600', color: theme.colors.foreground },
  emailText: { fontSize: 13, color: theme.colors.mutedForeground },
  mt2: { marginTop: 8 },
  gap2Card: { gap: 8 },
  text15: { fontSize: 15, color: theme.colors.foreground },
  connectorBox: {
    gap: 8,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 12,
  },
  gap1: { gap: 4 },
  text13: { fontSize: 13, color: theme.colors.foreground },
  footer: { marginTop: 'auto', gap: 12, paddingBottom: 40 },
  footerText: { textAlign: 'center', fontSize: 12, lineHeight: 16, color: theme.colors.mutedForeground },
}));
