// The Remotion composition that renders a timeline. Driven by <Player> in the
// Editor tab; also renderable headlessly. It is a pure function of `tracks`
// (passed as inputProps) — every timeline edit re-renders the preview live.
//
// Video-type track items become full-frame <Video> clips (object-fit: contain
// on black). Audio-type items become <Audio> beds mixed under everything.

import React from "react";
// Native <Video>/<Audio> (HTML media elements) — smoother realtime playback and
// audio in the <Player> preview than the WebCodecs-based @remotion/media path,
// which stutters/repeats audio while buffering during scrubbing. (These are
// marked deprecated in v4 but remain the right choice for a realtime editor.)
// For the headless render (/api/render) we swap to <OffthreadVideo>, which is
// frame-accurate and doesn't rely on realtime <video> playback.
import { AbsoluteFill, Sequence, Video, Audio, OffthreadVideo, getRemotionEnvironment, useVideoConfig } from "remotion";

// How far ahead of the playhead a clip is mounted (invisible + muted) so its
// <video> element can fetch + decode BEFORE it's on screen. Without this, each
// Sequence mounts its media cold the instant the playhead arrives, so every
// clip transition stalls for a beat while the browser loads it. 2s of lead is
// enough for R2-hosted clips to buffer their first frames over the network.
// (Remotion ignores premountFor during the headless render, which is frame-
// accurate and doesn't need it — so we always pass it and let it no-op there.)
const PREMOUNT_SECONDS = 2;

function VideoItem({ item, zIndex }) {
  const { fps } = useVideoConfig();
  const Clip = getRemotionEnvironment().isRendering ? OffthreadVideo : Video;
  return (
    // No layout="none": premountFor REQUIRES the Sequence's own absolute-fill
    // wrapper — that's the element Remotion fades to opacity:0 while the clip
    // preloads. The wrapper is transparent (only the composition base is black),
    // so an upper channel still lets the row below show through its letterbox;
    // `zIndex` on it makes the higher timeline row win.
    <Sequence
      from={item.from}
      durationInFrames={item.durationInFrames}
      premountFor={Math.round(fps * PREMOUNT_SECONDS)}
      name={item.name || item.bundle || "clip"}
      style={{ zIndex }}
    >
      {/* pauseWhenBuffering: a stalled clip pauses the whole timeline instead
          of the timeline running on and yanking the video back into sync. */}
      <Clip
        src={item.src}
        volume={item.muted ? 0 : item.volume ?? 1}
        pauseWhenBuffering
        style={{ width: "100%", height: "100%", objectFit: "contain" }}
      />
    </Sequence>
  );
}

function AudioItem({ item }) {
  const { fps } = useVideoConfig();
  const base = item.muted ? 0 : item.volume ?? 1;
  const dur = item.durationInFrames;
  // Fades never overlap: cap each at the clip length, fade-out yields to fade-in.
  const fadeIn = Math.max(0, Math.min(item.fadeInFrames || 0, dur));
  const fadeOut = Math.max(0, Math.min(item.fadeOutFrames || 0, dur - fadeIn));
  const volume =
    fadeIn || fadeOut
      ? (f) => {
          let v = base;
          if (fadeIn > 0 && f < fadeIn) v *= f / fadeIn;
          if (fadeOut > 0 && f > dur - fadeOut) v *= Math.max(0, (dur - f) / fadeOut);
          return v;
        }
      : base;
  return (
    // Same as VideoItem: premountFor needs the wrapper, so no layout="none".
    // <Audio> renders nothing visual, so the absolute-fill wrapper is inert.
    <Sequence
      from={item.from}
      durationInFrames={item.durationInFrames}
      premountFor={Math.round(fps * PREMOUNT_SECONDS)}
      name={item.name || "music"}
    >
      <Audio src={item.src} volume={volume} pauseWhenBuffering />
    </Sequence>
  );
}

export function EditorComposition({ tracks = [] }) {
  // The timeline rows are drawn top-to-bottom (tracks[0] on top). A higher row
  // must PLAY on top, so give earlier tracks a higher zIndex (last row = 1).
  const n = tracks.length;
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {tracks.map((track, ti) =>
        (track.items || [])
          .filter((item) => !item.disabled) // disabled clips are skipped in playback
          .map((item) =>
            track.type === "audio" ? (
              <AudioItem key={item.id} item={item} />
            ) : (
              <VideoItem key={item.id} item={item} zIndex={n - ti} />
            )
          )
      )}
    </AbsoluteFill>
  );
}

export default EditorComposition;
