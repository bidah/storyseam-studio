# Edit Studio — React Native editor

The native build of the editor: the same multi-track timeline you can scrub, trim,
move, link, snap, and fade — running on iOS/Android through Expo. It **reuses the
web editor's brain and rewrites only its hands**.

> Full documentation: `/docs/react-native` · web counterpart: `web-editor/src` (`/docs/architecture`)

## Layering

A thin composition root (`Editor.tsx`) owns shared state and wires independent
**modules**, which reach their backend only through the **connector seam**
(`useBackend()`):

```
Editor.tsx                 composition root — state + wiring
core/timeline.ts           the shared timeline model (single source of truth)
core/Composition.tsx       EditorComposition — the native picture surface
                           (video clip / storyboard still / slate)
modules/timeline           editable surface + gestures + pure ops   → README
modules/media              media pool + thumb/peak helpers          → README
modules/playback           the expo-video playback engine           → README
providers/backend          EditorBackend connector seam             → README
```

## What's shared vs reimplemented

Anything that decides *what a cut is* is ported **verbatim** from web and must stay
byte-for-byte compatible; anything that touches the DOM, Remotion, or browser media
APIs is a native rewrite behind the same API.

| Concern | Status |
|---|---|
| `core/timeline.ts` — model + pure helpers | **Shared verbatim** |
| `modules/timeline/ops/*` (gaps, reorder, repack, link, remove, snap, dragClip) | **Shared verbatim** |
| `playback/navigation.ts` (playheadTargets, nextCut, clampFrame) | **Shared verbatim** |
| `timeline/ruler.ts` (tick model, timecode) | **Shared verbatim** (native lane heights) |
| Playback: Remotion `<Player>` → `useEditorPlayback` + `expo-video` pool | **Native rewrite** |
| Timeline gestures: DOM pointer → Reanimated + Gesture Handler | **Native rewrite** |
| Waveform: `<canvas>` → `react-native-svg` | **Native rewrite** |
| Audio peaks: Web Audio → deterministic synthesis (same API) | **Native rewrite** |
| Media pool: left rail → native page-sheet `Modal` | **Native rewrite** |
| Backend seam: `EditorBackend` + `resolveSource()` | Shared contract, one native addition |

Because the model and ops are shared verbatim, a timeline saved by either editor
loads in the other. See `/docs/react-native/architecture` for the full map.
