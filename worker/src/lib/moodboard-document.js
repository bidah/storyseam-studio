// VENDORED from src/lib/moodboard-document.js — DO NOT EDIT HERE.
// Edit the canonical file, then run `npm run moodboard:sync`
// (scripts/sync-moodboard.mjs).

// The moodboard document reducer — the brain of the Moodboard tab.
//
// Ported verbatim (behaviour, not syntax) from idea-mural's
// `shared/board-document.ts`, which ran inside a per-board Durable Object. Here
// the same reducer runs in TWO places: optimistically on the client (so a drag
// or an edit paints instantly) and authoritatively inside the Worker's
// `updateDoc` compare-and-swap (so concurrent writers can't clobber each other).
// That is the whole reason it is a pure function of (state, op, seq) with no I/O
// and no runtime: applying the same ops in the same order on both sides lands on
// the same document.
//
// CANONICAL — `worker/src/lib/moodboard-document.js` is a generated copy.
// Edit this file, then run `npm run moodboard:sync`. `npm run guards` fails if
// the copy drifts.
//
// ---- The document ----
//
//   { cards: { [id]: Card }, bundles: { [id]: Bundle }, seq }
//
// Card:
//   id, type: "postIt" | "link" | "image" | "video"
//   x, y                      absolute canvas position (top-left)
//   content                   post-it body (HTML from TipTap); "" for other types
//   color                     post-it paper color
//   border?, align?           post-it styling ("left" | "center"; absent = shape default)
//   url?, previewData?        link cards (previewData undefined = still unfurling,
//                             null = unfurl failed — the card renders bare)
//   imageKey?, videoKey?      the FILE BASENAME under media/<pid>/moodboard/,
//                             served at /moodboard-media/<file>. Not a full R2
//                             key: the project id already scopes the bucket path,
//                             so storing it in the card would duplicate (and could
//                             contradict) the project the doc row belongs to.
//   width?, height?           on-canvas footprint (images/videos are resizable)
//   naturalWidth?, naturalHeight?   source dimensions — pin the resize aspect
//   bundleId?                 set when the card belongs to a stack
//   z?                        draw order among LOOSE cards (absent = 0)
//   seq                       monotonic stamp, for last-write-wins
//
// Bundle (a "stack" of cards): front-first `order`, the `frontId` on top, and
// `prev` — each member's position from just before it was stacked, so Unstack
// scatters them back where they came from.

export function emptyBoard() {
  return { cards: {}, bundles: {}, seq: 0 };
}

/**
 * Apply a single op, returning a NEW state (immutable update). `seq` is the
 * monotonic sequence assigned to this op by whoever is applying it (the Worker
 * on the authoritative path, the client optimistically).
 *
 * Returns `{ state, changed, seq }`. `changed: false` means the op was a no-op
 * (or invalid) and neither the write nor the re-render is worth doing.
 */
