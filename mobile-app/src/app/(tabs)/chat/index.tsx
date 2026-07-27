/* eslint-disable react-hooks/immutability */
// (immutability): the jump animation writes Reanimated shared values
// (offsetY/jumpTarget/jumpAnimating .value) — by design. The lint rule doesn't
// model worklets and false-positives on those writes; disabled for this file.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
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
import { router, Stack } from 'expo-router';
import { File } from 'expo-file-system';
import { agentIsBusy, useAgent, useConversations } from '@/lib/agent/provider';
import { peekTranscript, preloadTranscript } from '@/lib/agent/transcript-cache';
import type { Chat } from '@/lib/agent/chat-store';
import { cn } from '@/lib/utils';
import { uploadFile } from '@/lib/api';
import { useProjectResource } from '@/lib/queries';
import {
  buildSuggestions,
  FALLBACK_SUGGESTIONS,
  type Status,
  type Suggestion,
} from '@/lib/suggestions';
import { BouncyPressable } from '@/components/ui/bouncy-pressable';
import { ChatHeaderRight, useChatHeaderItems } from '@/components/chat/chat-header';
import { Composer, type LocalAttachment } from '@/components/chat/composer';
import { GlassSurface } from '@/components/chat/glass-surface';
import { deriveQA, isReasoning, isThinking, relTime, workingTool } from '@/components/chat/helpers';
import { MessageRow } from '@/components/chat/message';
import { useChatColors } from '@/components/chat/theme';
import type { AgentMessage, SentAttachment } from '@/components/chat/types';

// The flue agent chat — native port of the web AgentChat.jsx on the shared
// AgentProvider session (the same instance other tabs' Render buttons drive).
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

// "Try something new" is DERIVED, not a fixed list — see lib/suggestions.ts. The
// deck comes from the pipeline digest (/api/status), each card carries a composed
// brief rather than its own title as the prompt, and a card retires when its gap
// closes. Loading and failure are separate states here on purpose: skeletons
// while we don't know yet (a wrong deck for one beat is worse than none), the
// evergreen pair when the digest can't be read at all.

type Row = {
  key: string;
  message: AgentMessage;
  atts: SentAttachment[] | null;
};

// Stable empty transcript, so "no cover" keeps one identity across renders.
const NO_MESSAGES: AgentMessage[] = [];

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

// The colored header on each card, in place of the artwork these cards would
// carry if the studio had a thumbnail for a prompt. A 3×3 SwiftUI/Compose mesh
// (expo-mesh-gradient) rather than a flat fill or a linear ramp: the vertices
// bleed into each other, so every card reads as its own little piece of art.
//
// Every card gets its own look, and that look is DERIVED, never rolled: the
// palette and the vertex layout both come from a seed, so the same card wears
// the same header on every launch. The seed is always an IDENTITY hashed through
// `meshSeed` — a recap's chat id, a suggestion's card kind — never a list
// position, because both decks reorder (a recap on every reply, a suggestion
// every time a stage completes) and a position-seeded header would repaint the
// whole screen each time. A random pick would do the same on every launch.

// Where the mesh's nine vertices sit. Only the inner ones move between shapes —
// the corners stay pinned or the gradient detaches from the card's edges.
const MESH_SHAPES = [
  [[0, 0], [0.5, 0], [1, 0], [0, 0.5], [0.5, 0.5], [1, 0.5], [0, 1], [0.5, 1], [1, 1]],
  [[0, 0], [0.6, 0], [1, 0], [0, 0.4], [0.35, 0.6], [1, 0.35], [0, 1], [0.45, 1], [1, 1]],
  [[0, 0], [0.35, 0], [1, 0], [0, 0.6], [0.65, 0.35], [1, 0.65], [0, 1], [0.6, 1], [1, 1]],
  [[0, 0], [0.5, 0], [1, 0], [0, 0.3], [0.7, 0.7], [1, 0.6], [0, 1], [0.3, 1], [1, 1]],
];

