# Playback module (React Native)

The native replacement for the Remotion `<Player>`. React Native has no DOM
`<video>` stacking and no Remotion runtime, so playback is a **hook that owns a
small pool of `expo-video` players** driven by one master playhead. The pure
frame-navigation math is ported **verbatim** from web.

> Web counterpart: `web-editor/src/modules/playback` + `web-editor/src/core/Composition.jsx`
> · docs: `/docs/react-native/playback`

## Exports

| Export | Use |
|---|---|
| `useEditorPlayback(timeline, resolveSource)` | owns the players, the master rAF clock, and the transport; returns `EditorPlayback` |
| `playheadTargets(timeline)` | snap targets: 0 + every clip edge (**verbatim** from web) |
| `nextCut(timeline, frame, dir)` | next/previous cut boundary (**verbatim** from web) |
| `clampFrame(frame, durationInFrames)` | clamp into the playable range (**verbatim** from web) |

`EditorComposition` (the preview surface — letterboxed on black, applying
`flipH` / `flipV` on the active clip) lives in `@/editor/core/Composition` and
consumes `playback.video`. It has three states, because the picture lane carries
videos and animatic stills as peers (`item.kind`, see `core/timeline.ts`): an
`expo-video` `VideoView` for a video clip, an `expo-image` `Image` for a
storyboard still, and a labelled placeholder for a **slate** (`src: null` — a
shot with no still yet). Images never reach the video player: `useEditorPlayback`
parks it over image spans and falls back to the wall clock, so a JPEG or a null
source can never take the preview down.

## `EditorPlayback` return

`frameSV` (Reanimated `SharedValue<number>` playhead), `durationInFrames`, `fps`,
`playing`, `video` (`{ player, item }`), `audioPlayers`, `play()`, `pause()`,
`toggle()`, `seekTo(frame)`, `scrubTo(frame)`.

## The seam

A `requestAnimationFrame` loop accumulates wall-clock time into a frame counter and
mirrors it into `frameSV`, so the timeline scroll/playhead track it on the UI
thread. The topmost non-disabled video item is chosen with `itemAtFrame`; the video
player only calls the async `replace()` when the source changes (CapCut-style),
then seeks within it. Per-item volume / mute / linear fade / flip / disabled match
the web composition. Playback is **drift-corrected** (re-seek only past ~0.28s) and
**hard-seeks** when paused or scrubbing.
