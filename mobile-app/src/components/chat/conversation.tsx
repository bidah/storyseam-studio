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
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { ArrowDown, CircleAlert } from 'lucide-react-native';
import { router, Stack, useFocusEffect, type Href } from 'expo-router';
import { File } from 'expo-file-system';
import { agentIsBusy, useAgent, useConversations } from '@/lib/agent/provider';
import { useSuppressAgentAccessory } from '@/lib/agent/accessory-suppress';
import { takePendingDraft } from '@/lib/agent/pending-draft';
import { peekTranscript, preloadTranscript } from '@/lib/agent/transcript-cache';
import type { Chat } from '@/lib/agent/chat-store';
import { cn } from '@/lib/utils';
import { uploadFile } from '@/lib/api';
import type { LocalAttachment } from '@/components/chat/composer';
import { useChatComposer, useComposerHeight } from '@/components/chat/composer-host';
import { GlassSurface } from '@/components/chat/glass-surface';
import { deriveQA, isReasoning, isThinking, workingTool } from '@/components/chat/helpers';
import { MessageRow } from '@/components/chat/message';
import { useChatColors } from '@/components/chat/theme';
import type { AgentMessage, SentAttachment } from '@/components/chat/types';

// ONE conversation with the flue agent — native port of the web AgentChat.jsx.
// The hub owns "start a chat"; this owns "read and continue one".
//
// It is a COMPONENT rather than a screen because the same conversation is
// presented two ways, and both must be the same code: pushed inside the Home
// tab's stack (src/app/(tabs)/chat/[id].tsx — that push is what buys the native
// header morph), and inside the chat modal (src/app/session/[id].tsx), which is
// how the agent stays reachable from every other tab without switching tabs. The
// props are exactly the differences: where "back to the hub" goes, and whether
// the tab bar's accessory pill has to stand down.
//
// The chat id is the source of truth for WHICH chat: it points the shared session
// at it on mount (`conv.switchChat`), and renders its local cover until the
// session has actually caught up (`agent.chatId === id`) — the provider publishes
// a single agent at a time and repoints it a render later, so without that check
// the first frame would show the previous chat's messages.
//
// The transcript is a NATURAL-ORDER FlatList (oldest→newest, newest at the
// bottom). It used to be `inverted`, which made "pinned to the newest" free —
// but `inverted` is a scaleY(-1) transform, and iOS 26 flips the liquid-glass
// tab bar's scroll-edge effect along with it: the fade meant for the thin strip
// passing under the bar landed on the whole body instead, washing the text to
// ~15% opacity. Un-inverted, the effect lands where it belongs and content
// fades correctly as it slides under the bar — at the cost of having to keep
// ourselves at the bottom by hand (`pinned`, below).
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
// hand it an animated contentOffset. That one mechanism now does double duty:
// "Jump to latest" animates the offset to the content's end, and `pinned` holds
// it there so the view follows the agent's stream (RN has no stick-to-bottom
// primitive — maintainVisibleContentPosition anchors insertions ABOVE the
// viewport, not below). A drag drops the pin so the gesture isn't fought;
// coming back to the end re-arms it. Otherwise animatedProps yields {} so
// native momentum scrolling is untouched.

type Row = {
  key: string;
  message: AgentMessage;
  atts: SentAttachment[] | null;
};

// Stable empty transcript, so "no cover" keeps one identity across renders.
const NO_MESSAGES: AgentMessage[] = [];

// The compact nav bar (44pt, under the status bar). The transcript runs the
// FULL height of the screen — `headerTransparent` puts it under the bar so the
// glass has something moving behind it — so the list reserves this much at its
// top edge to sit clear of the bar at rest.
const COMPACT_HEADER = 44;

