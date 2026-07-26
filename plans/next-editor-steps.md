# Mobile editor — next steps (playback polish)

Where the mobile editor playback work stands after the A/B double-buffer
landed (`243ec5c`, 2026-07-26), what is still open, and how to pick each item
back up. Engine background: `mobile-app/src/editor/modules/playback/useEditorPlayback.ts`
(A/B slots, preload, monotonic tick clock) and `core/Composition.tsx` (two
stacked always-mounted `VideoView`s, opacity flip on `activeIndex`).

## Current state

Cuts between clips play continuously — every boundary is a slot **swap** of a
preloaded player, not a `replace()`. Verified on-sim with per-tick telemetry
across five consecutive cut-v9 boundaries, including a 1-frame-overlap edge.
Two known issues remain, one cosmetic and one structural.

## Issue 1 — residual split-second black at some cuts (cosmetic)

**Symptom:** a sub-100ms black blink at some boundaries, even though playback
timing is continuous.

**Cause:** the swapped-in `VideoView` is opaque black until its first frame is
decoded and rendered. We already pre-seek the standby to its in-point and
re-park it once `status === "readyToPlay"` (so its layer usually has a frame
pre-rendered), but "readyToPlay + parked at the right time" does not guarantee
"frame actually rendered into the layer" — when it hasn't landed yet, the
opacity flip exposes an empty (black) surface for the first-frame latency.

**Proposed fix (pick one, in order of preference):**

1. **Hold-last-frame swap.** Delay the `setActiveIndex` flip by ~120–150ms
   after the model-level swap (transport starts immediately on the new player;
   only the *visible* flip waits). The viewer sees the outgoing clip's last
   frame held for a beat instead of black — standard NLE preview behavior.
   Implementation: in `applyFrame`'s swap branch, stash the pending index in a
   ref and flip it via `setTimeout` (guard against pause/seek/another swap in
   between with a token). Small, contained, no new native API.
2. **Gate the flip on evidence of rendering.** Flip when the new player's
   `currentTime` first advances past its in-point (poll in the tick — we
   already read it) — that's proof frames are decoding. Fallback timeout
   ~200ms so a stall can't hold the old picture forever.
3. **`SurfaceView`/poster tricks** (e.g. rendering an `expo-image` poster of
   the next clip's first frame over the swap) — only if 1–2 prove
   insufficient; requires generating/storing first-frame thumbs per clip
   (`/thumb/` pipeline could serve this).

Also worth doing while in there: the same first-frame issue exists on **cold
seeks** (scrub into an unloaded clip) — expected there, but option 2's
"currentTime advanced" signal could drive a small loading shimmer instead of
black.

## Issue 2 — media caching is incompatible with `/proxy/*` (structural)

**Finding (verified on-sim, 2026-07-26):** expo-video's built-in
`useCaching: true` — and any download-style cache (react-native-video
`bufferConfig` cache, `expo-video-cache`) — fails against our preview URLs.
The `expo-video-cache://` layer needs HTTP Range + Content-Length; the
worker's `/proxy/<prefix>/<file>` route streams (R2 `streamKey`, or the
original with a lazy-proxy kickoff on cold hits), and AVFoundation errors with
"Operation Stopped / This media may be damaged" — the preview goes black.
There's a warning comment at the `resolveSource` seam in
`mobile-app/src/editor/providers/backend/cuts.ts`.

**Why we still might want it:** the double-buffer removed the cut stall, but
every rewind/re-pass still re-streams from the Worker (data usage, cold-start
latency on cellular, no offline scrubbing).

**Proposed path:**

1. **Confirm what `/proxy/` actually returns once the proxy object exists.**
   The lazy 720p proxy IS a static R2 object; `streamKey` already handles
   Range (`worker/src/index.js` `/proxy/:prefix/*`). Curl a warm proxy URL
   with `-H "Range: bytes=0-1"` and check for `206` + `Content-Length` +
   `Accept-Ranges`. If warm proxies are already range-able, `useCaching` may
   only break on **cold** hits (the streamed-original fallback with
   `x-proxy: fallback`).
2. If so, split the behavior: an endpoint or header that lets the client ask
   "is the proxy warm?" (or just HEAD the proxy), and set `useCaching: true`
   only for warm proxy sources. Cold sources stream uncached exactly as today
   and flip to cached on the next load.
3. Alternatively (server-side, simplest client): make cold `/proxy/` hits
   **redirect or wait** for proxy generation instead of streaming the
   original, so the URL is always a static range-able object. Trade-off:
   first-play latency for fresh gens (the current "always bytes on first hit"
   guarantee exists on purpose — see the route comment).
4. Re-test the exact failure matrix on-sim before shipping: warm proxy +
   `useCaching`, cold fallback + `useCaching`, and cache-hit offline replay.

**Explicitly rejected:** switching engines to react-native-video for its
cache — same Range requirement, big port, and the stall it was meant to fix
is already solved by the double-buffer.

## Smaller follow-ups

- **Audio boundaries** still use the single-`replace()` path per slot
  (`reconcileAudio`) — music cues can hiccup at their own boundaries. The
  video A/B pattern (preload next audio item into the free slot) ports
  directly if it becomes audible in practice.
- **1-frame gaps/overlaps in stitched cut data** (`v9` has gaps at 2198,
  9417, 10650 and 1-frame overlaps like MS-04/MS-05): the engine now handles
  both, but each 1-frame gap still legitimately renders ~40ms of black. A
  data-side `closeGapsAll` / repack on cut import (worker `buildTimelineFromCut`)
  would eliminate the source.
- **Debug telemetry:** the `[pb]` console.log lines used to diagnose this
  were removed. If a playback bug resurfaces, re-add per-tick logging behind
  a `const PB_DEBUG = false` flag (they made the wedge + overlap flip-flop
  diagnosable in minutes).

## How to test when picking this up

Recipe in memory (`simulator-agent-testing`): dev client on the booted sim +
Metro (`npx expo start`), deep-link `mobileapp://editor`; drive touches with
`axe` (`brew install cameroncooke/axe/axe`) — `axe swipe --pre-delay 0.6` for
hold-then-drag, plain `axe touch` for taps; seed exact timeline states via
`POST /api/timeline` **without** `clientId` (the open editor live-syncs it),
and restore with `POST /api/timeline/from-cut {"v":9}`. Boundary smoothness is
best judged from per-tick telemetry (see above) rather than screenshots.
