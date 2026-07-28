import { Children, useCallback, useEffect, useMemo, useState } from 'react';
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
import { useConversations, useIsFreshChat } from '@/lib/agent/provider';
import { openChatModal } from '@/lib/agent/chat-route';
import { setPendingDraft } from '@/lib/agent/pending-draft';
import type { Chat } from '@/lib/agent/chat-store';
import { useProjectResource, useProjects } from '@/lib/queries';
import { useProjectStore } from '@/lib/project';
import {
  buildSuggestions,
  FALLBACK_SUGGESTIONS,
  type Status,
  type Suggestion,
} from '@/lib/suggestions';
import { BouncyPressable } from '@/components/ui/bouncy-pressable';
import { DiscoverSection } from '@/components/chat/discover';
import type { LocalAttachment } from '@/components/chat/composer';
import { useChatComposer } from '@/components/chat/composer-host';
import { relTime } from '@/components/chat/helpers';

// The Home tab's LANDING screen — the hub for starting a chat, and a LAUNCHER
// rather than a place a conversation lives. Recaps (the chats you already have —
// tap one to pick it back up) lead, then Continue building your story (the
// starter prompts).
// It docks no composer of its own: the tab bar's agent pill is the typing surface
// here (see components/chat/agent-accessory.tsx).
//
// Every card OPENS THE CHAT MODAL (src/app/session/), which is also what the pill
// opens from every tab — so the conversation is one surface, reached identically
// from anywhere, and closing it always puts you back where you were. See
// lib/agent/chat-route.ts for why that beat pushing inside this tab's stack.
//
// This screen holds no transcript: a suggestion tap mints a chat, parks the first
// message, and hands both to that modal.
//
// "Continue building your story" is DERIVED, not a fixed list — see
// lib/suggestions.ts (where the same deck is called "Try something new", the
// name the web landing still uses). The
// deck comes from the pipeline digest (/api/status), each card carries a composed
// brief rather than its own title as the prompt, and a card retires when its gap
// closes. Loading and failure are separate states here on purpose: skeletons
// while we don't know yet (a wrong deck for one beat is worse than none), the
// evergreen pair when the digest can't be read at all.

// The compact iOS bar under the status bar. The section headlines are OURS —
// in-content, wearing the large-title font — not a native large title, so the
// bar contributes only its own 44pt to the chrome the scroll view runs beneath.
const HEADER_BAR = 44;

// Card geometry, up here because the snap interval is derived from it: a row
// rests on multiples of (card + gap), so these three numbers have to agree or a
// snapped card sits at the wrong margin.
const ROW_GAP = 12;
const ROW_PAD = 20;
const RECAP_W = 240;
// A suggestion card is a poster, not a chip: big enough for a large headline over
// a real paragraph of what the card would actually do.
const SUGGESTION_W = 305;
// The card's height is the BAND PLUS the text budget below it (see cardBlurb),
// not a round number the text has to survive inside. That's why growing the band
// grows the card: the artwork is the card's subject, and the copy under it is a
// fixed three-lines-plus-four, so squeezing the two against a fixed height would
// only ever cost the paragraph.
// The band is a placeholder for ARTWORK — a generated image per card, once there
// is one — so it's sized as a picture slot (305×168, a touch wider than 16:9),
// with the mesh gradient standing in until the image exists.
const SUGGESTION_BAND = 168;
const SUGGESTION_BODY = 187;
const SUGGESTION_H = SUGGESTION_BAND + SUGGESTION_BODY;
// A recap is a text row: its mesh is a thin spine down the LEFT edge (see
// bandSide), so this is a width, not a height.
const CARD_BAND = 10;

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

