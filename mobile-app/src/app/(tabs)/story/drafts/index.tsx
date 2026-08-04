import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { router } from 'expo-router';
import { toast } from 'sonner-native';
import { Pencil, Pin, Plus, Trash2 } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loading } from '@/components/ui/empty';
import { useColors } from '@/lib/colors';
import { deleteJson, patchJson, postJson } from '@/lib/api';
import { CLIENT_ID } from '@/lib/client-id';
import { useInvalidate, useProjectResource } from '@/lib/queries';
import { useTabBarScrollProps } from '@/lib/use-tab-bar-inset';
import type { ScriptData } from '@/components/story/script';

// Drafts sheet — create / pin / rename / delete (the pinned draft is the active
// one both this screen and the agent read/write). Presented as a native
// formSheet from story/_layout; the "Drafts" title + close button live in the
// native header (see drafts/_layout). Reads the same cached `script` resource
// the Script surface does, so opening is instant.

// "2m ago" / "just now" — compact relative time for the drafts list.
function relTime(iso?: string) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.round((Date.now() - then) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function DraftsSheet() {
  const barInset = useTabBarScrollProps();
  const colors = useColors();
  const { data } = useProjectResource<ScriptData>('script');
  const invalidate = useInvalidate();
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [busy, setBusy] = useState(false);

  const drafts = data?.drafts ?? [];
  const pinnedId = data?.pinnedId ?? '';

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      invalidate('script');
    } catch (e: any) {
      toast.error(String(e?.message || e || 'Draft operation failed'));
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      await postJson('/api/script/drafts', { name: name.trim() || undefined, clientId: CLIENT_ID });
      setName('');
      router.back(); // the new draft is now pinned
    });
  const pin = (id: string) => {
    if (id === pinnedId) return;
    run(() => postJson('/api/script/pin', { id, clientId: CLIENT_ID }));
  };
  const rename = (id: string) =>
    run(async () => {
      const v = renameValue.trim();
      if (v) await patchJson(`/api/script/drafts/${id}`, { name: v, clientId: CLIENT_ID });
      setRenaming(null);
    });
  const remove = (id: string) => run(() => deleteJson(`/api/script/drafts/${id}`));

  const sorted = [...drafts].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  if (!data) return <Loading />;

  return (
    <ScrollView
      {...barInset}
      style={[styles.flex1, { backgroundColor: colors.pageBg }]}
      contentContainerStyle={styles.contentContainer}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.intro}>
        The pinned draft is the active version — both this app and the chat agent read and write
        only the pinned draft. Creating a draft clones the current pinned one, then pins it.
      </Text>

      <View style={styles.createRow}>
        <Input
          style={styles.flex1}
          value={name}
          onChangeText={setName}
          placeholder={`Draft ${drafts.length + 1}`}
          onSubmitEditing={() => !busy && create()}
        />
        <Button title="Create" disabled={busy} onPress={create}>
          <Plus size={15} color={colors.primaryForeground} />
        </Button>
      </View>

      {sorted.map((d) => {
        const isPinned = d.id === pinnedId;
        return (
          <View
            key={d.id}
            style={[styles.draftCard, isPinned ? styles.draftCardPinned : styles.draftCardDefault]}
          >
              <View style={styles.draftRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={isPinned ? `${d.name} is pinned` : `Pin ${d.name}`}
                  disabled={busy || isPinned}
                  style={({ pressed }) => [styles.pinPressable, pressed && styles.pressed60]}
                  onPress={() => pin(d.id)}
                >
                  <Pin
                    size={14}
                    color={isPinned ? colors.primary : colors.mutedForeground}
                    fill={isPinned ? colors.primary : 'none'}
                  />
                  <View style={styles.draftInfo}>
                    {renaming === d.id ? (
                      <TextInput
                        autoFocus
                        value={renameValue}
                        onChangeText={setRenameValue}
                        onBlur={() => rename(d.id)}
                        onSubmitEditing={() => rename(d.id)}
                        style={styles.renameInput}
                        placeholderTextColor={colors.subtleForeground}
                      />
                    ) : (
                      <Text style={styles.draftName} numberOfLines={1}>
                        {d.name}
                      </Text>
                    )}
                    <Text style={styles.draftMeta}>
                      {d.lineCount != null ? `${d.lineCount} lines · ` : ''}
                      {relTime(d.updatedAt)}
                      {isPinned ? ' · pinned' : ''}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Rename ${d.name}`}
                  disabled={busy}
                  style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed60]}
                  onPress={() => {
                    setRenaming(d.id);
                    setRenameValue(d.name);
                  }}
                >
                  <Pencil size={14} color={colors.mutedForeground} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${d.name}`}
                  disabled={busy || drafts.length <= 1}
                  style={({ pressed }) => [
                    styles.iconBtn,
                    drafts.length <= 1 && styles.iconBtnDisabled,
                    pressed && styles.pressed60,
                  ]}
                  onPress={() => remove(d.id)}
                >
                  <Trash2 size={14} color={colors.destructive} />
                </Pressable>
              </View>
            </View>
          );
        })}
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex1: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
  },
  intro: {
    marginBottom: 12,
    fontSize: 12,
    color: theme.colors.mutedForeground,
  },
  createRow: {
    marginBottom: 16,
    flexDirection: 'row',
    gap: 8,
  },
  draftCard: {
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  draftCardPinned: {
    borderColor: `${theme.colors.primary}80`,
    backgroundColor: `${theme.colors.primary}0D`,
  },
  draftCardDefault: {
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  draftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pinPressable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pressed60: {
    opacity: 0.6,
  },
  draftInfo: {
    minWidth: 0,
    flex: 1,
  },
  renameInput: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.card,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 14,
    color: theme.colors.foreground,
  },
  draftName: {
    fontSize: 15,
    fontWeight: '500',
    color: theme.colors.foreground,
  },
  draftMeta: {
    marginTop: 2,
    fontSize: 11,
    color: theme.colors.mutedForeground,
  },
  iconBtn: {
    height: 32,
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  iconBtnDisabled: {
    opacity: 0.3,
  },
}));
