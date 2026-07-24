import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
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
import { cn } from '@/lib/utils';
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
      className="flex-1"
      style={{ backgroundColor: colors.pageBg }}
      contentContainerClassName="px-4 pt-4 pb-8"
      keyboardShouldPersistTaps="handled"
    >
      <Text className="mb-3 text-[12px] text-muted-foreground">
        The pinned draft is the active version — both this app and the chat agent read and write
        only the pinned draft. Creating a draft clones the current pinned one, then pins it.
      </Text>

      <View className="mb-4 flex-row gap-2">
        <Input
          className="flex-1"
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
            className={cn(
              'mb-2 rounded-xl border p-3',
              isPinned ? 'border-primary/50 bg-primary/5' : 'border-border bg-card',
            )}
          >
              <View className="flex-row items-center gap-2">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={isPinned ? `${d.name} is pinned` : `Pin ${d.name}`}
                  disabled={busy || isPinned}
                  className="flex-1 flex-row items-center gap-2 active:opacity-60"
                  onPress={() => pin(d.id)}
                >
                  <Pin
                    size={14}
                    color={isPinned ? colors.primary : colors.mutedForeground}
                    fill={isPinned ? colors.primary : 'none'}
                  />
                  <View className="min-w-0 flex-1">
                    {renaming === d.id ? (
                      <TextInput
                        autoFocus
                        value={renameValue}
                        onChangeText={setRenameValue}
                        onBlur={() => rename(d.id)}
                        onSubmitEditing={() => rename(d.id)}
                        className="rounded-lg border border-primary bg-card px-2 py-1 text-[14px] text-foreground"
                        placeholderTextColor={colors.subtleForeground}
                      />
                    ) : (
                      <Text className="text-[15px] font-medium text-foreground" numberOfLines={1}>
                        {d.name}
                      </Text>
                    )}
                    <Text className="mt-0.5 text-[11px] text-muted-foreground">
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
                  className="h-8 w-8 items-center justify-center rounded-full active:opacity-60"
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
                  className={cn(
                    'h-8 w-8 items-center justify-center rounded-full active:opacity-60',
                    drafts.length <= 1 && 'opacity-30',
                  )}
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
