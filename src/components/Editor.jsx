// Editor tab — a Remotion-based video editor.
//
// Loads a "complete cut" setup (its ordered video clips + music bed) into an
// editable timeline, previews it live with <Player>, and lets you drag/trim/
// reorder/remove clips and set music volume. The timeline is the same JSON the
// chat agent edits (via /api/timeline*), so agent edits and manual edits stay
// in sync — the tab re-fetches on the header Refresh, after a chat turn, and
// live via the /api/timeline/events SSE stream whenever the agent edits.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player } from "@remotion/player";
import {
  Loader2, TriangleAlert, RefreshCw, Check, Scissors, Trash2,
  Film, Music, ChevronLeft, ChevronRight, Layers, Wand2, Volume2, VolumeX, Undo2,
  Eye, EyeOff, Clapperboard, Download, ExternalLink,
  PanelLeftClose, PanelLeftOpen, FolderOpen, Ban, FileDown,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
  ContextMenuShortcut, ContextMenuTrigger,
} from "@/components/ui/context-menu";

import EditorComposition from "@/editor/Composition";
import { timelineDuration, framesToSec } from "@/editor/timeline";
import { CLIENT_ID } from "@/lib/clientId";
import { getProjectId } from "@/lib/projectFetch";

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

const fmtBytes = (b) => {
  if (!Number.isFinite(b)) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};

// Grab the currently-painted frame of a <video> as a small JPEG data URL, used
// as the translucent "video frame" that follows the cursor while dragging a
// pool clip. Returns null for audio / not-yet-painted / tainted sources.
function captureVideoFrame(el) {
  try {
    if (!el || el.tagName !== "VIDEO" || !el.videoWidth) return null;
    const w = 180;
    const h = Math.max(1, Math.round(w * (el.videoHeight / el.videoWidth || 0.5625)));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").drawImage(el, 0, 0, w, h);
    return c.toDataURL("image/jpeg", 0.7);
  } catch {
    return null; // e.g. a frame not yet decoded
  }
}

/* ---- first-frame thumbnails for video timeline cards ---- */
// One thumbnail per source URL, captured client-side from an offscreen <video>
// (same-origin /gen/ files, so the canvas isn't tainted). Cached for the whole
// session — every timeline card and future card with the same src reuses it.
const videoThumbCache = new Map(); // src → dataURL | Promise<dataURL|null>

function getVideoThumb(src) {
  const hit = videoThumbCache.get(src);
  if (hit) return typeof hit === "string" ? Promise.resolve(hit) : hit;
  const p = new Promise((resolve) => {
    const v = document.createElement("video");
    let done = false;
    const finish = (url) => {
      if (done) return;
      done = true;
      v.removeAttribute("src");
      try { v.load(); } catch { /* releasing the element is best-effort */ }
      resolve(url);
    };
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.onerror = () => finish(null);
    v.onloadeddata = () => {
      // Nudge off frame 0 — some encodes paint black until the first real frame.
      try { v.currentTime = Math.min(0.1, (v.duration || 1) / 2); } catch { finish(null); }
    };
    v.onseeked = () => finish(captureVideoFrame(v));
    setTimeout(() => finish(null), 15000);
    v.src = src;
  }).then((url) => {
    if (url) videoThumbCache.set(src, url);
    else videoThumbCache.delete(src); // transient failure — allow a retry later
    return url;
  });
  videoThumbCache.set(src, p);
  return p;
}

// Latest cached thumbnail for a video src (null while capturing / for audio).
function useVideoThumb(src) {
  const cached = src ? videoThumbCache.get(src) : null;
  const [thumb, setThumb] = useState(typeof cached === "string" ? cached : null);
  useEffect(() => {
    if (!src) { setThumb(null); return undefined; }
    const hit = videoThumbCache.get(src);
    if (typeof hit === "string") { setThumb(hit); return undefined; }
    let on = true;
    getVideoThumb(src).then((url) => { if (on) setThumb(url); });
    return () => { on = false; };
  }, [src]);
  return thumb;
}

/* ---- waveform peaks for audio timeline cards ---- */
// Decode each audio src once (Web Audio) into ~1000 normalized peak buckets;
// cards draw their trimmed slice of these into a canvas at any zoom.
const audioPeaksCache = new Map(); // src → Float32Array | Promise<Float32Array|null>
let peaksAudioCtx = null; // shared decode-only AudioContext

function getAudioPeaks(src) {
  const hit = audioPeaksCache.get(src);
  if (hit) return hit instanceof Float32Array ? Promise.resolve(hit) : hit;
  const p = (async () => {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const buf = await res.arrayBuffer();
    peaksAudioCtx ||= new AudioContext();
    const audio = await peaksAudioCtx.decodeAudioData(buf);
    const ch0 = audio.getChannelData(0);
    const ch1 = audio.numberOfChannels > 1 ? audio.getChannelData(1) : null;
    const BUCKETS = 1000;
    const per = Math.max(1, Math.floor(ch0.length / BUCKETS));
    const stride = Math.max(1, Math.floor(per / 64)); // sample within a bucket, plenty for a 56px-tall wave
    const peaks = new Float32Array(BUCKETS);
    for (let b = 0; b < BUCKETS; b++) {
      let max = 0;
      const end = Math.min(ch0.length, (b + 1) * per);
      for (let i = b * per; i < end; i += stride) {
        const a = Math.abs(ch0[i]);
        if (a > max) max = a;
        if (ch1) {
          const c = Math.abs(ch1[i]);
          if (c > max) max = c;
        }
      }
      peaks[b] = max;
    }
    let m = 0;
    for (const v of peaks) if (v > m) m = v;
    if (m > 0) for (let i = 0; i < peaks.length; i++) peaks[i] /= m;
    return peaks;
  })().then(
    (peaks) => { audioPeaksCache.set(src, peaks); return peaks; },
    () => { audioPeaksCache.delete(src); return null; }, // allow a retry later
  );
  audioPeaksCache.set(src, p);
  return p;
}

