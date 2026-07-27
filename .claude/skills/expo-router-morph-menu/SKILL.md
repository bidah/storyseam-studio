---
name: expo-router-morph-menu
description: Make an Expo Router native header MORPH across a push — the back chevron appearing beside (not instead of) an existing left menu item, and a right-side action set gaining or losing buttons, animated by UIKit. Use when the user asks for a "header morph", "native header animation", "back button next to the menu", "the header should change when I open a chat/item", "nested stack navigator so the pushed screen has different header options", or when a screen is toggling its own header items with state and should be two routes instead. Covers the `headerBackVisible` → `leftItemsSupplementBackButton` mechanism, `Stack.Toolbar` vs `unstable_header*Items`, and the state plumbing splitting one screen into two requires.
---

# Native header morph across a push (Expo Router · iOS)

Scope: `mobile-app/` (Expo SDK 57 · RN 0.86 · expo-router 57 ·
react-native-screens 4.25 · iOS 26). Read `mobile-app/AGENTS.md` first — Expo has
changed, and the versioned docs at https://docs.expo.dev/versions/v57.0.0/ are
authoritative. Canonical implementation: `src/app/(tabs)/chat/` (commit
"feat(mobile/chat): push a conversation so the native header morphs").

## The one idea

**A morphing header is not an animation you write. It's two routes.**

UIKit already animates its navigation bar between two screens' configurations
during a push — items shared by both keep their (iOS 26 glass) capsule and
slide, items only one screen declares fade in or out, and a large title collapses
into the compact one. You get all of that by *pushing a second screen that
declares a different header*, and none of it by toggling `headerRight` with
`useState` on a single screen.

So when someone asks for a morphing header, the real work is almost never the
header. It's splitting one stateful screen into a **home** route and a **detail**
route, and re-plumbing whatever state that screen was holding.

## The left side: back button *beside* the menu, not instead of it

This is the part that looks impossible and isn't. By default, iOS left bar button
items and the back button are mutually exclusive — set left items and the chevron
disappears.

Set **`headerBackVisible: true`** on the pushed screen. The chain:

```
headerBackVisible: true
  → expo-router  useHeaderConfigProps.js  `backButtonInCustomView`
  → RNScreens    RNSScreenStackHeaderConfig.mm
                 navitem.leftItemsSupplementBackButton = YES
```

which is the UIKit flag for "keep the system back chevron *and* my left items".
Result: chevron takes the corner, the existing menu item slides right of it, and
because the menu is declared on both screens UIKit carries it across the
transition rather than rebuilding it.

Always pair it with **`headerBackButtonDisplayMode: 'minimal'`** or the chevron
drags the previous screen's title along ("‹ Chat") and eats the bar.

```tsx
<Stack.Screen
  name="[id]"
  options={{
    headerBackVisible: true,
    headerBackButtonDisplayMode: 'minimal',
    unstable_headerLeftItems: () => [menuItem],   // same item object as the home screen
  }}
/>
```

**Android/web have no equivalent** — there, `headerLeft` *replaces* the back
button. Declare `headerLeft` only on the home screen and let the pushed screen's
back button have the corner to itself.

## The right side: declare per screen, don't swap in place

Home returns `[history]`; the pushed screen returns `[history, newChat]`. Shared
item first, new item appended. iOS renders right items in reverse; expo-router
already reverses the array for you, so index 0 is leftmost.

Two equivalent APIs — they compile to the same thing
(`processHeaderItemsForPlatform.ios.js` turns toolbar children into
`unstable_headerRightItems`):

```tsx
// Declarative, from inside a screen body:
<Stack.Toolbar placement="right">
  <Stack.Toolbar.Button icon="clock.arrow.circlepath" onPress={openHistory} />
  <Stack.Toolbar.Button icon="square.and.pencil" onPress={goNewChat} />
</Stack.Toolbar>

// Options object, from a layout:
unstable_headerRightItems: () => [
  { type: 'button', label: '', icon: { type: 'sfSymbol', name: 'clock.arrow.circlepath' },
    accessibilityLabel: 'Chat history', onPress: openHistory },
  ...
]
```

Prefer `Stack.Toolbar` when the items depend on the screen's own live state;
prefer the options object in the layout otherwise — see the next rule, which is
the one people get wrong.

## Declare the header in the LAYOUT, not from inside the screen

`<Stack.Screen options={…}>` rendered inside a screen body reaches the native bar
via `navigation.setOptions`, which lands *during* the push. UIKit has already
started the transition with the old configuration, so the header snaps a frame in
instead of morphing.

Put everything static in the layout's `<Stack.Screen name="…" options={…}>` so
both configurations exist before the transition starts. Leave only genuinely
dynamic values (a title derived from loaded data) to the screen.

This usually costs nothing, because the handlers turn out to be static:
`openHistory = () => router.push(…)`, `goNewChat = () => router.dismissTo(home)`.

