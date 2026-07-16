// Editor — the composition root. React Native port of web-editor/src/Editor.jsx.
// It WIRES the feature modules together and owns the shared editor state exactly
// as the web root does: the timeline model (via `useTimelineHistory`), selection,
// the playback engine, autosave, and the pure-op mutations. Modules stay
// stateless/props-driven. Only the UI shell + gesture wiring are native.
// Web reference: /docs/architecture ↔ this: /docs/react-native/architecture
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { runOnJS, useAnimatedReaction, useSharedValue, type SharedValue } from "react-native-reanimated";
import { SymbolView, type SymbolViewProps } from "expo-symbols";
import {
  linkGroupOf,
  timelineDuration,
  withSourceDurations,
  framesToSec,
  type Timeline as TL,
  type TimelineItem,
} from "@/editor/core/timeline";
import { EditorComposition } from "@/editor/core/Composition";
import { EditorTheme } from "@/editor/theme";
import { useBackend } from "@/editor/providers/backend";
import type { Pool, PoolItem } from "@/editor/providers/backend/types";
import { useEditorPlayback } from "@/editor/modules/playback";
import {
  Timeline,
  useTimelineHistory,
  SNAP_PX,
  formatTimecode,
  snapTargets,
  computeSnap,
  moveItem,
  trimItem,
  addPoolClip,
  detachAudio,
  linkSelected,
  unlinkItem,
  removeItemFromTimeline,
  type DragPhase,
} from "@/editor/modules/timeline";
import { Inspector } from "@/editor/modules/timeline/Inspector";
import { MediaPool } from "@/editor/modules/media";

function findItem(tl: TL | null, id: string | null): TimelineItem | null {
  if (!tl || !id) return null;
  for (const t of tl.tracks) {
    const it = t.items.find((x) => x.id === id);
    if (it) return it;
  }
  return null;
}
function findTrack(tl: TL | null, id: string | null) {
  if (!tl || !id) return null;
  return tl.tracks.find((t) => t.items.some((x) => x.id === id)) || null;
}

// Timecode readout driven off the UI-thread playhead (throttled to ~12fps so it
// updates the label without re-rendering the whole editor every frame).
function Timecode({ frameSV, fps }: { frameSV: SharedValue<number>; fps: number }) {
  const [text, setText] = useState("00:00:00");
  const last = useSharedValue(0);
  // Format on the JS thread — `formatTimecode` is a plain function and must NOT
  // be invoked inside the reaction worklet (that runs on the UI runtime).
  const update = useCallback((f: number) => setText(formatTimecode(f / fps, fps, true)), [fps]);
  useAnimatedReaction(
    () => frameSV.value,
    (f) => {
      if (Math.abs(f - last.value) < fps / 12) return;
      last.value = f;
      runOnJS(update)(f);
    },
    [fps, update],
  );
  return <Text style={styles.timecode}>{text}</Text>;
}

