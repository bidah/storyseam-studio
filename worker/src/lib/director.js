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
import {
  MAX_SHEET_REFS, applyPatch, archiveReplacedAudio, fieldErrors, seriesFields, seriesInput, seriesPatch, stampCueTiming,
} from "./series.ts";

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

/**
 * Bring a Series back inside the limits its own schema states, where an older
 * write left it outside them — so a value written before a ceiling was
 * enforced at its source cannot block every later write to the Series (each
 * write re-validates the WHOLE row). Pure: returns the repaired copy and what
 * it changed, and the SAME object when nothing needed fixing.
 *
 * Today: every model sheet's `refs` trimmed to MAX_SHEET_REFS (an Auto run once
 * filed a style sheet with 9, and the Stills stage's opening-frame patch was
 * then refused with "expected array to have <=8 items"). Add the next such
 * repair here.
 *
 * → { series, fixes: [string] }
 */
export function sanitizeSeries(series) {
  const fixes = [];
  if (!series || typeof series !== "object" || !Array.isArray(series.modelSheets)) return { series, fixes };
  const modelSheets = series.modelSheets.map((sheet, i) => {
    if (!Array.isArray(sheet?.refs) || sheet.refs.length <= MAX_SHEET_REFS) return sheet;
    fixes.push(`model sheet "${sheet.name || i + 1}": ${sheet.refs.length} refs trimmed to ${MAX_SHEET_REFS}`);
    return { ...sheet, refs: sheet.refs.slice(0, MAX_SHEET_REFS) };
  });
  return fixes.length ? { series: { ...series, modelSheets }, fixes } : { series, fixes };
}

/**
 * sanitizeSeries, written through the Series' compare-and-swap — nothing is
 * written when nothing needed fixing.
 *
 * → { ok: true, fixes } | { missing: true }
 */
export async function repairSeries(env, pid, seriesId) {
  const res = await updateSeries(env, pid, seriesId, (row) => {
    if (!row?.id) return { abort: true, missing: true };
    const { series, fixes } = sanitizeSeries(row);
    if (!fixes.length) return { abort: true, fixes };
    Object.assign(row, series, { updatedAt: nowIso() });
    return { fixes };
  });
  if (res?.missing) return { missing: true };
  return { ok: true, fixes: res?.fixes || [] };
}

/** `s_` + short uuid, matching the project id's shape. */
export function newSeriesId() {
  return "s_" + crypto.randomUUID().slice(0, 8);
}

const nowIso = () => new Date().toISOString();

/**
 * Create a Series and index it, atomically — what `POST /api/director/series`
 * does, callable without a request (the Auto Film job files its reference
 * sheets and cue sheet on one).
 *
 * `fields` are the author's fields (title, prompt, aspectRatio, …), validated
 * by `seriesFields`; `extra` rides on the row unvalidated (e.g. the Auto job's
 * `filmId`, which is how a re-run stage finds the Series it already made).
 *
 * → `{ ok: true, series }` | `{ ok: false, issues }`
 */
export async function createSeries(env, pid, fields, extra = {}) {
  const parsed = seriesFields.safeParse(fields);
  if (!parsed.success) return { ok: false, issues: fieldErrors(parsed.error) };
  const id = newSeriesId();
  const at = nowIso();
  const row = { ...parsed.data, ...extra, id, createdAt: at, updatedAt: at };
  // The index is the PRIMARY (it is compare-and-swapped) and the Series rides
  // as an `also` row, so either both land or neither does. A Series written
  // without its index entry is a document nothing can reach; an index entry
  // written without its Series is the `missing` list GET /api/director reports.
  await updateIndex(env, pid, (index) => {
    index.seq = (index.seq || 0) + 1;
    index.seriesIds = [...(index.seriesIds || []), id];
    index.selectedId = id;
    return {};
  }, { also: [{ name: seriesDocName(id), value: row }] });
  return { ok: true, series: row };
}

/**
 * Replace a Series' whole cue sheet, re-validated against every ceiling the
 * endpoint enforces. The write `derive` and the Auto job's cue-sheet stage share.
 *
 * → `{ ok: true, beats }` | `{ missing: true }` | `{ issues }`
 */
export async function replaceCueSheet(env, pid, seriesId, beats) {
  const res = await updateSeries(env, pid, seriesId, (row) => {
    if (!row?.id) return { abort: true, missing: true };
    const candidate = stampCueTiming({ ...row, directions: beats });
    const check = seriesInput.safeParse(candidate);
    if (!check.success) return { abort: true, issues: fieldErrors(check.error) };
    Object.assign(row, candidate, { updatedAt: nowIso() });
    return {};
  });
  if (res.missing) return { missing: true };
  if (res.issues) return { issues: res.issues };
  return { ok: true, beats: beats.length };
}

