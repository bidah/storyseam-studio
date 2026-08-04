import { Children, use, useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View, type ViewStyle } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Link, useFocusEffect } from 'expo-router';
import { Check, SquarePen } from 'lucide-react-native';
import { MESH_PALETTES, meshPalette, meshSeed, meshShape } from '@/lib/card-art';
import { cardArt } from '@/lib/card-art-url';
import { CardArtVideo } from '@/components/chat/card-art-video';
import { useConversations, useIsFreshChat } from '@/lib/agent/provider';
import { openChatModal } from '@/lib/agent/chat-route';
import type { Chat } from '@/lib/agent/chat-store';
import { useProjectResource } from '@/lib/queries';
import {
  buildSuggestions,
  FALLBACK_SUGGESTIONS,
  type Status,
  type Suggestion,
} from '@/lib/suggestions';
import { sweepSuggestions } from '@/lib/suggestion-progress';
import { FULL_DECK } from '@/lib/deck-options';
import { onShowcaseMove, registerZoomSource } from '@/lib/deck-return';
// Internal, and knowingly so: the zoom identity of a <Link> is a `useId()` kept
// in the link's own context, and the return leg has to know which card carries
// which one. Reading the context is the only way to learn it — see
// lib/deck-return.ts for what it's for, and <ZoomSourceBeacon> below for the
// (null-rendering, layout-free) way it's read.
import { ZoomTransitionSourceContext } from 'expo-router/build/link/zoom/zoom-transition-context';
import { BouncyPressable } from '@/components/ui/bouncy-pressable';
import { DiscoverSection } from '@/components/chat/discover';
import { ProBanner } from '@/components/chat/pro-banner';
import { useChatComposer } from '@/components/chat/composer-host';
import { useChatColors } from '@/components/chat/theme';
import { dayLabel } from '@/components/chat/helpers';

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
// in-content — not a native large title, so the bar contributes only its own
// 44pt to the chrome the scroll view runs beneath.
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
// carry if the studio had a thumbnail for a prompt. The palettes, the vertex
// layouts and the seeding all live in lib/card-art.ts now (VENDORED from the
// web app), because the web landing draws the same bands under the same cards —
// as a stack of CSS radial gradients rather than a native mesh, but from the
// same nine colours, so a card looks like itself on both surfaces. The prose
// about why the seed is an identity and never a list position is over there.
//
// A recap's chat id and a suggestion's card id are both fed to the same
// `meshSeed`.

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

// The artwork some suggestion cards wear in place of the mesh band: a short
// silent loop, filling the picture slot (see lib/card-art.ts for what lives
// where and why it's served rather than bundled).
//
// It is DECORATION, so it behaves like decoration: no controls, no sound, no
// fullscreen, no PiP, and `pointerEvents="none"` so a tap on the picture is a
// tap on the card — the whole card is one button and the video must not eat the
// press. The mesh stays mounted UNDERNEATH rather than being swapped out, so the

// A landing card. No liquid glass — over a near-white page it has nothing to
// refract and just muddies the card. Instead it's the app's standard card
// surface (`border border-border bg-card`, same as <Card> and the episode /
// shot / library rows) lifted off the page by a soft drop shadow, pressed
// through the shared <BouncyPressable> so these tap like every other card.
// A mesh-gradient band caps the top where a thumbnail would sit; `'none'` leaves
// the card plain white, which is what the recaps wear — at a spine's width the
// colour was decoration competing with the titles, and a row of white cards reads
// as one list.
// PressCard's frame when something above owns the press: same box, same shadow,
// no gesture of its own. Takes (and ignores) BouncyPressable's props so the two
// are interchangeable at the call site.
function CardFrame({
  children,
  style,
}: {
  children?: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  dimWhenDisabled?: boolean;
  accessibilityLabel?: string;
  style?: ViewStyle;
}) {
  return <View style={style}>{children}</View>;
}

