// FilmJobs — the Durable Object that holds a project's Film job (one instance
// per project: the Worker addresses it with idFromName(projectId)).
//
// Every new Film starts in a project of its OWN (lib/films.js), so in practice
// one instance holds one Film and its queue stays empty; the queue survives for
// Films started before that, and one-at-a-time is now enforced per USER at the
// start route (routes/auto.js), where the films table can see across projects.
//
// It stores the CURRENT job plus a QUEUE of Films waiting behind it (one Film
// at a time per project — lib/film-queue.js), and drives the job with alarms,
// one stage attempt per alarm, so nothing depends on a request (or the
// author's tab) staying open: the alarm re-arms itself until the job ends, and
// an alarm that dies mid-stage is retried by the runtime and re-runs that
// stage. When the job ends (done / stopped) the same alarm starts the next
// queued Film, re-checking its allowance at that moment. What a stage does
// lives in lib/film-job.js; this file only persists, broadcasts and schedules.
//
// Spoken to over RPC by routes/auto.js:
//   start({ prompt, seconds?, userId, projectId, episodeId })
//     → { ok, job } | { ok, queued: true, position, film, job } | { ok:false, refusal, job }
//   current() → the job (without userId) | null
//   queued()  → the waiting Films (without userId), each with its position
//   film(id)  → one Film by id — the current job, a queued one (status
//             "queued", with its position) or an ENDED one from the bounded
//             history (lib/film-history.js) — | null
//   confirm(filmId) / decline(filmId)
//             → { ok, job } | { ok:false, code: 'not-found'|'not-awaiting', job }
//             the answer to the one confirm card an Auto-off job asks (#65):
//             confirm re-arms the alarm; decline ends the job and starts the
//             next queued Film.
//   retry(filmId)
//             → { ok, job, repaired } | { ok:false, code, message, job }
//             re-run a STOPPED Film from its failed step (lib/film-job.js
//             retryFilm): repairs its Series, then re-arms the alarm.
//
// Every transition is broadcast on the project's existing live-sync `data`
// channel (the ProjectEvents DO) as `{ resource: "auto", kind, filmId, step,
// job }` — the Auto surface rides the firehose RootLayout already holds open,
// rather than a sixth EventSource.

import { DurableObject } from "cloudflare:workers";
import {
  advanceFilm, confirmFilm, declineFilm, event, groqModel, isActive, nextAlarmDelay, publicJob, repairFilmSeries, retryFilm,
} from "./lib/film-job.js";
import { publicQueue, startNextQueued, submitFilm } from "./lib/film-queue.js";
import { JOB_KEY, QUEUE_KEY, historyKey, readFilm, saveJob } from "./lib/film-history.js";
import { runWithContext } from "./lib/request-context.js";
import { broadcast } from "./lib/broadcast.js";
import { saveWorld } from "./routes/world.js";
import { nameFilmProject } from "./lib/films.js";

// Same keys lib/film-history.js reads and writes.
const KEY = JOB_KEY;
const QUEUE = QUEUE_KEY;

export class FilmJobs extends DurableObject {
  async current() {
    return publicJob(await this.ctx.storage.get(KEY));
  }

  async queued() {
    return publicQueue(await this.ctx.storage.get(QUEUE));
  }

  async film(id) {
    return readFilm(this.ctx.storage, id);
  }

  async start(input) {
    const job = await this.ctx.storage.get(KEY);
    const queue = (await this.ctx.storage.get(QUEUE)) || [];
    const res = await submitFilm({ job, queue }, input, { env: this.env });
    if (!res.ok) return { ...res, job: publicJob(job) };

    if (res.queued) {
      await this.ctx.storage.put(QUEUE, res.queue);
      await this.announce(job?.projectId ?? res.item.projectId, {
        resource: "auto", kind: "film.queued", filmId: res.item.id, step: null, job: publicJob(job),
      });
      // Nothing running but a queue (a drain was interrupted) → drain it now.
      if (!isActive(job)) await this.ctx.storage.setAlarm(Date.now());
      return {
        ok: true,
        queued: true,
        position: res.position,
        film: publicQueue(res.queue)[res.position - 1],
        job: publicJob(job),
      };
    }

    await this.commit(res.job, event("film.started", res.job));
    await this.ctx.storage.setAlarm(Date.now());
    return { ok: true, job: publicJob(res.job) };
  }