export function Editor({ onClose }: { onClose?: () => void } = {}) {
  const insets = useSafeAreaInsets();
  const backend = useBackend();
  const {
    timeline,
    setTimeline,
    timelineRef,
    dirtyRef,
    mutate,
    beginGesture,
    endGesture,
    undo,
    canUndo,
    resetHistory,
  } = useTimelineHistory();

  const [pool, setPool] = useState<Pool | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [poolOpen, setPoolOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const pxPerSecRef = useRef(48);
  const currentFrameRef = useRef(0);

  const playback = useEditorPlayback(timeline, backend.resolveSource);

  // ---- load + autosave -----------------------------------------------------
  useEffect(() => {
    let alive = true;
    (async () => {
      const { timeline: tl } = await backend.loadTimeline();
      if (!alive) return;
      setTimeline(withSourceDurations(tl), { dirty: false });
      resetHistory();
      setPool(await backend.loadPool());
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!timeline || !dirtyRef.current) return;
    const t = setTimeout(() => {
      backend.saveTimeline(timeline);
      dirtyRef.current = false;
    }, 600);
    return () => clearTimeout(t);
  }, [timeline, backend, dirtyRef]);

  // ---- selection -----------------------------------------------------------
  const selectId = useCallback((id: string) => {
    setSelectedId(id);
    setSelectedIds(new Set([id]));
  }, []);

  const linkHighlightIds = useMemo(() => {
    const s = new Set<string>();
    const it = findItem(timeline, selectedId);
    if (it?.linkId) s.add(it.linkId);
    return s;
  }, [timeline, selectedId]);

  // ---- transport / scrub ---------------------------------------------------
  const onScrub = useCallback(
    (frame: number) => {
      currentFrameRef.current = frame;
      playback.scrubTo(frame);
    },
    [playback],
  );
  const onScrubStart = useCallback(() => playback.pause(), [playback]);
  const onScrubEnd = useCallback(
    (frame: number) => {
      currentFrameRef.current = frame;
      playback.seekTo(frame);
    },
    [playback],
  );

  // ---- clip move / trim (commit on gesture end; live visual is on UI thread) --
  const onMove = useCallback(
    (id: string, newFrom: number, phase: DragPhase) => {
      if (phase === "begin") {
        beginGesture();
        selectId(id);
        return;
      }
      if (phase !== "end") return;
      const tl = timelineRef.current;
      const item = findItem(tl, id);
      if (!tl || !item) {
        endGesture();
        return;
      }
      const exclude = new Set<string>([id]);
      if (item.linkId) linkGroupOf(tl, item.linkId).forEach((g) => exclude.add(g.id));
      const fps = tl.fps || 24;
      const thresh = Math.max(1, (SNAP_PX / pxPerSecRef.current) * fps);
      const targets = snapTargets(tl, Math.round(currentFrameRef.current), exclude);
      const snapped = computeSnap(targets, newFrom, item.durationInFrames, thresh);
      const finalFrom = snapped ? snapped.from : newFrom;
      mutate((t) => moveItem(t, id, finalFrom), true);
      endGesture();
    },
    [beginGesture, endGesture, mutate, selectId, timelineRef],
  );

  const onTrim = useCallback(
    (id: string, newDuration: number, phase: DragPhase) => {
      if (phase === "begin") {
        beginGesture();
        selectId(id);
        return;
      }
      if (phase !== "end") return;
      mutate((t) => trimItem(t, id, newDuration), true);
      endGesture();
    },
    [beginGesture, endGesture, mutate, selectId],
  );

  // ---- add / inspector actions --------------------------------------------
  const addClip = useCallback(
    (poolItem: PoolItem) => {
      setPoolOpen(false);
      const tl = timelineRef.current;
      if (!tl) return;
      const type = poolItem.mediaType === "audio" ? "audio" : "video";
      const track = tl.tracks.find((t) => t.type === type) || tl.tracks[0];
      const from = Math.max(0, Math.round(currentFrameRef.current));
      const newId = `clip_${Date.now()}`;
      mutate((t) =>
        addPoolClip(t, poolItem, { type: "lane", trackId: track.id, from }, poolItem.durationSec || 3, t.fps, newId),
      );
      selectId(newId);
    },
    [mutate, selectId, timelineRef],
  );

  const patchItem = useCallback(
    (id: string, fn: (it: TimelineItem) => void, silent?: boolean) => {
      mutate((t) => {
        const it = findItem(t, id);
        if (it) fn(it);
        return t;
      }, silent);
    },
    [mutate],
  );

  const openInspector = useCallback(
    (id: string) => {
      selectId(id);
      setInspectorOpen(true);
    },
    [selectId],
  );

  const removeClip = useCallback(
    (id: string) => {
      mutate((t) => removeItemFromTimeline(t, id));
      setInspectorOpen(false);
      setSelectedId(null);
      setSelectedIds(new Set());
    },
    [mutate],
  );

  const { durationInFrames } = timelineDuration(timeline);
  const selectedItem = findItem(timeline, selectedId);
  const selectedTrack = findTrack(timeline, selectedId);
  const isAudioTrack = selectedTrack?.type === "audio";
  const totalSec = framesToSec(durationInFrames, timeline?.fps || 24);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Top bar */}
      <View style={styles.topbar}>
        <View style={styles.topbarSide}>
          {onClose ? <ToolButton icon="xmark" label="Close" onPress={onClose} /> : null}
          <ToolButton
            icon="arrow.uturn.backward"
            label="Undo"
            disabled={!canUndo}
            onPress={undo}
          />
        </View>
        <Text style={styles.brand}>Editor</Text>
        <View style={styles.topbarSide}>
          <ToolButton
            icon="square.and.arrow.up"
            label="Export"
            onPress={() => backend.render()}
          />
        </View>
      </View>

      {/* Preview */}
      <View style={styles.preview}>
        <EditorComposition video={playback.video} imageUrl={backend.mediaUrl} />
        <View style={styles.previewOverlay} pointerEvents="box-none">
          <Timecode frameSV={playback.frameSV} fps={timeline?.fps || 24} />
          <Pressable style={styles.playBtn} onPress={playback.toggle} hitSlop={16}>
            <SymbolView
              name={playback.playing ? "pause.fill" : "play.fill"}
              size={28}
              tintColor="#fff"
            />
          </Pressable>
          <Text style={styles.duration}>{formatTimecode(totalSec, timeline?.fps || 24, false)}</Text>
        </View>
      </View>

      {/* Timeline */}
      <Timeline
        timeline={timeline}
        frameSV={playback.frameSV}
        playing={playback.playing}
        selectedId={selectedId}
        linkHighlightIds={linkHighlightIds}
        selectionCount={selectedIds.size}
        onScrub={onScrub}
        onScrubStart={onScrubStart}
        onScrubEnd={onScrubEnd}
        onSelect={selectId}
        onMove={onMove}
        onTrim={onTrim}
        onRequestActions={openInspector}
        onZoomChange={(p) => {
          pxPerSecRef.current = p;
        }}
      />

      {/* Bottom toolbar */}
      <View style={[styles.toolbar, { paddingBottom: insets.bottom || 12 }]}>
        <ToolButton icon="plus.circle.fill" label="Add" onPress={() => setPoolOpen(true)} />
        <ToolButton
          icon="slider.horizontal.3"
          label="Edit"
          disabled={!selectedId}
          onPress={() => selectedId && setInspectorOpen(true)}
        />
        <ToolButton
          icon="trash"
          label="Delete"
          disabled={!selectedId}
          onPress={() => selectedId && removeClip(selectedId)}
        />
        <ToolButton
          icon="scissors"
          label="Split"
          disabled={!selectedId}
          onPress={() => {}}
        />
      </View>

      {/* Native sheets */}
      <MediaPool visible={poolOpen} pool={pool} onClose={() => setPoolOpen(false)} onAdd={addClip} />
      <Inspector
        visible={inspectorOpen}
        item={selectedItem}
        isAudioTrack={!!isAudioTrack}
        fps={timeline?.fps || 24}
        canLink={selectedIds.size > 1}
        onClose={() => setInspectorOpen(false)}
        onSetVolume={(id, v) => patchItem(id, (it) => (it.volume = v), true)}
        onSetFade={(id, which, frames) =>
          patchItem(id, (it) => (which === "in" ? (it.fadeInFrames = frames) : (it.fadeOutFrames = frames)), true)
        }
        onToggleMute={(id) => patchItem(id, (it) => (it.muted = !it.muted))}
        onToggleDisable={(id) => patchItem(id, (it) => (it.disabled = !it.disabled))}
        onDetachAudio={(id) => mutate((t) => detachAudio(t, id))}
        onLinkSelected={() => mutate((t) => linkSelected(t, [...selectedIds]))}
        onUnlink={(id) => mutate((t) => unlinkItem(t, id))}
        onRemove={removeClip}
      />
    </View>
  );
}

function ToolButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: SymbolViewProps["name"];
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.toolBtn, pressed && !disabled && styles.toolPressed]}
    >
      <SymbolView
        name={icon}
        size={22}
        tintColor={disabled ? EditorTheme.textFaint : EditorTheme.text}
      />
      <Text style={[styles.toolLabel, disabled && { color: EditorTheme.textFaint }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: EditorTheme.bg },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  topbarSide: { flexDirection: "row", alignItems: "center", gap: 4 },
  brand: { color: EditorTheme.text, fontSize: 16, fontWeight: "700" },
  preview: {
    flex: 1,
    backgroundColor: "#000",
    justifyContent: "center",
    position: "relative",
  },
  previewOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 14,
  },
  timecode: {
    position: "absolute",
    top: 12,
    left: 14,
    color: "#fff",
    fontSize: 13,
    fontVariant: ["tabular-nums"],
    backgroundColor: "rgba(0,0,0,0.4)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  duration: {
    position: "absolute",
    top: 12,
    right: 14,
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontVariant: ["tabular-nums"],
  },
  playBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  toolbar: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingTop: 10,
    backgroundColor: EditorTheme.panel,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: EditorTheme.border,
  },
  toolBtn: { alignItems: "center", gap: 3, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 10 },
  toolPressed: { backgroundColor: EditorTheme.panelRaised },
  toolLabel: { color: EditorTheme.text, fontSize: 11, fontWeight: "600" },
});

export default Editor;
