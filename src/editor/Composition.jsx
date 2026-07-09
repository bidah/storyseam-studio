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
import { AbsoluteFill, Sequence, Video, Audio } from "remotion";

function VideoItem({ item }) {
  return (
    <Sequence
      from={item.from}
      durationInFrames={item.durationInFrames}
      name={item.name || item.bundle || "clip"}
      layout="none"
    >
      <AbsoluteFill style={{ backgroundColor: "black" }}>
        <Video
          src={item.src}
          volume={item.muted ? 0 : item.volume ?? 1}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
      </AbsoluteFill>
    </Sequence>
  );
}

function AudioItem({ item }) {
  return (
    <Sequence
      from={item.from}
      durationInFrames={item.durationInFrames}
      name={item.name || "music"}
      layout="none"
    >
      <Audio src={item.src} volume={item.muted ? 0 : item.volume ?? 1} />
    </Sequence>
  );
}

export function EditorComposition({ tracks = [] }) {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {tracks.map((track) =>
        (track.items || [])
          .filter((item) => !item.disabled) // disabled clips are skipped in playback
          .map((item) =>
            track.type === "audio" ? (
              <AudioItem key={item.id} item={item} />
            ) : (
              <VideoItem key={item.id} item={item} />
            )
          )
      )}
    </AbsoluteFill>
  );
}

export default EditorComposition;
