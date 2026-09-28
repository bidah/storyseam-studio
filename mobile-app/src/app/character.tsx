import { Alert, ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { ImagePlus, Mic, Trash2, X } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/card';
import { Empty, ErrorNote, Loading } from '@/components/ui/empty';
import { EditableField } from '@/components/story/field';
import { CHAR_FIELDS, type VoiceRef, type WorldDoc } from '@/components/story/world';
import { apiJson, deleteJson, mediaUrl, putJson } from '@/lib/api';
import { createPickerRequest } from '@/lib/picker-bus';
import { useInvalidate, useProjectResource } from '@/lib/queries';
import { useColors } from '@/lib/colors';

// Full character editor — opened as a formSheet from the World tab's character
// row (src/components/story/world.tsx). Re-reads the world doc and finds the
// character by id (the sound-picker pattern) so it can own all of its edits.

export default function CharacterSheet() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { data, isPending, error, refetch } = useProjectResource<WorldDoc>('world');
  const invalidate = useInvalidate();
  const colors = useColors();

  if (isPending) return <Loading />;
  if (error) return <ErrorNote message={String((error as any)?.message || error)} onRetry={refetch} />;

  const char = (data?.characters || []).find((c) => c.id === id);
  if (!char) {
    return (
      <View style={styles.notFound}>
        <Empty title="Character not found" hint="It may have been removed. Pull down to refresh the World tab." />
      </View>
    );
  }

  const sheet = char.sheetImage;
  const voiceRef = char.voiceRef;

  const onPatch = async (patch: Record<string, unknown>) => {
    await putJson(`/api/world/character/${char.id}`, patch);
    invalidate('world');
  };

  // Link/change the character sheet via the shared library picker sheet. The
  // picker resolves `rel` keys only, so we look the image up in /api/library to
  // send the web-parity payload { rel, url, thumb, name }.
  const pickSheet = async () => {
    const { requestId, promise } = createPickerRequest();
    router.push({ pathname: '/library-picker', params: { requestId, mode: 'single' } });
    const rels = (await promise) as string[] | null;
    const rel = rels?.[0];
    if (!rel) return;
    let im: any = null;
    try {
      const lib = await apiJson<any>('/api/library');
      for (const f of lib.folders || []) {
        const hit = (f.images || []).find((x: any) => x.rel === rel);
        if (hit) {
          im = hit;
          break;
        }
      }
    } catch {
      /* fall back to rel-only below */
    }
    await onPatch({
      sheetImage: im ? { rel: im.rel, url: im.url, thumb: im.thumb, name: im.name } : { rel },
    });
  };

  const pickVoice = async () => {
    const { requestId, promise } = createPickerRequest();
    router.push({ pathname: '/sound-picker', params: { requestId } });
    const take = (await promise) as VoiceRef | null;
    if (!take) return;
    await onPatch({ voiceRef: take });
  };

  const remove = () =>
    Alert.alert('Remove character', `Remove "${char.name || 'this character'}" from the world? This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteJson(`/api/world/character/${char.id}`);
            invalidate('world');
            router.back();
          } catch {
            /* keep the sheet open on failure */
          }
        },
      },
    ]);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <EditableField
        label="Name"
        value={char.name}
        placeholder="Character name"
        multiline={false}
        onCommit={(v) => onPatch({ name: v })}
      />

      {/* Character sheet image */}
      <View style={styles.card}>
        <Eyebrow style={styles.eyebrow}>Character sheet</Eyebrow>
        {sheet ? (
          <View style={styles.sheetRow}>
            <Image
              source={{ uri: mediaUrl(sheet.thumb || sheet.url) }}
              style={{ width: 88, height: 88, borderRadius: 0 }}
              contentFit="cover"
            />
            <View style={styles.sheetActions}>
              <Button size="sm" variant="outline" title="Change sheet" onPress={pickSheet}>
                <ImagePlus size={13} color={colors.foreground} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                title="Unlink"
                textStyle={styles.mutedText}
                onPress={() => onPatch({ sheetImage: null })}
              >
                <X size={13} color={colors.mutedForeground} />
              </Button>
            </View>
          </View>
        ) : (
          <Button size="sm" variant="outline" title="Link character sheet" onPress={pickSheet}>
            <ImagePlus size={13} color={colors.foreground} />
          </Button>
        )}
      </View>

      {/* Attached voice */}
      <View style={styles.card}>
        <Eyebrow style={styles.eyebrow}>Voice</Eyebrow>
        {voiceRef ? (
          <View style={styles.voiceGroup}>
            <View style={styles.voiceRow}>
              <Mic size={14} color={colors.primary} />
              <Text style={styles.voiceName} numberOfLines={1}>
                {voiceRef.name || 'Voice'}
                {voiceRef.v != null ? `  ·  v${voiceRef.v}` : ''}
              </Text>
            </View>
            <View style={styles.voiceActions}>
              <Button size="sm" variant="outline" title="Change voice" onPress={pickVoice}>
                <Mic size={13} color={colors.foreground} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                title="Unlink"
                textStyle={styles.mutedText}
                onPress={() => onPatch({ voiceRef: null })}
              >
                <X size={13} color={colors.mutedForeground} />
              </Button>
            </View>
          </View>
        ) : (
          <Button size="sm" variant="outline" title="Attach voice" onPress={pickVoice}>
            <Mic size={13} color={colors.foreground} />
          </Button>
        )}
      </View>

      {CHAR_FIELDS.map((f) => (
        <EditableField
          key={f.key}
          label={f.label}
          value={char[f.key]}
          placeholder={f.placeholder}
          onCommit={(v) => onPatch({ [f.key]: v })}
        />
      ))}

      <Button size="sm" variant="ghost" title="Remove character" textStyle={styles.destructiveText} onPress={remove}>
        <Trash2 size={13} color={colors.destructive} />
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  notFound: {
    flex: 1,
    backgroundColor: theme.colors.background,
    paddingHorizontal: 16,
    paddingTop: 32,
  },
  root: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 48,
    paddingTop: 20,
    gap: 12,
  },
  card: {
    borderRadius: 0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: `${theme.colors.secondary}66`,
    padding: 10,
  },
  eyebrow: {
    marginBottom: 6,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sheetActions: {
    flex: 1,
    gap: 6,
  },
  mutedText: {
    color: theme.colors.mutedForeground,
  },
  voiceGroup: {
    gap: 6,
  },
  voiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  voiceName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.foreground,
  },
  voiceActions: {
    flexDirection: 'row',
    gap: 6,
  },
  destructiveText: {
    color: theme.colors.destructive,
  },
}));
