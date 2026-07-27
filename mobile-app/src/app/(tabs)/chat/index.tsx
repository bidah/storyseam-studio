import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useConversations, useIsFreshChat } from '@/lib/agent/provider';
import { setPendingDraft } from '@/lib/agent/pending-draft';
import type { Chat } from '@/lib/agent/chat-store';
import { useProjectResource } from '@/lib/queries';
import {
  buildSuggestions,
  FALLBACK_SUGGESTIONS,
  type Status,
  type Suggestion,
} from '@/lib/suggestions';
import { BouncyPressable } from '@/components/ui/bouncy-pressable';
import { Composer, type LocalAttachment } from '@/components/chat/composer';
import { relTime } from '@/components/chat/helpers';

// The Chat tab's LANDING screen — the home for starting a chat. A line of
// intent, then Recaps (the chats you already have — tap one to pick it back up)
// and Try something new (the starter prompts), over the same composer a
// conversation uses.
//
// It holds no transcript: sending here mints a chat and PUSHES `[id]`, which is
// what makes the native header morph (menu slides right of a back button,
// history gains new chat — see ./_layout.tsx). Nothing on this screen is
// disabled-because-blank; blank is what it's for.
//
// "Try something new" is DERIVED, not a fixed list — see lib/suggestions.ts. The
// deck comes from the pipeline digest (/api/status), each card carries a composed
// brief rather than its own title as the prompt, and a card retires when its gap
// closes. Loading and failure are separate states here on purpose: skeletons
// while we don't know yet (a wrong deck for one beat is worse than none), the
// evergreen pair when the digest can't be read at all.

// iOS large-title chrome: a 44pt bar plus 52pt of headline, under the status
// bar. The scroll view spans the full screen BENEATH that (which is what lets
// the title collapse as you drag), so its own height overstates the visible
// band by exactly this much.
const LARGE_HEADER = 44 + 52;

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
        <Animated.View key={i} style={[style, styles.cardShadow]} pointerEvents="none">
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
// points) as it mounts, so opening the tab resolves instead of snapping into
// place. Mount-only — nothing replays while the screen is up, and the transform
// means layout (and the native large title's insets) never moves.
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

export default function ChatHomeScreen() {
  const conv = useConversations();
  const insets = useSafeAreaInsets();
  const enter = useEnterFade();
  const [viewport, setViewport] = useState(0);
  const [composerHeight, setComposerHeight] = useState(0);
  // The scroll view runs the full height of the screen (the composer floats over
  // it), so the visible band excludes the composer's overhang as well as the
  // header. `contentInsetAdjustmentBehavior="automatic"` already clears the tab
  // bar itself, so only the overhang above it is ours to reserve.
  const band = viewport ? Math.max(0, viewport - insets.top - LARGE_HEADER - composerHeight) : 0;

  // Every project starts with a blank chat (`withActiveForProject`), and this
  // screen is that chat's face. Reuse it when it's still untouched instead of
  // minting a second one, or history fills up with identical "New chat" rows.
  const reusable = useIsFreshChat();

  // The suggestion deck — the shared project-scoped query, so it's cached across
  // chat switches and invalidated by the SSE firehose (which is how a card
  // retires seconds after the agent closes its gap).
  const { data: status, isLoading, isError } = useProjectResource<Status>('status');
  // isLoading, not isPending: a query with no project yet is disabled and would
  // report "pending" forever (skeletons that never resolve), and a background
  // refetch must leave the deck we're already showing alone.
  const suggestions = useMemo<Suggestion[]>(
    () => (isError || !status ? FALLBACK_SUGGESTIONS : buildSuggestions(status)),
    [status, isError],
  );

  // Recaps — the chats you already have, newest first, minus any untouched
  // "New chat" (which is what this screen already is). Tapping one opens its
  // conversation, so the landing screen is a shortcut into history rather than a
  // second copy of it.
  const recaps = useMemo<Recap[]>(
    () =>
      (conv.list as Chat[])
        .filter((ch) => ch.title && ch.title !== 'New chat')
        .slice(0, 10)
        .map((ch) => ({ id: ch.id, title: ch.title as string, when: relTime(ch.updatedAt) })),
    [conv.list],
  );

  const openRecap = useCallback((id: string) => {
    Haptics.selectionAsync().catch(() => {});
    router.push(`/(tabs)/chat/${id}`);
  }, []);

  // Start a conversation: park the first message where the conversation screen
  // will pick it up, then push that screen. The send itself HAS to happen there
  // — the shared flue session only repoints at the new chat a render later (see
  // lib/agent/pending-draft.ts).
  const openWithDraft = useCallback(
    (text: string, attachments: LocalAttachment[]) => {
      const id: string = reusable && conv.activeId ? conv.activeId : conv.newChat();
      setPendingDraft(id, { text, attachments });
      router.push(`/(tabs)/chat/${id}`);
    },
    [conv, reusable],
  );

  const onSuggest = useCallback(
    (prompt: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      openWithDraft(prompt, []);
    },
    [openWithDraft],
  );

  // The composer's contract is async (it awaits before clearing), but there's
  // nothing to await here: uploads happen on the conversation screen, so this
  // screen hands off and navigates immediately.
  const onSubmit = useCallback(
    async (text: string, atts: LocalAttachment[]) => {
      openWithDraft(text, atts);
    },
    [openWithDraft],
  );

  return (
    <View className="flex-1 bg-background">
      {/* Content is TOP-aligned under the headline, not centered.
          A ScrollView rather than a plain View for two reasons: it's the scroll
          view the native large "Chat" title tracks (contentInsetAdjustmentBehavior
          = "automatic" — the title collapses as you drag), and it bounces at both
          ends even when everything fits, so the surface feels alive instead of
          nailed down. minHeight is the measured visible band — enough to fill the
          screen and bounce, without a header's worth of dead space to scroll
          through. */}
      <Animated.ScrollView
        style={[styles.list, enter]}
        onLayout={(e) => setViewport(e.nativeEvent.layout.height)}
        contentContainerStyle={[
          styles.content,
          band ? { minHeight: band } : styles.grow,
          { paddingBottom: 24 + composerHeight },
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
                onPress={() => openRecap(r.id)}
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
          {isLoading ? (
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

      {/* The same floating liquid-glass bar the conversation screen uses. Never
          busy here: whatever it sends opens a chat of its own. */}
      <Composer
        pending={false}
        busy={false}
        onStop={() => {}}
        onSubmit={onSubmit}
        onHeightChange={setComposerHeight}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  content: { paddingTop: 8, paddingBottom: 24, gap: 20 },
  // Only until the viewport is measured (one frame) — then a minHeight takes over.
  grow: { flexGrow: 1 },
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