```tsx
export default function ChatLayout() {
  const menuItem = useMenuItem();
  const homeItems = useChatHeaderItems({ onHistoryPress: openHistory });
  const chatItems = useChatHeaderItems({ onHistoryPress: openHistory, onNewChat: goNewChat });
  return (
    <Stack screenOptions={{ ...headerBase, title: 'Chat', /* glass options */ }}>
      <Stack.Screen name="index" options={{
        headerLargeTitle: true,
        unstable_headerLeftItems: () => [menuItem],
        headerLeft: () => <MenuButton />,               // Android/web only
        unstable_headerRightItems: () => homeItems,
      }} />
      <Stack.Screen name="[id]" options={{
        headerLargeTitle: false,
        headerBackVisible: true,
        headerBackButtonDisplayMode: 'minimal',
        unstable_headerLeftItems: () => [menuItem],
        unstable_headerRightItems: () => chatItems,
      }} />
    </Stack>
  );
}
```

The large→compact title change is free and is most of what sells the morph: give
the home screen `headerLargeTitle: true` (its ScrollView needs
`contentInsetAdjustmentBehavior="automatic"`) and the pushed screen a compact
title.

## Then do the hard part: splitting the screen

The header is ~40 lines. The rest is un-picking the state the single screen held.
Checklist, in the order it bites:

1. **The route becomes the source of truth for identity.** The detail screen calls
   whatever "make this the active one" function the store has, on mount. Keep the
   store — just let the route drive it.

2. **A shared singleton session lags the route by a render.** In this codebase
   `useAgent()` is one flue session bound to the active chat; the provider
   remounts its runner on the new id *after* the store updates. So publish the
   id the session is bound to (`agent.chatId`) and have the detail screen check
   `agent.chatId === routeId` before rendering its data or acting on it —
   otherwise the first frame shows the *previous* item's content. Render a local
   cache/cover meanwhile so the swap is invisible.

3. **The home screen usually can't perform the action it starts.** Sending the
   first message from the landing screen would post it into the previous
   conversation, for exactly the reason above. Pattern: home mints the entity,
   parks the payload in a module-level map, and navigates; the detail screen
   read-and-clears it once its own session is live
   (`src/lib/agent/pending-draft.ts`). A module map, not a route param — payloads
   carry local file URIs that shouldn't be serialized through a URL.

4. **Creator functions must return the new id** — the caller needs it to
   navigate. Build the entity *outside* the state updater so the id survives a
   double-invoked updater (StrictMode) and can be read synchronously.

5. **Reuse a still-blank entity instead of minting beside it**, or the list fills
   with identical placeholder rows (every project already gets one blank chat).
   That's what `useIsFreshChat` is for now.

6. **Deep-link / stale-route guards.** If the entity leaves the current scope
   (project switch, deletion), the detail route points at nothing —
   `router.dismissTo(home)`. Gate it on `useFocusEffect`, not `useEffect`: a
   formSheet presented over the screen holds focus, so deleting from a history
   sheet would otherwise yank the sheet closed mid-gesture.

7. **Sheets and other entry points navigate now.** A history/list sheet should
   `router.dismissTo(home)` then push the detail route (push in a
   `requestAnimationFrame` — a native sheet dismissal in the same tick can
   swallow it). Unwinding to home first is what stops "pick a chat from inside a
   chat" stacking conversations behind you.

8. **Disabled-because-blank states die.** If home *is* the blank state, "New"
   from the detail screen is just `router.dismissTo(home)` and the control simply
   doesn't exist on home. A route beats a greyed-out button.

9. **Other callers that jumped to the tab now need the item's route.**
   `useSendToAgent()` went from `/(tabs)/chat` to `/(tabs)/chat/${activeId}` —
   grep for every navigation to the old single screen.

## Route-tree gotchas

- A static sibling beats a dynamic one: `chat/history/` and `chat/[id].tsx`
  coexist, and `/chat/history` resolves to the sheet, not `id: "history"`.
- Typed routes are on (`app.json` → `experiments.typedRoutes`). The generated
  `.expo/types/router.d.ts` picks the new dynamic route up; `npx tsc --noEmit`
  is the check.
- Both screens stay mounted (home sits under the push), so any docked/floating
  component — a composer, a player — exists twice. Fine in practice (RNScreens
  detaches the covered screen's views), but don't put a singleton side effect in
  one.

## Verifying

- `npx tsc --noEmit -p .` — catches the typed-route href and option names.
- `npx expo export --platform ios --output-dir <scratch>` — a real Metro bundle;
  catches import/resolution breakage without a device.
- `npx eslint <changed paths>` — compare against the pre-change file
  (`git show HEAD:<path> > tmp.tsx`) so you don't get blamed for the
  `react-hooks/refs` and `set-state-in-effect` errors that were already there.
- The morph itself is UIKit's standard bar transition — it can only really be
  judged on device/simulator. Don't promise a specific interpolation.

## Read the source, not the docs

Every claim above was verified in `node_modules`, and that's the fastest way to
settle the next question too:

- `expo-router/build/react-navigation/native-stack/types.d.ts` — every header
  option with its doc comment.
- `expo-router/build/react-navigation/native-stack/views/useHeaderConfigProps.js`
  — how options become RNScreens config (`backButtonInCustomView`,
  `hideBackButton`, the right-items reversal).
- `expo-router/build/layouts/stack-utils/toolbar/processHeaderItemsForPlatform.ios.js`
  — proof that `Stack.Toolbar` is just `unstable_header*Items`.
- `react-native-screens/ios/RNSScreenStackHeaderConfig.mm` — the actual UIKit
  calls (`leftItemsSupplementBackButton`, `leftBarButtonItems`).
