// Moodboard endpoints (/api/moodboard*) — the reference canvas.
//
// Ported from idea-mural, where the board lived in a per-board Durable Object
// reached over a WebSocket. Here it is an ordinary D1 document (`docs` row, name
// "moodboard") mutated through `updateDoc`, and clients hear about each other's
// changes over the existing `/api/data/events` SSE firehose. Same op protocol,
// same reducer (lib/moodboard-document.js), different transport — which is what
// lets the whole client-side board logic port across unchanged.
//
// Why ops and not a whole-document PUT: two authors dragging different cards
// would otherwise be last-writer-wins, and one of them would watch their card
// snap back. An op is a narrow intent ("move card X to (x,y)"), so a CAS retry
// re-applies it against whatever landed in between instead of overwriting it.
//
// Media: dropped/pasted images and fetched videos go to R2 under
// `media/<pid>/moodboard/<uuid>.<ext>` and are served at `/moodboard-media/…`.
// Only the FILE NAME is stored on the card — the project id already scopes the
// bucket path, so putting it on the card would duplicate (and could contradict)
// the project the document row belongs to.
import { readDoc, updateDoc } from "../lib/docs.js";
import { mediaKey, putMedia } from "../lib/media.js";
import { putImageWithVariants, deriveInBackground } from "../lib/images.js";
import { emptyBoard, applyOp, validateOp } from "../lib/moodboard-document.js";
import { unfurl } from "../lib/unfurl.js";

const DOC = "moodboard";

// A batch is one atomic document write, so it is also the unit a CAS retry
// replays. Capped so a runaway client can't push an unbounded transaction — a
// paste of 200 cards is already far past any real board.
const MAX_OPS_PER_BATCH = 256;

// Ceiling on the document itself. A moodboard is references, not an archive;
// past this the D1 row (and every read of it) gets expensive enough to notice.
const MAX_CARDS = 2000;