/**
 * Add a model sheet to a Series, or replace the one with the same name —
 * `POST /api/director/series/:id/sheets` without the request.
 *
 * → `{ ok: true, sheets }` | `{ missing: true }` | `{ issues }`
 */
export async function upsertModelSheet(env, pid, seriesId, sheet) {
  const res = await updateSeries(env, pid, seriesId, (series) => {
    if (!series?.id) return { abort: true, missing: true };
    const sheets = [...(series.modelSheets || [])];
    const at = sheets.findIndex((s) => s.name === sheet.name);
    if (at >= 0) sheets[at] = { ...sheets[at], ...sheet };
    else sheets.push(sheet);
    const candidate = { ...series, modelSheets: sheets };
    const check = seriesInput.safeParse(candidate);
    if (!check.success) return { abort: true, issues: fieldErrors(check.error) };
    Object.assign(series, candidate, { updatedAt: nowIso() });
    return { sheets: sheets.length };
  });
  if (res.missing) return { missing: true };
  if (res.issues) return { issues: res.issues };
  return { ok: true, sheets: res.sheets };
}

/**
 * Patch a Series' fields — `PUT /api/director/series/:id` without the request
 * (the Auto job's Stills stage sets the opening frame through it). The whole
 * Series is re-validated, so a patch the endpoint would refuse is not written.
 *
 * → `{ ok: true }` | `{ missing: true }` | `{ invalid }` (the patch's own
 *   shape) | `{ issues }` (what the Series would then break)
 */
export async function patchSeries(env, pid, seriesId, body) {
  const parsed = seriesPatch.safeParse(body ?? {});
  if (!parsed.success) return { invalid: fieldErrors(parsed.error) };
  const res = await updateSeries(env, pid, seriesId, (series) => {
    if (!series?.id) return { abort: true, missing: true };
    // Swapping which sound a Series is shot against archives the one it had —
    // a render that is replaced is kept, never overwritten, because a version
    // whose prompt was lost cannot be made again in the same hand.
    const patch = archiveReplacedAudio(series, parsed.data);
    const next = stampCueTiming(applyPatch(series, patch));
    const check = seriesInput.safeParse(next);
    if (!check.success) return { abort: true, issues: fieldErrors(check.error) };
    Object.assign(series, next, { updatedAt: nowIso() });
    return {};
  });
  if (res.missing) return { missing: true };
  if (res.issues) return { issues: res.issues };
  return { ok: true };
}

/**
 * Pin a frame to the beat at `offset`, or clear it —
 * `POST /api/director/series/:id/pin` without the request. ONE frame per call:
 * pinning runs the whole cue sheet's validation (spacing, count, the opening
 * chunk, per reel), and a pin belongs to the beat whose chunk ENDS at that
 * second, so it is addressed by offset.
 *
 * → `{ ok: true }` | `{ missing: true }` | `{ noBeat: true }` | `{ issues }`
 */
export async function pinBeat(env, pid, seriesId, { offset, imageUrl, clear, prompt, model, refs } = {}) {
  const res = await updateSeries(env, pid, seriesId, (series) => {
    if (!series?.id) return { abort: true, missing: true };
    const beats = [...(series.directions || [])];
    const at = beats.findIndex((b) => b.offset === offset);
    if (at < 0) return { abort: true, noBeat: true };
    beats[at] = {
      ...beats[at],
      endImageUrl: clear ? null : String(imageUrl || ""),
      // Kept beside the pin for the same reason a model sheet keeps its
      // prompt: a pin whose prompt was lost is a shot that cannot be redrawn
      // in the same hand. None of it reaches the Director.
      endImagePrompt: clear ? null : (prompt ?? beats[at].endImagePrompt ?? null),
      endImageModel: clear ? null : (model ?? beats[at].endImageModel ?? null),
      endImageRefs: clear ? null : (refs ?? beats[at].endImageRefs ?? null),
    };
    const candidate = stampCueTiming({ ...series, directions: beats });
    const check = seriesInput.safeParse(candidate);
    if (!check.success) return { abort: true, issues: fieldErrors(check.error) };
    Object.assign(series, candidate, { updatedAt: nowIso() });
    return {};
  });
  if (res.missing) return { missing: true };
  if (res.noBeat) return { noBeat: true };
  if (res.issues) return { issues: res.issues };
  return { ok: true };
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
