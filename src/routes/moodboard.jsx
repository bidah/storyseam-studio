// The Moodboard — an infinite reference canvas for the episode.
//
// Ported from idea-mural's board. Everything you can put on it arrives the way
// you already have it: drag files in from Finder, paste an image from the
// clipboard, paste a URL (unfurled into a link card, or fetched and stored as a
// playable video when it points straight at a video file), or double-click empty
// canvas for a sticky note. Cards snap to each other's edges, stack into
// bundles, and the whole board is undoable.
//
// Persistence: the board is a D1 document mutated by OPS (see
// lib/useMoodboardSync.js and lib/moodboard-document.js), not a whole-document
// PUT — two authors dragging different cards must not clobber each other. The
// loader supplies the server snapshot and every mutation flows back through the
// same `/api/data/events` firehose the rest of the app uses, so a second tab and
// the chat agent both see changes without a manual refresh.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Panel as FlowPanel,
  SelectionMode, useReactFlow, useNodesState, applyNodeChanges,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import {
  BringToFront, ClipboardPaste, Copy, CopyPlus, ImageUp, Layers, Layers2,
  Loader2, SendToBack, StickyNote, Trash2, Undo2, Redo2,
} from "lucide-react";
import { swr, useRevalidateOnMount } from "@/lib/swr";
import { useT } from "@/lib/i18n";
import { invalidateTabCache } from "@/lib/tabCache";
import { getProjectId } from "@/lib/projectFetch";
import { useShell } from "@/lib/shellContext";
import { useMoodboardSync } from "@/lib/useMoodboardSync";
import { getHelperLines } from "@/lib/moodboardHelperLines";
import { postItSize, stripHtml, POSTIT_W, POSTIT_H } from "@/lib/moodboardPostit";
import PostItNode from "@/components/moodboard/PostItNode";
import LinkCardNode from "@/components/moodboard/LinkCardNode";
import ImageNode from "@/components/moodboard/ImageNode";
import VideoNode from "@/components/moodboard/VideoNode";
import HelperLines from "@/components/moodboard/HelperLines";
import { Empty, ErrorNote } from "@/components/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuShortcut, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const nodeTypes = { postIt: PostItNode, linkCard: LinkCardNode, image: ImageNode, video: VideoNode };

// React Flow z-index floor for stacked cards, so a bundle's front card (order
// index 0, highest z) sits above ordinary unstacked cards.
const BUNDLE_Z_BASE = 1000;
// Cascade step (px) between consecutive cards in a stack — front-to-back, down-right.
const STACK_STEP = 16;

// Longest-edge ceiling for a freshly added image's footprint, so a large photo
// lands at a sane size (still freely resizable afterwards).
const MAX_IMAGE_DISPLAY = 320;
// Videos get a slightly larger default footprint than images (they carry their
// own playback controls along the bottom edge).
const MAX_VIDEO_DISPLAY = 480;
// Direct video-file URLs we turn into a playable card (rather than a link
// preview). Matched against the URL's path; query string ignored.
const VIDEO_URL_RE = /\.(mp4|webm|mov|m4v|ogv|mkv)(?:$|[?#])/i;

const LINK_W = 280;
const LINK_H = 260;

// Post-it geometry used for grid snapping. The gap matches the canvas
// background grid so snapped cards read as aligned rows/columns.
const SNAP_GAP = 20;
const PITCH_X = POSTIT_W + SNAP_GAP;
const PITCH_Y = POSTIT_H + SNAP_GAP;
// How many empty cells out from an existing card we still snap; beyond this a
// click starts a fresh, free-placed card.
const SNAP_RANGE = 3;
// While dragging, a card's border snaps to the canvas dots. Half the dot gap so
// it lands on a dot, the midpoint between two dots, or the next dot over.
const DOT_SNAP = SNAP_GAP / 2;
const snapToDots = (v) => Math.round(v / DOT_SNAP) * DOT_SNAP;

const mediaUrl = (file) => `/moodboard-media/${encodeURIComponent(file)}`;
// Image cards are small on the canvas, so they render the derived webp tier
// rather than the original upload (which can be a many-MB PNG). Videos keep
// mediaUrl — /img/ is images only.
const imageCardUrl = (file) => `/img/display/moodboard-media/${encodeURIComponent(file)}`;
const imageThumbUrl = (file) => `/img/thumb/moodboard-media/${encodeURIComponent(file)}`;

// A card's on-canvas footprint, by type. Post-its derive theirs from their text
// (the square↔notepad morph), so it is never stored.
function cardSize(c) {
  if (c.type === "link") return { w: LINK_W, h: LINK_H };
  if (c.type === "image" || c.type === "video") {
    return { w: c.width ?? POSTIT_W, h: c.height ?? POSTIT_H };
  }
  const { width, height } = postItSize(c.content ?? "");
  return { w: width, h: height };
}

// Load a pasted/dropped image just to read its intrinsic dimensions (needed to
// pick the initial footprint and pin the resize aspect ratio).
function readImageSize(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(t("Could not read image")));
    };
    img.src = url;
  });
}