export function registerMoodboard(app) {
  // --- read the whole board -------------------------------------------------
  app.get("/api/moodboard", async (c) => {
    const board = (await readDoc(c.env, c.get("projectId"), DOC, null)) || emptyBoard();
    return c.json({
      seq: board.seq || 0,
      cards: Object.values(board.cards || {}),
      bundles: Object.values(board.bundles || {}),
    });
  });

  // --- apply a batch of ops -------------------------------------------------
  // The client has already applied these optimistically; this is the
  // authoritative pass. Ops are validated BEFORE the CAS so a malformed batch is
  // rejected whole rather than half-written — a partially-applied `stack` would
  // leave cards pointing at a bundle that was never created.
  app.post("/api/moodboard/ops", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const ops = Array.isArray(body.ops) ? body.ops : body.op ? [body.op] : null;
    if (!ops || ops.length === 0) return c.json({ error: "ops[] required" }, 400);
    if (ops.length > MAX_OPS_PER_BATCH) {
      return c.json({ error: `too many ops (max ${MAX_OPS_PER_BATCH})` }, 413);
    }
    for (const op of ops) {
      const reason = validateOp(op);
      if (reason) return c.json({ error: `invalid op: ${reason}` }, 400);
    }

    const result = await updateDoc(c.env, c.get("projectId"), DOC, emptyBoard(), (board) => {
      // `updateDoc` hands us the parsed document to edit IN PLACE, while the
      // reducer is immutable — so fold the ops into a local value, then copy the
      // result back onto the same object.
      let state = { cards: board.cards || {}, bundles: board.bundles || {}, seq: board.seq || 0 };
      let applied = 0;
      for (const op of ops) {
        if (op.t === "add" && Object.keys(state.cards).length >= MAX_CARDS) {
          return { abort: true, error: `board is full (max ${MAX_CARDS} cards)`, status: 409 };
        }
        const r = applyOp(state, op, state.seq + 1);
        if (r.changed) {
          state = r.state;
          applied++;
        }
      }
      // Nothing stuck (every op was a no-op against the current document — a
      // duplicate replay, or a card someone else already deleted). Skip the
      // write so it doesn't churn the version history for no change.
      if (!applied) return { abort: true, seq: state.seq, applied: 0 };
      board.cards = state.cards;
      board.bundles = state.bundles;
      board.seq = state.seq;
      return { seq: state.seq, applied };
    });

    if (result.error) return c.json({ error: result.error }, result.status || 400);
    return c.json({ ok: true, seq: result.seq, applied: result.applied });
  });

  // --- upload a dropped / pasted image --------------------------------------
  // Raw bytes as the request body (no multipart): the client already has a File
  // or a clipboard Blob, and streaming it straight through means one less copy.
  app.post("/api/moodboard/image", async (c) => {
    const contentType = (c.req.header("content-type") || "").split(";")[0].trim().toLowerCase();
    const ext = IMAGE_EXT[contentType];
    if (!ext) return c.json({ error: `unsupported image type "${contentType}"` }, 415);

    const buf = await c.req.arrayBuffer();
    if (!buf || buf.byteLength === 0) return c.json({ error: "empty upload body" }, 400);
    if (buf.byteLength > MAX_IMAGE_BYTES) return c.json({ error: "image too large" }, 413);

    const file = `${crypto.randomUUID()}.${ext}`;
    await putImageWithVariants(c.env, c.executionCtx, {
      pid: c.get("projectId"), kind: "moodboard", file, bytes: buf, contentType,
    });
    return c.json({
      ok: true, file,
      url: `/moodboard-media/${file}`,
      thumb: `/img/thumb/moodboard-media/${file}`,
      display: `/img/display/moodboard-media/${file}`,
    }, 201);
  });

  // --- store a video from a pasted URL --------------------------------------
  // The bytes are fetched server-side and kept, so the card keeps playing even
  // if the source link dies — and so the <video> element isn't at the mercy of
  // the origin's CORS/hotlink policy.
  app.post("/api/moodboard/video-from-url", async (c) => {
    const { url } = await c.req.json().catch(() => ({}));
    const stored = await storeRemoteMedia(c, url, "video");
    if (stored.error) return c.json({ error: stored.error }, stored.status);
    return c.json({ ok: true, file: stored.file, url: `/moodboard-media/${stored.file}` }, 201);
  });

  // --- add a card, high level (the agent's surface) -------------------------
  // The GUI speaks ops because it already knows the geometry — where the cursor
  // is, how big the image measured, which cell is free. The agent knows none of
  // that, and making it invent coordinates would produce a pile of cards on top
  // of each other. So this route takes intent ("a note saying X", "this image")
  // and does the placing, the fetching and the op itself.
  app.post("/api/moodboard/cards", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const type = String(body.type || "").trim();
    if (!["postIt", "note", "image", "video", "link"].includes(type)) {
      return c.json({ error: 'type must be one of "note", "image", "video", "link"' }, 400);
    }
    const kind = type === "note" ? "postIt" : type;

    // Media and previews are fetched BEFORE the document write, so a dead URL
    // fails the request outright instead of leaving a card pointing at nothing.
    let file = null;
    let previewData;
    if (kind === "image" || kind === "video") {
      if (!body.url) return c.json({ error: `${kind} needs a url to fetch` }, 400);
      const stored = await storeRemoteMedia(c, body.url, kind);
      if (stored.error) return c.json({ error: stored.error }, stored.status);
      file = stored.file;
    } else if (kind === "link") {
      if (!body.url) return c.json({ error: "link needs a url" }, 400);
      try {
        previewData = await unfurl(body.url, (u, init) => fetch(u, init));
      } catch {
        previewData = null; // the card still stands; it just renders bare
      }
    }

    const result = await updateDoc(c.env, c.get("projectId"), DOC, emptyBoard(), (board) => {
      let state = { cards: board.cards || {}, bundles: board.bundles || {}, seq: board.seq || 0 };
      if (Object.keys(state.cards).length >= MAX_CARDS) {
        return { abort: true, error: `board is full (max ${MAX_CARDS} cards)`, status: 409 };
      }
      const size = DEFAULT_SIZE[kind];
      const at =
        Number.isFinite(body.x) && Number.isFinite(body.y)
          ? { x: body.x, y: body.y }
          : nextFreeSlot(Object.values(state.cards), size);

      const card = {
        id: crypto.randomUUID().replace(/-/g, "").slice(0, 9),
        type: kind,
        x: at.x,
        y: at.y,
        content: kind === "postIt" ? String(body.content ?? body.text ?? "") : "",
        color: kind === "postIt" ? String(body.color || "#fde047") : "#ffffff",
        ...(kind === "link" ? { url: String(body.url), previewData } : {}),
        ...(kind === "image" ? { imageKey: file } : {}),
        ...(kind === "video" ? { videoKey: file } : {}),
        ...(kind === "image" || kind === "video" ? { width: size.w, height: size.h } : {}),
      };
      const r = applyOp(state, { t: "add", card }, state.seq + 1);
      if (!r.changed) return { abort: true, error: "could not add the card", status: 409 };
      board.cards = r.state.cards;
      board.bundles = r.state.bundles;
      board.seq = r.state.seq;
      return { card };
    });

    if (result.error) return c.json({ error: result.error }, result.status || 400);
    return c.json({ ok: true, card: result.card }, 201);
  });

  // --- remove a card --------------------------------------------------------
  app.delete("/api/moodboard/cards/:id", async (c) => {
    const id = c.req.param("id");
    const result = await updateDoc(c.env, c.get("projectId"), DOC, emptyBoard(), (board) => {
      const state = { cards: board.cards || {}, bundles: board.bundles || {}, seq: board.seq || 0 };
      const r = applyOp(state, { t: "delete", id }, state.seq + 1);
      if (!r.changed) return { abort: true, error: `no card "${id}" on the board`, status: 404 };
      board.cards = r.state.cards;
      board.bundles = r.state.bundles;
      board.seq = r.state.seq;
      return { removed: id };
    });
    if (result.error) return c.json({ error: result.error }, result.status || 400);
    return c.json({ ok: true, removed: result.removed });
  });

  // --- unfurl a pasted link -------------------------------------------------
  // The result is written onto the card by the client (a `preview` op), so it is
  // fetched ONCE per link rather than per viewer.
  app.get("/api/moodboard/unfurl", async (c) => {
    const url = c.req.query("url");
    if (!url || !/^https?:\/\//i.test(url)) return c.json({ error: "bad url" }, 400);
    try {
      return c.json(await unfurl(url, (u, init) => fetch(u, init)));
    } catch {
      return c.json({ error: "unfurl failed" }, 502);
    }
  });
}

