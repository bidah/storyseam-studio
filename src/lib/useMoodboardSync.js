// The moodboard's mutation store — every change to the canvas goes through here.
//
// Ported from idea-mural's `useBoardSync`, which spoke to a per-board Durable
// Object over a WebSocket. The op protocol and the undo/redo stacks are
// unchanged; only the transport differs:
//
//   idea-mural:  op → WebSocket → DO applies + broadcasts → peers apply
//   here:        op → apply locally → POST /api/moodboard/ops → updateDoc CAS
//                → the /api/data/events firehose → peers refetch the loader
//
// Three things follow from that swap, and they are the whole design of this file:
//
//  1. **Optimistic apply.** An HTTP round-trip is far too slow to sit in a drag
//     loop, so the op is applied to local state first and sent after. The Worker
//     runs the SAME reducer (lib/moodboard-document.js, vendored), so both sides
//     land on the same document.
//
//  2. **A coalescing outbox.** A drag emits a `move` per frame. Over a socket
//     that's fine; over HTTP it would be a request per frame. Ops are batched on
//     a short timer, and a continuous edit on one card (drag, resize, typing)
//     collapses to its latest value — the intermediate positions carry no
//     information once the next one arrives.
//
//  3. **A monotonic reconcile guard.** The loader refetches on every data event,
//     including the ones our own writes cause, and `swr` can hand back a cached
//     payload first. Adopting a server snapshot that predates our own pending
//     work would make cards visibly jump backwards, so an incoming board is only
//     adopted when the outbox is empty AND its `seq` has caught up with the last
//     one the server acknowledged to us.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyOp, emptyBoard, invertOp } from "@/lib/moodboard-document";

// Short, URL-safe card ids. idea-mural used nanoid(9); this is the same shape
// without pulling in a dependency for one call site.
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
export function cardId(len = 9) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

// How long ops sit in the outbox before being flushed. Long enough that a drag
// or a burst of typing collapses into one request, short enough that a
// collaborator (and the undo history) sees the change promptly.
const FLUSH_MS = 400;

// Ops whose consecutive repeats on the same card are pure overwrites — only the
// last one matters, so the outbox keeps just that. Anything else (add, delete,
// stack, z…) is a distinct intent and must be preserved in order.
const COALESCING = new Set(["move", "resize", "content", "color", "preview", "align", "border"]);

// The card id an op targets — used both for outbox coalescing and for grouping
// a continuous edit into ONE undo entry.
const opTargetId = (op) => (op.t === "add" ? op.card.id : op.id);

// The loader hands cards/bundles back as arrays (a JSON API shouldn't ship an
// object keyed by id and make every consumer re-derive the list); the reducer
// works on maps. This is the seam.
function toBoard(payload) {
  const cards = {};
  const bundles = {};
  for (const c of payload?.cards || []) cards[c.id] = c;
  for (const b of payload?.bundles || []) bundles[b.id] = b;
  return { cards, bundles, seq: payload?.seq || 0 };
}

/**
 * @param {{seq:number, cards:object[], bundles:object[]}} loaded  the route
 *   loader's payload; re-supplied on every revalidation (agent edits, another
 *   tab, the Refresh button).
 */
