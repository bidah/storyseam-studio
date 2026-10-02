import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { router, useFocusEffect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { toast } from 'sonner-native';
import {
  ArrowRight,
  ArrowUp,
  Bot,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Clock,
  Feather,
  Mic2,
  Monitor,
  Music,
  Palette,
  Users,
  type LucideIcon,
} from 'lucide-react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Button } from '@/components/ui/button';
import { postJson } from '@/lib/api';
import { useColors } from '@/lib/colors';
import {
  FILM_DEPTHS,
  FILM_STYLES,
  FILM_VOICES,
  FILM_WRITERS,
  OFFERED_FILM_WRITERS,
  FLOWS,
  GEN_MODES,
  MAX_PROMPT_CHARS,
  formatLength,
  hydrateFilmOptions,
  latestFilm,
  roomEstimate,
  startFilm,
  useFilmOptions,
} from '@/lib/film';
import { createPickerRequest } from '@/lib/picker-bus';
import { useAdoptProject } from '@/lib/use-adopt-project';
import { useTabBarScrollProps } from '@/lib/use-tab-bar-inset';
import { useManualRefresh } from '@/lib/use-manual-refresh';

// The Create tab's landing — the web root's prompt box on a phone. The first
// thing the app shows: a prompt, the options that shape the Film, and a send.
// A Film makes its own project and runs on StorySeam's account (no render key),
// so this works before the author has added one.
//
// Below it, the other way in (the studio agent, on a new project of its own),
// then the author's latest stories — each opens its step view.

async function sheetPick(title: string, options: { value: string; label: string }[], selected: string) {
  const { requestId, promise } = createPickerRequest();
  router.push({
    pathname: '/option-picker',
    params: { requestId, title, options: JSON.stringify(options), selected },
  });
  return (await promise) as string | null;
}

function OptionChip({ icon: Icon, label, onPress, a11y }: { icon: LucideIcon; label: string; onPress: () => void; a11y: string }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={a11y}
    >
      <Icon size={13} color={colors.mutedForeground} />
      <Text style={styles.chipText}>{label}</Text>
      <ChevronDown size={12} color={colors.subtleForeground} />
    </Pressable>
  );
}

