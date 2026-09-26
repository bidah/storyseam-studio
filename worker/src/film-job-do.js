// FilmJobs — the Durable Object that holds a project's Film job (one instance
// per project: the Worker addresses it with idFromName(projectId)).
//
// It stores ONE job — the current one — and drives it with alarms, one stage
// per alarm, so nothing depends on a request (or the author's tab) staying
// open: the alarm re-arms itself until the job stops, and an alarm that dies
// mid-stage is retried by the runtime and re-runs that stage. What a stage does
// lives in lib/film-job.js; this file only persists, broadcasts and schedules.
//
// Spoken to over RPC by routes/auto.js:
//   start({ prompt, userId, projectId, episodeId }) → { ok, job } | { ok:false, refusal }
//   current()                                        → the job (without userId) | null
//
// Every transition is broadcast on the project's existing live-sync `data`
// channel (the ProjectEvents DO) as `{ resource: "auto", kind, filmId, step,
// job }` — the Auto surface rides the firehose RootLayout already holds open,
// rather than a sixth EventSource.

import { DurableObject } from "cloudflare:workers";
import { advanceFilm, groqModel, publicJob, startFilm } from "./lib/film-job.js";
import { broadcast } from "./lib/broadcast.js";
import { saveWorld } from "./routes/world.js";

const KEY = "job";

export class FilmJobs extends DurableObject {
  async current() {
    return publicJob(await this.ctx.storage.get(KEY));
  }

  async start(input) {
    const existing = await this.ctx.storage.get(KEY);
    const res = await startFilm(existing, input, { env: this.env });
    if (!res.ok) return { ...res, job: publicJob(existing) };
    await this.commit(res.job, {
      resource: "auto", kind: "film.started", filmId: res.job.id, step: null, job: publicJob(res.job),
    });
    await this.ctx.storage.setAlarm(Date.now());
    return { ok: true, job: publicJob(res.job) };
  }

  async alarm() {
    const job = await this.ctx.storage.get(KEY);
    if (!job || job.status !== "running") return;
    const next = await advanceFilm(job, {
      env: this.env,
      model: groqModel(this.env),
      saveWorld,
      commit: (j, ev) => this.commit(j, ev),
    });
    if (next?.status === "running") await this.ctx.storage.setAlarm(Date.now());
  }

  // Persist FIRST, then announce — a tab that reloads on the event must read
  // the state the event describes.
  async commit(job, ev) {
    await this.ctx.storage.put(KEY, job);
    await broadcast(this.env, job.projectId, "data", {
      ...ev,
      path: "/api/auto/films",
      clientId: null,
      at: Date.now(),
    });
  }
}
