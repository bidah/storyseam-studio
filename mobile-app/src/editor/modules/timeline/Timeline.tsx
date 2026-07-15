/* eslint-disable react-hooks/immutability */
// NOTE (port): the flagged lines mutate Reanimated shared values (`pxSV.value`,
// scroll offsets) inside worklets — by design. eslint-plugin-react-hooks' new
// immutability rule doesn't model worklets and false-positives here, so it's
// disabled for this file only.
// Timeline — the editable track surface. React Native port of the timeline half
// of web-editor/src/Editor.jsx + ruler. The interaction model follows mobile
// NLEs (CapCut / TikTok): a FIXED center playhead with the filmstrip scrolling
// under it (scrub = horizontal scroll), pinch to zoom (pxPerSec). The
// scroll⇄playhead sync and pinch run on the UI thread via Reanimated so
// scrubbing stays at display refresh rate.
// Web reference: /docs/modules/timeline ↔ this: /docs/react-native/timeline
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { LayoutChangeEvent, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import { framesToSec, timelineDuration, type Timeline as TL } from "@/editor/core/timeline";
import { EditorTheme } from "@/editor/theme";
import { LANE_H, formatTimecode, pickTickStep } from "./ruler";
import { TimelineItem, type DragPhase } from "./TimelineItem";

const AScrollView = Animated.ScrollView;
const RULER_H = 26;
const MIN_PX = 8;
const MAX_PX = 320;

export interface TimelineProps {
  timeline: TL | null;
  frameSV: SharedValue<number>;
  playing: boolean;
  selectedId: string | null;
  linkHighlightIds: Set<string>;
  selectionCount: number;
  /** Live preview seek while dragging (throttled by the playback engine). */
  onScrub: (frame: number) => void;
  /** Called when the user grabs the timeline (pauses playback). */
  onScrubStart: () => void;
  /** Final committed frame when the scrub gesture settles. */
  onScrubEnd: (frame: number) => void;
  onSelect: (id: string) => void;
  onMove: (id: string, newFrom: number, phase: DragPhase) => void;
  onTrim: (id: string, newDuration: number, phase: DragPhase) => void;
  onRequestActions?: (id: string) => void;
  /** Reports the current zoom (px/sec) so the parent can size snap radii. */
  onZoomChange?: (pxPerSec: number) => void;
}

function TimelineImpl({
  timeline,
  frameSV,
  playing,
  selectedId,
  linkHighlightIds,
  selectionCount,
  onScrub,
  onScrubStart,
  onScrubEnd,
  onSelect,
  onMove,
  onTrim,
  onRequestActions,
  onZoomChange,
}: TimelineProps) {
  const fps = timeline?.fps || 24;
  const { durationInFrames } = timelineDuration(timeline);
  const [pxPerSec, setPxPerSec] = useState(48);
  const [containerW, setContainerW] = useState(0);
  const [scrollEnabled, setScrollEnabled] = useState(true);

  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const pxSV = useSharedValue(pxPerSec);
  const userScrubbing = useSharedValue(false);
  const savedPx = useSharedValue(pxPerSec);
  useEffect(() => {
    pxSV.value = pxPerSec;
  }, [pxPerSec, pxSV]);

  const centerX = containerW / 2;
  const totalW = Math.max(framesToSec(durationInFrames, fps) * pxPerSec, containerW);
  const contentW = centerX * 2 + totalW;

  // Follow the playhead: whenever the frame (or zoom) changes and the user is
  // NOT actively scrubbing, keep the playhead under the fixed center line.
  useAnimatedReaction(
    () => ({ f: frameSV.value, px: pxSV.value }),
    (cur) => {
      if (userScrubbing.value) return;
      const x = (cur.f / fps) * cur.px;
      scrollTo(scrollRef, x, 0, false);
    },
    [fps],
  );

  const scrubEndJS = useCallback(
    (x: number) => {
      const frame = (x / pxPerSec) * fps;
      onScrubEnd(frame);
    },
    [pxPerSec, fps, onScrubEnd],
  );

  const scrollHandler = useAnimatedScrollHandler({
    onBeginDrag: () => {
      userScrubbing.value = true;
      runOnJS(onScrubStart)();
    },
    onScroll: (e) => {
      if (!userScrubbing.value) return;
      const raw = (e.contentOffset.x / pxSV.value) * fps;
      const frame = Math.max(0, Math.min(durationInFrames - 1, raw));
      frameSV.value = frame;
      runOnJS(onScrub)(frame);
    },
    onEndDrag: (e) => {
      userScrubbing.value = false;
      runOnJS(scrubEndJS)(e.contentOffset.x);
    },
    onMomentumEnd: (e) => {
      userScrubbing.value = false;
      runOnJS(scrubEndJS)(e.contentOffset.x);
    },
  });

  // Pinch to zoom. Keeps the centered frame stable because the follow reaction
  // re-derives the scroll offset from pxSV.
  const commitPx = useCallback(
    (p: number) => {
      setPxPerSec(p);
      onZoomChange?.(p);
    },
    [onZoomChange],
  );
  useEffect(() => {
    onZoomChange?.(pxPerSec);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .onStart(() => {
          savedPx.value = pxSV.value;
        })
        .onUpdate((e) => {
          const p = Math.max(MIN_PX, Math.min(MAX_PX, savedPx.value * e.scale));
          pxSV.value = p;
        })
        .onEnd(() => {
          runOnJS(commitPx)(pxSV.value);
        }),
    [commitPx, pxSV, savedPx],
  );

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setContainerW(e.nativeEvent.layout.width);
  }, []);

  const onDragActive = useCallback((active: boolean) => setScrollEnabled(!active), []);

  // Ruler ticks.
  const ticks = useMemo(() => {
    const totalSec = framesToSec(durationInFrames, fps);
    const { step } = pickTickStep(pxPerSec);
    const out: { x: number; label: string }[] = [];
    for (let s = 0; s <= totalSec + step; s += step) {
      out.push({ x: s * pxPerSec, label: formatTimecode(s, fps, step < 1) });
    }
    return out;
  }, [durationInFrames, fps, pxPerSec]);

  const tracks = timeline?.tracks || [];

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      {/* Fixed center playhead + capture line */}
      <View pointerEvents="none" style={[styles.playhead, { left: centerX - 1 }]}>
        <View style={styles.playheadKnob} />
        <View style={styles.playheadLine} />
      </View>

      <GestureDetector gesture={pinch}>
        <AScrollView
          ref={scrollRef}
          horizontal
          scrollEnabled={scrollEnabled}
          showsHorizontalScrollIndicator={false}
          onScroll={scrollHandler}
          scrollEventThrottle={16}
          decelerationRate="fast"
          contentContainerStyle={{ width: contentW }}
        >
          <View style={{ width: centerX }} />
          <View style={{ width: totalW }}>
            {/* Ruler */}
            <View style={[styles.ruler, { width: totalW }]}>
              {ticks.map((t, i) => (
                <View key={i} style={[styles.tick, { left: t.x }]}>
                  <View style={styles.tickMark} />
                  <Text style={styles.tickLabel}>{t.label}</Text>
                </View>
              ))}
            </View>
            {/* Lanes */}
            {tracks.map((track) => (
              <View
                key={track.id}
                style={[
                  styles.lane,
                  {
                    height: LANE_H,
                    backgroundColor:
                      track.type === "video" ? EditorTheme.laneVideo : EditorTheme.laneAudio,
                  },
                ]}
              >
                {track.items.map((item) => (
                  <TimelineItem
                    key={item.id}
                    item={item}
                    track={track}
                    pxPerSec={pxPerSec}
                    fps={fps}
                    selected={selectedId === item.id}
                    linkHighlight={!!item.linkId && linkHighlightIds.has(item.linkId)}
                    multiCount={selectionCount}
                    onSelect={onSelect}
                    onDragActive={onDragActive}
                    onMove={onMove}
                    onTrim={onTrim}
                    onRequestActions={onRequestActions}
                  />
                ))}
              </View>
            ))}
          </View>
          <View style={{ width: centerX }} />
        </AScrollView>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: EditorTheme.track,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: EditorTheme.border,
  },
  playhead: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 2,
    zIndex: 20,
    alignItems: "center",
  },
  playheadKnob: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: EditorTheme.playhead,
    marginTop: 2,
  },
  playheadLine: { flex: 1, width: 2, backgroundColor: EditorTheme.playhead },
  ruler: {
    height: RULER_H,
    justifyContent: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: EditorTheme.border,
  },
  tick: { position: "absolute", alignItems: "flex-start", height: RULER_H, justifyContent: "flex-end" },
  tickMark: { width: StyleSheet.hairlineWidth, height: 6, backgroundColor: EditorTheme.ruler },
  tickLabel: { color: EditorTheme.rulerText, fontSize: 9, marginTop: 1, marginLeft: 2 },
  lane: {
    marginTop: 4,
    borderRadius: 4,
    overflow: "hidden",
  },
});

export const Timeline = memo(TimelineImpl);
export default Timeline;
