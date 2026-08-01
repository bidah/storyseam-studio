---
name: zoom-horizontal-to-vertical-transition
description: Build a horizontally-scrolling card deck whose cards zoom into a full-screen VERTICAL carousel of the same deck, landing on the card that was tapped. Covers the two magnifications (a sideways row of small posters, a vertical one-card-per-screenful list), expo-router Link.AppleZoom/AppleZoomTarget wiring, and the index matching that makes the zoom land — including why initialScrollIndex alone silently breaks it for every card except the first. Use when adding a card-row-to-fullscreen-deck zoom, a paged vertical showcase, "open this list already scrolled to the tapped item", or debugging a zoom transition that only animates on the first card.
---

# Horizontal deck → vertical showcase zoom (expo-router)

One deck at **two magnifications**: a sideways row of small posters on the
landing screen, and the same list at one card per screenful on a pushed screen —
with the tapped card flying from the first into its own place in the second.

The whole trick is that both surfaces are the *same list at the same indices*,
and the destination is **already scrolled to the tapped index before the first
paint**. Get that wrong and the zoom is a lie (or, more usually, invisible).

Working reference: `mobile-app/src/app/(tabs)/chat/index.tsx` (the row),
`mobile-app/src/app/(tabs)/chat/showcase.tsx` (the vertical deck),
`mobile-app/src/lib/deck-options.ts` (the shared list). Full code:
[REFERENCE.md](REFERENCE.md).

## Requirements

- **expo-router above v55** (this repo: `~57.0.4`, SDK 57) for `Link.AppleZoom` /
  `Link.AppleZoomTarget`.
- **iOS 18+** for the zoom. Elsewhere both components are a passthrough and the
  press degrades to a plain push — ship it anyway, nothing crashes.
- The destination must be an **ordinary pushed screen**. The zoom rides the HREF,
  so it needs no screen options at all, and the native back chevron and
  swipe-back run it in reverse for free.

## The rule that actually makes it land

> **`initialScrollIndex` does NOT position the list. Pass `contentOffset` too.**

This is the bug that presents as *"the zoom works on the first card and no
other"*, and it is worth stating precisely because nothing about it is visible
from the JSX.

`VirtualizedList` uses `initialScrollIndex` only to pick the initial **render
window**. The actual scroll is an imperative `scrollToIndex` fired from
`onContentSizeChange` — a frame or more *after* mount — and that path is guarded
on `initialScrollIndex > 0`:

```js
// @react-native/virtualized-lists/Lists/VirtualizedList.js
_maybeScrollToInitialScrollIndex(contentWidth, contentHeight) {
  if (… && this.props.initialScrollIndex > 0 && !this._hasTriggeredInitialScrollToIndex) {
    if (this.props.contentOffset == null) {        // ← the escape hatch
      this.scrollToIndex({animated: false, index: …});
```

So index 0 needs no scroll and is in place immediately, while **every other index
is still sitting `index * rowHeight` points below the fold** at the moment UIKit
samples `Link.AppleZoomTarget`'s rect for the push. The zoom dutifully flies to a
rect off the bottom of the screen, which reads as no zoom at all.

`contentOffset` fixes both halves at once — iOS applies it to the underlying
scroll view **before the first paint**, and `VirtualizedList` explicitly stands
down when it sees one, so there is no second, later scroll to race:

```tsx
const contentOffset = useMemo(
  () => ({ x: 0, y: initialIndex * metrics.fullH }),
  [initialIndex, metrics.fullH],
);

<Animated.FlatList
  getItemLayout={getItemLayout}   // rows must have a known height
  initialScrollIndex={initialIndex}   // the RENDER WINDOW (mounts the arrival cell)
  contentOffset={contentOffset}       // the POSITION (before first paint)
  …
/>
```

Keep **both**: `initialScrollIndex` is what guarantees the arrival card is
mounted (and rendered first, not virtualised away) so there is a rect to fly to;
`contentOffset` is what puts it under the header. Neither alone is enough.

Corollary: derive `contentOffset` from the **same** row height as `getItemLayout`
and `snapToInterval`. If they disagree by Δ, the opening offset is wrong by
`index * Δ` — which again looks fine on card 0 and worsens down the list.

## The three parts

### 1. The horizontal row (source)

A bold headline over a `ScrollView horizontal` that bleeds off both edges, so a
card sits half-off-screen and invites the swipe. Snap with **explicit
`snapToOffsets`** (one per card, card-width-plus-gap apart), not `snapToInterval`
— the latter proved unreliable under the New Architecture. `pagingEnabled` is
wrong either way: it snaps to viewport widths, not card widths.

### 2. The zoom (the link)

```tsx
<Link href={{ pathname: '/…/showcase', params: { from: item.id } }} asChild>
  <Pressable disabled={item.done} onPress={haptic}>
    <Link.AppleZoom>
      <Card … ownPress={false} />   {/* exactly ONE child */}
    </Link.AppleZoom>
  </Pressable>
</Link>
```

- **`asChild` is required, not stylistic** — the router rewrites the href with a
  source id the destination reads off its route params. `router.push` gets no
  zoom, and `Link.AppleZoom` **throws** without `asChild`.
- **Exactly one child.** More warns and renders nothing.
- **No press-scale wrapper** (no `BouncyPressable`): a press-shrink transform and
  the zoom animate the same frame in opposite directions. The zoom IS the
  feedback.
- **`from` carries the identity**, not the index — indices shift as the deck
  reorders; ids don't.

### 3. The vertical showcase (destination)

One card per screenful, snapped, with every row scaled/faded by its distance from
centre. Two details that are easy to get wrong:

- **Exactly ONE `Link.AppleZoomTarget`**, on the arrival card only
  (`isArrival={item.id === from}`). It answers *"where does this land"* — a list
  of them is a list of answers to a question with one. Wrap the **whole card**
  (button and all): the small poster flies into one rect with one radius.
- **Track scroll progress in CARDS, not points** (`offsetY / rowHeight`). A
  card's own index is then its centred position and the interpolation input range
  is the same three numbers for every row.

## Gotchas

- **Both decks must be the same list.** Share one builder + one options object
  (`FULL_DECK` here) — a different cap on either side lands the zoom on a
  different card than it flew out of.
- **Plain JS `onScroll`, not `useAnimatedScrollHandler`.** On this stack
  (Expo 57 / RN 0.86 / New Arch / React Compiler) Reanimated's native event
  pipeline is dead and the animated handler is simply never called, so every card
  freezes at its initial scale. JS→UI shared-value writes DO work; at
  `scrollEventThrottle={16}` this tracks fine.
- **Seed the scroll shared value to the opening index**, or the arrival card
  paints at its neighbour scale and pops to full size exactly as the zoom lands.
- **Size the cards off the LIST's measured height, not the window**, when the
  header is transparent and a tab bar overlays the bottom — but seed that state
  with the window height rather than 0, so the landing rect exists on the very
  first frame instead of one layout pass after the transition started.
- **A disabled source card must not navigate.** Radix `Slot` composes the Link's
  press onto your `Pressable`, so `disabled` there disables the navigation too.
- **Cold cache caveat:** `from`→index resolution needs the deck loaded. Both
  surfaces should read one cached, shared query so opening the destination costs
  no request; on a genuine cache miss the list opens at 0 and the zoom misses.