function PressCard({
  children,
  onPress,
  label,
  seed,
  style,
  bodyStyle,
  bandHeight = CARD_BAND,
  bandSide = 'top',
  art,
  done = false,
  ownPress = true,
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
  /** A looping video to fill the top band with, over the mesh — see cardArt. */
  art?: string;
  /** Finished work: the card is scrimmed, badged, and doesn't tap. */
  done?: boolean;
  /**
   * Whether the card presses itself. Off for the suggestion deck, where a
   * <Link.AppleZoom> above owns the press: the bouncy press-shrink and the zoom
   * would be animating the same frame in opposite directions, and the zoom IS
   * the feedback (the Discover posters drop the bounce for the same reason).
   */
  ownPress?: boolean;
}) {
  const palette = meshPalette(seed);
  const points = meshShape(seed);
  // As a spine the band takes the cross axis from the row: width is its own,
  // height stretches to the card's.
  const band: ViewStyle = bandSide === 'left' ? { width: bandHeight } : { height: bandHeight };
  const Frame = ownPress ? BouncyPressable : CardFrame;
  return (
    <Frame
      accessibilityLabel={done ? `${label} — completed` : label}
      onPress={onPress}
      // BouncyPressable short-circuits its own onPress and drops the press
      // scale, so a finished card is inert rather than merely ignored — no
      // bounce, no haptic, nothing that reads as "that did something".
      disabled={done}
      // The scrim below IS the disabled affordance, so the default half-opacity
      // fade would only wash the artwork out behind it.
      dimWhenDisabled={false}
      style={animatedSafe.cardShadow}
    >
      <View style={[styles.card, bandSide === 'left' && styles.cardRow, style]}>
        {/* No band at all on a plain card. Otherwise: a mesh on the wide top
            bands, and a FLAT fill for a spine — at 10pt wide a gradient reads as
            colour noise, not art, though the seed still picks the hue.
            A card WITH artwork keeps its mesh and wears the loop on top: the
            gradient is what the slot shows before the first video frame lands,
            and what it falls back to if the file never does. */}
        {bandSide === 'none' ? null : (
          <View style={band}>
            {MeshGradientView && bandSide !== 'left' ? (
              <MeshGradientView
                style={StyleSheet.absoluteFill as ViewStyle}
                columns={3}
                rows={3}
                colors={palette as string[]}
                points={points as number[][]}
              />
            ) : (
              // The spine. INSET rather than bleeding to the card's edges: a bar
              // that runs corner to corner fights the 22pt radius (the overflow
              // clip shaves it into a crescent at both ends), while one held off
              // the edges with its own rounded caps reads as a deliberate mark —
              // and the inset is the body's padding, so the bar's top aligns with
              // the first line of text beside it.
              <View style={[styles.spine, { backgroundColor: palette[4] }]} />
            )}
            {art && bandSide === 'top' ? <CardArtVideo uri={art} height={bandHeight} /> : null}
          </View>
        )}
        <View style={[styles.cardBody, bodyStyle]}>{children}</View>
        {/* FINISHED. Over the whole card, artwork and text alike, so the card
            reads as one settled object rather than a live picture with a dead
            caption. It keeps its picture at full strength underneath — that's
            what makes it recognisable as the thing you did, and a grey
            rectangle with a badge on it would not be.
            `pointerEvents="none"` because the press is already dead at the
            Pressable; the scrim must not be the reason, or a future refactor
            that moves it would silently make the card tappable again. */}
        {done ? (
          <View style={styles.doneScrim} pointerEvents="none">
            <View style={styles.doneBadge}>
              <Check size={12} color="#fff" strokeWidth={3} />
              <Text style={styles.doneBadgeText}>Completed</Text>
            </View>
          </View>
        ) : null}
      </View>
    </Frame>
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
  contentOffset,
  children,
}: {
  title: string;
  /** Card width for this row — snap offsets are that plus the row's gap apart. */
  cardWidth: number;
  /**
   * Where the row should be, for the one caller that moves it from outside: the
   * suggestion deck lines up behind the showcase on the way back (see
   * lib/deck-return.ts). A PROP, not a `scrollTo` on a ref — refs in this
   * subtree never attach (the note at the call site has the details), and iOS
   * applies a changed `contentOffset` to the scroll view directly.
   *
   * Snap offsets are `index * (cardWidth + ROW_GAP)`, so an offset built from
   * the same number lands on a rest position rather than between two cards.
   */
  contentOffset?: { x: number; y: number };
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
    <View style={styles.sectionWrap}>
      {/* One headline size for every section, the project name at the top
          included: the page is a stack of peer decks, and a 34pt large title on
          the first one made it read as a page header the rest hung off. */}
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      <ScrollView
        contentOffset={contentOffset}
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

// Each suggestion card, whispering which zoom identity it was handed.
//
// The forward zoom needs nothing of the sort — expo-router threads the identity
// through the href, so the tapped card and the showcase find each other by
// themselves. The RETURN leg does: the showcase may be on a different card by
// then, and re-pointing the transition means naming that card's <Link>. That
// name is a `useId()` inside the link's own context, which nothing above the
// link can see — so the card reports it from the inside.
//
// Renders null and sits BESIDE <Link.AppleZoom> rather than inside it (which
// takes exactly one child, and would warn), so it costs no layout and can't come
// between the zoom source and the poster it measures.
function ZoomSourceBeacon({ cardId }: { cardId: string }) {
  const source = use(ZoomTransitionSourceContext);
  const identifier = source?.identifier;
  useEffect(() => {
    if (!identifier) return;
    return registerZoomSource(cardId, identifier);
  }, [cardId, identifier]);
  return null;
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
  // The unistyles style goes FIRST in the array below and the animated one
  // second. Reversed, Reanimated walks unistyles' own metadata key and rejects
  // it as an empty style value, which takes the whole screen down.
  return (
    <>
      {[0, 1, 2].map((i) => (
        <Animated.View key={i} style={[animatedSafe.cardShadow, style]} pointerEvents="none">
          <View style={[styles.card, styles.suggestionCard, styles.skeletonCard]}>
            <View style={{ height: SUGGESTION_BAND, backgroundColor: MESH_PALETTES[i][4] }} />
            {/* Two bars for the headline, three for the paragraph — the real
                card's proportions, so nothing shifts when the deck lands. */}
            <View style={[styles.cardBody, styles.suggestionBody]}>
              <View style={[styles.skeletonBar, styles.skeletonBarHeadline1]} />
              <View style={[styles.skeletonBar, styles.skeletonBarHeadline2]} />
              <View style={[styles.skeletonBar, styles.skeletonBarBlurb1]} />
              <View style={[styles.skeletonBar, styles.skeletonBarBlurb2]} />
              <View style={[styles.skeletonBar, styles.skeletonBarBlurb3]} />
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
  const colors = useChatColors();
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

  // The suggestion deck — the shared project-scoped query, so it's cached across
  // chat switches and invalidated by the SSE firehose (which is how a card
  // retires seconds after the agent closes its gap).
  const { data: status, isLoading, isError } = useProjectResource<Status>('status');
  // isLoading, not isPending: a query with no project yet is disabled and would
  // report "pending" forever (skeletons that never resolve), and a background
  // refetch must leave the deck we're already showing alone.
  // FULL_DECK, not the built-in caps: the row scrolls sideways for as long as
  // there is work, and the showcase behind it has to be the SAME list (see
  // lib/deck-options.ts) or the zoom lands on a different card than it left.
  const suggestions = useMemo<Suggestion[]>(
    () => (isError || !status ? FALLBACK_SUGGESTIONS : buildSuggestions(status, FULL_DECK)),
    [status, isError],
  );

  // The row lines up behind the showcase while the showcase is still on top of
  // it — the mirror of the showcase opening already scrolled to the tapped card.
  //
  // WHILE it is still on top is the whole point, and the reason this isn't a
  // `useFocusEffect`: a pop is the same UIKit zoom run backwards, and UIKit takes
  // its measurement ONCE as the pop begins. Focus arrives after that, i.e. after
  // the transition has already committed to flying at wherever the row happened
  // to be. Moving now means the rect is right before anyone asks for it, and the
  // author never sees the jump because they are looking at the showcase.
  //
  // Unanimated for the same reason: this is the row taking its position, not an
  // animation anybody is meant to watch.
  //
  // Moved by PROP, not by a `scrollTo` on a ref, and that's not a style choice.
  // A ref here is never set — instrumented on the simulator (iPhone 17 Pro Max,
  // iOS 26.4): <Section> renders, its ref prop arrives, this listener fires with
  // the right index, and the ScrollView's ref callback is never invoked. Nor is
  // a callback ref on the plain <View> around it, so it isn't a ScrollView
  // quirk — nothing in that subtree attaches a ref at all. It belongs with the
  // other New Architecture casualties this app has catalogued (Reanimated's
  // scrollTo, its animated scroll handler, worklet gesture callbacks: all
  // silently never called), and it has the same escape hatch — stop driving the
  // scroll view imperatively and hand it a `contentOffset`, which iOS applies to
  // the scroll view on the spot (RCTScrollViewComponentView diffs the prop and
  // assigns it). The showcase already opens on the right card this way.
  //
  // The nudge is the cost of driving by prop: iOS only applies an offset that
  // CHANGED. Send the author back to a card they've already been to — or let
  // them drag the row by hand in between — and the same number would be a no-op,
  // leaving the row wherever they left it. A hundredth of a point alternating on
  // and off makes every arrival a change; at 3x it is a third of a pixel, and
  // the next drag snaps it away.
  const [rowOffset, setRowOffset] = useState<{ x: number; y: number } | undefined>(undefined);
  useEffect(
    () =>
      onShowcaseMove((cardId) => {
        const index = suggestions.findIndex((s) => s.id === cardId);
        if (index < 0) return;
        const x = index * (SUGGESTION_W + ROW_GAP);
        setRowOffset((prev) => ({ x: prev && prev.x === x ? x + 0.01 : x, y: 0 }));
      }),
    [suggestions],
  );

  // Retire any started card whose gap has closed since we last looked. On FOCUS
  // rather than mount: this tab stays mounted while the author goes off to the
  // Shot list and boards the episode by hand, and coming back is exactly the
  // moment that card should be wearing its badge. Costs one row read when
  // nothing is outstanding, and only writes (and so only invalidates the deck)
  // when something actually flipped — so there's no refetch loop here.
  useFocusEffect(
    useCallback(() => {
      void sweepSuggestions();
    }, []),
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
        .map((ch) => ({ id: ch.id, title: ch.title as string, when: dayLabel(ch.updatedAt) })),
    [conv.list],
  );

  const openRecap = useCallback((id: string) => {
    Haptics.selectionAsync().catch(() => {});
    openChatModal(id);
  }, []);

  // The empty-state card: no draft to park, just the chat itself with the
  // keyboard up — the same hand-off the tab bar's pill makes when it's tapped on
  // its input, and the same blank-chat reuse, so tapping it twice can't leave two
  // untouched "New chat" rows behind.
  const startChat = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const id: string = reusable && conv.activeId ? conv.activeId : conv.newChat();
    openChatModal(id, { focus: true });
  }, [conv, reusable]);

  // A suggestion card no longer SENDS its brief. It opens the Story showcase —
  // the same deck at one card per screen (chat/showcase.tsx) — and the send
  // moved with it, onto an explicit "Send to chat" button under the big poster.
  // Reporting the card as STARTED moved too, for the same reason: it belongs to
  // the tap that commits, not to the tap that looks.
  //
  // Navigation itself is the <Link> around the card, not this handler: Expo
  // Router threads the zoom through the HREF, so a `router.push` here would
  // push the screen with no zoom at all. All this adds is the haptic.
  const onSuggest = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, []);

  // This screen docks NO composer — the tab bar's agent pill (the accessory) is
  // the way to start typing here, and it can't share the bottom edge with a second
  // bar. Registering null also clears whatever a popped conversation left on this
  // stack's shared composer.
  useChatComposer(null);

  return (
    <View style={styles.screen}>
      {/* Content is TOP-aligned under the headline, not centered.
          A ScrollView rather than a plain View for two reasons:
          contentInsetAdjustmentBehavior="automatic" lays it out under the
          transparent bar and tab bar for the glass scroll-under, and it bounces
          at both ends even when everything fits, so the surface feels alive
          instead of nailed down. minHeight is the measured visible band — enough
          to fill the screen and bounce, without dead space to scroll through. */}
      <Animated.ScrollView
        style={[animatedSafe.list, enter]}
        onLayout={(e) => setViewport(e.nativeEvent.layout.height)}
        contentContainerStyle={[animatedSafe.content, band ? { minHeight: band } : animatedSafe.grow]}
        contentInsetAdjustmentBehavior="automatic"
        alwaysBounceVertical
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {/* No page headline here. The tab bar already says Home, and a large
            title plus a strapline pushed the first real card most of the way off
            the fold — so the screen opens on the decks themselves and the
            section headlines carry it (this is the same call 553e4d4 made). */}

        {/* The upgrade pitch, above the project's own sections — the app
            talking about itself, so it's the one card that brings its own
            colour instead of taking the theme's. */}
        <ProBanner />

        {/* ALWAYS rendered, empty or not — with nothing to recap the row carries
            a single Start chat card instead, because an empty deck that hides
            itself takes the one thing to do here off the screen with it. */}
        <Section title="Past chats" cardWidth={RECAP_W}>
          {recaps.length ? (
            recaps.map((r) => (
              <PressCard
                key={r.id}
                label={`${r.title} — ${r.when}`}
                seed={meshSeed(r.id)}
                style={styles.recapCard}
                bodyStyle={styles.recapBody}
                bandSide="left"
                onPress={() => openRecap(r.id)}
              >
                {/* Title first and time LAST, hung on the bottom-right corner:
                    the title is what you're scanning for and the stamp is what
                    you check once you've found it, so the reading order is the
                    card's layout. Small text on purpose — a recap is a row you
                    recognize, not a poster you read; the big headline type stays
                    on the suggestion cards. */}
                <Text style={styles.recapTitle} numberOfLines={3}>
                  {r.title}
                </Text>
                <Text style={styles.recapWhen}>
                  {r.when}
                </Text>
              </PressCard>
            ))
          ) : (
            // The empty state is a CARD, not a line of grey text, so the row keeps
            // its shape and the one thing to do here is the thing you tap. It opens
            // the same chat the pill would (reusing a still-blank active chat) with
            // the keyboard up, since an empty deck means there's nothing to read
            // and everything to type.
            <PressCard
              label="Start chat"
              seed={meshSeed('start-chat')}
              style={styles.recapCard}
              bandSide="none"
              onPress={startChat}
            >
              <SquarePen size={18} color={colors.mutedForeground} />
              <Text style={[styles.recapTitle, styles.startChatTitle]} numberOfLines={2}>
                Start chat
              </Text>
            </PressCard>
          )}
        </Section>

        <Section
          title="Continue building your story"
          cardWidth={SUGGESTION_W}
          contentOffset={rowOffset}
        >
          {isLoading ? (
            <SuggestionSkeletons />
          ) : (
            suggestions.map((s) => (
              // The card ZOOMS into the showcase, and three things make that
              // work (the Discover row documents the same three):
              //   - `asChild` is required, not stylistic — the zoom rides the
              //     href, and `Link.AppleZoom` throws without it.
              //   - `Link.AppleZoom` takes exactly ONE child.
              //   - iOS 18+; elsewhere it's a passthrough and this just pushes.
              // `from` is the card, so the list opens already on it.
              <Link
                key={s.id}
                href={{ pathname: '/(tabs)/chat/showcase', params: { from: s.id } }}
                asChild
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    s.done ? `${s.title} — completed` : `${s.title} — ${s.subtitle ?? ''}`
                  }
                  // A finished card doesn't travel. Slot composes the Link's
                  // press onto this one, so disabling here disables the
                  // navigation too — and the showcase would have nothing to
                  // offer it but a disabled button.
                  disabled={s.done}
                  // Slot composes handlers, so this runs alongside the Link's
                  // own navigation press rather than replacing it.
                  onPress={onSuggest}
                >
                  <Link.AppleZoom>
                  <PressCard
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
                    // The picture slot's real artwork where the card has one; the
                    // rest keep the mesh the band was always painted with.
                    art={cardArt(s.id)}
                    done={s.done}
                    // The <Link> above owns the press — see its note.
                    ownPress={false}
                    onPress={onSuggest}
                  >
                    {/* Poster order: the headline reads FIRST, hanging off the mesh
                        band, and the paragraph explains it underneath. (A recap is
                        the other way round — its timestamp is an eyebrow.) */}
                    <Text style={styles.cardTitle} numberOfLines={3}>
                      {s.title}
                    </Text>
                    <Text style={styles.cardBlurb} numberOfLines={5}>
                      {s.blurb}
                    </Text>
                  </PressCard>
                  </Link.AppleZoom>
                  {/* Reports this card's zoom identity so the way back can be
                      aimed at it. Renders null — see ZoomSourceBeacon. */}
                  <ZoomSourceBeacon cardId={s.id} />
                </Pressable>
              </Link>
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

// Styles handed to a REANIMATED component, kept as plain objects on purpose.
//
// A unistyles style carries a metadata key that its Babel plugin normally
// strips when it rewrites the host component — but `Animated.View` and
// `Animated.ScrollView` are built at runtime by `createAnimatedComponent`, so
// the plugin never sees them and the key survives into Reanimated's prop
// validator, which rejects it ("an empty object is not a valid style value")
// and takes the whole screen down. None of these need theming, so a plain
// object is the honest fix rather than a workaround.
const animatedSafe = {
  list: { flex: 1 },
  content: { paddingTop: 8, paddingBottom: 24, gap: 20 },
  // Only until the viewport is measured (one frame) — then a minHeight takes over.
  grow: { flexGrow: 1 },
  // The shadow lives on its own wrapper because the card body clips (overflow
  // hidden) to hold its corner radius, and a clipping view drops its own shadow.
  cardShadow: {
    borderRadius: 22,
    shadowColor: '#000',
    shadowOpacity: 0.13,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    paddingBottom: 15,
  },
} as const;

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  // gap-0.5, not the gap-3 the Discover section uses: the card row carries
  // 10pt of its own top padding (shadow-bleed room — see styles.row), so 2pt
  // here lands the headline the same 12pt from the cards as Discover's.
  sectionWrap: { gap: 2 },
  // Every section headline on the screen — kept in lockstep with headline in
  // components/chat/discover.tsx so the four decks read as one list.
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 25,
    paddingHorizontal: 20,
    color: theme.colors.foreground,
  },
  // A section's card row: the page margin lives here so a card can bleed off
  // the edge and invite the sideways swipe. The vertical padding is room for the
  // drop shadow and for the press grow to bleed into — without it the row clips
  // both, squaring off the corners against its own edge.
  row: { paddingHorizontal: ROW_PAD, paddingVertical: 10, gap: ROW_GAP },
  // The card body: the app's standard surface (border + bg-card come from the
  // stylesheet) with the landing screen's rounder corners and roomier padding.
  card: {
    borderRadius: 22,
    // Clips the mesh header into the card's rounded top corners. Safe here: the
    // drop shadow lives on the wrapper above, so nothing of ours gets cut.
    overflow: 'hidden',
  },
  // The skeleton's own surface — the real card's border + bg-card, since the
  // skeleton doesn't route through <PressCard>.
  skeletonCard: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  // A left-spine card lays out as a row: mesh first, text beside it.
  cardRow: { flexDirection: 'row' },
  // The spine itself: a 4pt bar with rounded caps, held off the card's top and
  // bottom by the body's own padding so it starts and ends level with the text.
  // `left: 14` insets it a body-padding's worth from the card's edge (past the
  // 10pt band column it's anchored in) — the colour is the card's seeded one,
  // applied at the call site.
  spine: { position: 'absolute', top: 14, bottom: 14, left: 14, width: 4, borderRadius: 2 },
  // Text sits on the plain surface below the band, pinned to the bottom so
  // one-liners and four-liners both hang off the same edge.
  cardBody: { flex: 1, justifyContent: 'flex-end', padding: 14 },
  // The spine costs no height, so the budget is all text: padding (14×2) + THREE
  // recapTitle lines (3×20) + the timestamp (16) = 108. Three is also what the
  // stored title is capped to fill — see deriveTitle in lib/agent/chat-store.ts;
  // grow one and the other has to follow, or the card shows blank space.
  recapCard: { width: RECAP_W, height: 108 },
  // Title at the top, stamp at the bottom, the slack between them — so a
  // one-line title and a three-line one both hang their stamp off the same
  // corner. Left padding puts the text 12pt clear of the spine's right edge
  // (spine ends at 18 from the card's edge, the 10pt band column is already
  // spent, so 20 lands the text at 30).
  recapBody: { justifyContent: 'space-between', paddingLeft: 20 },
  // Bottom RIGHT, per the card's reading order. `alignSelf` rather than
  // textAlign: the box shrinks to the stamp, so nothing invisible sits over the
  // title's last line.
  recapWhen: {
    alignSelf: 'flex-end',
    fontSize: 12,
    lineHeight: 16,
    color: theme.colors.mutedForeground,
  },
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
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 21,
    letterSpacing: -0.2,
    color: theme.colors.foreground,
  },
  // The recap's small title — body-sized, semibold so it still reads as the
  // card's name over the muted timestamp above it.
  recapTitle: { fontSize: 15, fontWeight: '600', lineHeight: 20, color: theme.colors.foreground },
  // The empty-state card's title sits a touch below its icon, unlike the recap
  // row's title (which hangs at the bottom with nothing above it).
  startChatTitle: { marginTop: 4 },
  // The finished-card treatment. A flat black wash at 55% rather than a
  // gradient: the scrim covers artwork AND text, and a ramp would leave one end
  // of the card legible and the other not — which reads as a rendering bug, not
  // as "this is done". 55% is where the picture stays recognisable while the
  // headline under it clearly stops competing with the live cards beside it.
  // Absolutely positioned over the whole card, INSIDE the clipping view, so it
  // takes the 22pt corner radius for free.
  doneScrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Centered, not tucked in a corner: it's the card's entire message now, and
  // the copy underneath is a record rather than something to read.
  doneBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    // Its own colours, not the theme's: it sits on a black wash in both light
    // and dark mode, so a token that flips with the theme would vanish in one
    // of them.
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.34)',
  },
  doneBadgeText: { color: '#fff', fontSize: 13, fontWeight: '600', letterSpacing: 0.2 },
  // The paragraph under it. The leading on both texts is a budget, not taste: a
  // three-line headline (63) plus its gap (8) plus five blurb lines (90) plus the
  // body's padding (26) is 187, which is exactly what SUGGESTION_BODY reserves.
  // Grow either text and raise SUGGESTION_BODY with it, or the last line clips.
  cardBlurb: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 18,
    color: theme.colors.mutedForeground,
  },
  // The skeleton's placeholder bars — the real headline/paragraph shape in flat
  // muted rectangles, so nothing shifts when the deck lands (see
  // SuggestionSkeletons).
  skeletonBar: { borderRadius: 4, backgroundColor: theme.colors.muted },
  skeletonBarHeadline1: { height: 20, width: 176 },
  skeletonBarHeadline2: { marginTop: 4, height: 20, width: 112 },
  skeletonBarBlurb1: { marginTop: 16, height: 14, width: 192 },
  skeletonBarBlurb2: { marginTop: 8, height: 14, width: 176 },
  skeletonBarBlurb3: { marginTop: 8, height: 14, width: 96 },
}));
