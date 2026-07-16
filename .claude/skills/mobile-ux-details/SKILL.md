---
name: mobile-ux-details
description: Make Expo mobile-app UI feel native rather than like a web app in a shell — chiefly header controls that must be real iOS bar button items instead of React pills nested inside the navigation bar's own glass capsule (the "double button" look). Use when building or reviewing mobile-app/ chrome — headers, header actions, project/model switchers, toolbars — or when the user says a control "looks like a button inside a button", "doesn't look native", "the glass looks wrong", or asks to move a control out of a crowded header.
---

# Mobile UX details

Scope: `mobile-app/` (Expo SDK 57 · RN 0.86 · expo-router · react-native-screens
4.25 · iOS 26 target). Read `mobile-app/AGENTS.md` first — Expo has changed, and
the versioned docs at https://docs.expo.dev/versions/v57.0.0/ are authoritative.

The theme: **when the platform already draws the chrome, don't draw your own.**

## The double-button problem

On iOS 26 the navigation bar renders its header items inside its own liquid-glass
capsule. A React `<Pressable className="rounded-full bg-secondary px-3 py-1.5">`
passed to `headerLeft` / `headerRight` therefore ships a *second* pill inside the
system's pill — a dark blob sitting in a glass blob. It reads as broken UI, and
no amount of restyling the inner pill fixes it, because the outer capsule is
UIKit's and isn't going away.

The fix is not "remove the background from the React view". It is to stop
rendering a React view in the bar at all: describe the control as a **native
`UIBarButtonItem`** and let the bar be the button.

## How to do it

expo-router's native stack exposes the react-native-screens bar-button API as
`unstable_headerLeftItems` / `unstable_headerRightItems`. Both take a function
returning `NativeStackHeaderItem[]`, are **iOS-only**, and **override**
`headerLeft` / `headerRight` there — so keep the `<Pressable>` versions as the
Android/web fallback and let iOS take the native path.

```tsx
import type {
  NativeStackHeaderItem,
} from 'expo-router/build/react-navigation/native-stack/types';

<Stack.Screen
  options={{
    unstable_headerRightItems: () => items, // iOS: real UIBarButtonItems
    headerRight: () => <ActionsRow />,      // Android/web fallback
  }}
/>
```

Item shapes worth knowing (full types in
`node_modules/expo-router/build/react-navigation/native-stack/types.d.ts`):

- `{ type: 'button', label, icon, onPress }` — `label: ''` + `accessibilityLabel`
  for an icon-only button. `label` maps to the item's title; an empty title with
  an icon renders icon-only.
- `{ type: 'menu', label, menu: { items: [...] } }` — a native context menu.
- `{ type: 'spacing', spacing: 8 }` — on iOS 26 this **splits the shared glass
  capsule**, which is how you make one item read as its own control instead of
  another icon in the group. (`width`-based sizing only applies pre-iOS 26.)
- `{ type: 'custom', element }` — escape hatch for a React view; it opts out of
  overflow collapsing, so reach for it last.

Rules that fall out of the API:

- **Icons are SF Symbols**, not lucide (`icon: { type: 'sfSymbol', name: 'arrow.clockwise' }`).
  A native item can't host a React icon. Pick the symbol that matches the action's
  iOS convention, not the lucide glyph's name: `gearshape` for settings,
  `clock.arrow.circlepath` for history, `square.and.pencil` for compose.
- **Icons lead, always.** A bar button item paints its image before its title, so
  a trailing chevron is impossible. For a picker-style control, either drop the
  chevron (the glass capsule is the affordance) or make it a real `type: 'menu'`.
- **State can't be a child view.** A status dot inside the item is not expressible.
  Map state onto `tintColor`, `badge`, or move the control somewhere it can be a
  React view (see below).
- Accessibility survives: items expose `accessibilityLabel` to the a11y tree, so
  `agent-device snapshot -i` still finds them by name.

## Building the items

`unstable_header*Items` callbacks run **outside a component**, so they cannot call
hooks. Any item that reads state must have that state closed over from a
component. Make the options a **hook**, not a plain function, and call it from the
layout/screen:

```tsx
export function useTabHeaderOptions(title: string): NativeStackNavigationOptions {
  const projectItem = useProjectSwitcherItem();  // hooks live here…
  const actionItems = useTabActionItems();
  return {
    ...HEADER_BASE,
    title,
    unstable_headerLeftItems: () => [projectItem], // …not in here
    unstable_headerRightItems: () => actionItems,
    headerLeft: () => <ProjectSwitcherButton />,
    headerRight: () => <TabHeaderActions />,
  };
}
```

In this repo that lives in `mobile-app/src/components/header-buttons.tsx`
(shared switcher + refresh/settings) and `src/components/chat/chat-header.tsx`
(per-screen chat actions).

## Budget the bar

The navigation bar is not a toolbar. Left items + title + right items compete for
one row: with a long project name and three right items, iOS silently shrank the
title to `C…`. When the bar is crowded, in order of preference:

1. **Move the control to where it belongs.** A chat model selector belongs on the
   composer next to the attach button — it's per-message context, it can be a
   React pill with a dot and a chevron, and the header gets its title back.
2. **Drop redundant chrome.** A tab's title is already on the tab bar.
3. Let iOS collapse extras into its overflow menu (automatic for non-`custom`
   right items that don't fit).

Don't fix a crowded bar by shrinking labels until they fit.

## Verify on iOS 26 — screenshots, not reasoning

This is a *look* problem; typecheck proves nothing. Run it and look:

```bash
xcrun simctl list devices booted                       # need an iOS 26 sim
npx expo start                                         # dev client build; no rebuild needed
xcrun simctl openurl booted "mobileapp://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
agent-device open com.bidah.shot-studio-mobile --platform ios --udid <udid>
agent-device snapshot -i                               # press by @ref; raw coords miss the bar
agent-device screenshot shot.png
```

Notes from doing this:

- The bar-button API is JS-level config over the already-built react-native-screens
  binary — **no native rebuild**, Metro reload is enough.
- Metro can die on a NativeWind file-watch bug (`Cannot read properties of
  undefined (reading 'addedFiles')`). Restart `npx expo start` and reload; it is
  not your change.
- Check every tab, not just the one you edited — the title squeeze only showed up
  on the tab with the most items.