// FNV-1a, so a chat id maps to a stable number without pulling in a hash lib.
function meshSeed(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// expo-mesh-gradient is a NATIVE module (SwiftUI on iOS, Compose on Android) and
// `requireNativeView` resolves at import, so a binary built before it was added
// has nothing to render — and an OTA update alone can't add one. Require it
// defensively so those builds fall back to a flat band instead of crashing the
// whole chat tab; a fresh dev/preview BUILD is what actually lights up the mesh.
let MeshGradientView: React.ComponentType<{
  style?: ViewStyle;
  columns?: number;
  rows?: number;
  colors?: string[];
  points?: number[][];
}> | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  MeshGradientView = require('expo-mesh-gradient').MeshGradientView;
} catch {
  MeshGradientView = null;
}

const MESHES = [
  // emerald — the app's own accent
  ['#6ee7b7', '#34d399', '#059669', '#a7f3d0', '#10b981', '#047857', '#d1fae5', '#6ee7b7', '#065f46'],
  // violet / indigo
  ['#c4b5fd', '#a78bfa', '#6366f1', '#ddd6fe', '#818cf8', '#4f46e5', '#ede9fe', '#a5b4fc', '#4338ca'],
  // amber / orange
  ['#fde68a', '#fbbf24', '#f97316', '#fef3c7', '#fb923c', '#ea580c', '#fef9c3', '#fdba74', '#c2410c'],
  // sky / cyan
  ['#bae6fd', '#38bdf8', '#06b6d4', '#e0f2fe', '#22d3ee', '#0891b2', '#f0f9ff', '#67e8f9', '#0e7490'],
  // rose / fuchsia
  ['#fbcfe8', '#f472b6', '#db2777', '#fce7f3', '#e879f9', '#be185d', '#fdf2f8', '#f0abfc', '#9d174d'],
  // lime / teal
  ['#d9f99d', '#a3e635', '#14b8a6', '#ecfccb', '#65a30d', '#0d9488', '#f7fee7', '#bef264', '#115e59'],
  // slate / steel blue
  ['#cbd5e1', '#94a3b8', '#475569', '#e2e8f0', '#64748b', '#334155', '#f1f5f9', '#a5b4fc', '#1e293b'],
  // coral / red
  ['#fecaca', '#f87171', '#dc2626', '#fee2e2', '#fb7185', '#b91c1c', '#fef2f2', '#fda4af', '#7f1d1d'],
] as const;

// A landing card. No liquid glass — over a near-white page it has nothing to
// refract and just muddies the card. Instead it's the app's standard card
// surface (`border border-border bg-card`, same as <Card> and the episode /
// shot / library rows) lifted off the page by a soft drop shadow, pressed
// through the shared <BouncyPressable> so these tap like every other card.
// A mesh-gradient band caps the top where a thumbnail would sit; the text sits
// below it on the plain surface.
function PressCard({
  children,
  onPress,
  label,
  seed,
  style,
}: {
  children: React.ReactNode;
  onPress: () => void;
  label: string;
  /** Stable number this card's header is derived from — see meshSeed. */
  seed: number;
  style?: ViewStyle;
}) {
  const palette = MESHES[seed % MESHES.length];
  // Shifted off the palette's own digit so two cards sharing a palette still
  // differ in shape, and so small seeds (a suggestion's index) don't all land
  // on shape 0.
  const points = MESH_SHAPES[(Math.floor(seed / MESHES.length) + seed * 3) % MESH_SHAPES.length];
  return (
    <BouncyPressable accessibilityLabel={label} onPress={onPress} style={styles.cardShadow}>
      <View className="border border-border bg-card" style={[styles.card, style]}>
        {MeshGradientView ? (
          <MeshGradientView
            style={styles.cardHeader}
            columns={3}
            rows={3}
            colors={palette as unknown as string[]}
            points={points}
          />
        ) : (
          <View style={[styles.cardHeader, { backgroundColor: palette[4] }]} />
        )}
        <View style={styles.cardBody}>{children}</View>
      </View>
    </BouncyPressable>
  );
}

// A landing section: a bold headline over a horizontally scrolling row of cards
// that bleeds off both edges (the row's own padding supplies the page margin,
// so a card can sit half-off-screen and invite the swipe).
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-3">
      <Text className="px-5 text-2xl font-bold text-foreground">{title}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </View>
  );
}

