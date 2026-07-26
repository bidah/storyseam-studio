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
  isImageItem,
  itemAtFrame,
  timelineDuration,
  framesToSec,
  type Timeline,
  type TimelineItem,
} from "@/editor/core/timeline";

const AUDIO_SLOTS = 2; // simultaneous music/audio-track items supported

/** An audio item that actually has something to load (see `reconcileAudio`). */
type PlayableAudio = TimelineItem & { src: string };
const isPlayableAudio = (it: TimelineItem): it is PlayableAudio => !!it.src;

// What the picture surface is showing, as a comparable key. It includes `src`
// and not just `id` because swapping a still's take (the agent's regenerate
// flow) replaces the src of an item that keeps its id — keying on id alone
// would leave the old picture on screen.
const pictureKey = (it: TimelineItem | null): string | null =>
  it ? `${it.id}:${it.src ?? ""}` : null;

/**
 * What the picture lane is showing at the playhead. `item` may be a video clip
 * (playing through the active slot of `players`) OR an animatic image item — a
 * storyboard still, or a slate with `src: null`. Images never touch the
 * players: expo-video cannot play a JPEG and would take the whole preview down
 * on a null source, so the composition draws them itself and reads `item.kind`.
 *
 * TWO players (A/B double-buffer): while one plays, the NEXT clip is preloaded
 * into the other (source loaded + pre-seeked to its in-point), and the cut is
 * a slot SWAP instead of a `replace()` — replace tears down and rebuilds the
 * native player item, which stalls playback for a few hundred ms at every cut
 * even when the file is already cached. The composition stacks both views and
 * shows `players[activeIndex]`.
 */
export interface ActiveVideo {
  players: VideoPlayer[];
  activeIndex: number;
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