function useAudioPeaks(src) {
  const cached = src ? audioPeaksCache.get(src) : null;
  const [peaks, setPeaks] = useState(cached instanceof Float32Array ? cached : null);
  useEffect(() => {
    if (!src) { setPeaks(null); return undefined; }
    const hit = audioPeaksCache.get(src);
    if (hit instanceof Float32Array) { setPeaks(hit); return undefined; }
    let on = true;
    getAudioPeaks(src).then((p) => { if (on) setPeaks(p); });
    return () => { on = false; };
  }, [src]);
  return peaks;
}

// The waveform painted across an audio card, with the fade envelope on top:
// the faded region is dimmed and bounded by the classic diagonal volume line.
// `trimFraction` is how much of the source the card currently shows (end-trim).
function Waveform({ peaks, width, trimFraction, fadeInPx, fadeOutPx, disabled }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !peaks) return;
    const H = 54; // card inner height: h-16 lane − top-1/bottom-1 − borders
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Cap the backing store so a long clip at high zoom can't allocate a huge
    // canvas — CSS stretches it back to the card, slightly soft is fine.
    const W = Math.max(1, Math.min(Math.round(width * dpr), 8192));
    canvas.width = W;
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext("2d");
    const h = canvas.height;
    const mid = h / 2;
    ctx.clearRect(0, 0, W, h);
    const n = Math.max(1, Math.round(peaks.length * Math.min(1, Math.max(0.001, trimFraction || 1))));
    ctx.fillStyle = disabled ? "rgba(161,161,170,0.45)" : "rgba(196,181,253,0.8)"; // zinc-400 / violet-300
    for (let x = 0; x < W; x++) {
      const i0 = Math.floor((x / W) * n);
      const i1 = Math.max(i0 + 1, Math.ceil(((x + 1) / W) * n));
      let a = 0;
      for (let i = i0; i < i1 && i < n; i++) if (peaks[i] > a) a = peaks[i];
      const half = Math.max(a, 0.02) * (mid - dpr);
      ctx.fillRect(x, mid - half, 1, half * 2);
    }
    const fi = Math.max(0, Math.min((fadeInPx / width) * W, W));
    const fo = Math.max(0, Math.min((fadeOutPx / width) * W, W));
    if (fi > 0 || fo > 0) {
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      if (fi > 0) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(fi, 0); ctx.lineTo(0, h); ctx.closePath(); ctx.fill(); }
      if (fo > 0) { ctx.beginPath(); ctx.moveTo(W, 0); ctx.lineTo(W - fo, 0); ctx.lineTo(W, h); ctx.closePath(); ctx.fill(); }
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = dpr;
      ctx.beginPath();
      if (fi > 0) { ctx.moveTo(0, h); ctx.lineTo(fi, 0); }
      if (fo > 0) { ctx.moveTo(W - fo, 0); ctx.lineTo(W, h); }
      ctx.stroke();
    }
  }, [peaks, width, trimFraction, fadeInPx, fadeOutPx, disabled]);
  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />;
}

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

// Height of one timeline lane, in px (must match the `h-16` on the lane divs).
// Used to place the "new channel" drop indicator between lanes.
const LANE_H = 64;

// Build a fresh empty track of the given media type, with an id/name that
// doesn't collide with existing tracks (video-2, video-3, music-2, …).
function makeTrack(tl, type) {
  const isAudio = type === "audio";
  const base = isAudio ? "music" : "video";
  const ids = new Set(tl.tracks.map((t) => t.id));
  let n = 2;
  while (ids.has(`${base}-${n}`)) n++;
  return { id: `${base}-${n}`, name: `${isAudio ? "Music" : "Video"} ${n}`, type, items: [] };
}

/* ---- one clip/music block on the timeline ---- */
function TimelineItem({ item, track, pxPerSec, fps, selected, onSelect, onDragStart, onFadeStart, onToggleDisable, onRemove }) {
  const left = framesToSec(item.from, fps) * pxPerSec;
  const width = Math.max(6, framesToSec(item.durationInFrames, fps) * pxPerSec);
  const isAudio = track.type === "audio";
  const disabled = !!item.disabled;
  const thumb = useVideoThumb(!isAudio ? item.src : null);
  const peaks = useAudioPeaks(isAudio ? item.src : null);
  const fadeInPx = framesToSec(item.fadeInFrames || 0, fps) * pxPerSec;
  const fadeOutPx = framesToSec(item.fadeOutFrames || 0, fps) * pxPerSec;
  // Waveform slice: end-trimming a clip shows only the played part of the source.
  const trimFraction = item.sourceDurationInFrames
    ? item.durationInFrames / item.sourceDurationInFrames
    : 1;
  const hasArt = isAudio ? !!peaks : !!thumb;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            "group absolute top-1 bottom-1 select-none overflow-hidden rounded-md border text-[11px] shadow-sm",
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
            if (!e.target.dataset?.handle) onDragStart(e, item, track, "move");
          }}
          title={item.name}
        >
          {/* filmstrip: the clip's first frame tiled across the card */}
          {!isAudio && thumb && !disabled && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage: `url(${thumb})`,
                backgroundSize: "auto 100%",
                backgroundRepeat: "repeat-x",
                backgroundPosition: "left center",
              }}
            />
          )}
          {/* waveform + fade envelope */}
          {isAudio && peaks && (
            <Waveform
              peaks={peaks}
              width={width}
              trimFraction={trimFraction}
              fadeInPx={fadeInPx}
              fadeOutPx={fadeOutPx}
              disabled={disabled}
            />
          )}
          {/* label strip */}
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 top-0 flex min-w-0 items-center gap-1 px-1.5 py-0.5",
              hasArt && !disabled && "bg-gradient-to-b from-black/60 to-transparent",
            )}
          >
            {disabled ? <EyeOff size={11} className="shrink-0" /> : isAudio ? <Music size={11} className="shrink-0" /> : <Film size={11} className="shrink-0" />}
            <span className="truncate">{item.name}</span>
          </div>
          {/* fade handles — the classic dots at the card's top corners; drag
              inward to lengthen the fade (the dot sits where the fade ends) */}
          {isAudio && !disabled && (
            <>
              <div
                data-handle="fade-in"
                onPointerDown={(e) => { e.stopPropagation(); onSelect(item.id); onFadeStart(e, item, "in"); }}
                className={cn(
                  "absolute top-0.5 z-10 h-2.5 w-2.5 -translate-x-1/2 cursor-ew-resize rounded-full border border-white/80 bg-violet-300 shadow transition-opacity",
                  selected || item.fadeInFrames ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                )}
                style={{ left: Math.min(Math.max(fadeInPx, 6), Math.max(6, width / 2)) }}
                title="Drag to set fade in"
              />
              <div
                data-handle="fade-out"
                onPointerDown={(e) => { e.stopPropagation(); onSelect(item.id); onFadeStart(e, item, "out"); }}
                className={cn(
                  "absolute top-0.5 z-10 h-2.5 w-2.5 -translate-x-1/2 cursor-ew-resize rounded-full border border-white/80 bg-violet-300 shadow transition-opacity",
                  selected || item.fadeOutFrames ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                )}
                style={{ left: Math.max(Math.min(width - fadeOutPx, width - 6), Math.min(width - 6, width / 2)) }}
                title="Drag to set fade out"
              />
            </>
          )}
          {/* right-edge resize handle */}
          <div
            data-handle="resize"
            onPointerDown={(e) => { e.stopPropagation(); onSelect(item.id); onDragStart(e, item, track, "resize"); }}
            className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-black/25 opacity-0 transition-opacity group-hover:opacity-100"
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

