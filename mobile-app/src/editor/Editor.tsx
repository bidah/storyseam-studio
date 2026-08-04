// Editor — the composition root. React Native port of web-editor/src/Editor.jsx.
// It WIRES the feature modules together and owns the shared editor state exactly
// as the web root does: the timeline model (via `useTimelineHistory`), selection,
// the playback engine, autosave, and the pure-op mutations. Modules stay
// stateless/props-driven. Only the UI shell + gesture wiring are native.
// Web reference: /docs/architecture ↔ this: /docs/react-native/architecture
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Modal, Pressable, Text, TextInput, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
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
  removeGap,
  planSplit,
  applySplit,
  type DragPhase,
  type SelectedGap,
} from "@/editor/modules/timeline";
import { Inspector } from "@/editor/modules/timeline/Inspector";
import { MediaPool } from "@/editor/modules/media";

// Matches the server's cap in worker/src/routes/timeline.js — a longer name is
// trimmed there anyway, so stop it at the keyboard instead.
const NAME_MAX = 120;

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
    inGestureRef,
    mutate,
    beginGesture,
    endGesture,
    cancelGesture,
    undo,
    canUndo,
    resetHistory,
  } = useTimelineHistory();

  const [pool, setPool] = useState<Pool | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedGap, setSelectedGap] = useState<SelectedGap | null>(null);
  const [poolOpen, setPoolOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [committingPacing, setCommittingPacing] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  // In-place header rename: the draft name while editing, or null when idle.
  const [renaming, setRenaming] = useState<string | null>(null);
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

  // Live-sync (web parity): reload when the timeline changes ELSEWHERE — the
  // web editor or the agent's edit_timeline. Our own autosave echoes are
  // suppressed by clientId inside subscribeTimeline. A foreign edit that lands
  // mid-gesture or with unsaved local edits is skipped; the next SSE event or
  // reopen reconciles.
  useEffect(() => {
    const off = backend.subscribeTimeline?.(() => {
      if (inGestureRef.current || dirtyRef.current) return;
      (async () => {
        const { timeline: tl } = await backend.loadTimeline();
        setTimeline(withSourceDurations(tl), { dirty: false });
      })();
    });
    return off;
  }, [backend, dirtyRef, inGestureRef, setTimeline]);

  // ---- selection -----------------------------------------------------------
  // Selecting a clip and a gap are mutually exclusive (web parity).
  const selectId = useCallback((id: string) => {
    setSelectedGap(null);
    setSelectedId(id);
    setSelectedIds(new Set([id]));
  }, []);

  // Gap taps: first tap selects the gap (the card shows its X), a second tap on
  // the selected gap closes it — every later clip on the track pulls left.
  const onSelectGap = useCallback(
    (trackId: string, gap: { from: number; to: number }) => {
      const same =
        selectedGap &&
        selectedGap.trackId === trackId &&
        selectedGap.from === gap.from &&
        selectedGap.to === gap.to;
      if (same) {
        mutate((t) => removeGap(t, trackId, gap));
        setSelectedGap(null);
        return;
      }
      setSelectedId(null);
      setSelectedIds(new Set());
      setSelectedGap({ trackId, from: gap.from, to: gap.to });
    },
    [mutate, selectedGap],
  );

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
      // A drag released where it started is a no-op: drop the begin snapshot
      // (else Undo fills with do-nothing entries) and skip the dirty autosave.
      if (finalFrom === item.from) {
        cancelGesture();
        return;
      }
      mutate((t) => moveItem(t, id, finalFrom), true);
      endGesture();
    },
    [beginGesture, cancelGesture, endGesture, mutate, selectId, timelineRef],
  );

  const onTrim = useCallback(
    (id: string, newDuration: number, phase: DragPhase) => {
      if (phase === "begin") {
        beginGesture();
        selectId(id);
        return;
      }
      if (phase !== "end") return;
      const item = findItem(timelineRef.current, id);
      if (item && Math.round(newDuration) === item.durationInFrames) {
        cancelGesture();
        return;
      }
      mutate((t) => trimItem(t, id, newDuration), true);
      endGesture();
    },
    [beginGesture, cancelGesture, endGesture, mutate, selectId, timelineRef],
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

  // Split ("razor") the clip(s) under the playhead — the selected clips when
  // the playhead is inside them, otherwise every non-disabled clip under it
  // (razor across tracks), exactly like the web editor's S key. The right
  // halves become the new selection so split-then-Delete trims a tail.
  const splitClip = useCallback(() => {
    const tl = timelineRef.current;
    if (!tl) return;
    const f = Math.round(playback.frameSV.value);
    const plan = planSplit(tl, f, selectedIds);
    if (!plan) return;
    mutate((t) => applySplit(t, plan));
    setSelectedId(plan.rightIds[0] ?? null);
    setSelectedIds(new Set(plan.rightIds));
  }, [mutate, playback, selectedIds, timelineRef]);

  const removeClip = useCallback(
    (id: string) => {
      mutate((t) => removeItemFromTimeline(t, id));
      setInspectorOpen(false);
      setSelectedId(null);
      setSelectedIds(new Set());
    },
    [mutate],
  );

  // ---- commit pacing -------------------------------------------------------
  // Write the realized timing of a radio/animatic timeline back into the Shot
  // list's `dur` values, so the animatic and the episode video generation
  // inherit the pacing you just reviewed. It lives HERE, not on the Radio
  // screen, because this is where the pacing is seen (web parity).
  //
  // It rewrites every shot's duration, so unlike the web — which has a tooltip
  // and a mouse — a thumb gets a confirm first.
  const paceableKind =
    timeline?.source?.kind === "radio" || timeline?.source?.kind === "animatic"
      ? timeline.source.kind
      : null;
  const canCommitPacing = !!paceableKind && !!backend.commitPacing;

  const runCommitPacing = useCallback(async () => {
    if (!backend.commitPacing) return;
    setCommittingPacing(true);
    try {
      // Flush first: the route reads the SAVED doc and autosave is debounced.
      const tl = timelineRef.current;
      if (tl) {
        await backend.saveTimeline(tl);
        dirtyRef.current = false;
      }
      const { source, updated, untouched } = await backend.commitPacing();
      Alert.alert(
        "Pacing committed",
        `Committed the ${source} timing to the Shot list — ${updated} shot duration${
          updated === 1 ? "" : "s"
        } updated${untouched ? `, ${untouched} left untouched` : ""}.`,
      );
    } catch (e: any) {
      Alert.alert("Commit failed", String(e?.message || e));
    } finally {
      setCommittingPacing(false);
    }
  }, [backend, dirtyRef, timelineRef]);

  const commitPacing = useCallback(() => {
    Alert.alert(
      "Commit pacing",
      "Write this timeline's pacing back to the Shot list durations? Every shot's planned duration is replaced by what you see here — the animatic and episode video generation will follow it.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Commit", style: "destructive", onPress: () => void runCommitPacing() },
      ],
    );
  }, [runCommitPacing]);

  // ---- new project ---------------------------------------------------------
  // Start an EMPTY timeline instead of one derived from a cut / radio pass /
  // animatic — the edit gets assembled from the media pool. It replaces what's
  // open (the previous timeline stays in the document history), so the naming
  // sheet doubles as the confirm.
  const runNewProject = useCallback(async (name: string) => {
    setNewProjectOpen(false);
    try {
      const { timeline: tl } = await backend.newProject(name.trim());
      setTimeline(withSourceDurations(tl), { dirty: false });
      resetHistory();
      setSelectedId(null);
      setSelectedIds(new Set());
      setSelectedGap(null);
    } catch (e: any) {
      Alert.alert("Could not start a new project", String(e?.message || e));
    }
  }, [backend, resetHistory, setTimeline]);

  // Rename the project in place from the header — an ordinary timeline edit, so
  // it rides the same debounced autosave as a drag.
  const commitRename = useCallback(() => {
    const next = (renaming || "").trim().slice(0, NAME_MAX);
    setRenaming(null);
    mutate((t) => {
      if (next) t.name = next;
      else delete t.name;
      return t;
    });
  }, [mutate, renaming]);

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
        {/* Project name — tap it to rename in place. Unnamed timelines (a cut,
            an animatic) keep showing what they came from, and tapping that
            names them. */}
        {renaming === null ? (
          <Pressable
            style={styles.brandTap}
            hitSlop={8}
            onPress={() => timeline && setRenaming(timeline.name || "")}
            accessibilityLabel="Rename project"
          >
            <Text numberOfLines={1} style={styles.brand}>
              {timeline?.name
                || (paceableKind === "animatic"
                  ? "Animatic"
                  : paceableKind === "radio"
                    ? "Radio version"
                    : "Editor")}
            </Text>
          </Pressable>
        ) : (
          <TextInput
            autoFocus
            value={renaming}
            maxLength={NAME_MAX}
            placeholder="Untitled project"
            placeholderTextColor={EditorTheme.textFaint}
            selectTextOnFocus
            returnKeyType="done"
            style={styles.brandInput}
            onChangeText={setRenaming}
            onSubmitEditing={commitRename}
            onBlur={commitRename}
          />
        )}
        <View style={styles.topbarSide}>
          <ToolButton
            icon="doc.badge.plus"
            label="New"
            onPress={() => { setNewProjectName(""); setNewProjectOpen(true); }}
          />
          {canCommitPacing ? (
            <ToolButton
              icon="timer"
              label={committingPacing ? "Committing…" : "Pacing"}
              disabled={committingPacing}
              onPress={commitPacing}
            />
          ) : null}
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
        selectedGap={selectedGap}
        linkHighlightIds={linkHighlightIds}
        selectionCount={selectedIds.size}
        onScrub={onScrub}
        onScrubStart={onScrubStart}
        onScrubEnd={onScrubEnd}
        onSelect={selectId}
        onSelectGap={onSelectGap}
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
          disabled={!selectedId && !selectedGap}
          onPress={() => {
            if (selectedGap) {
              mutate((t) => removeGap(t, selectedGap.trackId, selectedGap));
              setSelectedGap(null);
            } else if (selectedId) {
              removeClip(selectedId);
            }
          }}
        />
        <ToolButton
          icon="scissors"
          label="Split"
          disabled={!timeline}
          onPress={splitClip}
        />
      </View>

      {/* New project — names it and confirms replacing the open edit in one step */}
      <Modal
        visible={newProjectOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setNewProjectOpen(false)}
      >
        <Pressable style={styles.scrim} onPress={() => setNewProjectOpen(false)}>
          {/* Swallow taps on the card itself so they don't dismiss the sheet. */}
          <Pressable style={styles.dialog} onPress={() => {}}>
            <Text style={styles.dialogTitle}>New project</Text>
            <Text style={styles.dialogBody}>
              An empty timeline — no cut, no clips. You build the edit from the media pool.
              {timeline
                ? " This replaces the edit you have open; the current one stays in the document history."
                : ""}
            </Text>
            <TextInput
              autoFocus
              value={newProjectName}
              maxLength={NAME_MAX}
              placeholder="Untitled project"
              placeholderTextColor={EditorTheme.textFaint}
              returnKeyType="done"
              style={styles.dialogInput}
              onChangeText={setNewProjectName}
              onSubmitEditing={() => void runNewProject(newProjectName)}
            />
            <View style={styles.dialogRow}>
              <Pressable
                style={({ pressed }) => [styles.dialogBtn, pressed && styles.toolPressed]}
                onPress={() => setNewProjectOpen(false)}
              >
                <Text style={styles.dialogBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.dialogBtn, styles.dialogBtnPrimary, pressed && styles.toolPressed]}
                onPress={() => void runNewProject(newProjectName)}
              >
                <Text style={[styles.dialogBtnText, styles.dialogBtnTextPrimary]}>Create</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

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
  // The name sits between two fixed-width button clusters, so it takes the
  // slack and truncates rather than pushing Export off the row.
  brandTap: { flexShrink: 1, paddingHorizontal: 8, paddingVertical: 4 },
  brand: { color: EditorTheme.text, fontSize: 16, fontWeight: "700", textAlign: "center" },
  brandInput: {
    flexShrink: 1,
    minWidth: 120,
    color: EditorTheme.text,
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: EditorTheme.accent,
    backgroundColor: EditorTheme.panel,
  },
  scrim: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  dialog: {
    width: "100%",
    maxWidth: 420,
    gap: 12,
    padding: 20,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: EditorTheme.border,
    backgroundColor: EditorTheme.panelRaised,
  },
  dialogTitle: { color: EditorTheme.text, fontSize: 18, fontWeight: "700" },
  dialogBody: { color: EditorTheme.textDim, fontSize: 13, lineHeight: 18 },
  dialogInput: {
    color: EditorTheme.text,
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: EditorTheme.border,
    backgroundColor: EditorTheme.panel,
  },
  dialogRow: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  dialogBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: EditorTheme.border,
  },
  dialogBtnPrimary: { backgroundColor: EditorTheme.accent, borderColor: EditorTheme.accent },
  dialogBtnText: { color: EditorTheme.text, fontSize: 15, fontWeight: "600" },
  dialogBtnTextPrimary: { color: "#0B0B0F" },
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
    justifyContent: "center",
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