// Placeholders that hold the row's exact shape while the digest lands, so the
// real cards drop into a layout that's already there instead of the section
// popping in (and shoving Recaps up) a beat after the screen paints.
function SuggestionSkeletons() {
  const opacity = useSharedValue(0.35);
  useEffect(() => {
    opacity.value = withRepeat(withTiming(0.7, { duration: 900 }), -1, true);
  }, [opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <>
      {[0, 1, 2].map((i) => (
        <Animated.View
          key={i}
          style={[style, styles.cardShadow]}
          pointerEvents="none"
        >
          <View className="border border-border bg-card" style={[styles.card, styles.suggestionCard]}>
            <View style={[styles.cardHeader, { backgroundColor: MESHES[i][4] }]} />
            <View style={styles.cardBody}>
              <View className="h-3 w-16 rounded bg-muted" />
              <View className="mt-2 h-4 w-32 rounded bg-muted" />
              <View className="mt-1.5 h-4 w-20 rounded bg-muted" />
            </View>
          </View>
        </Animated.View>
      ))}
    </>
  );
}

export type Recap = { id: string; title: string; when: string };

// A one-shot entrance for the landing screen: it fades up (and drifts a few
// points) as it mounts, so opening a fresh chat resolves instead of snapping
// into place. Mount-only — nothing replays while the screen is up, and the
// transform means layout (and the native large title's insets) never moves.
function useEnterFade() {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withTiming(1, { duration: 620, easing: Easing.out(Easing.cubic) });
  }, [t]);
  return useAnimatedStyle(() => ({
    // Opacity runs slightly ahead of the drift, so the screen is legible for most
    // of the travel rather than arriving all at once at the end.
    opacity: Math.min(1, t.value * 1.35),
    transform: [{ translateY: (1 - t.value) * 16 }],
  }));
}

// The compact nav bar (44pt, under the status bar). The transcript now runs the
// FULL height of the screen — `headerTransparent` puts it under the bar so the
// glass has something moving behind it — so the list reserves this much at its
// top edge to sit clear of the bar at rest.
const COMPACT_HEADER = 44;

// iOS large-title chrome: a 44pt bar plus 52pt of headline, under the status
// bar. The scroll view spans the full screen BENEATH that (which is what lets
// the title collapse as you drag), so its own height overstates the visible
// band by exactly this much.
const LARGE_HEADER = 44 + 52;

