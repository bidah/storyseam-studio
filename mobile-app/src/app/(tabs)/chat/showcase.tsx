import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewStyle,
} from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Link, router, useLocalSearchParams, useNavigation } from 'expo-router';
import { Check, Send } from 'lucide-react-native';
import { SEMI_PILL, SemiPillButton } from '@/components/ui/semi-pill-button';
import { useColors } from '@/lib/colors';
import { meshPalette, meshSeed, meshShape } from '@/lib/card-art';
import { cardArt } from '@/lib/card-art-url';
import { CardArtVideo } from '@/components/chat/card-art-video';
import { useConversations, useIsFreshChat } from '@/lib/agent/provider';
import { openChatModal } from '@/lib/agent/chat-route';
import { setPendingDraft } from '@/lib/agent/pending-draft';
import { useProjectResource } from '@/lib/queries';
import { startSuggestion } from '@/lib/suggestion-progress';
import { FULL_DECK } from '@/lib/deck-options';
import { showcaseMovedTo, zoomSourceId } from '@/lib/deck-return';
// Internal, and knowingly so: this is the route param expo-router hands the
// native transition to name its source view, and re-pointing it is what makes
// the way back fly into the card the deck is actually on. See the return-leg
// note below and lib/deck-return.ts.
import { INTERNAL_EXPO_ROUTER_ZOOM_TRANSITION_SOURCE_ID_PARAM_NAME as ZOOM_SOURCE_PARAM } from 'expo-router/build/navigationParams';
import {
  buildSuggestions,
  FALLBACK_SUGGESTIONS,
  type Status,
  type Suggestion,
} from '@/lib/suggestions';

// The Story showcase — "Continue building your story", one card at a time.
//
// The landing deck (app/(tabs)/chat/index.tsx) is a SWIPE: six posters at 305pt
// scrolling sideways, sized so the next one bleeds off the edge and invites the
// flick. It's a menu — good for scanning, bad for reading, and the artwork is
// postage-stamp sized. This screen is the other half of that trade: the same
// cards, one per screenful, big enough that the loop is actually a picture and
// the brief is actually a paragraph.
//
// Reached by TAPPING a card over there, and it flies out of the one you tapped —
// Expo Router's own zoom (`Link.AppleZoom` on the card, `Link.AppleZoomTarget`
// on the poster below, iOS 18+), the same transition the Discover row already
// uses. So the two surfaces are one object at two magnifications rather than
// two lists that happen to agree — which is also why the list opens ALREADY on
// the card you came from: landing anywhere else would make the zoom a lie.
//
// "Opens already on it" has to mean BEFORE THE FIRST PAINT, not a frame later,
// and that distinction is load-bearing — see the contentOffset note below.
//
// The zoom is threaded through the HREF, so this screen is an ordinary pushed
// screen: the native back chevron and the swipe-back run it in reverse, and
// there is no close button to get in the picture's way.
//
// "In reverse" is where the deck stops being one-way. The author arrived on the
// card they tapped and then flicked through four more, so leaving is a zoom
// between two cards NEITHER of which is the one the transition was set up with:
// the row behind has to snap to where the deck ended up, and the transition has
// to be re-aimed at that card's poster. Both happen the moment the deck comes to
// rest, while this screen is still covering the row — see onSettle below and
// lib/deck-return.ts.
//
// The card is still the button it was on the landing screen: tapping one here
// sends its brief, exactly as tapping it there used to. This screen inserted
// itself in front of that action, so it has to end in the same place.

const { height: SCREEN_H } = Dimensions.get('window');

// The compact iOS bar under the status bar — the same 44pt the landing screen
// subtracts. The header here is transparent and the list runs UNDER it, so the
// frame the scroll view reports is taller than the band you can actually read
// in; the chrome comes off by hand.
const HEADER_BAR = 44;

