import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { KeyboardController, KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import * as Crypto from 'expo-crypto';
import { Image } from 'expo-image';
import { toast } from 'sonner-native';
import { router } from 'expo-router';
import { ArrowUp, Check, ChevronDown, CircleStop, ImagePlus, Mic, X } from 'lucide-react-native';
import { cn } from '@/lib/utils';
import { AGENT_MODELS, useAgentModelStore } from '@/lib/agent-model';
import { transcribeAudio } from '@/lib/api';
import { formatDuration, useAudioRecording } from '@/lib/use-audio-recording';
import { GlassSurface } from './glass-surface';
import { chatColors } from './theme';

// Image picked from the library, not yet uploaded (upload happens on send).
export type LocalAttachment = {
  id: string;
  uri: string;
  name: string;
  mime: string;
};

// Composer: glass surface riding the keyboard (KeyboardStickyView translates
// it; the message list reserves matching space via its animated footer spacer).
export function Composer({
  pending,
  busy,
  onStop,
  onSubmit,
}: {
  /** A HITL input request is awaiting an answer (typed text becomes its response). */
  pending: boolean;
  busy: boolean;
  onStop: () => void;
  /** Uploads + dispatches; resolves once the turn is dispatched. Throws to keep composer content. */
  onSubmit: (text: string, atts: LocalAttachment[]) => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const modelId = useAgentModelStore((s) => s.model);
  const model = AGENT_MODELS.find((m) => m.id === modelId) ?? AGENT_MODELS[0];
  const [text, setText] = useState('');
  const [atts, setAtts] = useState<LocalAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const rec = useAudioRecording();
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const canSend = (text.trim().length > 0 || atts.length > 0) && !busy && !sending;
  // Empty composer → the send button becomes a push-to-talk mic.
  const showMic = !busy && !sending && text.trim().length === 0 && atts.length === 0;

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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
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
    <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
      <View style={{ paddingHorizontal: 15, paddingBottom: Math.max(insets.bottom, 8) + 5 }}>
        <GlassSurface
          glassEffectStyle="regular"
          fallbackColor={chatColors.card}
          style={{
            borderRadius: 24,
            overflow: 'hidden',
            paddingHorizontal: 12,
            paddingTop: 10,
            paddingBottom: 8,
            gap: 8,
            borderWidth: 1,
            borderColor: chatColors.border,
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
          {atts.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View className="flex-row gap-3 py-1">
                {atts.map((a) => (
                  <View key={a.id}>
                    <Image
                      source={{ uri: a.uri }}
                      accessibilityLabel={a.name}
                      contentFit="cover"
                      style={{ width: 56, height: 56, borderRadius: 8, backgroundColor: chatColors.muted }}
                    />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${a.name}`}
                      className="absolute -right-1.5 -top-1.5 h-5 w-5 items-center justify-center rounded-full bg-secondary"
                      onPress={() => setAtts((prev) => prev.filter((x) => x.id !== a.id))}
                    >
                      <X size={11} color={chatColors.foreground} />
                    </Pressable>
                  </View>
                ))}
              </View>
            </ScrollView>
          ) : null}

          <TextInput
            className="max-h-32 px-1 py-1 text-[15px] leading-5 text-foreground"
            placeholder={pending ? 'Type your answer…' : 'Message the studio agent…'}
            placeholderTextColor={chatColors.mutedForeground}
            multiline
            value={text}
            onChangeText={setText}
            editable={!sending}
          />

          <View className="flex-row items-center">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Attach image"
              disabled={sending}
              className={cn(
                'h-9 w-9 items-center justify-center rounded-full border border-border active:opacity-60',
                sending && 'opacity-50',
              )}
              onPress={pick}
            >
              <ImagePlus size={17} color={chatColors.mutedForeground} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Model: ${model.label}`}
              className="ml-2 h-9 flex-row items-center gap-1 rounded-full border border-border px-3 active:opacity-60"
              onPress={() => router.push('/model-picker')}
            >
              <Text className="text-[13px] font-medium text-foreground" numberOfLines={1}>
                {model.label}
              </Text>
              <ChevronDown size={13} color={chatColors.mutedForeground} />
            </Pressable>

            <View className="ml-auto">
              {busy ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Stop"
                  className="h-9 w-9 items-center justify-center rounded-full bg-secondary active:opacity-70"
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                    onStop();
                  }}
                >
                  <CircleStop size={19} color={chatColors.foreground} />
                </Pressable>
              ) : showMic ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Record voice message"
                  style={{ backgroundColor: chatColors.higgsfield }}
                  className="h-9 w-9 items-center justify-center rounded-full active:opacity-80"
                  onPress={startRecording}
                >
                  <Mic size={18} color={chatColors.higgsfieldForeground} />
                </Pressable>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={sending ? 'Sending' : 'Send'}
                  disabled={!canSend}
                  style={{ backgroundColor: chatColors.higgsfield }}
                  className={cn(
                    'h-9 w-9 items-center justify-center rounded-full active:opacity-80',
                    !canSend && 'opacity-40',
                  )}
                  onPress={submit}
                >
                  {sending ? (
                    <ActivityIndicator size="small" color={chatColors.higgsfieldForeground} />
                  ) : (
                    <ArrowUp size={18} color={chatColors.higgsfieldForeground} />
                  )}
                </Pressable>
              )}
            </View>
          </View>
          </>
          )}
        </GlassSurface>
      </View>
    </KeyboardStickyView>
  );
}

// A red dot that pulses while recording — the only motion in the recording bar.
function PulsingDot() {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.3, duration: 500, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#ef4444', opacity }}
    />
  );
}

// The composer's input row while recording / transcribing: cancel · status ·
// timer · confirm. Mirrors the reference app's RecordingInput.
function RecordingBar({
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
  return (
    <View className="h-11 flex-row items-center">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cancel recording"
        disabled={transcribing}
        className={cn(
          'h-9 w-9 items-center justify-center rounded-full border border-border active:opacity-60',
          transcribing && 'opacity-40',
        )}
        onPress={onCancel}
      >
        <X size={17} color={chatColors.mutedForeground} />
      </Pressable>

      <View className="ml-3 flex-1 flex-row items-center gap-2">
        {transcribing ? (
          <ActivityIndicator size="small" color={chatColors.mutedForeground} />
        ) : (
          <PulsingDot />
        )}
        <Text className="text-[14px] font-medium text-foreground">
          {transcribing ? 'Transcribing…' : 'Recording…'}
        </Text>
        {!transcribing ? (
          <Text className="ml-auto text-[13px] tabular-nums text-muted-foreground">
            {formatDuration(duration)}
          </Text>
        ) : null}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Stop and transcribe"
        disabled={transcribing}
        style={{ backgroundColor: chatColors.higgsfield }}
        className={cn(
          'ml-3 h-9 w-9 items-center justify-center rounded-full active:opacity-80',
          transcribing && 'opacity-40',
        )}
        onPress={onConfirm}
      >
        <Check size={18} color={chatColors.higgsfieldForeground} />
      </Pressable>
    </View>
  );
}
