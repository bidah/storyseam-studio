---
name: expo-tabbar-bottom-accessory
description: Add an iOS 26 tab-bar bottom accessory (UITabAccessory) with expo-router NativeTabs — a persistent pill riding ABOVE the tab bar, Music-mini-player style — and morph it in place into a real composer/input when tapped. Use when the user asks for a "tab bar accessory", "pill above the tab bar", "mini player bar", "persistent input on the toolbar", "morph the toolbar pill into the chat input", or wants a text field in the tab bar (it can't hold one — this skill has the working pattern). Covers NativeTabs.BottomAccessory, the two-placements trap, why a TextInput inside the accessory is impossible, the suppression store for screens docking their own bar, the quick-composer overlay morph (scrim-only fade over liquid glass, keep-mounted with display:none, KeyboardStickyView restOffset sign), and the send→push-a-new-chat hand-off.
---

# Tab-bar bottom accessory + in-place composer morph (Expo Router · iOS 26)

Scope: `mobile-app/` (Expo SDK 57 · RN 0.86 · expo-router 57 NativeTabs ·
react-native-screens 4.25 · iOS 26). Canonical implementation, in reading order:

1. `src/app/(tabs)/_layout.tsx` — mounts the accessory + the overlay
2. `src/components/chat/agent-accessory.tsx` — the pill itself
3. `src/components/chat/quick-composer.tsx` — the morph overlay + store
4. `src/lib/agent/accessory-suppress.ts` — screens that stand the pill down
5. `src/lib/use-tab-bar-inset.ts` — how content clears the bar cluster

## The one idea

A `UITabAccessory` is chrome, not a screen: it rides above the tab bar,
survives tab switches and stack pushes, and UIKit owns its frame. That makes it
perfect for a persistent "Message the agent…" pill — and structurally unable to
be the input itself. The working shape is a **staged morph**: the pill is a
button; tapping it hides the accessory and fades in an overlay holding the REAL
composer on the same bottom edge, keyboard rising with it. One bar visually
becomes the other, and only a *send* creates anything.

## Mounting the accessory

```tsx
// (tabs)/_layout.tsx
const accessorySupported = isLiquidGlassAvailable();   // iOS 26 gate — no slot below
…
<NativeTabs …>
  {showAccessory ? (
    <NativeTabs.BottomAccessory>
      <AgentAccessory />
    </NativeTabs.BottomAccessory>
  ) : null}
  <NativeTabs.Trigger name="chat">…</NativeTabs.Trigger>
  …
</NativeTabs>
```

- Toggle the ELEMENT in and out (`showAccessory ? … : null`) — react-native-screens
  animates the accessory's add/remove, which is what makes hide-on-morph and
  hide-on-conversation look intentional.
- `showAccessory = accessorySupported && !suppressed && !quickOpen`: a zustand
  count (`useSuppressAgentAccessory`, called by any screen docking its own
  composer — the conversation screen, Visual world) plus the morph-overlay's
  `open` flag. Don't gate by tab name; screens know, tabs don't.

## The pill: rules that aren't obvious

- **Two copies render at once.** RNS renders one copy per placement (`regular`
  and `inline`, the shrunken form for the minimized bar) and swaps them by layer
  opacity. Local `useState` is NOT shared between them and the hidden copy still
  hit-tests — so read everything from context/stores, and keep the same controls
  in the same order in both placements. `NativeTabs.BottomAccessory.usePlacement()`
  tells a copy which one it is.
- **No TextInput, ever.** Nothing lifts a UITabAccessory for the keyboard; a
  caret in it types from underneath. The pill is a `Pressable` that looks like
  the composer's collapsed line.
- **Height is UIKit's.** Don't measure the accessory; screens clear it via the
  tab's safe-area bottom (`use-tab-bar-inset.ts` — inside a tab screen,
  `insets.bottom` already includes bar + gap + accessory and re-reports when the
  accessory mounts/unmounts).
- `minimizeBehavior="onScrollDown"` (which would engage the `inline` placement)
  is declared but DEAD upstream — UIKit can't see a scroll view nested in a
  native stack (react-native-screens#4145). Keep the inline form correct anyway.

## The morph overlay (quick-composer)

A tiny zustand store (`{ open, tick, show, hide }`) + one overlay component
mounted as a sibling AFTER `<NativeTabs>` inside a `flex-1` View (inside every
provider it needs — it mints chats). Pill tap → `show()`; tabs layout hides the
accessory; overlay fades a scrim in and reveals the real `<Composer>`.

Hard-won details, each load-bearing:

- **Fade the scrim only, never a parent of the bar.** Liquid glass
  (UIVisualEffectView) inside a superview with animated alpha comes up blank and
  stays blank. The bar itself is shown/hidden with `display: 'none'` on its
  wrapper — no fractional alpha ever sits over the glass. The keyboard's rise is
  the motion; it doesn't need a fade.
- **Keep it MOUNTED while closed** (`display:none` + `pointerEvents='none'`).
  Unmounting would discard the half-typed draft; surviving close/reopen is the
  point of hoisting the bar out of the screens.
- **`restOffset` for the resting position.** The overlay's `bottom: 0` is the
  WINDOW edge (it's outside the tab navigator), so with the keyboard down the
  bar must lift by the tab bar's height to sit where the pill sat. That constant
  slice is 49pt (measured tab inset 83 − window inset 34). It feeds
  `KeyboardStickyView`'s `offset.closed` — **negated**: positive offsets push
  the sticky view DOWN (`offset={{ closed: -restOffset, opened: insets.bottom }}`).
- **Focus by remount, not ref.** On this stack (React 19 + New Arch + Compiler)
  input refs read from effects are null. `focusTick` bumps per `show()`; the
  Composer keys its TextInput on it with `autoFocus` — same trick as the dead
  scroll refs elsewhere.
- **Send mints the chat, not the tap.** Submit = reuse the still-blank active
  chat or `conv.newChat()`, `setPendingDraft(id, {text, attachments})`, `hide()`,
  `router.navigate('/(tabs)/chat/${id}')`. The conversation screen dispatches
  the draft once the shared session repoints (same hand-off the suggestion
  cards use). A tap that never sends creates nothing.
- Busy state stays mini-player: if the agent is streaming, the pill navigates to
  that conversation instead of morphing.

## Dev-loop gotchas

- The accessory and the overlay store do NOT survive Fast Refresh cleanly:
  edits produce stale-closure redboxes (old pill handler calling a re-created
  store — split brain). Fully reload the app after touching these files.
- Deleting a watched file can crash Metro via the nativewind watcher
  (`_onHasteChange … addedFiles`); restart `expo start` if bundling dies.