// Card geometry. ITEM_H is the whole snap unit — the card and the air under it
// — because the snap interval, the top pad and the interpolation input range
// are all derived from it, and a card that snapped on a different number than
// it was laid out with would drift a few points further off-centre with every
// swipe.
// The air BETWEEN two cards is not just this — it's this plus the card box's
// own margins (see CARD_BOX), so the three numbers were halved together. Halving
// the gap alone would only have taken a quarter off the visible distance.
const GAP = 8;
// How much shorter than the visible band a card is. Five points: the card is
// meant to FILL the screenful it snapped to, and this is just enough slack that
// its bottom edge reads as an edge rather than as something cut off by the
// chrome below it.
const BAND_SLACK = 5;
// The CTA sits INSIDE the card, at the bottom of the copy — so the card is one
// object with one edge, and there is no floating button between two posters for
// the eye to assign to the wrong one. The card therefore owns the whole snap
// unit.
const CTA_H = SEMI_PILL.height;
const CTA_GAP = 14;
// How much of the card the picture gets. Two named fractions rather than a
// free number, because these are the only two that hold up: `half` reads as a
// poster with a caption under it, `third` as a page with a picture at the foot.
// Anything between them looks like neither, and a raw 0.58 in a prop invites the
// endless nudging that produced it.
type ArtShare = 'half' | 'third';
const ART_FRACTION: Record<ArtShare, number> = { half: 1 / 2, third: 1 / 3 };
// Which one this deck uses, next to the layout switch it usually moves with.
// They're independent props: `art-bottom` on `half` is the pairing in use — the
// picture reads as half the card with the copy above it — and switching this to
// `third` gives the three paragraphs more room without touching the layout.
const CARD_ART_SHARE: ArtShare = 'half';

// Which way up a card is built.
//
//   art-top    — picture, then headline, then paragraph, then the CTA on the
//                card's bottom edge. The order the landing poster uses.
//   art-bottom — the copy on top and the picture under it, with the CTA drawn
//                OVER the picture in translucent glass so the loop keeps
//                playing through the button.
//
// Both are live designs, not a migration: the deck reads as a page of text with
// a picture in one and as a poster with a caption in the other, and which is
// right is a taste call. One constant switches the whole list, and the geometry
// follows it — see metricsFor.
type CardLayout = 'art-top' | 'art-bottom';
const CARD_LAYOUT: CardLayout = 'art-bottom';

// The neighbour fade, as one switch. It reads as a card being disabled rather
// than merely off-centre, so it's off — but it's a taste call that has been made
// both ways on this screen, so it stays reachable instead of deleted: flip this
// and the whole list gets it back. INACTIVE_OPACITY is where it was tuned to
// when it was last on — the shallowest dip that still said "not this one".
const FADE_NEIGHBOURS = false;
const INACTIVE_OPACITY = 0.8;

type Metrics = {
  /** The snap unit: the card plus the gap under it. */
  fullH: number;
  /** The card, which is the whole snap unit minus that gap. */
  cardH: number;
  /** The picture band — at the top of the card, or at the foot of it. */
  artH: number;
  /** The chrome above and below the readable band, as content padding. */
  padTop: number;
  padBottom: number;
};

// The deck's geometry for a measured scroll view. One card per screenful, five
// points shy of the band between the header and the tab bar — everything else
// (the snap interval, the pad that puts a snapped card in that band, the art
// height) falls out of it, which is what keeps them agreeing.
function metricsFor(viewport: number, top: number, bottom: number, artShare: ArtShare): Metrics {
  const padTop = top + HEADER_BAR;
  // Inside a tab, the bottom inset already includes the tab bar and the agent
  // pill riding on it, so this is the whole lower chrome.
  const padBottom = bottom;
  const band = Math.max(320, viewport - padTop - padBottom);
  const cardH = band - BAND_SLACK;
  return {
    fullH: cardH + GAP,
    cardH,
    // The share reaches this far, and the layout doesn't: which way up the card
    // is built changes the ORDER of the two bands, not their heights.
    artH: Math.round(cardH * ART_FRACTION[artShare]),
    padTop,
    padBottom,
  };
}

