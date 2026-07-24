import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View, useWindowDimensions } from 'react-native';
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
    <View className="flex-row items-baseline justify-between gap-3">
      <Text className="text-[13px] text-muted-foreground">{label}</Text>
      <Text className="min-w-0 flex-1 text-right text-[13px] font-medium text-foreground" numberOfLines={1}>
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
      <View className="flex-1 bg-background px-4 pt-8">
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
    <ScrollView className="flex-1 bg-background" contentContainerClassName="px-4 pb-10 pt-6">
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
      <View className="mt-4 rounded-2xl border border-border bg-card p-3">
        <View className="mb-2 flex-row items-center gap-1.5">
          <Sparkles size={13} color={colors.primary} />
          <Text className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            Prompt
          </Text>
        </View>
        {refThumbs.length > 0 ? (
          <View className="mb-2.5 flex-row flex-wrap gap-1.5">
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
        <Text className="text-[14px] leading-5 text-foreground" selectable>
          {gen.prompt || '—'}
        </Text>
      </View>

      {/* Details */}
      <View className="mt-3 rounded-2xl border border-border bg-card p-3">
        <View className="mb-2 flex-row items-center gap-1.5">
          <Info size={13} color={colors.primary} />
          <Text className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            Details
          </Text>
        </View>
        <View className="gap-2">
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
      <View className="mt-4 gap-2">
        <Button title="Recreate" onPress={() => finish('recreate')}>
          <RefreshCw size={15} color={colors.primaryForeground} />
        </Button>
        <View className="flex-row gap-2">
          <View className="flex-1">
            <Button variant="outline" title="Reference" onPress={() => finish('ref')}>
              <ImagePlus size={14} color={colors.foreground} />
            </Button>
          </View>
          <View className="flex-1">
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
          <View className="items-center">
            <Badge variant="success" label="in the asset library" />
          </View>
        ) : null}
        <View className="mt-1 items-end">
          <Button variant="ghost" size="sm" title="Delete" onPress={remove}>
            <Trash2 size={13} color={colors.mutedForeground} />
          </Button>
        </View>
      </View>
    </ScrollView>
  );
}