// The landing screen of a fresh chat: a line of intent, then Recaps (the chats
// you already have — tap one to pick it back up) and Try something new (the
// starter prompts). Content is TOP-aligned under the headline, not centered.
//
// A ScrollView rather than a plain View for two reasons: it's the scroll view
// the native large "Chat" title tracks (contentInsetAdjustmentBehavior=
// "automatic" — the title collapses as you drag), and it bounces at both ends
// even when everything fits, so the surface feels alive instead of nailed down.
// minHeight is the measured visible band (the scroll view's own height, which
// already excludes the composer, minus the header above it) — enough to fill the
// screen and bounce, without a header's worth of dead space to scroll through.
function EmptyChat({
  onSuggest,
  recaps,
  onOpenRecap,
  composerOverlap,
}: {
  onSuggest: (s: string) => void;
  recaps: Recap[];
  onOpenRecap: (id: string) => void;
  /**
   * How far the floating composer reaches past the tab bar into this scroll
   * view. `contentInsetAdjustmentBehavior="automatic"` already clears the tab
   * bar itself, so only the overhang above it is ours to reserve.
   */
  composerOverlap: number;
}) {
  const insets = useSafeAreaInsets();
  const enter = useEnterFade();
  const [viewport, setViewport] = useState(0);
  // The scroll view runs the full height of the screen (the composer floats over
  // it), so the visible band excludes the composer's overhang as well as the
  // header.
  const band = viewport ? Math.max(0, viewport - insets.top - LARGE_HEADER - composerOverlap) : 0;

  // The suggestion deck. Fetched HERE rather than in ChatScreen so it's only
  // requested when the landing screen is actually on screen — a chat with a
  // transcript never asks. The query is the shared project-scoped one, so it's
  // cached across chat switches and invalidated by the SSE firehose (which is how
  // a card retires seconds after the agent closes its gap).
  const { data: status, isLoading, isError } = useProjectResource<Status>('status');
  // isLoading, not isPending: a query with no project yet is disabled and would
  // report "pending" forever (skeletons that never resolve), and a background
  // refetch must leave the deck we're already showing alone.
  const loadingSuggestions = isLoading;
  const suggestions = useMemo<Suggestion[]>(
    () => (isError || !status ? FALLBACK_SUGGESTIONS : buildSuggestions(status)),
    [status, isError],
  );
  return (
    // Animated.ScrollView (not a wrapper View) so the fade rides the SAME native
    // scroll view the large "Chat" title tracks — wrapping it would break
    // contentInsetAdjustmentBehavior.
    <Animated.ScrollView
      style={[styles.list, enter]}
      onLayout={(e) => setViewport(e.nativeEvent.layout.height)}
      contentContainerStyle={[
        styles.emptyContent,
        band ? { minHeight: band } : styles.emptyGrow,
        { paddingBottom: 24 + composerOverlap },
      ]}
      contentInsetAdjustmentBehavior="automatic"
      alwaysBounceVertical
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      <Text className="px-5 pb-2 text-base text-muted-foreground">
        Ask me anything to create or talk about your story
      </Text>

      {recaps.length ? (
        <Section title="Recaps">
          {recaps.map((r) => (
            <PressCard
              key={r.id}
              label={r.title}
              seed={meshSeed(r.id)}
              style={styles.recapCard}
              onPress={() => onOpenRecap(r.id)}
            >
              <Text className="text-xs text-muted-foreground">{r.when}</Text>
              <Text className="mt-1 text-lg font-semibold leading-6 text-foreground" numberOfLines={4}>
                {r.title}
              </Text>
            </PressCard>
          ))}
        </Section>
      ) : null}

      <Section title="Try something new">
        {loadingSuggestions ? (
          <SuggestionSkeletons />
        ) : (
          suggestions.map((s) => (
            <PressCard
              key={s.id}
              // The composed brief is the prompt but a screen reader wants the
              // headline, not a paragraph.
              label={s.subtitle ? `${s.title} — ${s.subtitle}` : s.title}
              // Seeded off the card KIND, so "Board the episode" wears the same
              // artwork every time it comes back — the deck reorders constantly
              // as work lands, and position-seeded headers would reshuffle with it.
              seed={meshSeed(s.id)}
              style={styles.suggestionCard}
              onPress={() => onSuggest(s.prompt)}
            >
              {s.subtitle ? (
                <Text className="text-xs text-muted-foreground" numberOfLines={2}>
                  {s.subtitle}
                </Text>
              ) : null}
              <Text className="mt-1 text-lg font-semibold leading-6 text-foreground" numberOfLines={2}>
                {s.title}
              </Text>
            </PressCard>
          ))
        )}
      </Section>
    </Animated.ScrollView>
  );
}