export default function CreateScreen() {
  const colors = useColors();
  const barInset = useTabBarScrollProps();
  const queryClient = useQueryClient();
  const adopt = useAdoptProject();
  const o = useFilmOptions();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ message: string; filmId?: string; projectId?: string } | null>(null);
  const [projectName, setProjectName] = useState('');
  const [launching, setLaunching] = useState(false);

  useEffect(hydrateFilmOptions, []);

  const latest = useQuery({ queryKey: ['account', 'films', 'latest'], queryFn: latestFilm, staleTime: 15_000 });
  // Coming back from a Film's page: its status may have moved on.
  useFocusEffect(
    useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['account', 'films'] });
    }, [queryClient]),
  );

  const { refreshing, onRefresh } = useManualRefresh(latest.refetch);
  const flow = FLOWS[o.flow];
  const seconds = o.seconds[o.flow] ?? flow.defaultSeconds;
  const storyEngine = flow.engine !== null;
  const room = roomEstimate(o.specialists);
  const inFlight =
    latest.data?.job && ['running', 'awaiting-confirm', 'queued'].includes(latest.data.job.status) ? latest.data : null;

  const openFilm = (filmId: string, projectId?: string | null) => {
    adopt(projectId);
    router.push({ pathname: '/create/[filmId]', params: { filmId } });
  };

  const send = async () => {
    const prompt = o.draft.trim();
    if (!prompt || sending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setSending(true);
    setError(null);
    try {
      const r = await startFilm(prompt, o);
      if (r.ok) {
        o.setDraft('');
        queryClient.invalidateQueries({ queryKey: ['account', 'films'] });
        openFilm(r.filmId, r.projectId);
      } else {
        setError({ message: r.message, filmId: r.filmId, projectId: r.projectId });
      }
    } catch (e: any) {
      setError({ message: String(e?.message || e) });
    } finally {
      setSending(false);
    }
  };

  // The other way in: a named project with the studio agent, no Film. The web
  // opens the studio root; here that's Home, where the tab bar's pill is the
  // agent's composer.
  const launchStudio = async () => {
    const name = projectName.trim();
    if (!name) {
      toast.error('Name the project first.');
      return;
    }
    setLaunching(true);
    try {
      const r = await postJson<{ project?: { id: string } }>('/api/projects', { name });
      if (!r.project?.id) throw new Error("Couldn't create the project");
      adopt(r.project.id, name);
      setProjectName('');
      router.navigate('/(tabs)/chat');
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setLaunching(false);
    }
  };

  const pickMode = async () => {
    const v = await sheetPick(
      'Gen mode',
      GEN_MODES.map((f) => ({ value: f.id, label: f.label })),
      o.flow,
    );
    if (v) o.set({ flow: v as typeof o.flow });
  };
  const pickLength = async () => {
    const v = await sheetPick(
      'Length',
      flow.steps.map((s) => ({ value: String(s), label: formatLength(s) })),
      String(seconds),
    );
    if (v) o.set({ seconds: { ...o.seconds, [o.flow]: Number(v) } });
  };
  const pickLook = async () => {
    const v = await sheetPick(
      'Look',
      FILM_STYLES.map((s) => ({ value: s.id || 'auto', label: s.label })),
      o.style || 'auto',
    );
    if (v) o.set({ style: v === 'auto' ? '' : v });
  };
  const pickWriter = async () => {
    const v = await sheetPick(
      'Writer',
      OFFERED_FILM_WRITERS.map((w) => ({ value: w.id, label: `${w.label} — ${w.blurb}` })),
      o.writer,
    );
    if (v) o.set({ writer: v });
  };
  const pickDepth = async () => {
    const v = await sheetPick(
      'Script',
      FILM_DEPTHS.map((d) => ({ value: d.id, label: `${d.label} — ${d.blurb}` })),
      o.depth,
    );
    if (v) o.set({ depth: v as 'fast' | 'deep' });
  };
  const pickVoices = async () => {
    const v = await sheetPick(
      'Voices',
      FILM_VOICES.map((x) => ({ value: x.id, label: `${x.label} — ${x.blurb}` })),
      o.voices,
    );
    if (v) o.set({ voices: v });
  };
  const pickScore = async () => {
    const v = await sheetPick(
      'Score',
      [
        { value: 'on', label: 'Scored — one continuous cue under the Film' },
        { value: 'off', label: 'No score' },
      ],
      o.score ? 'on' : 'off',
    );
    if (v) o.set({ score: v === 'on' });
  };
  const pickResolution = async () => {
    const v = await sheetPick(
      'Resolution',
      [
        { value: '480p', label: '480p' },
        { value: '720p', label: '720p — about 2× the cost' },
      ],
      o.resolution,
    );
    if (v) o.set({ resolution: v as '480p' | '720p' });
  };

  const canSend = o.draft.trim().length > 0 && !sending;
  const writerLabel = FILM_WRITERS.find((w) => w.id === o.writer)?.label ?? o.writer;

  return (
    <KeyboardAwareScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      bottomOffset={24}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      {...barInset}
    >
      <Text style={styles.hero} accessibilityRole="header">
        Create a film with just a prompt
      </Text>

      <View style={styles.box}>
        <TextInput
          value={o.draft}
          onChangeText={(t) => o.setDraft(t.slice(0, MAX_PROMPT_CHARS))}
          placeholder="Tell the story you want to bring to life"
          placeholderTextColor={colors.subtleForeground}
          multiline
          style={styles.input}
          accessibilityLabel="Story prompt"
        />
        <View style={styles.boxFooter}>
          <Text style={styles.modeHint} numberOfLines={1}>
            {flow.label} · {formatLength(seconds)}
          </Text>
          <Pressable
            onPress={send}
            disabled={!canSend}
            style={({ pressed }) => [styles.send, !canSend && styles.sendOff, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Create the film"
          >
            {sending ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <ArrowUp size={18} color={colors.primaryForeground} />
            )}
          </Pressable>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <OptionChip icon={Clapperboard} label={flow.label} a11y="Gen mode" onPress={pickMode} />
        <OptionChip icon={Clock} label={formatLength(seconds)} a11y="Length" onPress={pickLength} />
        <OptionChip
          icon={Palette}
          label={FILM_STYLES.find((s) => s.id === o.style)?.label ?? 'Auto'}
          a11y="Look"
          onPress={pickLook}
        />
        <OptionChip
          icon={Feather}
          label={o.depth === 'deep' ? 'Deep script' : 'Fast script'}
          a11y="Script depth"
          onPress={pickDepth}
        />
        {OFFERED_FILM_WRITERS.length > 1 ? (
          <OptionChip icon={Bot} label={writerLabel} a11y="Writer" onPress={pickWriter} />
        ) : null}
        {storyEngine ? (
          <OptionChip
            icon={Mic2}
            label={FILM_VOICES.find((x) => x.id === o.voices)?.label ?? 'Voices'}
            a11y="Voices"
            onPress={pickVoices}
          />
        ) : null}
        <OptionChip icon={Music} label={o.score ? 'Scored' : 'No score'} a11y="Score" onPress={pickScore} />
        <OptionChip icon={Monitor} label={o.resolution} a11y="Resolution" onPress={pickResolution} />
      </ScrollView>

      <Text style={styles.blurb}>{flow.blurb}</Text>

      {o.depth === 'deep' ? (
        <Pressable
          onPress={() => router.push('/create/room')}
          style={({ pressed }) => [styles.roomRow, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Writers' room"
        >
          <Users size={15} color={colors.primary} />
          <Text style={styles.roomText}>
            Writers' room · {room.passes} {room.passes === 1 ? 'specialist' : 'specialists'} · {room.label} wait
          </Text>
          <ChevronRight size={15} color={colors.subtleForeground} />
        </Pressable>
      ) : null}

      {error ? (
        <View style={styles.error}>
          <Text style={styles.errorText}>{error.message}</Text>
          {error.filmId ? (
            <Pressable onPress={() => openFilm(error.filmId!, error.projectId)} accessibilityRole="link">
              <Text style={styles.link}>View the story being made</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {inFlight?.filmId ? (
        <Pressable
          onPress={() => openFilm(inFlight.filmId!, inFlight.projectId)}
          style={({ pressed }) => [styles.inFlight, pressed && styles.pressed]}
          accessibilityRole="link"
          accessibilityLabel="A story is being made — view it"
        >
          <ActivityIndicator size="small" />
          <Text style={styles.inFlightText}>A story is being made</Text>
          <Text style={styles.link}>view it</Text>
          <ArrowRight size={14} color={colors.primary} />
        </Pressable>
      ) : null}

      <View style={styles.orRow}>
        <View style={styles.rule} />
        <Text style={styles.or}>or</Text>
        <View style={styles.rule} />
      </View>

      <View style={styles.agentCard}>
        <Text style={styles.agentTitle}>Create a story with the studio agent</Text>
        <Text style={styles.agentBlurb}>
          Build it step by step instead: the agent writes the Bible, the script and the shot list with you, and
          renders what you approve.
        </Text>
        <TextInput
          value={projectName}
          onChangeText={setProjectName}
          placeholder="New project name"
          placeholderTextColor={colors.subtleForeground}
          style={styles.nameInput}
          returnKeyType="go"
          onSubmitEditing={launchStudio}
          accessibilityLabel="New project name"
        />
        <Button title="Launch agent" loading={launching} onPress={launchStudio} />
      </View>

      <Pressable
        onPress={() => router.push('/create/stories')}
        style={({ pressed }) => [styles.storiesButton, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Latest stories"
      >
        <Clapperboard size={16} color={colors.foreground} />
        <Text style={styles.storiesButtonText}>Latest stories</Text>
        <ChevronRight size={16} color={colors.subtleForeground} />
      </Pressable>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },
  hero: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: theme.colors.foreground,
    marginBottom: 16,
  },
  box: {
    borderRadius: 0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    padding: 14,
    gap: 10,
  },
  input: {
    minHeight: 120,
    maxHeight: 260,
    fontSize: 16,
    lineHeight: 22,
    color: theme.colors.foreground,
    textAlignVertical: 'top',
  },
  boxFooter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modeHint: { flex: 1, fontSize: 13, color: theme.colors.mutedForeground },
  send: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primary,
  },
  sendOff: { opacity: 0.35 },
  pressed: { opacity: 0.6 },
  chips: { gap: 8, paddingVertical: 12 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  chipText: { fontSize: 13, fontWeight: '500', color: theme.colors.foreground },
  blurb: { fontSize: 13, lineHeight: 18, color: theme.colors.mutedForeground },
  roomRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 0,
    backgroundColor: theme.colors.muted,
  },
  roomText: { flex: 1, fontSize: 13, color: theme.colors.foreground },
  error: { marginTop: 12, gap: 6 },
  errorText: { fontSize: 14, color: theme.colors.destructive },
  link: { fontSize: 14, fontWeight: '600', color: theme.colors.primary },
  inFlight: { marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  inFlightText: { fontSize: 14, color: theme.colors.foreground },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 24 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border },
  or: { fontSize: 13, color: theme.colors.mutedForeground },
  agentCard: {
    gap: 10,
    padding: 16,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  agentTitle: { fontSize: 16, fontWeight: '700', color: theme.colors.foreground },
  agentBlurb: { fontSize: 14, lineHeight: 19, color: theme.colors.mutedForeground },
  nameInput: {
    height: 44,
    paddingHorizontal: 12,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.background,
    fontSize: 15,
    color: theme.colors.foreground,
  },
  storiesButton: {
    marginTop: 20,
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  storiesButtonText: { flex: 1, fontSize: 15, fontWeight: '600', color: theme.colors.foreground },
}));