export function applyOp(state, op, seq) {
  const cards = { ...state.cards };
  const bundles = { ...state.bundles };
  let changed = false;

  switch (op.t) {
    case "add": {
      if (!cards[op.card.id]) {
        cards[op.card.id] = { ...op.card, seq };
        changed = true;
      }
      break;
    }
    case "move": {
      const c = cards[op.id];
      if (c && (c.x !== op.x || c.y !== op.y)) {
        cards[op.id] = { ...c, x: op.x, y: op.y, seq };
        changed = true;
      }
      break;
    }
    case "resize": {
      const c = cards[op.id];
      if (c && (c.width !== op.width || c.height !== op.height)) {
        cards[op.id] = { ...c, width: op.width, height: op.height, seq };
        changed = true;
      }
      break;
    }
    case "content": {
      const c = cards[op.id];
      if (c && c.content !== op.content) {
        cards[op.id] = { ...c, content: op.content, seq };
        changed = true;
      }
      break;
    }
    case "color": {
      const c = cards[op.id];
      if (c && c.color !== op.color) {
        cards[op.id] = { ...c, color: op.color, seq };
        changed = true;
      }
      break;
    }
    case "border": {
      const c = cards[op.id];
      if (c && (c.border ?? false) !== op.border) {
        cards[op.id] = { ...c, border: op.border, seq };
        changed = true;
      }
      break;
    }
    case "align": {
      const c = cards[op.id];
      if (c && (c.align ?? null) !== op.align) {
        const next = { ...c, seq };
        if (op.align === null) delete next.align;
        else next.align = op.align;
        cards[op.id] = next;
        changed = true;
      }
      break;
    }
    case "preview": {
      const c = cards[op.id];
      if (c) {
        cards[op.id] = { ...c, previewData: op.previewData, seq };
        changed = true;
      }
      break;
    }
    case "stack": {
      // Reject unless the bundle id is free and every member exists and is not
      // already in another stack — keeps membership a clean partition.
      if (bundles[op.id]) break;
      if (!Array.isArray(op.order) || op.order.length < 2) break;
      if (!op.order.every((mid) => cards[mid] && !cards[mid].bundleId)) break;
      // Pre-stack positions come from the op (captured once by the initiator),
      // NOT re-derived from local card state here: under optimistic concurrency
      // each replica's local positions can differ at apply time, so re-deriving
      // would let `prev` diverge and Unstack would scatter cards to the wrong
      // place. Storing op.prev verbatim keeps every replica identical.
      const prev = { ...op.prev };
      for (const mid of op.order) {
        const pos = op.positions[mid];
        const c = cards[mid];
        cards[mid] = { ...c, x: pos.x, y: pos.y, bundleId: op.id, seq };
      }
      bundles[op.id] = { id: op.id, order: [...op.order], frontId: op.frontId, prev, seq };
      changed = true;
      break;
    }
    case "unstack": {
      const b = bundles[op.id];
      if (!b) break;
      for (const mid of b.order) {
        const c = cards[mid];
        if (!c) continue;
        const next = { ...c, seq };
        delete next.bundleId;
        if (op.restore?.[mid]) {
          next.x = op.restore[mid].x;
          next.y = op.restore[mid].y;
        }
        cards[mid] = next;
      }
      delete bundles[op.id];
      changed = true;
      break;
    }
    case "z": {
      const c = cards[op.id];
      if (c && (c.z ?? 0) !== op.z) {
        cards[op.id] = { ...c, z: op.z, seq };
        changed = true;
      }
      break;
    }
    case "detach": {
      const c = cards[op.id];
      if (c && c.bundleId !== undefined) {
        const next = { ...c, seq };
        delete next.bundleId;
        cards[op.id] = next;
        changed = true;
      }
      break;
    }
    case "delete": {
      const c = cards[op.id];
      if (c) {
        delete cards[op.id];
        // Keep the owning bundle consistent: drop the card from its order, and
        // dissolve the bundle if fewer than two members remain.
        if (c.bundleId && bundles[c.bundleId]) {
          const b = bundles[c.bundleId];
          const rest = b.order.filter((mid) => mid !== op.id);
          if (rest.length < 2) {
            for (const mid of rest) {
              if (cards[mid]) {
                const bare = { ...cards[mid], seq };
                delete bare.bundleId;
                cards[mid] = bare;
              }
            }
            delete bundles[c.bundleId];
          } else {
            const frontId = b.frontId === op.id ? rest[0] : b.frontId;
            bundles[c.bundleId] = { ...b, order: rest, frontId, seq };
          }
        }
        changed = true;
      }
      break;
    }
  }

  return { state: changed ? { cards, bundles, seq } : state, changed, seq };
}

/** Apply a batch in order, returning the final state and how many ops stuck. */
export function applyOps(state, ops) {
  let next = state;
  let applied = 0;
  for (const op of ops) {
    const r = applyOp(next, op, next.seq + 1);
    if (r.changed) {
      next = r.state;
      applied++;
    }
  }
  return { state: next, applied };
}

/**
 * The op that would undo `op`, computed against the state as it is BEFORE `op`
 * is applied. Returns null when there is nothing to undo (e.g. deleting a card
 * that no longer exists). Pure — the client's undo stack is built from this.
 */
