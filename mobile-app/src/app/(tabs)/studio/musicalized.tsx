import { useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Info, Music, Sparkles } from 'lucide-react-native';
import { toast } from 'sonner-native';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, Eyebrow } from '@/components/ui/card';
import { Empty, ErrorNote, Loading } from '@/components/ui/empty';
import { TakeAudioProvider, TakePlayButton } from '@/components/radio/take-player';
import { InlineVideo } from '@/components/studio/upscale-video';
import { useSendToAgent } from '@/lib/agent/provider';
import { postJson, putJson } from '@/lib/api';
import { useColors } from '@/lib/colors';
import { useInvalidate, useProjectResource } from '@/lib/queries';
import { useManualRefresh } from '@/lib/use-manual-refresh';
import { useTabBarScrollProps } from '@/lib/use-tab-bar-inset';

// Musicalized — one continuous cue laid under a kept sitting (the mobile port
// of src/routes/musicalized.jsx). What a phone can do: watch a sitting scored
// or bare, edit the Series' music brief, audition its filed cues, lay a cue
// under the film on the server, or hand the whole score to the agent.
//
// Measuring the film's loudness, the contact sheet, the plan editor and the
// in-browser mix preview are WebAudio/canvas work — they stay on the web.

type Sitting = {
  id: string;
  seriesId: string;
  title?: string;
  seconds?: number;
  recordedAt?: string;
  url: string | null;
  scoredUrl: string | null;
  scoredAt?: string | null;
  musicStyle?: string | null;
};
type Cue = { id: string; label?: string; prompt: string; audioUrl?: string | null; seconds?: number; durationMs?: number };
type SeriesInfo = {
  id: string;
  title: string;
  prompts: Record<string, unknown>;
  musicStyle: string | null;
  cues: Cue[];
} | null;
type MusicalizedPayload = { sittings: Sitting[]; series: Record<string, SeriesInfo>; model?: string };

const fmtSecs = (s?: number) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');

// Same turn the web's "Ask the agent" builds (musicalizeMessage in
// src/components/AgentProvider.jsx), minus what only a browser has measured:
// the agent reads the sitting's own seconds instead.
function musicalizeMessage(sitting: Sitting, seriesTitle: string, brief: string, savedBrief: string) {
  const lines = [
    `Make a musicalized version of the kept sitting "${sitting.title || sitting.id}"` +
      ` (sitting ${sitting.id}, Series "${seriesTitle || sitting.seriesId}", seriesId ${sitting.seriesId}).`,
    `Load the score-film skill and follow it.`,
    ``,
    `The film hasn't been measured on my screen yet — use the sitting's own seconds from get_musicalized, never the cue sheet.`,
  ];
  const b = brief.trim();
  if (b) {
    lines.push(``, `Music brief: ${b}`);
    if (b !== savedBrief.trim()) {
      lines.push(`That brief isn't saved yet — save it on the Series first (update_series prompts.musicStyle, keeping the rest of prompts).`);
    }
  } else {
    lines.push(``, `There's no music brief yet — propose one from the Series and the film, and save it once I agree.`);
  }
  lines.push(
    ``,
    `Run plan_score, tell me the cost, and wait for my go before render_cue. Poll it to done,` +
      ` then lay the cue under the film on the server (score_sitting) and tell me it's filed.`,
  );
  return lines.join('\n');
}