// The recap section's headline is the ACTIVE PROJECT'S NAME (it doubles as the
// page title — see Section), worn in Title Case whatever casing the stored name
// has. Only first letters are touched: the rest of each word keeps its casing,
// so an all-caps acronym in a name survives.
function titleCase(s: string): string {
  return s.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

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
// A mesh-gradient band caps the top where a thumbnail would sit; `'none'` leaves
// the card plain white, which is what the recaps wear — at a spine's width the
// colour was decoration competing with the titles, and a row of white cards reads
// as one list.
function PressCard({
  children,
  onPress,
  label,
  seed,
  style,
  bodyStyle,
  bandHeight = CARD_BAND,
  bandSide = 'top',
}: {
  children: React.ReactNode;
  onPress: () => void;
  label: string;
  /** Stable number this card's header is derived from — see meshSeed. */
  seed: number;
  style?: ViewStyle;
  /** Overrides how the text block sits under the band (see cardBody). */
  bodyStyle?: ViewStyle;
  /** The band's thickness — its height on top, its width as a left spine. */
  bandHeight?: number;
  /** Which edge the mesh sits on — 'left' is a spine, 'none' is no mesh at all. */
  bandSide?: 'top' | 'left' | 'none';
}) {
  const palette = MESHES[seed % MESHES.length];
  // Shifted off the palette's own digit so two cards sharing a palette still
  // differ in shape, and so small seeds (a suggestion's index) don't all land
  // on shape 0.
  const points = MESH_SHAPES[(Math.floor(seed / MESHES.length) + seed * 3) % MESH_SHAPES.length];
  // As a spine the band takes the cross axis from the row: width is its own,
  // height stretches to the card's.
  const band: ViewStyle = bandSide === 'left' ? { width: bandHeight } : { height: bandHeight };
  return (
    <BouncyPressable accessibilityLabel={label} onPress={onPress} style={styles.cardShadow}>
      <View
        className="border border-border bg-card"
        style={[styles.card, bandSide === 'left' && styles.cardRow, style]}
      >
        {/* No band at all on a plain card. Otherwise: a mesh on the wide top
            bands, and a FLAT fill for a spine — at 10pt wide a gradient reads as
            colour noise, not art, though the seed still picks the hue. */}
        {bandSide === 'none' ? null : MeshGradientView && bandSide !== 'left' ? (
          <MeshGradientView
            style={band}
            columns={3}
            rows={3}
            colors={palette as unknown as string[]}
            points={points}
          />
        ) : (
          <View style={[band, { backgroundColor: palette[4] }]} />
        )}
        <View style={[styles.cardBody, bodyStyle]}>{children}</View>
      </View>
    </BouncyPressable>
  );
}

// A landing section: a bold headline over a horizontally scrolling row of cards
// that bleeds off both edges (the row's own padding supplies the page margin,
// so a card can sit half-off-screen and invite the swipe).
//
// The row SNAPS a card at a time rather than coasting: every rest position puts
// a card's left edge exactly ROW_PAD from the screen — the same margin the
// first card has — instead of leaving a swipe stopped mid-card. The snap points
// are EXPLICIT offsets (one per card, a card-plus-gap apart) rather than
// `snapToInterval`, which proved unreliable on the recap row under the New
// Architecture; `snapToOffsets` pins the exact same positions dependably.
// (`pagingEnabled` is no good either way — it snaps to viewport widths.)
// `decelerationRate="fast"` keeps the flick from overshooting the next card
// before the snap grabs it.
function Section({
  title,
  cardWidth,
  small,
  children,
}: {
  title: string;
  /** Card width for this row — snap offsets are that plus the row's gap apart. */
  cardWidth: number;
  /** Half-size headline — every section below the page-title one wears this. */
  small?: boolean;
  children: React.ReactNode;
}) {
  const count = Children.count(children);
  const offsets = useMemo(
    () => Array.from({ length: count }, (_, i) => i * (cardWidth + ROW_GAP)),
    [count, cardWidth],
  );
  return (
    // gap-0.5, not the gap-3 the Discover section uses: the card row carries
    // 10pt of its own top padding (shadow-bleed room — see styles.row), so 2pt
    // here lands the headline the same 12pt from the cards as Discover's.
    <View className="gap-0.5">
      {/* Only the FIRST section's headline wears UIKit's large-title metrics
          (34pt bold) — the screen has no headline of its own, so the project
          name up top IS the page's big title. The sections under it step down
          to half that size so they read as subheads, not rival titles. */}
      <Text
        accessibilityRole="header"
        className="px-5 text-foreground"
        style={small ? styles.smallTitle : styles.bigTitle}
      >
        {title}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="handled"
        snapToOffsets={offsets}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
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
            <View style={{ height: SUGGESTION_BAND, backgroundColor: MESHES[i][4] }} />
            {/* Two bars for the headline, three for the paragraph — the real
                card's proportions, so nothing shifts when the deck lands. */}
            <View style={[styles.cardBody, styles.suggestionBody]}>
              <View className="h-5 w-44 rounded bg-muted" />
              <View className="mt-1 h-5 w-28 rounded bg-muted" />
              <View className="mt-4 h-3.5 w-48 rounded bg-muted" />
              <View className="mt-2 h-3.5 w-44 rounded bg-muted" />
              <View className="mt-2 h-3.5 w-24 rounded bg-muted" />
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
  // The visible band excludes only the header chrome:
  // `contentInsetAdjustmentBehavior="automatic"` already clears the tab bar
  // (accessory pill included — it's part of the tab's safe area).
  const band = viewport ? Math.max(0, viewport - insets.top - HEADER_BAR) : 0;

  // Every project starts with a blank chat (`withActiveForProject`), and this
  // screen is that chat's face. Reuse it when it's still untouched instead of
  // minting a second one, or history fills up with identical "New chat" rows.
  const reusable = useIsFreshChat();

  // The recap headline is the active project's name — the page title, really
  // (see Section). "Last chats" only covers the beat before the account's
  // project list has loaded.
  const projectId = useProjectStore((s) => s.projectId);
  const { data: projectsData } = useProjects();
  const projectName = projectsData?.projects.find((p) => p.id === projectId)?.name;

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
    openChatModal(id);
  }, []);

  // Start a conversation: park the first message where the conversation will pick
  // it up, then open the modal on it. The send itself HAS to happen there — the
  // shared flue session only repoints at the new chat a render later (see
  // lib/agent/pending-draft.ts).
  const openWithDraft = useCallback(
    (text: string, attachments: LocalAttachment[]) => {
      const id: string = reusable && conv.activeId ? conv.activeId : conv.newChat();
      setPendingDraft(id, { text, attachments });
      openChatModal(id);
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

  // This screen docks NO composer — the tab bar's agent pill (the accessory) is
  // the way to start typing here, and it can't share the bottom edge with a second
  // bar. Registering null also clears whatever a popped conversation left on this
  // stack's shared composer.
  useChatComposer(null);

  return (
    <View className="flex-1 bg-background">
      {/* Content is TOP-aligned under the headline, not centered.
          A ScrollView rather than a plain View for two reasons:
          contentInsetAdjustmentBehavior="automatic" lays it out under the
          transparent bar and tab bar for the glass scroll-under, and it bounces
          at both ends even when everything fits, so the surface feels alive
          instead of nailed down. minHeight is the measured visible band — enough
          to fill the screen and bounce, without dead space to scroll through. */}
      <Animated.ScrollView
        style={[styles.list, enter]}
        onLayout={(e) => setViewport(e.nativeEvent.layout.height)}
        contentContainerStyle={[styles.content, band ? { minHeight: band } : styles.grow]}
        contentInsetAdjustmentBehavior="automatic"
        alwaysBounceVertical
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {recaps.length ? (
          <Section title={projectName ? titleCase(projectName) : 'Last chats'} cardWidth={RECAP_W}>
            {recaps.map((r) => (
              <PressCard
                key={r.id}
                label={r.title}
                seed={meshSeed(r.id)}
                style={styles.recapCard}
                bandSide="none"
                onPress={() => openRecap(r.id)}
              >
                <Text className="text-xs text-muted-foreground">{r.when}</Text>
                {/* Small text on purpose — a recap is a row you recognize, not a
                    poster you read; the big headline type stays on the
                    suggestion cards. With the mesh as a spine the band costs no
                    height, which is what buys the third line. */}
                <Text className="mt-1 text-foreground" style={styles.recapTitle} numberOfLines={3}>
                  {r.title}
                </Text>
              </PressCard>
            ))}
          </Section>
        ) : null}

        <Section title="Continue building your story" cardWidth={SUGGESTION_W} small>
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
                bodyStyle={styles.suggestionBody}
                bandHeight={SUGGESTION_BAND}
                onPress={() => onSuggest(s.prompt)}
              >
                {/* Poster order: the headline reads FIRST, hanging off the mesh
                    band, and the paragraph explains it underneath. (A recap is
                    the other way round — its timestamp is an eyebrow.) */}
                <Text className="text-foreground" style={styles.cardTitle} numberOfLines={3}>
                  {s.title}
                </Text>
                <Text className="text-muted-foreground" style={styles.cardBlurb} numberOfLines={5}>
                  {s.blurb}
                </Text>
              </PressCard>
            ))
          )}
        </Section>

        {/* Discover — the editorial deck, full width, under the derived one.
            Its cards ZOOM into their own screen rather than sending a prompt on
            the spot (see components/chat/discover.tsx). */}
        <DiscoverSection />
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  // UIKit's large-title text style: SF Pro at 34pt bold, 41pt line height.
  bigTitle: { fontSize: 34, fontWeight: '700', lineHeight: 41 },
  // Half the large title, for every section headline below the first — kept in
  // lockstep with headline in components/chat/discover.tsx.
  smallTitle: { fontSize: 20, fontWeight: '700', lineHeight: 25 },
  content: { paddingTop: 8, paddingBottom: 24, gap: 20 },
  // Only until the viewport is measured (one frame) — then a minHeight takes over.
  grow: { flexGrow: 1 },
  // A section's card row: the page margin lives here so a card can bleed off
  // the edge and invite the sideways swipe. The vertical padding is room for the
  // drop shadow and for the press grow to bleed into — without it the row clips
  // both, squaring off the corners against its own edge.
  row: { paddingHorizontal: ROW_PAD, paddingVertical: 10, gap: ROW_GAP },
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
  // A left-spine card lays out as a row: mesh first, text beside it.
  cardRow: { flexDirection: 'row' },
  // Text sits on the plain surface below the band, pinned to the bottom so
  // one-liners and four-liners both hang off the same edge.
  cardBody: { flex: 1, justifyContent: 'flex-end', padding: 14 },
  // No band, so the budget is all text: padding (14×2) + timestamp eyebrow (16 +
  // its 4pt gap) + THREE recapTitle lines (3×20) = 108. Three is also what the
  // stored title is capped to fill — see deriveTitle in lib/agent/chat-store.ts;
  // grow one and the other has to follow, or the card shows blank space.
  recapCard: { width: RECAP_W, height: 108 },
  // A poster, not a chip. The height is the worst case of the layout below —
  // three lines of headline over four of paragraph, plus the padding — because a
  // card that clipped its own last line would hide the reason to tap it.
  suggestionCard: { width: SUGGESTION_W, height: SUGGESTION_H },
  // The suggestion card reads TOP-DOWN, unlike the recap's bottom-hung text: the
  // headline sits right under the mesh band with one padding's worth of air
  // between them, and the paragraph flows below it.
  suggestionBody: {
    justifyContent: 'flex-start',
    paddingTop: 14,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  // The Discover posters' title metrics (see title in components/chat/discover.tsx)
  // so the two decks of big cards share one headline size — under the section
  // headlines, so a card can't outshout the row it sits in.
  cardTitle: { fontSize: 17, fontWeight: '700', lineHeight: 21, letterSpacing: -0.2 },
  // The recap's small title — body-sized, semibold so it still reads as the
  // card's name over the muted timestamp above it.
  recapTitle: { fontSize: 15, fontWeight: '600', lineHeight: 20 },
  // The paragraph under it. The leading on both texts is a budget, not taste: a
  // three-line headline (63) plus its gap (8) plus five blurb lines (90) plus the
  // body's padding (26) is 187, which is exactly what SUGGESTION_BODY reserves.
  // Grow either text and raise SUGGESTION_BODY with it, or the last line clips.
  cardBlurb: { marginTop: 8, fontSize: 14, lineHeight: 18 },
});