export default function ChatScreen() {
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
    pinned.value = true;
    setRemountKey((k) => k + 1);
  }, [activeId, getInitial, pinned]);

  // --- The cover (see src/lib/agent/transcript-cache.ts) ---
  //
  // flue re-streams this chat's durable transcript on every cold start, so
  // `agent.messages` is empty for the first beat and the screen would flash the
  // "Ask me to build the episode" empty state before the history popped in. flue
  // can't be seeded, so we render our own local mirror of the last-seen transcript
  // meanwhile and swap to the live one when it lands. The swap is a plain data
  // change on the same inverted list — no remount, no scroll jump, and identical
  // rows, so it reads as the chat simply being there.
  //
  // The active chat's cover is already in memory (the provider warms it during
  // boot), so this is a render-time read — no state, no post-mount frame. The
  // async branch below only covers switching into a chat whose cover hasn't been
  // read this launch.
  const memCover = peekTranscript(activeId);
  const [asyncCover, setAsyncCover] = useState<{ id: string; messages: AgentMessage[] } | null>(
    null,
  );
  useEffect(() => {
    if (memCover) return;
    let alive = true;
    preloadTranscript(activeId).then((m) => {
      if (alive && m.length) setAsyncCover({ id: activeId, messages: m });
    });
    return () => {
      alive = false;
    };
  }, [activeId, memCover]);
  const cover = memCover ?? (asyncCover?.id === activeId ? asyncCover.messages : NO_MESSAGES);

  const live: AgentMessage[] = agent?.messages ?? [];
  const historyReady: boolean = !!agent?.historyReady;
  const showingCover = !historyReady && live.length === 0 && cover.length > 0;
  const messages: AgentMessage[] = showingCover ? cover : live;
  // No cover and nothing live yet: an EXISTING chat is still loading (skeleton),
  // but a brand-new one has no server transcript to wait for — it gets the empty
  // state right away. Mirrors the web `looksNew` gate in AgentChat.jsx.
  const activeChat = (conv.list as Chat[]).find((ch) => ch.id === activeId);
  const looksNew =
    !activeChat || (activeChat.title === 'New chat' && !activeChat.attachments?.length);
  const waitingForHistory = !historyReady && !looksNew;
  const showEmpty = messages.length === 0 && !waitingForHistory;
  const busy = agentIsBusy(agent);
  const thinking = useMemo(() => isThinking(messages, busy), [messages, busy]);
  const working = useMemo(() => workingTool(messages, busy), [messages, busy]);
  const reasoning = useMemo(() => isReasoning(messages, busy), [messages, busy]);
  // Interactive `ask_question` cards: which one is pending vs already answered.
  const qa = useMemo(() => deriveQA(messages), [messages]);
  // A question card on the cover is a picture of one — answering it would send
  // against a transcript flue hasn't handed us yet.
  const canRespond = !busy && !showingCover;

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

  // The composer floats OVER the transcript (docked absolutely, so messages
  // slide under its glass), and rides the keyboard via a transform. The list
  // reserves matching space at the newest (visual-bottom) edge — which, for an
  // inverted list, is the ListHeaderComponent: the bar's own measured height,
  // plus however far the keyboard has lifted it (keyboardHeight is negative
  // while open, and the sticky view already absorbs the bottom inset).
  const [composerHeight, setComposerHeight] = useState(0);
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
  // The list's frame now starts at the top of the SCREEN (transparent header),
  // so the oldest message would otherwise rest under the bar. Reserved as
  // content padding rather than a contentInset: the stick-to-bottom pin measures
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
      pinned.value = true;
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
      pinned.value = true;
      setAtNewest(true);
      void agent?.send?.({ message: t, images: images.length ? images : undefined });
    },
    [agent, recordAttachments, atNewest],
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

  const errorMessage = agent?.error ? String(agent.error?.message ?? agent.error) : null;

  // Recaps — the chats you already have, newest first, minus this empty one and
  // any other untouched "New chat". Tapping one switches the active conversation
  // (the same thing the Chats sheet does), so the landing screen is a shortcut
  // into history rather than a second copy of it.
  const recaps = useMemo<Recap[]>(
    () =>
      (conv.list as Chat[])
        .filter((ch) => ch.id !== activeId && ch.title && ch.title !== 'New chat')
        .slice(0, 10)
        .map((ch) => ({ id: ch.id, title: ch.title as string, when: relTime(ch.updatedAt) })),
    [conv.list, activeId],
  );
  const openRecap = useCallback(
    (id: string) => {
      Haptics.selectionAsync().catch(() => {});
      conv.switchChat(id);
    },
    [conv],
  );

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
          // Large title ONLY on the empty landing screen (the ScrollView in
          // <EmptyChat> is what it tracks), like the Settings / Chats sheets.
          // A transcript gets the compact title back: the inverted list has no
          // top to collapse against, and the stream reads better under a slim
          // bar.
          headerLargeTitle: showEmpty,
          // Liquid-glass header (iOS 26). Three parts, all required:
          //   - `headerTransparent` → the native bar becomes translucent AND the
          //     screen is laid out UNDER it (edgesForExtendedLayout), so the
          //     transcript actually passes behind the bar. Without content moving
          //     back there, glass has nothing to refract and reads as a flat tint.
          //   - the two transparent backgrounds override `useHeaderBase`'s solid
          //     `pageBg`, which is what kept the bar opaque white. react-native-
          //     screens builds an OPAQUE appearance for any background whose alpha
          //     isn't 0 — `headerStyle` feeds the standard appearance and
          //     `headerLargeStyle` the scroll-edge one (the bar at rest), so
          //     leaving either set keeps a solid bar in that state.
          //   - `scrollEdgeEffects.top` is the iOS 26 effect itself: the
          //     progressive blur/fade UIKit draws on the scroll view where it
          //     slides under the bar. 'soft' = soft-edged (no dividing line);
          //     'hard' adds the hairline, 'hidden' turns it off.
          headerTransparent: true,
          headerStyle: { backgroundColor: 'transparent' },
          headerLargeStyle: { backgroundColor: 'transparent' },
          scrollEdgeEffects: { top: 'soft' },
          unstable_headerRightItems: () => headerItems,
          headerRight: () => (
            <ChatHeaderRight onHistoryPress={onHistoryPress} onNewChat={onNewChat} />
          ),
        }}
      />

      {showEmpty ? (
        <EmptyChat
          onSuggest={sendQuick}
          recaps={recaps}
          onOpenRecap={openRecap}
          composerOverlap={composerOverlap}
        />
      ) : (
        <View className="relative min-h-0 flex-1">
          {rows.length === 0 ? (
            <TranscriptSkeleton />
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
      )}

      {/* Docked over the content (box-none so the transcript keeps scrolling
          everywhere the bar isn't) — that's what puts moving pixels behind the
          composer's liquid glass. */}
      <Composer
        pending={!!qa.pendingId && !busy}
        busy={busy}
        onStop={() => agent?.stop?.()}
        onSubmit={submit}
        onHeightChange={setComposerHeight}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  listContent: { flexGrow: 1, justifyContent: 'flex-end', gap: 16, paddingVertical: 16 },
  emptyContent: { paddingTop: 8, paddingBottom: 24, gap: 20 },
  // Only until the viewport is measured (one frame) — then a minHeight takes
  // over; see EmptyChat.
  emptyGrow: { flexGrow: 1 },
  // A section's card row: the page margin lives here so a card can bleed off
  // the edge and invite the sideways swipe. The vertical padding is room for the
  // drop shadow and for the press grow to bleed into — without it the row clips
  // both, squaring off the corners against its own edge.
  row: { paddingHorizontal: 20, paddingVertical: 10, gap: 12 },
  // The shadow lives on its own wrapper because the card body clips (overflow
  // hidden) to hold its corner radius, and on iOS a clipping view drops its own
  // shadow.
  cardShadow: {
    borderRadius: 22,
    shadowColor: '#000',
    shadowOpacity: 0.13,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    paddingBottom: 15,
  },
  // The card body: the app's standard surface (border + bg-card come from the
  // className) with the landing screen's rounder corners and roomier padding.
  card: {
    borderRadius: 22,
    // Clips the mesh header into the card's rounded top corners. Safe here: the
    // drop shadow lives on the wrapper above, so nothing of ours gets cut.
    overflow: 'hidden',
  },
  // The "artwork" band — a fixed slab of colour at the top of every card.
  cardHeader: { height: 56 },
  // Text sits on the plain surface below the band, pinned to the bottom so
  // one-liners and four-liners both hang off the same edge.
  cardBody: { flex: 1, justifyContent: 'flex-end', padding: 14 },
  recapCard: { width: 240, height: 130 },
  // Taller than a recap: a suggestion carries an eyebrow line (what's missing,
  // how many shots) above its headline, and the height is the worst case of both
  // at their line caps — a card that clipped its own subtitle would hide the
  // number that makes it worth tapping.
  suggestionCard: { width: 215, height: 168 },
});
