import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { toast } from 'sonner-native';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Empty } from '@/components/ui/empty';
import { putJson } from '@/lib/api';
import { useInvalidate, useProjectResource } from '@/lib/queries';
import { useTabBarScrollProps } from '@/lib/use-tab-bar-inset';
import type { Shot, ShotlistData } from '@/components/story/shots';

// Shot editor — presented as a native formSheet from story/_layout, so the
// title + close button are real nav-bar items (see ./_layout). Reads the shot
// out of the cached `shotlist` resource by its number, so opening is instant.
// Saving goes through PUT /api/shotlist/shot/:n (merge-patch; characters as an
// array, dur numeric).

function ShotForm({ shot }: { shot: Shot }) {
  const barInset = useTabBarScrollProps();
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    location: shot.location || '',
    characters: (shot.characters || []).join(', '),
    camera: shot.camera || '',
    action: shot.action || '',
    dialogue: shot.dialogue || '',
    audioSync: shot.audioSync || '',
    dur: shot.dur != null ? String(shot.dur) : '',
    prompt: shot.prompt || '',
  });
  const set = (k: keyof typeof f) => (v: string) => setF((prev) => ({ ...prev, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      await putJson(`/api/shotlist/shot/${shot.n}`, {
        location: f.location,
        characters: f.characters.split(',').map((x) => x.trim()).filter(Boolean),
        camera: f.camera,
        action: f.action,
        dialogue: f.dialogue,
        audioSync: f.audioSync,
        dur: Number(f.dur) || 0,
        prompt: f.prompt,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      invalidate('shotlist');
      router.back();
    } catch (e: any) {
      toast.error(String(e?.message || e || 'Save failed'));
      setBusy(false);
    }
  };

  const field = (
    label: string,
    key: keyof typeof f,
    opts?: { multiline?: boolean; numeric?: boolean; placeholder?: string },
  ) => (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>
        {label}
      </Text>
      <Input
        value={f[key]}
        onChangeText={set(key)}
        multiline={opts?.multiline}
        keyboardType={opts?.numeric ? 'decimal-pad' : 'default'}
        placeholder={opts?.placeholder}
      />
    </View>
  );

  return (
    <ScrollView
      {...barInset}
      style={styles.flex1}
      contentContainerStyle={styles.contentContainer}
      keyboardShouldPersistTaps="handled"
    >
      {field('Location', 'location')}
      {field('Characters (comma-separated)', 'characters', { placeholder: 'Sara, Helena' })}
      {field('Camera', 'camera')}
      {field('Action', 'action', { multiline: true })}
      {field('Dialogue', 'dialogue', { multiline: true })}
      {field('Audio sync', 'audioSync', { multiline: true })}
      {field('Duration (s)', 'dur', { numeric: true })}
      {field('Seedance prompt', 'prompt', { multiline: true })}
      <Button title="Save shot" loading={busy} onPress={save} />
    </ScrollView>
  );
}

export default function ShotSheet() {
  const { n } = useLocalSearchParams<{ n: string }>();
  const { data } = useProjectResource<ShotlistData>('shotlist');
  const shot = (data?.shots || []).find((s) => String(s.n) === String(n));

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: shot ? `Shot ${shot.id}` : 'Shot' }} />
      {shot ? (
        // Keyed by the shot so the form re-seeds if the sheet is reused.
        <ShotForm key={shot.n} shot={shot} />
      ) : (
        <View style={styles.emptyWrap}>
          <Empty title="Shot not found" hint="It may have been removed by a shot-list rebuild." />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  emptyWrap: {
    paddingTop: 24,
  },
  flex1: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingBottom: 96,
    paddingTop: 16,
  },
  fieldWrap: {
    marginBottom: 12,
  },
  fieldLabel: {
    marginBottom: 4,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    color: theme.colors.mutedForeground,
  },
}));
