import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Switch, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Smartphone } from 'lucide-react-native';
import { Badge } from '@/components/ui/badge';
import { Eyebrow } from '@/components/ui/card';
import { ErrorNote, Loading } from '@/components/ui/empty';
import { useColors } from '@/lib/colors';
import { PLUGINS, type PluginCategory, type PluginSpec } from '@/lib/plugins';
import { usePlugins } from '@/lib/use-plugins';
import { useManualRefresh } from '@/lib/use-manual-refresh';
import { useTabBarScrollProps } from '@/lib/use-tab-bar-inset';

// The plugin marketplace — the mobile twin of the web's /plugins. Installing is
// project-level (both collaborators see the same studio), and it is the same
// `plugins` document the web header and the agent's plugin gate read.

// Plugins with a surface on this phone (the Studio hub's rows). The rest still
// install here — the web studio and the agent use them.
const ON_PHONE = new Set(['director', 'stage', 'shotsheet', 'radio', 'episode', 'cuts', 'musicalized', 'upscale']);

const CATEGORY_ORDER: PluginCategory[] = ['Story', 'Visuals', 'Audio', 'Post'];

function PluginRow({ p, on, onToggle }: { p: PluginSpec; on: boolean; onToggle: (v: boolean) => void }) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.row}>
      <Pressable
        style={styles.rowText}
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel={`${p.name || p.label} details`}
      >
        <View style={styles.titleRow}>
          <Text style={styles.title}>{p.name || p.label}</Text>
          {ON_PHONE.has(p.id) ? (
            <Badge label="On this phone" variant="info">
              <Smartphone size={10} color={colors.info} />
            </Badge>
          ) : null}
        </View>
        <Text style={styles.tagline}>{p.tagline}</Text>
        <Text style={styles.blurb} numberOfLines={open ? undefined : 2}>
          {p.blurb}
        </Text>
      </Pressable>
      <Switch
        value={on}
        onValueChange={onToggle}
        accessibilityLabel={`${on ? 'Remove' : 'Install'} ${p.label}`}
      />
    </View>
  );
}

export default function PluginsScreen() {
  const barInset = useTabBarScrollProps();
  const plugins = usePlugins();
  const { refreshing, onRefresh } = useManualRefresh(plugins.refetch);

  if (plugins.isLoading) return <Loading />;
  if (plugins.error) return <ErrorNote message={String((plugins.error as Error).message)} onRetry={plugins.refetch} />;

  const groups = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: PLUGINS.filter((p) => (p.category || 'Studio') === cat),
  })).filter((g) => g.items.length);
  const rest = PLUGINS.filter((p) => !CATEGORY_ORDER.includes(p.category));
  if (rest.length) groups.push({ cat: 'Studio' as PluginCategory, items: rest });

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      {...barInset}
    >
      {groups.map((g) => (
        <View key={g.cat} style={styles.group}>
          <Eyebrow>{g.cat}</Eyebrow>
          <View style={styles.card}>
            {g.items.map((p, i) => (
              <View key={p.id}>
                {i > 0 ? <View style={styles.sep} /> : null}
                <PluginRow p={p} on={plugins.isInstalled(p.id)} onToggle={(v) => plugins.setInstalled(p.id, v)} />
              </View>
            ))}
          </View>
        </View>
      ))}
      <Text style={styles.footer}>Removing a plugin deletes nothing — the tab goes, the documents stay.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { padding: 16, paddingBottom: 32, gap: 18 },
  group: { gap: 0 },
  card: {
    borderRadius: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    overflow: 'hidden',
  },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border, marginLeft: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  rowText: { flex: 1, gap: 3 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  title: { fontSize: 15, fontWeight: '600', color: theme.colors.foreground },
  tagline: { fontSize: 13, color: theme.colors.foreground },
  blurb: { fontSize: 12, lineHeight: 17, color: theme.colors.mutedForeground },
  footer: { fontSize: 12, textAlign: 'center', color: theme.colors.mutedForeground },
}));
