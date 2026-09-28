import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { router, type Href } from 'expo-router';
import {
  ArrowUpFromLine,
  Blocks,
  ChevronRight,
  Clapperboard,
  Film,
  LayoutGrid,
  Music,
  Radio,
  Scissors,
  SlidersHorizontal,
  Theater,
  type LucideIcon,
} from 'lucide-react-native';
import { BouncyPressable } from '@/components/ui/bouncy-pressable';
import { Eyebrow } from '@/components/ui/card';
import { useColors } from '@/lib/colors';
import { pluginById } from '@/lib/plugins';
import { usePlugins } from '@/lib/use-plugins';
import { useManualRefresh } from '@/lib/use-manual-refresh';
import { useTabBarScrollProps } from '@/lib/use-tab-bar-inset';

// The Studio hub — the second layer after Create. A Film lands here as an
// ordinary project; this is where it is cleaned up and built further, with the
// studio agent riding the tab bar's pill as everywhere else.
//
// Rows are the project's INSTALLED plugins that have a mobile surface, in the
// web header's order (HEADER_ORDER); the rest are one tap away in Explore
// plugins. The Editor is core — always here.

type Row = { id: string; href: Href; icon: LucideIcon };

// Plugin surfaces this app draws, keyed by plugin id.
const SURFACES: Row[] = [
  { id: 'director', href: '/studio/director', icon: Clapperboard },
  { id: 'stage', href: '/studio/stage', icon: Theater },
  { id: 'shotsheet', href: '/studio/shotsheet', icon: LayoutGrid },
  { id: 'radio', href: '/studio/radio', icon: Radio },
  { id: 'episode', href: '/studio/episode', icon: Film },
  { id: 'cuts', href: '/studio/cuts', icon: Scissors },
  { id: 'musicalized', href: '/studio/musicalized', icon: Music },
  { id: 'upscale', href: '/studio/upscale', icon: ArrowUpFromLine },
];

export const MOBILE_PLUGIN_IDS = SURFACES.map((s) => s.id);

function HubRow({ icon: Icon, title, subtitle, onPress }: { icon: LucideIcon; title: string; subtitle?: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <BouncyPressable onPress={onPress} accessibilityLabel={title}>
      <View style={styles.row}>
        <View style={styles.iconBox}>
          <Icon size={18} color={colors.primary} />
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>{title}</Text>
          {subtitle ? (
            <Text style={styles.rowSub} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <ChevronRight size={16} color={colors.subtleForeground} />
      </View>
    </BouncyPressable>
  );
}

export default function StudioHub() {
  const barInset = useTabBarScrollProps();
  const plugins = usePlugins();
  const { refreshing, onRefresh } = useManualRefresh(plugins.refetch);
  const installed = SURFACES.filter((s) => plugins.isInstalled(s.id));

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      {...barInset}
    >
      <Eyebrow>Edit</Eyebrow>
      <View style={styles.group}>
        <HubRow
          icon={SlidersHorizontal}
          title="Editor"
          subtitle="The project's timeline — trim, reorder and play the cut."
          onPress={() => router.push('/editor')}
        />
      </View>

      <Eyebrow style={styles.mt}>Plugins</Eyebrow>
      <View style={styles.group}>
        {installed.map((s) => {
          const spec = pluginById(s.id);
          return (
            <HubRow
              key={s.id}
              icon={s.icon}
              title={spec?.label ?? s.id}
              subtitle={spec?.tagline}
              onPress={() => router.push(s.href)}
            />
          );
        })}
        {plugins.loaded && installed.length === 0 ? (
          <Text style={styles.none}>No plugins with a phone surface installed yet.</Text>
        ) : null}
        <HubRow
          icon={Blocks}
          title="Explore plugins"
          subtitle="Install or remove what this project's studio offers."
          onPress={() => router.push('/studio/plugins')}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { padding: 16, paddingBottom: 32 },
  mt: { marginTop: 20 },
  group: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.muted,
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: theme.colors.foreground },
  rowSub: { fontSize: 13, lineHeight: 17, color: theme.colors.mutedForeground },
  none: { fontSize: 13, color: theme.colors.mutedForeground, paddingVertical: 8 },
}));
