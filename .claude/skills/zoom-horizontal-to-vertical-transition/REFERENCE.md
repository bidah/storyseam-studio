# Reference code

Trimmed from the working implementation. Paths are repo-relative.

- Source row — `mobile-app/src/app/(tabs)/chat/index.tsx`
- Destination — `mobile-app/src/app/(tabs)/chat/showcase.tsx`
- Shared deck options — `mobile-app/src/lib/deck-options.ts`
- The way back — `mobile-app/src/lib/deck-return.ts`
- Stack registration — `mobile-app/src/app/(tabs)/chat/_layout.tsx`

---

## <a id="row"></a>1. The horizontal row

A headline over a sideways `ScrollView` that bleeds off both edges. Snap points
are **explicit offsets**, one per card.

```tsx
function Section({ title, cardWidth, children }: {
  title: string;
  /** Card width for this row — snap offsets are that plus the row's gap apart. */
  cardWidth: number;
  children: React.ReactNode;
}) {
  const count = Children.count(children);
  const offsets = useMemo(
    () => Array.from({ length: count }, (_, i) => i * (cardWidth + ROW_GAP)),
    [count, cardWidth],
  );
  return (
    <View className="gap-0.5">
      <Text accessibilityRole="header" className="px-5 text-foreground" style={styles.sectionTitle}>
        {title}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="handled"
        // Explicit offsets, NOT snapToInterval — that proved unreliable under
        // the New Architecture. pagingEnabled is wrong either way: it snaps to
        // viewport widths, not card widths.
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
```

The row's own horizontal padding supplies the page margin, so a card can sit
half-off-screen:

```ts
row: { paddingHorizontal: ROW_PAD, paddingTop: 10, gap: ROW_GAP },
```

---

## <a id="link"></a>2. The zoom link

```tsx
<Section title="Continue building your story" cardWidth={SUGGESTION_W}>
  {suggestions.map((s) => (
    <Link
      key={s.id}
      href={{ pathname: '/(tabs)/chat/showcase', params: { from: s.id } }}
      asChild
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={s.done ? `${s.title} — completed` : `${s.title} — ${s.subtitle ?? ''}`}
        // Slot composes the Link's press onto this one, so disabling here
        // disables the NAVIGATION too.
        disabled={s.done}
        // …and runs alongside it rather than replacing it.
        onPress={onSuggest}
      >
        <Link.AppleZoom>
          <PressCard
            label={s.subtitle ? `${s.title} — ${s.subtitle}` : s.title}
            art={cardArt(s.id)}
            done={s.done}
            // The <Link> above owns the press: a press-shrink and the zoom
            // would animate the same frame in opposite directions.
            ownPress={false}
            onPress={onSuggest}
          >
            <Text style={styles.cardTitle} numberOfLines={3}>{s.title}</Text>
            <Text style={styles.cardBlurb} numberOfLines={5}>{s.blurb}</Text>
          </PressCard>
        </Link.AppleZoom>
      </Pressable>
    </Link>
  ))}
</Section>
```

The handler adds **only** the haptic — navigation is the `<Link>`, because the
zoom rides the href:

```tsx
const onSuggest = useCallback(() => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}, []);
```

Swapping the pressable frame is how the press-scale is dropped for this row only:

```tsx
const Frame = ownPress ? BouncyPressable : CardFrame;   // CardFrame = plain <View style={style}>
```

---

## <a id="metrics"></a>3. Destination geometry

One snap unit = the card plus the gap under it. Every derived number comes off
`fullH`, so the snap interval, the top pad and the interpolation range cannot
drift apart.

```ts
const { height: SCREEN_H } = Dimensions.get('window');
const HEADER_BAR = 44;   // compact iOS bar; the header is transparent, so chrome comes off by hand
const GAP = 16;
const BAND_SLACK = 5;    // so the card's bottom edge reads as an edge, not as something cut off
const ART_SHARE = 0.52;

type Metrics = {
  fullH: number;    // the snap unit: card + gap
  cardH: number;
  artH: number;
  padTop: number;
  padBottom: number;
};

function metricsFor(viewport: number, top: number, bottom: number): Metrics {
  const padTop = top + HEADER_BAR;
  // Inside a tab, the bottom inset already includes the tab bar.
  const padBottom = bottom;
  const band = Math.max(320, viewport - padTop - padBottom);
  const cardH = band - BAND_SLACK;
  return { fullH: cardH + GAP, cardH, artH: Math.round(cardH * ART_SHARE), padTop, padBottom };
}
```

Seed the measured viewport with the **window height**, not 0 — the landing rect
has to exist on the very first frame:

```tsx
const [viewport, setViewport] = useState(SCREEN_H);
const metrics = useMemo(
  () => metricsFor(viewport, insets.top, insets.bottom),
  [viewport, insets.top, insets.bottom],
);
// …
<View style={{ flex: 1 }} onLayout={(e) => setViewport(e.nativeEvent.layout.height)}>
```

---

## <a id="position"></a>4. Index matching — the load-bearing part

