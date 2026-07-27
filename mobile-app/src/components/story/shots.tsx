import { useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, SectionList, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { toast } from 'sonner-native';
import { Film, Layers, RefreshCw, X } from 'lucide-react-native';
import { Badge } from '@/components/ui/badge';
import { BouncyPressable } from '@/components/ui/bouncy-pressable';
import { Button } from '@/components/ui/button';
import { Empty, ErrorNote, Loading } from '@/components/ui/empty';
import { postJson } from '@/lib/api';
import { useColors } from '@/lib/colors';
import { useInvalidate, useProjectResource } from '@/lib/queries';
import { useManualRefresh } from '@/lib/use-manual-refresh';
import { cn } from '@/lib/utils';

// Shot list sub-surface — port of src/routes/shotlist.jsx (web). Shots are
// grouped by beat; the auto-packed <=15s multishot packs render as horizontal
// chips that filter the list. Tapping a shot opens the /story/shot/:n formSheet
// (native header + close button), which saves via PUT /api/shotlist/shot/:n.

export type Shot = {
  n: number;
  id: string;
  beat: string;
  beatTitle?: string;
  location?: string;
  characters?: string[];
  camera?: string;
  action?: string;
  dialogue?: string;
  audioSync?: string;
  dur?: number;
  prompt?: string;
};
type Pack = { id: string; from: string; to: string; shotIds: string[]; count: number; durationEst: number };
export type ShotlistData = { shots: Shot[]; packs: Pack[] };

function fmtTime(total: number) {
  const s = Math.max(0, Math.round(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ *
 * Surface                                                             *
 * ------------------------------------------------------------------ */

export function ShotsSurface() {
  const colors = useColors();
  const { data, isPending, error, refetch } = useProjectResource<ShotlistData>('shotlist');
  const { refreshing, onRefresh } = useManualRefresh(refetch);
  const invalidate = useInvalidate();
  const [activePack, setActivePack] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);

  const shots = data?.shots || [];
  const packs = data?.packs || [];

  const packById = useMemo(() => {
    const m = new Map<string, string>();
    packs.forEach((p) => p.shotIds.forEach((id) => m.set(id, p.id)));
    return m;
  }, [packs]);

  // Guard: a pack that vanished after an edit/rebuild falls back to "show all".
  const effPack = activePack && packs.some((p) => p.id === activePack) ? activePack : null;
  const visibleShots = effPack ? shots.filter((s) => packById.get(s.id) === effPack) : shots;

  // Group by beat, in order.
  const sections = useMemo(() => {
    const out: { key: string; beat: string; beatTitle?: string; data: Shot[] }[] = [];
    for (const s of visibleShots) {
      const last = out[out.length - 1];
      if (!last || last.beat !== s.beat) {
        out.push({ key: `${s.beat}:${s.id}`, beat: s.beat, beatTitle: s.beatTitle, data: [s] });
      } else {
        last.data.push(s);
      }
    }
    return out;
  }, [visibleShots]);

  const runtime = shots.reduce((a, s) => a + (Number(s.dur) || 0), 0);

  const rebuild = () =>
    Alert.alert(
      'Rebuild shot list',
      'Replace the current shot list with one rebuilt from the current episode bundles? Manual edits to shots will be lost.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rebuild',
          style: 'destructive',
          onPress: async () => {
            setRebuilding(true);
            try {
              await postJson('/api/shotlist/rebuild-from-episode');
              invalidate('shotlist');
            } catch (e: any) {
              toast.error(String(e?.message || e || 'Rebuild failed'));
            } finally {
              setRebuilding(false);
            }
          },
        },
      ],
    );

  if (isPending) return <Loading />;
  if (error) return <ErrorNote message={String((error as any)?.message || error)} onRetry={refetch} />;

  const header = (
    <View className="pb-2 pt-3">
      <View className="mb-2 flex-row flex-wrap items-center gap-2">
        <Badge variant="outline" label={`${shots.length} shots`} />
        <Badge variant="success" label={`~${fmtTime(runtime)} total`} />
        <Badge variant="info" label={`${packs.length} packs`}>
          <Layers size={11} color={colors.info} />
        </Badge>
      </View>
      {packs.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 pr-4">
          {packs.map((p) => {
            const on = effPack === p.id;
            return (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                accessibilityLabel={on ? 'Show all shots' : `Show only ${p.id}'s shots`}
                className={cn(
                  'flex-row items-center gap-1.5 rounded-full border px-3 py-1.5',
                  on ? 'border-primary bg-primary/15' : 'border-border bg-card',
                )}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setActivePack((cur) => (cur === p.id ? null : p.id));
                }}
              >
                <Text className={cn('text-[12px] font-semibold', on ? 'text-primary' : 'text-foreground')}>
                  {p.id}
                </Text>
                <Text className="text-[11px] text-muted-foreground">
                  {p.from}–{p.to} · {p.count}
                </Text>
                <Text
                  className={cn(
                    'text-[11px] font-semibold',
                    p.durationEst > 15 ? 'text-warning' : 'text-success',
                  )}
                >
                  {p.durationEst}s
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
      {effPack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show all shots"
          className="mt-2 flex-row items-center gap-1 self-start rounded-md border border-dashed border-border px-2 py-1 active:opacity-60"
          onPress={() => setActivePack(null)}
        >
          <X size={11} color={colors.mutedForeground} />
          <Text className="text-[11px] text-muted-foreground">showing {effPack} — show all</Text>
        </Pressable>
      ) : null}
    </View>
  );

  const footer = (
    <View className="py-6">
      <Button
        variant="outline"
        title={rebuilding ? 'Rebuilding…' : 'Rebuild from current episode'}
        loading={rebuilding}
        onPress={rebuild}
      >
        {!rebuilding ? <RefreshCw size={14} color={colors.foreground} /> : null}
      </Button>
    </View>
  );

  return (
    <View className="flex-1">
      <SectionList
        className="flex-1 px-4"
        sections={sections}
        keyExtractor={(s) => String(s.n)}
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.mutedForeground} />}
        ListHeaderComponent={header}
        ListFooterComponent={shots.length > 0 ? footer : null}
        ListEmptyComponent={
          <View className="pt-4">
            <Empty
              title="No shots yet"
              hint='Sign the script and press "Generate shot list", or rebuild from the current episode.'
            />
            {footer}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View className="flex-row items-center gap-2 pb-2 pt-4">
            <Film size={14} color={colors.primary} />
            <Text className="flex-1 text-[15px] font-semibold text-foreground" numberOfLines={1}>
              {section.beatTitle || section.beat}
            </Text>
            <Badge variant="outline" label={`${section.data.length} shots`} />
          </View>
        )}
        renderItem={({ item: s }) => (
          <BouncyPressable
            accessibilityLabel={`Edit shot ${s.id}`}
            className="mb-2 rounded-xl border border-border bg-card p-3"
            onPress={() => router.push(`/story/shot/${s.n}`)}
          >
            <View className="flex-row items-center gap-2">
              <Badge variant="muted" label={s.id} />
              {packById.get(s.id) ? <Badge variant="info" label={packById.get(s.id)!} /> : null}
              <Text className="ml-auto text-[12px] text-muted-foreground">{s.dur || 0}s</Text>
            </View>
            <Text className="mt-1.5 text-[12px] text-muted-foreground" numberOfLines={1}>
              {[s.location, s.camera].filter(Boolean).join(' · ') || '—'}
            </Text>
            {s.action ? (
              <Text className="mt-1 text-[14px] leading-5 text-foreground" numberOfLines={2}>
                {s.action}
              </Text>
            ) : null}
            {s.dialogue && !/\(no dialogue\)/i.test(s.dialogue) ? (
              <Text className="mt-1 text-[13px] italic text-muted-foreground" numberOfLines={2}>
                {s.dialogue}
              </Text>
            ) : null}
          </BouncyPressable>
        )}
      />
    </View>
  );
}