// Best-effort probe of a video's intrinsic dimensions from its source URL, used
// to pick the card's initial footprint + aspect. Falls back to 16:9 if the
// source blocks the probe (CORS / hotlink) or stalls — our stored copy still
// plays fine, it just starts at the default aspect.
function readVideoSize(url) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    let settled = false;
    const done = (w, h) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ w: w || 480, h: h || 270 });
    };
    const timer = setTimeout(() => done(480, 270), 6000);
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () => done(v.videoWidth, v.videoHeight);
    v.onerror = () => done(480, 270);
    v.src = url;
  });
}

// Given a desired drop center (flow coords), return the top-left for a new
// post-it. If the click lands in the invisible card-sized cell adjacent to an
// existing post-it, snap onto that card's grid so the two align on the same
// row/column with a uniform gap. Otherwise place freely, centered on the click.
function placePostIt(centerX, centerY, cards) {
  const free = { x: centerX - POSTIT_W / 2, y: centerY - POSTIT_H / 2 };

  // Anchor to the nearest post-it (link/image cards have different footprints
  // and would skew the grid).
  let anchor = null;
  let best = Infinity;
  for (const c of cards) {
    if (c.type !== "postIt") continue;
    const { w, h } = cardSize(c);
    const cx = c.x + w / 2;
    const cy = c.y + h / 2;
    const d = Math.hypot(cx - centerX, cy - centerY);
    if (d < best) {
      best = d;
      anchor = { cx, cy };
    }
  }
  if (!anchor) return free;

  let col = Math.round((centerX - anchor.cx) / PITCH_X);
  let row = Math.round((centerY - anchor.cy) / PITCH_Y);

  // Too far from any card — treat as a new free-floating card.
  if (Math.abs(col) > SNAP_RANGE || Math.abs(row) > SNAP_RANGE) return free;

  // Click landed on the anchor's own cell: nudge to the adjacent cell on the
  // side the cursor leaned toward so we never stack on top of it.
  if (col === 0 && row === 0) {
    const dx = centerX - anchor.cx;
    const dy = centerY - anchor.cy;
    if (Math.abs(dx) >= Math.abs(dy)) col = dx >= 0 ? 1 : -1;
    else row = dy >= 0 ? 1 : -1;
  }

  return {
    x: anchor.cx + col * PITCH_X - POSTIT_W / 2,
    y: anchor.cy + row * PITCH_Y - POSTIT_H / 2,
  };
}

// Copied cards travel on the SYSTEM clipboard as a tagged JSON blob, so they can
// be pasted on this board, in another tab, or into another project. Writing it
// also evicts any stale image/URL, and a later external image/URL copy
// overwrites it, keeping paste last-write-wins.
//
// `sourceProjectId` lets paste skip image/video cards copied from a DIFFERENT
// project, whose R2 bytes live under that project's media prefix and would 404
// here — a broken card is worse than a missing one.
const CLIPBOARD_TAG = "shot-studio/moodboard@1";

function parseCardClipboard(text) {
  if (!text || text[0] !== "{") return null;
  try {
    const v = JSON.parse(text);
    if (v && v.tag === CLIPBOARD_TAG && Array.isArray(v.cards)) return v;
  } catch {
    /* not our payload */
  }
  return null;
}

// Persist the pan/zoom the author left the board on, per project — reopening the
// tab should land where they were looking, not re-fit the whole board.
const viewportKey = (pid) => `moodboard-viewport:${pid || "p_default"}`;
const DEFAULT_ZOOM = 0.8;

function loadViewport(pid) {
  try {
    const v = JSON.parse(localStorage.getItem(viewportKey(pid)) || "null");
    if (typeof v?.x === "number" && typeof v?.y === "number" && typeof v?.zoom === "number") return v;
  } catch {
    /* malformed/unavailable storage */
  }
  return null;
}

function saveViewport(pid, v) {
  try {
    localStorage.setItem(viewportKey(pid), JSON.stringify(v));
  } catch {
    /* quota/unavailable storage */
  }
}