// The zoom's rect on this side — the SLOT a snapped card fills, not a card.
//
// `Link.AppleZoomTarget` is the other half of the `Link.AppleZoom` the landing
// card wears: it tells UIKit which part of this screen the small poster should
// fly into (and, on the way back, fly out of), so the picture lands in place
// instead of the whole screen expanding. Expo Router threads the pairing through
// the href, so nothing here needs an id.
//
// It used to ride the arrival card, which was right for the push and wrong for
// everything after it: scroll two cards down and the rect the pop flies out of
// is a card that's now off the top of the screen. The slot is the fix, because
// the deck is one card per screenful — a snapped card ALWAYS occupies exactly
// this rect, so a target pinned to it is correct for every card without ever
// moving between rows. (Moving it between rows is also a trap: the native side
// registers alignment views first-come and drops them on unmount, so a swap
// whose mount runs before the old row's unmount silently leaves no target at all.)
//
// Laid out from the same numbers as the rows themselves — the list's top pad,
// one card's height, the card's own margins — so it tracks a corrected viewport
// instead of drifting from it. `display: contents` on the detector means it adds
// no box of its own.
function ZoomSlot({ metrics }: { metrics: Metrics }) {
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { paddingTop: metrics.padTop, paddingHorizontal: 20 }]}
    >
      <View style={{ height: metrics.cardH }}>
        <Link.AppleZoomTarget>
          <View style={styles.zoomSlot} />
        </Link.AppleZoomTarget>
      </View>
    </View>
  );
}

// One card, scaled and faded by how far it is from the middle of the screen.
//
// `progress` is the list's scroll offset expressed in CARDS, not points — the
// scroll handler divides by ITEM_FULL_H — so a card's own index IS its centred
// position and the input range is the same three numbers for every row. Doing
// the division here instead would make each card interpolate over a range of
// hundreds of points, which reads identically and is harder to reason about.