```tsx
const { from } = useLocalSearchParams<{ from?: string }>();

const initialIndex = useMemo(() => {
  const i = suggestions.findIndex((s) => s.id === from);
  return i < 0 ? 0 : i;
}, [suggestions, from]);

// Scroll position in CARDS. Seeded to the opening index so the arrival card is
// full size on frame one — starting at 0 would paint it at 0.92 and pop it to 1
// right as the zoom lands.
const progress = useSharedValue(initialIndex);

// Rows are a known height by construction, so no measurement.
const getItemLayout = useCallback(
  (_: unknown, index: number) => ({
    length: metrics.fullH,
    offset: metrics.fullH * index,
    index,
  }),
  [metrics.fullH],
);

// The opening position, applied NATIVELY at mount. `initialScrollIndex` does not
// seed the scroll view's offset — VirtualizedList only uses it to pick the
// initial render window, then fires an imperative scrollToIndex from
// onContentSizeChange (a frame or more later), and skips that entirely when the
// index is 0. That asymmetry is exactly why the zoom worked on the first card
// and no other. Derived from the SAME fullH as getItemLayout/snapToInterval, so
// a corrected viewport moves the offset with the row heights instead of leaving
// the two disagreeing by index * Δ.
const contentOffset = useMemo(
  () => ({ x: 0, y: initialIndex * metrics.fullH }),
  [initialIndex, metrics.fullH],
);
```

```tsx
<Animated.FlatList
  data={suggestions}
  keyExtractor={(s) => s.id}
  renderItem={({ item, index }) => (
    <ShowcaseCard
      item={item}
      index={index}
      progress={progress}
      onPress={onPick}
      isArrival={item.id === from}
      metrics={metrics}
    />
  )}
  getItemLayout={getItemLayout}
  // Both, and they do different jobs: initialScrollIndex picks the initial
  // RENDER WINDOW (so the arrival card is actually mounted), contentOffset puts
  // the scroll view AT it before the first paint. Neither alone is enough.
  initialScrollIndex={initialIndex}
  contentOffset={contentOffset}
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
```

A **plain JS** `onScroll` — Reanimated's native event pipeline is dead on this
stack, so `useAnimatedScrollHandler` is never called and every card would freeze
at its initial scale. Not wrapped in `useCallback`: the compiler lint forbids
mutating a value handed to a hook, which a shared value in a dependency array is.

```tsx
const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
  progress.value = e.nativeEvent.contentOffset.y / metrics.fullH;
};
```

---

## <a id="target"></a>5. The landing rect — one target, on the slot

The target does **not** ride the arrival card. It is an empty overlay on the rect
a snapped card always fills, laid out from the same numbers as the rows, so it is
correct for the card the deck opened on *and* every card scrolled to afterwards:

```tsx
function ZoomSlot({ metrics }: { metrics: Metrics }) {
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { paddingTop: metrics.padTop, paddingHorizontal: 20 }]}
    >
      {/* one row's worth of height — the CARD, not the snap unit: the gap under
          it belongs to the list, not to the box the poster flies into */}
      <View style={{ height: metrics.cardH }}>
        <Link.AppleZoomTarget>
          <View style={styles.zoomSlot} />
        </Link.AppleZoomTarget>
      </View>
    </View>
  );
}
```

`Link.AppleZoomTarget` renders its detector with `display: contents`, so it adds
no box of its own and the child keeps the parent's layout context.

The slot and the card have to describe the SAME rectangle, so they take their
margins from one object. The shadow stays on the card's boundary because the card
clips to hold its radius, and on iOS a clipping view drops its own shadow:

```ts
// flex, not a height: it IS the row, and a box a point taller than the snap
// interval would walk down the list.
const CARD_BOX = { flex: 1, marginTop: 10, marginBottom: 2, borderRadius: 28 } as const;

boundary: {
  ...CARD_BOX,
  shadowColor: '#000',
  shadowOpacity: 0.18,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 10 },
},
zoomSlot: CARD_BOX,     // the same box, empty and untouchable: it exists to be measured
card: { flex: 1, borderRadius: 28, overflow: 'hidden' },
```

Mount it ONCE, keyed on the identity the transition is currently aimed at (see
§8) — the native side registers alignment views first-come and drops them on
unmount, so a target that hops between rows can leave none registered at all.

```tsx
<ZoomSlot key={zoomSource ?? 'zoom'} metrics={metrics} />
```

Each row scales and fades by distance from centre — the input range is the same
three numbers for every row because `progress` is in cards:

```tsx
const stylez = useAnimatedStyle(() => ({
  opacity: interpolate(progress.value, [index - 1, index, index + 1], [0.45, 1, 0.45], 'clamp'),
  transform: [
    { scale: interpolate(progress.value, [index - 1, index, index + 1], [0.92, 1, 0.92], 'clamp') },
  ],
}));
```

---

## <a id="stack"></a>6. Stack registration

Nothing configures the transition — it rides the href. Only the chrome:

```tsx
<Stack.Screen
  name="showcase"
  options={{
    title: '',                              // the card that flies in carries its own headline
    headerLargeTitle: false,
    headerBackVisible: true,
    headerBackButtonDisplayMode: 'minimal',
  }}
/>
```

