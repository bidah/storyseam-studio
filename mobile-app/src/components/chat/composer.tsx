import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { KeyboardController, KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import * as Crypto from 'expo-crypto';
import { Image } from 'expo-image';
import { toast } from 'sonner-native';
import { router } from 'expo-router';
import { ArrowUp, Check, ChevronDown, CircleStop, ImagePlus, Mic, X } from 'lucide-react-native';
import { AGENT_MODELS, useAgentModelStore } from '@/lib/agent-model';
import { transcribeAudio } from '@/lib/api';
import { formatDuration, useAudioRecording } from '@/lib/use-audio-recording';
import { GlassGroup, GlassSurface } from './glass-surface';
import { PulsingDot } from './pulsing-dot';
import { useChatColors } from './theme';

// Image picked from the library, not yet uploaded (upload happens on send).
export type LocalAttachment = {
  id: string;
  uri: string;
  name: string;
  mime: string;
};

// Composer: a liquid-glass bar that FLOATS over the transcript, riding the
// keyboard (KeyboardStickyView translates it). The chat stack's layout docks ONE
// instance over the whole stack (see composer-host.tsx) — screens push and pop
// underneath it — and screens pad their lists by `onHeightChange` so messages
// scroll *underneath*. That pass-behind is the whole point of the glass: without
// content moving under it there's nothing to refract and it reads as a flat card.
export function Composer({
  pending,
  busy,
  onStop,
  onSubmit,
  onHeightChange,
  focusTick,
  draft,
}: {
  /** A HITL input request is awaiting an answer (typed text becomes its response). */
  pending: boolean;
  busy: boolean;
  onStop: () => void;
  /** Uploads + dispatches; resolves once the turn is dispatched. Throws to keep composer content. */
  onSubmit: (text: string, atts: LocalAttachment[]) => Promise<void>;
  /** Measured height of the docked bar, so the screen can inset the transcript. */
  onHeightChange?: (height: number) => void;
  /**
   * Text to drop into the field, unsent — the tab bar pill's dictation hand-off
   * (lib/agent/voice-capture.tsx). Applied once per `key`, and APPENDED to
   * whatever is already typed, exactly like the mic button below.
   */
  draft?: { key: string; text: string };
  /**
   * Non-zero to open the keyboard here. A number rather than a ref so a host can
   * ask for the caret without holding an imperative handle (the focus happens by
   * remounting the input — see the field below): the conversation passes 1 when it
   * was opened from the tab bar's accessory pill, which is a tap on something that
   * looks like a text field and should leave you typing.
   */
  focusTick?: number;
}) {
  const c = useChatColors();
  const insets = useSafeAreaInsets();
  const modelId = useAgentModelStore((s) => s.model);
  const model = AGENT_MODELS.find((m) => m.id === modelId) ?? AGENT_MODELS[0];
  const [text, setText] = useState('');
  const [atts, setAtts] = useState<LocalAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const rec = useAudioRecording();
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // A dictated draft handed over from the tab bar's pill. Keyed rather than
  // value-compared: the same words twice are two hand-offs, and a re-render (or a
  // remount of this bar) must not paste them a third time.
  const appliedDraft = useRef<string | null>(null);
  useEffect(() => {
    if (!draft || appliedDraft.current === draft.key) return;
    appliedDraft.current = draft.key;
    setText((prev) => (prev.trim() ? `${prev.trim()} ${draft.text}` : draft.text));
  }, [draft]);

  // Report the bar's height up so the transcript can reserve room under it.
  const measure = (e: LayoutChangeEvent) => onHeightChange?.(e.nativeEvent.layout.height);

  // Everything on the card that isn't a control is a target for the input: the
  // dead space beside the model chip, the padding around the row, the gap under
  // the placeholder. Tapping any of it opens the keyboard, so the whole bar
  // behaves like one big text field instead of a narrow line to aim at.
  const focusInput = () => inputRef.current?.focus();

  const canSend = (text.trim().length > 0 || atts.length > 0) && !busy && !sending;
  // The mic is always available (except mid-turn / mid-send) so you can dictate
  // into an empty composer OR keep appending more voice to an existing draft.
  const showMic = !busy && !sending;

  const pick = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        toast.error('Photo library access is needed to attach images.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 6,
        quality: 0.9,
      });
      if (result.canceled) return;
      const added: LocalAttachment[] = (result.assets || []).map((a) => {
        const ext = (a.fileName?.split('.').pop() || 'jpg').toLowerCase();
        return {
          id: Crypto.randomUUID(),
          uri: a.uri,
          name: a.fileName || `image-${Date.now()}.${ext}`,
          mime: a.mimeType || 'image/jpeg',
        };
      });
      if (added.length) setAtts((prev) => [...prev, ...added]);
    } catch {
      toast.error('Could not open the photo library.');
    }
  };

  const submit = async () => {
    if (!canSend) return;
    // Two taps bracket a turn: this small one on send, and a matching Light
    // impact when the agent's reply FINISHES (see lib/agent/provider.tsx). Kept
    // at Light so the pair reads as one soft "sent … answered" rhythm rather
    // than a thump on the way out; it fires on press so the button still feels
    // instant while onSubmit uploads any attachments.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setSending(true);
    try {
      await onSubmit(text, atts);
      setText('');
      setAtts([]);
      // Drop focus so the keyboard slides away and the agent's reply gets the
      // full screen — the message is already sent (TOO-8).
      KeyboardController.dismiss();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Send failed: ${msg}`);
    } finally {
      setSending(false);
    }
  };

  const startRecording = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      await rec.start();
      setRecording(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  // Discard the take without transcribing.
  const cancelRecording = async () => {
    setRecording(false);
    await rec.stop();
  };

  // Stop, transcribe, and drop the text into the composer (appended if the user
  // already has a draft). Stays on the recording bar showing "Transcribing…".
  const confirmRecording = async () => {
    setRecording(false);
    setTranscribing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      const uri = await rec.stop();
      if (!uri) throw new Error('No audio captured');
      const { text: heard } = await transcribeAudio(uri);
      const trimmed = (heard || '').trim();
      if (!trimmed) {
        toast.error("Didn't catch that — try again.");
        return;
      }
      setText((prev) => (prev.trim() ? `${prev.trim()} ${trimmed}` : trimmed));
    } catch (e) {
      toast.error(`Transcription failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTranscribing(false);
    }
  };

  return (
    <KeyboardStickyView
      // The bar docks on the bottom edge of whatever screen hosts it (whose safe
      // area already ends above the tab bar), so it needs no lift while the
      // keyboard is down; `opened` is what keeps it clear of the home indicator
      // once the keyboard has it.
      offset={{ closed: 0, opened: insets.bottom }}
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}
    >
      <View
        onLayout={measure}
        style={{ paddingHorizontal: 15, paddingBottom: Math.max(insets.bottom, 8) + 5 }}
      >
        <GlassGroup spacing={12}>
        <GlassSurface
          glassEffectStyle="regular"
          // Interactive glass: UIKit swells the surface under a press (and under
          // a press-and-hold) and springs it back on release. Free, native, and
          // it makes the whole bar feel like one physical control — which is
          // exactly what the tap-anywhere-to-focus target promises.
          isInteractive
          fallbackColor={c.card}
          // No border on the glass path — see GlassSurface: a CALayer border
          // can't follow the interactive swell, so it reads as a second, static
          // edge inside the growing one.
          fallbackBorderColor={c.border}
          style={{
            borderRadius: 0,
            paddingHorizontal: 12,
            paddingTop: 10,
            paddingBottom: 8,
            gap: 8,
          }}
        >
          {recording || transcribing ? (
            <RecordingBar
              transcribing={transcribing}
              duration={rec.duration}
              onCancel={cancelRecording}
              onConfirm={confirmRecording}
            />
          ) : (
          <>
          {/* Behind everything else: the card's dead space, focusing the input.
              Rendered first so every control below paints (and hit-tests) on top
              of it. Not an accessibility element — the TextInput already is. */}
          <Pressable
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            style={StyleSheet.absoluteFill}
            onPress={focusInput}
          />

          {atts.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View style={styles.attRow}>
                {atts.map((a) => (
                  <View key={a.id}>
                    <Image
                      source={{ uri: a.uri }}
                      accessibilityLabel={a.name}
                      contentFit="cover"
                      style={{ width: 56, height: 56, borderRadius: 0, backgroundColor: c.muted }}
                    />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${a.name}`}
                      style={styles.attRemove}
                      onPress={() => setAtts((prev) => prev.filter((x) => x.id !== a.id))}
                    >
                      <X size={11} color={c.foreground} />
                    </Pressable>
                  </View>
                ))}
              </View>
            </ScrollView>
          ) : null}

          <TextInput
            // Focus handed over from the tab bar's accessory arrives as a
            // REMOUNT (new key + `autoFocus`), not `inputRef.current.focus()`:
            // on this stack the ref is only live inside an event handler —
            // read from an effect it is still null, so the imperative call is
            // a no-op (same family as the dead scroll refs the conversation
            // screen works around). Remounting is safe: the draft lives in
            // `text` above, not in the field.
            key={`input-${focusTick ?? 0}`}
            autoFocus={!!focusTick}
            ref={inputRef}
            style={styles.input}
            placeholder={pending ? 'Type your answer…' : 'Message the studio agent…'}
            placeholderTextColor={c.mutedForeground}
            multiline
            value={text}
            onChangeText={setText}
            editable={!sending}
          />

          {/* box-none: the row itself is transparent to touches, so the empty
              stretch between the model chip and the send/mic group falls through
              to the focus target underneath instead of being swallowed here. */}
          <View style={styles.controlsRow} pointerEvents="box-none">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Attach image"
              disabled={sending}
              style={({ pressed }) => [
                styles.iconBtn,
                styles.iconBtnOutline,
                pressed && styles.pressed60,
                sending && styles.dim50,
              ]}
              onPress={pick}
            >
              <ImagePlus size={17} color={c.mutedForeground} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Model: ${model.label}`}
              style={({ pressed }) => [styles.modelChip, pressed && styles.pressed60]}
              onPress={() => router.push('/model-picker')}
            >
              <Text style={styles.modelChipText} numberOfLines={1}>
                {model.label}
              </Text>
              <ChevronDown size={13} color={c.mutedForeground} />
            </Pressable>

            <View style={styles.trailingRow} pointerEvents="box-none">
              {busy ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Stop"
                  style={({ pressed }) => [styles.iconBtn, styles.stopBtn, pressed && styles.pressed70]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                    onStop();
                  }}
                >
                  <CircleStop size={19} color={c.foreground} />
                </Pressable>
              ) : (
                <>
                  {/* Mic stays alongside Send: dictate into an empty draft, or
                      keep appending more voice to what's already typed. */}
                  {showMic ? (
                    canSend ? (
                      // Secondary next to Send.
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Record voice message"
                        style={({ pressed }) => [styles.iconBtn, styles.iconBtnOutline, pressed && styles.pressed60]}
                        onPress={startRecording}
                      >
                        <Mic size={18} color={c.mutedForeground} />
                      </Pressable>
                    ) : (
                      // Primary action when there's nothing to send yet.
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Record voice message"
                        style={({ pressed }) => [
                          styles.iconBtn,
                          { backgroundColor: c.higgsfield },
                          pressed && styles.pressed80,
                        ]}
                        onPress={startRecording}
                      >
                        <Mic size={18} color={c.higgsfieldForeground} />
                      </Pressable>
                    )
                  ) : null}
                  {canSend || sending ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={sending ? 'Sending' : 'Send'}
                      disabled={!canSend}
                      style={({ pressed }) => [
                        styles.iconBtn,
                        { backgroundColor: c.higgsfield },
                        pressed && styles.pressed80,
                        !canSend && styles.dim40,
                      ]}
                      onPress={submit}
                    >
                      {sending ? (
                        <ActivityIndicator size="small" color={c.higgsfieldForeground} />
                      ) : (
                        <ArrowUp size={18} color={c.higgsfieldForeground} />
                      )}
                    </Pressable>
                  ) : null}
                </>
              )}
            </View>
          </View>
          </>
          )}
        </GlassSurface>
        </GlassGroup>
      </View>
    </KeyboardStickyView>
  );
}