function ShowcaseCard({
  item,
  index,
  progress,
  onPress,
  metrics,
  fadeInactive = false,
  layout = 'art-top',
}: {
  item: Suggestion;
  index: number;
  progress: SharedValue<number>;
  onPress: (s: Suggestion) => void;
  /** Heights derived from the measured list — see metricsFor. */
  metrics: Metrics;
  /**
   * Which way up the card is built — see {@link CardLayout}. Orthogonal to how
   * TALL the picture is, which is {@link ArtShare}, baked into `metrics.artH`
   * before it gets here.
   */
  layout?: CardLayout;
  /**
   * Dim the cards either side of the snapped one to {@link INACTIVE_OPACITY}.
   * Off by default — see the note in the animated style for why, and flip
   * {@link FADE_NEIGHBOURS} at the call site to get it back.
   */
  fadeInactive?: boolean;
}) {
  const seed = meshSeed(item.id);
  const palette = meshPalette(seed);
  const points = meshShape(seed);
  const art = cardArt(item.id);
  const colors = useColors();

  const stylez = useAnimatedStyle(() => ({
    // Opt-in, and currently off: scale alone marks which card you're on. The
    // cards above and below are already softened by the card border and by the
    // list's own edges, and dimming on top of that read as disabled — like the
    // Completed scrim, which means something else entirely here. This is a list
    // you scan as much as read, so the artwork off-centre stays a picture at
    // full strength. The key is always present rather than conditionally
    // spread, so the style object keeps one shape across re-renders.
    opacity: fadeInactive
      ? interpolate(
          progress.value,
          [index - 1, index, index + 1],
          [INACTIVE_OPACITY, 1, INACTIVE_OPACITY],
          'clamp',
        )
      : 1,
    transform: [
      {
        scale: interpolate(progress.value, [index - 1, index, index + 1], [0.92, 1, 0.92], 'clamp'),
      },
    ],
  }));

  const artBottom = layout === 'art-bottom';

  // The copy, as paragraphs. `art-top` shows the one `blurb` every surface
  // shows; `art-bottom` was built for more text, so it reads `blurb` + the two
  // paragraphs of `detail` as a three-paragraph brief — how the work proceeds,
  // and what you have at the end. A completed card is a stored snapshot with no
  // `detail` (see CompletedSuggestion), so this degrades to the blurb alone.
  const paragraphs =
    artBottom && item.detail ? [item.blurb, ...item.detail.split('\n\n')] : [item.blurb];

  // The action, spelled out. On the landing screen the card WAS the button — a
  // tap sent the brief — but that tap now opens this screen instead, so the send
  // has to become a thing you can see and choose.
  //
  // The surface follows the layout, because the surface is a claim about what's
  // behind it. `art-top` puts the slab on the card's opaque body, where liquid
  // glass has nothing to refract, so it's `bounce`: a flat foreground fill with
  // the same shrink-and-spring the card itself has. `art-bottom` puts it on the
  // loop, where an opaque slab would punch a hole in the picture — so it's
  // `clear`, and the video runs on underneath it.
  const cta = (
    <SemiPillButton
      title={item.done ? 'Completed' : 'Send to chat'}
      onPress={() => onPress(item)}
      disabled={item.done}
      variant={artBottom ? 'clear' : 'bounce'}
      accessibilityLabel={item.done ? `${item.title} — completed` : `Send "${item.title}" to chat`}
    >
      {/* Follows the label, which is the point: on `bounce` the slab is filled
          with the page's FOREGROUND — near-black on light, white on dark — so
          everything on it takes the page background, and a hardcoded white icon
          would read as correct in light mode and vanish in dark. On `clear`
          there is no fill to invert against, only the artwork, so it's white in
          both themes. */}
      {item.done ? null : <Send size={17} color={artBottom ? '#fff' : colors.pageBg} />}
    </SemiPillButton>
  );

  // The picture, and — in `art-bottom` — the button standing on it. The CTA is
  // last in the band so it draws over the video rather than under it, and it's
  // inset by the same 20pt the copy is, so button and paragraph share one
  // left edge down the whole card.
  const artBand = (
    <View style={{ height: metrics.artH }}>
      <MeshBand palette={palette} points={points} />
      {art ? <CardArtVideo uri={art} height={metrics.artH} /> : null}
      {artBottom ? <View style={styles.ctaOverArt}>{cta}</View> : null}
    </View>
  );

  return (
    <Animated.View style={[{ height: metrics.cardH }, stylez]}>
      {/* No zoom target on the card itself: the rect the transition uses is the
          SLOT a snapped card fills, drawn once over the list — see <ZoomSlot>.
          The box below still has to match it exactly, so both take their margins
          from the same style. */}
      <View style={styles.boundary}>
        <View style={styles.card}>
          {artBottom ? null : artBand}
          <View style={[styles.body, artBottom && styles.bodyTopmost]}>
            <Text style={styles.title} numberOfLines={2}>
              {item.title}
            </Text>
            {/* Dropped in `art-bottom`: the subtitle IS the blurb's first
                clause in shorter form (see the Suggestion type), and printing
                both directly above three paragraphs reads as a stutter. It
                earns its line on the surfaces that only have room for it. */}
            {item.subtitle && !artBottom ? (
              <Text style={styles.subtitle} numberOfLines={1}>
                {item.subtitle}
              </Text>
            ) : null}
            {paragraphs.map((p, i) => (
              <Text
                key={i}
                style={[styles.blurb, artBottom && styles.blurbTight]}
                numberOfLines={4}
              >
                {p}
              </Text>
            ))}

            {/* `marginTop: auto` pins the button to the card's bottom edge
                whatever the paragraph does, so every card in the deck puts its
                button on the same line. In `art-bottom` that edge belongs to the
                picture instead, and the button went with it. */}
            {artBottom ? null : <View style={styles.ctaSlot}>{cta}</View>}
          </View>
          {artBottom ? artBand : null}
          {/* Same treatment the small card wears, for the same reason: a
              finished card stays recognisable as the thing you did. */}
          {item.done ? (
            <View style={styles.doneScrim} pointerEvents="none">
              <View style={styles.doneBadge}>
                <Check size={12} color="#fff" strokeWidth={3} />
                <Text style={styles.doneBadgeText}>Completed</Text>
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </Animated.View>
  );
}

// expo-mesh-gradient is a NATIVE module and `requireNativeView` resolves at
// import, so a binary built before it was added has nothing to render — and an
// OTA alone can't add one. Required defensively (the same dance the landing
// screen does) so those builds fall back to a flat band instead of taking the
// whole screen down with them.
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

function MeshBand({
  palette,
  points,
}: {
  palette: readonly string[];
  points: readonly (readonly number[])[];
}) {
  if (!MeshGradientView) {
    return <View style={[StyleSheet.absoluteFill, { backgroundColor: palette[4] }]} />;
  }
  return (
    <MeshGradientView
      style={StyleSheet.absoluteFill as ViewStyle}
      columns={3}
      rows={3}
      colors={palette as string[]}
      points={points as unknown as number[][]}
    />
  );
}

export default function StoryShowcaseScreen() {
  const conv = useConversations();
  const reusable = useIsFreshChat();
  // `from` is the card that was tapped — it decides where the list opens, so
  // the zoom lands on the card it flew out of.
  const params = useLocalSearchParams<{ from?: string }>();
  const from = params.from;
  // Which poster the transition is currently aimed at. It starts as the tapped
  // card's and is rewritten as the deck moves (see onSettle). The zoom target
  // is KEYED on it: the native detector registers under this identifier and
  // refuses to change it in place, so it has to be a fresh view each time.
  const zoomSource = (params as Record<string, string | undefined>)[ZOOM_SOURCE_PARAM];

  // The card is sized off the LIST, not off the window: the header is
  // transparent and the tab bar overlays the bottom, so the screenful a card has
  // to fit into is the frame minus that chrome. Seeded with the window height
  // (which is what the frame measures to here) rather than 0, so the list — and
  // with it the zoom's landing rect — exists on the very first frame instead of
  // one layout pass after the transition has already started.
  const insets = useSafeAreaInsets();
  const [viewport, setViewport] = useState(SCREEN_H);
  const metrics = useMemo(
    () => metricsFor(viewport, insets.top, insets.bottom, CARD_ART_SHARE),
    [viewport, insets.top, insets.bottom],
  );

  // The same query the landing deck reads, so this is the SAME deck rather than
  // a second fetch that could disagree with the row behind it. Cached and
  // SSE-invalidated already, so opening this screen costs no request.
  const { data: status, isError } = useProjectResource<Status>('status');
  const suggestions = useMemo<Suggestion[]>(
    () => (isError || !status ? FALLBACK_SUGGESTIONS : buildSuggestions(status, FULL_DECK)),
    [status, isError],
  );

  const initialIndex = useMemo(() => {
    const i = suggestions.findIndex((s) => s.id === from);
    return i < 0 ? 0 : i;
  }, [suggestions, from]);

  // Scroll position in CARDS. Seeded to the opening index so the first card is
  // full-size on the very first frame — starting at 0 would paint it at 0.92
  // and pop it to 1 once the initial scroll settled, right as the zoom lands.
  const progress = useSharedValue(initialIndex);

  // A PLAIN JS onScroll, deliberately not `useAnimatedScrollHandler`. On this
  // stack (Expo 57 / RN 0.86 / New Arch / React Compiler) Reanimated's native
  // event pipeline is dead — the animated handler is simply never called, so
  // the cards would sit at their initial scale forever. JS→UI shared-value
  // writes DO work, and at scrollEventThrottle 16 this tracks at 60fps.
  // Same substitution the editor timeline and the chat transcript list make.
  //
  // Not wrapped in useCallback: the compiler lint forbids MUTATING a value that
  // was handed to a hook, which a shared value in a dependency array is. A
  // plain function sidesteps that, and `onScroll` changing identity costs
  // nothing — it's a prop on the list, not a memo key for the rows.
  //
  // THE RETURN LEG rides on it too, for the same reason it can't ride on
  // `onMomentumScrollEnd`: this is the ONE scroll signal this stack is known to
  // deliver, and the whole point is to be ready before the author taps back
  // rather than a beat after.
  //
  // Two things follow the deck, and they follow it TOGETHER, on the frame the
  // current card changes:
  //
  //   1. The landing row lines up on the same card (lib/deck-return.ts, and the
  //      contentOffset in chat/index.tsx).
  //   2. The transition is re-pointed at that card's poster. The source view is
  //      whichever <Link> was tapped, an identity minted at push time and four
  //      swipes later the wrong one; rewriting the router's own source-id param
  //      swaps it, because the native side looks the identifier up when the
  //      transition RUNS rather than when it was set up. (Verified: aim at a
  //      deliberately bogus id and the pop reports that id, not the pushed one.)
  //
  // Together is the load-bearing word, and it cost a debounce to learn. Waiting
  // for the deck to stop before re-aiming — on the theory that a navigation
  // dispatch per card flown past is wasteful — puts the two out of step for as
  // long as the wait, and the author's thumb is faster than that: flick, tap
  // back, and the row has already moved while the transition is still aimed at
  // the card it was aimed at before. It reads as the zoom sticking to a card
  // nobody is looking at. A few extra param writes during a flick is the cheaper
  // mistake.
  const shown = useRef(initialIndex);
  const navigation = useNavigation();

  const aimZoomAt = useCallback(
    (card: Suggestion | undefined) => {
      // Not if we're already on the way out: `setParams` writes to whatever
      // route is focused, and after the pop that isn't this one.
      if (!card || !navigation.isFocused()) return;
      const source = zoomSourceId(card.id);
      // No identity means the row never rendered a poster for this card, so
      // there is nothing to aim at. The row still lines up — a transition
      // pointed at the card the author left from is the status quo, not a
      // regression.
      if (!source || source === zoomSource) return;
      router.setParams({ [ZOOM_SOURCE_PARAM]: source });
    },
    [navigation, zoomSource],
  );

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    progress.value = y / metrics.fullH;

    const index = Math.round(y / metrics.fullH);
    if (index === shown.current) return;
    shown.current = index;
    const card = suggestions[index];
    if (!card) return;
    showcaseMovedTo(card.id);
    aimZoomAt(card);
  };

  // Tapping a card here does what tapping it on the landing screen did before
  // this screen existed: record that it was started (carrying the copy it is
  // wearing right now — see worker/src/routes/suggestions.js), park the brief,
  // and open the conversation on it.
  //
  // `dismissTo` first so this screen is GONE behind the chat modal rather than
  // waiting underneath it — coming back from the conversation should land on
  // Home, not on a showcase the author has already spent.
  const onPick = useCallback(
    (s: Suggestion) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      void startSuggestion(s);
      const id: string = reusable && conv.activeId ? conv.activeId : conv.newChat();
      setPendingDraft(id, { text: s.prompt, attachments: [] });
      router.dismissTo('/(tabs)/chat');
      openChatModal(id);
    },
    [conv, reusable],
  );

  // getItemLayout, not measurement: a row's offset has to be known up front,
  // and every row here is exactly `metrics.fullH` tall by construction. Without
  // it the list would mount at the top and scroll down afterwards, which the
  // zoom would arrive in the middle of.
  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: metrics.fullH,
      offset: metrics.fullH * index,
      index,
    }),
    [metrics.fullH],
  );

  // The opening position, applied NATIVELY at mount — and this is the whole
  // reason the zoom used to work on the first card and no other.
  //
  // `initialScrollIndex` does NOT seed the scroll view's offset. VirtualizedList
  // only uses it to pick the initial render window; the actual scroll is an
  // imperative `scrollToIndex` fired from `onContentSizeChange`, i.e. a frame or
  // more AFTER mount (`_maybeScrollToInitialScrollIndex`, VirtualizedList.js).
  // And that path is guarded on `initialScrollIndex > 0`, so index 0 skips it
  // altogether.
  //
  // That asymmetry was the bug exactly. Card 0 needed no scroll and so was in
  // place on the first frame; every other card was still sitting `index *
  // fullH` points below the fold at the moment UIKit sampled
  // `Link.AppleZoomTarget`'s rect for the push. The zoom dutifully flew to a
  // rect somewhere off the bottom of the screen, which reads as no zoom at all.
  //
  // `contentOffset` fixes both halves at once: iOS applies it to the underlying
  // scroll view before the first paint, so the arrival card is already under the
  // header when the rect is read — and VirtualizedList explicitly stands down
  // when it sees one (`if (this.props.contentOffset == null)`), so there is no
  // second, later scroll left to race the transition.
  //
  // Derived from the same `metrics.fullH` as getItemLayout and snapToInterval,
  // so a corrected viewport moves the opening offset with the row heights rather
  // than leaving the two disagreeing by `index * Δ`.
  const contentOffset = useMemo(
    () => ({ x: 0, y: initialIndex * metrics.fullH }),
    [initialIndex, metrics.fullH],
  );

  return (
    <View style={styles.screen} onLayout={(e) => setViewport(e.nativeEvent.layout.height)}>
      <Animated.FlatList
        data={suggestions}
        keyExtractor={(s) => s.id}
        renderItem={({ item, index }) => (
          <ShowcaseCard
            item={item}
            index={index}
            progress={progress}
            onPress={onPick}
            metrics={metrics}
            fadeInactive={FADE_NEIGHBOURS}
            layout={CARD_LAYOUT}
          />
        )}
        getItemLayout={getItemLayout}
        // Both, and they do different jobs: `initialScrollIndex` picks the
        // initial RENDER WINDOW (so the arrival card is actually mounted, and is
        // the first cell rendered rather than one virtualised away), while
        // `contentOffset` puts the scroll view AT it before the first paint.
        // Neither alone is enough — see the contentOffset note above.
        initialScrollIndex={initialIndex}
        contentOffset={contentOffset}
        // The chrome, as padding: a card snaps to the top of the readable band
        // (snapToAlignment "start"), so the pad above is exactly what the header
        // covers and the pad below what the tab bar does. Cards are a screenful
        // each now, so there is no half-screen of air to centre them in — every
        // card IS the centre when it's the one you're on.
        contentContainerStyle={{
          paddingTop: metrics.padTop,
          paddingBottom: metrics.padBottom,
          paddingHorizontal: 20,
          gap: GAP,
        }}
        snapToInterval={metrics.fullH}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      />

      {/* The rect the zoom flies into, and later out of. Drawn over the list
          rather than inside a row — see <ZoomSlot>. Keyed on the poster it is
          currently aimed at so a re-pointed transition gets a freshly registered
          target instead of a stale one. */}
      <ZoomSlot key={zoomSource ?? 'zoom'} metrics={metrics} />
    </View>
  );
}

