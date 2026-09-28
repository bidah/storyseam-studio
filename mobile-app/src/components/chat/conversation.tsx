/* eslint-disable react-hooks/immutability */
// (immutability): the shimmer/skeleton animations write Reanimated shared
// values (opacity .value) — by design. The lint rule doesn't model worklets and
// false-positives on those writes; disabled for this file.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { LegendList, type LegendListRef } from '@legendapp/list/react-native';
import Animated, {
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
import { setAgentMode } from '@/lib/agent/pill-mode';
import { peekTranscript, preloadTranscript } from '@/lib/agent/transcript-cache';
import type { Chat } from '@/lib/agent/chat-store';
import { uploadFile } from '@/lib/api';
import type { LocalAttachment } from '@/components/chat/composer';
import { useChatComposer, useComposerHeight } from '@/components/chat/composer-host';
import { GlassSurface } from '@/components/chat/glass-surface';
import {
  deriveQA,
  isReasoning,
  isStreamingText,
  isThinking,
  workingTool,
} from '@/components/chat/helpers';
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
// The transcript is a NATURAL-ORDER LegendList (oldest→newest, newest at the
// bottom). Never `inverted`: that's a scaleY(-1) transform, and iOS 26 flips
// the liquid-glass tab bar's scroll-edge effect along with it — the fade meant
// for the thin strip passing under the bar landed on the whole body instead,
// washing the text to ~15% opacity. LegendList is built for exactly this
// un-inverted chat shape: `alignItemsAtEnd` bottoms-up a short transcript,
// and `maintainScrollAtEnd` IS the stick-to-bottom primitive RN lacks — it
// follows the stream as items grow (and the keyboard spacer in the footer),
// releases when a drag leaves the bottom, and re-arms when a gesture returns
// within its threshold. One LegendList chat prop is deliberately NOT used:
// `initialScrollAtEnd` (see the landing effect below for why and for what
// replaces it).
//
// History note: this used to be a FlatList driven by a controlled,
// reanimated-animated contentOffset, because on this stack (Expo SDK 57 /
// RN 0.86 / React 19 / New Architecture / React Compiler) every imperative
// scroll path THROUGH FLATLIST was dead — scrollToOffset/scrollToEnd no-op'd
// (getNativeScrollRef() returned null), reanimated's scrollTo never captured
// the Fabric tag, Animated.FlatList crashed (docs/troubleshoot-solutions.md,
// 2026-07-20). LegendList sidesteps all of it: it attaches a plain ref
// DIRECTLY to the ScrollView it renders (no cloneElement in between to
// clobber it), so its own scrollTo — which is all maintainScrollAtEnd and
// scrollToEnd use — actually works here. Verified on-device.
//
// Two LegendList contracts worth keeping in mind (legend-skills):
// - Rows are absolutely positioned, so the content container's `gap` does
//   nothing — inter-row spacing lives on the row wrapper (styles.row).
// - `renderItem` identity is NOT an invalidation signal; anything a row reads
//   besides its item rides `extraData` (qa/canRespond/busy/onRespond), which
//   is what re-renders mounted rows when an answer becomes tappable.

type Row = {
  key: string;
  message: AgentMessage;
  atts: SentAttachment[] | null;
  /** Newest message in the transcript — the only one allowed to offer options. */
  isLast: boolean;
};

// Stable empty transcript, so "no cover" keeps one identity across renders.
const NO_MESSAGES: AgentMessage[] = [];

// Module-scope so the list prop keeps one identity (message ids, so cached row
// measurements survive the cover→live transcript swap).
const keyExtractor = (r: Row) => r.key;

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
      <View style={styles.shimmerRow}>
        <View style={styles.shimmerIcon}>
          <ActivityIndicator size="small" color={c.mutedForeground} />
        </View>
        <Text style={styles.shimmerLabel} numberOfLines={1}>
          {label}
        </Text>
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
    <Animated.View style={[SKELETON_ROOT, style]} pointerEvents="none">
      {SKELETON.map((s, i) => (
        <View
          key={i}
          style={[
            styles.skeletonBar,
            s.mine ? styles.skeletonBarMine : styles.skeletonBarTheirs,
            { width: s.w as `${number}%`, height: s.h },
          ]}
        />
      ))}
    </Animated.View>
  );
}