function Canvas() {
  const t = useT();
  const loaded = useLoaderData();
  useRevalidateOnMount("moodboard");
  const { setModalImage } = useShell();
  const { screenToFlowPosition } = useReactFlow();
  const sync = useMoodboardSync(loaded);
  // Scopes the saved viewport and tags the clipboard payload. Read from the
  // client-side project shim rather than the payload: it is the same value the
  // fetch shim stamps on every request, so the two can never disagree.
  const projectId = getProjectId();

  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [editingNodeId, setEditingNodeId] = useState(null);
  const [busy, setBusy] = useState(0); // in-flight uploads/unfurls, for the header pill
  // Right-click menu: screen coords to anchor at + the card it targets, or
  // cardId null for the empty-canvas menu (Paste).
  const [menu, setMenu] = useState(null);
  // Open the "Choose the front card" picker for these ids (the selection
  // snapshot at the moment "Stack notes" was chosen).
  const [stackPicker, setStackPicker] = useState(null);
  // Flow-coordinate positions of the guides shown while dragging a single card;
  // cleared (undefined) on drop or when nothing lines up.
  const [helperV, setHelperV] = useState(undefined);
  const [helperH, setHelperH] = useState(undefined);

  const lastClickRef = useRef(0);
  // Last pointer position in flow coords — where a clipboard paste lands.
  const lastPointerFlow = useRef(null);
  // Same-tab fallback snapshot for ⌘C → ⌘V, used when the OS clipboard read is
  // blocked. The OS clipboard is the cross-tab/cross-project source.
  const clipboardRef = useRef([]);

  // Once our own edits have all landed, take a fresh look at the server. While
  // the outbox had work in it the store refused every incoming snapshot (it
  // would have been older than our optimistic state), so this is the moment a
  // collaborator's concurrent change can finally be adopted.
  const revalidator = useRevalidator();
  const revalidate = revalidator.revalidate;
  useEffect(() => {
    if (!sync.settled) return; // 0 = nothing has been sent yet
    invalidateTabCache("moodboard");
    revalidate();
  }, [sync.settled, revalidate]);

  const savedViewport = useMemo(() => loadViewport(projectId), [projectId]);
  const onMoveEnd = useCallback((_, viewport) => saveViewport(projectId, viewport), [projectId]);

  // React Flow owns the node array so its change pipeline (applyNodeChanges)
  // keeps each node's internals — most importantly `measured` (dimensions) and
  // the live `dragging` position. The synced board is the source of truth; we
  // reconcile it *into* this state rather than rebuilding the array from scratch
  // every render, which would drop `measured` and make RF hide the un-measured
  // cards for a frame (the drag "flicker").
  const [nodes, setNodes] = useNodesState([]);

  // Always read the latest sync/nodes from the callbacks below without making
  // them depend on values that change every render.
  const syncRef = useRef(sync);
  useEffect(() => {
    syncRef.current = sync;
  });
  const nodesRef = useRef(nodes);
  useEffect(() => {
    nodesRef.current = nodes;
  });

  const openImage = useCallback(
    (url) => setModalImage({ url, name: t("Moodboard image"), role: "reference" }),
    [setModalImage],
  );

  // A primitive fingerprint of everything that affects node rendering. The
  // effect below only reconciles when this string actually changes, so a
  // setNodes-triggered re-render alone won't loop back into another reconcile.
  const cardSig = useMemo(
    () =>
      JSON.stringify({
        cards: sync.cards.map((c) => [
          c.id, c.type, c.x, c.y, c.content, c.color, c.border, c.align, c.url,
          c.previewData, c.imageKey, c.videoKey, c.width, c.height, c.bundleId, c.z,
          selectedIds.has(c.id), editingNodeId === c.id,
        ]),
        // Fold in stack order/front so a reorder or front change re-renders even
        // when member x/y already matched, and so zIndex refreshes on existing nodes.
        bundles: sync.bundles.map((b) => [b.id, b.frontId, b.order]),
      }),
    [sync.cards, sync.bundles, selectedIds, editingNodeId],
  );

  useEffect(() => {
    const s = syncRef.current;
    // Map each stacked card → its draw index (0 = front/top). Front gets the
    // highest zIndex so it sits above the rest of the cascade.
    const stackIndex = new Map();
    for (const b of s.bundles) {
      b.order.forEach((id, idx) => stackIndex.set(id, { len: b.order.length, idx }));
    }
    // Stacked cards draw by their bundle order (floored above loose cards);
    // loose cards draw by their own persisted z (undefined → RF default 0).
    const zFor = (card) => {
      const m = stackIndex.get(card.id);
      return m ? BUNDLE_Z_BASE + (m.len - m.idx) : card.z;
    };

    const desired = s.cards.map((card) => {
      const base = {
        id: card.id,
        position: { x: card.x, y: card.y },
        selected: selectedIds.has(card.id),
        zIndex: zFor(card),
      };
      if (card.type === "link") {
        return {
          ...base,
          type: "linkCard",
          draggable: editingNodeId !== card.id,
          data: {
            url: card.url,
            previewData: card.previewData,
            onDelete: () => s.remove(card.id),
          },
        };
      }
      if (card.type === "image" || card.type === "video") {
        const file = card.type === "image" ? card.imageKey : card.videoKey;
        return {
          ...base,
          type: card.type,
          width: card.width,
          height: card.height,
          draggable: true,
          data: {
            src: card.type === "image" ? imageCardUrl(file) : mediaUrl(file),
            width: card.width ?? 0,
            height: card.height ?? 0,
            naturalWidth: card.naturalWidth ?? card.width ?? (card.type === "video" ? 16 : 1),
            naturalHeight: card.naturalHeight ?? card.height ?? (card.type === "video" ? 9 : 1),
            onView: openImage,
            onDelete: () => s.remove(card.id),
          },
        };
      }
      // Square by default; morphs to a taller "notepad" shape once the body
      // outgrows a square (handled in PostItNode + CSS). We leave width/height
      // unset so RF measures the animating element, keeping the node box in step
      // with the 150ms morph; the snapping/bounds math derives the footprint
      // from content via cardSize() instead.
      return {
        ...base,
        type: "postIt",
        draggable: editingNodeId !== card.id,
        data: {
          content: card.content,
          color: card.color,
          border: card.border ?? false,
          align: card.align,
          onUpdate: (content) => s.setContent(card.id, content),
          onSetBorder: (border) => s.setBorder(card.id, border),
          onSetAlign: (align) => s.setAlign(card.id, align),
          onDelete: () => s.remove(card.id),
          onEditStart: () => setEditingNodeId(card.id),
          onEditEnd: () => setEditingNodeId((p) => (p === card.id ? null : p)),
        },
      };
    });

    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      return desired.map((d) => {
        const ex = byId.get(d.id);
        if (!ex) return d;
        // Reuse the existing node so RF internals (measured dimensions, etc.)
        // survive. Never yank a node out from under an active drag or resize.
        return {
          ...ex,
          type: d.type,
          data: d.data,
          draggable: d.draggable,
          selected: d.selected,
          zIndex: d.zIndex,
          position: ex.dragging ? ex.position : d.position,
          width: ex.resizing ? ex.width : d.width,
          height: ex.resizing ? ex.height : d.height,
        };
      });
    });
  }, [cardSig]); // eslint-disable-line react-hooks/exhaustive-deps

  const onNodesChange = useCallback(
    (changes) => {
      // While moving a single card, snap its live position to any near edge of
      // another card. We mutate the change in place so both RF state and the
      // shared store receive the snapped value — including the final drop frame
      // (dragging: false), so the snap sticks instead of springing back. The
      // guides are only *shown* during the drag, never on release.
      setHelperV(undefined);
      setHelperH(undefined);
      const dragChange = changes[0];
      if (changes.length === 1 && dragChange.type === "position" && dragChange.position) {
        const lines = getHelperLines(dragChange, nodesRef.current);
        // Prefer aligning to a nearby card edge; otherwise fall back to the dot
        // grid so a free-floating card still lands on a dot/midpoint.
        dragChange.position.x = lines.snapPosition.x ?? snapToDots(dragChange.position.x);
        dragChange.position.y = lines.snapPosition.y ?? snapToDots(dragChange.position.y);
        if (dragChange.dragging) {
          setHelperV(lines.vertical);
          setHelperH(lines.horizontal);
        }
      }

      // Move-as-one: when a position change targets a stacked card, fan the same
      // delta out to every sibling that isn't already moving in this batch, so
      // dragging any one card slides the whole stack and keeps the cascade.
      const bundles = syncRef.current.bundles;
      if (bundles.length) {
        const prevById = new Map(nodesRef.current.map((n) => [n.id, n.position]));
        const moving = new Set();
        for (const c of changes) if (c.type === "position" && c.position) moving.add(c.id);
        const extra = [];
        for (const ch of changes) {
          if (ch.type !== "position" || !ch.position) continue;
          const bundle = bundles.find((b) => b.order.includes(ch.id));
          if (!bundle) continue;
          const prev = prevById.get(ch.id);
          if (!prev) continue;
          const dx = ch.position.x - prev.x;
          const dy = ch.position.y - prev.y;
          if (dx === 0 && dy === 0) continue;
          for (const mid of bundle.order) {
            if (moving.has(mid)) continue;
            const sp = prevById.get(mid);
            if (!sp) continue;
            moving.add(mid);
            extra.push({
              id: mid,
              type: "position",
              position: { x: sp.x + dx, y: sp.y + dy },
              dragging: ch.dragging,
            });
          }
        }
        if (extra.length) changes = changes.concat(extra);
      }

      // Apply to RF-owned state first so position/dimensions/drag internals stay
      // intact, then mirror the meaningful changes into the shared store.
      setNodes((nds) => applyNodeChanges(changes, nds));
      const s = syncRef.current;
      for (const change of changes) {
        if (change.type === "position" && change.position) {
          s.move(change.id, change.position.x, change.position.y);
        } else if (
          // NodeResizer (image/video cards) dispatches dimension changes here;
          // the `resizing` flag marks them apart from React Flow's automatic
          // measurement of post-its/link cards, which must not be persisted.
          change.type === "dimensions" &&
          change.dimensions &&
          change.resizing !== undefined
        ) {
          s.resize(change.id, change.dimensions.width, change.dimensions.height);
        } else if (change.type === "select") {
          setSelectedIds((prev) => {
            const next = new Set(prev);
            if (change.selected) next.add(change.id);
            else next.delete(change.id);
            return next;
          });
        } else if (change.type === "remove") {
          s.remove(change.id);
        }
      }

      // Auto-raise: selecting a single card lifts it to the top of the loose
      // stack and persists that — React Flow's own select-elevation is transient
      // and springs back on deselect. Only when exactly one card is freshly
      // selected in this batch; a marquee that selects many at once shouldn't
      // reshuffle their order.
      let raiseId = null;
      let selectedCount = 0;
      for (const c of changes) {
        if (c.type === "select" && c.selected) {
          selectedCount++;
          raiseId = c.id;
        }
      }
      if (selectedCount === 1 && raiseId) s.bringToFront(raiseId);
    },
    [setNodes],
  );

  // ---- creating cards ------------------------------------------------------

  const addNoteAt = useCallback(
    (center) => {
      const { x, y } = placePostIt(center.x, center.y, syncRef.current.cards);
      const newId = syncRef.current.addPostIt(x, y);
      // Select the fresh card so PostItNode's auto-edit effect focuses its
      // editor immediately — no second click needed to start writing.
      setSelectedIds(new Set([newId]));
    },
    [],
  );

  const onPaneClick = useCallback(
    (event) => {
      const now = Date.now();
      const isDouble = now - lastClickRef.current < 300;
      lastClickRef.current = now;
      if (isDouble) addNoteAt(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
      else setSelectedIds(new Set());
    },
    [addNoteAt, screenToFlowPosition],
  );

  const viewportCenter = useCallback(
    () => screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }),
    [screenToFlowPosition],
  );

  const onPointerMove = useCallback(
    (e) => {
      lastPointerFlow.current = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    },
    [screenToFlowPosition],
  );

  // Upload an image file to R2, then drop an image card centered on `center`
  // (flow coords). Shared by clipboard paste, drag-and-drop and the Add button.
  const addImageFromFile = useCallback(
    async (file, center) => {
      if (!file.type.startsWith("image/")) {
        toast.error(t("Only images can be dropped on the moodboard."));
        return;
      }
      const toastId = toast.loading(t("Uploading image…"));
      setBusy((n) => n + 1);
      try {
        const { w, h } = await readImageSize(file);
        const scale = Math.min(1, MAX_IMAGE_DISPLAY / Math.max(w, h));
        const width = Math.round(w * scale);
        const height = Math.round(h * scale);
        const res = await fetch("/api/moodboard/image", {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || t("Upload failed"));
        syncRef.current.addImage({
          x: center.x - width / 2,
          y: center.y - height / 2,
          imageKey: json.file,
          width,
          height,
          naturalWidth: w,
          naturalHeight: h,
        });
        toast.success(t("Image added"), { id: toastId });
      } catch (err) {
        toast.error(String(err.message || err), { id: toastId });
      } finally {
        setBusy((n) => n - 1);
      }
    },
    [],
  );

  // Paste a direct video-file URL → the Worker fetches + stores it, then drop a
  // playable video card. The dimension probe runs in parallel with the upload so
  // the card lands at the right aspect; it falls back to 16:9 if blocked.
  const addVideoFromUrl = useCallback(async (url, center) => {
    const toastId = toast.loading(t("Fetching video…"));
    setBusy((n) => n + 1);
    try {
      const [json, { w, h }] = await Promise.all([
        fetch("/api/moodboard/video-from-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        }).then(async (res) => {
          const j = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(j.error || t("Could not fetch video"));
          return j;
        }),
        readVideoSize(url),
      ]);
      const scale = Math.min(1, MAX_VIDEO_DISPLAY / Math.max(w, h));
      const width = Math.round(w * scale);
      const height = Math.round(h * scale);
      syncRef.current.addVideo({
        x: center.x - width / 2,
        y: center.y - height / 2,
        videoKey: json.file,
        width,
        height,
        naturalWidth: w,
        naturalHeight: h,
      });
      toast.success(t("Video added"), { id: toastId });
    } catch (err) {
      toast.error(String(err.message || err), { id: toastId });
    } finally {
      setBusy((n) => n - 1);
    }
  }, []);

  const addLinkAt = useCallback((url, center) => {
    const id = syncRef.current.addLink(center.x - LINK_W / 2, center.y - LINK_H / 2, url);
    // The preview is fetched once, server-side, and stored on the card as an op
    // — so every viewer gets the same unfurl instead of each re-fetching it.
    setBusy((n) => n + 1);
    fetch(`/api/moodboard/unfurl?url=${encodeURIComponent(url)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => syncRef.current.setPreview(id, data))
      .catch(() => syncRef.current.setPreview(id, null))
      .finally(() => setBusy((n) => n - 1));
    return id;
  }, []);

  // Drag-and-drop image upload. The overlay shows while a drag is over the
  // canvas; each file lands where it was dropped.
  const { getRootProps, getInputProps, isDragActive, open: openFilePicker } = useDropzone({
    noClick: true,
    noKeyboard: true,
    multiple: true,
    onDrop: (accepted, _rejected, event) => {
      const de = event;
      const base =
        typeof de?.clientX === "number" && (de.clientX || de.clientY)
          ? screenToFlowPosition({ x: de.clientX, y: de.clientY })
          : viewportCenter();
      // Cascade multiple files so they don't land exactly on top of each other.
      accepted.forEach((file, i) =>
        addImageFromFile(file, { x: base.x + i * 24, y: base.y + i * 24 }),
      );
    },
  });

  // ---- copy / paste / duplicate -------------------------------------------

  const copySelection = useCallback(() => {
    const picked = syncRef.current.cards.filter((c) => selectedIds.has(c.id));
    if (!picked.length) return;
    // Snapshot, so later edits/deletes to the originals don't change what gets
    // pasted.
    const snapshot = picked.map((c) => ({ ...c }));
    clipboardRef.current = snapshot;
    const payload = { tag: CLIPBOARD_TAG, sourceProjectId: projectId, cards: snapshot };
    navigator.clipboard?.writeText(JSON.stringify(payload)).catch(() => {});
  }, [selectedIds, projectId]);

  // Resolve the paste anchor in flow coords: an explicit screen point (the
  // right-click menu) or the cursor's last position, else the viewport center.
  const pasteAnchor = useCallback(
    (screen) =>
      screen ? screenToFlowPosition(screen) : lastPointerFlow.current ?? viewportCenter(),
    [screenToFlowPosition, viewportCenter],
  );

  // Clone `cards` onto the board with their bounding box centered on `at` (flow
  // coords), so the group lands under the cursor with its relative layout kept.
  const placeCards = useCallback((cards, at) => {
    const minX = Math.min(...cards.map((c) => c.x));
    const minY = Math.min(...cards.map((c) => c.y));
    const maxX = Math.max(...cards.map((c) => c.x + cardSize(c).w));
    const maxY = Math.max(...cards.map((c) => c.y + cardSize(c).h));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const ids = cards.map((c) => syncRef.current.cloneCard(c, at.x + (c.x - cx), at.y + (c.y - cy)));
    setSelectedIds(new Set(ids));
  }, []);

  const pasteCardPayload = useCallback(
    (payload, screen) => {
      let cards = payload.cards;
      if (payload.sourceProjectId !== projectId) {
        const usable = cards.filter((c) => c.type !== "image" && c.type !== "video");
        const skipped = cards.length - usable.length;
        if (skipped) {
          toast(
            t("{skipped} image/video card{suffix} skipped — those paste only on their original project.", {
              skipped,
              suffix: skipped > 1 ? "s" : "",
            }),
          );
        }
        cards = usable;
      }
      if (cards.length) placeCards(cards, pasteAnchor(screen));
    },
    [projectId, placeCards, pasteAnchor],
  );

  // Same-tab fallback: paste the in-memory snapshot when the OS clipboard read
  // is unavailable. Always the same project, so every card type is kept.
  const pasteClipboard = useCallback(
    (screen) => {
      if (!clipboardRef.current.length) return;
      placeCards(clipboardRef.current, pasteAnchor(screen));
    },
    [placeCards, pasteAnchor],
  );

  // Right-click "Paste": read the OS clipboard inside the click gesture (so no
  // idle permission prompt) and paste at the menu point, falling back to the
  // same-tab snapshot when the read is blocked.
  const pasteFromMenu = useCallback(
    async (screen) => {
      try {
        const text = await navigator.clipboard.readText();
        const payload = parseCardClipboard(text);
        if (payload) {
          pasteCardPayload(payload, screen);
          return;
        }
        if (/^https?:\/\/\S+$/i.test(text.trim())) {
          const url = text.trim();
          const at = pasteAnchor(screen);
          if (VIDEO_URL_RE.test(url)) addVideoFromUrl(url, at);
          else addLinkAt(url, at);
          return;
        }
      } catch {
        /* clipboard read blocked — fall back to the in-memory snapshot */
      }
      pasteClipboard(screen);
    },
    [pasteCardPayload, pasteClipboard, pasteAnchor, addVideoFromUrl, addLinkAt],
  );

  const duplicateCard = useCallback((id) => {
    const src = syncRef.current.cards.find((c) => c.id === id);
    if (!src) return;
    const newId = syncRef.current.cloneCard(src, src.x + 24, src.y + 24);
    setSelectedIds(new Set([newId]));
  }, []);

  const deleteSelection = useCallback(() => {
    selectedIds.forEach((id) => syncRef.current.remove(id));
    setSelectedIds(new Set());
  }, [selectedIds]);

  // ---- stacking ------------------------------------------------------------

  const confirmStack = useCallback(
    (frontId) => {
      if (!stackPicker) return;
      const s = syncRef.current;
      const order = [frontId, ...stackPicker.ids.filter((id) => id !== frontId)];
      const anchor = s.cards.find((c) => c.id === frontId);
      if (!anchor || order.length < 2) {
        setStackPicker(null);
        return;
      }
      const positions = {};
      // Capture each member's current (pre-stack) position so Unstack can
      // scatter them back. This snapshot travels in the op — the single source
      // of truth — rather than being re-derived per replica, which would diverge.
      const prev = {};
      order.forEach((id, i) => {
        positions[id] = { x: anchor.x + i * STACK_STEP, y: anchor.y + i * STACK_STEP };
        const c = s.cards.find((card) => card.id === id);
        if (c) prev[id] = { x: c.x, y: c.y };
      });
      s.stackCards(order, frontId, positions, prev);
      setStackPicker(null);
      setSelectedIds(new Set(order));
    },
    [stackPicker],
  );

  // ---- context menus -------------------------------------------------------

  const onNodeContextMenu = useCallback((event, node) => {
    event.preventDefault();
    setSelectedIds((prev) => (prev.has(node.id) ? prev : new Set([node.id])));
    setMenu({ x: event.clientX, y: event.clientY, cardId: node.id });
  }, []);

  // Right-clicking the multi-selection overlay React Flow draws over 2+ selected
  // nodes fires THIS instead of onNodeContextMenu — so wire it up too, keeping
  // the whole selection (so "Stack notes" sees all of it).
  const onSelectionContextMenu = useCallback((event, nodes) => {
    event.preventDefault();
    const target = event.target?.closest?.(".react-flow__node")?.getAttribute("data-id");
    setMenu({ x: event.clientX, y: event.clientY, cardId: target ?? nodes[0]?.id ?? null });
  }, []);

  const onPaneContextMenu = useCallback((event) => {
    event.preventDefault();
    setSelectedIds(new Set());
    setMenu({ x: event.clientX, y: event.clientY, cardId: null });
  }, []);

  // ---- keyboard ------------------------------------------------------------

  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      const typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
      if (typing) return;
      const s = syncRef.current;

      // Undo / redo (the browser's native undo still handles typing in a field).
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        s.redo();
        return;
      }
      // Copy doesn't preventDefault, so an empty selection still falls through
      // to the browser's native copy. Paste (⌘V) is handled entirely by the
      // native `paste` listener below, so the system clipboard (image/URL) and
      // the in-app card clipboard share one priority path instead of racing.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
        copySelection();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        const srcs = s.cards.filter((c) => selectedIds.has(c.id));
        const ids = srcs.map((c) => s.cloneCard(c, c.x + 24, c.y + 24));
        if (ids.length) setSelectedIds(new Set(ids));
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        selectedIds.forEach((id) => s.remove(id));
        setSelectedIds(new Set());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIds, copySelection]);

  // Paste an image → upload + image card at the cursor; paste a URL → link (or
  // video) card; paste our own cards → clone them here.
  useEffect(() => {
    const onPaste = (e) => {
      // Pasting into a form field stays a plain text paste — only the canvas
      // turns clipboard content into cards. Post-it editing is contentEditable
      // and keeps its established paste behaviour.
      const t = e.target;
      if (t?.tagName === "INPUT" || t?.tagName === "TEXTAREA") return;

      const items = e.clipboardData?.items;
      let imageFile = null;
      if (items) {
        for (const it of items) {
          if (it.kind === "file" && it.type.startsWith("image/")) {
            imageFile = it.getAsFile();
            break;
          }
        }
      }
      if (imageFile) {
        e.preventDefault();
        addImageFromFile(imageFile, lastPointerFlow.current ?? viewportCenter());
        return;
      }

      // URL handling. A direct video-file URL becomes a playable video card
      // (fetched + stored server-side); any other URL becomes an unfurled link.
      const text = e.clipboardData?.getData("text/plain")?.trim() ?? "";
      if (/^https?:\/\/\S+$/i.test(text)) {
        e.preventDefault();
        const at = lastPointerFlow.current ?? viewportCenter();
        if (VIDEO_URL_RE.test(text)) addVideoFromUrl(text, at);
        else addLinkAt(text, at);
        return;
      }

      // Our own card payload → rebuild the cards here. Works across tabs and
      // projects. Checked AFTER image/URL so an external copy of those wins.
      const payload = parseCardClipboard(text);
      if (payload) {
        e.preventDefault();
        pasteCardPayload(payload);
        return;
      }

      // Nothing recognizable on the system clipboard: fall back to the in-memory
      // snapshot (same tab only), but only when the OS clipboard is empty so it
      // can't clobber other text the user copied.
      if (clipboardRef.current.length && text === "") {
        e.preventDefault();
        pasteClipboard();
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addImageFromFile, addVideoFromUrl, addLinkAt, pasteCardPayload, pasteClipboard, viewportCenter]);

  // ---- render --------------------------------------------------------------

  const menuCard = menu?.cardId ? sync.cards.find((c) => c.id === menu.cardId) : null;
  const canStack =
    selectedIds.size >= 2 &&
    [...selectedIds].every((id) => !sync.cards.find((c) => c.id === id)?.bundleId);

  return (
    // For this tab the shell makes <main> a full-height flex column (see
    // RootLayout), so the board fills whatever is left after the title row
    // rather than guessing at a `vh` that leaves dead space under it.
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{t("Moodboard")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("The episode's reference wall — drop images, paste links or notes, and arrange the look before anything gets generated.")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(busy > 0 || sync.saving) && (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
              <Loader2 size={12} className="animate-spin" />
              {busy > 0 ? t("importing") : t("saving")}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => sync.undo()}>
            <Undo2 size={14} /> {t("Undo")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => sync.redo()}>
            <Redo2 size={14} /> {t("Redo")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => addNoteAt(viewportCenter())}>
            <StickyNote size={14} /> {t("Note")}
          </Button>
          <Button variant="outline" size="sm" onClick={openFilePicker}>
            <ImageUp size={14} /> {t("Add images")}
          </Button>
        </div>
      </div>

      {/* A failed flush leaves the local board ahead of the server. Say so
          rather than silently rolling the change back — the next reconcile (or
          a reload) settles it, and a lost edit the author never saw fail is the
          worse outcome. */}
      {sync.error && <ErrorNote>{sync.error}</ErrorNote>}

      <div
        {...getRootProps({
          className:
            "relative min-h-0 flex-1 overflow-hidden rounded-none border bg-card",
        })}
        onPointerMove={onPointerMove}
      >
        <input {...getInputProps()} />
        <ReactFlow
          nodes={nodes}
          edges={[]}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onPaneClick={onPaneClick}
          onNodeContextMenu={onNodeContextMenu}
          onSelectionContextMenu={onSelectionContextMenu}
          onPaneContextMenu={onPaneContextMenu}
          selectionOnDrag
          selectionMode={SelectionMode.Partial}
          // Left-drag draws a marquee, so panning moves to middle/right-drag and
          // two-finger scroll — the same split every design canvas uses.
          panOnDrag={[1, 2]}
          panOnScroll
          {...(savedViewport
            ? { defaultViewport: savedViewport }
            : { fitView: true, fitViewOptions: { minZoom: DEFAULT_ZOOM, maxZoom: DEFAULT_ZOOM } })}
          onMoveEnd={onMoveEnd}
          zoomOnDoubleClick={false}
          // Delete is handled by our own key listener (it has to clear the
          // selection state too), so RF must not also consume it.
          deleteKeyCode={null}
          multiSelectionKeyCode={["Meta", "Ctrl"]}
          proOptions={{ hideAttribution: true }}
          className="bg-muted/30"
        >
          <Background gap={SNAP_GAP} size={1.6} className="!bg-transparent" />
          <HelperLines horizontal={helperH} vertical={helperV} />
          <Controls />
          <MiniMap pannable zoomable className="!bg-card" />
          {sync.cards.length === 0 && (
            <FlowPanel position="top-center" className="pointer-events-none mt-16 text-center">
              <div className="pointer-events-auto rounded-none border border-dashed bg-card/90 p-6 backdrop-blur">
                <StickyNote size={20} className="mx-auto mb-2 text-primary" />
                <Empty>
                  {t("drag images in from anywhere, paste an image or a link, or double-click the canvas for a note.")}
                </Empty>
              </div>
            </FlowPanel>
          )}
          <FlowPanel position="bottom-center">
            <div className="rounded-lg border bg-card/90 px-4 py-1.5 text-xs text-muted-foreground backdrop-blur">
              {t("Double-click to add a note · paste an image or URL · right-click for more")}
            </div>
          </FlowPanel>
        </ReactFlow>

        {isDragActive && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="rounded-none border-2 border-dashed border-primary px-8 py-6 text-center">
              <ImageUp size={28} className="mx-auto mb-2 text-primary" />
              <p className="text-sm font-medium">{t("Drop images onto the board")}</p>
            </div>
          </div>
        )}
      </div>

      {/* Right-click menu. The trigger is a zero-size element pinned at the
          cursor; Radix anchors the menu to it and keeps it on-screen near edges.
          A card target shows card actions; the empty canvas shows Paste. */}
      <DropdownMenu open={!!menu} onOpenChange={(open) => !open && setMenu(null)}>
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden
            className="pointer-events-none fixed"
            style={{ left: menu?.x ?? -9999, top: menu?.y ?? -9999 }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" sideOffset={4} collisionPadding={8} className="w-48">
          {menu?.cardId ? (
            <>
              <DropdownMenuItem onSelect={() => duplicateCard(menu.cardId)}>
                <CopyPlus size={14} /> {t("Duplicate")}
                <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => copySelection()}>
                <Copy size={14} /> {t("Copy")}
                <DropdownMenuShortcut>⌘C</DropdownMenuShortcut>
              </DropdownMenuItem>
              {canStack && (
                <DropdownMenuItem onSelect={() => setStackPicker({ ids: [...selectedIds] })}>
                  <Layers size={14} /> {t("Stack cards")}
                </DropdownMenuItem>
              )}
              {menuCard?.bundleId && (
                <DropdownMenuItem onSelect={() => sync.unstack(menuCard.bundleId)}>
                  <Layers2 size={14} /> {t("Unstack")}
                </DropdownMenuItem>
              )}
              {/* Layer order is only for a LOOSE card — a stacked card's draw
                  order is owned by its bundle. */}
              {menuCard && !menuCard.bundleId && (
                <>
                  <DropdownMenuItem onSelect={() => sync.bringToFront(menu.cardId)}>
                    <BringToFront size={14} /> {t("Bring to front")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => sync.sendToBack(menu.cardId)}>
                    <SendToBack size={14} /> {t("Send to back")}
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => deleteSelection()}>
                <Trash2 size={14} /> {t("Delete")}
                <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem onSelect={() => menu && pasteFromMenu({ x: menu.x, y: menu.y })}>
              <ClipboardPaste size={14} /> {t("Paste here")}
              <DropdownMenuShortcut>⌘V</DropdownMenuShortcut>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* "Choose the front card": pick which of the selected cards sits on top;
          the rest cascade behind it once the stack is formed. */}
      <Dialog open={!!stackPicker} onOpenChange={(open) => !open && setStackPicker(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("Choose the front card")}</DialogTitle>
            <DialogDescription>
              {t("Pick the card to show on top. The others stack behind it, and dragging any one of them moves the whole stack.")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-3">
            {stackPicker?.ids.map((id) => {
              const card = sync.cards.find((c) => c.id === id);
              if (!card) return null;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => confirmStack(id)}
                  className="group flex aspect-square flex-col overflow-hidden rounded-md border bg-card text-left transition hover:ring-2 hover:ring-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                >
                  {card.type === "image" && card.imageKey ? (
                    <img src={imageThumbUrl(card.imageKey)} alt="" className="size-full object-cover" />
                  ) : card.type === "video" && card.videoKey ? (
                    <video
                      src={mediaUrl(card.videoKey)}
                      muted
                      preload="metadata"
                      className="size-full bg-black object-cover"
                    />
                  ) : card.type === "link" ? (
                    <span className="line-clamp-4 p-2 text-xs text-muted-foreground">
                      {card.previewData?.title || card.url}
                    </span>
                  ) : (
                    /* text-neutral-900 is contrast against card.color — an
                       author-picked swatch — not a theme surface, so it stays. */
                    <span
                      className="line-clamp-5 size-full p-2 text-xs text-neutral-900"
                      style={{ backgroundColor: card.color }}
                    >
                      {stripHtml(card.content) || t("Empty note")}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function loader() {
  return swr("moodboard", async () => {
    const res = await fetch("/api/moodboard");
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || t("Failed to load the moodboard"));
    return json;
  });
}

export function Component() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}