  const pictureA = useVideoPlayer(null, (p) => {
    p.timeUpdateEventInterval = 0;
    p.muted = false;
  });
  const pictureB = useVideoPlayer(null, (p) => {
    p.timeUpdateEventInterval = 0;
    p.muted = false;
  });
  const picturePlayers = useMemo(() => [pictureA, pictureB], [pictureA, pictureB]);
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
  const activeKeyRef = useRef<string | null>(null);
  const setActiveVideo = useCallback((it: TimelineItem | null) => {
    activeKeyRef.current = pictureKey(it);
    setActiveVideoItem(it);
  }, []);
  // A/B slots: which picture player is on screen, what file each slot holds,
  // and which item the standby slot was last pre-seeked for.
  const activeSlotRef = useRef(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const slotSrcRef = useRef<(string | null)[]>([null, null]);
  const preloadKeyRef = useRef<string | null>(null);
  /** In-point (sec) the standby was pre-seeked to; re-issued until it takes. */
  const preloadSeekRef = useRef<number | null>(null);
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
      const active: PlayableAudio[] = [];
      for (const t of tl?.tracks || []) {
        if (t.type !== "audio") continue;
        for (const it of t.items) {
          if (it.disabled) continue;
          // A srcless audio item (detach-audio on a slate produces one) has
          // nothing to load; handing null to the player kills the preview.
          if (!isPlayableAudio(it)) continue;
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
            player.currentTime = framesToSec(local + (it.offsetFrames || 0), fps);
            if (isPlaying) player.play();
            else player.pause();
          } catch {}
        }
      }
    },
    [audioPlayers, fps],
  );

  // Preload the NEXT video clip into the standby slot: load its file and park
  // it pre-seeked at its in-point, so the boundary cut is a slot swap with no
  // replace() stall. Guarded by `preloadKeyRef` so the per-tick call is a
  // couple of comparisons except when the upcoming clip actually changes.
  const preloadNext = useCallback(
    (tl: Timeline | null, frame: number) => {
      // What will the picture lane show AFTER the current cover ends? Anchor
      // on `itemAtFrame` at the current item's out-point — the display rule
      // itself — so the stitched cuts' 1-frame overlaps (next clip starts a
      // frame BEFORE the current one ends) and 1-frame gaps both resolve to
      // the clip that will actually be shown. A naive "next start after the
      // playhead/out-point" scan gets poisoned by those off-by-one edges and
      // preloads the wrong clip, forcing a cold replace() at the cut.
      const cur = itemAtFrame(tl, Math.round(frame));
      let next: TimelineItem | null = null;
      const scanAfter = (start: number) => {
        let best: TimelineItem | null = null;
        for (const t of tl?.tracks || []) {
          if (t.type !== "video") continue;
          for (const it of t.items || []) {
            if (it.disabled || isImageItem(it) || !it.src) continue;
            if (it.from <= start + 0.5) continue;
            if (!best || it.from < best.from) best = it;
          }
        }
        return best;
      };
      if (cur) {
        const end = cur.from + cur.durationInFrames;
        const at = itemAtFrame(tl, Math.round(end));
        next = at && at !== cur ? at : scanAfter(end - 1);
      } else {
        next = scanAfter(frame);
      }
      // The next cover being a still/slate needs no player; srcless is a slate.
      if (!next?.src || isImageItem(next)) return;
      const key = pictureKey(next);
      if (preloadKeyRef.current === key) return;
      // Adjacent items on the SAME file (split halves) play through the active
      // player — nothing to preload, and the standby must not be clobbered.
      if (next.src === slotSrcRef.current[activeSlotRef.current]) {
        preloadKeyRef.current = key;
        return;
      }
      const stb = 1 - activeSlotRef.current;
      const p = picturePlayers[stb];
      const inPoint = framesToSec(next.offsetFrames || 0, fps);
      try {
        if (slotSrcRef.current[stb] !== next.src) {
          p.replace(resolveRef.current(next.src));
          slotSrcRef.current[stb] = next.src;
        }
        p.pause();
        p.currentTime = inPoint;
      } catch {}
      preloadKeyRef.current = key;
      preloadSeekRef.current = inPoint;
    },
    [picturePlayers, fps],
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

      // An image item covers the frame with a still (or a slate) — there is no
      // video to drive, so pause the active player and let the composition draw
      // it. The slot keeps its file loaded: returning to the same clip (a
      // rewind) resumes with a cheap in-file seek instead of a reload. A
      // srcless VIDEO item is malformed rather than expected, but it parks the
      // same way — better a held frame than a player torn down by a null source.
      if (!item || isImageItem(item) || !item.src) {
        try {
          picturePlayers[activeSlotRef.current].pause();
        } catch {}
        if (activeKeyRef.current !== pictureKey(item ?? null)) setActiveVideo(item ?? null);
        // Keep the upcoming clip warm even while parked in a gap or on a still.
        preloadNext(tl, f);
      } else {
        const act = activeSlotRef.current;
        const itemChanged = activeKeyRef.current !== pictureKey(item);
        let slot = act;
        let loaded = false;
        if (slotSrcRef.current[act] !== item.src) {
          if (slotSrcRef.current[1 - act] === item.src) {
            // The standby slot has this file (preloaded, or left over from an
            // earlier pass): SWAP instead of replace — the cut is seamless.
            slot = 1 - act;
            activeSlotRef.current = slot;
            setActiveIndex(slot);
            preloadSeekRef.current = null; // the standby just became active
            try {
              picturePlayers[act].pause();
            } catch {}
          } else {
            // Cold: nothing holds this file — replace() into the active slot.
            try {
              picturePlayers[act].replace(resolveRef.current(item.src));
            } catch {}
            slotSrcRef.current[act] = item.src;
            loaded = true;
          }
        }
        const player = picturePlayers[slot];
        if (itemChanged) setActiveVideo(item);
        // Video carries its own audio unless muted / detached (cheap, per-frame).
        try {
          player.muted = !!item.muted;
          player.volume = item.muted ? 0 : item.volume ?? 1;
        } catch {}
        // Hard-seek + (re)issue transport ONLY when the clip under the playhead
        // changed (new file OR new item on the same file — split halves share a
        // file and need their own in-point) or on an explicit seek. During
        // steady playback the tick does neither, so the player streams through
        // freely and IS the clock (see the play() loop).
        if (seek || itemChanged || loaded) {
          try {
            // Source in-point: a split's right half / head-trimmed clip starts
            // `offsetFrames` into the media (the web <Video trimBefore>).
            const want = framesToSec(local + (item.offsetFrames || 0), fps);
            // A preloaded standby is already parked at (about) this time — skip
            // the redundant hard seek that would force a re-buffer at the cut.
            let at = -1;
            try {
              at = player.currentTime;
            } catch {}
            if (seek || loaded || Math.abs(at - want) > 0.15) player.currentTime = want;
            if (isPlaying) player.play();
            else player.pause();
          } catch {}
        }
        preloadNext(tl, f);
      }

      // Keep the preloaded standby PARKED at its in-point. The pre-seek issued
      // at preload time races the async replace() and can be dropped; an
      // unseeked standby has no decoded frame in its layer, so the swap shows
      // an opaque black view for ~100ms — the split-second black between
      // clips. Re-issuing the seek once the player is ready pre-renders the
      // clip's first frame, making the cut instant.
      if (preloadSeekRef.current != null) {
        const sp = picturePlayers[1 - activeSlotRef.current];
        try {
          if (sp.status === "readyToPlay" && Math.abs(sp.currentTime - preloadSeekRef.current) > 0.2) {
            sp.currentTime = preloadSeekRef.current;
          }
        } catch {}
      }

      reconcileAudio(tl, f, isPlaying, seek);
    },
    [durationInFrames, fps, frameSV, picturePlayers, preloadNext, reconcileAudio, setActiveVideo],
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
  const kickRef = useRef(0);

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
    [...picturePlayers, ...audioPlayers].forEach((p) => {
      try {
        p.pause();
      } catch {}
    });
  }, [stopLoop, picturePlayers, audioPlayers]);

  const play = useCallback(() => {
    if (playingRef.current) return;
    // Restart from the top if parked at the very end.
    if (frameRef.current >= durationInFrames - 1) frameRef.current = 0;
    playingRef.current = true;
    setPlaying(true);
    // Issue transport. applyFrame only presses play/pause on the native players
    // when seeking or switching clips, so an explicit seek at the current
    // playhead is what actually starts the already-loaded video + audio items.
    // (It must run AFTER playingRef flips, so reconcile sees isPlaying=true.)
    applyFrame(frameRef.current, true);
    lastTsRef.current = 0;
    stallRef.current = 0;
    kickRef.current = 0;
    const tick = (ts: number) => {
      if (!playingRef.current) return;
      if (!lastTsRef.current) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;

      const tl = timelineRef.current;
      const cur = frameRef.current;
      const item = itemAtFrame(tl, Math.round(cur));
      let f: number;
      // `!isImageItem` is load-bearing, not belt-and-braces: a slate's src is
      // null and the parked player's is too, so a bare src comparison would
      // match and make a paused player the clock — the playhead would freeze on
      // every slate.
      if (item && !isImageItem(item) && slotSrcRef.current[activeSlotRef.current] === item.src) {
        const activePlayer = picturePlayers[activeSlotRef.current];
        let vt = 0;
        let running = false;
        try {
          vt = activePlayer.currentTime;
          running = activePlayer.playing;
        } catch {}
        const inPoint = framesToSec(item.offsetFrames || 0, fps);
        if (vt > 0.001 && running) {
          // Video is producing time → it's the clock. Preview + playhead locked.
          // vt is SOURCE time, so back out the item's in-point. MONOTONIC: a
          // freshly-swapped clip reports vt≈0 for a tick, which would compute f
          // a hair BEHIND the boundary — and in the stitched cuts' 1-frame
          // overlaps that flips the shown item back to the previous clip
          // (z-order) and churns a cold reload. During playback the playhead
          // only ever moves forward; the clock catches up within a tick.
          stallRef.current = 0;
          kickRef.current = 0;
          f = Math.max(cur, item.from + vt * fps - (item.offsetFrames || 0));
        } else if (!running && vt > inPoint + 0.3) {
          // The player stopped ON ITS OWN well past the in-point: the file ran
          // out before the item's out-point (real encodes are routinely a hair
          // shorter than the model's durationInFrames). Without this branch the
          // frozen currentTime stays "the clock" and the playhead pins just
          // before the boundary forever — playback dies at the first gap. Fall
          // back to the wall clock so the playhead walks across the boundary.
          f = cur + dt * fps;
        } else {
          // Not producing time near its start: still spinning up — or the
          // play() issued right after replace() was swallowed by the async
          // load (observed on-device: vt pinned at ~0, playing=false forever).
          // Re-kick the transport every ~0.5s; hold the playhead briefly, then
          // creep on the wall clock so a dead file can't freeze the timeline.
          stallRef.current += dt;
          if (!running && stallRef.current - kickRef.current > 0.5) {
            kickRef.current = stallRef.current;
            try {
              activePlayer.currentTime = framesToSec(cur - item.from + (item.offsetFrames || 0), fps);
              activePlayer.play();
            } catch {}
          }
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
  }, [durationInFrames, fps, applyFrame, pause, picturePlayers]);

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
    video: { players: picturePlayers, activeIndex, item: activeVideoItem },
    audioPlayers,
    play,
    pause,
    toggle,
    seekTo,
    scrubTo,
  };
}