// Fetch a remote image/video and keep our own copy under the project's
// moodboard media prefix. Returns `{ file }` or `{ error, status }`.
//
// Two reasons to store rather than link: the card keeps working when the source
// link dies or starts rate-limiting, and an <img>/<video> pointing at a third
// party is at the mercy of that origin's CORS and hotlink rules — which is
// exactly the kind of reference that looks fine on the day it was added and is
// a broken box a month later.
async function storeRemoteMedia(c, url, kind) {
  let target;
  try {
    target = new URL(url ?? "");
  } catch {
    return { error: "invalid url", status: 400 };
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return { error: "invalid url", status: 400 };
  }

  const isVideo = kind === "video";
  const byType = isVideo ? VIDEO_URL_EXT : IMAGE_URL_EXT;
  const byExt = isVideo ? VIDEO_EXT_TYPE : IMAGE_EXT_TYPE;
  const cap = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;

  let res;
  try {
    res = await fetch(target.href, {
      headers: {
        "User-Agent": "shot-studio-unfurl/1.0",
        Accept: isVideo ? "video/*,*/*" : "image/*,*/*",
      },
      redirect: "follow",
    });
  } catch {
    return { error: `could not fetch ${kind}`, status: 502 };
  }
  if (!res.ok || !res.body) return { error: `could not fetch ${kind}`, status: 502 };

  // Pick an extension from the response content-type, falling back to the URL's
  // own extension (plenty of hosts serve media as application/octet-stream).
  const contentType = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  let ext = byType[contentType];
  if (!ext) {
    const pathExt = target.pathname.split(".").pop()?.toLowerCase();
    if (pathExt && pathExt in byExt) ext = pathExt;
  }
  if (!ext) return { error: `that URL is not ${isVideo ? "a video" : "an image"}`, status: 415 };

  if (Number(res.headers.get("content-length") || "0") > cap) {
    return { error: `${kind} too large`, status: 413 };
  }

  const file = `${crypto.randomUUID()}.${ext}`;
  const storedType = contentType.startsWith(isVideo ? "video/" : "image/")
    ? contentType
    : byExt[ext];
  // Stream straight to R2 rather than buffering — a 100 MB ArrayBuffer would
  // blow the Worker's memory. R2 reports the true size, so a stream that lied
  // about (or omitted) its content-length is deleted after the fact.
  const key = mediaKey(c.get("projectId"), "moodboard", file);
  const obj = await c.env.BUCKET.put(key, res.body, { httpMetadata: { contentType: storedType } });
  if (!obj || obj.size === 0) {
    await c.env.BUCKET.delete(key).catch(() => {});
    return { error: `empty ${kind}`, status: 400 };
  }
  if (obj.size > cap) {
    await c.env.BUCKET.delete(key).catch(() => {});
    return { error: `${kind} too large`, status: 413 };
  }
  // Streamed straight through, so the bytes were never in hand — derive the
  // webp pair from R2 in the background. No-op for the video branch.
  if (!isVideo) {
    deriveInBackground(c.env, c.executionCtx, {
      pid: c.get("projectId"), kind: "moodboard", file,
    });
  }
  return { file };
}

