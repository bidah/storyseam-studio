---
name: expo-bottomsheet-with-correct-bottom-margin
description: Fix the dead space under the card in an Expo Router / react-native-screens `formSheet` that uses `sheetAllowedDetents: 'fitToContents'` with a floating (glass) native header — the sheet's bottom gap reads far larger than its side margins. Use when a fit-to-content sheet "has too much space at the bottom", "doesn't hug its rows", the bottom margin doesn't match the sides, or when tuning `SHEET_CONTENT_STYLE` / `useSheetContentStyle` in mobile-app/. Also covers how to MEASURE sheet geometry on the simulator instead of guessing constants.
---

# Fit-to-content sheets with a correct bottom margin

Scope: `mobile-app/` (Expo SDK 57 · RN 0.86 · expo-router · react-native-screens),
iOS `presentation: 'formSheet'` + `sheetAllowedDetents: 'fitToContents'` +
`headerShown: true`. Canonical implementation: `src/lib/sheet.ts`, used by
`src/app/model-picker.tsx`, `image-model-picker.tsx`, `option-picker.tsx`.

## The symptom

The sheet hugs its content at the top but leaves a slab of empty space under the
card — visibly wider than the sheet's own side padding, so the content looks
bottom-heavy and un-centred.

## Why: three separate things add height, only one is yours

A `fitToContents` sheet's height is **not** your content height. Budget it:

| Contribution | Size | Who adds it |
| --- | --- | --- |
| your painted content | `paddingTop + card` | you |
| nav-bar errata | **56pt** | react-native-screens sizes the sheet as `contentHeight + navBarHeight` (RNSScreen `contentHeightErrata`) so a header fits |
| bottom safe area | **~30pt** measured (34pt inset, sheet floats ~9pt up) | iOS keeps it below the content, inside the sheet |

With a **floating/glass header** the content already sits *under* the bar, so the
56pt errata has nowhere to go at the top and lands as dead space at the bottom.
Cancelling only that still leaves the safe area — and if you then pad your own
"breathing room" on top of it, the two stack:

```
24pt (your gap) + 30pt (safe area) = ~54pt bottom  vs  27–32pt sides   ← the bug
```

**The safe-area inset must COUNT TOWARD the gap, not stack on top of it.**

## The fix

`src/lib/sheet.ts` — a hook, because it needs the live inset:

```ts
const HEADER_INSET = 76;   // top reserve for the floating glass header
const HEADER_ERRATA = 56;  // nav-bar height the fitToContents detent adds

export function useSheetContentStyle(gap: number) {
  const { bottom } = useSafeAreaInsets();
  return {
    paddingTop: HEADER_INSET,
    marginBottom: Math.max(gap - bottom, 0) - HEADER_ERRATA,
  };
}
```

Each sheet passes **its own horizontal padding** as `gap`, so bottom == sides by
construction:

```tsx
const contentStyle = useSheetContentStyle(32);   // 32 == the px-8 below
...
<View className="bg-background px-8" style={contentStyle}>
```

Rules that matter:

- **Negative `marginBottom` shrinks what RNS measures, not what you paint.** The
  card still draws at full height; only the detent gets smaller. That is why the
  trick works at all.
- **Clamp at 0.** Without `Math.max(..., 0)` a small `gap` (e.g. 16) on a 34pt
  inset yields negative padding and drags the card under the home indicator.
- **You cannot go below the safe-area residual (~30pt).** A `gap` of 16 renders
  the same as 0 on a home-indicator iPhone. If a sheet needs a visually tighter
  bottom, widen its side padding instead of fighting the inset.
- **Content below the card is never clipped.** The sheet always ends up
  `painted content + ~30pt`, whatever the content height — so a trailing pill
  (e.g. the image picker's "More models") keeps its clearance.
- On devices with no home indicator (iPad, Touch ID) `bottom` is ~0 and the full
  `gap` gets padded in — the same formula covers both.

## Measure it, don't guess the constants

These numbers are device- and OS-specific. Verify on the simulator:

```bash
D=$(xcrun simctl list devices booted | grep -o '([0-9A-F-]\{36\})' | tr -d '()' | head -1)
xcrun simctl openurl $D "mobileapp://model-picker"      # deep-link straight to the sheet
xcrun simctl io $D screenshot /tmp/sheet.png
```

**Trap — a stale bundle will lie to you.** Fast Refresh silently misses these
screens; you will screenshot the OLD layout and "confirm" a fix that never ran.
Prove the bundle is live (temporarily render a value into the header title, e.g.
`title={'b' + insets.bottom}`), and force a reload when it isn't:

```bash
xcrun simctl terminate $D com.bidah.shot-studio-mobile.dev
xcrun simctl openurl $D "mobileapp://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
```

**Trap — deep-linking a picker skips the screen that fills its store**, so the
sheet renders empty (no rows, no trailing pill). That is not a regression; reach
it through the real UI when the content matters.

**Tint the measured box to see the dead space.** Give the content `View` a
temporary `backgroundColor: 'red'`: the red region is exactly what RNS measured,
and anything sheet-coloured below it is native dead space. Then scan the PNG
(3x → pt = px / 3) rather than eyeballing — dark mode has almost no contrast
between sheet and card:

```python
from PIL import Image
im = Image.open('sheet.png').convert('RGB'); W, H = im.size; mid = W // 2
col = [im.getpixel((mid, y)) for y in range(H)]
sheet_bottom = max(y for y in range(H // 2, H) if col[y][0] > 7)    # vs backdrop
card_bottom  = max(y for y in range(H // 2, sheet_bottom) if col[y][0] > 13)  # vs sheet bg
print('bottom gap', (sheet_bottom - card_bottom) / 3, 'pt')
```

Sample the side padding on a row **inside** the card band — near the sheet's
bottom corners the radius curves away and gives false edges.

Verified on iPhone 17 Pro Max / iOS 26.4: **30pt below the card vs 27pt at the
sides** (was ~51pt vs 27pt).
