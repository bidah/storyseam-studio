// Editor tab — a Remotion-based video editor.
//
// Loads a "complete cut" setup (its ordered video clips + music bed) into an
// editable timeline, previews it live with <Player>, and lets you drag/trim/
// reorder/remove clips and set music volume. The timeline is the same JSON the
// chat agent edits (via /api/timeline*), so agent edits and manual edits stay
// in sync — the tab re-fetches on the header Refresh and after a chat turn.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player } from "@remotion/player";
import {
  Loader2, TriangleAlert, RefreshCw, Check, Scissors, Trash2,
  Film, Music, ChevronLeft, ChevronRight, Layers, Wand2, Volume2, VolumeX, Undo2,
  Eye, EyeOff,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
  ContextMenuShortcut, ContextMenuTrigger,
} from "@/components/ui/context-menu";

import EditorComposition from "@/editor/Composition";
import { timelineDuration, framesToSec } from "@/editor/timeline";

/* ---- tiny shared bits (kept local so this file is self-contained) ---- */
function Spinner({ label }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
      <Loader2 size={16} className="animate-spin" /> {label}
    </div>
  );
}
function ErrorNote({ children }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <TriangleAlert size={15} className="mt-0.5 shrink-0" /> <span>{children}</span>
    </div>
  );
}

