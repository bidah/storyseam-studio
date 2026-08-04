import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { toast } from 'sonner-native';
import { X } from 'lucide-react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SegmentedNative } from '@/components/ui/segmented-native';
import { patchJson, postJson } from '@/lib/api';
import { useColors } from '@/lib/colors';
import type { SoundTrack, SoundVersion, TrackKind } from './types';

// Create / edit sheets for the Sound studio. The web app has elaborate
// per-kind prompt builders (mood chips, scene-reference shot pickers, smooth
// outro, character fields…) — mobile keeps only the trivially portable fixed
// lead-ins around a single free-text description, so old kindless-track
// sniffing and the agent's expectations still hold.

export const SEED_AUDIO_CAP = 2048;

const SFX_PREFIX =
  'Use the Seed Audio prompt to create a sound effect for an animated series for kids.';
const VOICE_PREFIX =
  'Use a Seed Audio voice reference to voice-act a dialogue line for an animated series for kids.';

function composePrompt(kind: TrackKind, desc: string, seconds: string): string {
  const d = desc.trim();
  const secs = seconds.trim() ? Number(seconds) : null;
  if (kind === 'sfx') {
    return (
      `${SFX_PREFIX} The sound to create is: ${d}.` +
      (secs ? ` It should be about ${secs} second${secs === 1 ? '' : 's'} long.` : '')
    );
  }
  if (kind === 'voice') {
    return (
      `${VOICE_PREFIX}` +
      ` Match the uploaded voice reference exactly (timbre, pitch, age, tone). Speak only clean` +
      ` dialogue in that voice — no music, no sound effects, no background.` +
      ` Lines: ${d}`
    );
  }
  const lead =
    `Create a background music track that must be ${secs || 15} seconds long. ` +
    `It should have a start, and an ending that finishes the song not abruptly but gracefully.`;
  return d ? `${lead}\n\n${d}` : lead;
}

function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.sheetRoot}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{title}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
            onPress={onClose}
          >
            <X size={16} color={colors.mutedForeground} />
          </Pressable>
        </View>
        <KeyboardAvoidingView
          style={styles.flex1}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            style={styles.flex1}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function CharCount({ text }: { text: string }) {
  const over = text.length > SEED_AUDIO_CAP;
  return (
    <Text style={[styles.charCount, over ? styles.charCountOver : styles.charCountNormal]}>
      {text.length} / {SEED_AUDIO_CAP} chars
    </Text>
  );
}