// The card's box inside its row, as margins rather than a height: a card that
// measured even a point taller than the snap interval would walk down the list.
// Shared by the card and by the zoom slot drawn over it, because the two have to
// describe the SAME rectangle — the slot is where the transition thinks the card
// is, and a margin changed on one side only would aim it a few points off.
// Halved along with GAP: the distance the eye reads between two posters is
// marginBottom + GAP + marginTop, and it moves as one number or not at all.
const CARD_BOX = { flex: 1, marginTop: 5, marginBottom: 1, borderRadius: 0 } as const;

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  // Where the shadow lives: the card itself clips to hold its radius, and on iOS
  // a clipping view drops its own shadow.
  boundary: {
    ...CARD_BOX,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  // The same box, empty and untouchable: it exists only to be measured.
  zoomSlot: CARD_BOX,
  card: {
    flex: 1,
    borderRadius: 0,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  body: { flex: 1, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 18 },
  // `art-bottom` starts with the headline instead of arriving at it, so the top
  // of the card is the top of the TYPE — and type set 16pt off an edge reads as
  // cramped where a picture doesn't. The picture in `art-top` needs no such air:
  // it's meant to run right up to the edge.
  bodyTopmost: { paddingTop: 34 },
  // The button's own row. `marginTop: auto` puts it on the card's bottom edge
  // no matter how short the blurb ran; the padding is the minimum air it keeps
  // from the paragraph when the blurb runs to all four lines.
  ctaSlot: { marginTop: 'auto', paddingTop: CTA_GAP, minHeight: CTA_H + CTA_GAP },
  // `art-bottom`'s button, standing on the picture. Absolute rather than a row
  // at the foot of the band, so the video keeps the band's full height and the
  // button costs the picture nothing. Left and right match the body's 20pt
  // padding; the bottom matches its 18, so the button sits the same distance
  // off the card's edge in either layout.
  ctaOverArt: { position: 'absolute', left: 20, right: 20, bottom: 18 },
  // A size up from the landing poster's 17pt — this card has a whole screen, so
  // the headline can read as a headline instead of a caption.
  title: {
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 29,
    letterSpacing: -0.4,
    color: theme.colors.foreground,
  },
  subtitle: { fontSize: 14, lineHeight: 18, marginTop: 4, color: theme.colors.mutedForeground },
  // The marginTop doubles as the gap BETWEEN paragraphs, since every one of
  // them wears this.
  blurb: { fontSize: 15, lineHeight: 21, marginTop: 10, color: theme.colors.mutedForeground },
  // Three paragraphs where `art-top` has one, in a body that is only ~50pt
  // taller. A point off the size and two off the leading is what makes twelve
  // lines fit where nine did — at 15/21 the third paragraph ran off the card.
  blurbTight: { fontSize: 14, lineHeight: 19 },
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
  doneBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    // Its own colours, not the theme's: it sits on a black wash in both light
    // and dark mode, so a token that flips with the theme would vanish in one.
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.34)',
  },
  doneBadgeText: { color: '#fff', fontSize: 13, fontWeight: '600', letterSpacing: 0.2 },
}));
