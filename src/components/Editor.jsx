// Editor tab — a Remotion-based video editor.
//
// Loads a "complete cut" setup (its ordered video clips + music bed) into an
// editable timeline, previews it live with <Player>, and lets you drag/trim/
// reorder/remove clips and set music volume. The timeline is the same JSON the
// chat agent edits (via /api/timeline*), so agent edits and manual edits stay
// in sync — the tab re-fetches on the header Refresh, after a chat turn, and
// live via the /api/timeline/events SSE stream whenever the agent edits.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Player } from "@remotion/player";
import {
  Loader2, TriangleAlert, RefreshCw, Check, Scissors, Trash2,
  Film, Music, ChevronLeft, ChevronRight, Layers, Wand2, Volume2, VolumeX, Undo2,
  Eye, EyeOff, Clapperboard, Download, ExternalLink,
  PanelLeftClose, PanelLeftOpen, FolderOpen, Ban, FileDown, FoldHorizontal, Magnet,
  ZoomIn, ZoomOut, Camera, Images, Link2, Unlink2, AudioLines, GripHorizontal,
  FlipHorizontal2, FlipVertical2, Radio, Timer,
  // Aliased: a bare `Image` import would shadow the DOM's global Image
  // constructor for this whole module.
  Image as ImageIcon, ImageOff, Sparkles, Plus, RefreshCcwDot,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

import { IconSwap } from "@/components/shared";
import EditorComposition from "@/editor/Composition";
import { timelineDuration, framesToSec, isImageItem, isSlateItem, normalizeItemKind } from "@/editor/timeline";
import { useAgent, agentIsBusy, renderAnimaticStillMessage } from "@/components/AgentProvider";
import { CLIENT_ID } from "@/lib/clientId";
import { getProjectId } from "@/lib/projectFetch";
import { toPreviewSrc } from "@/lib/previewSrc";

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

// Grab a <video>'s current frame at its FULL native resolution as a PNG data
// URL — used by "Grab still" (right-click the preview). Returns null if the
// element isn't a painted video or the canvas is tainted (cross-origin media).
function captureStillPng(el) {
  try {
    if (!el || el.tagName !== "VIDEO" || !el.videoWidth) return null;
    const c = document.createElement("canvas");
    c.width = el.videoWidth;
    c.height = el.videoHeight;
    c.getContext("2d").drawImage(el, 0, 0);
    return c.toDataURL("image/png");
  } catch {
    return null;
  }
}

// Capture a full-resolution still from the ORIGINAL source (the preview <video>
// plays the 720p proxy, so grabbing from it would yield a 1280×720 frame). Loads
// the original off-screen, seeks to `timeSec`, and captures at native res.
// Same-origin media, so the canvas stays untainted. Resolves { image, width,
// height } or null (unloadable / seek failure / >15s timeout).
function captureStillFromSource(src, timeSec) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    let done = false;
    const finish = (out) => {
      if (done) return;
      done = true;
      v.removeAttribute("src");
      try { v.load(); } catch { /* releasing the element is best-effort */ }
      resolve(out);
    };
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.onerror = () => finish(null);
    v.onloadeddata = () => {
      try { v.currentTime = Math.max(0, timeSec || 0); } catch { finish(null); }
    };
    v.onseeked = () => {
      const image = captureStillPng(v);
      finish(image ? { image, width: v.videoWidth, height: v.videoHeight } : null);
    };
    setTimeout(() => finish(null), 15000);
    v.src = src;
  });
}

// Which video clip is showing at composition frame `f`: the first (topmost —
// earlier tracks win z-order) non-disabled video item whose span covers `f`.
function itemAtFrame(timeline, f) {
  if (!timeline) return null;
  for (const track of timeline.tracks || []) {
    if (track.type !== "video") continue;
    for (const item of track.items || []) {
      if (item.disabled) continue;
      if (f >= item.from && f < item.from + (item.durationInFrames || 0)) return item;
    }
  }
  return null;
}

// Whether a split at frame `f` would cut anything: a selected clip strictly
// containing `f` (both halves ≥ 1 frame), or — when the selection doesn't
// apply — any non-disabled clip strictly containing it. Mirrors the targeting
// of splitAtPlayhead so the toolbar button greys out exactly when S no-ops.
function splittableAt(timeline, f, sel) {
  if (!timeline) return false;
  let any = false;
  for (const track of timeline.tracks || []) {
    for (const it of track.items || []) {
      const from = it.from || 0;
      if (!(f > from && f < from + (it.durationInFrames || 0))) continue;
      if (sel?.has(it.id)) return true;
      if (!it.disabled) any = true;
    }
  }
  return any;
}

/* ---- first-frame thumbnails for video timeline cards ---- */
// One thumbnail per source URL, captured client-side from an offscreen <video>
// (same-origin /gen/ files, so the canvas isn't tainted). Cached for the whole
// session — every timeline card and future card with the same src reuses it.
const videoThumbCache = new Map(); // src → dataURL | Promise<dataURL|null>

function getVideoThumb(src, atSec = 0) {
  // A clip with a source in-point (a split's right half) thumbnails at that
  // time, cached under its own key; plain clips keep the src-only key.
  const key = atSec ? `${src}#${atSec}` : src;
  const hit = videoThumbCache.get(key);
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
      // Seek to the in-point; with none, nudge off frame 0 — some encodes
      // paint black until the first real frame.
      const t = atSec > 0
        ? Math.min(atSec, Math.max(0, (v.duration || atSec) - 0.05))
        : Math.min(0.1, (v.duration || 1) / 2);
      try { v.currentTime = t; } catch { finish(null); }
    };
    v.onseeked = () => finish(captureVideoFrame(v));
    setTimeout(() => finish(null), 15000);
    // Load the lightweight proxy for the thumbnail; the cache stays keyed by the
    // original `src` so callers dedupe regardless of proxy availability.
    v.src = toPreviewSrc(src);
  }).then((url) => {
    if (url) videoThumbCache.set(key, url);
    else videoThumbCache.delete(key); // transient failure — allow a retry later
    return url;
  });
  videoThumbCache.set(key, p);
  return p;
}

// Latest cached thumbnail for a video src (null while capturing / for audio).
// While a new in-point's capture is in flight the previous thumb stays up.
function useVideoThumb(src, atSec = 0) {
  const key = src ? (atSec ? `${src}#${atSec}` : src) : null;
  const cached = key ? videoThumbCache.get(key) : null;
  const [thumb, setThumb] = useState(typeof cached === "string" ? cached : null);
  useEffect(() => {
    if (!key) { setThumb(null); return undefined; }
    const hit = videoThumbCache.get(key);
    if (typeof hit === "string") { setThumb(hit); return undefined; }
    let on = true;
    getVideoThumb(src, atSec).then((url) => { if (on) setThumb(url); });
    return () => { on = false; };
  }, [key, src, atSec]);
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
    // Waveforms only need amplitude, so decode the small aac proxy (~96kbps)
    // instead of pulling the full-quality track. Cache stays keyed by original.
    const res = await fetch(toPreviewSrc(src));
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
// `winStart`/`winEnd` (0..1 fractions of the source) bound the slice the card
// currently plays — [offsetFrames, offsetFrames + durationInFrames) — so a
// split or head-trimmed clip shows its own contiguous piece of the source.
function Waveform({ peaks, width, winStart = 0, winEnd = 1, fadeInPx, fadeOutPx, disabled }) {
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
    const n = peaks.length;
    const w0 = Math.max(0, Math.min(winStart || 0, 1));
    const w1 = Math.max(w0 + 0.001, Math.min(winEnd == null ? 1 : winEnd, 1));
    ctx.fillStyle = disabled ? "rgba(161,161,170,0.45)" : "rgba(196,181,253,0.8)"; // zinc-400 / violet-300
    for (let x = 0; x < W; x++) {
      const i0 = Math.floor((w0 + (x / W) * (w1 - w0)) * n);
      const i1 = Math.max(i0 + 1, Math.ceil((w0 + ((x + 1) / W) * (w1 - w0)) * n));
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
  }, [peaks, width, winStart, winEnd, fadeInPx, fadeOutPx, disabled]);
  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />;
}

// Normalize a loaded timeline: backfill each video clip's natural source
// length so it can't be stretched past its real duration (legacy timelines
// saved before the field existed), and normalize every item's `offsetFrames`
// (source in-point — absent means 0), defensively clamping the duration to
// what's left of the source past the in-point.
//
// IMAGE ITEMS ARE EXEMPT from both. A still has no natural length (its duration
// is whatever the animatic gave it) and no source timeline to seek into, so
// `normalizeItemKind` strips both fields instead. Backfilling
// `sourceDurationInFrames` here would silently cap every still at its current
// length and make it un-extendable.
function withSourceDurations(tl) {
  if (!tl) return tl;
  for (const t of tl.tracks || []) {
    for (const it of t.items || []) {
      if (isImageItem(it)) { normalizeItemKind(it); continue; }
      if (t.type === "video" && it.sourceDurationInFrames == null) {
        it.sourceDurationInFrames = it.durationInFrames;
      }
      it.offsetFrames = Math.max(0, Math.round(it.offsetFrames || 0));
      if (it.sourceDurationInFrames && it.offsetFrames + it.durationInFrames > it.sourceDurationInFrames) {
        it.durationInFrames = Math.max(1, it.sourceDurationInFrames - it.offsetFrames);
      }
    }
  }
  return tl;
}