  async confirm(filmId) {
    const job = await this.ctx.storage.get(KEY);
    const res = await confirmFilm(job, filmId, { commit: (j, ev) => this.commit(j, ev) });
    if (!res.ok) return { ...res, job: publicJob(job) };
    await this.ctx.storage.setAlarm(Date.now());
    return { ok: true, job: publicJob(res.job) };
  }

  async decline(filmId) {
    const job = await this.ctx.storage.get(KEY);
    const res = await declineFilm(job, filmId, { commit: (j, ev) => this.commit(j, ev) });
    if (!res.ok) return { ...res, job: publicJob(job) };
    // The declined Film is over: the queue moves on.
    await this.ctx.storage.setAlarm(Date.now());
    return { ok: true, job: publicJob(res.job) };
  }

  // Retry a stopped Film from the step that stopped it (lib/film-job.js
  // retryFilm): only the latest Film, only with nothing queued. Its Series is
  // repaired first, then the alarm resumes the runner AT the failed step.
  async retry(filmId) {
    const job = await this.ctx.storage.get(KEY);
    const queue = (await this.ctx.storage.get(QUEUE)) || [];
    const archived = job?.id === filmId ? null : (await this.ctx.storage.get(historyKey(filmId))) || null;
    const res = await retryFilm({ job, queue, archived }, filmId, {
      env: this.env,
      repair: (j) =>
        runWithContext(
          { userId: j.userId, caller: "auto", chatId: null, episodeId: j.episodeId || undefined },
          () => repairFilmSeries(this.env, j),
        ),
      commit: (j, ev) => this.commit(j, ev),
    });
    if (!res.ok) return { ...res, job: publicJob(job?.id === filmId ? job : archived) };
    await this.ctx.storage.setAlarm(Date.now());
    return { ok: true, job: publicJob(res.job), repaired: res.repaired ?? null };
  }

  async alarm() {
    let job = await this.ctx.storage.get(KEY);
    if (job?.status === "running") {
      job = await advanceFilm(job, {
        env: this.env,
        model: groqModel(this.env),
        saveWorld,
        commit: (j, ev) => this.commit(j, ev),
      });
      if (job?.status === "running") {
        // A pending stage (a render in flight) is asked again later, not now.
        await this.ctx.storage.setAlarm(Date.now() + nextAlarmDelay(job));
        return;
      }
    }
    // Waiting on the confirm card: no alarm until the author answers.
    if (isActive(job)) return;
    await this.startNext(job);
  }

  // The job ended (or there was none): start the first queued Film that may.
  async startNext(job) {
    const queue = (await this.ctx.storage.get(QUEUE)) || [];
    if (!queue.length) return;
    const res = await startNextQueued({ job, queue }, { env: this.env });
    await this.ctx.storage.put(QUEUE, res.queue);
    for (const refused of res.refused) await this.commit(refused, event("film.refused", refused));
    if (res.job) {
      await this.commit(res.job, event("film.started", res.job));
      await this.ctx.storage.setAlarm(Date.now());
    }
  }

  // Persist FIRST, then announce — a tab that reloads on the event must read
  // the state the event describes.
  //
  // An ENDED job is also archived into the history, so it stays readable by
  // id after the next Film replaces it. The job being replaced is archived
  // too when it ended before the history existed.
  async commit(job, ev) {
    await saveJob(this.ctx.storage, job);
    await this.announce(job.projectId, ev);
    // The Film's own project (lib/films.js) is named after the prompt until the
    // World has a title — then after the World. Cosmetic: never fails a stage.
    if (ev?.kind === "step.done" && ev.step === "world") {
      const title = job.steps?.find((s) => s.key === "world")?.result?.title;
      await nameFilmProject(this.env, job.id, title).catch(() => {});
    }
  }

  async announce(projectId, ev) {
    await broadcast(this.env, projectId, "data", {
      ...ev,
      path: "/api/auto/films",
      clientId: null,
      at: Date.now(),
    });
  }
}