/* ---- media pool: one draggable source clip ---- */
// A video generation (or audio track) shown in the left rail. Pointer-down
// starts a drag onto the timeline; on metadata load it reports its natural
// duration up so a drop knows how long the clip should be.
function PoolCard({ item, active, onMeta, onDragStart }) {
  const mediaRef = useRef(null);
  const isVideo = item.mediaType === "video";
  return (
    <div
      className={cn(
        "group relative select-none overflow-hidden rounded-md border bg-card text-left transition-shadow",
        "cursor-grab active:cursor-grabbing hover:border-primary/50 hover:shadow-sm",
        item.selected && "ring-1 ring-emerald-500/50",
        active && "opacity-40",
      )}
      onPointerDown={(e) => { if (e.button !== 0) return; onDragStart(e, item, mediaRef.current); }}
      title={item.name}
    >
      {isVideo ? (
        <video
          ref={mediaRef}
          src={item.src}
          muted
          playsInline
          preload="metadata"
          className="pointer-events-none aspect-video w-full bg-black object-cover"
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            onMeta(item.id, v.duration);
            // Nudge to a painted frame so the drag ghost has a real thumbnail.
            try { v.currentTime = Math.min(0.1, (v.duration || 1) / 2); } catch { /* ignore */ }
          }}
        />
      ) : (
        <div className="flex aspect-video w-full items-center justify-center bg-violet-500/15">
          <Music size={20} className="text-violet-300" />
          <audio
            ref={mediaRef}
            src={item.src}
            preload="metadata"
            className="hidden"
            onLoadedMetadata={(e) => onMeta(item.id, e.currentTarget.duration)}
          />
        </div>
      )}
      <div className="flex items-center gap-1 px-1.5 py-1">
        {isVideo ? <Film size={10} className="shrink-0 text-emerald-400" /> : <Music size={10} className="shrink-0 text-violet-300" />}
        <span className="truncate text-[10px] font-medium">{item.name}</span>
      </div>
    </div>
  );
}