// Every item sharing `linkId` across all tracks (the "link group") — e.g. a
// video clip plus its separated audio, or any clips linked by hand.
function linkGroupOf(tl, linkId) {
  const out = [];
  if (!tl || !linkId) return out;
  for (const t of tl.tracks || []) for (const it of t.items || []) if (it.linkId === linkId) out.push(it);
  return out;
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
const LANE_H = 64;
// The video and audio lane groups each show at most this many lanes before
// scrolling vertically (they sit on either side of the fixed divider).
const MAX_VISIBLE_LANES = 3;
const SNAP_PX = 8; // magnet pull radius in px (converted to frames at the current zoom)

// Candidate ruler intervals (in seconds) with how many minor ticks subdivide
// each major, labelled step. We pick the smallest step whose on-screen spacing
// clears the label-width target so labels never collide — the classic NLE ruler
// that gets denser as you zoom in and sparser as you zoom out.
const TICK_STEPS = [
  { step: 0.5, minors: 5 }, { step: 1, minors: 4 }, { step: 2, minors: 4 },
  { step: 5, minors: 5 }, { step: 10, minors: 5 }, { step: 15, minors: 3 },
  { step: 30, minors: 6 }, { step: 60, minors: 4 }, { step: 120, minors: 4 },
  { step: 300, minors: 5 }, { step: 600, minors: 5 }, { step: 900, minors: 3 },
  { step: 1800, minors: 6 }, { step: 3600, minors: 4 },
];

// Format seconds as a timecode label for the ruler. Below one hour we drop the
// hours field; when the tick step is sub-second we append a frames field so
// zoomed-in ticks stay distinct (e.g. 00:02:08:12).
function formatTimecode(totalSec, fps, withFrames) {
  const sign = totalSec < 0 ? "-" : "";
  const t = Math.abs(totalSec);
  const whole = Math.floor(t);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const pad = (n) => String(n).padStart(2, "0");
  const base = h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  if (!withFrames) return sign + base;
  const f = Math.round((t - whole) * fps);
  return `${sign}${base}:${pad(f)}`;
}

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
function TimelineItem({
  item, track, pxPerSec, fps, selected, linkHighlight, multiCount, canSplit,
  onSelect, onDragStart, onFadeStart, onToggleDisable, onRemove,
  onUnlink, onLinkSelected, onDetachAudio, onSplit, onNewStill, onSwapTake, takes,
}) {
  const left = framesToSec(item.from, fps) * pxPerSec;
  const width = Math.max(6, framesToSec(item.durationInFrames, fps) * pxPerSec);
  const isAudio = track.type === "audio";
  const isImage = isImageItem(item);
  const isSlate = isSlateItem(item);
  const disabled = !!item.disabled;
  // Thumbnail at the clip's in-point, quantized to whole seconds so a left-trim
  // drag doesn't spawn a capture per frame (the stale thumb shows meanwhile).
  // A still needs no capture — the image IS the thumbnail, and probing a PNG
  // through a <video> element would just fail.
  const thumbAtSec = isAudio ? 0 : Math.round(framesToSec(item.offsetFrames || 0, fps));
  const videoThumb = useVideoThumb(!isAudio && !isImage ? item.src : null, thumbAtSec);
  const thumb = isImage ? item.src : videoThumb;
  const peaks = useAudioPeaks(isAudio ? item.src : null);
  const fadeInPx = framesToSec(item.fadeInFrames || 0, fps) * pxPerSec;
  const fadeOutPx = framesToSec(item.fadeOutFrames || 0, fps) * pxPerSec;
  // Waveform window: the slice of the source the card currently plays —
  // [offsetFrames, offsetFrames + durationInFrames) of the full source.
  const srcDur = item.sourceDurationInFrames || 0;
  const winStart = srcDur ? Math.min(1, (item.offsetFrames || 0) / srcDur) : 0;
  const winEnd = srcDur ? Math.min(1, ((item.offsetFrames || 0) + item.durationInFrames) / srcDur) : 1;
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
                // Picture lane, three states at a glance: amber = a shot still
                // waiting on art, sky = a storyboard still, emerald = real footage.
                : isSlate
                  ? "border-amber-500/50 bg-amber-500/15 text-amber-100"
                  : isImage
                    ? "border-sky-500/40 bg-sky-500/20 text-sky-50"
                    : "border-emerald-500/40 bg-emerald-500/20 text-emerald-50",
            selected && "ring-2 ring-primary",
            linkHighlight && "ring-2 ring-primary/40",
          )}
          style={{ left, width }}
          onPointerDown={(e) => {
            if (e.button !== 0) return; // let right-click open the context menu
            onSelect(item.id, e);
            if (e.metaKey || e.ctrlKey) return; // cmd-click only toggles selection
            if (!e.target.dataset?.handle) onDragStart(e, item, track, "move");
          }}
          // The LANE is also a ContextMenuTrigger ("Add scene here…"), and Radix's
          // trigger only calls preventDefault on contextmenu — it never stops
          // propagation — so without this the event bubbles and BOTH menus open,
          // the lane's landing on top and hiding every per-clip action. Stop the
          // bubble, but never preventDefault here: Radix composes our handler
          // BEFORE its own and skips opening if the default was prevented, which
          // would kill this clip's own menu instead.
          onContextMenu={(e) => e.stopPropagation()}
          title={item.name}
        >
          {/* filmstrip: the clip's first frame tiled across the card. For a
              still this IS the correct filmstrip — every frame is that frame. */}
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
          {/* slate: a picture slot with no still generated yet — hatched so an
              unfilled hole is obvious at a glance, and not mistaken for footage */}
          {isSlate && !disabled && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-40"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(45deg, transparent 0 6px, rgba(251,191,36,0.35) 6px 12px)",
              }}
            />
          )}
          {/* waveform + fade envelope */}
          {isAudio && peaks && (
            <Waveform
              peaks={peaks}
              width={width}
              winStart={winStart}
              winEnd={winEnd}
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
            {disabled ? (
              <EyeOff size={11} className="shrink-0" />
            ) : isAudio ? (
              <Music size={11} className="shrink-0" />
            ) : isSlate ? (
              <ImageOff size={11} className="shrink-0" />
            ) : isImage ? (
              <ImageIcon size={11} className="shrink-0" />
            ) : (
              <Film size={11} className="shrink-0" />
            )}
            <span className="truncate">{item.name}</span>
            {item.linkId && <Link2 size={10} className="ml-auto shrink-0 opacity-70" aria-label="Linked clip" />}
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
          {/* left-edge trim handle — slides the in-point (head trim) */}
          <div
            data-handle="resize-start"
            onPointerDown={(e) => { e.stopPropagation(); onSelect(item.id); onDragStart(e, item, track, "resize-start"); }}
            className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-black/25 opacity-0 transition-opacity group-hover:opacity-100"
            title="Drag to trim the start"
          />
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
        {/* Storyboard actions. On a picture item these come first — filling a
            slate is the whole point of the animatic. `item.shot` is the
            provenance the modal needs; a clip with no shot (e.g. a pool drop)
            has no storyboard context, so the entry is hidden rather than
            offered-then-failed. */}
        {item.shot && (
          <>
            <ContextMenuItem onSelect={() => onNewStill?.(item.id)}>
              <span className="flex items-center gap-2">
                <Sparkles size={14} />
                {isSlate ? "Generate still…" : isImage ? "New still…" : "New still from this shot…"}
              </span>
            </ContextMenuItem>
            {isImage && takes?.length > 1 && (
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <span className="flex items-center gap-2"><RefreshCcwDot size={14} /> Swap take</span>
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  {takes.map((t) => (
                    <ContextMenuItem key={t.file} onSelect={() => onSwapTake?.(item.id, t)} disabled={t.file === item.stillFile}>
                      <span className="flex items-center gap-2">
                        <img src={t.url} alt="" className="h-6 w-10 rounded-sm bg-black object-cover" />
                        {t.angle || t.name}
                      </span>
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
            )}
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem onSelect={() => onSplit(item.id)} disabled={!canSplit}>
          <span className="flex items-center gap-2"><Scissors size={14} /> Split at playhead</span>
          <ContextMenuShortcut>S</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onToggleDisable(item.id)}>
          <span className="flex items-center gap-2">
            {disabled ? <Eye size={14} /> : <EyeOff size={14} />}
            {disabled ? "Enable clip" : "Disable clip"}
          </span>
          <ContextMenuShortcut>D</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        {/* Images have no audio track to detach — a still would clone a PNG (or,
            for a slate, `null`) onto an audio lane, which <Audio> rejects. */}
        {!isAudio && !isImage && !item.linkId && (
          <ContextMenuItem onSelect={() => onDetachAudio(item.id)}>
            <span className="flex items-center gap-2"><AudioLines size={14} /> Detach audio</span>
          </ContextMenuItem>
        )}
        {multiCount >= 2 && (
          <ContextMenuItem onSelect={onLinkSelected}>
            <span className="flex items-center gap-2"><Link2 size={14} /> Link selected clips ({multiCount})</span>
          </ContextMenuItem>
        )}
        {item.linkId && (
          <ContextMenuItem onSelect={() => onUnlink(item.id)}>
            <span className="flex items-center gap-2"><Unlink2 size={14} /> Unlink</span>
          </ContextMenuItem>
        )}
        {(multiCount >= 2 || item.linkId || !isAudio) && <ContextMenuSeparator />}
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

/* ---- media pool: one grabbed still ---- */
// A PNG frame grabbed from the preview. Click to open the full-size inspector.
function StillCard({ still, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(still)}
      title={still.sourceName || "Still"}
      className={cn(
        "group relative select-none overflow-hidden rounded-md border bg-card text-left transition-shadow",
        "cursor-pointer hover:border-primary/50 hover:shadow-sm",
      )}
    >
      <img src={still.url} alt="" loading="lazy" className="aspect-video w-full bg-black object-cover" />
      <div className="flex items-center gap-1 px-1.5 py-1">
        <Camera size={10} className="shrink-0 text-amber-400" />
        <span className="truncate text-[10px] font-medium">{still.sourceBundle || still.sourceName || "Still"}</span>
      </div>
    </button>
  );
}

/* ---- Scene modal: author ONE shot's still, from the timeline ----------------
 *
 * Opened from a picture item's context menu ("New still…" / "Generate still…")
 * or from empty picture-lane space ("Add scene here…"). It is the SAME component
 * for both: the only difference is whether the slot already exists.
 *
 * It exists because "generate a still for this slot" needs context the timeline
 * doesn't hold — the shot's action/camera/dialogue, the bundle's reference
 * images, and (crucially) the prompt a previous take was made from. It reads
 * that live from /api/shotlist + /api/storyboard rather than trusting the item,
 * because the shot may have been rewritten since the still was generated.
 */
function SceneDialog({ open, target, onOpenChange, onGenerate, busy }) {
  const [shot, setShot] = useState(null);
  const [takes, setTakes] = useState([]);
  const [prompt, setPrompt] = useState("");
  const [angle, setAngle] = useState("");
  const [reuse, setReuse] = useState(null); // a take to pass back as a reference
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  // For "add", the lane only SUGGESTS a shot — the user picks. Generating against
  // the wrong shot writes a take into an unrelated shot's list, so this must not
  // be a silent default.
  const [pickedShot, setPickedShot] = useState(null);

  useEffect(() => { setPickedShot(null); }, [target?.shot, target?.itemId]);

  const options = target?.shots || null; // [{ shot, bundle, … }] — "add" only
  const chosen = pickedShot ? options?.find((o) => o.shot === pickedShot) : null;
  const shotId = chosen?.shot || target?.shot || null;
  const bundleId = chosen?.bundle ?? target?.bundle ?? null;

  // Compose the default prompt the way the generate-storyboard skill does, from
  // the shot as it reads NOW. Used when no take has a stored prompt to reuse.
  const composeDefault = useCallback((s) => {
    if (!s) return "";
    const dlg = s.dialogue && !/\(no dialogue\)/i.test(s.dialogue) ? s.dialogue : null;
    return [
      "A single cinematic storyboard keyframe. Match the attached reference images for the location and each character — keep their exact appearance.",
      s.camera ? `Camera: ${s.camera}.` : null,
      s.action ? `Action at this instant: ${s.action}` : null,
      s.location ? `Setting: ${s.location}.` : null,
      dlg ? `The character is mid-line ("${dlg}") — use it for expression and pose only; this is one frame, not a sequence.` : null,
    ].filter(Boolean).join("\n");
  }, []);

  // Load the shot + its takes whenever the modal opens on a new slot.
  useEffect(() => {
    if (!open || !shotId) return;
    let cancelled = false;
    setLoading(true); setErr(null); setReuse(null); setAngle("");
    (async () => {
      try {
        const [slRes, sbRes] = await Promise.all([fetch("/api/shotlist"), fetch("/api/storyboard")]);
        const sl = await slRes.json();
        const sb = sbRes.ok ? await sbRes.json() : { stills: {} };
        if (cancelled) return;
        const s = (sl.shots || []).find((x) => x.id === shotId) || null;
        const list = (bundleId && sb.stills?.[bundleId]?.[shotId]) || [];
        setShot(s);
        setTakes(list);
        // Prefill from the take on screen, else the newest take, else compose
        // fresh from the shot. A stored prompt is what makes this a real
        // "regenerate with edits" rather than a guess.
        const current = list.find((t) => t.file === target?.stillFile);
        const seed = current || list[list.length - 1] || null;
        setPrompt(seed?.prompt || composeDefault(s));
      } catch (e) {
        if (!cancelled) setErr(String(e.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, shotId, bundleId, target?.stillFile, composeDefault]);

  const stale = shot && takes.length
    ? (() => {
        const snap = takes[takes.length - 1]?.shotSnapshot;
        return snap && (snap.action || "") !== (shot.action || "");
      })()
    : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImageIcon size={16} className="text-sky-400" />
            {target?.mode === "add" ? "Add scene" : "New still"} — {bundleId || "?"} / {shotId || "?"}
          </DialogTitle>
          <DialogDescription>
            {target?.mode === "add"
              ? "Reserves a slot on the picture track now; the still drops into it when the agent finishes."
              : "Generates another take for this shot and swaps it into this slot. Existing takes are kept."}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8"><Spinner label="loading shot…" /></div>
        ) : err ? (
          <ErrorNote>{err}</ErrorNote>
        ) : !shot ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Shot {shotId} isn’t in the shot list any more — it may have been renamed or removed.
          </p>
        ) : (
          <div className="space-y-3">
            {/* Which shot this scene is. Only "add" can choose — an existing
                item's shot is fixed by the slot it occupies. */}
            {options && (
              <div>
                <Label htmlFor="scene-shot" className="text-xs">Shot</Label>
                <select
                  id="scene-shot"
                  value={shotId || ""}
                  onChange={(e) => setPickedShot(e.target.value)}
                  className="mt-1 h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {options.map((o) => (
                    <option key={o.shot} value={o.shot}>
                      {o.shot}{o.bundle ? ` · ${o.bundle}` : ""}{o.still ? " — has a still" : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {/* shot context, live from the shot list */}
            <div className="rounded-md border bg-muted/30 p-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="font-mono">{shot.id}</Badge>
                {shot.location && <Badge variant="muted">{shot.location}</Badge>}
                {shot.camera && <Badge variant="muted">{shot.camera}</Badge>}
                {shot.dur > 0 && <Badge variant="muted">{shot.dur}s</Badge>}
              </div>
              {shot.action && <p className="mt-1.5 text-muted-foreground">{shot.action}</p>}
              {shot.dialogue && !/\(no dialogue\)/i.test(shot.dialogue) && (
                <p className="mt-1 text-muted-foreground"><span className="font-medium">Dialogue:</span> {shot.dialogue}</p>
              )}
            </div>

            {stale && (
              <p className="flex items-center gap-1.5 text-xs text-amber-400">
                <TriangleAlert size={12} /> the shot’s action changed since the last take was generated — the prompt below may be out of date.
              </p>
            )}

            {/* takes: swap instantly, or reuse one as a reference for a variation */}
            {takes.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  {takes.length} take{takes.length > 1 ? "s" : ""} — click to reuse as a reference for the new generation
                </p>
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {takes.map((t) => (
                    <button
                      key={t.file}
                      type="button"
                      onClick={() => setReuse(reuse?.file === t.file ? null : t)}
                      title={t.angle || t.name}
                      className={cn(
                        "relative shrink-0 overflow-hidden rounded border transition-shadow",
                        reuse?.file === t.file ? "border-primary ring-2 ring-primary" : "hover:border-primary/50",
                        t.file === target?.stillFile && "ring-1 ring-sky-500/60",
                      )}
                    >
                      <img src={t.url} alt="" className="h-16 w-28 bg-black object-cover" />
                      <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 text-[9px] text-white">
                        {t.angle || t.name}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <Label htmlFor="scene-prompt" className="text-xs">Prompt</Label>
              <Textarea
                id="scene-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={6}
                className="mt-1 text-xs"
              />
            </div>
            <div>
              <Label htmlFor="scene-angle" className="text-xs">Angle / variation note (optional)</Label>
              <Input
                id="scene-angle"
                value={angle}
                onChange={(e) => setAngle(e.target.value)}
                placeholder="e.g. low-angle CU"
                className="mt-1 h-8 text-xs"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                size="sm"
                disabled={busy || !prompt.trim()}
                // `bundleId` (not target.bundle) — the picker may have moved the
                // shot, and the bundle must follow it or the still is attached
                // under a bundle the animatic join never reads.
                onClick={() => onGenerate({ shot, bundle: bundleId, prompt: prompt.trim(), angle: angle.trim(), reuse })}
              >
                {busy ? <><Loader2 size={13} className="animate-spin" /> asking the agent…</> : <><Sparkles size={13} /> Generate</>}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---- Audio modal: drop a Sound Studio track onto an audio lane --------------
 *
 * The pool rail can already drag audio in, but a drag can't say "here, at this
 * exact frame" from a right-click, and the pool only lists each track's LATEST
 * render. This lists every ready version, grouped by kind, and inserts at the
 * frame that was right-clicked.
 */
function AudioDialog({ open, onOpenChange, onPick }) {
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true); setErr(null);
    (async () => {
      try {
        const res = await fetch("/api/sounds");
        const d = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(d.error || "Failed to load sounds");
        // Only versions whose media actually exists are insertable — the route
        // already drops the rest, and a version with no url would be a dead clip.
        const rows = [];
        for (const t of d.tracks || []) {
          for (const v of t.versions || []) {
            if (v.status === "ready" && v.url) {
              rows.push({
                key: `${t.id}_v${v.v}`,
                trackId: t.id,
                kind: t.kind || "sfx",
                name: t.name || t.id,
                v: v.v,
                url: v.url,
                duration: v.duration || 0,
                liked: !!v.liked,
              });
            }
          }
        }
        setTracks(rows);
      } catch (e) {
        if (!cancelled) setErr(String(e.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Music size={16} className="text-violet-400" /> Add audio</DialogTitle>
          <DialogDescription>Drops a Sound Studio take onto this lane at the point you clicked.</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="py-8"><Spinner label="loading sounds…" /></div>
        ) : err ? (
          <ErrorNote>{err}</ErrorNote>
        ) : !tracks.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No rendered sounds yet — make one in the Sound studio first.
          </p>
        ) : (
          <div className="-mx-1 max-h-[60vh] space-y-1 overflow-y-auto px-1">
            {tracks.map((t) => (
              <button
                key={t.key}
                onClick={() => onPick(t)}
                className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <Badge variant="muted" className="font-mono">v{t.v}</Badge>
                <span className="flex-1 truncate font-medium">{t.name}</span>
                <Badge variant="outline">{t.kind}</Badge>
                <span className="w-12 text-right text-xs text-muted-foreground">
                  {t.duration ? `${t.duration.toFixed(1)}s` : "—"}
                </span>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---- media pool rail (collapsible, ~1/4 width, left of the player) ---- */
function MediaPool({ pool, stills, collapsed, height, onToggle, dragId, onMeta, onDragStart, tab, onTab, onStillOpen }) {
  const video = pool.video || [];
  const audio = pool.audio || [];
  const total = video.length + audio.length;
  // Match the player's height (falls back to a viewport cap before it's measured)
  // so the pool's own list scrolls instead of stretching the tab.
  const style = height ? { height } : undefined;

  if (collapsed) {
    return (
      <div data-editor-region="library" style={style} className="flex max-h-[70vh] w-9 shrink-0 flex-col items-center gap-2 rounded-xl border bg-muted/20 py-2">
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
    <div data-editor-region="library" style={style} className="flex max-h-[70vh] w-1/4 min-w-[170px] max-w-[300px] shrink-0 flex-col overflow-hidden rounded-xl border bg-muted/20">
      <div className="flex items-center justify-between gap-1 border-b px-2.5 py-1.5">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <FolderOpen size={13} /> Media pool
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onToggle} title="Collapse media pool" aria-label="Collapse media pool">
          <PanelLeftClose size={16} />
        </Button>
      </div>
      <Tabs value={tab} onValueChange={onTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-2 mt-2 grid grid-cols-2">
          <TabsTrigger value="media" className="gap-1 text-[11px]">
            <Film size={11} /> Media <span className="tabular-nums opacity-60">{total}</span>
          </TabsTrigger>
          <TabsTrigger value="stills" className="gap-1 text-[11px]">
            <Images size={11} /> Stills <span className="tabular-nums opacity-60">{stills.length}</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="media" className="min-h-0 flex-1 overflow-y-auto p-2">
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
        </TabsContent>

        <TabsContent value="stills" className="min-h-0 flex-1 overflow-y-auto p-2">
          {stills.length === 0 ? (
            <p className="px-1 py-6 text-center text-[11px] text-muted-foreground">
              No stills yet. Right-click the preview and choose <span className="whitespace-nowrap font-medium">Grab still</span> to
              save the current frame here.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              {stills.map((s) => (
                <StillCard key={s.id} still={s} onOpen={onStillOpen} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ---- playhead resume ---------------------------------------------------------
 * The Editor is a lazy route that unmounts when you switch tabs, so returning to
 * it reloads the timeline from scratch and would drop the needle back at frame 0.
 * Remember the playhead per project in localStorage and restore it on mount so a
 * tab round-trip (or a reload) picks up where you left off. Keyed by project id
 * so each project resumes to its own spot. */
const PLAYHEAD_PREFIX = "editor-playhead:";

function readPlayhead(pid) {
  if (!pid) return 0;
  try {
    const raw = localStorage.getItem(PLAYHEAD_PREFIX + pid);
    const n = raw == null ? 0 : Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

function writePlayhead(pid, frame) {
  if (!pid) return;
  try {
    // Only persist a meaningful position; a near-zero start is the default, so
    // clear the key instead of pinning frame 0 as a stale resume point.
    if (frame > 1) localStorage.setItem(PLAYHEAD_PREFIX + pid, String(Math.floor(frame)));
    else localStorage.removeItem(PLAYHEAD_PREFIX + pid);
  } catch {
    /* storage unavailable (private mode, quota) — resume is best-effort */
  }
}

export default function Editor({ reloadKey }) {
  const [timeline, setTimeline] = useState(null);
  const [cuts, setCuts] = useState([]);
  const [radioVersions, setRadioVersions] = useState([]);
  const [animaticVersions, setAnimaticVersions] = useState([]);
  // The Scene modal's target: { mode:"add"|"new", shot, bundle, stillFile?, itemId? }.
  const [sceneTarget, setSceneTarget] = useState(null);
  const [sceneBusy, setSceneBusy] = useState(false);
  // The Audio modal's target lane: { trackId, from }.
  const [audioTarget, setAudioTarget] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null); // primary selection (inspector)
  const [selectedIds, setSelectedIds] = useState(() => new Set()); // full multi-selection
  const [selectedGap, setSelectedGap] = useState(null); // { trackId, from, to }
  const [marquee, setMarquee] = useState(null); // drag-select rect, in lanesWrap coords
  const [pxPerSec, setPxPerSec] = useState(70);
  const [frame, setFrame] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1); // JKL shuttle: >1 fast-forward, <0 rewind, 1 = normal
  const [magnet, setMagnet] = useState(true); // snapping toggle — clips snap to nearby edges
  const [playerH, setPlayerH] = useState(null); // preview height set by the timeline resizer (null = natural)
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  // "Commit pacing" (radio/animatic timelines only): write the paced timing
  // back to the Shot list durs so downstream generation matches this cut.
  const [committingPacing, setCommittingPacing] = useState(false);
  const [pacingNotice, setPacingNotice] = useState(null);
  // While dragging a card vertically: where it would land on release.
  //   { type: "move", trackId }  – drop onto an existing same-type channel
  //   { type: "new", at }        – spawn a new channel at track index `at`
  const [dropTarget, setDropTarget] = useState(null);
  const [cutPickerOpen, setCutPickerOpen] = useState(false); // "load a cut" modal
  // Media pool (draggable source generations) shown left of the player.
  const [pool, setPool] = useState({ video: [], audio: [] });
  const [poolCollapsed, setPoolCollapsed] = useState(false);
  const [poolTab, setPoolTab] = useState("media"); // "media" | "stills"
  // Stills grabbed from the preview, plus the currently-inspected still (modal).
  const [stills, setStills] = useState([]);
  const [stillModal, setStillModal] = useState(null);
  // The Scene modal drives generation through the chat agent (same pipeline the
  // Episode tab uses) rather than a bespoke render endpoint.
  const agent = useAgent();
  const [grabbing, setGrabbing] = useState(false);
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
  const [areaWidth, setAreaWidth] = useState(0); // visible width of the lane area, for fit-to-window zoom
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
  const magnetRef = useRef(true); // live snapping flag, read inside the drag handler
  const selectedIdsRef = useRef(new Set()); // live multi-selection, read inside drag handlers
  const videoLabelsRef = useRef(null); // video-group label rail, scroll-synced to its lane group
  const audioLabelsRef = useRef(null); // audio-group label rail, scroll-synced to its lane group
  const frameRef = useRef(0); // live playhead frame, a snap target during a move drag
  const playingRef = useRef(false); // true while the <Player> is playing, gates auto-follow scroll
  const playbackRateRef = useRef(1); // live shuttle rate, read synchronously by the mount-once key listener
  const shuttleActiveRef = useRef(false); // true while a J/L shuttle is engaged, so repeats double instead of restarting
  // Playhead resume: the saved frame to restore once the timeline mounts (null
  // after it's applied, so an edit-driven timeline change never re-yanks it), and
  // the last time we persisted (to throttle the ~24×/s frameupdate writes).
  const resumeFrameRef = useRef(null);
  const lastPlayheadWriteRef = useRef(0);
  // Which editor region the pointer last landed in — drives whether Space toggles
  // playback. Space works after clicking the preview or timeline, but not the media
  // pool. (Remotion's own Space handler is focus-scoped and drops after any click.)
  const spaceAllowedRef = useRef(true);
  const laneMenuRef = useRef(null); // { trackId, from } of the last lane right-click
  const zoomScrollRef = useRef(null); // pending scrollLeft to apply after a zoom, keeps the playhead anchored
  const [snapLine, setSnapLine] = useState(null); // frame of the active snap guide (null = none)

  useEffect(() => { timelineRef.current = timeline; }, [timeline]);
  useEffect(() => { magnetRef.current = magnet; }, [magnet]);
  useEffect(() => { frameRef.current = frame; }, [frame]);
  useEffect(() => { playbackRateRef.current = playbackRate; }, [playbackRate]);

  // On mount, read this project's saved playhead so the restore effect below can
  // drop the needle there once the timeline is up. Runs once — a project switch
  // remounts the whole tab (RootLayout keys <main> on the project), giving a fresh
  // Editor that reads the new project's spot.
  useEffect(() => { resumeFrameRef.current = readPlayhead(getProjectId()); }, []);

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

  // Apply the saved playhead the first time the timeline is available. Nulling the
  // ref makes this fire exactly once per mount, so later timeline changes (edits,
  // live agent reloads) never yank the needle back. Deferred a tick so the <Player>
  // is mounted and can accept the seek. Declared here (not with the other mount
  // effects above) so `fps`/`durationInFrames` are already initialized.
  useEffect(() => {
    if (!timeline || resumeFrameRef.current == null) return;
    const f = Math.min(resumeFrameRef.current, Math.max(0, durationInFrames - 1));
    resumeFrameRef.current = null;
    if (f <= 0) return;
    const t = setTimeout(() => {
      playerRef.current?.seekTo(f);
      setFrame(f);
      // Bring the restored playhead into view (it may be well past the left edge).
      const el = trackAreaRef.current;
      if (el) {
        const px = framesToSec(f, fps) * pxPerSec;
        if (px > el.scrollLeft + el.clientWidth || px < el.scrollLeft) {
          el.scrollLeft = Math.max(0, px - el.clientWidth / 2);
        }
      }
    }, 0);
    return () => clearTimeout(t);
  }, [timeline, durationInFrames, fps, pxPerSec]);

  // Track the visible lane-area width so the zoom-out floor can fit the whole
  // project on screen (the ruler adds ~40px of trailing pad; see contentWidth).
  useEffect(() => {
    const el = trackAreaRef.current;
    if (!el) return;
    const measure = () => setAreaWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [timeline]);

  // Zoom (px/sec) needed to fit the entire timeline in the visible area. This is
  // the slider's dynamic minimum so "fully zoomed out" always shows every clip.
  const fitPxPerSec = useMemo(() => {
    if (!areaWidth || durationSec <= 0) return 20;
    return Math.max(2, (areaWidth - 40) / durationSec);
  }, [areaWidth, durationSec]);
  const minZoom = Math.min(fitPxPerSec, 20); // never force a floor above the default range
  const maxZoom = 220;

  // Keep the current zoom within the (dynamic) allowed range as the project
  // length / viewport width — and thus the fit-to-window floor — change.
  useEffect(() => {
    setPxPerSec((z) => Math.min(maxZoom, Math.max(minZoom, z)));
  }, [minZoom]);

  // Zoom to an absolute px/sec, keeping the playhead pinned as the reference
  // point — the way every NLE behaves. We hold the playhead at its current
  // on-screen x while the timeline scales around it; if it's currently off
  // screen, we bring it to the centre so it never gets lost when zooming.
  // The new scrollLeft is stashed and applied in a layout effect once the
  // wider/narrower content has rendered (see below).
  const zoomTo = useCallback((nextRaw) => {
    setPxPerSec((prev) => {
      const next = Math.min(maxZoom, Math.max(minZoom, Math.round(nextRaw)));
      const el = trackAreaRef.current;
      if (el && next !== prev) {
        const view = el.clientWidth;
        const timeSec = framesToSec(frameRef.current, fps);
        const viewX = timeSec * prev - el.scrollLeft; // playhead x within the viewport
        const anchor = viewX < 0 || viewX > view ? view / 2 : viewX;
        zoomScrollRef.current = Math.max(0, timeSec * next - anchor);
      }
      return next;
    });
  }, [minZoom, maxZoom, fps]);

  // Per-click zoom step for the −/+ buttons flanking the slider. Zoom reads
  // perceptually as a ratio, so step multiplicatively (25%/click). `factor` > 1
  // zooms in. Rounding keeps repeated clicks on tidy values instead of drifting.
  const ZOOM_STEP = 1.25;
  const zoomBy = useCallback((factor) => {
    zoomTo(pxPerSec * factor);
  }, [zoomTo, pxPerSec]);

  // Apply the playhead-anchored scroll once the new zoom has laid out. Runs
  // before paint so the view never flashes at the wrong offset.
  useLayoutEffect(() => {
    if (zoomScrollRef.current == null) return;
    const el = trackAreaRef.current;
    if (el) el.scrollLeft = zoomScrollRef.current;
    zoomScrollRef.current = null;
  }, [pxPerSec]);

  // MUST be referentially stable across re-renders: a fresh object here makes
  // the <Player> rebuild its internal video config every frame (the playhead
  // readout re-renders us ~24×/s), which restarts its playback clock and drops
  // it to ~half speed — the videos then run ahead and get seeked back every
  // couple of seconds.
  //
  // Video clips preview the 720p proxy (toPreviewSrc) so scrubbing moves far
  // fewer bytes. This rewrite lives ONLY here — the `timeline` state, the
  // autosaved doc (POST /api/timeline), and the Deliver render all keep the
  // original srcs, so headless export is untouched and duration stays
  // authoritative. Audio tracks stay on originals (proxy duration can differ by
  // ≲1 frame; waveforms use the proxy separately in getAudioPeaks).
  const playerInputProps = useMemo(() => {
    const tracks = (timeline?.tracks || []).map((t) =>
      t.type === "audio"
        ? t
        : { ...t, items: (t.items || []).map((it) => ({ ...it, src: toPreviewSrc(it.src) })) },
    );
    return { tracks };
  }, [timeline]);

  // `silent` refreshes in place without the full-panel spinner — used by the
  // live SSE reload so an agent edit doesn't flash the editor to a loading state.
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) { setLoading(true); setPacingNotice(null); }
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
      setRadioVersions(data.radioVersions || []);
      setAnimaticVersions(data.animaticVersions || []);
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

  // Stills load independently too — same "just what exists" contract as the pool.
  const loadStills = useCallback(async () => {
    try {
      const res = await fetch("/api/stills");
      const data = await res.json();
      if (res.ok) setStills(data.stills || []);
    } catch { /* leave stills empty on failure */ }
  }, []);
  useEffect(() => { loadStills(); }, [loadStills, reloadKey]);

  // Storyboard takes for "Swap take", keyed `<bundle>/<shot>` — the same
  // composite key db.stills uses. Keying by shot alone would let a shot id that
  // appears under two bundles (which the positional pack ids make possible)
  // overwrite the other's takes and offer the wrong images.
  // Distinct from `stills` above, which is the grabbed-frames pool: these are
  // the generated per-shot keyframes the animatic's picture track shows.
  const [takesByShot, setTakesByShot] = useState({});
  const loadTakes = useCallback(async () => {
    try {
      const res = await fetch("/api/storyboard");
      if (!res.ok) return;
      const data = await res.json();
      const bag = {};
      for (const [bundle, shots] of Object.entries(data.stills || {})) {
        for (const [shot, list] of Object.entries(shots || {})) {
          bag[`${bundle}/${shot}`] = (list || []).map((t) => ({ ...t, bundle, shot }));
        }
      }
      setTakesByShot(bag);
    } catch { /* the menu just won't offer takes */ }
  }, []);
  // reloadKey covers the Refresh button and project switch; the agent attaching a
  // new take also fires the /api/data firehose, which bumps it.
  useEffect(() => { loadTakes(); }, [loadTakes, reloadKey]);

  // "Grab still" — capture the preview's current frame as a full-res PNG, tag it
  // with the clip showing at the playhead + composition provenance, and save it.
  const grabStill = useCallback(async () => {
    const f = Math.round(frameRef.current);
    const clip = itemAtFrame(timeline, f);

    const wrap = playerWrapRef.current;
    const vids = wrap ? [...wrap.querySelectorAll("video")] : [];
    const painted = vids.filter((v) => v.videoWidth && v.readyState >= 2);
    // Several clips can be premounted at once — prefer the <video> whose source
    // is the clip showing at the playhead so the frame matches its metadata. The
    // preview plays the PROXY, so match against the proxy src.
    const matched = clip && painted.find((v) => (v.currentSrc || v.src || "").includes(toPreviewSrc(clip.src)));
    const el = matched || painted[0] || vids.find((v) => v.videoWidth);
    if (!el) { setError("Couldn't grab a still — the frame isn't ready yet (or the media is cross-origin)."); return; }

    // Stills stay FULL-RES: capture from the original at the exact source time
    // the preview <video> is displaying (matched.currentTime). Fall back to the
    // on-screen proxy frame (flagged meta.proxy) if the original can't be loaded.
    let image = null, width = 0, height = 0, fromProxy = false;
    if (matched && clip?.src) {
      const full = await captureStillFromSource(clip.src, matched.currentTime);
      if (full) { image = full.image; width = full.width; height = full.height; }
    }
    if (!image) {
      image = captureStillPng(el);
      width = el.videoWidth;
      height = el.videoHeight;
      fromProxy = true;
    }
    if (!image) { setError("Couldn't grab a still — the frame isn't ready yet (or the media is cross-origin)."); return; }

    const meta = {
      width,
      height,
      frame: f,
      fps,
      timeSec: framesToSec(f, fps),
      sourceName: clip?.name || null,
      sourceSrc: clip?.src || null,
      sourceBundle: clip?.bundle || null,
      clipTimeSec: clip ? framesToSec(f - clip.from, fps) : null,
      cut: timeline?.source || null,
      ...(fromProxy ? { proxy: true } : {}),
    };

    setGrabbing(true);
    try {
      const res = await fetch("/api/stills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image, meta, clientId: CLIENT_ID }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "save failed");
      setPoolCollapsed(false);
      setPoolTab("stills");
      await loadStills();
    } catch (e) {
      setError(`Failed to save still: ${String(e.message || e)}`);
    } finally {
      setGrabbing(false);
    }
  }, [timeline, fps, loadStills]);

  // Remove a still (its R2 object + record), closing the inspector if it's open.
  const deleteStill = useCallback(async (id) => {
    setStills((prev) => prev.filter((s) => s.id !== id)); // optimistic
    setStillModal((m) => (m?.id === id ? null : m));
    try {
      await fetch(`/api/stills/${id}?clientId=${encodeURIComponent(CLIENT_ID)}`, { method: "DELETE" });
    } catch { /* the SSE firehose / next load reconciles */ }
  }, []);

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

  // Sync the playhead readout to the <Player>'s current frame, and — while
  // playing — keep the playhead in view. Like a real NLE, the view holds still
  // while the playhead sweeps across it; once the playhead runs off the right
  // edge of the visible lane area (or gets left behind on the left), we page the
  // scroll so the playhead lands back in the middle, revealing the upcoming
  // timeline. It keeps sweeping and re-centers again each time it hits the edge.
  // Gated on `playingRef` so manual scrubbing/seeking never fights the scroll.
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const onFrame = (e) => {
      const f = e.detail.frame;
      setFrame(f);
      // Persist the playhead so a tab round-trip resumes here, at most ~once/sec
      // (this fires ~24×/s during playback). The final spot is flushed on unmount.
      const now = Date.now();
      if (now - lastPlayheadWriteRef.current >= 1000) {
        lastPlayheadWriteRef.current = now;
        writePlayhead(getProjectId(), f);
      }
      if (!playingRef.current) return;
      const el = trackAreaRef.current;
      if (!el) return;
      const px = framesToSec(f, fps) * pxPerSec;
      const view = el.clientWidth;
      // Out of view (past the right edge or behind the left edge) → re-center.
      if (px > el.scrollLeft + view || px < el.scrollLeft) {
        el.scrollLeft = Math.max(0, px - view / 2);
      }
    };
    const onPlay = () => { playingRef.current = true; };
    const onPause = () => { playingRef.current = false; };
    p.addEventListener("frameupdate", onFrame);
    p.addEventListener("play", onPlay);
    p.addEventListener("pause", onPause);
    return () => {
      p.removeEventListener("frameupdate", onFrame);
      p.removeEventListener("play", onPlay);
      p.removeEventListener("pause", onPause);
    };
  }, [timeline, fps, pxPerSec]);

  // Flush the final playhead on the way out — leaving the tab (unmount) or a
  // reload/close (pagehide) — so the ~1s write throttle never drops the last spot.
  useEffect(() => {
    const flush = () => writePlayhead(getProjectId(), frameRef.current);
    window.addEventListener("pagehide", flush);
    return () => {
      flush();
      window.removeEventListener("pagehide", flush);
    };
  }, []);

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
    setSelectedIds(new Set());
    selectedIdsRef.current = new Set();
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
        else if (ctx.hasSelection) { e.preventDefault(); ctx.removeSelected?.(); }
      }
      if ((e.key === "d" || e.key === "D") && !typing && !e.metaKey && !e.ctrlKey && ctx.selectedId) {
        e.preventDefault();
        ctx.toggleDisable?.(ctx.selectedId);
      }
      // S splits ("razors") the clip(s) under the playhead in two.
      if ((e.key === "s" || e.key === "S") && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        ctx.splitAtPlayhead?.();
        return;
      }
      // Space toggles playback when the last click was in the preview or timeline
      // (not the media pool). We drive the Remotion player imperatively because its
      // built-in Space handling only fires while the player itself holds focus.
      if ((e.code === "Space" || e.key === " ") && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && spaceAllowedRef.current) {
        e.preventDefault();
        ctx.resetShuttle?.(); // pausing/playing always drops back to normal speed
        playerRef.current?.toggle?.();
        return;
      }
      // J / L shuttle: J rewinds, L fast-forwards; each same-direction repeat
      // doubles the speed (see `shuttle`). The opposite key flips direction.
      if ((e.key === "j" || e.key === "J") && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && ctx.hasTimeline) {
        e.preventDefault();
        ctx.shuttle?.(-1);
        return;
      }
      if ((e.key === "l" || e.key === "L") && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && ctx.hasTimeline) {
        e.preventDefault();
        ctx.shuttle?.(1);
        return;
      }
      // Arrow keys navigate the timeline: Left/Right step the playhead one frame
      // back/forward; Up/Down jump to the previous/next clip cut (playhead-anchored).
      if (!typing && ctx.hasTimeline && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key === "ArrowLeft")  { e.preventDefault(); ctx.stepFrame?.(-1); }
        else if (e.key === "ArrowRight") { e.preventDefault(); ctx.stepFrame?.(1); }
        else if (e.key === "ArrowUp")   { e.preventDefault(); ctx.gotoClip?.(-1); }
        else if (e.key === "ArrowDown") { e.preventDefault(); ctx.gotoClip?.(1); }
      }
    };
    // Track the last-clicked editor region so Space knows whether to toggle
    // playback. Only marked regions change it; clicks elsewhere leave it as-is.
    const onPointerDown = (e) => {
      const el = e.target?.closest?.("[data-editor-region]");
      if (el) spaceAllowedRef.current = el.dataset.editorRegion !== "library";
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
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

  // Patch several items in ONE mutation (one state update per drag frame) —
  // used by linked-clip drags, where the whole group moves/trims together.
  const mapItems = useCallback((patches, silent) => {
    mutate((tl) => {
      for (const t of tl.tracks) {
        for (const it of t.items) {
          const p = patches.get(it.id);
          if (p) Object.assign(it, typeof p === "function" ? p(it) : p);
        }
      }
      return tl;
    }, silent);
  }, [mutate]);

  // Flip the clip at the playhead horizontally / vertically. Like "Grab still",
  // it acts on whichever video clip is showing at the current frame; the mirror
  // is a per-clip flag the composition renders as a CSS transform.
  const flipClipAtPlayhead = useCallback((axis) => {
    const clip = itemAtFrame(timeline, Math.round(frameRef.current));
    if (!clip) { setError("No clip at the playhead to flip."); return; }
    const key = axis === "v" ? "flipV" : "flipH";
    mapItem(clip.id, (it) => ({ [key]: !it[key] }));
  }, [timeline, mapItem]);

  // Removing a linked clip takes its partners with it — deleting a video clip
  // also deletes its separated audio, and vice versa. Removing a member of a
  // multi-selection removes the whole selection.
  const removeItem = useCallback((id) => {
    const sel = selectedIdsRef.current;
    if (sel.has(id) && sel.size > 1) { removeSelectedRef.current?.(); return; }
    mutate((tl) => {
      let linkId = null;
      for (const t of tl.tracks) {
        const it = t.items.find((x) => x.id === id);
        if (it) { linkId = it.linkId || null; break; }
      }
      for (const t of tl.tracks) {
        t.items = t.items.filter((x) => x.id !== id && (!linkId || x.linkId !== linkId));
      }
      return tl;
    });
    setSelectedId((cur) => (cur === id ? null : cur));
    setSelectedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      selectedIdsRef.current = next;
      return next;
    });
  }, [mutate]);
  // removeSelected is defined below (it needs mutate); reach it through a ref
  // so removeItem can delegate without a circular declaration.
  const removeSelectedRef = useRef(null);

  // Dissolve a clip's link group (every member keeps its position, loses the link).
  const unlinkItem = useCallback((id) => {
    mutate((tl) => {
      let linkId = null;
      for (const t of tl.tracks) {
        const it = t.items.find((x) => x.id === id);
        if (it) { linkId = it.linkId; break; }
      }
      if (linkId) for (const it of linkGroupOf(tl, linkId)) delete it.linkId;
      return tl;
    });
  }, [mutate]);

  // Separate a video clip's audio onto the first audio track as a LINKED audio
  // item playing the same source file (an <audio> element plays an mp4's audio
  // track), and mute the video card so the sound isn't doubled.
  const detachAudio = useCallback((id) => {
    mutate((tl) => {
      let vid = null;
      for (const t of tl.tracks) {
        const it = t.items.find((x) => x.id === id);
        if (it) { vid = it; break; }
      }
      // An image has no audio to detach: cloning its src onto an audio track
      // would hand <Audio> a PNG — or `null` for a slate, which throws and takes
      // the whole preview down. The menu hides the entry; this is the backstop.
      if (!vid || vid.linkId || isImageItem(vid)) return tl;
      let at = tl.tracks.find((t) => t.type === "audio");
      if (!at) { at = { id: "music", name: "Music", type: "audio", items: [] }; tl.tracks.push(at); }
      const linkId = `link_${id}`;
      at.items.push({
        id: `${id}_audio`,
        src: vid.src,
        name: vid.name,
        from: vid.from,
        durationInFrames: vid.durationInFrames,
        // Same in-point as the video, or the detached audio would play the
        // wrong sound under a split/head-trimmed clip.
        offsetFrames: vid.offsetFrames || 0,
        sourceDurationInFrames: vid.sourceDurationInFrames || vid.durationInFrames,
        volume: vid.muted ? 0 : vid.volume ?? 1,
        linkId,
      });
      vid.linkId = linkId;
      vid.muted = true;
      return tl;
    });
  }, [mutate]);

  // Repack a track's items end-to-end in the given order, dragging each moved
  // item's linked partners (on OTHER tracks) along by the same delta so a
  // video repack never drifts away from its separated audio.
  const repackWithLinks = (tl, track, ordered) => {
    const deltas = new Map(); // linkId → frame delta of its moved member
    let cur = 0;
    for (const it of ordered) {
      if (it.linkId) deltas.set(it.linkId, cur - it.from);
      it.from = cur;
      cur += it.durationInFrames;
    }
    track.items = ordered;
    if (!deltas.size) return;
    for (const t of tl.tracks) {
      if (t === track) continue;
      for (const it of t.items) {
        if (it.linkId && deltas.has(it.linkId)) it.from = Math.max(0, it.from + deltas.get(it.linkId));
      }
    }
  };

  // Single entry point for selection changes: keeps the live ref (read inside
  // pointer handlers, which fire before React commits) in lockstep with state.
  const applySelection = useCallback((ids, primary) => {
    selectedIdsRef.current = ids;
    setSelectedIds(ids);
    setSelectedId(primary ?? null);
  }, []);

  // Selecting a clip and a gap are mutually exclusive. Cmd/Ctrl-click toggles
  // the clip in/out of the multi-selection; a plain click on an UNSELECTED clip
  // collapses to it, while a plain click on a selected member keeps the whole
  // selection (so grabbing any member drags the group).
  const selectItem = useCallback((id, e) => {
    setSelectedGap(null);
    const prev = selectedIdsRef.current;
    const additive = !!e && (e.metaKey || e.ctrlKey);
    if (additive) {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        applySelection(next, next.size ? [...next][next.size - 1] : null);
      } else {
        next.add(id);
        applySelection(next, id);
      }
    } else {
      applySelection(prev.has(id) ? prev : new Set([id]), id);
    }
  }, [applySelection]);
  const selectGap = useCallback((trackId, gap) => {
    setSelectedGap({ trackId, from: gap.from, to: gap.to });
    applySelection(new Set(), null);
  }, [applySelection]);

  // Split ("razor") the clip(s) under the playhead into two independent clips.
  // Metadata-only: the right half is a NEW item whose `offsetFrames` (source
  // in-point) is advanced by the left half's length, so both halves play their
  // own piece of the same source file. Targets the selected clips strictly
  // containing the playhead — or, when the selection doesn't apply, every
  // non-disabled clip under it (razor-across-tracks); linked partners split at
  // the same frame. The whole plan (right-half ids, fresh linkIds) is computed
  // up front so the state updater stays pure (StrictMode runs it twice) and
  // the right halves can be selected afterwards — split-then-Delete trims a
  // tail in two keystrokes. Nothing to cut → no-op with no undo entry.
  const splitSeqRef = useRef(0);
  // The timeline frame under a cursor X — same math the pool-drop uses, so a
  // right-click "add here" lands exactly where a drag would have.
  const frameAtClientX = useCallback((clientX) => {
    const area = trackAreaRef.current;
    if (!area) return 0;
    const rect = area.getBoundingClientRect();
    const x = clientX - rect.left + area.scrollLeft;
    return Math.max(0, Math.round((x / pxPerSec) * fps));
  }, [pxPerSec, fps]);

  // Add an empty channel above/below a track. Previously only reachable by
  // dragging a pool clip onto the group's outer edge band, which is not
  // discoverable; the lane menu makes it a normal action.
  const addChannel = useCallback((track, side) => {
    mutate((tl) => {
      const nt = makeTrack(tl, track.type);
      const i = tl.tracks.findIndex((x) => x.id === track.id);
      const at = i < 0 ? tl.tracks.length : side === "after" ? i + 1 : i;
      tl.tracks.splice(at, 0, nt);
      return tl;
    });
  }, [mutate]);

  // Which shot a new scene on this lane belongs to. The picture track is per
  // SHOT, so "add a scene" must resolve a shot before it can prompt for a still.
  // We SUGGEST the shot after the nearest picture item at/before the click (the
  // common case: "the animatic skipped this shot, put it back") — but the modal
  // always lets the user pick, because the suggestion is a guess and generating
  // against the wrong shot pollutes an unrelated shot's take list.
  //
  // Bundles come from /api/animatic, NOT from /api/shotlist's `packs`: packs are
  // re-packed positionally and disagree with the episode manifest, which is what
  // the stills join treats as authoritative (worker/src/lib/stills.js). Attaching
  // under a pack id the join never looks in would silently orphan the still.
  const openSceneForLane = useCallback(async (track) => {
    const from = laneMenuRef.current?.from ?? Math.round(frameRef.current);
    const tl = timelineRef.current;
    const t = tl?.tracks.find((x) => x.id === track.id);
    const prior = (t?.items || [])
      .filter((it) => isImageItem(it) && it.shot && (it.from || 0) <= from)
      .sort((a, b) => (b.from || 0) - (a.from || 0))[0] || null;
    try {
      const res = await fetch("/api/animatic");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to read the shot list");
      const shots = data.shotsDetail || [];
      if (!shots.length) { setError("No shot list yet — write one first."); return; }
      let i = 0;
      if (prior) {
        const at = shots.findIndex((s) => s.shot === prior.shot);
        // Past the last shot there is no "next" — suggest the last one rather
        // than silently re-offering it as if it were a new slot.
        if (at >= 0) i = Math.min(at + 1, shots.length - 1);
      }
      setSceneTarget({
        mode: "add",
        trackId: track.id,
        from,
        shot: shots[i].shot,
        bundle: shots[i].bundle,
        shots, // the picker's options
      });
    } catch (e) {
      setError(String(e.message || e));
    }
  }, []);

  // Insert a Sound Studio take on the audio lane that was right-clicked, at the
  // frame under the cursor. A plain local edit: the media already exists, so
  // there's no agent round-trip and nothing to reserve.
  const addAudioAt = useCallback((pick) => {
    const t = audioTarget;
    if (!t) return;
    const id = `snd_${pick.trackId}_v${pick.v}_${Date.now().toString(36)}`;
    const dur = Math.max(1, Math.round((pick.duration > 0 ? pick.duration : 3) * fps));
    mutate((tl) => {
      const track = tl.tracks.find((x) => x.id === t.trackId);
      if (!track) return tl;
      track.items.push({
        id,
        src: pick.url,
        name: `${pick.name} · v${pick.v}`,
        track: pick.trackId,
        from: Math.max(0, Math.round(t.from || 0)),
        durationInFrames: dur,
        sourceDurationInFrames: dur,
        offsetFrames: 0,
        volume: 1,
      });
      return tl;
    });
    applySelection(new Set([id]), id);
    setAudioTarget(null);
  }, [audioTarget, fps, mutate, applySelection]);

  // "New still…" on an existing picture item — the item already knows its shot.
  const openSceneForItem = useCallback((itemId) => {
    const tl = timelineRef.current;
    const it = tl?.tracks.flatMap((t) => t.items).find((x) => x.id === itemId);
    if (!it) return;
    if (!it.shot) {
      setError("This clip isn't tied to a shot, so there's no storyboard context to generate from.");
      return;
    }
    setSceneTarget({ mode: "new", itemId, shot: it.shot, bundle: it.bundle, stillFile: it.stillFile });
  }, []);

  // Swap which TAKE an image item shows, with no generation — takes already
  // exist in db.stills, so this is a pure metadata edit.
  const swapTake = useCallback((itemId, take) => {
    mapItem(itemId, { src: take.url, stillFile: take.file, name: take.name ? `${take.shot || ""} · ${take.name}`.trim() : undefined });
  }, [mapItem]);

  // Generate a still for a picture slot. ONE mechanism serves both "add a scene
  // here" and "re-roll this still":
  //
  //   1. Make sure an item exists — for "add", insert a SLATE right now, so the
  //      slot (and the timing the user chose) is reserved and visible instantly,
  //      and is undoable/autosaved like any edit.
  //   2. Hand the agent that item's id. It generates, calls attach_still (which
  //      keeps every take), and finishes with edit_timeline `replace` — filling
  //      THIS item and leaving from/durationInFrames alone.
  //
  // The agent's write carries no clientId, so the open editor live-reloads and
  // the picture simply appears in place. Nothing here polls or waits.
  const generateStill = useCallback(async ({ shot, bundle, prompt, angle, reuse }) => {
    const t = sceneTarget;
    if (!t) return;
    if (!bundle) {
      setError(`Shot ${shot?.id} doesn't belong to any bundle, so its still has nowhere to live. Rebuild the shot list from the episode first.`);
      return;
    }
    setSceneBusy(true);
    setError(null);
    try {
      let itemId = t.itemId;
      if (t.mode === "add") {
        itemId = `pic_${shot.id.replace(/[^a-zA-Z0-9_-]/g, "")}_${Date.now().toString(36)}`;
        // The insert op applies to the timeline the SERVER holds, and the reply
        // replaces our local state wholesale — so any edit the debounced (and
        // un-retried) autosave hasn't landed yet would be silently thrown away.
        // Flush first, and bail rather than destroy work if the flush fails.
        if (dirtyRef.current) {
          const saved = await fetch("/api/timeline", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ timeline: timelineRef.current, clientId: CLIENT_ID }),
          });
          if (!saved.ok) throw new Error("Couldn't save your latest edits, so the scene wasn't added. Try again.");
          dirtyRef.current = false;
        }
        // Insert through the SERVER, not a local mutate + autosave. Autosave is
        // debounced 600ms, so a local-only slate may not exist server-side by
        // the time the agent's `replace` lands — and `replace` on a missing id
        // is a tolerant no-op, i.e. the still would vanish silently. Going
        // through /api/timeline/edit makes the slot durable before the agent is
        // even asked, and stamping CLIENT_ID keeps our own broadcast from
        // bouncing back as a foreign reload.
        const res = await fetch("/api/timeline/edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: CLIENT_ID,
            ops: [{
              op: "insert",
              trackId: t.trackId,
              item: {
                id: itemId,
                kind: "image",
                src: null, // a slate until the agent replaces it
                name: `${shot.id}${shot.action ? ` · ${shot.action.slice(0, 40)}` : ""}`,
                from: Math.max(0, Math.round(t.from || 0)),
                durationInFrames: Math.max(1, Math.round((shot.dur > 0 ? shot.dur : 2) * fps)),
                bundle,
                shot: shot.id,
                stillFile: null,
              },
            }],
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not add the scene");
        // The insert is a tolerant no-op on an unknown track, so confirm the slot
        // actually exists before telling the agent to fill it — otherwise the
        // generation lands nowhere and the user just sees nothing happen.
        const landed = (data.timeline?.tracks || []).some((tr) => (tr.items || []).some((x) => x.id === itemId));
        if (!landed) throw new Error("Couldn't add the scene to that lane — try again.");
        pushHistory();
        dirtyRef.current = false; // the flush above means the server has this exact timeline
        setTimeline(withSourceDurations(data.timeline));
        applySelection(new Set([itemId]), itemId);
      }
      await agent.send({
        message: renderAnimaticStillMessage({
          bundle,
          shot,
          itemId,
          prompt,
          angle,
          reuse,
        }),
      });
      setSceneTarget(null);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setSceneBusy(false);
    }
  }, [sceneTarget, fps, applySelection, agent, pushHistory]);

  const splitAtPlayhead = useCallback((targetId) => {
    const tl = timelineRef.current;
    if (!tl) return;
    const f = Math.round(frameRef.current);
    // Strictly inside: a cut at a clip edge would leave a zero-length half.
    const inside = (it) => f > (it.from || 0) && f < (it.from || 0) + (it.durationInFrames || 0);
    const all = [];
    for (const t of tl.tracks || []) for (const it of t.items || []) all.push(it);
    const sel = selectedIdsRef.current;
    let base;
    if (targetId != null) {
      base = all.filter((it) => it.id === targetId && inside(it));
    } else {
      base = all.filter((it) => sel.has(it.id) && inside(it));
      if (!base.length) base = all.filter((it) => !it.disabled && inside(it));
    }
    // Linked partners (video ↔ its separated audio) split together.
    const byId = new Map(base.map((it) => [it.id, it]));
    for (const it of base) {
      if (it.linkId) for (const g of linkGroupOf(tl, it.linkId)) if (inside(g)) byId.set(g.id, g);
    }
    const targets = [...byId.values()];
    if (!targets.length) return;
    // Right halves that came from one link group stay linked to EACH OTHER
    // under a fresh linkId; a lone right half is unlinked (keeping the old id
    // would tether it to the left group).
    const rightLinkFor = new Map(); // old linkId → fresh linkId
    for (const it of targets) {
      if (!it.linkId || rightLinkFor.has(it.linkId)) continue;
      if (targets.filter((x) => x.linkId === it.linkId).length >= 2) {
        rightLinkFor.set(it.linkId, `link_split_${Date.now()}_${rightLinkFor.size}`);
      }
    }
    const used = new Set(all.map((it) => it.id));
    const plan = new Map(); // id → { leftDur, rightId, rightLinkId }
    for (const it of targets) {
      let rightId;
      do rightId = `${it.id}_r${++splitSeqRef.current}`; while (used.has(rightId));
      used.add(rightId);
      plan.set(it.id, {
        leftDur: f - (it.from || 0),
        rightId,
        rightLinkId: it.linkId ? rightLinkFor.get(it.linkId) || null : null,
      });
    }
    mutate((next) => {
      for (const t of next.tracks) {
        // Walk backwards so splicing the right half in never shifts unvisited items.
        for (let i = t.items.length - 1; i >= 0; i--) {
          const it = t.items[i];
          const p = plan.get(it.id);
          if (!p) continue;
          const right = {
            ...it,
            id: p.rightId,
            from: f,
            durationInFrames: (it.durationInFrames || 0) - p.leftDur,
            // An image has no source timeline, so both halves keep in-point 0 and
            // simply hold the same still — splitting a still is a legitimate way
            // to hold one frame across a cut point.
            offsetFrames: isImageItem(it) ? 0 : (it.offsetFrames || 0) + p.leftDur,
          };
          delete right.fadeInFrames; // fade-in belongs to the left half
          if (p.rightLinkId) right.linkId = p.rightLinkId; else delete right.linkId;
          if (right.fadeOutFrames) right.fadeOutFrames = Math.min(right.fadeOutFrames, right.durationInFrames);
          it.durationInFrames = p.leftDur;
          if (it.fadeInFrames) it.fadeInFrames = Math.min(it.fadeInFrames, p.leftDur);
          delete it.fadeOutFrames; // fade-out belongs to the right half
          t.items.splice(i + 1, 0, right);
        }
      }
      return next;
    });
    const rightIds = targets.map((it) => plan.get(it.id).rightId);
    const primary = plan.get(targetId ?? targets[0].id)?.rightId ?? rightIds[0];
    applySelection(new Set(rightIds), primary);
    setSelectedGap(null);
  }, [mutate, applySelection]);

  // Remove every selected clip (each taking its linked partners with it) —
  // the Delete key and the multi-selection inspector use this.
  const removeSelected = useCallback(() => {
    const ids = selectedIdsRef.current;
    if (!ids.size) return;
    mutate((tl) => {
      const kill = new Set(ids);
      for (const t of tl.tracks) {
        for (const it of t.items) {
          if (kill.has(it.id) && it.linkId) for (const g of linkGroupOf(tl, it.linkId)) kill.add(g.id);
        }
      }
      for (const t of tl.tracks) t.items = t.items.filter((x) => !kill.has(x.id));
      return tl;
    });
    applySelection(new Set(), null);
    setSelectedGap(null);
  }, [mutate, applySelection]);
  removeSelectedRef.current = removeSelected;

  // Link EXACTLY the selected clips (two videos, video + audio combos, …) into
  // one fresh group. The selection defines the group: members leave whatever
  // group they were in before, and any old group left with a single member
  // dissolves — so relinking never silently drags in unselected clips.
  const linkSelected = useCallback(() => {
    const ids = new Set(selectedIdsRef.current);
    if (ids.size < 2) return;
    mutate((tl) => {
      const members = [];
      for (const t of tl.tracks) for (const it of t.items) if (ids.has(it.id)) members.push(it);
      if (members.length < 2) return tl;
      const linkId = `link_${Date.now()}_${members[0].id}`;
      for (const it of members) it.linkId = linkId;
      // Dissolve any old group that lost its partners to this one.
      const counts = new Map();
      for (const t of tl.tracks) for (const it of t.items) if (it.linkId) counts.set(it.linkId, (counts.get(it.linkId) || 0) + 1);
      for (const t of tl.tracks) for (const it of t.items) if (it.linkId && counts.get(it.linkId) < 2) delete it.linkId;
      return tl;
    });
  }, [mutate]);

  // Unlink every selected clip: dissolves the link group of each selected
  // member (the toolbar Link button uses this when the selection is linked).
  const unlinkSelected = useCallback(() => {
    const ids = selectedIdsRef.current;
    if (!ids.size) return;
    mutate((tl) => {
      const linkIds = new Set();
      for (const t of tl.tracks) for (const it of t.items) if (ids.has(it.id) && it.linkId) linkIds.add(it.linkId);
      if (!linkIds.size) return tl;
      for (const t of tl.tracks) for (const it of t.items) if (it.linkId && linkIds.has(it.linkId)) delete it.linkId;
      return tl;
    });
  }, [mutate]);

  // Click-drag on empty lane space rubber-band-selects: a translucent white
  // rectangle follows the mouse and every clip it touches joins the selection
  // live (Cmd/Ctrl keeps the existing selection and adds to it). Releasing
  // keeps whatever ended up selected.
  const startMarquee = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const wrap = lanesWrapRef.current;
    if (!wrap) return;
    setSelectedGap(null);
    const additive = e.metaKey || e.ctrlKey;
    const base = additive ? new Set(selectedIdsRef.current) : new Set();
    applySelection(new Set(base), base.size ? [...base][base.size - 1] : null);
    const sx = e.clientX, sy = e.clientY;
    const onMove = (ev) => {
      const rect = {
        left: Math.min(sx, ev.clientX), right: Math.max(sx, ev.clientX),
        top: Math.min(sy, ev.clientY), bottom: Math.max(sy, ev.clientY),
      };
      const wr = wrap.getBoundingClientRect();
      setMarquee({ x: rect.left - wr.left, y: rect.top - wr.top, w: rect.right - rect.left, h: rect.bottom - rect.top });
      // Hit-test clips against the live lane rects (tracks vertical group
      // scroll for free); x spans come from each clip's frame position.
      const tl = timelineRef.current;
      const ids = new Set(base);
      for (const laneEl of wrap.querySelectorAll("[data-lane]")) {
        const lr = laneEl.getBoundingClientRect();
        if (lr.bottom < rect.top || lr.top > rect.bottom) continue;
        const track = tl?.tracks.find((t) => t.id === laneEl.dataset.lane);
        for (const it of track?.items || []) {
          const x1 = lr.left + framesToSec(it.from, fps) * pxPerSec;
          const x2 = x1 + Math.max(6, framesToSec(it.durationInFrames, fps) * pxPerSec);
          if (x2 >= rect.left && x1 <= rect.right) ids.add(it.id);
        }
      }
      applySelection(ids, ids.size ? [...ids][ids.size - 1] : null);
    };
    const onUp = () => {
      setMarquee(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [fps, pxPerSec, applySelection]);

  // Disable/enable a clip — a disabled clip stays on the timeline (greyed) but is
  // skipped in playback (video shows nothing, audio is silent).
  const toggleDisable = useCallback((id) => {
    mapItem(id, (it) => ({ disabled: !it.disabled }));
  }, [mapItem]);

  // Delete just this gap: pull every later clip on the track left by its width,
  // and pull each shifted clip's linked partners (on other tracks) along.
  const removeGap = useCallback((trackId, gap) => {
    const w = gap.to - gap.from;
    mutate((tl) => {
      const t = tl.tracks.find((x) => x.id === trackId);
      if (!t) return tl;
      const shifted = new Set(); // linkIds of shifted clips
      for (const it of t.items) {
        if (it.from >= gap.to - 0.5) {
          it.from -= w;
          if (it.linkId) shifted.add(it.linkId);
        }
      }
      if (shifted.size) {
        for (const ot of tl.tracks) {
          if (ot === t) continue;
          for (const it of ot.items) {
            if (it.linkId && shifted.has(it.linkId)) it.from = Math.max(0, it.from - w);
          }
        }
      }
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
      repackWithLinks(tl, t, items);
      return tl;
    });
  }, [mutate]);

  // Lay every video channel's clips end-to-end (gapless) in current start order.
  const closeGapsAll = useCallback(() => {
    mutate((tl) => {
      for (const t of tl.tracks) {
        if (t.type !== "video") continue;
        repackWithLinks(tl, t, t.items.slice().sort((a, b) => a.from - b.from));
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
    const sameEls = laneEls.filter((el) => el.dataset.laneType === itemType);
    if (!sameEls.length) return null;
    // Over a lane → move onto it (same type only; own lane is a no-op).
    for (const el of laneEls) {
      const r = el.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) {
        if (el.dataset.lane === srcTrackId) return null;    // already here
        if (el.dataset.laneType !== itemType) return null;  // no cross-media moves
        return { type: "move", trackId: el.dataset.lane };
      }
    }
    // Outside every lane → spawn a new channel at the matching group's border.
    // `ref`/`side` name the track to insert before/after; `y` places the
    // indicator line (px from the top of the lanes wrapper).
    const wrapTop = wrap.getBoundingClientRect().top;
    const firstR = sameEls[0].getBoundingClientRect();
    const lastR = sameEls[sameEls.length - 1].getBoundingClientRect();
    if (clientY < firstR.top) {
      return { type: "new", ref: sameEls[0].dataset.lane, side: "before", y: firstR.top - wrapTop };
    }
    if (clientY > lastR.bottom) {
      return { type: "new", ref: sameEls[sameEls.length - 1].dataset.lane, side: "after", y: lastR.bottom - wrapTop };
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
        const i = tl.tracks.findIndex((t) => t.id === drop.ref);
        const at = i < 0 ? tl.tracks.length : drop.side === "after" ? i + 1 : i;
        tl.tracks.splice(at, 0, nt);
      }
      // Drop any now-empty channel we created earlier, but never the BASE lane of
      // each kind — the timeline must always offer one picture and one audio lane
      // to drop onto. The base ids differ per source ("video"/"music" from a cut,
      // "picture"/"dialogue" from an animatic), so keep the FIRST track of each
      // type rather than matching hardcoded ids: an animatic built before any
      // voice takes exist has an empty Dialogue lane, and an id whitelist would
      // silently delete it on the first cross-track drag.
      const baseIds = new Set();
      for (const type of ["video", "audio"]) {
        const first = tl.tracks.find((t) => t.type === type);
        if (first) baseIds.add(first.id);
      }
      tl.tracks = tl.tracks.filter((t) => t.items.length > 0 || baseIds.has(t.id));
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
    // Only land on the timeline when the pointer is actually over the track area
    // (ruler + lanes). Releasing anywhere else — most notably back over the media
    // pool, which sits ABOVE the lanes — returns null, so the drop is cancelled
    // instead of spawning a stray channel via the "above the stack" branch below.
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    const x = clientX - rect.left + area.scrollLeft;
    const from = Math.max(0, Math.round((x / pxPerSec) * fps));
    const sameEls = laneEls.filter((el) => el.dataset.laneType === mediaType);
    if (!sameEls.length) return null;
    const wrapTop = wrap.getBoundingClientRect().top;
    const firstEl = sameEls[0];
    const lastEl = sameEls[sameEls.length - 1];
    const firstR = firstEl.getBoundingClientRect();
    const lastR = lastEl.getBoundingClientRect();
    const EDGE = 14; // px band at the matching group's outer borders that spawns a NEW channel
    const mkNew = (side) => ({
      type: "new",
      ref: (side === "before" ? firstEl : lastEl).dataset.lane,
      side,
      from,
      valid: true,
      y: (side === "before" ? firstR.top : lastR.bottom) - wrapTop,
    });
    for (const el of laneEls) {
      const r = el.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) {
        // The outer EDGE band of the matching group still reads as "new channel".
        if (el === firstEl && clientY < firstR.top + EDGE) return mkNew("before");
        if (el === lastEl && clientY > lastR.bottom - EDGE) return mkNew("after");
        return { type: "lane", trackId: el.dataset.lane, from, valid: el.dataset.laneType === mediaType };
      }
    }
    // Outside every lane (ruler, divider, below the stack) → new channel at the
    // matching group's nearer border.
    if (clientY < firstR.top) return mkNew("before");
    if (clientY > lastR.bottom) return mkNew("after");
    return null;
  }, [pxPerSec, fps]);

  // Drop a pool clip as a fresh timeline item carrying the media's natural length
  // (also its trim cap). `drop` decides whether it joins an existing lane or
  // spawns a brand-new matching-type channel. A VIDEO drop also separates its
  // audio: a linked audio item (same source file — an <audio> element plays an
  // mp4's audio track) lands on the first audio track and carries the sound,
  // while the video card itself is muted. Selects the new clip.
  const addPoolClip = useCallback((item, drop, durationSec) => {
    const newId = `pool_${item.mediaType}_${poolSeqRef.current++}_${Date.now()}`;
    const type = item.mediaType === "audio" ? "audio" : "video";
    mutate((tl) => {
      const dur = Math.max(1, Math.round((durationSec || 3) * (tl.fps || fps)));
      const isVideo = type === "video";
      const linkId = isVideo ? `link_${newId}` : undefined;
      const newItem = {
        id: newId,
        src: item.src,
        name: item.name,
        from: Math.max(0, Math.round(drop.from)),
        durationInFrames: dur,
        sourceDurationInFrames: dur,
        volume: 1,
        ...(isVideo ? { muted: true, linkId } : {}),
        ...(item.bundle ? { bundle: item.bundle } : {}),
      };
      if (drop.type === "new") {
        const nt = makeTrack(tl, type);
        nt.items.push(newItem);
        const i = tl.tracks.findIndex((t) => t.id === drop.ref);
        const at = i < 0 ? tl.tracks.length : drop.side === "after" ? i + 1 : i;
        tl.tracks.splice(at, 0, nt);
      } else {
        const t = tl.tracks.find((x) => x.id === drop.trackId);
        if (!t) return tl;
        t.items.push(newItem);
      }
      if (isVideo) {
        let at = tl.tracks.find((t) => t.type === "audio");
        if (!at) { at = { id: "music", name: "Music", type: "audio", items: [] }; tl.tracks.push(at); }
        at.items.push({
          id: `${newId}_audio`,
          src: item.src,
          name: item.name,
          from: newItem.from,
          durationInFrames: dur,
          sourceDurationInFrames: dur,
          volume: 1,
          linkId,
        });
      }
      return tl;
    });
    setSelectedId(newId);
    setSelectedIds(new Set([newId]));
    selectedIdsRef.current = new Set([newId]);
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
      setSelectedIds(new Set());
      selectedIdsRef.current = new Set();
      setSelectedGap(null);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Replace the working timeline with a stored version from `path` (a radio
  // pass, an animatic). Same shape as loadCut: a fresh document, so history and
  // selection reset and the autosave dirty flag clears.
  const loadVersion = useCallback(async (path, v, label) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ v, clientId: CLIENT_ID }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to load ${label}`);
      dirtyRef.current = false;
      histRef.current = [];
      setCanUndo(false);
      setTimeline(withSourceDurations(data.timeline));
      setSelectedId(null);
      setSelectedIds(new Set());
      selectedIdsRef.current = new Set();
      setSelectedGap(null);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  // A stored radio version: the audio-only dialogue timeline built on the Radio tab.
  const loadRadio = useCallback((v) => loadVersion("/api/timeline/from-radio", v, "radio version"), [loadVersion]);
  // A stored animatic: that same dialogue plus each shot's still on the picture track.
  const loadAnimatic = useCallback((v) => loadVersion("/api/timeline/from-animatic", v, "animatic"), [loadVersion]);

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

  /* ---- magnet / snapping ---- */
  // When the magnet is on, a moving clip snaps its START or END edge to a nearby
  // target: the edges of every OTHER clip (across all tracks), the timeline start
  // (0), and the playhead. The threshold is a fixed ~8px, converted to frames so
  // the "pull" feels the same at any zoom. Returns the snapped `from` (the clip's
  // length never changes on a move) and reports the snap point via setSnapLine so
  // a guide can be drawn; null snap point clears it.
  const snapFrom = useCallback((proposedFrom, dur, excludeIds) => {
    const tl = timelineRef.current;
    if (!tl) { setSnapLine(null); return proposedFrom; }
    const thresh = Math.max(1, (SNAP_PX / pxPerSec) * fps);
    const targets = [0, frameRef.current];
    for (const t of tl.tracks || []) {
      for (const it of t.items || []) {
        if (excludeIds.has(it.id)) continue; // the dragged clip + its linked partners move too
        const s = it.from || 0;
        targets.push(s, s + (it.durationInFrames || 0));
      }
    }
    const start = proposedFrom;
    const end = proposedFrom + dur;
    let best = null; // { from, at, dist }
    for (const target of targets) {
      const ds = Math.abs(start - target);
      if (ds <= thresh && (!best || ds < best.dist)) best = { from: target, at: target, dist: ds };
      const de = Math.abs(end - target);
      if (de <= thresh && (!best || de < best.dist)) best = { from: target - dur, at: target, dist: de };
    }
    if (!best) { setSnapLine(null); return proposedFrom; }
    const snapped = Math.max(0, Math.round(best.from));
    setSnapLine(best.at);
    return snapped;
  }, [pxPerSec, fps]);

  /* ---- drag handling for move / resize ---- */
  // A "move" drag slides the clip horizontally (its start frame) AND can carry it
  // to another channel vertically: over another same-type row it moves there;
  // into the top/bottom grab-band it spawns a new channel. The vertical target is
  // only previewed (dropTarget) during the drag and committed on release, so the
  // card itself just slides along its own lane until you let go.
  const onDragStart = useCallback((e, item, track, mode) => {
    e.preventDefault();
    beginGesture(); // one undo step for the whole drag
    // The drag's base set: the grabbed clip, or the whole multi-selection when
    // the grabbed clip belongs to one (move only — trims stay per-clip). Every
    // member also drags its linked partners. Snapshot each member's
    // start/length so every pointer move applies one shared delta.
    const tl = timelineRef.current;
    const sel = selectedIdsRef.current;
    const multi = mode === "move" && sel.has(item.id) && sel.size > 1;
    const baseItems = [];
    if (multi && tl) {
      for (const t of tl.tracks) for (const it of t.items) if (sel.has(it.id)) baseItems.push(it);
    }
    if (!baseItems.length) baseItems.push(item);
    const byId = new Map(baseItems.map((it) => [it.id, it]));
    if (tl) {
      for (const it of baseItems) {
        if (it.linkId) for (const g of linkGroupOf(tl, it.linkId)) byId.set(g.id, g);
      }
    }
    const group = [...byId.values()].map((it) => ({
      id: it.id, startFrom: it.from, startDur: it.durationInFrames, srcDur: it.sourceDurationInFrames,
      offset: it.offsetFrames || 0,
      // An image has no source media: its in-point stays 0 and its head can be
      // re-extended as far as the timeline allows (no trimmed-off media to run
      // out of). Snapshot it so the drag clamps can tell the two cases apart.
      isImage: isImageItem(it),
    }));
    dragRef.current = {
      id: item.id, mode,
      startX: e.clientX,
      startFrom: item.from,
      startDur: item.durationInFrames,
      srcDur: item.sourceDurationInFrames, // resize cap (undefined = uncapped)
      type: track.type,
      srcTrackId: track.id,
      group,
      groupIds: new Set(group.map((g) => g.id)),
      // The group can't slide further left than its earliest member.
      minStartFrom: Math.min(...group.map((g) => g.startFrom)),
      // Vertical channel moves only make sense for a single grabbed clip.
      allowDrop: !multi,
      drop: null,
    };
    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const deltaFrames = ((ev.clientX - d.startX) / pxPerSec) * fps;
      if (d.mode === "move") {
        let nextFrom = Math.max(0, Math.round(d.startFrom + deltaFrames));
        if (magnetRef.current) nextFrom = snapFrom(nextFrom, d.startDur, d.groupIds);
        const delta = Math.max(nextFrom - d.startFrom, -d.minStartFrom);
        const patches = new Map(d.group.map((g) => [g.id, { from: Math.max(0, g.startFrom + delta) }]));
        mapItems(patches, true);
        if (d.allowDrop) {
          const drop = computeDrop(ev.clientY, d.type, d.srcTrackId);
          d.drop = drop;
          setDropTarget(drop);
        }
      } else if (d.mode === "resize-start") {
        // Head trim: slide the left edge, advancing the source in-point so the
        // remaining media keeps its timing (the clip's END stays anchored).
        // Dragging left re-extends into previously trimmed-off media, down to
        // the source start. One shared delta keeps grouped/linked edges
        // aligned; the clamps take the tightest member's limits.
        let delta = Math.round(deltaFrames);
        if (magnetRef.current) delta = snapFrom(d.startFrom + delta, 0, d.groupIds) - d.startFrom;
        let lo = -Infinity, hi = Infinity;
        for (const g of d.group) {
          // An image's head is limited only by the timeline start (from ≥ 0);
          // real media also can't back up past its own source start
          // (offsetFrames ≥ 0).
          lo = Math.max(lo, g.isImage ? -g.startFrom : Math.max(-g.offset, -g.startFrom));
          hi = Math.min(hi, g.startDur - 1);          // durationInFrames ≥ 1
        }
        delta = lo > hi ? 0 : Math.max(lo, Math.min(hi, delta));
        const patches = new Map(d.group.map((g) => [g.id, {
          from: g.startFrom + delta,
          // Images stay pinned at in-point 0 — there is nothing to seek into.
          offsetFrames: g.isImage ? 0 : g.offset + delta,
          durationInFrames: g.startDur - delta,
        }]));
        mapItems(patches, true);
      } else {
        // Trim shorter freely; never stretch past each clip's real length,
        // measured from its in-point. Linked clips trim together (each
        // clamped to its own source cap).
        const patches = new Map(d.group.map((g) => {
          let next = Math.max(1, Math.round(g.startDur + deltaFrames));
          if (g.srcDur) next = Math.min(next, Math.max(1, g.srcDur - g.offset));
          return [g.id, { durationInFrames: next }];
        }));
        mapItems(patches, true);
      }
    };
    const onUp = () => {
      const d = dragRef.current;
      if (d && d.mode === "move" && d.drop) applyDrop(d.id, d.drop, d.type);
      dragRef.current = null;
      setDropTarget(null);
      setSnapLine(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [pxPerSec, fps, mapItems, beginGesture, computeDrop, applyDrop, snapFrom]);

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

  // Snap targets for the playhead: the timeline start (0) and every clip edge
  // across all tracks (the playhead itself is obviously not a target).
  const playheadTargets = useCallback(() => {
    const tl = timelineRef.current;
    const out = [0];
    for (const t of tl?.tracks || []) {
      for (const it of t.items || []) {
        const s = it.from || 0;
        out.push(s, s + (it.durationInFrames || 0));
      }
    }
    return out;
  }, []);

  // Grab the playhead head and drag to scrub the video (continuous seek).
  // With the magnet on, the head snaps onto a nearby clip edge and stays stuck
  // there (a wider release radius = hysteresis) so it doesn't jitter on/off the
  // edge — you have to pull past it to break free.
  const startScrub = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    let stuck = null; // frame we're currently snapped to (null = free)
    const move = (ev) => {
      const el = trackAreaRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = ev.clientX - rect.left + el.scrollLeft;
      const raw = Math.max(0, Math.min(durationInFrames - 1, Math.round((x / pxPerSec) * fps)));
      let f = raw;
      if (magnetRef.current) {
        const enter = Math.max(1, (SNAP_PX / pxPerSec) * fps); // pull-in radius
        const release = enter * 2; // must move past this to detach (sticky)
        if (stuck != null && Math.abs(raw - stuck) <= release) {
          f = stuck; // still within release radius → hold the snap
        } else {
          stuck = null;
          let best = null;
          for (const target of playheadTargets()) {
            const d = Math.abs(raw - target);
            if (d <= enter && (best == null || d < best.d)) best = { t: target, d };
          }
          if (best) { stuck = best.t; f = best.t; }
        }
        setSnapLine(stuck);
        f = Math.max(0, Math.min(durationInFrames - 1, f));
      }
      playerRef.current?.seekTo(f);
      setFrame(f);
    };
    move(e);
    const up = () => {
      setSnapLine(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, [pxPerSec, fps, durationInFrames, playheadTargets]);

  const selected = useMemo(() => {
    if (!timeline || !selectedId) return null;
    for (const t of timeline.tracks) {
      const it = t.items.find((x) => x.id === selectedId);
      if (it) return { item: it, track: t };
    }
    return null;
  }, [timeline, selectedId]);

  // Every link group touched by the current selection. Selecting ANY member of
  // a group lights up the WHOLE group's link border — so the highlight tracks
  // the full selection, not just the primary/inspector clip (otherwise the
  // border could flicker to only the video or only the audio side).
  const selectedLinkIds = useMemo(() => {
    const out = new Set();
    if (!timeline || !selectedIds.size) return out;
    for (const t of timeline.tracks) {
      for (const it of t.items) if (selectedIds.has(it.id) && it.linkId) out.add(it.linkId);
    }
    return out;
  }, [timeline, selectedIds]);
  // Drives the toolbar Link button, which always reflects the selection: lit =
  // the selection is linked (click to unlink); unlit = clickable only when 2+
  // clips are selected.
  const selectionLinked = selectedLinkIds.size > 0;

  // Drag the handle above the timeline to resize the preview/timeline split:
  // pulling it up shrinks the media-pool + player row (the pool tracks the
  // player's height), giving the timeline more room. Double-click resets.
  const startTopResize = useCallback((e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = playerWrapRef.current?.offsetHeight || 0;
    const onMove = (ev) =>
      setPlayerH(Math.max(120, Math.min(900, Math.round(startH + (ev.clientY - startY)))));
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  const contentWidth = Math.max(600, durationSec * pxPerSec + 40);
  const playheadX = framesToSec(frame, fps) * pxPerSec;

  // Video and audio lanes render as two groups around a fixed divider. Each
  // group shows up to MAX_VISIBLE_LANES lanes and scrolls vertically for more
  // (its label rail scroll-syncs to it).
  const videoTracks = timeline ? timeline.tracks.filter((t) => t.type === "video") : [];
  const audioTracks = timeline ? timeline.tracks.filter((t) => t.type === "audio") : [];
  const vGroupH = Math.max(1, Math.min(videoTracks.length, MAX_VISIBLE_LANES)) * LANE_H;
  const aGroupH = Math.max(1, Math.min(audioTracks.length, MAX_VISIBLE_LANES)) * LANE_H;
  const playerAspect = (timeline?.width || 1280) / (timeline?.height || 720);

  // Adaptive ruler ticks. Pick the densest interval whose *major* (labelled)
  // ticks stay at least ~72px apart, then emit every minor sub-tick across the
  // timeline. Majors carry a timecode label; minors are just hairlines. This
  // replaces the old one-label-per-second ruler, which crowded at high zoom and
  // ran out of resolution at low zoom.
  const rulerTicks = useMemo(() => {
    const MIN_LABEL_PX = 72; // keep timecode labels from colliding
    const chosen =
      TICK_STEPS.find((c) => c.step * pxPerSec >= MIN_LABEL_PX) ||
      TICK_STEPS[TICK_STEPS.length - 1];
    const minorStep = chosen.step / chosen.minors;
    const withFrames = chosen.step < 1;
    const total = Math.ceil(durationSec / minorStep);
    const ticks = [];
    // Cap the node count so a pathological zoom/length combo can't flood the DOM.
    for (let i = 0; i <= total && ticks.length < 4000; i++) {
      const sec = i * minorStep;
      const major = i % chosen.minors === 0;
      ticks.push({
        x: sec * pxPerSec,
        major,
        label: major ? formatTimecode(sec, fps, withFrames) : null,
      });
    }
    return ticks;
  }, [durationSec, pxPerSec, fps]);

  // Scroll the track area so a given frame is comfortably in view (used after a
  // keyboard seek, which — unlike playback — doesn't auto-follow the playhead).
  const revealFrame = (f) => {
    const el = trackAreaRef.current;
    if (!el) return;
    const px = framesToSec(f, fps) * pxPerSec;
    const view = el.clientWidth;
    if (px > el.scrollLeft + view - 24 || px < el.scrollLeft + 24) {
      el.scrollLeft = Math.max(0, px - view / 2);
    }
  };

  // Left/Right nudge the playhead one frame back/forward in the video.
  const stepFrame = (delta) => {
    const next = Math.max(0, Math.min(durationInFrames - 1, Math.round(frameRef.current) + delta));
    playerRef.current?.seekTo(next);
    revealFrame(next);
  };

  // J / L shuttle the video like a jog wheel: J rewinds, L fast-forwards. The
  // first press in a direction plays at 2× that way; each further press the same
  // way doubles the speed (2×, 4×, 8×), and the opposite key flips direction back
  // to 2×. Base speed is 2× (not 1×) so the very first press is visibly a fast
  // shuttle — a 1× forward would be indistinguishable from ordinary play, which
  // made L look like it "did nothing". Remotion's <Player> runs a negative
  // playbackRate in reverse, so the needle and preview sweep backward live.
  // Pausing (Space) clears the shuttle so the next play resumes at normal speed.
  const MIN_SHUTTLE = 2;
  const MAX_SHUTTLE = 8;
  const shuttle = (dir) => {
    const cur = playbackRateRef.current;
    const sameWay = shuttleActiveRef.current && Math.sign(cur) === dir;
    const next = sameWay
      ? Math.max(-MAX_SHUTTLE, Math.min(MAX_SHUTTLE, cur * 2))
      : dir * MIN_SHUTTLE;
    shuttleActiveRef.current = true;
    playbackRateRef.current = next;
    setPlaybackRate(next);
    playerRef.current?.play?.();
  };
  const resetShuttle = () => {
    shuttleActiveRef.current = false;
    playbackRateRef.current = 1;
    setPlaybackRate(1);
  };

  // Up/Down jump between clip cuts, anchored on the playhead (not the selection,
  // which may be empty): Up snaps to the previous cut, Down to the next. Every
  // video clip's start frame is a cut, whether the clips share one lane or are
  // spread across video/video-2/… tracks. The landed-on clip becomes selected.
  const gotoClip = (dir) => {
    if (!timeline) return;
    const clips = [];
    for (const t of timeline.tracks) {
      if (t.type !== "video") continue;
      for (const it of t.items) clips.push(it);
    }
    if (!clips.length) return;
    clips.sort((a, b) => a.from - b.from || String(a.id).localeCompare(String(b.id)));
    const f = Math.round(frameRef.current);
    let target = null;
    if (dir < 0) {
      // Previous cut: the last clip that starts strictly before the playhead.
      for (const c of clips) { if (c.from < f) target = c; else break; }
    } else {
      // Next cut: the first clip that starts strictly after the playhead.
      target = clips.find((c) => c.from > f) || null;
    }
    if (!target) return;
    selectItem(target.id);
    playerRef.current?.seekTo(Math.round(target.from));
    revealFrame(target.from);
  };

  // Latest handlers/selection for the mount-once keyboard listener.
  keyCtxRef.current = {
    undo, selectedGap, selectedId, removeGap, removeItem, removeSelected, toggleDisable,
    stepFrame, gotoClip, splitAtPlayhead, shuttle, resetShuttle,
    hasTimeline: !!timeline, hasSelection: selectedIds.size > 0,
  };

  // Commit the paced timing on THIS timeline back to the Shot list (`dur` per
  // shot), so the animatic, the multishot packs, and the episode video
  // requests inherit the pacing. Only meaningful on a radio/animatic timeline
  // — the button lives here (not the Radio tab) because the pacing is seen and
  // reviewed here. The commit route reads the SAVED editorTimeline doc, and
  // the autosave is debounced 600ms — so flush the in-memory timeline first,
  // or a just-dragged edit would be committed stale.
  const paceableKind =
    timeline?.source?.kind === "radio" || timeline?.source?.kind === "animatic"
      ? timeline.source.kind
      : null;
  const commitPacing = async () => {
    setCommittingPacing(true); setError(null); setPacingNotice(null);
    try {
      const saveRes = await fetch("/api/timeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeline, clientId: CLIENT_ID }),
      });
      if (!saveRes.ok) throw new Error((await saveRes.json().catch(() => ({}))).error || "Save failed");
      const res = await fetch("/api/radio/commit-pacing", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Commit failed");
      setPacingNotice(
        `Committed the ${json.source} timing to the Shot list — ${json.updated} shot duration${json.updated === 1 ? "" : "s"} updated` +
          (json.untouched ? `, ${json.untouched} left untouched` : "") + ".",
      );
    } catch (e) { setError(String(e.message || e)); }
    finally { setCommittingPacing(false); }
  };

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
          {cuts.length === 0 && radioVersions.length === 0 && animaticVersions.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No stitched cuts yet.</p>
          ) : (
            <div className="-mx-1 max-h-[60vh] space-y-1 overflow-y-auto px-1">
              {cuts.map((c) => (
                <button
                  key={`cut-${c.v}`}
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
              {animaticVersions.map((a) => (
                <button
                  key={`animatic-${a.v}`}
                  onClick={() => { loadAnimatic(a.v); setCutPickerOpen(false); }}
                  className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <Badge variant="info" className="font-mono gap-1"><Clapperboard size={11} /> v{a.v}</Badge>
                  <span className="flex-1 font-medium">{a.name || `animatic v${a.v}`}</span>
                  <span className="text-xs text-muted-foreground">
                    {a.coverage
                      ? `${a.coverage.withStill}/${a.coverage.shots} stills`
                      : `${a.clips} shots`}
                  </span>
                </button>
              ))}
              {radioVersions.map((r) => (
                <button
                  key={`radio-${r.v}`}
                  onClick={() => { loadRadio(r.v); setCutPickerOpen(false); }}
                  className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <Badge variant="info" className="font-mono gap-1"><Radio size={11} /> v{r.v}</Badge>
                  <span className="flex-1 font-medium">{r.name || `radio version v${r.v}`}</span>
                  <span className="text-xs text-muted-foreground">{r.clips} lines</span>
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

  // One row in a group's label rail (must stay LANE_H tall to mirror its lane).
  const renderLabel = (t) => (
    <div key={t.id} className="flex h-16 items-center gap-1.5 border-b px-3 text-xs font-medium">
      {t.type === "audio" ? <Music size={13} /> : <Film size={13} />} {t.name}
    </div>
  );

  // One timeline lane. Rendered by both the video and the audio group.
  //
  // Right-clicking EMPTY lane space opens the lane menu (add a scene / audio at
  // that frame). A right-click on a CLIP is stopped from bubbling by
  // TimelineItem (see its onContextMenu) so only the clip's own menu opens —
  // Radix does not do that for us. Left-drag still marquee-selects, because
  // TimelineItem's pointerdown ignores non-left buttons.
  const renderLane = (t) => (
    <ContextMenu key={t.id}>
      <ContextMenuTrigger asChild>
        <div
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
          onPointerDown={(e) => { if (e.target === e.currentTarget) startMarquee(e); }}
          // Remember WHERE the menu was opened — Radix's onSelect gives no event, so
          // the frame under the cursor has to be captured here.
          onContextMenu={(e) => { laneMenuRef.current = { trackId: t.id, from: frameAtClientX(e.clientX) }; }}
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
              selected={selectedIds.has(item.id)}
              linkHighlight={!!item.linkId && selectedLinkIds.has(item.linkId) && !selectedIds.has(item.id)}
              multiCount={selectedIds.has(item.id) ? selectedIds.size : 0}
              canSplit={Math.round(frame) > item.from && Math.round(frame) < item.from + item.durationInFrames}
              onSelect={selectItem}
              onDragStart={onDragStart}
              onFadeStart={onFadeStart}
              onToggleDisable={toggleDisable}
              onRemove={removeItem}
              onUnlink={unlinkItem}
              onLinkSelected={linkSelected}
              onDetachAudio={detachAudio}
              onSplit={splitAtPlayhead}
              onNewStill={openSceneForItem}
              onSwapTake={swapTake}
              takes={item.shot && item.bundle ? takesByShot[`${item.bundle}/${item.shot}`] : undefined}
            />
          ))}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {t.type === "video" ? (
          <ContextMenuItem onSelect={() => openSceneForLane(t)} disabled={agentIsBusy(agent)}>
            <span className="flex items-center gap-2"><Plus size={14} /> Add scene here…</span>
          </ContextMenuItem>
        ) : (
          <ContextMenuItem onSelect={() => setAudioTarget({ trackId: t.id, from: laneMenuRef.current?.from ?? 0 })}>
            <span className="flex items-center gap-2"><Music size={14} /> Add audio here…</span>
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => addChannel(t, "before")}>
          <span className="flex items-center gap-2"><Plus size={14} /> Add {t.type === "audio" ? "audio" : "video"} channel above</span>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => addChannel(t, "after")}>
          <span className="flex items-center gap-2"><Plus size={14} /> Add {t.type === "audio" ? "audio" : "video"} channel below</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );

  return (
    <div className="w-full min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold tracking-tight">Editor</h2>
          {timeline?.source && (
            <Badge variant="secondary" className="font-mono">
              {paceableKind ? (paceableKind === "radio" ? "radio version" : "animatic") : `from cut v${timeline.source.v}`}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {saveState === "saving" && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 size={12} className="animate-spin" /> saving…</span>}
          {saveState === "saved" && <span className="flex items-center gap-1 text-xs text-primary"><Check size={12} /> saved</span>}
          {saveState === "error" && <span className="text-xs text-destructive">save failed</span>}
          {paceableKind && (
            <Button variant="outline" size="sm" onClick={commitPacing} disabled={committingPacing}
              title="Write this timeline's pacing back to the Shot list durations, so the animatic and the episode video generation match it">
              {committingPacing ? <><Loader2 size={14} className="animate-spin" /> committing…</> : <><Timer size={14} /> Commit pacing</>}
            </Button>
          )}
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
      {pacingNotice && (
        <p className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground">
          <Check size={13} className="shrink-0 text-primary" /> {pacingNotice}
        </p>
      )}

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
              stills={stills}
              collapsed={poolCollapsed}
              height={poolH}
              onToggle={() => setPoolCollapsed((c) => !c)}
              dragId={poolDrag?.item.id}
              onMeta={onPoolMeta}
              onDragStart={startPoolDrag}
              tab={poolTab}
              onTab={setPoolTab}
              onStillOpen={setStillModal}
            />
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div
                  ref={playerWrapRef}
                  data-editor-region="preview"
                  className="relative min-w-0 self-start overflow-hidden rounded-xl border bg-black"
                  // Natural mode fills the row (width-driven). Once the timeline
                  // resizer sets a height, drive the width from it instead.
                  style={playerH
                    ? { flex: "0 1 auto", width: Math.round(playerH * playerAspect), maxWidth: "100%" }
                    : { flex: "1 1 0%" }}
                >
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
                    spaceKeyToPlayOrPause={false}
                    playbackRate={playbackRate}
                    acknowledgeRemotionLicense
                  />
                  {playbackRate !== 1 && (
                    <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-md bg-black/70 px-2 py-1 text-xs font-semibold tabular-nums text-white">
                      {playbackRate < 0 ? "◀◀" : "▶▶"} {Math.abs(playbackRate)}×
                    </div>
                  )}
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={grabStill} disabled={grabbing}>
                  <Camera size={14} /> Grab still
                  <ContextMenuShortcut>{fmtTime(framesToSec(frame, fps))}</ContextMenuShortcut>
                </ContextMenuItem>
                {(() => {
                  const clip = itemAtFrame(timeline, Math.round(frame));
                  return (
                    <>
                      <ContextMenuSeparator />
                      <ContextMenuItem onSelect={() => flipClipAtPlayhead("h")} disabled={!clip}>
                        <FlipHorizontal2 size={14} /> Flip horizontal
                        {clip?.flipH && <ContextMenuShortcut><Check size={14} /></ContextMenuShortcut>}
                      </ContextMenuItem>
                      <ContextMenuItem onSelect={() => flipClipAtPlayhead("v")} disabled={!clip}>
                        <FlipVertical2 size={14} /> Flip vertical
                        {clip?.flipV && <ContextMenuShortcut><Check size={14} /></ContextMenuShortcut>}
                      </ContextMenuItem>
                    </>
                  );
                })()}
              </ContextMenuContent>
            </ContextMenu>
          </div>

          {/* Resizer above the timeline: an edge-to-edge divider separating the
              player section (up) from the timeline (down). Hovering it reveals
              the drag grip; drag up to shrink the media-pool + player row and
              give the timeline more room. Double-click resets. */}
          <div
            className="group relative -my-2 -top-2.5 flex h-4 cursor-row-resize touch-none items-center"
            onPointerDown={startTopResize}
            onDoubleClick={() => setPlayerH(null)}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize preview / timeline split"
            title="Drag to resize the preview / timeline split · double-click to reset"
          >
            <div className="h-px w-full bg-border transition-colors group-hover:h-0.5 group-hover:bg-primary/60 group-active:h-0.5 group-active:bg-primary" />
            <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md border bg-card px-1.5 py-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-active:opacity-100">
              <GripHorizontal size={13} className="text-muted-foreground" />
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => splitAtPlayhead()}
                disabled={!splittableAt(timeline, Math.round(frame), selectedIds)}
                title="Split the clip(s) at the playhead (S)"
              >
                <Scissors size={14} /> Split
              </Button>
              <Button variant="outline" size="sm" onClick={closeGapsAll} title="Lay video clips end-to-end on every channel, removing gaps">
                <FoldHorizontal size={14} /> Close gaps
              </Button>
              <Button
                variant={magnet ? "default" : "outline"}
                size="sm"
                onClick={() => setMagnet((m) => !m)}
                aria-pressed={magnet}
                title={magnet
                  ? "Snapping on — dragged clips snap to nearby edges. Click to turn off."
                  : "Snapping off — clips move freely. Click to turn on (magnet)."}
              >
                <Magnet size={14} /> Snap
              </Button>
              <Button
                variant={selectionLinked ? "default" : "outline"}
                size="sm"
                onClick={() => (selectionLinked ? unlinkSelected() : linkSelected())}
                disabled={!selectionLinked && selectedIds.size < 2}
                aria-pressed={selectionLinked}
                title={selectionLinked
                  ? "The selected clips are linked — click to unlink them."
                  : selectedIds.size >= 2
                    ? "Link the selected clips so they move, trim and delete together."
                    : "Select 2+ clips (drag-select or Cmd-click) to link them."}
              >
                {selectionLinked ? <Link2 size={14} /> : <Unlink2 size={14} />} Link
              </Button>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">zoom</span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => zoomBy(1 / ZOOM_STEP)}
                  disabled={pxPerSec <= minZoom}
                  aria-label="Zoom out"
                  title="Zoom out"
                >
                  <ZoomOut size={14} />
                </Button>
                <Slider
                  className="w-28"
                  min={minZoom} max={maxZoom} step={1}
                  value={[pxPerSec]}
                  onValueChange={([v]) => zoomTo(v)}
                  aria-label="Timeline zoom"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => zoomBy(ZOOM_STEP)}
                  disabled={pxPerSec >= maxZoom}
                  aria-label="Zoom in"
                  title="Zoom in"
                >
                  <ZoomIn size={14} />
                </Button>
              </div>
            </div>
          </div>

          {/* Timeline tracks */}
          <div data-editor-region="timeline" className="overflow-hidden rounded-xl border bg-muted/20">
            <div className="flex">
              {/* track labels — split into video / audio rails that mirror
                  their lane group's vertical scroll */}
              <div className="w-24 shrink-0 border-r bg-card">
                <div className="h-7 border-b" />
                <div ref={videoLabelsRef} className="overflow-hidden" style={{ height: vGroupH }}>
                  {videoTracks.map(renderLabel)}
                </div>
                <div className="h-1.5 bg-border" />
                <div ref={audioLabelsRef} className="overflow-hidden" style={{ height: aGroupH }}>
                  {audioTracks.map(renderLabel)}
                </div>
              </div>
              {/* scrollable lane area */}
              <div ref={trackAreaRef} className="relative min-w-0 flex-1 overflow-x-auto">
                <div style={{ width: contentWidth }}>
                  {/* ruler — press seeks here, and dragging scrubs the playhead
                      (same continuous drag as grabbing the playhead head). */}
                  <div className="relative h-7 cursor-ew-resize select-none border-b bg-card" onPointerDown={startScrub}>
                    {rulerTicks.map((t, i) => (
                      <div
                        key={i}
                        className={cn(
                          "absolute bottom-0 w-px",
                          t.major ? "top-0 bg-border" : "top-[62%] bg-border/50",
                        )}
                        style={{ left: t.x }}
                      >
                        {t.label != null && (
                          <span className="absolute left-1 top-0 text-[10px] tabular-nums text-muted-foreground">
                            {t.label}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  {/* lanes — the video group above, the audio group below, a
                      FIXED divider between them. Each group scrolls vertically
                      past MAX_VISIBLE_LANES lanes (its label rail mirrors the
                      scroll). Clicking empty lane space deselects. */}
                  <div ref={lanesWrapRef} className="relative">
                  {/* magnet snap guide — a full-height line at the edge being snapped to */}
                  {snapLine != null && (
                    <div
                      className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-primary"
                      style={{ left: framesToSec(snapLine, fps) * pxPerSec }}
                    />
                  )}
                  {/* rubber-band drag-select rectangle */}
                  {marquee && (
                    <div
                      className="pointer-events-none absolute z-40 border border-white/70 bg-white/15"
                      style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
                    />
                  )}
                  <div
                    className="overflow-y-auto overflow-x-hidden"
                    style={{ height: vGroupH }}
                    onScroll={(e) => { if (videoLabelsRef.current) videoLabelsRef.current.scrollTop = e.currentTarget.scrollTop; }}
                  >
                    {videoTracks.map(renderLane)}
                  </div>
                  {/* the fixed line separating the video and audio track groups */}
                  <div className="h-1.5 bg-border" />
                  <div
                    className="overflow-y-auto overflow-x-hidden"
                    style={{ height: aGroupH }}
                    onScroll={(e) => { if (audioLabelsRef.current) audioLabelsRef.current.scrollTop = e.currentTarget.scrollTop; }}
                  >
                    {audioTracks.map(renderLane)}
                  </div>
                  {/* "new channel" drop line — placed from the live lane rects
                      at the matching group's border while dragging a card */}
                  {dropTarget?.type === "new" && (
                    <div
                      className="pointer-events-none absolute left-0 right-0 z-30 h-0.5 -translate-y-1/2 bg-primary"
                      style={{ top: dropTarget.y }}
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
                      style={{ top: poolDrag.drop.y }}
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

          {/* Inspector for the selected item(s) */}
          {selectedIds.size > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Layers size={14} /> {selectedIds.size} clips selected
                <span className="text-xs font-normal text-muted-foreground">drag any of them to move the group</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Button variant="outline" size="sm" onClick={linkSelected} title="Link the selected clips so they move, trim and delete together">
                  <Link2 size={13} /> Link clips
                </Button>
                <Button variant="destructive" size="sm" onClick={removeSelected}>
                  <Trash2 size={13} /> Remove
                </Button>
              </div>
            </div>
          ) : selected ? (
            <div className="rounded-xl border bg-card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {selected.track.type === "audio" ? <Music size={14} /> : <Film size={14} />}
                  <span className="truncate">{selected.item.name}</span>
                  {selected.item.bundle && <Badge variant="secondary" className="font-mono">{selected.item.bundle}</Badge>}
                  {selected.item.linkId && (
                    <Badge variant="info" className="gap-1"><Link2 size={11} /> linked</Badge>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {selected.item.linkId && (
                    <Button variant="outline" size="sm" onClick={() => unlinkItem(selected.item.id)} title="Unlink from its linked clips">
                      <Unlink2 size={13} /> Unlink
                    </Button>
                  )}
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
                {(selected.item.offsetFrames || 0) > 0 && (
                  <div className="text-xs">
                    <div className="mb-1 text-muted-foreground">Source in</div>
                    <div className="tabular-nums">{fmtTime(framesToSec(selected.item.offsetFrames, fps))}</div>
                  </div>
                )}
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
                    <IconSwap
                      active={selected.item.muted || selected.item.volume === 0}
                      on={<VolumeX size={12} />}
                      off={<Volume2 size={12} />}
                    /> Volume
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
              Click a clip to trim, reorder, adjust volume or remove it. Drag a clip to move it, its right edge to trim the end,
              or its left edge to trim the start. Press S (or the Split button) to cut the clip(s) under the playhead in two.
              Drag it onto another channel — or up/down past the edge to spawn a new one; higher channels play on top.
              On audio clips, drag the dots at the top corners to fade in / out.
              Video clips dropped from the pool carry their audio as a separate linked clip on the audio tracks — linked clips
              always move, trim and delete together; right-click to unlink or detach a clip's audio.
              Drag on empty timeline space to rubber-band-select clips (Cmd-click adds one at a time), then move them together
              or right-click → Link selected clips to make the group permanent.
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

      {/* Still inspector: full-size grabbed frame + its capture metadata. */}
      {/* Author one shot's still, from the timeline (lane menu / item menu). */}
      <SceneDialog
        open={!!sceneTarget}
        target={sceneTarget}
        busy={sceneBusy}
        onOpenChange={(o) => { if (!o) setSceneTarget(null); }}
        onGenerate={generateStill}
      />
      {/* Drop an existing Sound Studio take onto an audio lane. */}
      <AudioDialog
        open={!!audioTarget}
        onOpenChange={(o) => { if (!o) setAudioTarget(null); }}
        onPick={addAudioAt}
      />

      <Dialog open={!!stillModal} onOpenChange={(o) => { if (!o) setStillModal(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera size={16} className="text-amber-400" />
              {stillModal?.sourceBundle || stillModal?.sourceName || "Grabbed still"}
            </DialogTitle>
            <DialogDescription>A frame captured from the editor preview.</DialogDescription>
          </DialogHeader>
          {stillModal && (
            <div className="space-y-3">
              <img src={stillModal.url} alt="" className="w-full rounded-md border bg-black" />
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                <StillMeta label="Source clip" value={stillModal.sourceName} />
                <StillMeta label="Bundle" value={stillModal.sourceBundle} />
                <StillMeta label="Timeline time" value={stillModal.timeSec != null ? fmtTime(stillModal.timeSec) : null} />
                <StillMeta label="Time into clip" value={stillModal.clipTimeSec != null ? fmtTime(stillModal.clipTimeSec) : null} />
                <StillMeta label="Frame" value={stillModal.frame != null ? `${stillModal.frame} @ ${stillModal.fps || fps}fps` : null} />
                <StillMeta label="Resolution" value={stillModal.width ? `${stillModal.width} × ${stillModal.height}` : null} />
                <StillMeta label="Captured" value={stillModal.createdAt ? new Date(stillModal.createdAt).toLocaleString() : null} />
                <StillMeta label="Source file" value={stillModal.sourceSrc} mono />
              </dl>
              <div className="flex items-center justify-between gap-2 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => deleteStill(stillModal.id)}
                >
                  <Trash2 size={14} /> Delete
                </Button>
                <div className="flex gap-2">
                  <Button asChild variant="outline" size="sm">
                    <a href={stillModal.url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open</a>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <a href={stillModal.url} download={stillModal.file}><Download size={14} /> Download</a>
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// One key/value row in the still inspector's metadata list (hidden if empty).
function StillMeta({ label, value, mono }) {
  if (value == null || value === "") return null;
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("truncate", mono && "font-mono text-[11px]")} title={String(value)}>{value}</dd>
    </div>
  );
}
