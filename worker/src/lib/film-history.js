// A Film by id — the running one, a queued one, or one that has ENDED.
//
// The FilmJobs Durable Object (film-job-do.js) only ever held the CURRENT job,
// so a Film that finished was overwritten the moment the next one started, and
// a page addressed by Film id (/director-story/create/:filmId) had nothing to
// land on after a reload once the project moved on. This keeps a bounded
// history of the last MAX_HISTORY ended Films per project: each one is stored
// under its own key (`film:<id>`, the public job incl. `film`) — one key per
// Film so no single value grows with the history — plus an index of ids,
// newest first. Written when a job ends (done / stopped / declined / refused).
//
// `saveJob` / `readFilm` take the DO's storage (get / put / delete — a Map-backed
// fake in the Vitest), so the whole write path is testable without the runtime.
import { isActive, publicJob } from "./film-job.js";

/** How many ended Films a project keeps addressable by id. */
export const MAX_HISTORY = 50;

/** The storage key one archived Film lives under. */
export const historyKey = (id) => `film:${id}`;

/**
 * Archive an ended job into the index.
 * → { index, entry, evicted } — `entry` is null (and nothing changes) for a job
 *   that is still active or has no id; `evicted` are the ids that fell off the
 *   end and whose `film:<id>` keys the caller deletes.
 */
export function archiveFilm(index = [], job) {
  if (!job?.id || isActive(job)) return { index, entry: null, evicted: [] };
  const next = [job.id, ...index.filter((id) => id !== job.id)];
  return { index: next.slice(0, MAX_HISTORY), entry: publicJob(job), evicted: next.slice(MAX_HISTORY) };
}

/** A queued Film, in the public job's shape, so one page renders either. */
export function queuedJob(item, index) {
  if (!item) return null;
  const { userId, queuedAt, ...rest } = item;
  return {
    ...rest,
    status: "queued",
    position: index + 1,
    queuedAt: queuedAt ?? null,
    createdAt: queuedAt ?? null,
    updatedAt: queuedAt ?? null,
    steps: [],
    spend: {},
  };
}

/**
 * Find a Film among the live state: the current job, then the queue.
 * The history is a separate storage read, so the caller looks there on a miss.
 * → the public job | null
 */
export function findLiveFilm({ job, queue = [] }, id) {
  if (!id) return null;
  if (job?.id === id) return publicJob(job);
  const i = (queue || []).findIndex((q) => q?.id === id);
  return i >= 0 ? queuedJob(queue[i], i) : null;
}

/** Storage keys the FilmJobs DO holds (film-job-do.js). */
export const JOB_KEY = "job";
export const QUEUE_KEY = "queue";
export const HISTORY_KEY = "history"; // ids of the last MAX_HISTORY ended Films, newest first

/**
 * Persist the current job, archiving it when it has ended. The job being
 * replaced is archived too when it ended before the history existed (it would
 * otherwise vanish the moment the next Film starts).
 */
export async function saveJob(storage, job) {
  const prev = await storage.get(JOB_KEY);
  let index = (await storage.get(HISTORY_KEY)) || [];
  const writes = { [JOB_KEY]: job };
  const evicted = [];
  const ended = prev && prev.id !== job?.id && !index.includes(prev.id) ? [prev, job] : [job];
  for (const j of ended) {
    const res = archiveFilm(index, j);
    if (!res.entry) continue;
    index = res.index;
    writes[historyKey(j.id)] = res.entry;
    evicted.push(...res.evicted);
  }
  if (Object.keys(writes).length > 1) writes[HISTORY_KEY] = index;
  await storage.put(writes);
  if (evicted.length) await storage.delete(evicted.map(historyKey));
}

/** One Film by id: current → queue → history. → the public job | null */
export async function readFilm(storage, id) {
  if (!id) return null;
  const [job, queue] = await Promise.all([storage.get(JOB_KEY), storage.get(QUEUE_KEY)]);
  return findLiveFilm({ job, queue }, id) || (await storage.get(historyKey(id))) || null;
}