// The composer's input row while recording / transcribing: cancel · status ·
// timer · confirm. Mirrors the reference app's RecordingInput. Exported so the
// Visual world composer reuses the exact same recording input.
export function RecordingBar({
  transcribing,
  duration,
  onCancel,
  onConfirm,
}: {
  transcribing: boolean;
  duration: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const c = useChatColors();
  return (
    <View style={styles.recordingRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cancel recording"
        disabled={transcribing}
        style={({ pressed }) => [
          styles.iconBtn,
          styles.iconBtnOutline,
          pressed && styles.pressed60,
          transcribing && styles.dim40,
        ]}
        onPress={onCancel}
      >
        <X size={17} color={c.mutedForeground} />
      </Pressable>

      <View style={styles.recordingStatus}>
        {transcribing ? (
          <ActivityIndicator size="small" color={c.mutedForeground} />
        ) : (
          <PulsingDot />
        )}
        <Text style={styles.recordingLabel}>
          {transcribing ? 'Transcribing…' : 'Recording…'}
        </Text>
        {!transcribing ? (
          <Text style={styles.recordingTimer}>{formatDuration(duration)}</Text>
        ) : null}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Stop and transcribe"
        disabled={transcribing}
        style={({ pressed }) => [
          styles.iconBtn,
          styles.recordingConfirm,
          { backgroundColor: c.higgsfield },
          pressed && styles.pressed80,
          transcribing && styles.dim40,
        ]}
        onPress={onConfirm}
      >
        <Check size={18} color={c.higgsfieldForeground} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  attRow: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 4,
  },
  attRemove: {
    position: 'absolute',
    right: -6,
    top: -6,
    height: 20,
    width: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: theme.colors.secondary,
  },
  input: {
    maxHeight: 128,
    paddingHorizontal: 4,
    paddingVertical: 4,
    fontSize: 15,
    lineHeight: 20,
    color: theme.colors.foreground,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconBtn: {
    height: 36,
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  iconBtnOutline: {
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  stopBtn: {
    backgroundColor: theme.colors.secondary,
  },
  pressed60: { opacity: 0.6 },
  pressed70: { opacity: 0.7 },
  pressed80: { opacity: 0.8 },
  dim40: { opacity: 0.4 },
  dim50: { opacity: 0.5 },
  modelChip: {
    marginLeft: 8,
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 12,
  },
  modelChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: theme.colors.foreground,
  },
  trailingRow: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recordingRow: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
  },
  recordingStatus: {
    marginLeft: 12,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recordingLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.foreground,
  },
  recordingTimer: {
    marginLeft: 'auto',
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    color: theme.colors.mutedForeground,
  },
  recordingConfirm: {
    marginLeft: 12,
  },
}));
