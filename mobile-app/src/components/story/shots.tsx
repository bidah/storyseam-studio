import { useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, SectionList, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
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
import { useTabBarScrollProps } from '@/lib/use-tab-bar-inset';

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
  const barInset = useTabBarScrollProps();
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
    <View style={styles.header}>
      <View style={styles.badgeRow}>
        <Badge variant="outline" label={`${shots.length} shots`} />
        <Badge variant="success" label={`~${fmtTime(runtime)} total`} />
        <Badge variant="info" label={`${packs.length} packs`}>
          <Layers size={11} color={colors.info} />
        </Badge>
      </View>
      {packs.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.packsRow}>
          {packs.map((p) => {
            const on = effPack === p.id;
            return (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                accessibilityLabel={on ? 'Show all shots' : `Show only ${p.id}'s shots`}
                style={[styles.packChip, on ? styles.packChipOn : styles.packChipOff]}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setActivePack((cur) => (cur === p.id ? null : p.id));
                }}
              >
                <Text style={[styles.packLabel, on ? styles.packLabelOn : styles.packLabelOff]}>
                  {p.id}
                </Text>
                <Text style={styles.packMeta}>
                  {p.from}–{p.to} · {p.count}
                </Text>
                <Text style={[styles.packDuration, p.durationEst > 15 ? styles.packDurationWarn : styles.packDurationOk]}>
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
          style={({ pressed }) => [styles.clearPack, pressed && styles.pressed60]}
          onPress={() => setActivePack(null)}
        >
          <X size={11} color={colors.mutedForeground} />
          <Text style={styles.clearPackText}>showing {effPack} — show all</Text>
        </Pressable>
      ) : null}
    </View>
  );

  const footer = (
    <View style={styles.footer}>
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
    <View style={styles.flex1}>
      <SectionList
        {...barInset}
        style={styles.list}
        sections={sections}
        keyExtractor={(s) => String(s.n)}
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.mutedForeground} />}
        ListHeaderComponent={header}
        ListFooterComponent={shots.length > 0 ? footer : null}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Empty
              title="No shots yet"
              hint='Sign the script and press "Generate shot list", or rebuild from the current episode.'
            />
            {footer}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Film size={14} color={colors.primary} />
            <Text style={styles.sectionTitle} numberOfLines={1}>
              {section.beatTitle || section.beat}
            </Text>
            <Badge variant="outline" label={`${section.data.length} shots`} />
          </View>
        )}
        renderItem={({ item: s }) => (
          <BouncyPressable
            accessibilityLabel={`Edit shot ${s.id}`}
            style={styles.shotCard}
            onPress={() => router.push(`/story/shot/${s.n}`)}
          >
            <View style={styles.shotHeaderRow}>
              <Badge variant="muted" label={s.id} />
              {packById.get(s.id) ? <Badge variant="info" label={packById.get(s.id)!} /> : null}
              <Text style={styles.shotDur}>{s.dur || 0}s</Text>
            </View>
            <Text style={styles.shotMeta} numberOfLines={1}>
              {[s.location, s.camera].filter(Boolean).join(' · ') || '—'}
            </Text>
            {s.action ? (
              <Text style={styles.shotAction} numberOfLines={2}>
                {s.action}
              </Text>
            ) : null}
            {s.dialogue && !/\(no dialogue\)/i.test(s.dialogue) ? (
              <Text style={styles.shotDialogue} numberOfLines={2}>
                {s.dialogue}
              </Text>
            ) : null}
          </BouncyPressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex1: {
    flex: 1,
  },
  list: {
    flex: 1,
    paddingHorizontal: 16,
  },
  header: {
    paddingBottom: 8,
    paddingTop: 12,
  },
  badgeRow: {
    marginBottom: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  packsRow: {
    gap: 8,
    paddingRight: 16,
  },
  packChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  packChipOn: {
    borderColor: theme.colors.primary,
    backgroundColor: `${theme.colors.primary}26`,
  },
  packChipOff: {
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  packLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  packLabelOn: {
    color: theme.colors.primary,
  },
  packLabelOff: {
    color: theme.colors.foreground,
  },
  packMeta: {
    fontSize: 11,
    color: theme.colors.mutedForeground,
  },
  packDuration: {
    fontSize: 11,
    fontWeight: '600',
  },
  packDurationWarn: {
    color: theme.colors.warning,
  },
  packDurationOk: {
    color: theme.colors.success,
  },
  clearPack: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.colors.border,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pressed60: {
    opacity: 0.6,
  },
  clearPackText: {
    fontSize: 11,
    color: theme.colors.mutedForeground,
  },
  footer: {
    paddingVertical: 24,
  },
  emptyWrap: {
    paddingTop: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 8,
    paddingTop: 16,
  },
  sectionTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: theme.colors.foreground,
  },
  shotCard: {
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    padding: 12,
  },
  shotHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  shotDur: {
    marginLeft: 'auto',
    fontSize: 12,
    color: theme.colors.mutedForeground,
  },
  shotMeta: {
    marginTop: 6,
    fontSize: 12,
    color: theme.colors.mutedForeground,
  },
  shotAction: {
    marginTop: 4,
    fontSize: 14,
    lineHeight: 20,
    color: theme.colors.foreground,
  },
  shotDialogue: {
    marginTop: 4,
    fontSize: 13,
    fontStyle: 'italic',
    color: theme.colors.mutedForeground,
  },
}));