export function useMoodboardSync(loaded) {
  const stateRef = useRef(null);
  if (stateRef.current === null) stateRef.current = toBoard(loaded);

  const [, force] = useState(0);
  const rerender = useCallback(() => force((n) => n + 1), []);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  // Bumped each time the outbox fully drains. The reconcile below refuses to
  // adopt a server snapshot while we have unsent work, and nothing would wake it
  // afterwards: our own writes are echoed back on the SSE firehose but
  // deliberately ignored (useProjectEvents suppresses self-originated events),
  // so a change a collaborator made DURING our drag would sit unseen until some
  // unrelated event arrived. The route watches this and revalidates.
  const [settled, setSettled] = useState(0);

  // The highest `seq` the server has acknowledged to us. An incoming loader
  // payload older than this is a stale read of our own work — ignore it.
  const ackedSeq = useRef(stateRef.current.seq);

  // Ops waiting to be sent, plus the timer that will send them.
  const outbox = useRef([]);
  const flushTimer = useRef(null);
  const inFlight = useRef(false);

  // ---- the wire ------------------------------------------------------------

  const flush = useCallback(async () => {
    if (flushTimer.current) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    if (inFlight.current || outbox.current.length === 0) return;
    const batch = outbox.current;
    outbox.current = [];
    inFlight.current = true;
    setSaving(true);
    try {
      const res = await fetch("/api/moodboard/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ops: batch }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Save failed (${res.status})`);
      // Adopt the server's sequence as truth. Local optimistic applies advance
      // `seq` too, but ops that were no-ops server-side (a duplicate replay, a
      // card a collaborator already deleted) don't — so without this the two
      // counters drift apart and the reconcile guard below would wedge shut.
      ackedSeq.current = json.seq ?? ackedSeq.current;
      stateRef.current = { ...stateRef.current, seq: Math.max(stateRef.current.seq, json.seq ?? 0) };
      setError(null);
    } catch (e) {
      // The local board still shows the change; say so rather than silently
      // rolling back, and let the next reconcile (or a reload) settle it.
      setError(String(e.message || e));
    } finally {
      inFlight.current = false;
      setSaving(false);
      // More arrived while we were away.
      if (outbox.current.length) flushTimer.current = setTimeout(flush, 0);
      else setSettled((n) => n + 1);
    }
  }, []);

  const enqueue = useCallback(
    (op) => {
      const box = outbox.current;
      const last = box[box.length - 1];
      if (
        last &&
        COALESCING.has(op.t) &&
        last.t === op.t &&
        opTargetId(last) === opTargetId(op)
      ) {
        box[box.length - 1] = op; // same card, same kind — the latest wins
      } else {
        box.push(op);
      }
      if (!flushTimer.current) flushTimer.current = setTimeout(flush, FLUSH_MS);
    },
    [flush],
  );

  // Flush on unmount and on tab-hide, so leaving the canvas mid-drag doesn't
  // lose the last few hundred milliseconds of work.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
  }, [flush]);

  // ---- reconcile a fresh server snapshot -----------------------------------

  const incomingSeq = loaded?.seq ?? 0;
  useEffect(() => {
    if (outbox.current.length || inFlight.current) return; // our work isn't in it yet
    if (incomingSeq < ackedSeq.current) return; // a stale (cached) read
    const next = toBoard(loaded);
    // Cheap identity check — a revalidation that changed nothing shouldn't
    // re-render the whole canvas.
    if (next.seq === stateRef.current.seq) return;
    stateRef.current = next;
    ackedSeq.current = next.seq;
    rerender();
  }, [loaded, incomingSeq, rerender]);

  // ---- op application ------------------------------------------------------

  const undoStack = useRef([]);
  const redoStack = useRef([]);

  // Apply optimistically (so the actor sees it instantly) then queue for the
  // server. Used directly by ops that shouldn't be undoable.
  const applyAndSend = useCallback(
    (op) => {
      const r = applyOp(stateRef.current, op, stateRef.current.seq + 1);
      if (r.changed) {
        stateRef.current = r.state;
        rerender();
      }
      enqueue(op);
    },
    [enqueue, rerender],
  );

  // A user-initiated mutation: record its inverse for undo, then apply.
  const applyLocalAndSend = useCallback(
    (op) => {
      const inverse = invertOp(stateRef.current, op);
      if (inverse) {
        const stack = undoStack.current;
        const top = stack[stack.length - 1];
        // Coalesce a continuous edit (drag, typing, recolor) on one card into a
        // single undo entry: the earlier inverse already restores further back.
        const coalesce =
          COALESCING.has(op.t) &&
          top &&
          top.t === inverse.t &&
          opTargetId(top) === opTargetId(inverse);
        if (!coalesce) {
          stack.push(inverse);
          if (stack.length > 200) stack.shift();
        }
        redoStack.current = []; // a fresh action invalidates the redo branch
      }
      applyAndSend(op);
    },
    [applyAndSend],
  );

  const undo = useCallback(() => {
    const inverse = undoStack.current.pop();
    if (!inverse) return;
    const redoOp = invertOp(stateRef.current, inverse);
    if (redoOp) redoStack.current.push(redoOp);
    applyAndSend(inverse);
  }, [applyAndSend]);

  const redo = useCallback(() => {
    const op = redoStack.current.pop();
    if (!op) return;
    const undoOp = invertOp(stateRef.current, op);
    if (undoOp) undoStack.current.push(undoOp);
    applyAndSend(op);
  }, [applyAndSend]);

  // ---- the card API --------------------------------------------------------

  const api = useMemo(() => {
    const add = (card) => {
      applyLocalAndSend({ t: "add", card });
      return card.id;
    };

    return {
      addPostIt: (x, y) =>
        add({ id: cardId(), type: "postIt", x, y, content: "", color: "#fde047" }),

      addLink: (x, y, url) =>
        add({ id: cardId(), type: "link", x, y, content: "", color: "#ffffff", url }),

      addImage: (img) =>
        add({
          id: cardId(),
          type: "image",
          x: img.x,
          y: img.y,
          content: "",
          color: "#ffffff",
          imageKey: img.imageKey,
          width: img.width,
          height: img.height,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
        }),

      addVideo: (vid) =>
        add({
          id: cardId(),
          type: "video",
          x: vid.x,
          y: vid.y,
          content: "",
          color: "#ffffff",
          videoKey: vid.videoKey,
          width: vid.width,
          height: vid.height,
          naturalWidth: vid.naturalWidth,
          naturalHeight: vid.naturalHeight,
        }),

      // A clone is a fresh, LOOSE card: bundleId is deliberately not copied —
      // inheriting it would corrupt the stack it points at.
      cloneCard: (source, x, y) =>
        add({
          id: cardId(),
          type: source.type,
          x,
          y,
          content: source.content,
          color: source.color,
          url: source.url,
          previewData: source.previewData,
          imageKey: source.imageKey,
          videoKey: source.videoKey,
          width: source.width,
          height: source.height,
          naturalWidth: source.naturalWidth,
          naturalHeight: source.naturalHeight,
          border: source.border,
          align: source.align,
        }),

      move: (id, x, y) => applyLocalAndSend({ t: "move", id, x, y }),
      resize: (id, width, height) => applyLocalAndSend({ t: "resize", id, width, height }),
      setContent: (id, content) => applyLocalAndSend({ t: "content", id, content }),
      setColor: (id, color) => applyLocalAndSend({ t: "color", id, color }),
      setBorder: (id, border) => applyLocalAndSend({ t: "border", id, border }),
      setAlign: (id, align) => applyLocalAndSend({ t: "align", id, align }),
      setPreview: (id, previewData) => applyLocalAndSend({ t: "preview", id, previewData }),
      remove: (id) => applyLocalAndSend({ t: "delete", id }),

      stackCards: (order, frontId, positions, prev) => {
        const id = cardId();
        applyLocalAndSend({ t: "stack", id, order, frontId, positions, prev });
        return id;
      },

      unstack: (bundleId) => {
        const state = stateRef.current;
        const b = state.bundles[bundleId];
        if (!b) {
          // The card points at a bundle that no longer exists (a stale pointer
          // from a snapshot race). Self-heal by clearing the dangling bundleId
          // off every member, so the card stops looking stacked instead of
          // being stuck with an Unstack that does nothing.
          for (const c of Object.values(state.cards)) {
            if (c.bundleId === bundleId) applyLocalAndSend({ t: "detach", id: c.id });
          }
          return;
        }
        // Scatter the cards back to their pre-stack layout, relocated to wherever
        // the stack currently sits: shift every saved position by how far the
        // front card has moved since stacking.
        let restore;
        if (b.prev) {
          const front = state.cards[b.frontId];
          const base = b.prev[b.frontId];
          const dx = front && base ? front.x - base.x : 0;
          const dy = front && base ? front.y - base.y : 0;
          restore = {};
          for (const mid of b.order) {
            const p = b.prev[mid];
            if (p) restore[mid] = { x: p.x + dx, y: p.y + dy };
          }
        }
        applyLocalAndSend({ t: "unstack", id: bundleId, order: [...b.order], restore });
      },

      // Layer ops ride applyAndSend (not applyLocalAndSend): reordering is an
      // incidental, idempotent view tweak — and the automatic raise-on-select
      // would otherwise flood the undo stack on every click.
      bringToFront: (id) => {
        const st = stateRef.current;
        const target = st.cards[id];
        if (!target || target.bundleId) return; // only loose cards have a z to move
        let max = -Infinity;
        for (const c of Object.values(st.cards)) {
          if (c.id === id || c.bundleId) continue;
          const z = c.z ?? 0;
          if (z > max) max = z;
        }
        if (max === -Infinity) return; // sole loose card — nothing to climb above
        if ((target.z ?? 0) > max) return; // already on top
        applyAndSend({ t: "z", id, z: max + 1 });
      },

      sendToBack: (id) => {
        const st = stateRef.current;
        const target = st.cards[id];
        if (!target || target.bundleId) return;
        let min = Infinity;
        for (const c of Object.values(st.cards)) {
          if (c.id === id || c.bundleId) continue;
          const z = c.z ?? 0;
          if (z < min) min = z;
        }
        if (min === Infinity) return;
        if ((target.z ?? 0) < min) return; // already at the back
        applyAndSend({ t: "z", id, z: min - 1 });
      },

      undo,
      redo,
      flush,
    };
  }, [applyLocalAndSend, applyAndSend, undo, redo, flush]);

  const board = stateRef.current || emptyBoard();
  return {
    ...api,
    cards: Object.values(board.cards),
    bundles: Object.values(board.bundles),
    saving,
    settled,
    error,
    dismissError: useCallback(() => setError(null), []),
  };
}
