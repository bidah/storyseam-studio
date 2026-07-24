/* eslint-disable react-hooks/immutability */
// (immutability): the jump animation writes Reanimated shared values
// (offsetY/jumpTarget/jumpAnimating .value) — by design. The lint rule doesn't
// model worklets and false-positives on those writes; disabled for this file.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
} from 'react-native';
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { KeyboardController, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { ArrowDown, CircleAlert, Sparkles } from 'lucide-react-native';
import { router, Stack } from 'expo-router';
import { File } from 'expo-file-system';
import { agentIsBusy, useAgent, useConversations } from '@/lib/agent/provider';
import { uploadFile } from '@/lib/api';
import { ChatHeaderRight, useChatHeaderItems } from '@/components/chat/chat-header';
import { Composer, type LocalAttachment } from '@/components/chat/composer';
import { deriveQA, isThinking, workingTool } from '@/components/chat/helpers';
import { MessageRow } from '@/components/chat/message';
import { chatColors } from '@/components/chat/theme';
import type { AgentMessage, SentAttachment } from '@/components/chat/types';

// The flue agent chat — native port of the web AgentChat.jsx on the shared
// AgentProvider session (the same instance other tabs' Render buttons drive).
//
// The transcript is an *inverted* FlatList. Data is newest-first, so the newest
// message rests at the visual bottom by construction — the chat opens at the
// latest and stays pinned as the agent streams. A chat switch remounts the list
// (key bump) to land back at the newest instantly.
//
// Scrolling the list *programmatically* is the hard part on this stack (Expo SDK
// 57 / RN 0.86 / React 19 / New Architecture / React Compiler). EVERY imperative
// path is dead — verified on-device: FlatList.scrollToOffset/scrollToEnd no-op
// (getNativeScrollRef() returns null, so the inner _scrollRef never attaches),
// a plain <ScrollView> ref is null too, reanimated's scrollTo reports an
// "uninitialized ref" (useAnimatedRef never captures the Fabric tag), and
// Animated.FlatList crashes (__internalInstanceHandle of null). Only native
// gestures move the list.
//
// The one thing that DOES move it is a *controlled* contentOffset — a prop, not
// a ref. So we inject an Animated.ScrollView as the FlatList's scroll view
// (renderScrollComponent; cloneElement only clobbers ref, not animatedProps) and
// hand it an animated contentOffset. "Jump to latest" animates that offset from
// the current position to 0 (newest) with withTiming; the rest of the time
// animatedProps yields {} so native momentum scrolling is untouched.

const SUGGESTIONS = [
  "Let's create the world",
  "What's the status of my episode?",
  'Render all pending sounds',
  'Stitch the complete cut',
];

type Row = {
  key: string;
  message: AgentMessage;
  atts: SentAttachment[] | null;
};

// Pulsing "Thinking… / Agent is working…" row (shimmer stand-in).
function ShimmerRow({ label }: { label: string }) {
  const opacity = useSharedValue(0.45);
  useEffect(() => {
    opacity.value = withRepeat(withTiming(1, { duration: 650 }), -1, true);
  }, [opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View style={style}>
      <View className="flex-row items-center gap-2 px-4 py-1.5">
        <ActivityIndicator size="small" color={chatColors.mutedForeground} />
        <Text className="text-sm text-muted-foreground">{label}</Text>
      </View>
    </Animated.View>
  );
}

function EmptyChat({ onSuggest }: { onSuggest: (s: string) => void }) {
  // The empty state has no scrollable list, so it lacks the transcript's
  // keyboardDismissMode. Tapping the background dismisses the keyboard (nested
  // suggestion Pressables still handle their own taps); accessible={false} keeps
  // this from reading as a button.
  return (
    <Pressable
      accessible={false}
      onPress={() => KeyboardController.dismiss()}
      className="flex-1 items-center justify-center gap-2 px-8"
    >
      <Sparkles size={22} color={chatColors.mutedForeground} />
      <Text className="text-center text-base font-medium text-foreground">
        Ask me to build the episode
      </Text>
      <Text className="text-center text-xs text-muted-foreground">
        The studio agent drives the whole pipeline — world, script, shots, renders, and cuts.
        Attach a reference image with the photo button.
      </Text>
      <View className="mt-3 gap-2 self-stretch">
        {SUGGESTIONS.map((s) => (
          <Pressable
            key={s}
            accessibilityRole="button"
            className="rounded-xl border border-border bg-card px-4 py-3 active:bg-secondary"
            onPress={() => onSuggest(s)}
          >
            <Text className="text-sm text-foreground">{s}</Text>
          </Pressable>
        ))}
      </View>
    </Pressable>
  );
}

export default function ChatScreen() {
  const agent = useAgent();
  const conv = useConversations();
  const insets = useSafeAreaInsets();
  // Inverted list: scroll offset 0 == newest at the visual bottom. atNewest
  // drives the "jump to latest" button (shown only when scrolled up into
  // history). remountKey bumps to snap back to the newest (see jumpToLatest).
  const [atNewest, setAtNewest] = useState(true);
  const [remountKey, setRemountKey] = useState(0);
  // "Jump to latest" animates a controlled contentOffset (see file header).
  // offsetY tracks the live scroll position (inverted: 0 == newest); jumpAnimating
  // gates the controlled offset so native scrolling is free the rest of the time.
  const offsetY = useSharedValue(0);
  const jumpTarget = useSharedValue(0);
  const jumpAnimating = useSharedValue(false);
  // One entry per user turn (ordinal-aligned to user messages): the images
  // that turn was sent with, re-rendered into its bubble.
  const sentAttachmentsRef = useRef<SentAttachment[][]>([]);

  const activeId: string = conv.activeId;
  const getInitial = conv.getInitial as (id: string) => { attachments?: unknown };

  // On mount / chat switch: reseed the attachments record. The inverted list
  // rests at the newest message by construction, so there's nothing to scroll.
  useEffect(() => {
    const initial = getInitial(activeId);
    sentAttachmentsRef.current = Array.isArray(initial.attachments)
      ? (initial.attachments as SentAttachment[][])
      : [];
    setAtNewest(true);
    setRemountKey((k) => k + 1);
  }, [activeId, getInitial]);

  const messages: AgentMessage[] = agent?.messages ?? [];
  const busy = agentIsBusy(agent);
  const thinking = useMemo(() => isThinking(messages, busy), [messages, busy]);
  const working = useMemo(() => workingTool(messages, busy), [messages, busy]);
  // Interactive `ask_question` cards: which one is pending vs already answered.
  const qa = useMemo(() => deriveQA(messages), [messages]);
  const canRespond = !busy;

  // Ordinal-align each user message with the images it was sent with (oldest→newest).
  const rows = useMemo<Row[]>(() => {
    let ordinal = -1;
    return messages.map((m, i) => {
      let atts: SentAttachment[] | null = null;
      if (m.role === 'user') {
        ordinal += 1;
        atts = sentAttachmentsRef.current[ordinal] ?? null;
      }
      return { key: m.id ?? `msg-${i}`, message: m, atts };
    });
  }, [messages]);

  // Inverted FlatList wants newest first.
  const data = useMemo(() => rows.slice().reverse(), [rows]);

  // The composer rides the keyboard via a transform, so the list reserves
  // matching space at the newest (visual-bottom) edge — which, for an inverted
  // list, is the ListHeaderComponent (keyboardHeight is negative while open).
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const bottomInset = insets.bottom;
  const spacerStyle = useAnimatedStyle(() => ({
    height: Math.max(0, -keyboardHeight.value - bottomInset),
  }));

  const recordAttachments = useCallback(
    (sent: SentAttachment[]) => {
      sentAttachmentsRef.current = [...sentAttachmentsRef.current, sent];
      conv.saveAttachments(activeId, sentAttachmentsRef.current);
    },
    [conv, activeId],
  );

  // Starter suggestions and other UI-driven sends (always plain text).
  const sendQuick = useCallback(
    (text: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      recordAttachments([]);
      void agent?.send?.({ message: text });
    },
    [agent, recordAttachments],
  );

  // Answer a pending `ask_question` card by tapping an option: send its label as
  // the next user message. Records an (empty) attachments entry first so the
  // ordinal-aligned record stays in step with the new user message, and snaps to
  // the newest so the reply is in view.
  const onRespond = useCallback(
    (label: string) => {
      if (busy || !label) return;
      Haptics.selectionAsync().catch(() => {});
      recordAttachments([]);
      if (!atNewest) setRemountKey((k) => k + 1);
      setAtNewest(true);
      void agent?.send?.({ message: label });
    },
    [agent, recordAttachments, busy, atNewest],
  );

  // Composer submit. flue takes images out-of-band as base64 `{ data, mimeType }`
  // (not as message parts), so for each picked image we both (a) upload it to R2
  // for a durable thumbnail URL rendered back into the bubble, and (b) read its
  // bytes as base64 to hand flue alongside the text so the model can see it.
  const submit = useCallback(
    async (raw: string, picked: LocalAttachment[]) => {
      const t = raw.trim();

      // Upload first (a throw keeps the composer content for retry), then read
      // each image's base64 for flue's `images`.
      const sent: SentAttachment[] = [];
      const images: { type: 'image'; data: string; mimeType: string; filename?: string }[] = [];
      for (const a of picked) {
        const { url } = await uploadFile(a.uri, a.name, a.mime);
        sent.push({ url, name: a.name, contentType: a.mime });
        const data = await new File(a.uri).base64();
        images.push({ type: 'image', data, mimeType: a.mime || 'image/jpeg', filename: a.name });
      }

      recordAttachments(sent);
      // Snap to the newest so the sent turn (and the reply) are in view.
      if (!atNewest) setRemountKey((k) => k + 1);
      setAtNewest(true);
      void agent?.send?.({ message: t, images: images.length ? images : undefined });
    },
    [agent, recordAttachments, atNewest],
  );

  // Inverted list: y ≈ 0 means we're at the newest message. Track the live
  // offset so a jump can animate from wherever we are.
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      offsetY.value = y;
      const near = y < 80;
      setAtNewest((prev) => (prev === near ? prev : near));
    },
    [offsetY],
  );

  // Animate to the newest (offset 0) by driving a controlled contentOffset —
  // the only programmatic scroll that works on this stack (see file header).
  // onScroll clears the button as it nears the bottom.
  const jumpToLatest = useCallback(() => {
    jumpTarget.value = offsetY.value;
    jumpAnimating.value = true;
    jumpTarget.value = withTiming(0, { duration: 350 }, (finished) => {
      'worklet';
      if (finished) jumpAnimating.value = false;
    });
  }, [offsetY, jumpTarget, jumpAnimating]);

  // Only feed a controlled contentOffset during a jump; otherwise yield {} so
  // native momentum scrolling is untouched.
  const scrollAnimatedProps = useAnimatedProps(() =>
    jumpAnimating.value ? { contentOffset: { x: 0, y: jumpTarget.value } } : {},
  );

  // Inject an Animated.ScrollView as the FlatList's scroll view so the jump's
  // animatedProps have a Fabric-animatable target (cloneElement clobbers ref,
  // not animatedProps; see file header).
  const renderScrollComponent = useCallback(
    (props: ScrollViewProps) => <Animated.ScrollView {...props} animatedProps={scrollAnimatedProps} />,
    [scrollAnimatedProps],
  );

  const renderItem = useCallback(
    ({ item }: { item: Row }) => (
      <MessageRow
        message={item.message}
        atts={item.atts}
        qa={qa}
        canRespond={canRespond}
        onRespond={onRespond}
      />
    ),
    [qa, canRespond, onRespond],
  );

  const errorMessage = agent?.error ? String(agent.error?.message ?? agent.error) : null;

  const onHistoryPress = useCallback(() => router.push('/(tabs)/chat/history'), []);
  const onNewChat = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    conv.newChat();
  }, [conv]);
  // Native bar button items on iOS, the <ChatHeaderRight> row elsewhere — see
  // src/components/chat/chat-header.tsx.
  const headerItems = useChatHeaderItems({ onHistoryPress, onNewChat });

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{
          unstable_headerRightItems: () => headerItems,
          headerRight: () => (
            <ChatHeaderRight onHistoryPress={onHistoryPress} onNewChat={onNewChat} />
          ),
        }}
      />

      <View className="relative min-h-0 flex-1">
        {rows.length === 0 ? (
          <EmptyChat onSuggest={sendQuick} />
        ) : (
          <FlatList
            key={remountKey}
            renderScrollComponent={renderScrollComponent}
            inverted
            data={data}
            keyExtractor={(r) => r.key}
            renderItem={renderItem}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            onScroll={onScroll}
            scrollEventThrottle={16}
            // Inverted → ListHeaderComponent renders at the visual bottom (newest).
            ListHeaderComponent={
              <>
                {thinking ? (
                  <ShimmerRow label="Thinking…" />
                ) : working ? (
                  <ShimmerRow label="Agent is working…" />
                ) : null}
                {errorMessage ? (
                  <View className="mx-4 mt-2 flex-row items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3">
                    <CircleAlert size={15} color={chatColors.destructive} style={{ marginTop: 2 }} />
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm font-medium text-foreground">Agent error</Text>
                      <Text className="text-xs text-muted-foreground">{errorMessage}</Text>
                    </View>
                  </View>
                ) : null}
                <Animated.View style={spacerStyle} />
              </>
            }
          />
        )}

        {!atNewest && rows.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Jump to latest"
            className="absolute bottom-3 left-1/2 h-9 w-9 items-center justify-center rounded-full border border-border bg-card active:opacity-70"
            style={{ transform: [{ translateX: -18 }] }}
            onPress={jumpToLatest}
          >
            <ArrowDown size={16} color={chatColors.foreground} />
          </Pressable>
        ) : null}
      </View>

      <Composer
        pending={!!qa.pendingId && !busy}
        busy={busy}
        onStop={() => agent?.stop?.()}
        onSubmit={submit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  listContent: { flexGrow: 1, gap: 16, paddingVertical: 16 },
});
