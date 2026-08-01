# Reference code

Trimmed from the working implementation. Paths are repo-relative.

- Source row — `mobile-app/src/app/(tabs)/chat/index.tsx`
- Destination — `mobile-app/src/app/(tabs)/chat/showcase.tsx`
- Shared deck options — `mobile-app/src/lib/deck-options.ts`
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

## <a id="target"></a>5. The landing rect — one target only

```tsx
// Every OTHER card renders plain. A second target would be a second answer to
// "where does this land", and the rest of the deck is off-screen anyway.
function ZoomTarget({ isArrival, style, children }: {
  isArrival: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  if (!isArrival) return <View style={style}>{children}</View>;
  return (
    <Link.AppleZoomTarget>
      <View style={style}>{children}</View>
    </Link.AppleZoomTarget>
  );
}
```

Wrap the **whole card**, button included — the small poster flies into one rect
with one radius, not into a picture with a button hanging off it. The shadow
lives on the boundary because the card itself clips to hold its radius, and on
iOS a clipping view drops its own shadow:

```ts
boundary: {
  flex: 1,               // it IS the row; a fixed height that missed by a point would walk down the list
  marginBottom: 7,
  borderRadius: 28,
  shadowColor: '#000',
  shadowOpacity: 0.18,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 10 },
},
card: { flex: 1, borderRadius: 28, overflow: 'hidden' },
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
