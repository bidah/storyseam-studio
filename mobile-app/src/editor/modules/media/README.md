# Media module (React Native)

Getting source media into the editor: browsing it, adding it to the timeline, and
rendering thumbnails and waveforms. The web pool is a collapsible left rail with
HTML5 drag-and-drop; on mobile it is a **native iOS page-sheet** with
**tap-to-add** cards.

> Web counterpart: `web-editor/src/modules/media` · docs: `/docs/react-native/media`

## Components

| Export | What it is |
|---|---|
| `MediaPool` | a native page-sheet `Modal` (`presentationStyle="pageSheet"`) with Video + Audio grids and an optional "Import from device" action; tapping a card fires `onAdd` |
| `PoolCard` | one source clip in the grid — tap to add it at the playhead |

`MediaPool` props: `visible, pool ({ video, audio }), onClose, onAdd(item),
onImport?`. `PoolCard` props: `item, onAdd(item)`.

## Helpers (`thumbs.ts`)

| Export | Use |
|---|---|
| `getAudioPeaks(src, count?)` / `useAudioPeaks` | ~400 normalized peak buckets (`Float32Array`) for the waveform |
| `useVideoThumb(uri)` | poster thumbnail via `expo-video-thumbnails` for `file://` / `http(s)` URIs; bundled `require()` sources return `null` |
| `colorForSrc(src)` | deterministic tint (hashed hue) for a clip lacking a real thumbnail |

## The seam

Native has no Web Audio or `<canvas>`, so peaks are **synthesized
deterministically** from a hash of the source id — stable per clip and good enough
to render a recognizable waveform. Crucially it sits behind the **same
`getAudioPeaks` API** as web (same signature, same `Float32Array` shape), so
`Waveform` is interchangeable across platforms and a future native decoder can drop
in without touching callers.