// Footprints for an agent-placed card. Images/videos land at a fixed size
// because nothing here has measured them — the author resizes on the canvas,
// and a wrong-but-consistent box beats a guess that varies per card.
const DEFAULT_SIZE = {
  postIt: { w: 160, h: 160 },
  link: { w: 280, h: 260 },
  image: { w: 320, h: 240 },
  video: { w: 480, h: 270 },
};
const GRID_GAP = 20;
// Cards per row before wrapping — wide enough to read as a wall, narrow enough
// that the board doesn't run off to the right forever.
const GRID_COLS = 6;
// How far down the scan below looks before giving up. A board would need
// hundreds of rows of cards to reach this; it exists so a pathological layout
// can't spin the request.
const MAX_SCAN_ROWS = 400;

const footprint = (c) => ({
  w: c.width ?? DEFAULT_SIZE[c.type]?.w ?? 160,
  h: c.height ?? DEFAULT_SIZE[c.type]?.h ?? 160,
});

const overlaps = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

// Where to drop a card the caller didn't place: the first free cell of a grid
// anchored at the board's top-left, scanning left-to-right then down.
//
// Free means "overlaps nothing", tested against every existing card — NOT
// "below the lowest card". The difference matters because each added card
// changes the answer for the next one: an anchor derived from the current
// bottom edge marches further down on every call and each addition ends up
// alone on its own row. Testing occupancy instead means the cell just used is
// simply taken, and the next call fills the one beside it.
function nextFreeSlot(cards, size) {
  if (!cards.length) return { x: 0, y: 0 };
  const boxes = cards.map((c) => ({ x: c.x, y: c.y, ...footprint(c) }));
  const originX = Math.min(...boxes.map((b) => b.x));
  const originY = Math.min(...boxes.map((b) => b.y));

  for (let row = 0; row < MAX_SCAN_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const cell = {
        x: originX + col * (size.w + GRID_GAP),
        y: originY + row * (size.h + GRID_GAP),
        w: size.w,
        h: size.h,
      };
      if (!boxes.some((b) => overlaps(cell, b))) return { x: cell.x, y: cell.y };
    }
  }
  // Nothing free in range — fall back to a clear strip under everything.
  return { x: originX, y: Math.max(...boxes.map((b) => b.y + b.h)) + GRID_GAP };
}

// Accepted image types and the extension we store them under — keeps the R2 key
// tidy and lets the media route hand back a correct Content-Type.
const IMAGE_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
};
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
// Same table for images arriving by URL, plus the reverse lookup used when the
// source server omits or mislabels the type.
const IMAGE_URL_EXT = IMAGE_EXT;
const IMAGE_EXT_TYPE = {
  ...Object.fromEntries(Object.entries(IMAGE_EXT).map(([type, ext]) => [ext, type])),
  jpeg: "image/jpeg", // the reverse map only yields "jpg"; URLs use both
};

const VIDEO_URL_EXT = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
  "video/ogg": "ogv",
  "video/x-m4v": "m4v",
};
// Reverse lookup so a recognized URL extension can stamp a sensible content-type
// when the source server omits or mislabels it (e.g. application/octet-stream).
const VIDEO_EXT_TYPE = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  ogv: "video/ogg",
  m4v: "video/x-m4v",
};
// The Worker request-body cap is ~100 MB and a moodboard clip is a reference,
// not a master — anything bigger belongs in the Library.
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