// ---------------------------------------------------------------------------
// New track: kind picker + name + description + optional duration →
// POST /api/sounds { name, prompt, kind } (v1 starts pending).
export function CreateTrackSheet({
  visible,
  initialKind,
  onClose,
  onCreated,
}: {
  visible: boolean;
  initialKind: TrackKind;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [kind, setKind] = useState<TrackKind>(initialKind);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [seconds, setSeconds] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setKind(initialKind);
      setName('');
      setDesc('');
      setSeconds('');
      setBusy(false);
    }
  }, [visible, initialKind]);

  const prompt = useMemo(() => composePrompt(kind, desc, seconds), [kind, desc, seconds]);
  const over = prompt.length > SEED_AUDIO_CAP;
  const canCreate = !busy && !over && desc.trim().length > 0;

  const create = async () => {
    setBusy(true);
    try {
      await postJson('/api/sounds', {
        ...(name.trim() ? { name: name.trim() } : {}),
        prompt,
        kind,
      });
      toast.success('Track created (pending render)');
      onCreated();
      onClose();
    } catch (e: any) {
      toast.error(`Create failed: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} title="New track" onClose={onClose}>
      <View>
        <Eyebrow>Kind</Eyebrow>
        <SegmentedNative<TrackKind>
          options={[
            { value: 'music', label: 'Music' },
            { value: 'sfx', label: 'SFX' },
            { value: 'voice', label: 'Voice' },
          ]}
          value={kind}
          onChange={setKind}
        />
      </View>

      <View>
        <Eyebrow>Name (optional)</Eyebrow>
        <Input value={name} onChangeText={setName} placeholder="e.g. forest ambience" />
      </View>

      <View>
        <Eyebrow>
          {kind === 'music'
            ? 'Describe the music'
            : kind === 'sfx'
              ? 'Sound to create'
              : 'Dialogue lines'}
        </Eyebrow>
        <Input
          value={desc}
          onChangeText={setDesc}
          multiline
          textAlignVertical="top"
          placeholder={
            kind === 'music'
              ? 'e.g. whimsical, playful — light strings and celesta under a forest chase'
              : kind === 'sfx'
                ? 'e.g. a magical sparkle chime as the fairy waves her wand — short, bright, whimsical'
                : 'e.g. "Oh!" … (1s pause) … "Where is Sara?" (2s) "There you are!"'
          }
        />
      </View>

      {kind !== 'voice' ? (
        <View>
          <Eyebrow>Duration (seconds{kind === 'sfx' ? ', optional' : ''})</Eyebrow>
          <Input
            value={seconds}
            onChangeText={setSeconds}
            keyboardType="number-pad"
            placeholder={kind === 'music' ? '15' : 'e.g. 3'}
            style={styles.secondsInput}
          />
        </View>
      ) : null}

      <View>
        <Eyebrow>Composed prompt</Eyebrow>
        <View style={styles.composedBox}>
          <Text style={styles.composedText}>{prompt}</Text>
        </View>
        <View style={styles.charCountRow}>
          <CharCount text={prompt} />
        </View>
      </View>

      <Button
        title="Create (pending render)"
        disabled={!canCreate}
        loading={busy}
        onPress={create}
      />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Edit a version's prompt — web semantics: "Save as new version" always
// available (POST /api/sounds/:id/version), "Update vN in place" only when the
// prompt changed (PATCH /api/sounds/:id/version/:v).
export function EditVersionSheet({
  editing,
  onClose,
  onSaved,
}: {
  editing: { track: SoundTrack; ver: SoundVersion } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [vname, setVname] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (editing) {
      setPrompt(editing.ver.prompt);
      setVname('');
      setBusy(false);
    }
  }, [editing]);

  if (!editing) return null;
  const { track, ver } = editing;
  const dirty = prompt !== ver.prompt;
  const over = prompt.length > SEED_AUDIO_CAP;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(`Save failed: ${e?.message || e}`);
      setBusy(false);
    }
  };

  return (
    <Sheet visible title={`${track.name} — v${ver.v}`} onClose={onClose}>
      <View>
        <Eyebrow>Prompt</Eyebrow>
        <Input
          value={prompt}
          onChangeText={setPrompt}
          multiline
          textAlignVertical="top"
          style={styles.promptInput}
        />
        <View style={styles.charCountRow}>
          <CharCount text={prompt} />
        </View>
      </View>

      <View>
        <Eyebrow>New version name (optional)</Eyebrow>
        <Input value={vname} onChangeText={setVname} placeholder="e.g. brighter mix" />
      </View>

      <Button
        title="Save as new version"
        disabled={busy || over || !prompt.trim()}
        onPress={() =>
          run(
            () => postJson(`/api/sounds/${track.id}/version`, { prompt, name: vname }),
            'Saved as a new pending version',
          )
        }
      />
      <Button
        variant="outline"
        title={`Update v${ver.v} in place`}
        disabled={busy || over || !dirty || !prompt.trim()}
        onPress={() =>
          run(
            () => patchJson(`/api/sounds/${track.id}/version/${ver.v}`, { prompt }),
            `Updated v${ver.v}`,
          )
        }
      />
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex1: { flex: 1 },
  sheetRoot: { flex: 1, backgroundColor: theme.colors.background },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sheetTitle: { fontSize: 16, fontWeight: '600', color: theme.colors.foreground },
  closeBtn: {
    height: 32,
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: theme.colors.secondary,
  },
  pressed: { opacity: 0.6 },
  scrollContent: { gap: 16, paddingHorizontal: 16, paddingVertical: 16, paddingBottom: 48 },
  charCount: { fontSize: 11 },
  charCountOver: { fontWeight: '600', color: theme.colors.destructive },
  charCountNormal: { color: theme.colors.mutedForeground },
  secondsInput: { width: 112 },
  composedBox: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    padding: 12,
  },
  composedText: { fontSize: 12, lineHeight: 20, color: theme.colors.mutedForeground },
  charCountRow: { marginTop: 6, alignItems: 'flex-end' },
  promptInput: { minHeight: 160, fontSize: 13 },
}));
