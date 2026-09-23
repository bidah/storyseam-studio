// The Director doc store: where a Series lives, and the two ledgers of what it
// produced.
//
// FOUR DOC NAMES, and the split is deliberate:
//
//   director              the index — which Series this project has, and which
//                         one is open. Small, written on create/reorder only.
//   director:<seriesId>   ONE Series. Its own row, so its own `version` for the
//                         CAS, its own doc_history, and its own `restore_version`.
//   director-sittings     every kept sitting, and the scored version of each.
//   director-sheets       every Shot Sheet render, in flight and finished.
//
// A Series is one row rather than an entry in a list because of what editing one
// is LIKE: a cue sheet is up to sixty-four beats, and the author moves one beat
// at a time, dozens of times, while a second author is doing the same to another
// Series. One document for all of them makes every one of those writes a CAS
// retry against work that has nothing to do with it, and makes the history
// dialog show "the Director changed" rather than "this Series changed".
//
// The ledgers stay project-level and carry a `seriesId` instead, because that is
// how they are READ: the Stage's rail and the Musicalized tab both want "what
// has this project produced", most recent first, across every Series.
import { readDoc, updateDoc } from "./docs.js";
import { filesUrl, mediaKey } from "./media.js";

/** The index doc. `seq` numbers new Series so two creates never collide. */
export const emptyIndex = () => ({ seriesIds: [], selectedId: null, seq: 0 });
/** The kept-sittings ledger. */
export const emptySittings = () => ({ kept: [], seq: 0 });
/** The Shot Sheet ledger. */
export const emptySheets = () => ({ takes: [], seq: 0 });
/** Cue renders in flight: requestId → { seriesId, sent, filmMs, at }. */
export const emptyCues = () => ({ pending: {} });

/** `director:<id>` — the doc name of one Series. */
export const seriesDocName = (seriesId) => `director:${String(seriesId || "")}`;

export const readIndex = (env, pid) => readDoc(env, pid, "director", emptyIndex());
export const updateIndex = (env, pid, mutate, opts) =>
  updateDoc(env, pid, "director", emptyIndex(), mutate, opts);

export const readSittings = (env, pid) => readDoc(env, pid, "director-sittings", emptySittings());
export const updateSittings = (env, pid, mutate, opts) =>
  updateDoc(env, pid, "director-sittings", emptySittings(), mutate, opts);

export const readCues = (env, pid) => readDoc(env, pid, "director-cues", emptyCues());
export const updateCues = (env, pid, mutate, opts) =>
  updateDoc(env, pid, "director-cues", emptyCues(), mutate, opts);
export const readSheets = (env, pid) => readDoc(env, pid, "director-sheets", emptySheets());
export const updateSheets = (env, pid, mutate, opts) =>
  updateDoc(env, pid, "director-sheets", emptySheets(), mutate, opts);

/** One Series, or `null` when this project has no such row. */
export async function readSeries(env, pid, seriesId) {
  if (!seriesId) return null;
  const doc = await readDoc(env, pid, seriesDocName(seriesId), null);
  return doc && typeof doc === "object" && doc.id ? doc : null;
}

/**
 * Mutate one Series under the doc store's compare-and-swap.
 *
 * `mutate` may re-run, so it must stay pure: no fetches, no uploads, no clock
 * reads that matter. The long work — a render, an upload — happens outside and
 * only its RESULT is written here.
 */
export function updateSeries(env, pid, seriesId, mutate, opts) {
  return updateDoc(env, pid, seriesDocName(seriesId), null, mutate, opts);
}

/** `s_` + short uuid, matching the project id's shape. */
export function newSeriesId() {
  return "s_" + crypto.randomUUID().slice(0, 8);
}

// ─── Media ───────────────────────────────────────────────────────────────────

/**
 * A director file's browser URL — relative, Range-served, seekable by <video>.
 *
 * Relative because the page and the API share an origin. The ABSOLUTE form is
 * `absolutize` below, and the difference is not cosmetic: fal fetches a
 * reference image itself, from its own network, so a relative path there is a
 * 404 nobody sees until the frame comes back wrong.
 */
export const directorUrl = (file) => (file ? "/director-media/" + file : null);

/**
 * Resolve any url a Series carries into one the ENDPOINT can fetch.
 *
 * A Series' frames and beds are picked from this project — a Library asset, a
 * generation, a Sound Studio take — so they arrive as our own relative paths
 * (`/sound-media/x.mp3`, `/visual-media/y.png`). The Director is on fal's
 * network and cannot fetch those. Every url that reaches `recipe()` therefore
 * goes through here first.
 *
 * An absolute url is passed through untouched, which is what makes a Series
 * imported from elsewhere still play.
 */
export function absolutize(env, pid, url) {
  const u = String(url || "");
  if (!u) return u;
  if (/^https?:\/\//i.test(u)) return u;
  const m = /^\/([a-z-]+)\/(.+)$/i.exec(u);
  if (!m) return u;
  const [, prefix, rest] = m;
  if (prefix === "asset") return filesUrl(env, `media/${pid}/asset/${decodeURIComponent(rest)}`);
  // The same map the media routes in `worker/src/index.js` are mounted from, so
  // a prefix this understands is exactly a prefix the Worker serves.
  const kind = PREFIX_KIND[prefix];
  if (!kind) return u;
  return filesUrl(env, mediaKey(pid, kind, decodeURIComponent(rest)));
}

const PREFIX_KIND = {
  "sound-media": "sound-media",
  "visual-media": "visual",
  "director-media": "director",
  "storyboard-media": "storyboard",
  "multishot-media": "multishot",
  "moodboard-media": "moodboard",
  gen: "gen",
  media: "shots",
  stills: "stills",
  final: "final",
  refs: "refs",
};

/**
 * Every url inside a Series, absolutized — the row as the endpoint must see it.
 *
 * Done on the way OUT rather than on the way in, so what is stored stays
 * portable: a project cloned to another Worker keeps working, and a relative
 * path never hard-codes yesterday's public hostname into a row.
 */
export function absolutizeSeries(env, pid, series) {
  const abs = (u) => absolutize(env, pid, u);
  return {
    ...series,
    imageUrl: abs(series.imageUrl),
    endImageUrl: series.endImageUrl ? abs(series.endImageUrl) : series.endImageUrl,
    audioUrl: series.audioUrl ? abs(series.audioUrl) : series.audioUrl,
    directions: (series.directions || []).map((beat) => ({
      ...beat,
      endImageUrl: beat.endImageUrl ? abs(beat.endImageUrl) : beat.endImageUrl,
      audioUrl: beat.audioUrl ? abs(beat.audioUrl) : beat.audioUrl,
    })),
    modelSheets: (series.modelSheets || []).map((sheet) => ({
      ...sheet,
      imageUrl: sheet.imageUrl ? abs(sheet.imageUrl) : sheet.imageUrl,
    })),
    audioVersion: series.audioVersion
      ? { ...series.audioVersion, audioUrl: abs(series.audioVersion.audioUrl) }
      : series.audioVersion,
  };
}
