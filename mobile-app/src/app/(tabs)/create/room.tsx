import { Pressable, ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import * as Haptics from 'expo-haptics';
import { Check } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { useColors } from '@/lib/colors';
import { DEFAULT_DEEP_SPECIALISTS, roomEstimate, useFilmOptions } from '@/lib/film';
import { SPECIALISTS, STAGE_ORDER } from '@/lib/specialists';

// The Deep writers' room: which of the fifteen specialists read the draft,
// grouped by the roster stage they run in (a round per stage). The web input's
// room dialog, as a sheet. Choices save as they're tapped.
const STAGE_LABEL: Record<string, string> = { outline: 'Outline', draft: 'Draft', polish: 'Polish', lock: 'Lock' };

export default function RoomSheet() {
  const colors = useColors();
  const specialists = useFilmOptions((s) => s.specialists);
  const set = useFilmOptions((s) => s.set);
  const chosen = new Set(specialists);
  const est = roomEstimate(specialists);

  const toggle = (id: string) => {
    Haptics.selectionAsync().catch(() => {});
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // Keep roster order, so the room reads the way it will run.
    set({ specialists: SPECIALISTS.map((s) => s.id).filter((id2) => next.has(id2)) });
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>Writers' room</Text>
      <Text style={styles.sub}>
        Each specialist reads the draft and hands back notes; a rewrite applies each round's notes.{' '}
        {est.passes} {est.passes === 1 ? 'pass' : 'passes'} · {est.label} wait
      </Text>
      <View style={styles.actions}>
        <Button
          title="Core four"
          variant="outline"
          size="sm"
          onPress={() => set({ specialists: [...DEFAULT_DEEP_SPECIALISTS] })}
        />
        <Button
          title="Everyone"
          variant="outline"
          size="sm"
          onPress={() => set({ specialists: SPECIALISTS.map((s) => s.id) })}
        />
      </View>
      {STAGE_ORDER.map((stage) => (
        <View key={stage} style={styles.group}>
          <Text style={styles.eyebrow}>{STAGE_LABEL[stage] ?? stage}</Text>
          {SPECIALISTS.filter((s) => s.stage === stage).map((s) => {
            const on = chosen.has(s.id);
            return (
              <Pressable
                key={s.id}
                onPress={() => toggle(s.id)}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={s.title}
              >
                <View style={[styles.box, on && styles.boxOn]}>
                  {on ? <Check size={14} color={colors.primaryForeground} /> : null}
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{s.title}</Text>
                  <Text style={styles.rowSub}>{s.does}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { padding: 20, paddingBottom: 48, gap: 8 },
  title: { fontSize: 22, fontWeight: '700', color: theme.colors.foreground },
  sub: { fontSize: 14, lineHeight: 19, color: theme.colors.mutedForeground },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  group: { marginTop: 12, gap: 4 },
  eyebrow: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: theme.colors.mutedForeground,
    marginBottom: 4,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  pressed: { opacity: 0.6 },
  box: {
    width: 22,
    height: 22,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '500', color: theme.colors.foreground },
  rowSub: { fontSize: 13, color: theme.colors.mutedForeground },
}));