---

## <a id="shared"></a>7. One list, both surfaces

```ts
/**
 * Shared by both surfaces on purpose. The showcase opens on the card the
 * landing row was tapped, so the two decks have to BE the same list — a
 * different cap on either side would land the zoom on a different card than
 * the one it flew out of.
 */
export const FULL_DECK = { max: Infinity, maxCompleted: Infinity } as const;
```

Both screens then read the same cached, SSE-invalidated query, so opening the
destination costs no request and the two orders cannot disagree:

```tsx
const { data: status, isError } = useProjectResource<Status>('status');
const suggestions = useMemo<Suggestion[]>(
  () => (isError || !status ? FALLBACK_SUGGESTIONS : buildSuggestions(status, FULL_DECK)),
  [status, isError],
);
```

---

## <a id="return"></a>8. The return leg

Two facts have to cross screens while both are mounted: which card the deck is
showing, and which `<Link>` owns which zoom identity. Neither screen owns the
pair, so they live in a module.

```ts
type Listener = (cardId: string) => void;

/** Card id → the zoom source identifier of the <Link> wrapping that card. */
const sourceIds = new Map<string, string>();
const listeners = new Set<Listener>();

export function registerZoomSource(cardId: string, identifier: string): () => void {
  sourceIds.set(cardId, identifier);
  return () => {
    // Only if it's still ours: a remount registers the new one first.
    if (sourceIds.get(cardId) === identifier) sourceIds.delete(cardId);
  };
}

export function zoomSourceId(cardId: string): string | undefined {
  return sourceIds.get(cardId);
}

/** The showcase settled on a card — line the row up behind it. */
export function showcaseMovedTo(cardId: string): void {
  for (const listener of listeners) listener(cardId);
}

export function onShowcaseMove(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
```

### The beacon — reading a link's zoom identity

`useId()` inside the link's own context; nothing above the link can see it, so
the card reports it from the inside. Null-rendering, and a SIBLING of
`Link.AppleZoom` (which takes exactly one child):

```tsx
import { ZoomTransitionSourceContext } from 'expo-router/build/link/zoom/zoom-transition-context';

function ZoomSourceBeacon({ cardId }: { cardId: string }) {
  const source = use(ZoomTransitionSourceContext);
  const identifier = source?.identifier;
  useEffect(() => {
    if (!identifier) return;
    return registerZoomSource(cardId, identifier);
  }, [cardId, identifier]);
  return null;
}
```

```tsx
<Pressable /* …the Link's child… */>
  <Link.AppleZoom>
    <Card … />
  </Link.AppleZoom>
  <ZoomSourceBeacon cardId={s.id} />
</Pressable>
```

### The row, moved by prop

A ref is no use — on this stack nothing in that subtree attaches one. Hand the
`ScrollView` a `contentOffset` instead, and alternate a hundredth of a point so a
repeat arrival is still a *change* (iOS applies only changed offsets):

```tsx
const [rowOffset, setRowOffset] = useState<{ x: number; y: number } | undefined>(undefined);

useEffect(
  () =>
    onShowcaseMove((cardId) => {
      const index = suggestions.findIndex((s) => s.id === cardId);
      if (index < 0) return;
      const x = index * (SUGGESTION_W + ROW_GAP);   // the same number as snapToOffsets
      setRowOffset((prev) => ({ x: prev && prev.x === x ? x + 0.01 : x, y: 0 }));
    }),
  [suggestions],
);

// …passed straight through <Section> to its horizontal ScrollView:
<ScrollView contentOffset={contentOffset} horizontal snapToOffsets={offsets} … />
```

### The aim, moved on the same frame

```tsx
import { INTERNAL_EXPO_ROUTER_ZOOM_TRANSITION_SOURCE_ID_PARAM_NAME as ZOOM_SOURCE_PARAM }
  from 'expo-router/build/navigationParams';

const params = useLocalSearchParams<{ from?: string }>();
const zoomSource = (params as Record<string, string | undefined>)[ZOOM_SOURCE_PARAM];

const aimZoomAt = useCallback(
  (card: Suggestion | undefined) => {
    // `setParams` writes to the FOCUSED route — after the pop that isn't this one.
    if (!card || !navigation.isFocused()) return;
    const source = zoomSourceId(card.id);
    if (!source || source === zoomSource) return;
    router.setParams({ [ZOOM_SOURCE_PARAM]: source });
  },
  [navigation, zoomSource],
);

// The SAME handler that drives the scale/fade. Both effects on the one frame the
// current card changes — debouncing the aim behind the row is the bug that reads
// as "the zoom sticks to a card nobody is looking at".
const shown = useRef(initialIndex);
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
```

Why writing that param is enough — the native enabler resolves the identifier
**when the transition runs**, inside the provider closures, not when
`preferredTransition` was assigned:

```swift
// expo-router/ios/LinkPreview/LinkZoomTransition.swift
controller.preferredTransition = .zoom(options: options) { _ in
  let sourceInfo = self.sourceRepository?.getSource(
    identifier: self.zoomTransitionSourceIdentifier)   // ← read at transition time
  …
}
```
