// TimelineItem — one clip/music card on the timeline. React Native port of
// web-editor/src/modules/timeline/TimelineItem.jsx. It keeps the same DATA props
// (item, track, pxPerSec, fps, selected, linkHighlight, multiCount) and the same
// selection callback (onSelect(id)); the web card's DOM pointer handlers
// (onDragStart(e,item,track,mode) / onFadeStart) become Gesture Handler
// recognizers here — a tap selects, a long-press+pan MOVES, and the right-edge
// handle pan TRIMS. Actions (disable/detach/link/unlink/remove) are surfaced
// through the native Inspector sheet rather than a right-click menu.
// Web reference: /docs/modules/timeline ↔ this: /docs/react-native/timeline
import { memo, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { Image } from "expo-image";
import { SymbolView } from "expo-symbols";
import type { Track, TimelineItem as TItem } from "@/editor/core/timeline";
import { framesToSec, isImageItem, isSlateItem } from "@/editor/core/timeline";
import { EditorTheme } from "@/editor/theme";
import { useBackend } from "@/editor/providers/backend";
import { LANE_H } from "./ruler";
import { Waveform } from "./Waveform";
import { useAudioPeaks, colorForSrc } from "@/editor/modules/media/thumbs";

export type DragPhase = "begin" | "active" | "end";

export interface TimelineItemProps {
  item: TItem;
  track: Track;
  pxPerSec: number;
  fps: number;
  selected: boolean;
  linkHighlight: boolean;
  multiCount: number;
  onSelect: (id: string) => void;
  /** Toggles the parent timeline's scroll off while a clip drag is active. */
  onDragActive: (active: boolean) => void;
  /** Move intent: `newFrom` in frames. Web equiv: onDragStart(...,"move"). */
  onMove: (id: string, newFrom: number, phase: DragPhase) => void;
  /** Right-edge trim intent: `newDuration` in frames. Web equiv: onDragStart(...,"resize"). */
  onTrim: (id: string, newDuration: number, phase: DragPhase) => void;
  /** Open the native action/inspector sheet for this clip. */
  onRequestActions?: (id: string) => void;
}

const HANDLE_W = 22;

function TimelineItemImpl({
  item,
  track,
  pxPerSec,
  fps,
  selected,
  linkHighlight,
  multiCount,
  onSelect,
  onDragActive,
  onMove,
  onTrim,
  onRequestActions,
}: TimelineItemProps) {
  const isAudio = track.type === "audio";
  // The picture lane holds videos and animatic stills as peers — the ITEM's
  // kind decides, not the track's (see core/timeline.ts).
  const isImage = isImageItem(item);
  const isSlate = isSlateItem(item);
  const backend = useBackend();
  const secLeft = framesToSec(item.from, fps);
  const secDur = framesToSec(item.durationInFrames, fps);
  const left = secLeft * pxPerSec;
  const width = Math.max(HANDLE_W + 8, secDur * pxPerSec);

  const peaks = useAudioPeaks(isAudio ? item.src : "");
  const thumbUri = isImage && item.src ? backend.mediaUrl(item.src) : null;

  // Live drag offsets (UI thread) so the card follows the finger with no React
  // render per frame; the model is updated via runOnJS on update/end.
  const dragX = useSharedValue(0);
  const trimW = useSharedValue(0);

  // ALL gestures run their callbacks on the JS thread (.runOnJS(true)). Worklet
  // gesture callbacks ride reanimated's event pipeline, which never fires on
  // this stack (RN 0.86 / New Arch / React Compiler — the same dead pipeline as
  // useAnimatedScrollHandler; see src/app/(tabs)/chat/index.tsx). JS callbacks
  // use RNGH's plain event path, which works.
  const tap = useMemo(
    () => Gesture.Tap().maxDuration(250).runOnJS(true).onEnd(() => onSelect(item.id)),
    [item.id, onSelect],
  );

  const move = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(280)
        .runOnJS(true)
        .onStart(() => {
          dragX.value = 0;
          onSelect(item.id);
          onDragActive(true);
          onMove(item.id, item.from, "begin");
        })
        .onUpdate((e) => {
          dragX.value = e.translationX;
          const nf = Math.max(0, item.from + Math.round((e.translationX / pxPerSec) * fps));
          onMove(item.id, nf, "active");
        })
        .onEnd((_e, success) => {
          // A CANCELLED pan (scroll stole it, detector reconfigured) must not
          // commit its partial translation — report "no move" so the editor
          // drops the gesture's undo snapshot instead.
          const nf = success
            ? Math.max(0, item.from + Math.round((dragX.value / pxPerSec) * fps))
            : item.from;
          onMove(item.id, nf, "end");
        })
        .onFinalize(() => {
          dragX.value = 0;
          onDragActive(false);
        }),
    [item.id, item.from, pxPerSec, fps, onSelect, onDragActive, onMove],
  );

  const doubleTap = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .runOnJS(true)
        .onEnd(() => {
          onSelect(item.id);
          onRequestActions?.(item.id);
        }),
    [item.id, onSelect, onRequestActions],
  );

  const body = useMemo(
    () => Gesture.Exclusive(move, doubleTap, tap),
    [move, doubleTap, tap],
  );

  const trim = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        // Hold-to-grab, like the move gesture: an immediate horizontal drag is
        // claimed by the ScrollView's native pan before the JS-thread
        // scroll-disable can land, cancelling the trim. A short stationary
        // hold makes the scroll pan give the touch up, after which the handle
        // drag is ours.
        .activateAfterLongPress(220)
        // Disable timeline scroll the instant the handle is touched so the
        // ScrollView can't claim the horizontal drag before trimming starts.
        .onBegin(() => onDragActive(true))
        .onStart(() => {
          trimW.value = 0;
          onSelect(item.id);
          onTrim(item.id, item.durationInFrames, "begin");
        })
        .onUpdate((e) => {
          trimW.value = e.translationX;
          const nd = Math.max(1, item.durationInFrames + Math.round((e.translationX / pxPerSec) * fps));
          onTrim(item.id, nd, "active");
        })
        .onEnd((_e, success) => {
          const nd = success
            ? Math.max(1, item.durationInFrames + Math.round((trimW.value / pxPerSec) * fps))
            : item.durationInFrames;
          onTrim(item.id, nd, "end");
        })
        .onFinalize(() => {
          trimW.value = 0;
          onDragActive(false);
        }),
    [item.id, item.durationInFrames, pxPerSec, fps, onSelect, onDragActive, onTrim],
  );

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.value }],
    width: width + trimW.value,
  }));

  // A slate is a HOLE in the picture — it reads as an empty panel rather than a
  // clip, so scanning the lane shows which shots still need a still.
  const baseColor = isAudio
    ? selected
      ? EditorTheme.clipAudioSelected
      : EditorTheme.clipAudio
    : isSlate
      ? EditorTheme.panelRaised
      : selected
        ? EditorTheme.clipVideoSelected
        : EditorTheme.clipVideo;

  return (
    <Animated.View
      style={[
        styles.card,
        {
          left,
          height: LANE_H - 8,
          backgroundColor: baseColor,
          borderColor: selected
            ? "#fff"
            : linkHighlight
              ? EditorTheme.link
              : isSlate
                ? EditorTheme.border
                : "transparent",
          borderStyle: isSlate && !selected ? "dashed" : "solid",
          opacity: item.disabled ? 0.4 : 1,
        },
        cardStyle,
      ]}
    >
      <GestureDetector gesture={body}>
        <View style={styles.fill}>
          {/* Picture lane: a still shows its actual image, a video its color
              tint (no cheap native poster), a slate neither — it stays an empty
              dashed card. */}
          {!isAudio && !isSlate ? (
            thumbUri ? (
              <Image
                source={{ uri: thumbUri }}
                style={styles.filmstrip}
                contentFit="cover"
                transition={0}
              />
            ) : (
              <View style={[styles.filmstrip, { backgroundColor: colorForSrc(item.src) }]} />
            )
          ) : null}
          {isAudio && (
            <View style={styles.wave}>
              <Waveform
                peaks={peaks}
                width={Math.max(1, width - 8)}
                height={LANE_H - 24}
                fadeInPx={item.fadeInFrames ? framesToSec(item.fadeInFrames, fps) * pxPerSec : 0}
                fadeOutPx={item.fadeOutFrames ? framesToSec(item.fadeOutFrames, fps) * pxPerSec : 0}
                disabled={item.disabled}
              />
            </View>
          )}
          <View style={styles.labelRow}>
            {item.muted && <SymbolView name="speaker.slash.fill" size={10} tintColor="#fff" />}
            {item.linkId && <SymbolView name="link" size={10} tintColor={EditorTheme.link} />}
            {isSlate ? (
              <SymbolView name="rectangle.dashed" size={10} tintColor={EditorTheme.textDim} />
            ) : isImage ? (
              <SymbolView name="photo" size={10} tintColor="#fff" />
            ) : null}
            <Text
              numberOfLines={1}
              style={[styles.label, isSlate && { color: EditorTheme.textDim }]}
            >
              {item.name}
            </Text>
            {multiCount > 1 && selected && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{multiCount}</Text>
              </View>
            )}
          </View>
        </View>
      </GestureDetector>

      {/* The trim handle stays MOUNTED and is hidden via opacity/pointerEvents.
          Mounting it conditionally on `selected` changed the card's native
          subtree mid-gesture (drag-start selects the clip), which cancels the
          active pan on the New Architecture — the "clip won't move" bug. */}
      <GestureDetector gesture={trim}>
        <View
          style={[styles.handle, !selected && styles.handleHidden]}
          hitSlop={selected ? 8 : undefined}
          pointerEvents={selected ? "auto" : "none"}
        >
          <View style={styles.handleBar} />
        </View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    top: 4,
    borderRadius: 0,
    borderWidth: 2,
    overflow: "hidden",
  },
  fill: { flex: 1, justifyContent: "space-between" },
  filmstrip: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0.55 },
  wave: { paddingHorizontal: 4, paddingTop: 4 },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  label: { color: "#fff", fontSize: 11, fontWeight: "600", flexShrink: 1 },
  badge: {
    marginLeft: "auto",
    backgroundColor: "#fff",
    borderRadius: 0,
    minWidth: 16,
    alignItems: "center",
    paddingHorizontal: 4,
  },
  badgeText: { color: "#000", fontSize: 10, fontWeight: "700" },
  handle: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: HANDLE_W,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  handleBar: { width: 3, height: 20, borderRadius: 0, backgroundColor: "#fff" },
  handleHidden: { opacity: 0 },
});

export const TimelineItem = memo(TimelineItemImpl);
export default TimelineItem;