// A transient stream drop (Wi-Fi ↔ cellular handoff, a backgrounded socket,
// "The network connection was lost") surfaces as `agent.error` for the second
// or two it takes the provider's resync to rebuild the session — see the
// resilience block in lib/agent/provider.tsx. Flashing an error card for a
// failure that heals itself reads as "something is broken" when nothing is, so
// the card renders only for an error that OUTLIVES the self-heal: never while
// the turn is visibly still running, and only after the error has held
// continuously for this long. A terminal error (auth expiry, resync budget
// exhausted) persists and still surfaces.
const ERROR_GRACE_MS = 5000;
function useSettledError(error: unknown, busy: boolean): string | null {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!error || busy) {
      setSettled(false);
      return;
    }
    const timer = setTimeout(() => setSettled(true), ERROR_GRACE_MS);
    return () => clearTimeout(timer);
  }, [error, busy]);
  return settled && error ? String((error as any)?.message ?? error) : null;
}

export function Conversation({
  id,
  hubHref,
  focus = false,
  draft,
  draftKey,
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
  /**
   * Words dictated into the tab bar's pill, to land in the composer UNSENT
   * (lib/agent/voice-capture.tsx). A route param for the same reason `focus` is:
   * it belongs to the one navigation that carried it.
   */
  draft?: string;
  /** Nonce for `draft` — the same sentence dictated twice is two hand-offs. */
  draftKey?: string;
  /** False inside the modal — see useSuppressAgentAccessory. */
  suppressAccessory?: boolean;
}) {
  const c = useChatColors();
  const agent = useAgent();
  const conv = useConversations();
  const insets = useSafeAreaInsets();
  // Natural-order list: the newest message is at the BOTTOM, so "at newest"
  // means scrolled to the end. atNewest drives the "jump to latest" button
  // (shown only when scrolled up into history).
  const [atNewest, setAtNewest] = useState(true);
  const listRef = useRef<LegendListRef>(null);
  // One entry per user turn (ordinal-aligned to user messages): the images
  // that turn was sent with, re-rendered into its bubble.
  const sentAttachmentsRef = useRef<SentAttachment[][]>([]);

  // This screen docks the real composer, so the tab bar's agent pill stands
  // down while it's up (one message bar at the bottom is enough) — except in the
  // modal, which covers the pill anyway.
  useSuppressAgentAccessory(suppressAccessory);

  // A conversation is on screen, so the write/image toggle says Write — in this
  // modal's own header, and on the pill for when the modal goes away. The mirror
  // of the stamp the image modal makes on mount (src/app/image/index.tsx), and
  // needed for the same reason: most ways into a chat don't go through
  // `openForMode`. A Home recap card, the history sheet and useSendToAgent's
  // Render/Stitch buttons all call `openChatModal` directly, so after an image
  // pass the toggle would come up over a transcript still showing Image.
  //
  // Keyed on `id`: `navigate` re-points a modal that's already in the stack by
  // updating its params rather than remounting it.
  useEffect(() => setAgentMode('text'), [id]);

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

  // On mount / chat switch: reseed the attachments record. The list itself
  // resets through `dataKey={id}` (LegendList re-initializes its layout state
  // internally — cheaper than a React `key` remount) and `initialScrollAtEnd`
  // lands the fresh transcript at its newest message.
  useEffect(() => {
    const initial = getInitial(id);
    sentAttachmentsRef.current = Array.isArray(initial.attachments)
      ? (initial.attachments as SentAttachment[][])
      : [];
    setAtNewest(true);
  }, [id, getInitial]);

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
  const streamingText = useMemo(() => isStreamingText(messages, busy), [messages, busy]);
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
      return { key: m.id ?? `msg-${i}`, message: m, atts, isLast: i === messages.length - 1 };
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
  // padding — which LegendList reads for its own layout math (and folds into
  // alignItemsAtEnd's top padding) — rather than a contentInset.
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
  // path below sends from an effect — and a just-opened list is already at its
  // end anyway. The un-animated scrollToEnd re-arms maintainScrollAtEnd (we're
  // back within its threshold), so the reply that follows stays pinned.
  const snapToNewest = useCallback(() => {
    setAtNewest(true);
    void listRef.current?.scrollToEnd({ animated: false });
  }, []);

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

  // Natural order: the bottom of the content is the newest message. Only the
  // "jump to latest" button needs this — following the stream, releasing on a
  // drag away and re-arming on return are all maintainScrollAtEnd's.
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const fromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    const near = fromBottom < 80;
    setAtNewest((prev) => (prev === near ? prev : near));
  }, []);

  // Animate to the newest message. LegendList's own scrollTo — unlike every
  // imperative path through FlatList on this stack — actually works (see the
  // file header).
  const jumpToLatest = useCallback(() => {
    void listRef.current?.scrollToEnd({ animated: true });
  }, []);

  // Everything a row reads besides its item. extraData is LegendList's honest
  // invalidation signal: a changed renderItem identity does NOT re-render
  // mounted rows, so anything that must repaint them rides here. Memoized so
  // rows aren't invalidated by parent renders that changed none of it.
  type RowExtra = {
    qa: ReturnType<typeof deriveQA>;
    canRespond: boolean;
    busy: boolean;
    onRespond: (label: string) => void;
  };
  const extraData = useMemo<RowExtra>(
    () => ({ qa, canRespond, busy, onRespond }),
    [qa, canRespond, busy, onRespond],
  );

  // Stable identity by design (deps: []): rows re-render from item or
  // extraData changes. The wrapper View owns inter-row spacing — LegendList
  // positions rows absolutely, so the content container's `gap` is inert.
  const renderItem = useCallback(
    ({ item, extraData: x }: { item: Row; extraData: RowExtra }) => (
      <View style={styles.row}>
        <MessageRow
          message={item.message}
          atts={item.atts}
          qa={x.qa}
          canRespond={x.canRespond}
          onRespond={x.onRespond}
          // Only the settled newest turn may rescue a prose choice list — mid-turn
          // the text is still arriving, and older turns keep their markdown.
          isLast={item.isLast && !x.busy}
          // Raw tail position (no busy gate): an unfinished tool part on a
          // non-tail message is dead — see ToolChip.
          tail={item.isLast}
        />
      </View>
    ),
    [],
  );

  const errorMessage = useSettledError(live ? agent?.error : null, busy);
  // Open a chat AT its newest message. LegendList's own `initialScrollAtEnd`
  // is off-limits on this stack: its bootstrap (a per-frame scroll-until-
  // converged loop that hides content meanwhile) burns its convergence budget
  // on these rows, aborts having revealed nothing, and its scroll churn has
  // crashed Fabric outright (SIGABRT in ShadowTree::commit, reproduced twice).
  // A plain ref.scrollToEnd is verified to work here, so the landing is one
  // explicit non-animated jump once the first rows are in; the list hides
  // behind opacity until it settles so the top of history never flashes. The
  // timeout is the safety net against a hung promise — a one-frame flash
  // beats an invisible transcript. maintainScrollAtEnd takes over from there,
  // correcting toward the true end as the remaining rows measure in.
  const [landedId, setLandedId] = useState<string | null>(null);
  const landed = landedId === id;
  useEffect(() => {
    if (landed || rows.length === 0) return;
    let alive = true;
    const settle = () => {
      if (alive) setLandedId(id);
    };
    const raf = requestAnimationFrame(() => {
      const jump = listRef.current?.scrollToEnd({ animated: false });
      if (jump) void jump.then(settle);
    });
    const t = setTimeout(settle, 800);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [id, landed, rows.length]);

  // Point the stack's shared composer at this conversation while it's focused
  // (a recap tap, the history sheet, a fresh push — the bar itself never moved).
  //
  // `focusTick` is 1-or-0, not a counter: the param is fixed for this navigation,
  // so the input keeps one identity (it focuses by remounting on a changed key —
  // see Composer) and a re-render can't yank the keyboard back up after the user
  // has put it away.
  const onStop = useCallback(() => agent?.stop?.(), [agent]);
  const focusTick = focus ? 1 : 0;
  // The dictated hand-off, if this navigation carried one. Keyed by the nonce the
  // route param brought, so the composer pastes it exactly once (see Composer).
  const draftHandoff = useMemo(
    () => (draft && draftKey ? { key: draftKey, text: draft } : undefined),
    [draft, draftKey],
  );
  useChatComposer(
    useMemo(
      () => ({
        pending: !!qa.pendingId && !busy,
        busy,
        onStop,
        onSubmit,
        focusTick,
        draft: draftHandoff,
      }),
      [qa.pendingId, busy, onStop, onSubmit, focusTick, draftHandoff],
    ),
  );

  return (
    <View style={styles.screen}>
      {/* Everything else about this bar — the back button, the history + new chat
          pair, the close item in the modal, the glass — is declared per-screen in
          the hosting stack's _layout so UIKit can morph into it during the push. */}
      <Stack.Screen options={{ title }} />

      <View style={styles.body}>
        {rows.length === 0 ? (
          // A chat with nothing to show yet: skeleton while flue re-streams a
          // real transcript, bare surface for one just started (its first turn
          // is a frame away).
          waitingForHistory ? (
            <TranscriptSkeleton />
          ) : null
        ) : (
          <LegendList
            ref={listRef}
            // Chat-switch reset WITHOUT a React remount: a new dataKey tells
            // LegendList "new logical dataset", dropping cached layouts, and
            // initialScrollAtEnd re-lands it at the newest message.
            dataKey={id}
            data={rows}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            extraData={extraData}
            // recycleItems stays OFF deliberately: the row tree holds
            // item-scoped state (expanded Sources, genui cards, streaming
            // markdown) that recycling would bleed across messages; migrating
            // it all to useRecyclingState isn't worth it at transcript scale.
            // NO initialScrollAtEnd — its bootstrap crashes this stack; the
            // explicit landing effect above owns the initial position.
            alignItemsAtEnd
            maintainScrollAtEnd={MAINTAIN_AT_END}
            style={landed ? styles.list : styles.listLanding}
            contentContainerStyle={listContentStyle}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            onScroll={onScroll}
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
                ) : streamingText ? (
                  // The agent is visibly WRITING — the words are the progress
                  // indicator, so no shimmer under them (see isStreamingText).
                  null
                ) : busy ? (
                  // Catch-all: turn still in flight but its trailing content is
                  // settled (a finished narration line, a completed tool) — none
                  // of the specific states match. The indicator's presence must
                  // map exactly to "not done", so any busy turn shows a shimmer.
                  <ShimmerRow label="Working…" />
                ) : null}
                {errorMessage ? (
                  <View style={styles.errorCard}>
                    <CircleAlert size={15} color={c.destructive} style={{ marginTop: 2 }} />
                    <View style={styles.errorBody}>
                      <Text style={styles.errorTitle}>Agent error</Text>
                      <Text style={styles.errorText}>{errorMessage}</Text>
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
            // Sits just above the floating composer, not behind it.
            style={[
              styles.jumpButton,
              { transform: [{ translateX: -21 }], bottom: composerOverlap + 12 },
            ]}
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
                borderRadius: 0,
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

// Follow the stream to the bottom smoothly (items growing, the keyboard spacer
// in the footer) — the animated scroll only engages while the user is already
// within maintainScrollAtEndThreshold of the end, so it never fights a gesture.
const MAINTAIN_AT_END = { animated: true } as const;

// Handed to a REANIMATED component, so it stays a plain object: a unistyles
// style carries a metadata key that the Babel plugin strips only for host
// components it rewrites, and `Animated.View` is built at runtime by
// `createAnimatedComponent`, so the key survives into Reanimated's validator
// and blows up the screen. Pure layout, nothing to theme.
const SKELETON_ROOT = {
  flex: 1,
  justifyContent: 'flex-end',
  gap: 12,
  paddingHorizontal: 16,
  paddingBottom: 16,
} as const;

const styles = StyleSheet.create((theme) => ({
  list: { flex: 1 },
  // Pre-landing veil: mounted and measuring, but not yet scrolled to the
  // newest message — invisible so the top of history never flashes.
  listLanding: { flex: 1, opacity: 0 },
  // No flexGrow/justifyContent: alignItemsAtEnd is what bottoms-up a short
  // transcript. No `gap` either — rows are absolutely positioned (styles.row
  // carries the spacing). paddingTop is completed per-device in listContentStyle.
  listContent: { paddingBottom: 16 },
  // The old content `gap: 16`, moved into each row: space after every row —
  // between rows, and between the last row and the footer.
  row: { paddingBottom: 16 },
  shimmerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  shimmerIcon: { paddingTop: 2 },
  shimmerLabel: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: theme.colors.mutedForeground,
  },
  skeletonBar: { borderRadius: 0 },
  skeletonBarMine: {
    alignSelf: 'flex-end',
    backgroundColor: `${theme.colors.primary}33`,
  },
  skeletonBarTheirs: {
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.muted,
  },
  screen: { flex: 1, backgroundColor: theme.colors.background },
  body: { position: 'relative', minHeight: 0, flex: 1 },
  errorCard: {
    marginHorizontal: 16,
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: `${theme.colors.destructive}66`,
    backgroundColor: `${theme.colors.destructive}1A`,
    padding: 12,
  },
  errorBody: { minWidth: 0, flex: 1 },
  errorTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.foreground,
  },
  errorText: {
    fontSize: 12,
    color: theme.colors.mutedForeground,
  },
  jumpButton: {
    position: 'absolute',
    left: '50%',
  },
}));