// Pulsing "Thinking… / Agent is working…" row (shimmer stand-in).
function ShimmerRow({ label }: { label: string }) {
  const c = useChatColors();
  const opacity = useSharedValue(0.45);
  useEffect(() => {
    opacity.value = withRepeat(withTiming(1, { duration: 650 }), -1, true);
  }, [opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View style={style}>
      <View className="flex-row items-center gap-2 px-4 py-1.5">
        <ActivityIndicator size="small" color={c.mutedForeground} />
        <Text className="text-sm text-muted-foreground">{label}</Text>
      </View>
    </Animated.View>
  );
}

// Shown only for an EXISTING chat we have no local cover for (first open on this
// device) while flue re-streams its durable history — a couple of breathing
// bubbles in the transcript's own shape, so the real messages land into the
// layout that's already there. Deliberately not a spinner: a centered spinner
// reads as "the screen is broken", and it replaces the whole surface instead of
// previewing it.
// Heights stand in for message length — a couple of paragraphs, a couple of
// one-liners — so the placeholder fills the transcript the way real turns do.
const SKELETON = [
  { mine: false, w: '78%', h: 64 },
  { mine: true, w: '46%', h: 40 },
  { mine: false, w: '88%', h: 128 },
  { mine: true, w: '38%', h: 40 },
  { mine: false, w: '82%', h: 88 },
  { mine: false, w: '58%', h: 40 },
] as const;

function TranscriptSkeleton() {
  const opacity = useSharedValue(0.35);
  useEffect(() => {
    opacity.value = withRepeat(withTiming(0.7, { duration: 900 }), -1, true);
  }, [opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View style={style} className="flex-1 justify-end gap-3 px-4 pb-4" pointerEvents="none">
      {SKELETON.map((s, i) => (
        <View
          key={i}
          style={{ width: s.w as `${number}%`, height: s.h }}
          className={cn('rounded-2xl', s.mine ? 'self-end bg-primary/20' : 'self-start bg-muted')}
        />
      ))}
    </Animated.View>
  );
}

export function Conversation({
  id,
  hubHref,
  focus = false,
  suppressAccessory = true,
}: {
  id: string;
  /** Where "this chat is gone" pops back to — the hub of whichever stack hosts us. */
  hubHref: Href;
  /**
   * Open the keyboard on arrival (the accessory pill's hand-off — tapping what
   * looks like an input should leave you typing). Arrives as a route param so it
   * belongs to one navigation and can't refocus a later, unrelated open.
   */
  focus?: boolean;
  /** False inside the modal — see useSuppressAgentAccessory. */
  suppressAccessory?: boolean;
}) {
  const c = useChatColors();
  const agent = useAgent();
  const conv = useConversations();
  const insets = useSafeAreaInsets();
  // Natural-order list: the newest message is at the BOTTOM, so "at newest"
  // means scrolled to the end. atNewest drives the "jump to latest" button
  // (shown only when scrolled up into history); remountKey bumps on chat switch.
  const [atNewest, setAtNewest] = useState(true);
  const [remountKey, setRemountKey] = useState(0);
  // Scroll state lives in shared values because the ONLY programmatic scroll
  // that works on this stack is a controlled contentOffset fed through
  // animatedProps (see file header). contentH/layoutH are what let us compute
  // where "the bottom" is; `pinned` sticks us there as the agent streams.
  const offsetY = useSharedValue(0);
  const contentH = useSharedValue(0);
  const layoutH = useSharedValue(0);
  const pinned = useSharedValue(true);
  const jumpTarget = useSharedValue(0);
  const jumpAnimating = useSharedValue(false);
  // One entry per user turn (ordinal-aligned to user messages): the images
  // that turn was sent with, re-rendered into its bubble.
  const sentAttachmentsRef = useRef<SentAttachment[][]>([]);

  // This screen docks the real composer, so the tab bar's agent pill stands
  // down while it's up (one message bar at the bottom is enough) — except in the
  // modal, which covers the pill anyway.
  useSuppressAgentAccessory(suppressAccessory);

  const getInitial = conv.getInitial as (id: string) => { attachments?: unknown };

  // Point the shared session at this route's chat. A no-op when we got here by
  // starting the chat (the landing screen already made it active) — it matters
  // when arriving from a recap card, the history sheet, or a cold deep link.
  useEffect(() => {
    conv.switchChat(id);
  }, [conv, id]);

  // The session has caught up to this route. Until then `agent` still belongs to
  // whichever chat was active before, so nothing of its is safe to render or
  // send into.
  const live = agent?.chatId === id;

  // The chat left this project (switched projects from the header menu, or it was
  // deleted from the history sheet): this route no longer points at anything.
  // `conv.list` is project-scoped, so absence is the signal.
  //
  // Gated on FOCUS so deleting a chat from the history sheet doesn't yank the
  // sheet closed under the user — the sheet is the focused screen while it's up,
  // so the pop waits until it's dismissed and this screen is on top again.
  const stillHere = (conv.list as Chat[]).some((ch) => ch.id === id);
  useFocusEffect(
    useCallback(() => {
      if (!stillHere) router.dismissTo(hubHref);
    }, [stillHere, hubHref]),
  );

  // On mount / chat switch: reseed the attachments record. The list rests at the
  // newest message by construction, so there's nothing to scroll.
  useEffect(() => {
    const initial = getInitial(id);
    sentAttachmentsRef.current = Array.isArray(initial.attachments)
      ? (initial.attachments as SentAttachment[][])
      : [];
    setAtNewest(true);
    pinned.value = true;
    setRemountKey((k) => k + 1);
  }, [id, getInitial, pinned]);

  // --- The cover (see src/lib/agent/transcript-cache.ts) ---
  //
  // flue re-streams this chat's durable transcript on every cold start, so
  // `agent.messages` is empty for the first beat and the screen would flash the
  // empty state before the history popped in. flue can't be seeded, so we render
  // our own local mirror of the last-seen transcript meanwhile and swap to the
  // live one when it lands. The swap is a plain data change on the same list —
  // no remount, no scroll jump, and identical rows, so it reads as the chat
  // simply being there. It also covers the beat between this screen mounting and
  // the provider repointing the session at it.
  //
  // The active chat's cover is already in memory (the provider warms it during
  // boot), so this is a render-time read — no state, no post-mount frame. The
  // async branch below only covers opening a chat whose cover hasn't been read
  // this launch.
  const memCover = peekTranscript(id);
  const [asyncCover, setAsyncCover] = useState<{ id: string; messages: AgentMessage[] } | null>(
    null,
  );
  useEffect(() => {
    if (memCover) return;
    let alive = true;
    preloadTranscript(id).then((m) => {
      if (alive && m.length) setAsyncCover({ id, messages: m });
    });
    return () => {
      alive = false;
    };
  }, [id, memCover]);
  const cover = memCover ?? (asyncCover?.id === id ? asyncCover.messages : NO_MESSAGES);

  const liveMessages: AgentMessage[] = (live && agent?.messages) || NO_MESSAGES;
  const historyReady: boolean = live && !!agent?.historyReady;
  const showingCover = !historyReady && liveMessages.length === 0 && cover.length > 0;
  const messages: AgentMessage[] = showingCover ? cover : liveMessages;
  // No cover and nothing live yet: an EXISTING chat is still loading (skeleton),
  // but a brand-new one has no server transcript to wait for. Mirrors the web
  // `looksNew` gate in AgentChat.jsx.
  const chat = (conv.list as Chat[]).find((ch) => ch.id === id);
  const looksNew = !chat || (chat.title === 'New chat' && !chat.attachments?.length);
  const waitingForHistory = !historyReady && !looksNew;
  const busy = live && agentIsBusy(agent);
  const thinking = useMemo(() => isThinking(messages, busy), [messages, busy]);
  const working = useMemo(() => workingTool(messages, busy), [messages, busy]);
  const reasoning = useMemo(() => isReasoning(messages, busy), [messages, busy]);
  // Interactive `ask_question` cards: which one is pending vs already answered.
  const qa = useMemo(() => deriveQA(messages), [messages]);
  // A question card on the cover is a picture of one — answering it would send
  // against a transcript flue hasn't handed us yet.
  const canRespond = !busy && !showingCover && live;

  // The chat's own title in the bar (the compact one the large "Chat" collapses
  // into during the push). Falls back to "Chat" until the first user line has
  // been derived, so a fresh conversation doesn't announce itself as "New chat".
  const title = chat?.title && chat.title !== 'New chat' ? chat.title : 'Chat';

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

  // The stack layout's SHARED composer (see composer-host.tsx) floats over the
  // transcript — this screen slid in underneath it — and rides the keyboard via
  // a transform. The list reserves matching space at the newest (bottom) edge:
  // the bar's measured height, plus however far the keyboard has lifted it
  // (keyboardHeight is negative while open, and the sticky view already absorbs
  // the bottom inset).
  const composerHeight = useComposerHeight();
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const bottomInset = insets.bottom;
  // The transcript stops at the tab bar's top edge, NOT at the window bottom.
  // iOS 26's liquid-glass UITabBar applies a scroll-edge effect to any scroll
  // view running underneath it, and on this stack that lands as a flat ~15%
  // wash over the WHOLE list (verified with a pure-red probe row: it rendered
  // pink until the list stopped short of the bar) that only clears once you
  // scroll. The composer still floats over the last stretch of the list, which
  // is the underlap the glass actually needs.
  // How far the composer overlaps the list — everything below that is tab bar,
  // which the list no longer occupies. Reserving the bar's full height here too
  // would leave a dead band between the newest message and the composer.
  const composerOverlap = composerHeight;
  // The list's frame starts at the top of the SCREEN (transparent header), so
  // the oldest message would otherwise rest under the bar. Reserved as content
  // padding rather than a contentInset: the stick-to-bottom pin measures
  // `contentSize - layoutHeight`, which insets would shift out from under it.
  const listContentStyle = useMemo(
    () => [styles.listContent, { paddingTop: insets.top + COMPACT_HEADER + 16 }],
    [insets.top],
  );
  const spacerStyle = useAnimatedStyle(() => ({
    height: composerOverlap + Math.max(0, -keyboardHeight.value - bottomInset),
  }));

  const recordAttachments = useCallback(
    (sent: SentAttachment[]) => {
      sentAttachmentsRef.current = [...sentAttachmentsRef.current, sent];
      conv.saveAttachments(id, sentAttachmentsRef.current);
    },
    [conv, id],
  );

  // Put the newest turn back in view. Separate from `send` because the draft
  // path below sends from an effect, where a synchronous setState would cascade
  // a render — and a just-opened list is already at its end anyway.
  const snapToNewest = useCallback(() => {
    pinned.value = true;
    setAtNewest(true);
  }, [pinned]);

  // Send one turn: upload each picked image to R2 for a durable thumbnail URL
  // rendered back into the bubble, AND read its bytes as base64 to hand flue
  // alongside the text (flue takes images out-of-band as `{ data, mimeType }`,
  // not as message parts, so the model can see them).
  const send = useCallback(
    async (raw: string, picked: LocalAttachment[]) => {
      const text = raw.trim();

      // Upload first (a throw keeps the composer content for retry).
      const sent: SentAttachment[] = [];
      const images: { type: 'image'; data: string; mimeType: string; filename?: string }[] = [];
      for (const a of picked) {
        const { url } = await uploadFile(a.uri, a.name, a.mime);
        sent.push({ url, name: a.name, contentType: a.mime });
        const data = await new File(a.uri).base64();
        images.push({ type: 'image', data, mimeType: a.mime || 'image/jpeg', filename: a.name });
      }

      recordAttachments(sent);
      void agent?.send?.({ message: text, images: images.length ? images : undefined });
    },
    [agent, recordAttachments],
  );

  // Composer submit: snap to the newest first so the sent turn (and the reply)
  // are in view, even if you'd scrolled up into history to compose it.
  const onSubmit = useCallback(
    async (raw: string, picked: LocalAttachment[]) => {
      snapToNewest();
      await send(raw, picked);
    },
    [snapToNewest, send],
  );

  // The first message, typed on the landing screen before this chat had a
  // session (see lib/agent/pending-draft.ts). Held until the provider has
  // repointed the agent at this chat, then sent exactly once — `takePendingDraft`
  // clears it, so a resync remount doesn't send it twice.
  useEffect(() => {
    if (!live) return;
    const draft = takePendingDraft(id);
    if (!draft) return;
    void send(draft.text, draft.attachments);
  }, [live, id, send]);

  // Answer a pending `ask_question` card by tapping an option: send its label as
  // the next user message. Records an (empty) attachments entry first so the
  // ordinal-aligned record stays in step with the new user message, and snaps to
  // the newest so the reply is in view.
  const onRespond = useCallback(
    (label: string) => {
      if (busy || !label) return;
      Haptics.selectionAsync().catch(() => {});
      recordAttachments([]);
      snapToNewest();
      void agent?.send?.({ message: label });
    },
    [agent, recordAttachments, busy, snapToNewest],
  );

  // Natural order: the bottom of the content is the newest message.
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      offsetY.value = contentOffset.y;
      contentH.value = contentSize.height;
      layoutH.value = layoutMeasurement.height;
      const fromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
      const near = fromBottom < 80;
      // Re-arm the stick-to-bottom pin only once you've come back to the end;
      // scrolling up into history releases it (onScrollBeginDrag).
      if (near) pinned.value = true;
      setAtNewest((prev) => (prev === near ? prev : near));
    },
    [offsetY, contentH, layoutH, pinned],
  );

  // A drag is the user taking over: drop the pin so the controlled offset stops
  // fighting the gesture. onScroll re-arms it when they return to the bottom.
  const onScrollBeginDrag = useCallback(() => {
    pinned.value = false;
  }, [pinned]);

  // Keep the bottom reachable as content grows mid-stream. Setting contentH here
  // (rather than waiting for the next onScroll) is what makes the pin follow
  // streaming text — no scroll event fires while the agent is typing.
  const onContentSizeChange = useCallback(
    (_w: number, h: number) => {
      contentH.value = h;
    },
    [contentH],
  );

  const onListLayout = useCallback(
    (e: { nativeEvent: { layout: { height: number } } }) => {
      layoutH.value = e.nativeEvent.layout.height;
    },
    [layoutH],
  );

  // Animate to the newest (the content's end) by driving a controlled
  // contentOffset — the only programmatic scroll that works on this stack.
  const jumpToLatest = useCallback(() => {
    jumpTarget.value = offsetY.value;
    jumpAnimating.value = true;
    const bottom = Math.max(0, contentH.value - layoutH.value);
    jumpTarget.value = withTiming(bottom, { duration: 350 }, (finished) => {
      'worklet';
      if (finished) {
        jumpAnimating.value = false;
        pinned.value = true;
      }
    });
  }, [offsetY, jumpTarget, jumpAnimating, contentH, layoutH, pinned]);

  // Feed a controlled contentOffset while jumping, and while pinned to the end
  // (which is how the view follows the agent's stream now that the list is no
  // longer inverted). Otherwise yield {} so native scrolling is untouched.
  const scrollAnimatedProps = useAnimatedProps(() => {
    if (jumpAnimating.value) return { contentOffset: { x: 0, y: jumpTarget.value } };
    if (pinned.value) {
      return { contentOffset: { x: 0, y: Math.max(0, contentH.value - layoutH.value) } };
    }
    return {};
  });

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

  const errorMessage = live && agent?.error ? String(agent.error?.message ?? agent.error) : null;

  // Point the stack's shared composer at this conversation while it's focused
  // (a recap tap, the history sheet, a fresh push — the bar itself never moved).
  //
  // `focusTick` is 1-or-0, not a counter: the param is fixed for this navigation,
  // so the input keeps one identity (it focuses by remounting on a changed key —
  // see Composer) and a re-render can't yank the keyboard back up after the user
  // has put it away.
  const onStop = useCallback(() => agent?.stop?.(), [agent]);
  const focusTick = focus ? 1 : 0;
  useChatComposer(
    useMemo(
      () => ({ pending: !!qa.pendingId && !busy, busy, onStop, onSubmit, focusTick }),
      [qa.pendingId, busy, onStop, onSubmit, focusTick],
    ),
  );

  return (
    <View className="flex-1 bg-background">
      {/* Everything else about this bar — the back button, the history + new chat
          pair, the close item in the modal, the glass — is declared per-screen in
          the hosting stack's _layout so UIKit can morph into it during the push. */}
      <Stack.Screen options={{ title }} />

      <View className="relative min-h-0 flex-1">
        {rows.length === 0 ? (
          // A chat with nothing to show yet: skeleton while flue re-streams a
          // real transcript, bare surface for one just started (its first turn
          // is a frame away).
          waitingForHistory ? (
            <TranscriptSkeleton />
          ) : null
        ) : (
          <FlatList
            key={remountKey}
            renderScrollComponent={renderScrollComponent}
            data={rows}
            keyExtractor={(r) => r.key}
            renderItem={renderItem}
            style={styles.list}
            contentContainerStyle={listContentStyle}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            onScroll={onScroll}
            onScrollBeginDrag={onScrollBeginDrag}
            onContentSizeChange={onContentSizeChange}
            onLayout={onListLayout}
            scrollEventThrottle={16}
            // Natural order → the newest edge is the FOOTER (visual bottom).
            ListFooterComponent={
              <>
                {thinking ? (
                  <ShimmerRow label="Thinking…" />
                ) : working ? (
                  <ShimmerRow label="Agent is working…" />
                ) : reasoning ? (
                  <ShimmerRow label="Reasoning…" />
                ) : busy ? (
                  // Catch-all: turn still in flight but its trailing content is
                  // settled (a finished narration line, a completed tool) — none
                  // of the specific states match. The indicator's presence must
                  // map exactly to "not done", so any busy turn shows a shimmer.
                  <ShimmerRow label="Working…" />
                ) : null}
                {errorMessage ? (
                  <View className="mx-4 mt-2 flex-row items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3">
                    <CircleAlert size={15} color={c.destructive} style={{ marginTop: 2 }} />
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
            className="absolute left-1/2"
            // Sits just above the floating composer, not behind it.
            style={{ transform: [{ translateX: -21 }], bottom: composerOverlap + 12 }}
            onPress={jumpToLatest}
          >
            {/* Liquid glass, like the composer it floats above — the transcript
                scrolls beneath it, which is exactly the backdrop glass wants.
                Interactive: UIKit swells it under the press, so no active
                opacity here (that would fight the swell). */}
            <GlassSurface
              glassEffectStyle="regular"
              isInteractive
              fallbackColor={c.card}
              fallbackBorderColor={c.border}
              style={{
                width: 42,
                height: 42,
                borderRadius: 21,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ArrowDown size={19} color={c.foreground} />
            </GlassSurface>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  listContent: { flexGrow: 1, justifyContent: 'flex-end', gap: 16, paddingVertical: 16 },
});
