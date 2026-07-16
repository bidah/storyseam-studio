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
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { ArrowDown, CircleAlert, Sparkles } from 'lucide-react-native';
import { Stack } from 'expo-router';
import { agentIsBusy, useAgent, useConversations } from '@/lib/agent/provider';
import { uploadFile } from '@/lib/api';
import { ChatHeaderRight, useChatHeaderItems } from '@/components/chat/chat-header';
import { Composer, type LocalAttachment } from '@/components/chat/composer';
import { ConversationsOverlay } from '@/components/chat/conversations-overlay';
import { isThinking, pendingRequest, workingTool } from '@/components/chat/helpers';
import { MessageRow, type Respond } from '@/components/chat/message';
import { chatColors } from '@/components/chat/theme';
import type { AgentMessage, SentAttachment } from '@/components/chat/types';

// The eve agent chat — native port of the web AgentChat.jsx on the shared
// AgentProvider session (the same instance other tabs' Render buttons drive).
//
// The transcript is an *inverted* FlatList. On this stack (Expo SDK 57 /
// RN 0.86 / React 19 / New Architecture / NativeWind / React Compiler) every
// imperative scroll path is dead — FlatList.scrollToEnd/scrollToOffset are
// no-ops (the inner ScrollView ref never attaches), a plain ScrollView ref
// resolves to a bare native node with no scroll methods, and reanimated's
// scrollTo reports an uninitialized ref. Only native gestures scroll. An
// inverted list sidesteps all of that: data is newest-first, so the newest
// message rests at the visual bottom by construction — the chat opens at the
// latest and stays pinned as the agent streams, with no ref calls. "Jump to
// latest" remounts the list (key bump), which lands back at the newest.

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
  return (
    <View className="flex-1 items-center justify-center gap-2 px-8">
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
    </View>
  );
}

export default function ChatScreen() {
  const agent = useAgent();
  const conv = useConversations();
  const insets = useSafeAreaInsets();
  const [historyOpen, setHistoryOpen] = useState(false);
  // Inverted list: scroll offset 0 == newest at the visual bottom. atNewest
  // drives the "jump to latest" button (shown only when scrolled up into
  // history). remountKey bumps to snap back to the newest (see jumpToLatest).
  const [atNewest, setAtNewest] = useState(true);
  const [remountKey, setRemountKey] = useState(0);
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
    setHistoryOpen(false);
    setRemountKey((k) => k + 1);
  }, [activeId, getInitial]);

  const messages: AgentMessage[] = agent?.data?.messages ?? [];
  const busy = agentIsBusy(agent);
  const pendingReq = useMemo(() => pendingRequest(messages), [messages]);
  const pending = !!pendingReq;
  const thinking = useMemo(() => isThinking(messages, busy), [messages, busy]);
  const working = useMemo(() => workingTool(messages, busy, pending), [messages, busy, pending]);

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

  const onRespond: Respond = useCallback(
    (responses) => {
      void agent?.send?.({ inputResponses: responses });
    },
    [agent],
  );

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

  // Composer submit. A parked HITL request only resumes when the answer is
  // delivered as an inputResponse to its requestId — a plain message never
  // reaches the parked (sub)session — so typed free text routes as the
  // response while one is pending. HITL answers are text-only in eve, so an
  // image-carrying send falls through to a normal message (web parity).
  const submit = useCallback(
    async (raw: string, picked: LocalAttachment[]) => {
      const t = raw.trim();
      if (pendingReq && t && picked.length === 0) {
        void agent?.send?.({ inputResponses: [{ requestId: pendingReq.requestId, text: t }] });
        return;
      }

      // Upload first (a throw keeps the composer content for retry), then
      // send image parts pointing at the public URLs so the model sees them.
      const sent: SentAttachment[] = [];
      for (const a of picked) {
        const { url } = await uploadFile(a.uri, a.name, a.mime);
        sent.push({ url, name: a.name, contentType: a.mime });
      }

      const message: unknown = sent.length
        ? [
            ...(t ? [{ type: 'text', text: t }] : []),
            ...sent.map((a) => ({ type: 'image', image: a.url })),
          ]
        : t;

      recordAttachments(sent);
      // Snap to the newest so the sent turn (and the reply) are in view.
      if (!atNewest) setRemountKey((k) => k + 1);
      setAtNewest(true);
      void agent?.send?.({ message });
    },
    [agent, pendingReq, recordAttachments, atNewest],
  );

  // Inverted list: y ≈ 0 means we're at the newest message.
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const near = e.nativeEvent.contentOffset.y < 80;
    setAtNewest((prev) => (prev === near ? prev : near));
  }, []);

  // Imperative scroll is a no-op on this stack (see file header), so snap to the
  // newest by remounting the inverted list — it lands at offset 0 (newest).
  const jumpToLatest = useCallback(() => {
    setAtNewest(true);
    setRemountKey((k) => k + 1);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: Row }) => (
      <MessageRow message={item.message} atts={item.atts} canRespond={!busy} onRespond={onRespond} />
    ),
    [busy, onRespond],
  );

  const errorMessage = agent?.error ? String(agent.error?.message ?? agent.error) : null;

  const onHistoryPress = useCallback(() => setHistoryOpen((v) => !v), []);
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

        {historyOpen ? (
          <ConversationsOverlay conv={conv} onClose={() => setHistoryOpen(false)} />
        ) : null}
      </View>

      <Composer pending={pending} busy={busy} onStop={() => agent?.stop?.()} onSubmit={submit} />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  listContent: { flexGrow: 1, gap: 16, paddingVertical: 16 },
});