/* ---- media pool rail (collapsible, ~1/4 width, left of the player) ---- */
function MediaPool({ pool, collapsed, height, onToggle, dragId, onMeta, onDragStart }) {
  const video = pool.video || [];
  const audio = pool.audio || [];
  const total = video.length + audio.length;
  // Match the player's height (falls back to a viewport cap before it's measured)
  // so the pool's own list scrolls instead of stretching the tab.
  const style = height ? { height } : undefined;

  if (collapsed) {
    return (
      <div style={style} className="flex max-h-[70vh] w-9 shrink-0 flex-col items-center gap-2 rounded-xl border bg-muted/20 py-2">
        <Button variant="ghost" size="icon-sm" onClick={onToggle} title="Show media pool" aria-label="Show media pool">
          <PanelLeftOpen size={16} />
        </Button>
        <div className="mt-1 flex flex-1 items-center">
          <span className="rotate-180 text-[10px] font-medium tracking-wide text-muted-foreground [writing-mode:vertical-rl]">
            Media pool · {total}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div style={style} className="flex max-h-[70vh] w-1/4 min-w-[170px] max-w-[300px] shrink-0 flex-col overflow-hidden rounded-xl border bg-muted/20">
      <div className="flex items-center justify-between gap-1 border-b px-2.5 py-1.5">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <FolderOpen size={13} /> Media pool
          <Badge variant="muted" className="tabular-nums">{total}</Badge>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onToggle} title="Collapse media pool" aria-label="Collapse media pool">
          <PanelLeftClose size={16} />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {total === 0 ? (
          <p className="px-1 py-6 text-center text-[11px] text-muted-foreground">
            No generations yet. Render some clips and they'll show up here to drag onto the timeline.
          </p>
        ) : (
          <div className="space-y-3">
            {video.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1 px-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Film size={11} /> Video · {video.length}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {video.map((it) => (
                    <PoolCard key={it.id} item={it} active={dragId === it.id} onMeta={onMeta} onDragStart={onDragStart} />
                  ))}
                </div>
              </div>
            )}
            {audio.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1 px-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Music size={11} /> Audio · {audio.length}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {audio.map((it) => (
                    <PoolCard key={it.id} item={it} active={dragId === it.id} onMeta={onMeta} onDragStart={onDragStart} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
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
  // While dragging a card vertically: where it would land on release.
  //   { type: "move", trackId }  – drop onto an existing same-type channel
  //   { type: "new", at }        – spawn a new channel at track index `at`
  const [dropTarget, setDropTarget] = useState(null);
  const [cutPickerOpen, setCutPickerOpen] = useState(false); // "load a cut" modal
  // Media pool (draggable source generations) shown left of the player.
  const [pool, setPool] = useState({ video: [], audio: [] });
  const [poolCollapsed, setPoolCollapsed] = useState(false);
  // Active pool→timeline drag: the floating ghost + where it would land.
  //   { item, frameUrl, durationSec, x, y, drop }
  //   drop: null | { trackId, from, valid }
  const [poolDrag, setPoolDrag] = useState(null);
  // Render / "Deliver" panel state + Remotion options chosen before rendering.
  const [renderOpen, setRenderOpen] = useState(false);
  const [renderOut, setRenderOut] = useState("final_selection/renders/editor-render.mp4");
  const [renderCodec, setRenderCodec] = useState("h264");
  const [renderCrf, setRenderCrf] = useState(18);
  const [renderScale, setRenderScale] = useState(1);
  const [rendering, setRendering] = useState(false);
  const [renderResult, setRenderResult] = useState(null);
  const [renderError, setRenderError] = useState(null);
  const [exporting, setExporting] = useState(false); // "Export for Resolve" (FCPXML zip)

  const playerRef = useRef(null);
  const dragRef = useRef(null);
  const trackAreaRef = useRef(null);
  const lanesWrapRef = useRef(null); // wraps the stacked lanes, for drop hit-testing
  const dirtyRef = useRef(false); // suppress autosave right after a fetch
  const timelineRef = useRef(null); // latest timeline, for undo snapshots
  const histRef = useRef([]); // undo stack of JSON snapshots
  const inGestureRef = useRef(false); // true between pointer-down and up of a drag/slide
  const pendingReloadRef = useRef(false); // a live agent edit arrived mid-gesture; reload on release
  const [canUndo, setCanUndo] = useState(false);
  const poolDurRef = useRef({}); // pool item id → natural duration (sec), from media metadata
  const poolDragRef = useRef(null); // live pool-drag payload during a gesture
  const poolSeqRef = useRef(0); // monotonic suffix for ids of clips added from the pool
  const playerWrapRef = useRef(null); // player box — the media pool matches its height
  const [poolH, setPoolH] = useState(null); // measured player height (px) so the pool scrolls internally

  useEffect(() => { timelineRef.current = timeline; }, [timeline]);

  // Keep the media pool the same height as the player so its list scrolls
  // internally instead of stretching the whole tab. Tracks the player box live.
  useEffect(() => {
    const el = playerWrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setPoolH(el.offsetHeight));
    ro.observe(el);
    setPoolH(el.offsetHeight);
    return () => ro.disconnect();
  }, [timeline, poolCollapsed]);

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

  // MUST be referentially stable across re-renders: a fresh object here makes
  // the <Player> rebuild its internal video config every frame (the playhead
  // readout re-renders us ~24×/s), which restarts its playback clock and drops
  // it to ~half speed — the videos then run ahead and get seeked back every
  // couple of seconds.
  const playerInputProps = useMemo(() => ({ tracks: timeline?.tracks }), [timeline]);

  // `silent` refreshes in place without the full-panel spinner — used by the
  // live SSE reload so an agent edit doesn't flash the editor to a loading state.
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
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
      if (!silent) setLoading(false);
    }
  }, []);

  // Media pool loads independently of the timeline — it's just what exists on
  // disk, so a failure here never blocks the editor.
  const loadPool = useCallback(async () => {
    try {
      const res = await fetch("/api/pool");
      const data = await res.json();
      if (res.ok) setPool({ video: data.video || [], audio: data.audio || [] });
    } catch { /* leave the pool empty on failure */ }
  }, []);
  useEffect(() => { loadPool(); }, [loadPool, reloadKey]);

  useEffect(() => { load(); }, [load, reloadKey]);

  // Live-sync: reload when the timeline changes ELSEWHERE (the chat agent's
  // edit_timeline). Our own autosaves echo back with our CLIENT_ID and are
  // ignored. A foreign edit that lands mid-drag is deferred until pointer-up so
  // it doesn't yank the timeline out from under the gesture.
  useEffect(() => {
    const es = new EventSource("/api/timeline/events");
    const flush = () => {
      if (!pendingReloadRef.current) return;
      pendingReloadRef.current = false;
      load({ silent: true });
    };
    es.onmessage = (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch { return; } // heartbeats / malformed
      if (data.clientId === CLIENT_ID) return; // our own save echo
      if (inGestureRef.current) { pendingReloadRef.current = true; return; }
      load({ silent: true });
    };
    window.addEventListener("pointerup", flush);
    return () => { es.close(); window.removeEventListener("pointerup", flush); };
  }, [load]);

  // Autosave the whole timeline (debounced) whenever it changes from an edit.
  useEffect(() => {
    if (!timeline || !dirtyRef.current) return;
    setSaveState("saving");
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/timeline", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ timeline, clientId: CLIENT_ID }),
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

  // Reorder a video clip left/right in playback order, then close gaps. Operates
  // on whichever video channel the clip currently lives on.
  const reorderVideo = useCallback((id, dir) => {
    mutate((tl) => {
      const t = tl.tracks.find((x) => x.items.some((it) => it.id === id));
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

  // Lay every video channel's clips end-to-end (gapless) in current start order.
  const closeGapsAll = useCallback(() => {
    mutate((tl) => {
      for (const t of tl.tracks) {
        if (t.type !== "video") continue;
        const items = t.items.slice().sort((a, b) => a.from - b.from);
        let cur = 0;
        for (const it of items) { it.from = cur; cur += it.durationInFrames; }
        t.items = items;
      }
      return tl;
    });
  }, [mutate]);

  // Which channel a vertical drag would drop onto. Reads the live lane DOM rects
  // so it tracks zoom/scroll. Dragging PAST the top/bottom border of the whole
  // lane stack spawns a new channel there; hovering a different same-type lane
  // moves the clip onto it. Staying within the item's own lane does nothing
  // (so ordinary horizontal moves never accidentally create a channel).
  const computeDrop = useCallback((clientY, itemType, srcTrackId) => {
    const wrap = lanesWrapRef.current;
    if (!wrap) return null;
    const laneEls = Array.from(wrap.querySelectorAll("[data-lane]"));
    if (!laneEls.length) return null;
    const first = laneEls[0].getBoundingClientRect();
    const last = laneEls[laneEls.length - 1].getBoundingClientRect();
    if (clientY < first.top) return { type: "new", at: 0 };
    if (clientY > last.bottom) return { type: "new", at: laneEls.length };
    for (const el of laneEls) {
      const r = el.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) {
        if (el.dataset.lane === srcTrackId) return null;    // already here
        if (el.dataset.laneType !== itemType) return null;  // no cross-media moves
        return { type: "move", trackId: el.dataset.lane };
      }
    }
    return null;
  }, []);

  // Commit a vertical drag: pull the item out of its channel and either move it
  // onto an existing channel or into a brand-new one inserted at `drop.at`. Runs
  // silent — the drag already snapshotted once at pointer-down (one undo step).
  const applyDrop = useCallback((id, drop, type) => {
    mutate((tl) => {
      let moved = null, srcTrack = null;
      for (const t of tl.tracks) {
        const it = t.items.find((x) => x.id === id);
        if (it) { moved = it; srcTrack = t; break; }
      }
      if (!moved) return tl;
      if (drop.type === "move") {
        const dest = tl.tracks.find((t) => t.id === drop.trackId);
        if (!dest || dest === srcTrack) return tl;
        srcTrack.items = srcTrack.items.filter((x) => x.id !== id);
        dest.items.push(moved);
      } else if (drop.type === "new") {
        srcTrack.items = srcTrack.items.filter((x) => x.id !== id);
        const nt = makeTrack(tl, type);
        nt.items.push(moved);
        tl.tracks.splice(drop.at, 0, nt);
      }
      // Drop any now-empty channel we created earlier; keep the base two always.
      tl.tracks = tl.tracks.filter((t) => t.items.length > 0 || t.id === "video" || t.id === "music");
      return tl;
    }, true);
  }, [mutate]);

  /* ---- media pool → timeline drag ---- */
  // Record a pool item's natural length as its metadata loads, so a drop knows
  // how long the clip should be (falls back to 3s if it never loaded).
  const onPoolMeta = useCallback((id, dur) => {
    if (Number.isFinite(dur) && dur > 0) poolDurRef.current[id] = dur;
  }, []);

  // Where a pool clip would land, from the cursor position. The start frame
  // comes from X; the target comes from Y:
  //   { type:"new", at, from }        – near the top/bottom border → spawn a new
  //                                     matching-type channel there (always valid)
  //   { type:"lane", trackId, from }  – onto an existing lane; `valid` is false
  //                                     over the wrong media type (video only
  //                                     lands on video lanes, audio on audio).
  const computePoolDrop = useCallback((clientX, clientY, mediaType) => {
    const wrap = lanesWrapRef.current;
    const area = trackAreaRef.current;
    if (!wrap || !area) return null;
    const laneEls = Array.from(wrap.querySelectorAll("[data-lane]"));
    if (!laneEls.length) return null;
    const rect = area.getBoundingClientRect();
    const x = clientX - rect.left + area.scrollLeft;
    const from = Math.max(0, Math.round((x / pxPerSec) * fps));
    const first = laneEls[0].getBoundingClientRect();
    const last = laneEls[laneEls.length - 1].getBoundingClientRect();
    const EDGE = 14; // px band at the outer borders that spawns a NEW channel
    // Above the stack (incl. the ruler) or on the top border → new channel first.
    if (clientY < first.top + EDGE) return { type: "new", at: 0, from, valid: true };
    // On the bottom border or below the stack → new channel last.
    if (clientY > last.bottom - EDGE) return { type: "new", at: laneEls.length, from, valid: true };
    for (const el of laneEls) {
      const r = el.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) {
        return { type: "lane", trackId: el.dataset.lane, from, valid: el.dataset.laneType === mediaType };
      }
    }
    return null;
  }, [pxPerSec, fps]);

  // Drop a pool clip as a fresh timeline item carrying the media's natural length
  // (also its trim cap). `drop` decides whether it joins an existing lane or
  // spawns a brand-new matching-type channel at `drop.at`. Selects the new clip.
  const addPoolClip = useCallback((item, drop, durationSec) => {
    const newId = `pool_${item.mediaType}_${poolSeqRef.current++}_${Date.now()}`;
    const type = item.mediaType === "audio" ? "audio" : "video";
    mutate((tl) => {
      const dur = Math.max(1, Math.round((durationSec || 3) * (tl.fps || fps)));
      const newItem = {
        id: newId,
        src: item.src,
        name: item.name,
        from: Math.max(0, Math.round(drop.from)),
        durationInFrames: dur,
        sourceDurationInFrames: dur,
        volume: 1,
        ...(item.bundle ? { bundle: item.bundle } : {}),
      };
      if (drop.type === "new") {
        const nt = makeTrack(tl, type);
        nt.items.push(newItem);
        tl.tracks.splice(Math.min(drop.at, tl.tracks.length), 0, nt);
      } else {
        const t = tl.tracks.find((x) => x.id === drop.trackId);
        if (!t) return tl;
        t.items.push(newItem);
      }
      return tl;
    });
    setSelectedId(newId);
    setSelectedGap(null);
  }, [mutate, fps]);

  // Begin dragging a pool card. A translucent frame follows the cursor; over a
  // matching lane it becomes a translucent clip preview; releasing there commits.
  const startPoolDrag = useCallback((e, item, mediaEl) => {
    e.preventDefault();
    const frameUrl = captureVideoFrame(mediaEl);
    const durationSec = poolDurRef.current[item.id] || (mediaEl && Number.isFinite(mediaEl.duration) ? mediaEl.duration : 0) || 3;
    poolDragRef.current = { item, frameUrl, durationSec };
    setPoolDrag({ item, frameUrl, durationSec, x: e.clientX, y: e.clientY, drop: null });
    const onMove = (ev) => {
      const d = poolDragRef.current;
      if (!d) return;
      const drop = computePoolDrop(ev.clientX, ev.clientY, d.item.mediaType);
      d.drop = drop;
      setPoolDrag({ ...d, x: ev.clientX, y: ev.clientY, drop });
    };
    const onUp = () => {
      const d = poolDragRef.current;
      poolDragRef.current = null;
      setPoolDrag(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (d && d.drop && d.drop.valid) addPoolClip(d.item, d.drop, d.durationSec);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [computePoolDrop, addPoolClip]);

  const loadCut = useCallback(async (v) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/timeline/from-cut", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ v, clientId: CLIENT_ID }),
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

  // Render the current timeline to an mp4 via Remotion (server-side). Sends the
  // live in-editor timeline (not just the saved one) plus the chosen options so
  // what you see is what gets delivered.
  const runRender = useCallback(async () => {
    setRendering(true);
    setRenderError(null);
    setRenderResult(null);
    try {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timeline: timelineRef.current,
          out: renderOut,
          codec: renderCodec,
          crf: renderCrf,
          scale: renderScale,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Render failed");
      setRenderResult(data);
    } catch (e) {
      setRenderError(String(e.message || e));
    } finally {
      setRendering(false);
    }
  }, [renderOut, renderCodec, renderCrf, renderScale]);

  // "Export for Resolve" — persist the LIVE timeline, then let the browser stream
  // the FCPXML+media zip to disk via a plain <a download>. An <a> can't send the
  // x-project-id header, so the export URL carries ?projectId= instead.
  const runExport = useCallback(async () => {
    setExporting(true);
    setError(null);
    try {
      const res = await fetch("/api/timeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeline: timelineRef.current, clientId: CLIENT_ID }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Save failed");
      dirtyRef.current = false;
      const pid = getProjectId();
      const a = document.createElement("a");
      a.href = `/api/export/resolve${pid ? `?projectId=${encodeURIComponent(pid)}` : ""}`;
      a.download = "";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setExporting(false);
    }
  }, []);

  /* ---- drag handling for move / resize ---- */
  // A "move" drag slides the clip horizontally (its start frame) AND can carry it
  // to another channel vertically: over another same-type row it moves there;
  // into the top/bottom grab-band it spawns a new channel. The vertical target is
  // only previewed (dropTarget) during the drag and committed on release, so the
  // card itself just slides along its own lane until you let go.
  const onDragStart = useCallback((e, item, track, mode) => {
    e.preventDefault();
    beginGesture(); // one undo step for the whole drag
    dragRef.current = {
      id: item.id, mode,
      startX: e.clientX,
      startFrom: item.from,
      startDur: item.durationInFrames,
      srcDur: item.sourceDurationInFrames, // resize cap (undefined = uncapped)
      type: track.type,
      srcTrackId: track.id,
      drop: null,
    };
    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const deltaFrames = ((ev.clientX - d.startX) / pxPerSec) * fps;
      if (d.mode === "move") {
        mapItem(d.id, { from: Math.max(0, Math.round(d.startFrom + deltaFrames)) }, true);
        const drop = computeDrop(ev.clientY, d.type, d.srcTrackId);
        d.drop = drop;
        setDropTarget(drop);
      } else {
        // Trim shorter freely; never stretch past the clip's real length.
        let next = Math.max(1, Math.round(d.startDur + deltaFrames));
        if (d.srcDur) next = Math.min(next, d.srcDur);
        mapItem(d.id, { durationInFrames: next }, true);
      }
    };
    const onUp = () => {
      const d = dragRef.current;
      if (d && d.mode === "move" && d.drop) applyDrop(d.id, d.drop, d.type);
      dragRef.current = null;
      setDropTarget(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [pxPerSec, fps, mapItem, beginGesture, computeDrop, applyDrop]);

  // Drag a fade handle on an audio card: horizontal movement sets the fade
  // length in frames. Fades are clamped so fade-in + fade-out ≤ clip length.
  const onFadeStart = useCallback((e, item, which) => {
    e.preventDefault();
    beginGesture(); // one undo step for the whole drag
    const startX = e.clientX;
    const startFade = (which === "in" ? item.fadeInFrames : item.fadeOutFrames) || 0;
    const onMove = (ev) => {
      const deltaFrames = ((ev.clientX - startX) / pxPerSec) * fps;
      // Fade-in grows dragging right; fade-out grows dragging left.
      const want = Math.round(which === "in" ? startFade + deltaFrames : startFade - deltaFrames);
      mapItem(item.id, (it) => {
        const other = (which === "in" ? it.fadeOutFrames : it.fadeInFrames) || 0;
        const next = Math.max(0, Math.min(want, it.durationInFrames - other));
        return which === "in" ? { fadeInFrames: next } : { fadeOutFrames: next };
      }, true);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [pxPerSec, fps, mapItem, beginGesture]);

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
    <>
      <Button variant="outline" size="sm" onClick={() => setCutPickerOpen(true)}>
        <Layers size={14} /> {timeline ? "Load another cut" : "Choose a cut"}
      </Button>
      <Dialog open={cutPickerOpen} onOpenChange={setCutPickerOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Complete cuts</DialogTitle>
            <DialogDescription>
              Load a stitched cut's clips and music into the editor. This replaces the current timeline.
            </DialogDescription>
          </DialogHeader>
          {cuts.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No stitched cuts yet.</p>
          ) : (
            <div className="-mx-1 max-h-[60vh] space-y-1 overflow-y-auto px-1">
              {cuts.map((c) => (
                <button
                  key={c.v}
                  onClick={() => { loadCut(c.v); setCutPickerOpen(false); }}
                  className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <Badge variant={c.withMusic ? "success" : "muted"} className="font-mono">v{c.v}</Badge>
                  <span className="flex-1 font-medium">{c.kind === "scored" ? "scored" : "stitch"}</span>
                  <span className="text-xs text-muted-foreground">
                    {c.clips} clips{c.withMusic ? ` · ${c.music} music` : ""}
                  </span>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );

  // Small segmented button-group control (used for codec / scale options).
  const OptionGroup = ({ value, onChange, options }) => (
    <div className="inline-flex rounded-md border p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded px-2.5 py-1 text-xs font-medium transition-colors",
            value === o.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );

  const RenderPanel = (
    <>
      <Button size="sm" onClick={() => setRenderOpen(true)} disabled={!timeline} title="Render this timeline to an mp4">
        <Clapperboard size={14} /> Deliver
      </Button>
      <Sheet open={renderOpen} onOpenChange={setRenderOpen}>
        <SheetContent side="right" className="w-[495px] max-w-none gap-0 p-0 sm:max-w-none">
          <SheetHeader className="border-b pr-14">
            <SheetTitle className="flex items-center gap-2"><Clapperboard size={16} /> Deliver render</SheetTitle>
            <SheetDescription>
              Render the current timeline to an mp4 with Remotion. Set the options, then render.
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-5 overflow-y-auto p-5">
            {/* Composition summary */}
            <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/30 p-3 text-center text-xs">
              <div><div className="text-muted-foreground">Size</div><div className="font-medium tabular-nums">{timeline?.width || 1280}×{timeline?.height || 720}</div></div>
              <div><div className="text-muted-foreground">FPS</div><div className="font-medium tabular-nums">{fps}</div></div>
              <div><div className="text-muted-foreground">Duration</div><div className="font-medium tabular-nums">{fmtTime(durationSec)}</div></div>
            </div>

            {/* Remotion options */}
            <div className="space-y-1.5">
              <Label>Codec</Label>
              <div>
                <OptionGroup
                  value={renderCodec}
                  onChange={setRenderCodec}
                  options={[{ value: "h264", label: "H.264 (mp4)" }, { value: "h265", label: "H.265 (mp4)" }]}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Resolution scale</Label>
              <div>
                <OptionGroup
                  value={renderScale}
                  onChange={setRenderScale}
                  options={[{ value: 0.5, label: "0.5×" }, { value: 1, label: "1×" }, { value: 2, label: "2×" }]}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="render-crf">Quality (CRF)</Label>
                <span className="text-xs tabular-nums text-muted-foreground">{renderCrf} · lower = better</span>
              </div>
              <Slider
                id="render-crf"
                min={1} max={51} step={1}
                value={[renderCrf]}
                onValueChange={([v]) => setRenderCrf(v)}
                aria-label="CRF quality"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="render-out">Output file</Label>
              <Input
                id="render-out"
                value={renderOut}
                onChange={(e) => setRenderOut(e.target.value)}
                spellCheck={false}
                className="font-mono text-xs"
              />
              <p className="text-[11px] text-muted-foreground">Path relative to the project root. Must end in .mp4.</p>
            </div>

            <Separator />

            <Button onClick={runRender} disabled={rendering} className="w-full">
              {rendering ? <><Loader2 size={15} className="animate-spin" /> Rendering…</> : <><Clapperboard size={15} /> Render to mp4</>}
            </Button>

            {rendering && (
              <p className="text-center text-xs text-muted-foreground">
                Rendering in the background — this can take a while for long timelines. Keep this panel open.
              </p>
            )}

            {renderError && <ErrorNote>{renderError}</ErrorNote>}

            {renderResult && (
              <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-primary">
                  <Check size={15} /> Rendered
                </div>
                <div className="break-all font-mono text-xs text-muted-foreground">{renderResult.out}</div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{fmtBytes(renderResult.bytes)}</span>
                  <span>{renderResult.width}×{renderResult.height}</span>
                  <span>{renderResult.durationInFrames} frames @ {renderResult.fps}fps</span>
                  <span>{renderResult.codec} · crf {renderResult.crf} · {renderResult.scale}×</span>
                </div>
                <div className="flex gap-2">
                  <Button asChild variant="outline" size="sm">
                    <a href={renderResult.url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open</a>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <a href={renderResult.url} download={renderResult.file}><Download size={14} /> Download</a>
                  </Button>
                </div>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
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
          <Button
            variant="outline"
            size="sm"
            onClick={runExport}
            disabled={!timeline || exporting}
            title="Download a DaVinci Resolve timeline (FCPXML + media zip)"
          >
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
            Export for Resolve
          </Button>
          {RenderPanel}
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
          {/* Fixed top section: media pool (left, ~1/4, collapsible) + player */}
          <div className="flex items-start gap-4">
            <MediaPool
              pool={pool}
              collapsed={poolCollapsed}
              height={poolH}
              onToggle={() => setPoolCollapsed((c) => !c)}
              dragId={poolDrag?.item.id}
              onMeta={onPoolMeta}
              onDragStart={startPoolDrag}
            />
            <div ref={playerWrapRef} className="min-w-0 flex-1 self-start overflow-hidden rounded-xl border bg-black">
              <Player
                ref={playerRef}
                component={EditorComposition}
                inputProps={playerInputProps}
                durationInFrames={durationInFrames}
                fps={fps}
                compositionWidth={timeline.width || 1280}
                compositionHeight={timeline.height || 720}
                style={{ width: "100%" }}
                controls
                acknowledgeRemotionLicense
              />
            </div>
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
              <Button variant="outline" size="sm" onClick={closeGapsAll} title="Lay video clips end-to-end on every channel, removing gaps">
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
                  {/* lanes — clicking empty space deselects (seeking is ruler-only).
                      Wrapped so the "new channel" drop line can position between rows. */}
                  <div ref={lanesWrapRef} className="relative">
                  {timeline.tracks.map((t) => (
                    <div
                      key={t.id}
                      data-lane={t.id}
                      data-lane-type={t.type}
                      className={cn(
                        "relative h-16 border-b",
                        dropTarget?.type === "move" && dropTarget.trackId === t.id &&
                          "bg-primary/10 ring-2 ring-inset ring-primary/60",
                        poolDrag?.drop?.trackId === t.id && (poolDrag.drop.valid
                          ? "bg-primary/10 ring-2 ring-inset ring-primary/60"
                          : "bg-destructive/10 ring-2 ring-inset ring-destructive/50"),
                      )}
                      onPointerDown={(e) => { if (e.target === e.currentTarget) { setSelectedId(null); setSelectedGap(null); } }}
                    >
                      {/* translucent preview of the clip a pool drag would drop here */}
                      {poolDrag?.drop?.valid && poolDrag.drop.trackId === t.id && (
                        <div
                          className={cn(
                            "pointer-events-none absolute top-1 bottom-1 z-10 flex items-center gap-1 overflow-hidden rounded-md border px-1.5 text-[11px] opacity-70",
                            t.type === "audio"
                              ? "border-violet-400/60 bg-violet-500/30 text-violet-100"
                              : "border-emerald-400/60 bg-emerald-500/30 text-emerald-50",
                          )}
                          style={{
                            left: framesToSec(poolDrag.drop.from, fps) * pxPerSec,
                            width: Math.max(6, (poolDrag.durationSec || 3) * pxPerSec),
                          }}
                        >
                          {t.type === "audio" ? <Music size={11} className="shrink-0" /> : <Film size={11} className="shrink-0" />}
                          <span className="truncate">{poolDrag.item.name}</span>
                        </div>
                      )}
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
                          onFadeStart={onFadeStart}
                          onToggleDisable={toggleDisable}
                          onRemove={removeItem}
                        />
                      ))}
                    </div>
                  ))}
                  {/* "new channel" drop line — shown between rows while dragging a
                      card into the top/bottom grab-band */}
                  {dropTarget?.type === "new" && (
                    <div
                      className="pointer-events-none absolute left-0 right-0 z-30 h-0.5 -translate-y-1/2 bg-primary"
                      style={{ top: dropTarget.at * LANE_H }}
                    >
                      <span className="absolute left-2 -top-2.5 rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground shadow">
                        new channel
                      </span>
                    </div>
                  )}
                  {/* "new channel" line while dragging a clip in from the media pool */}
                  {poolDrag?.drop?.type === "new" && (
                    <div
                      className="pointer-events-none absolute left-0 right-0 z-30 h-0.5 -translate-y-1/2 bg-primary"
                      style={{ top: poolDrag.drop.at * LANE_H }}
                    >
                      <span className="absolute left-2 -top-2.5 rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground shadow">
                        new {poolDrag.item.mediaType === "audio" ? "music" : "video"} channel
                      </span>
                    </div>
                  )}
                  </div>
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
              <div className={cn("grid gap-4", selected.track.type === "audio" ? "sm:grid-cols-4" : "sm:grid-cols-3")}>
                <div className="text-xs">
                  <div className="mb-1 text-muted-foreground">Start</div>
                  <div className="tabular-nums">{fmtTime(framesToSec(selected.item.from, fps))}</div>
                </div>
                <div className="text-xs">
                  <div className="mb-1 text-muted-foreground">Duration</div>
                  <div className="tabular-nums">{framesToSec(selected.item.durationInFrames, fps).toFixed(2)}s</div>
                </div>
                {selected.track.type === "audio" && (
                  <div className="text-xs">
                    <div className="mb-1 text-muted-foreground">Fade in / out</div>
                    <div className="tabular-nums">
                      {framesToSec(selected.item.fadeInFrames || 0, fps).toFixed(1)}s
                      {" · "}
                      {framesToSec(selected.item.fadeOutFrames || 0, fps).toFixed(1)}s
                    </div>
                  </div>
                )}
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
              Drag it onto another channel — or up/down past the edge to spawn a new one; higher channels play on top.
              On audio clips, drag the dots at the top corners to fade in / out.
            </p>
          )}
        </>
      )}

      {/* Floating drag ghost: a translucent video frame that follows the cursor.
          Over a valid lane it hides (the lane shows the clip preview instead);
          over a wrong-type lane it shows a "no drop" badge. */}
      {poolDrag && !(poolDrag.drop && poolDrag.drop.type === "lane" && poolDrag.drop.valid) && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2"
          style={{ left: poolDrag.x, top: poolDrag.y }}
        >
          <div className={cn(
            "relative w-[180px] overflow-hidden rounded-md border shadow-xl",
            poolDrag.drop && !poolDrag.drop.valid ? "border-destructive/70 opacity-80" : "border-primary/60 opacity-70",
          )}>
            {poolDrag.frameUrl ? (
              <img src={poolDrag.frameUrl} alt="" className="block aspect-video w-full object-cover" />
            ) : (
              <div className="flex aspect-video w-full items-center justify-center bg-violet-500/25">
                <Music size={22} className="text-violet-200" />
              </div>
            )}
            <div className="truncate bg-background/85 px-1.5 py-1 text-[10px] font-medium">{poolDrag.item.name}</div>
            {poolDrag.drop && !poolDrag.drop.valid && (
              <div className="absolute inset-0 flex items-center justify-center bg-destructive/20">
                <Ban size={26} className="text-destructive drop-shadow" />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
