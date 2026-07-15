/* eslint-disable react-hooks/immutability, react-hooks/refs, react-hooks/preserve-manual-memoization */
// NOTE (port): this verbatim-ported engine drives expo-video players imperatively
// from a rAF master clock, using refs pinned during render for stable closures and
// a forward-referenced `applyFrame`. The react-hooks compiler rules flag these
// intentional patterns; they are correct here (and run under reactCompiler in the
// source app), so they're disabled for this file only.
// The RN playback engine — the native replacement for the web editor's Remotion
// `<Player>` + `EditorComposition`. Web reference: web-editor/src/core/Composition.jsx
// (/docs/modules/playback). This hook owns a small POOL of `expo-video` players
// and drives them from a single master playhead, preserving the composition
// semantics that matter:
//   • multi-track z-order: the TOPMOST non-disabled video item covers the frame
//     (earlier tracks win) — via `itemAtFrame`
//   • object-fit: contain on black
//   • per-item volume / mute / linear fade in-out / flipH / flipV / disabled
//   • frame-accurate seek + play/pause transport
//
// Why a hook (not a Remotion composition): React Native has no DOM `<video>`
// stacking or Remotion runtime. We keep ONE video surface (swapped via
// `player.replace()` at cut boundaries, CapCut-style) plus a couple of audio
// players for music tracks. The master clock is a `requestAnimationFrame` loop
// on the JS thread; the playhead is ALSO mirrored into a Reanimated shared value
// so the timeline scroll/playhead can track it on the UI thread at 120fps.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVideoPlayer, type VideoPlayer, type VideoSource } from "expo-video";
import { useSharedValue, type SharedValue } from "react-native-reanimated";
import {
  itemAtFrame,
  timelineDuration,
  framesToSec,
  type Timeline,
  type TimelineItem,
} from "@/editor/core/timeline";

const AUDIO_SLOTS = 2; // simultaneous music/audio-track items supported

export interface ActiveVideo {
  player: VideoPlayer;
  item: TimelineItem | null;
}

export interface EditorPlayback {
  /** Master playhead in frames, on the UI thread (drives the timeline). */
  frameSV: SharedValue<number>;
  /** Composition length + fps. */
  durationInFrames: number;
  fps: number;
  playing: boolean;
  /** The single video surface + the item it is currently showing. */
  video: ActiveVideo;
  /** Audio-track (music) players currently assigned to active items. */
  audioPlayers: VideoPlayer[];
  play: () => void;
  pause: () => void;
  toggle: () => void;
  /** Authoritative seek: reconcile players + move the playhead (used by taps,
   *  prev/next-cut, and the scroll gesture's commit). */
  seekTo: (frame: number) => void;
  /** Lightweight preview seek while the user is dragging the timeline (throttled
   *  internally so we don't hammer the native player at 60fps). */
  scrubTo: (frame: number) => void;
}

// Linear fade envelope for an audio item at a given local frame (matches the
// web `AudioItem` volume function).
function fadedVolume(item: TimelineItem, localFrame: number): number {
  let v = item.muted ? 0 : item.volume ?? 1;
  const fi = item.fadeInFrames || 0;
  const fo = item.fadeOutFrames || 0;
  if (fi > 0 && localFrame < fi) v *= Math.max(0, localFrame / fi);
  const tail = item.durationInFrames - localFrame;
  if (fo > 0 && tail < fo) v *= Math.max(0, tail / fo);
  return Math.max(0, Math.min(1, v));
}

