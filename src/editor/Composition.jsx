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
import { AbsoluteFill, Sequence, Video, Audio, OffthreadVideo, getRemotionEnvironment } from "remotion";

function VideoItem({ item, zIndex }) {
  const Clip = getRemotionEnvironment().isRendering ? OffthreadVideo : Video;
  return (
    <Sequence
      from={item.from}
      durationInFrames={item.durationInFrames}
      name={item.name || item.bundle || "clip"}
      layout="none"
    >
      {/* No black fill here — only the composition's base is black, so an upper
          video channel is transparent in its letterbox areas and the channel
          below shows through. `zIndex` makes the higher timeline row win. */}
      <AbsoluteFill style={{ zIndex }}>
        {/* pauseWhenBuffering: a stalled clip pauses the whole timeline instead
            of the timeline running on and yanking the video back into sync. */}
        <Clip
          src={item.src}
          volume={item.muted ? 0 : item.volume ?? 1}
          pauseWhenBuffering
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
      </AbsoluteFill>
    </Sequence>
  );
}

function AudioItem({ item }) {
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
    <Sequence
      from={item.from}
      durationInFrames={item.durationInFrames}
      name={item.name || "music"}
      layout="none"
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