const fmtTime = (sec) => {
  if (!Number.isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
};

// Backfill each video clip's natural source length so it can't be stretched
// past its real duration (legacy timelines saved before this field existed).
function withSourceDurations(tl) {
  if (!tl) return tl;
  for (const t of tl.tracks || []) {
    if (t.type === "video") {
      for (const it of t.items) {
        if (it.sourceDurationInFrames == null) it.sourceDurationInFrames = it.durationInFrames;
      }
    }
  }
  return tl;
}

// Empty spans before/between a track's clips (not the trailing space after the
// last clip). Used to render selectable "gaps" that can be deleted to close up.
function gapsFor(track) {
  const items = [...(track.items || [])].sort((a, b) => a.from - b.from);
  const gaps = [];
  let cursor = 0;
  for (const it of items) {
    if (it.from > cursor + 0.5) gaps.push({ from: cursor, to: it.from });
    cursor = Math.max(cursor, it.from + it.durationInFrames);
  }
  return gaps;
}

/* ---- one clip/music block on the timeline ---- */
function TimelineItem({ item, track, pxPerSec, fps, selected, onSelect, onDragStart, onToggleDisable, onRemove }) {
  const left = framesToSec(item.from, fps) * pxPerSec;
  const width = Math.max(6, framesToSec(item.durationInFrames, fps) * pxPerSec);
  const isAudio = track.type === "audio";
  const disabled = !!item.disabled;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            "group absolute top-1 bottom-1 flex select-none items-stretch overflow-hidden rounded-md border text-[11px] shadow-sm",
            disabled
              ? "border-muted-foreground/30 bg-muted-foreground/15 text-muted-foreground line-through decoration-muted-foreground/50"
              : isAudio
                ? "border-violet-500/40 bg-violet-500/20 text-violet-100"
                : "border-emerald-500/40 bg-emerald-500/20 text-emerald-50",
            selected && "ring-2 ring-primary",
          )}
          style={{ left, width }}
          onPointerDown={(e) => {
            if (e.button !== 0) return; // let right-click open the context menu
            onSelect(item.id);
            if (!e.target.dataset?.handle) onDragStart(e, item, "move");
          }}
          title={item.name}
        >
          <div className="pointer-events-none flex min-w-0 flex-1 items-center gap-1 px-1.5">
            {disabled ? <EyeOff size={11} className="shrink-0" /> : isAudio ? <Music size={11} className="shrink-0" /> : <Film size={11} className="shrink-0" />}
            <span className="truncate">{item.name}</span>
          </div>
          {/* right-edge resize handle */}
          <div
            data-handle="resize"
            onPointerDown={(e) => { e.stopPropagation(); onSelect(item.id); onDragStart(e, item, "resize"); }}
            className="w-2 shrink-0 cursor-ew-resize bg-black/25 opacity-0 transition-opacity group-hover:opacity-100"
            title="Drag to trim the end"
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => onToggleDisable(item.id)}>
          <span className="flex items-center gap-2">
            {disabled ? <Eye size={14} /> : <EyeOff size={14} />}
            {disabled ? "Enable clip" : "Disable clip"}
          </span>
          <ContextMenuShortcut>D</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => onRemove(item.id)}>
          <span className="flex items-center gap-2"><Trash2 size={14} /> Remove</span>
          <ContextMenuShortcut>⌫</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export default function Editor({ reloadKey }) {
  const [timeline, setTimeline] = useState(null);
  const [cuts, setCuts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedGap, setSelectedGap] = useState(null); // { trackId, from, to }
  const [pxPerSec, setPxPerSec] = useState(70);
  const [frame, setFrame] = useState(0);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error

  const playerRef = useRef(null);
  const dragRef = useRef(null);
  const trackAreaRef = useRef(null);
  const dirtyRef = useRef(false); // suppress autosave right after a fetch
  const timelineRef = useRef(null); // latest timeline, for undo snapshots
  const histRef = useRef([]); // undo stack of JSON snapshots
  const inGestureRef = useRef(false); // true between pointer-down and up of a drag/slide
  const [canUndo, setCanUndo] = useState(false);

  useEffect(() => { timelineRef.current = timeline; }, [timeline]);

  // Any drag/slide is ONE undo step: the gesture snapshots once at pointer-down
  // and all its moves are silent. A window pointer-up closes the gesture so the
  // NEXT drag records its own step (three separate trims → three undos).
  useEffect(() => {
    const end = () => { inGestureRef.current = false; };
    window.addEventListener("pointerup", end);
    return () => window.removeEventListener("pointerup", end);
  }, []);

  // Snapshot the current timeline onto the undo stack (unconditional).
  const pushHistory = useCallback(() => {
    const cur = timelineRef.current;
    if (!cur) return;
    histRef.current.push(JSON.stringify(cur));
    if (histRef.current.length > 80) histRef.current.shift();
    setCanUndo(true);
  }, []);

  // Open a continuous gesture: record one undo step, then stay silent until up.
  const beginGesture = useCallback(() => {
    if (inGestureRef.current) return;
    inGestureRef.current = true;
    pushHistory();
  }, [pushHistory]);

  const fps = timeline?.fps || 24;
  const { durationInFrames } = useMemo(
    () => (timeline ? timelineDuration(timeline) : { durationInFrames: 1 }),
    [timeline],
  );
  const durationSec = framesToSec(durationInFrames, fps);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/timeline");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      dirtyRef.current = false;
      histRef.current = [];
      setCanUndo(false);
      setTimeline(withSourceDurations(data.timeline));
      setCuts(data.cuts || []);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, reloadKey]);

  // Autosave the whole timeline (debounced) whenever it changes from an edit.
  useEffect(() => {
    if (!timeline || !dirtyRef.current) return;
    setSaveState("saving");
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/timeline", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ timeline }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "save failed");
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 1500);
      } catch {
        setSaveState("error");
      }
    }, 600);
    return () => clearTimeout(t);
  }, [timeline]);

  // Sync the playhead readout to the <Player>'s current frame.
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const onFrame = (e) => setFrame(e.detail.frame);
    p.addEventListener("frameupdate", onFrame);
    return () => p.removeEventListener("frameupdate", onFrame);
  }, [timeline]);

  // Mutate the timeline via a mapper over items and mark dirty for autosave.
  // `silent` skips the undo snapshot — used for the per-frame updates inside a
  // gesture (the gesture already snapshotted once at pointer-down).
  const mutate = useCallback((fn, silent) => {
    dirtyRef.current = true;
    if (!silent) pushHistory();
    setTimeline((prev) => (prev ? fn(structuredClone(prev)) : prev));
  }, [pushHistory]);

  // Undo the last timeline edit (Cmd/Ctrl+Z or the toolbar button).
  const undo = useCallback(() => {
    const snap = histRef.current.pop();
    if (!snap) return;
    dirtyRef.current = true;
    setTimeline(JSON.parse(snap));
    setSelectedId(null);
    setSelectedGap(null);
    setCanUndo(histRef.current.length > 0);
  }, []);

  // Keyboard: Cmd/Ctrl+Z undoes; Delete/Backspace removes the selected gap or
  // clip. A ref carries the latest handlers/selection so the listener mounts once.
  const keyCtxRef = useRef({});
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      const ctx = keyCtxRef.current;
      if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z") && !e.shiftKey) {
        e.preventDefault();
        ctx.undo?.();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && !typing) {
        if (ctx.selectedGap) { e.preventDefault(); ctx.removeGap?.(ctx.selectedGap.trackId, ctx.selectedGap); }
        else if (ctx.selectedId) { e.preventDefault(); ctx.removeItem?.(ctx.selectedId); }
      }
      if ((e.key === "d" || e.key === "D") && !typing && !e.metaKey && !e.ctrlKey && ctx.selectedId) {
        e.preventDefault();
        ctx.toggleDisable?.(ctx.selectedId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const mapItem = useCallback((id, patch, silent) => {
    mutate((tl) => {
      for (const t of tl.tracks) {
        const it = t.items.find((x) => x.id === id);
        if (it) Object.assign(it, typeof patch === "function" ? patch(it) : patch);
      }
      return tl;
    }, silent);
  }, [mutate]);

  const removeItem = useCallback((id) => {
    mutate((tl) => {
      for (const t of tl.tracks) t.items = t.items.filter((x) => x.id !== id);
      return tl;
    });
    setSelectedId((cur) => (cur === id ? null : cur));
  }, [mutate]);

  // Selecting a clip and a gap are mutually exclusive.
  const selectItem = useCallback((id) => { setSelectedId(id); setSelectedGap(null); }, []);
  const selectGap = useCallback((trackId, gap) => {
    setSelectedGap({ trackId, from: gap.from, to: gap.to });
    setSelectedId(null);
  }, []);

  // Disable/enable a clip — a disabled clip stays on the timeline (greyed) but is
  // skipped in playback (video shows nothing, audio is silent).
  const toggleDisable = useCallback((id) => {
    mapItem(id, (it) => ({ disabled: !it.disabled }));
  }, [mapItem]);

  // Delete just this gap: pull every later clip on the track left by its width.
  const removeGap = useCallback((trackId, gap) => {
    const w = gap.to - gap.from;
    mutate((tl) => {
      const t = tl.tracks.find((x) => x.id === trackId);
      if (t) for (const it of t.items) if (it.from >= gap.to - 0.5) it.from -= w;
      return tl;
    });
    setSelectedGap(null);
  }, [mutate]);

  // Reorder a video clip left/right in playback order, then close gaps.
  const reorderVideo = useCallback((id, dir) => {
    mutate((tl) => {
      const t = tl.tracks.find((x) => x.id === "video");
      if (!t) return tl;
      const items = t.items.slice().sort((a, b) => a.from - b.from);
      const i = items.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= items.length) return tl;
      [items[i], items[j]] = [items[j], items[i]];
      let cur = 0;
      for (const it of items) { it.from = cur; cur += it.durationInFrames; }
      t.items = items;
      return tl;
    });
  }, [mutate]);

  // Lay a track's clips end-to-end (gapless) in current start order.
  const closeGaps = useCallback((trackId) => {
    mutate((tl) => {
      const t = tl.tracks.find((x) => x.id === trackId);
      if (!t) return tl;
      const items = t.items.slice().sort((a, b) => a.from - b.from);
      let cur = 0;
      for (const it of items) { it.from = cur; cur += it.durationInFrames; }
      t.items = items;
      return tl;
    });
  }, [mutate]);

  const loadCut = useCallback(async (v) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/timeline/from-cut", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ v }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load cut");
      dirtyRef.current = false;
      histRef.current = [];
      setCanUndo(false);
      setTimeline(withSourceDurations(data.timeline));
      setSelectedId(null);
      setSelectedGap(null);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  /* ---- drag handling for move / resize ---- */
  const onDragStart = useCallback((e, item, mode) => {
    e.preventDefault();
    beginGesture(); // one undo step for the whole drag
    dragRef.current = {
      id: item.id, mode,
      startX: e.clientX,
      startFrom: item.from,
      startDur: item.durationInFrames,
      srcDur: item.sourceDurationInFrames, // resize cap (undefined = uncapped)
    };
    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const deltaFrames = ((ev.clientX - d.startX) / pxPerSec) * fps;
      if (d.mode === "move") {
        mapItem(d.id, { from: Math.max(0, Math.round(d.startFrom + deltaFrames)) }, true);
      } else {
        // Trim shorter freely; never stretch past the clip's real length.
        let next = Math.max(1, Math.round(d.startDur + deltaFrames));
        if (d.srcDur) next = Math.min(next, d.srcDur);
        mapItem(d.id, { durationInFrames: next }, true);
      }
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [pxPerSec, fps, mapItem]);

  // Click the ruler / empty track area → seek the player there.
  const seekFromEvent = useCallback((e) => {
    const el = trackAreaRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left + el.scrollLeft;
    const sec = x / pxPerSec;
    const f = Math.max(0, Math.min(durationInFrames - 1, Math.round(sec * fps)));
    playerRef.current?.seekTo(f);
    setFrame(f);
  }, [pxPerSec, fps, durationInFrames]);

  // Grab the playhead head and drag to scrub the video (continuous seek).
  const startScrub = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const move = (ev) => {
      const el = trackAreaRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = ev.clientX - rect.left + el.scrollLeft;
      const f = Math.max(0, Math.min(durationInFrames - 1, Math.round((x / pxPerSec) * fps)));
      playerRef.current?.seekTo(f);
      setFrame(f);
    };
    move(e);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, [pxPerSec, fps, durationInFrames]);

  const selected = useMemo(() => {
    if (!timeline || !selectedId) return null;
    for (const t of timeline.tracks) {
      const it = t.items.find((x) => x.id === selectedId);
      if (it) return { item: it, track: t };
    }
    return null;
  }, [timeline, selectedId]);

  const contentWidth = Math.max(600, durationSec * pxPerSec + 40);
  const playheadX = framesToSec(frame, fps) * pxPerSec;

  // Latest handlers/selection for the mount-once keyboard listener.
  keyCtxRef.current = { undo, selectedGap, selectedId, removeGap, removeItem, toggleDisable };

  if (loading && !timeline) return <Spinner label="loading editor…" />;

  const CutPicker = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Layers size={14} /> {timeline ? "Load another cut" : "Choose a cut"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-auto">
        <DropdownMenuLabel>Complete cuts</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {cuts.length === 0 ? (
          <DropdownMenuItem disabled>no stitched cuts yet</DropdownMenuItem>
        ) : (
          cuts.map((c) => (
            <DropdownMenuItem key={c.v} onSelect={() => loadCut(c.v)} className="gap-2">
              <Badge variant={c.withMusic ? "success" : "muted"} className="font-mono">v{c.v}</Badge>
              <span className="flex-1">{c.kind === "scored" ? "scored" : "stitch"}</span>
              <span className="text-xs text-muted-foreground">
                {c.clips} clips{c.withMusic ? ` · ${c.music} music` : ""}
              </span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="w-full min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold tracking-tight">Editor</h2>
          {timeline?.source && (
            <Badge variant="secondary" className="font-mono">
              from cut v{timeline.source.v}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {saveState === "saving" && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 size={12} className="animate-spin" /> saving…</span>}
          {saveState === "saved" && <span className="flex items-center gap-1 text-xs text-primary"><Check size={12} /> saved</span>}
          {saveState === "error" && <span className="text-xs text-destructive">save failed</span>}
          {CutPicker}
          <Button variant="outline" size="sm" onClick={load}><RefreshCw size={14} /> Refresh</Button>
        </div>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {!timeline ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <Wand2 className="mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No timeline yet. Pick a complete cut above to load its clips and music into the editor.
          </p>
        </div>
      ) : (
        <>
          {/* Player */}
          <div className="mx-auto w-full max-w-4xl overflow-hidden rounded-xl border bg-black">
            <Player
              ref={playerRef}
              component={EditorComposition}
              inputProps={{ tracks: timeline.tracks }}
              durationInFrames={durationInFrames}
              fps={fps}
              compositionWidth={timeline.width || 1280}
              compositionHeight={timeline.height || 720}
              style={{ width: "100%" }}
              controls
              pauseWhenBuffering
              acknowledgeRemotionLicense
            />
          </div>

          {/* Timeline toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm tabular-nums text-muted-foreground">
              <span className="text-foreground">{fmtTime(framesToSec(frame, fps))}</span>
              / {fmtTime(durationSec)}
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={undo} disabled={!canUndo} title="Undo last timeline edit (⌘Z)">
                <Undo2 size={14} /> Undo
              </Button>
              <Button variant="outline" size="sm" onClick={() => closeGaps("video")} title="Lay video clips end-to-end, removing gaps">
                <Scissors size={14} /> Close gaps
              </Button>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">zoom</span>
                <Slider
                  className="w-28"
                  min={20} max={220} step={5}
                  value={[pxPerSec]}
                  onValueChange={([v]) => setPxPerSec(v)}
                  aria-label="Timeline zoom"
                />
              </div>
            </div>
          </div>

          {/* Timeline tracks */}
          <div className="overflow-hidden rounded-xl border bg-muted/20">
            <div className="flex">
              {/* track labels */}
              <div className="w-24 shrink-0 border-r bg-card">
                <div className="h-7 border-b" />
                {timeline.tracks.map((t) => (
                  <div key={t.id} className="flex h-16 items-center gap-1.5 border-b px-3 text-xs font-medium">
                    {t.type === "audio" ? <Music size={13} /> : <Film size={13} />} {t.name}
                  </div>
                ))}
              </div>
              {/* scrollable lane area */}
              <div ref={trackAreaRef} className="relative min-w-0 flex-1 overflow-x-auto">
                <div style={{ width: contentWidth }}>
                  {/* ruler */}
                  <div className="relative h-7 border-b bg-card" onPointerDown={seekFromEvent}>
                    {Array.from({ length: Math.ceil(durationSec) + 1 }).map((_, s) => (
                      <div key={s} className="absolute top-0 h-full border-l border-border/60" style={{ left: s * pxPerSec }}>
                        <span className="ml-1 text-[10px] text-muted-foreground">{s}s</span>
                      </div>
                    ))}
                  </div>
                  {/* lanes — clicking empty space deselects (seeking is ruler-only) */}
                  {timeline.tracks.map((t) => (
                    <div
                      key={t.id}
                      className="relative h-16 border-b"
                      onPointerDown={(e) => { if (e.target === e.currentTarget) { setSelectedId(null); setSelectedGap(null); } }}
                    >
                      {/* selectable gaps between video clips */}
                      {t.type === "video" && gapsFor(t).map((g, gi) => {
                        const gsel = selectedGap && selectedGap.trackId === t.id
                          && selectedGap.from === g.from && selectedGap.to === g.to;
                        return (
                          <div
                            key={`gap-${gi}`}
                            className={cn(
                              "absolute top-1 bottom-1 rounded-md border border-dashed transition-colors",
                              gsel
                                ? "border-muted-foreground/60 bg-muted-foreground/30 ring-1 ring-muted-foreground/50"
                                : "border-transparent hover:bg-muted-foreground/10",
                            )}
                            style={{ left: framesToSec(g.from, fps) * pxPerSec, width: Math.max(4, framesToSec(g.to - g.from, fps) * pxPerSec) }}
                            onPointerDown={(e) => { e.stopPropagation(); selectGap(t.id, g); }}
                            title="Gap — click to select, Delete to close it"
                          />
                        );
                      })}
                      {t.items.map((item) => (
                        <TimelineItem
                          key={item.id}
                          item={item}
                          track={t}
                          pxPerSec={pxPerSec}
                          fps={fps}
                          selected={selectedId === item.id}
                          onSelect={selectItem}
                          onDragStart={onDragStart}
                          onToggleDisable={toggleDisable}
                          onRemove={removeItem}
                        />
                      ))}
                    </div>
                  ))}
                  {/* playhead — draggable head scrubs the video */}
                  <div className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-primary" style={{ left: playheadX }}>
                    <div
                      className="pointer-events-auto absolute -top-0.5 left-1/2 h-4 w-3 -translate-x-1/2 cursor-ew-resize rounded-b-[3px] rounded-t-sm bg-primary shadow ring-1 ring-primary/40 transition-transform hover:scale-110"
                      style={{ clipPath: "polygon(0 0, 100% 0, 100% 60%, 50% 100%, 0 60%)" }}
                      onPointerDown={startScrub}
                      title="Drag to scrub"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Inspector for the selected item */}
          {selected ? (
            <div className="rounded-xl border bg-card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {selected.track.type === "audio" ? <Music size={14} /> : <Film size={14} />}
                  <span className="truncate">{selected.item.name}</span>
                  {selected.item.bundle && <Badge variant="secondary" className="font-mono">{selected.item.bundle}</Badge>}
                </div>
                <div className="flex items-center gap-1.5">
                  {selected.track.id === "video" && (
                    <>
                      <Button variant="outline" size="icon-sm" onClick={() => reorderVideo(selected.item.id, -1)} title="Move earlier" aria-label="Move earlier"><ChevronLeft size={15} /></Button>
                      <Button variant="outline" size="icon-sm" onClick={() => reorderVideo(selected.item.id, 1)} title="Move later" aria-label="Move later"><ChevronRight size={15} /></Button>
                    </>
                  )}
                  <Button variant="destructive" size="sm" onClick={() => removeItem(selected.item.id)}><Trash2 size={13} /> Remove</Button>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="text-xs">
                  <div className="mb-1 text-muted-foreground">Start</div>
                  <div className="tabular-nums">{fmtTime(framesToSec(selected.item.from, fps))}</div>
                </div>
                <div className="text-xs">
                  <div className="mb-1 text-muted-foreground">Duration</div>
                  <div className="tabular-nums">{framesToSec(selected.item.durationInFrames, fps).toFixed(2)}s</div>
                </div>
                <div className="text-xs">
                  <div className="mb-1 flex items-center gap-1 text-muted-foreground">
                    {selected.item.muted || selected.item.volume === 0 ? <VolumeX size={12} /> : <Volume2 size={12} />} Volume
                  </div>
                  <div className="flex items-center gap-2">
                    <Slider
                      className="flex-1"
                      min={0} max={2} step={0.05}
                      value={[selected.item.muted ? 0 : selected.item.volume ?? 1]}
                      onPointerDownCapture={beginGesture}
                      onValueChange={([v]) => mapItem(selected.item.id, { volume: v, muted: false }, true)}
                      aria-label="Volume"
                    />
                    <span className="w-10 tabular-nums text-right">{Math.round((selected.item.muted ? 0 : selected.item.volume ?? 1) * 100)}%</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-center text-xs text-muted-foreground">
              Click a clip to trim, reorder, adjust volume or remove it. Drag a clip to move it, or its right edge to trim the end.
            </p>
          )}
        </>
      )}
    </div>
  );
}