function SittingCard({ sitting, series }: { sitting: Sitting; series: SeriesInfo }) {
  const colors = useColors();
  const invalidate = useInvalidate();
  const send = useSendToAgent();
  const [scored, setScored] = useState(!!sitting.scoredUrl);
  const saved = series?.musicStyle ?? '';
  const [brief, setBrief] = useState(saved);
  const [savingBrief, setSavingBrief] = useState(false);
  const [scoringCue, setScoringCue] = useState<string | null>(null);
  useEffect(() => setBrief(saved), [saved]);

  const cues = (series?.cues ?? []).filter((c) => c.audioUrl);

  const saveBrief = async () => {
    if (!series) return;
    setSavingBrief(true);
    try {
      await putJson(`/api/director/series/${encodeURIComponent(series.id)}`, {
        prompts: { ...series.prompts, musicStyle: brief.trim() },
      });
      invalidate('musicalized');
      toast.success('Brief saved');
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setSavingBrief(false);
    }
  };

  const scoreOnServer = async (cue: Cue) => {
    setScoringCue(cue.id);
    try {
      await postJson('/api/musicalized/scored', {
        sittingId: sitting.id,
        seriesId: sitting.seriesId,
        cueUrl: cue.audioUrl,
        musicStyle: brief.trim() || undefined,
      });
      invalidate('musicalized');
      setScored(true);
      toast.success('Scored — the music is under the film');
    } catch (e: any) {
      const msg = String(e?.message || e);
      toast.error(e?.status === 503 ? "Scoring on the server isn't available right now — try it from the web." : msg);
    } finally {
      setScoringCue(null);
    }
  };

  const askAgent = async () => {
    try {
      const turn = send(musicalizeMessage(sitting, series?.title ?? '', brief, saved));
      toast('Sent to agent — watch the chat');
      await turn;
    } catch (e: any) {
      toast.error(String(e?.message || e));
    }
  };

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={styles.flex1}>
          <Text style={styles.title} numberOfLines={1}>
            {sitting.title || series?.title || sitting.id}
          </Text>
          <Text style={styles.muted}>
            {[series?.title, fmtSecs(sitting.seconds), sitting.recordedAt ? new Date(sitting.recordedAt).toLocaleDateString() : '']
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        {sitting.scoredUrl ? <Badge label="Scored" variant="success" /> : <Badge label="Bare" variant="muted" />}
      </View>

      {sitting.scoredUrl ? (
        <View style={styles.toggle}>
          {(['scored', 'bare'] as const).map((k) => {
            const active = (k === 'scored') === scored;
            return (
              <Pressable
                key={k}
                onPress={() => setScored(k === 'scored')}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.toggleBtn, active && styles.toggleBtnActive]}
              >
                <Text style={[styles.toggleText, active && styles.toggleTextActive]}>
                  {k === 'scored' ? 'Scored' : 'Without music'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <InlineVideo key={scored ? 'scored' : 'bare'} url={scored && sitting.scoredUrl ? sitting.scoredUrl : sitting.url} />

      <Eyebrow style={styles.mt}>Music brief</Eyebrow>
      <TextInput
        value={brief}
        onChangeText={setBrief}
        placeholder="What the score should feel like — instruments, mood, where it swells"
        placeholderTextColor={colors.subtleForeground}
        multiline
        style={styles.input}
        accessibilityLabel="Music brief"
      />
      {brief.trim() !== saved.trim() && series ? (
        <Button title="Save brief" size="sm" variant="outline" loading={savingBrief} onPress={saveBrief} />
      ) : null}

      <Eyebrow style={styles.mt}>Cues</Eyebrow>
      {cues.length === 0 ? (
        <Text style={styles.muted}>No cue filed yet — ask the agent to write and render one.</Text>
      ) : (
        cues.map((cue) => (
          <View key={cue.id} style={styles.cue}>
            <Music size={14} color={colors.mutedForeground} />
            <Text style={styles.cueText} numberOfLines={2}>
              {cue.label || cue.prompt}
            </Text>
            <TakePlayButton url={cue.audioUrl ?? null} label={cue.label || 'cue'} />
            <Button
              title="Score"
              size="sm"
              variant="outline"
              loading={scoringCue === cue.id}
              disabled={!!scoringCue}
              onPress={() => scoreOnServer(cue)}
            />
          </View>
        ))
      )}

      <Button style={styles.mt} title="Ask the agent to score" onPress={askAgent}>
        <Sparkles size={16} color={colors.primaryForeground} />
      </Button>
    </Card>
  );
}

export default function MusicalizedScreen() {
  const barInset = useTabBarScrollProps();
  const colors = useColors();
  const { data, isLoading, error, refetch } = useProjectResource<MusicalizedPayload>('musicalized');
  const { refreshing, onRefresh } = useManualRefresh(refetch);

  if (isLoading) return <Loading />;
  if (error) return <ErrorNote message={String((error as Error).message)} onRetry={refetch} />;
  const sittings = data?.sittings ?? [];

  return (
    <TakeAudioProvider>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        {...barInset}
      >
        <View style={styles.note}>
          <Info size={14} color={colors.mutedForeground} />
          <Text style={styles.noteText}>
            Measuring the film, planning the cue by hand and previewing the mix happen on the web.
            Here you can hear the cues, lay one under the film, or ask the agent to score it.
          </Text>
        </View>
        {sittings.length === 0 ? (
          <Empty title="No kept sittings" hint="Keep a sitting on the Stage and it shows up here, ready to score." />
        ) : (
          sittings.map((s) => <SittingCard key={s.id} sitting={s} series={data?.series?.[s.seriesId] ?? null} />)
        )}
      </ScrollView>
    </TakeAudioProvider>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { padding: 16, paddingBottom: 32, gap: 12 },
  flex1: { flex: 1 },
  mt: { marginTop: 12 },
  card: { gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 16, fontWeight: '600', color: theme.colors.foreground },
  muted: { fontSize: 12, color: theme.colors.mutedForeground },
  note: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  noteText: { flex: 1, fontSize: 13, lineHeight: 18, color: theme.colors.mutedForeground },
  toggle: { flexDirection: 'row', gap: 6 },
  toggleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  toggleBtnActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  toggleText: { fontSize: 13, color: theme.colors.foreground },
  toggleTextActive: { color: theme.colors.primaryForeground },
  input: {
    minHeight: 72,
    padding: 10,
    borderRadius: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.input,
    color: theme.colors.foreground,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  cue: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cueText: { flex: 1, fontSize: 13, color: theme.colors.foreground },
}));
