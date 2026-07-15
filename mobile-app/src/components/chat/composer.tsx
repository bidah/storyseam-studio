import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import * as Crypto from 'expo-crypto';
import { Image } from 'expo-image';
import { toast } from 'sonner-native';
import { ArrowUp, CircleStop, ImagePlus, X } from 'lucide-react-native';
import { cn } from '@/lib/utils';
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
  const [text, setText] = useState('');
  const [atts, setAtts] = useState<LocalAttachment[]>([]);
  const [sending, setSending] = useState(false);

  const canSend = (text.trim().length > 0 || atts.length > 0) && !busy && !sending;

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
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Send failed: ${msg}`);
    } finally {
      setSending(false);
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
        </GlassSurface>
      </View>
    </KeyboardStickyView>
  );
}
