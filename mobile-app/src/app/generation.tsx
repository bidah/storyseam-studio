import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { Galeria } from '@nandorojo/galeria';
import { toast } from 'sonner-native';
import { ImagePlus, Info, Library, RefreshCw, Sparkles, Trash2 } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Eyebrow } from '@/components/ui/card';
import { Empty, ErrorNote, Loading } from '@/components/ui/empty';
import type { VisualGen, VisualWorldDoc } from '@/components/story/visual-world';
import { deleteJson, mediaUrl, postJson } from '@/lib/api';
import { resolvePickerRequest } from '@/lib/picker-bus';
import { useInvalidate, useProjectResource } from '@/lib/queries';
import { useColors } from '@/lib/colors';
import { useEffectiveScheme } from '@/lib/theme';

// Visual-world generation detail — opened as a formSheet from the World tab's
// Visual gallery (the web ImageStudio's GenerationDetail). Params:
//   id        — generation id, looked up in the visualWorld resource
//   requestId — picker-bus id; "Recreate" / "Use as reference" resolve it with
//               { action, id } so the gallery's composer can apply the intent.
// Save-to-library and Delete talk to /api/visual-world directly.

const SHEET_LABELS: Record<string, string> = {
  character: 'Character sheet',
  location: 'Location sheet',
  prop: 'Prop sheet',
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export default function GenerationSheet() {
  const { id, requestId } = useLocalSearchParams<{ id?: string; requestId?: string }>();
  const { data, isPending, error, refetch } = useProjectResource<VisualWorldDoc>('visualWorld');
  const invalidate = useInvalidate();
  const { width } = useWindowDimensions();
  const [savedRel, setSavedRel] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const colors = useColors();
  const scheme = useEffectiveScheme();

  // Resolve null if the sheet is dismissed without an action (the picker-bus
  // ignores a second resolve, so an action's resolve always wins).
  useEffect(() => {
    return () => resolvePickerRequest(requestId, null);
  }, [requestId]);

  if (isPending) return <Loading />;
  if (error)
    return <ErrorNote message={String((error as any)?.message || error)} onRetry={refetch} />;

  const gen = (data?.generations || []).find((g: VisualGen) => g.id === id);
  if (!gen) {
    return (
      <View style={styles.notFoundRoot}>
        <Empty title="Generation not found" hint="It may have been deleted. Pull to refresh the gallery." />
      </View>
    );
  }

  const saved = savedRel || gen.savedRel || null;
  const created = gen.ts ? new Date(gen.ts) : null;
  const createdLabel =
    created && !Number.isNaN(created.getTime())
      ? created.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
      : null;
  const refThumbs = (gen.refs || []).filter((r) => r.url || r.thumb);
  const imgW = width - 16 * 2;

  const finish = (action: 'recreate' | 'ref') => {
    resolvePickerRequest(requestId, { action, id: gen.id });
    router.back();
  };

  const saveToLibrary = async () => {
    setSaving(true);
    try {
      const j = await postJson<{ rel: string }>('/api/visual-world/save-to-library', {
        id: gen.id,
        name: gen.id,
      });
      setSavedRel(j.rel);
      invalidate('visualWorld', 'library');
      toast.success('Saved to library');
    } catch (e) {
      toast.error(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    Alert.alert(
      'Delete this generation?',
      'The image and its stored file are permanently deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteJson(`/api/visual-world/generation/${gen.id}`);
              invalidate('visualWorld');
              router.back();
            } catch (e) {
              toast.error(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
            }
          },
        },
      ],
    );
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <Eyebrow>Generation</Eyebrow>

      {/* Tap = the Galeria full-screen preview (pinch-zoom, shared-element
          transition) — the same viewer the assets grid uses. */}
      <Galeria urls={[mediaUrl(gen.url) ?? '']} theme={scheme}>
        <Galeria.Image index={0} style={{ width: imgW, height: imgW * 0.75 }}>
          <Image
            source={{ uri: mediaUrl(gen.url) }}
            accessibilityLabel="View full image"
            style={{ width: imgW, height: imgW * 0.75, borderRadius: 14, backgroundColor: colors.surface }}
            contentFit="contain"
          />
        </Galeria.Image>
      </Galeria>

      {/* Prompt */}
      <View style={[styles.card, styles.promptCard]}>
        <View style={styles.cardHeader}>
          <Sparkles size={13} color={colors.primary} />
          <Text style={styles.cardHeaderLabel}>
            Prompt
          </Text>
        </View>
        {refThumbs.length > 0 ? (
          <View style={styles.refThumbsRow}>
            {refThumbs.map((r, i) => (
              <Image
                key={`${r.rel || r.genId || i}`}
                source={{ uri: mediaUrl(r.thumb || r.url) }}
                accessibilityLabel="reference"
                style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: colors.surface }}
                contentFit="cover"
              />
            ))}
          </View>
        ) : null}
        <Text style={styles.promptText} selectable>
          {gen.prompt || '—'}
        </Text>
      </View>

      {/* Details */}
      <View style={[styles.card, styles.detailsCard]}>
        <View style={styles.cardHeader}>
          <Info size={13} color={colors.primary} />
          <Text style={styles.cardHeaderLabel}>
            Details
          </Text>
        </View>
        <View style={styles.detailsList}>
          <DetailRow label="Model" value={gen.model || 'Default'} />
          {gen.sheetType && SHEET_LABELS[gen.sheetType] ? (
            <DetailRow label="Sheet" value={SHEET_LABELS[gen.sheetType]} />
          ) : null}
          {gen.aspectRatio ? <DetailRow label="Aspect" value={gen.aspectRatio} /> : null}
          {gen.refs?.length ? <DetailRow label="References" value={String(gen.refs.length)} /> : null}
          {createdLabel ? <DetailRow label="Created" value={createdLabel} /> : null}
          {saved ? <DetailRow label="Library" value={saved} /> : null}
        </View>
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <Button title="Recreate" onPress={() => finish('recreate')}>
          <RefreshCw size={15} color={colors.primaryForeground} />
        </Button>
        <View style={styles.actionRow}>
          <View style={styles.flex1}>
            <Button variant="outline" title="Reference" onPress={() => finish('ref')}>
              <ImagePlus size={14} color={colors.foreground} />
            </Button>
          </View>
          <View style={styles.flex1}>
            <Button
              variant="outline"
              title={saved ? 'Saved' : 'Save to library'}
              disabled={!!saved || saving}
              loading={saving}
              onPress={saveToLibrary}
            >
              {!saving ? <Library size={14} color={colors.foreground} /> : null}
            </Button>
          </View>
        </View>
        {saved ? (
          <View style={styles.savedRow}>
            <Badge variant="success" label="in the asset library" />
          </View>
        ) : null}
        <View style={styles.deleteRow}>
          <Button variant="ghost" size="sm" title="Delete" onPress={remove}>
            <Trash2 size={13} color={colors.mutedForeground} />
          </Button>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  detailRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  detailLabel: {
    fontSize: 13,
    color: theme.colors.mutedForeground,
  },
  detailValue: {
    minWidth: 0,
    flex: 1,
    textAlign: 'right',
    fontSize: 13,
    fontWeight: '500',
    color: theme.colors.foreground,
  },
  notFoundRoot: {
    flex: 1,
    backgroundColor: theme.colors.background,
    paddingHorizontal: 16,
    paddingTop: 32,
  },
  scroll: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
    paddingTop: 24,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    padding: 12,
  },
  promptCard: {
    marginTop: 16,
  },
  detailsCard: {
    marginTop: 12,
  },
  cardHeader: {
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardHeaderLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    color: theme.colors.mutedForeground,
  },
  refThumbsRow: {
    marginBottom: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  promptText: {
    fontSize: 14,
    lineHeight: 20,
    color: theme.colors.foreground,
  },
  detailsList: {
    gap: 8,
  },
  actions: {
    marginTop: 16,
    gap: 8,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  flex1: {
    flex: 1,
  },
  savedRow: {
    alignItems: 'center',
  },
  deleteRow: {
    marginTop: 4,
    alignItems: 'flex-end',
  },
}));
