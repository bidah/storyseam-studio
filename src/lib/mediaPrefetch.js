// Hold the editor's media in memory, so a clip plays the moment the playhead
// reaches it and returning to the Editor tab costs nothing.
//
// Remotion's prefetch() downloads an asset and hands back a blob URL; <Video>,
// <Audio> and <Img> then resolve that same `src` to the blob instead of going
// to the network. Two things make this the right lever here:
//
//   - Media is LATENCY-bound, not bandwidth-bound. A 720p proxy clip is ~1 MB
//     and transfers in ~0.5s, but waits ~0.6s for its first byte: every media
//     request re-runs the Worker's auth middleware (a Better Auth session
//     lookup, then getActiveProject against D1 in Newark) and nothing is cached
//     at the edge. `premountFor` gives a clip 2s of lead, which only just
//     covers that on a good link and misses on a slow one — at which point
//     `pauseWhenBuffering` stalls the whole timeline.
//   - This registry is MODULE-scoped, so it outlives the Editor route. React
//     Router unmounts the tab on every navigation and the <Player> rebuilds
//     every <video> from scratch; with the blobs still resident that rebuild
//     touches no network at all.
//
// Scoping: a media path like "/proxy/gen/MS-01.mp4" carries no project id — the
// Worker resolves it per-request — so the SAME url is different bytes in a
// different project. The registry therefore remembers which project its blobs
// belong to and drops them wholesale when that changes.
import { prefetch } from "remotion";

// Blobs live in browser memory, so this is a real ceiling rather than a hint.
// ~300 clip-proxies at ~1 MB each, which is far more than an episode needs.
const BUDGET_BYTES = 300 * 1024 * 1024;
// Enough to use the link without starving the clips nearest the playhead: the
// queue is ordered, and a wide fan-out would let clip 40 compete with clip 1.
const CONCURRENCY = 4;

/** src → { free, url, bytes, ready } */
const held = new Map();
/** The most recent request, in priority order — also the eviction order. */
let wanted = [];
let queue = [];
let active = 0;
let scope = null; // project id the held blobs belong to
const listeners = new Set();

function notify() {
  for (const fn of listeners) {
    try { fn(); } catch { /* a bad listener must not stall the queue */ }
  }
}

function pump() {
  while (active < CONCURRENCY && queue.length) {
    const src = queue.shift();
    if (!held.has(src)) begin(src);
  }
}

function begin(src) {
  const entry = { free: null, url: null, bytes: 0, ready: false };
  held.set(src, entry);
  active++;

  let handle;
  try {
    handle = prefetch(src, {
      method: "blob-url",
      // Explicit because the bytes depend on it: a media path carries no project
      // id, so the Worker resolves one from the session cookie. Fetching without
      // credentials would fall back to a default project and prefetch the wrong
      // video. (This is fetch's same-origin default, but not obviously so here.)
      credentials: "same-origin",
      onProgress: (p) => {
        // totalBytes is null until the response carries a length; loadedBytes
        // keeps the running estimate honest enough for the budget either way.
        const n = p.totalBytes ?? p.loadedBytes;
        if (Number.isFinite(n)) entry.bytes = n;
      },
    });
  } catch {
    held.delete(src);
    active--;
    return;
  }
  entry.free = handle.free;

  handle
    .waitUntilDone()
    .then((url) => {
      entry.url = url;
      entry.ready = true;
      evict();
    })
    // A failed prefetch is not worth surfacing: the element just fetches the
    // url itself, which is exactly the behaviour without this file.
    .catch(() => {
      if (held.get(src) === entry) held.delete(src);
      try { handle.free(); } catch { /* already released */ }
    })
    .finally(() => {
      active--;
      notify();
      pump();
    });
}

function evict() {
  let total = 0;
  for (const e of held.values()) total += e.bytes;
  if (total <= BUDGET_BYTES) return;

  const rank = new Map(wanted.map((src, i) => [src, i]));
  // Least urgent first: srcs the timeline no longer references at all, then the
  // ones furthest from the playhead — `wanted` is ordered by that distance.
  const victims = [...held.keys()].sort(
    (a, b) => (rank.get(b) ?? Infinity) - (rank.get(a) ?? Infinity),
  );
  for (const src of victims) {
    if (total <= BUDGET_BYTES) break;
    const e = held.get(src);
    if (!e || !e.ready) continue; // never yank something mid-download
    try { e.free(); } catch { /* already released */ }
    held.delete(src);
    total -= e.bytes;
  }
}

// Ask for `srcs` (highest priority first) to be resident. Cheap to call again
// with the same list — anything already held or in flight is left alone.
export function prefetchMedia(srcs, { projectId } = {}) {
  if (projectId && scope && projectId !== scope) releaseMedia();
  if (projectId) scope = projectId;

  const list = [];
  const seen = new Set();
  for (const s of srcs || []) {
    if (typeof s !== "string" || !s || seen.has(s)) continue;
    seen.add(s);
    list.push(s);
  }
  wanted = list;
  queue = list.filter((s) => !held.has(s));
  pump();
  notify();
}

export function releaseMedia() {
  for (const e of held.values()) {
    try { e.free?.(); } catch { /* already released */ }
  }
  held.clear();
  queue = [];
  wanted = [];
  scope = null;
  notify();
}

// The blob url standing in for `src`, or null if it isn't resident. Callers that
// identify a <video> by its url need this: once prefetched, `currentSrc` is the
// blob, not the path that was asked for.
export function prefetchedUrl(src) {
  const e = held.get(src);
  return e?.ready ? e.url : null;
}

export function mediaPrefetchStats() {
  let ready = 0;
  let bytes = 0;
  for (const src of wanted) if (held.get(src)?.ready) ready++;
  for (const e of held.values()) bytes += e.bytes;
  return { ready, total: wanted.length, bytes };
}

export function subscribeMediaPrefetch(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