export function useEditorPlayback(
  timeline: Timeline | null,
  resolveSource: (src: string) => VideoSource,
): EditorPlayback {
  const { durationInFrames, fps } = timelineDuration(timeline);

  const videoPlayer = useVideoPlayer(null, (p) => {
    p.timeUpdateEventInterval = 0;
    p.muted = false;
  });
  const audioA = useVideoPlayer(null, (p) => {
    p.muted = false;
  });
  const audioB = useVideoPlayer(null, (p) => {
    p.muted = false;
  });
  const audioPlayers = useMemo(() => [audioA, audioB], [audioA, audioB]);

  const frameSV = useSharedValue(0);
  const frameRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);

  // The item id currently loaded into each player, so we only call the (async,
  // expensive) `replace()` when the source actually changes. The `Ref` mirror is
  // read inside `applyFrame` so that hook stays stable across clip switches —
  // otherwise the running rAF play-loop would capture a stale `applyFrame`.
  const [activeVideoItem, setActiveVideoItem] = useState<TimelineItem | null>(null);
  const activeVideoIdRef = useRef<string | null>(null);
  const setActiveVideo = useCallback((it: TimelineItem | null) => {
    activeVideoIdRef.current = it?.id ?? null;
    setActiveVideoItem(it);
  }, []);
  const videoSrcRef = useRef<string | null>(null);
  const audioSrcRef = useRef<(string | null)[]>([null, null]);
  const audioItemRef = useRef<(TimelineItem | null)[]>([null, null]);

  const timelineRef = useRef(timeline);
  useEffect(() => {
    timelineRef.current = timeline;
    // Re-reconcile immediately so edits (add/remove/trim) reflect in the preview.
    applyFrame(frameRef.current, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline]);

  const resolveRef = useRef(resolveSource);
  resolveRef.current = resolveSource;

  // Assign active audio items to the fixed audio-player slots, loading sources
  // and updating volume/fade. Music items only (video's own audio rides the
  // video player).
  const reconcileAudio = useCallback(
    (tl: Timeline | null, frame: number, isPlaying: boolean, seek: boolean) => {
      const active: TimelineItem[] = [];
      for (const t of tl?.tracks || []) {
        if (t.type !== "audio") continue;
        for (const it of t.items) {
          if (it.disabled) continue;
          if (frame >= it.from && frame < it.from + it.durationInFrames) active.push(it);
        }
      }
      for (let i = 0; i < AUDIO_SLOTS; i++) {
        const player = audioPlayers[i];
        const it = active[i] || null;
        if (!it) {
          if (audioSrcRef.current[i] !== null) {
            try {
              player.pause();
            } catch {}
            audioSrcRef.current[i] = null;
            audioItemRef.current[i] = null;
          }
          continue;
        }
        const local = frame - it.from;
        const justLoaded = audioSrcRef.current[i] !== it.src;
        if (justLoaded) {
          try {
            player.replace(resolveRef.current(it.src));
          } catch {}
          audioSrcRef.current[i] = it.src;
          audioItemRef.current[i] = it;
        }
        // Volume/fade tracks every frame (cheap, no re-buffer).
        try {
          player.volume = fadedVolume(it, local);
        } catch {}
        // Hard-seek + transport ONLY on load or an explicit seek — never every
        // tick, so the player streams through instead of being re-seeked.
        if (justLoaded || seek) {
          try {
            player.currentTime = framesToSec(local, fps);
            if (isPlaying) player.play();
            else player.pause();
          } catch {}
        }
      }
    },
    [audioPlayers, fps],
  );

  // The core reconcile: given a frame, make every player show/sound the right
  // thing. `seek` forces a hard currentTime set on the video (used when paused
  // or when jumping); during playback we only correct drift.
  const applyFrame = useCallback(
    (frame: number, seek: boolean) => {
      const f = Math.max(0, Math.min(durationInFrames - 1, frame));
      frameRef.current = f;
      frameSV.value = f;
      const tl = timelineRef.current;
      const isPlaying = playingRef.current;

      const item = itemAtFrame(tl, Math.round(f));
      const local = item ? f - item.from : 0;

      if (!item) {
        if (videoSrcRef.current !== null) {
          try {
            videoPlayer.pause();
          } catch {}
        }
        if (activeVideoIdRef.current !== null) setActiveVideo(null);
      } else {
        const switched = videoSrcRef.current !== item.src;
        if (switched) {
          try {
            videoPlayer.replace(resolveRef.current(item.src));
          } catch {}
          videoSrcRef.current = item.src;
          setActiveVideo(item);
        } else if (activeVideoIdRef.current !== item.id) {
          setActiveVideo(item);
        }
        // Video carries its own audio unless muted / detached (cheap, per-frame).
        try {
          videoPlayer.muted = !!item.muted;
          videoPlayer.volume = item.muted ? 0 : item.volume ?? 1;
        } catch {}
        // Hard-seek + (re)issue transport ONLY when a clip was just loaded or on
        // an explicit seek. During steady playback the tick does neither, so the
        // player streams through freely and IS the clock (see the play() loop).
        if (seek || switched) {
          try {
            videoPlayer.currentTime = framesToSec(local, fps);
            if (isPlaying) videoPlayer.play();
            else videoPlayer.pause();
          } catch {}
        }
      }

      reconcileAudio(tl, f, isPlaying, seek);
    },
    [durationInFrames, fps, frameSV, videoPlayer, reconcileAudio, setActiveVideo],
  );

  // ---- master clock (rAF) --------------------------------------------------
  // When a video clip covers the playhead, the VIDEO ITSELF is the clock (we
  // read its `currentTime`) so the preview and the playhead can never drift
  // apart — exactly what an NLE preview needs. Over gaps / audio-only regions,
  // and briefly while a freshly-loaded clip is still spinning up, we fall back
  // to a wall-clock accumulator so the playhead never stalls.
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef(0);
  const stallRef = useRef(0);

  const stopLoop = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const pause = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    stopLoop();
    try {
      videoPlayer.pause();
    } catch {}
    audioPlayers.forEach((p) => {
      try {
        p.pause();
      } catch {}
    });
  }, [stopLoop, videoPlayer, audioPlayers]);

  const play = useCallback(() => {
    if (playingRef.current) return;
    // Restart from the top if parked at the very end.
    if (frameRef.current >= durationInFrames - 1) applyFrame(0, true);
    playingRef.current = true;
    setPlaying(true);
    lastTsRef.current = 0;
    stallRef.current = 0;
    const tick = (ts: number) => {
      if (!playingRef.current) return;
      if (!lastTsRef.current) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;

      const tl = timelineRef.current;
      const cur = frameRef.current;
      const item = itemAtFrame(tl, Math.round(cur));
      let f: number;
      if (item && videoSrcRef.current === item.src) {
        let vt = 0;
        try {
          vt = videoPlayer.currentTime;
        } catch {}
        if (vt > 0.001) {
          // Video is producing time → it's the clock. Preview + playhead locked.
          stallRef.current = 0;
          f = item.from + vt * fps;
        } else {
          // Freshly loaded / seeked clip not yet playing: hold, but don't stall
          // forever if the clip never starts.
          stallRef.current += dt;
          f = stallRef.current > 1.2 ? cur + dt * fps : cur;
        }
      } else {
        // Gap / audio-only region → wall clock.
        f = cur + dt * fps;
      }

      if (f >= durationInFrames - 1) {
        applyFrame(durationInFrames - 1, false);
        pause();
        return;
      }
      applyFrame(f, false);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [durationInFrames, fps, applyFrame, pause, videoPlayer]);

  const toggle = useCallback(() => {
    if (playingRef.current) pause();
    else play();
  }, [play, pause]);

  const seekTo = useCallback(
    (frame: number) => {
      applyFrame(frame, true);
    },
    [applyFrame],
  );

  // Throttled preview seek during a scrub drag.
  const lastScrubRef = useRef(0);
  const scrubTo = useCallback(
    (frame: number) => {
      const f = Math.max(0, Math.min(durationInFrames - 1, frame));
      frameRef.current = f;
      frameSV.value = f;
      const now = Date.now();
      if (now - lastScrubRef.current < 60) return; // ~16fps preview updates
      lastScrubRef.current = now;
      applyFrame(f, true);
    },
    [durationInFrames, fps, frameSV, applyFrame],
  );

  useEffect(() => stopLoop, [stopLoop]);

  return {
    frameSV,
    durationInFrames,
    fps,
    playing,
    video: { player: videoPlayer, item: activeVideoItem },
    audioPlayers,
    play,
    pause,
    toggle,
    seekTo,
    scrubTo,
  };
}
