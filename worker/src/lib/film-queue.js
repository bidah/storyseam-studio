// One Film at a time per project, and a queue behind it.
//
// CONTEXT.md › Auto: a second prompt sent while a Film is running does not
// bounce — it QUEUES behind the current Film and the surface says so. The
// FilmJobs Durable Object (film-job-do.js) stores `{ job, queue }` and calls
// these two pure functions; everything here takes its side effects as `deps`
// (the same deps `startFilm` takes) so a Vitest can drive a whole queue.
//
//   queue item = { id, prompt, userId, projectId, episodeId, queuedAt }
//
// The kill switch and the allowance are checked TWICE for a queued Film: when
// it is enqueued (so an author already over their allowance is told at once)
// and again when it reaches the front (`startNextQueued`) — the Film ahead of
// it may have used the last one, or the switch may have been thrown meanwhile.
// A queued Film refused at the front becomes a `refused` job (event
// `film.refused`) so the surface can say why it never started.
import { startFilm } from "./film-job.js";

/** How many Films may wait behind the running one. */
export const MAX_QUEUE = 3;

const iso = (now) => new Date(now ?? Date.now()).toISOString();

/** A queue item as the surface sees it — without who queued it. */
export function publicQueued(item, index) {
  if (!item) return null;
  const { userId, ...rest } = item;
  return { ...rest, position: index + 1 };
}

export const publicQueue = (queue) => (queue || []).map(publicQueued);

/**
 * A new prompt for this project.
 *
 * Nothing running and nobody waiting → start it now (`startFilm`).
 * Otherwise → queue it, after the same checks `startFilm` makes.
 *
 * → { ok: true, job, queue }                           started now
 *   { ok: true, queued: true, position, item, queue }   waiting
 *   { ok: false, refusal: { code, message } }
 */
export async function submitFilm({ job, queue = [] }, input, deps = {}) {
  const busy = job?.status === "running" || queue.length > 0;
  if (!busy) {
    const res = await startFilm(job, input, deps);
    return res.ok ? { ...res, queue } : res;
  }
  if (queue.length >= MAX_QUEUE) {
    return {
      ok: false,
      refusal: {
        code: "busy",
        message: `${MAX_QUEUE} Films are already waiting on this project — try again when one has started.`,
      },
    };
  }
  // Same validation, kill switch and allowance as a start — against no job,
  // so the running one doesn't read as "busy".
  const check = await startFilm(null, input, deps);
  if (!check.ok) return check;
  const { id, prompt, projectId, episodeId, userId } = check.job;
  const item = { id, prompt, userId, projectId, episodeId, queuedAt: iso(deps.now?.()) };
  const next = [...queue, item];
  return { ok: true, queued: true, position: next.length, item, queue: next };
}

/**
 * The running Film has ended: start the first queued one that may start.
 * Each queued Film is re-checked (kill switch, allowance) as it reaches the
 * front; one refused there becomes a `refused` job and the next is tried.
 *
 * → { job: started job | null, queue: what's left, refused: [refused job] }
 */
export async function startNextQueued({ job, queue = [] }, deps = {}) {
  if (job?.status === "running") return { job: null, queue, refused: [] };
  const rest = [...queue];
  const refused = [];
  while (rest.length) {
    const item = rest.shift();
    const res = await startFilm(null, item, { ...deps, newId: () => item.id });
    if (res.ok) return { job: res.job, queue: rest, refused };
    const at = iso(deps.now?.());
    refused.push({
      id: item.id,
      prompt: item.prompt,
      status: "refused",
      error: res.refusal.message,
      refusal: res.refusal,
      projectId: item.projectId ?? null,
      episodeId: item.episodeId ?? null,
      userId: item.userId,
      createdAt: item.queuedAt || at,
      updatedAt: at,
      steps: [],
      spend: {},
    });
  }
  return { job: null, queue: rest, refused };
}