export function invertOp(state, op) {
  switch (op.t) {
    case "add":
      return { t: "delete", id: op.card.id };
    case "detach":
      // Clearing a dangling bundleId is a cleanup, not a user edit worth undoing.
      return null;
    case "delete": {
      const c = state.cards[op.id];
      if (!c) return null;
      // Re-add the card as it was (seq re-stamped on apply). Drop bundleId: the
      // bundle may have been rewritten/dissolved by the delete, so the card
      // comes back un-stacked rather than referencing a stale bundle.
      const card = { ...c };
      delete card.seq;
      delete card.bundleId;
      return { t: "add", card };
    }
    case "move": {
      const c = state.cards[op.id];
      if (!c) return null;
      return { t: "move", id: op.id, x: c.x, y: c.y };
    }
    case "resize": {
      const c = state.cards[op.id];
      if (!c || c.width === undefined || c.height === undefined) return null;
      return { t: "resize", id: op.id, width: c.width, height: c.height };
    }
    case "content": {
      const c = state.cards[op.id];
      if (!c) return null;
      return { t: "content", id: op.id, content: c.content };
    }
    case "color": {
      const c = state.cards[op.id];
      if (!c) return null;
      return { t: "color", id: op.id, color: c.color };
    }
    case "border": {
      const c = state.cards[op.id];
      if (!c) return null;
      return { t: "border", id: op.id, border: c.border ?? false };
    }
    case "align": {
      const c = state.cards[op.id];
      if (!c) return null;
      return { t: "align", id: op.id, align: c.align ?? null };
    }
    case "preview": {
      const c = state.cards[op.id];
      if (!c) return null;
      return { t: "preview", id: op.id, previewData: c.previewData ?? null };
    }
    case "z": {
      const c = state.cards[op.id];
      if (!c) return null;
      return { t: "z", id: op.id, z: c.z ?? 0 };
    }
    case "stack": {
      // Undo a stack = unstack, restoring each member's pre-stack position.
      const restore = {};
      for (const mid of op.order) {
        const c = state.cards[mid];
        if (c) restore[mid] = { x: c.x, y: c.y };
      }
      return { t: "unstack", id: op.id, order: [...op.order], restore };
    }
    case "unstack": {
      // Undo an unstack = re-create the bundle from the still-present pre-apply
      // bundle, re-stacking members at their current positions.
      const b = state.bundles[op.id];
      if (!b) return null;
      const positions = {};
      for (const mid of b.order) {
        const c = state.cards[mid];
        if (c) positions[mid] = { x: c.x, y: c.y };
      }
      // Re-stack with the bundle's original pre-stack snapshot so a later
      // Unstack scatters cards back exactly as before.
      const prev = b.prev ?? positions;
      return { t: "stack", id: op.id, order: [...b.order], frontId: b.frontId, positions, prev };
    }
    default:
      return null;
  }
}

// ---- Validation (the Worker's gate) ---------------------------------------
// The client is optimistic, so an op reaching the Worker is untrusted input.
// A malformed op that slipped through would be baked into the D1 document and
// then break every reader — so the route rejects the batch instead of applying
// half of it.

const OP_TYPES = new Set([
  "add", "move", "resize", "content", "color", "border",
  "align", "preview", "stack", "unstack", "z", "detach", "delete",
]);

const CARD_TYPES = new Set(["postIt", "link", "image", "video"]);

const num = (v) => typeof v === "number" && Number.isFinite(v);
const id = (v) => typeof v === "string" && v.length > 0 && v.length <= 64;

/** `null` if the op is well-formed, else a human-readable reason. */
export function validateOp(op) {
  if (!op || typeof op !== "object") return "op must be an object";
  if (!OP_TYPES.has(op.t)) return `unknown op type "${op.t}"`;
  if (op.t === "add") {
    const c = op.card;
    if (!c || typeof c !== "object") return "add.card must be an object";
    if (!id(c.id)) return "add.card.id must be a short non-empty string";
    if (!CARD_TYPES.has(c.type)) return `add.card.type must be one of ${[...CARD_TYPES].join(", ")}`;
    if (!num(c.x) || !num(c.y)) return "add.card.x/y must be finite numbers";
    if (typeof c.content !== "string") return "add.card.content must be a string";
    return null;
  }
  if (!id(op.id)) return `${op.t}.id must be a short non-empty string`;
  if (op.t === "move" && (!num(op.x) || !num(op.y))) return "move.x/y must be finite numbers";
  if (op.t === "resize" && (!num(op.width) || !num(op.height))) return "resize.width/height must be finite numbers";
  if (op.t === "content" && typeof op.content !== "string") return "content.content must be a string";
  if (op.t === "z" && !num(op.z)) return "z.z must be a finite number";
  if (op.t === "stack") {
    if (!Array.isArray(op.order) || op.order.length < 2) return "stack.order needs at least 2 ids";
    if (!id(op.frontId)) return "stack.frontId must be an id";
    if (!op.positions || typeof op.positions !== "object") return "stack.positions must be an object";
  }
  if (op.t === "unstack" && !Array.isArray(op.order)) return "unstack.order must be an array";
  return null;
}
