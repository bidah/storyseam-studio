import { useState } from 'react';
import { Alert, RefreshControl, ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Monitor, Trash2 } from 'lucide-react-native';
import { toast } from 'sonner-native';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Empty, ErrorNote, Loading } from '@/components/ui/empty';
import { Segmented } from '@/components/ui/segmented';
import { StageVideo } from '@/components/studio/stage-video';
import { deleteJson } from '@/lib/api';
import { useColors } from '@/lib/colors';
import { mmss, type Sitting } from '@/lib/director';
import { useInvalidate, useProjectResource } from '@/lib/queries';
import { useManualRefresh } from '@/lib/use-manual-refresh';
import { useTabBarScrollProps } from '@/lib/use-tab-bar-inset';

// Stage — the kept sittings. A live sitting is a WebRTC session to fal plus a
// MediaRecorder capture, both browser-only (agent-parity.txt says so too), so
// the phone plays what was kept — the take as recorded, or scored once
// Musicalized has laid a cue under it — and can forget one.

function dateOf(v?: string | number) {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function SittingCard({ s, onForget, forgetting }: { s: Sitting; onForget: () => void; forgetting: boolean }) {
  const colors = useColors();
  const [which, setWhich] = useState<'scored' | 'take'>(s.scoredUrl ? 'scored' : 'take');
  const url = which === 'scored' && s.scoredUrl ? s.scoredUrl : s.url;
  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={styles.flex1}>
          <Text style={styles.title} numberOfLines={1}>
            {s.title || 'Sitting'}
          </Text>
          <Text style={styles.meta}>
            {[s.seconds ? mmss(s.seconds) : '', dateOf(s.recordedAt)].filter(Boolean).join(' · ')}
          </Text>
        </View>
        {s.scoredUrl ? <Badge variant="success" label="scored" /> : null}
        <Button
          size="icon"
          variant="ghost"
          accessibilityLabel={`Forget ${s.title || 'this sitting'}`}
          loading={forgetting}
          onPress={onForget}
        >
          {forgetting ? null : <Trash2 size={16} color={colors.mutedForeground} />}
        </Button>
      </View>
      {s.scoredUrl ? (
        <Segmented<'scored' | 'take'>
          options={[
            { value: 'scored', label: 'Scored' },
            { value: 'take', label: 'As recorded' },
          ]}
          value={which}
          onChange={setWhich}
        />
      ) : null}
      <StageVideo key={url} url={url} />
    </Card>
  );
}

export default function StageScreen() {
  const barInset = useTabBarScrollProps();
  const colors = useColors();
  const invalidate = useInvalidate();
  const { data, isLoading, error, refetch } = useProjectResource<{ kept: Sitting[] }>('sittings');
  const { refreshing, onRefresh } = useManualRefresh(refetch);
  const [forgetting, setForgetting] = useState<string | null>(null);

  const forget = (s: Sitting) =>
    Alert.alert(
      'Forget this sitting?',
      'It leaves the kept list. The recording itself stays in storage.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Forget',
          style: 'destructive',
          onPress: async () => {
            setForgetting(s.id);
            try {
              await deleteJson(`/api/stage/sittings/${encodeURIComponent(s.id)}`);
              invalidate('sittings');
            } catch (e: any) {
              toast.error(String(e?.message || e));
            } finally {
              setForgetting(null);
            }
          },
        },
      ],
    );

  if (isLoading && !data) return <Loading />;
  if (error && !data) {
    return <ErrorNote message={String((error as any)?.message || error)} onRetry={() => refetch()} />;
  }
  const kept = data?.kept ?? [];

  return (
    <ScrollView
      {...barInset}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.mutedForeground} />}
    >
      <Card style={styles.note}>
        <Monitor size={16} color={colors.primary} />
        <Text style={styles.noteText}>
          Running a live sitting needs the desktop or web studio. Kept sittings play here.
        </Text>
      </Card>
      {kept.length === 0 ? (
        <Empty title="No kept sittings" hint="A sitting you keep on Stage, or one a Film runs, appears here." />
      ) : (
        kept.map((s) => (
          <SittingCard key={s.id} s={s} forgetting={forgetting === s.id} onForget={() => forget(s)} />
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { padding: 16, paddingBottom: 48, gap: 12 },
  card: { gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex1: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: '600', color: theme.colors.foreground },
  meta: { fontSize: 12, color: theme.colors.mutedForeground },
  note: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  noteText: { flex: 1, fontSize: 13, lineHeight: 18, color: theme.colors.mutedForeground },
}));
