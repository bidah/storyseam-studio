// The Auto tools — prompt to Film, from the chat (issue #73).
//
// Auto is NOT a chat pipeline (CONTEXT.md › Auto): a job in the FilmJobs Durable
// Object runs every stage server-side — Idea, World, sheets, shot list, cue
// sheet, the run, stills, the sitting, the score — for twenty to forty minutes,
// and shows its progress on the Auto surface (/auto). So the agent's half is
// thin on purpose: start the SAME job the surface starts (POST /api/auto/films,
// nothing agent-specific in the body), read it back, and answer the one confirm
// card an Auto-off job asks. It never drives a stage itself, and it never waits
// for one — a turn cannot outlive the job, and a tight poll loop only burns the
// author's turn while the Film is still an hour of Worker alarms away.
//
// Every Film runs in a NEW project of its own, which the Worker makes when it
// starts (worker/src/lib/films.js) — never in this chat's project, whose World
// would bleed into it. So these tools never address a Film through the chat's
// project: the start route is user-scoped, `get_film` with no id reads the
// author's LATEST Film (/api/auto/films/latest), and every by-id route finds
// the Film's project from the Worker's films lookup.
import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api, Json } from "../lib/api.js";
import { FILM_STEPS, filmLength, formatLength } from "../lib/film-plan.js";

type Step = {
  key?: string; label?: string; status?: string; summary?: string | null;
  error?: string | null; pending?: boolean;
};
type Job = {
  id?: string; prompt?: string; seconds?: number; status?: string; error?: string | null; auto?: boolean;
  steps?: Step[]; spend?: Record<string, number>; spent?: number;
  confirm?: { status?: string; after?: string; summary?: string; plan?: unknown };
  film?: Record<string, unknown>;
  stopped?: { stage?: string; label?: string; reason?: string; kept?: unknown[]; spent?: number };
  refusal?: { code?: string; message?: string };
  createdAt?: string; updatedAt?: string;
};

const totalSpend = (spend?: Record<string, number>) =>
  Math.round(Object.values(spend || {}).reduce((s, n) => s + (Number(n) || 0), 0) * 100) / 100;

// What the model should SAY about a job, in one line — so "still running" is
// never mistaken for "done", and "stopped" is never reported as a failure of
// the author's idea.
function nextFor(status?: string): string {
  switch (status) {
    case "running":
      return "Still being made, server-side. Tell the author it is on the Auto surface and do NOT call get_film again this turn.";
    case "awaiting-confirm":
      return "Waiting on the author's go-ahead (Auto is off). Draw ONE render_ui confirm card from `confirm.summary`/`confirm.plan`, then end the turn; on their yes call confirm_film, on a no call decline_film.";
    case "done":
      return "Finished. The Film is at `film.url`.";
    case "stopped":
      return "Stopped on our side. Everything already made is kept, and a stopped Film does not count against the allowance. Say which stage stopped and why, and offer to retry it from that stage (retry_film) — only on the author's yes.";
    case "declined":
      return "The author declined at the confirm card. Nothing after the World was made or paid for.";
    case "queued":
      return "Waiting behind the Film already being made on this project; it starts on its own when that one ends. Do not start it again.";
    case "refused":
      return "Refused when it reached the front of the queue — see `error`. Nothing was made.";
    default:
      return "No Film on this project yet.";
  }
}

// The job, trimmed to what a model needs: every stage's state and one-line
// summary (never its full `result`, which carries whole shot lists), and the
// Film only when there is one.
function viewJob(job: Job | null | undefined): Json {
  if (!job) return null;
  const out: Record<string, Json> = {
    id: job.id ?? null,
    prompt: job.prompt ?? null,
    ...(typeof job.seconds === "number" ? { seconds: job.seconds } : {}),
    status: job.status ?? null,
    auto: job.auto !== false,
    steps: (job.steps || []).map((s) => ({
      key: s.key ?? null,
      label: s.label ?? null,
      status: s.status ?? null,
      summary: s.summary ?? null,
      ...(s.pending ? { pending: true } : {}),
      ...(s.error ? { error: s.error } : {}),
    })),
    spend: totalSpend(job.spend),
    createdAt: job.createdAt ?? null,
    updatedAt: job.updatedAt ?? null,
    next: nextFor(job.status),
  };
  if (job.error) out.error = job.error;
  if (job.status === "awaiting-confirm" && job.confirm) {
    out.confirm = {
      summary: job.confirm.summary ?? null,
      after: job.confirm.after ?? null,
      plan: (job.confirm.plan ?? null) as Json,
    };
  }
  if (job.status === "done" && job.film) out.film = job.film as Json;
  if (typeof job.spent === "number") out.spent = job.spent;
  if (job.stopped) out.stopped = job.stopped as Json;
  return out;
}

const PIPELINE =
  "The WHOLE pipeline (Idea, World, character & location sheets, shot list, cue sheet, clips, stills, the sitting, the score) runs server-side for 20–40 minutes, on StorySeam's own keys — nothing depends on this chat or the author's tab.";

export const makeFilm = (api: Api) =>
  defineTool({
    name: "make_film",
    description:
      `Start an Auto Film from a prompt — the same job the Auto surface's prompt box starts ("make me a two-minute mecha short"). ${PIPELINE} The Film is made in a NEW project of its own (named after the story; \`projectId\` in the result) — never in this chat's project, so nothing from this project's World or shot list leaks into it. An author makes ONE Film at a time. It returns at once: the job id, or \`started: false\` with the refusal's message (empty/too-long prompt, \`busy\` — another of their Films is still being made, the monthly Film allowance is used up, Auto is paused/unavailable) — relay a refusal in plain words and start nothing else. After a start, navigate to "auto" so the author watches the cards there, tell them the Film is being made and roughly how long it takes, and END THE TURN. Do NOT poll get_film in a loop; check back with get_film only when the author asks. Never say a Film is done unless get_film reports status "done". Check get_auto_status first when you don't know the allowance.`,
    input: v.object({
      prompt: d(
        v.string(),
        "The author's idea in their own words — what the Film is about. Pass it through; do not expand it into a script (the job derives the Idea and the World itself). Max 4000 characters.",
      ),
      seconds: v.optional(
        d(
          v.number(),
          `Optional length the author asked for, IN SECONDS (three minutes → 180, "3:10" → 190). A Film is 2:00–5:00 in 30s steps (${FILM_STEPS.join(", ")}): no length means 2:00, anything else rounds UP to the next step, longer is capped at 5:00 (the result says \`capped\` — tell the author). It wins over any length in the prompt — the same as the length setting on the Auto surface's input.`,
        ),
      ),
    }),
    async run({ data: input, signal }): Promise<{ output: Json }> {
      const prompt = String(input.prompt ?? "").trim();
      // The same `seconds` the surface's length gear sends: one of the steps,
      // so a spoken "three minutes and ten" is rounded here, not refused there.
      const asked = typeof input.seconds === "number" && Number.isFinite(input.seconds) && input.seconds > 0
        ? input.seconds
        : null;
      const chosen = asked == null ? null : filmLength(asked);
      const lengthNote = chosen
        ? { seconds: chosen.seconds, length: formatLength(chosen.seconds), ...(chosen.capped ? { capped: true } : {}) }
        : {};
      try {
        const res = (await api.post(
          "/api/auto/films",
          chosen ? { prompt, seconds: chosen.seconds } : { prompt },
          signal,
        )) as { job?: Job; projectId?: string };
        const filmId = res.job?.id ?? null;
        return {
          output: {
            started: true,
            filmId,
            projectId: res.projectId ?? null,
            ...(filmId ? { page: `/director-story/create/${encodeURIComponent(filmId)}` } : {}),
            ...lengthNote,
            job: viewJob(res.job),
            next: 'Started, in a new project of its own. navigate to "auto", tell the author the Film is being made there (20–40 minutes) and that it has its own project, and end the turn.',
          },
        };
      } catch (err) {
        const body = (err as {
          body?: { refusal?: { code?: string; message?: string }; job?: Job; filmId?: string };
        }).body;
        if (body?.refusal) {
          return {
            output: {
              started: false,
              refused: true,
              code: body.refusal.code ?? null,
              message: body.refusal.message ?? null,
              ...(body.filmId ? { runningFilmId: body.filmId } : {}),
              running: viewJob(body.job),
            },
          };
        }
        throw err;
      }
    },
  });

export const getFilm = (api: Api) =>
  defineTool({
    name: "get_film",
    description:
      `The author's latest Auto Film (each Film has a project of its own — this finds it wherever it is, not in this chat's project): its status (running | awaiting-confirm | done | stopped | declined | refused), every stage that has started with its state and one-line summary, what it has cost so far, the Films queued behind it — and, ONLY when status is "done", the Film itself (\`film.url\`, seconds, title). ${PIPELINE} Call it when the author asks how their Film is going, not on a timer: never call it twice in one turn to wait for progress. A running job is not a done one — never tell the author a Film is ready unless this says "done". A "stopped" job names the stage and reason and keeps everything made so far; say so.`,
    input: v.object({
      filmId: v.optional(
        d(
          v.string(),
          "Optional: read ONE Film by its id (make_film's `filmId`, or the id in a /director-story/create/<id> link) instead of the latest — any of the author's Films, running or finished/stopped, whichever project it is in. Omit for the latest Film.",
        ),
      ),
    }),
    async run({ data: input, signal }): Promise<{ output: Json }> {
      const filmId = String(input?.filmId ?? "").trim();
      if (filmId) {
        const id = encodeURIComponent(filmId);
        try {
          const res = (await api.get(`/api/auto/films/${id}`, signal)) as { job?: Job | null; projectId?: string | null };
          const job = res.job as (Job & { position?: number }) | null | undefined;
          return {
            output: {
              job: viewJob(job),
              projectId: res.projectId ?? null,
              ...(job?.status === "queued"
                ? { position: job.position ?? null, next: "Queued behind the Film being made on this project; it starts on its own." }
                : {}),
            },
          };
        } catch (err) {
          if ((err as { status?: number }).status === 404) {
            return { output: { job: null, notFound: true, next: "None of the author's Films has that id (it may be someone else's, or have aged out of the last 50)." } };
          }
          throw err;
        }
      }
      // The author's latest Film, in whichever project it was made.
      const latest = (await api.get("/api/auto/films/latest", signal)) as {
        job?: Job | null; filmId?: string; projectId?: string;
      };
      if (latest.job) {
        return { output: { job: viewJob(latest.job), projectId: latest.projectId ?? null, queue: [] } };
      }
      // None recorded: a Film started before every Film had its own project
      // can only be in this chat's project.
      const res = (await api.get("/api/auto/films/current", signal)) as { job?: Job | null; queue?: unknown[] };
      return {
        output: {
          job: viewJob(res.job),
          queue: (res.queue ?? []) as Json,
          ...(res.job ? {} : { next: nextFor(undefined) }),
        },
      };
    },
  });

const answerTool = (api: Api, answer: "confirm" | "decline") =>
  defineTool({
    name: `${answer}_film`,
    description:
      answer === "confirm"
        ? "Say YES to an Auto-off Film's one confirm card — the job is `awaiting-confirm` after the World, before anything is paid for. Only call it after the author's actual yes has arrived as a user message (from the render_ui card you drew from get_film's `confirm`), never on your own. The job then runs on server-side for the rest of its 20–40 minutes; tell the author and end the turn."
        : "Say NO to an Auto-off Film's confirm card: the job ends `declined`, nothing after the World is made or paid for, and it does not count against the allowance. Only on the author's actual no.",
    input: v.object({
      filmId: d(v.string(), "The Film job's id, from get_film (`job.id`) or make_film (`filmId`)."),
    }),
    async run({ data: input, signal }): Promise<{ output: Json }> {
      const id = encodeURIComponent(String(input.filmId));
      try {
        const res = (await api.post(
          answer === "confirm" ? `/api/auto/films/${id}/confirm` : `/api/auto/films/${id}/decline`,
          {},
          signal,
        )) as { job?: Job };
        return { output: { ok: true, job: viewJob(res.job) } };
      } catch (err) {
        const body = (err as { body?: { code?: string; job?: Job } }).body;
        if (body?.code) {
          return {
            output: {
              ok: false,
              code: body.code,
              message:
                body.code === "not-awaiting"
                  ? "That Film is not waiting on a confirm any more — read get_film before saying anything about it."
                  : "No such Film on this project.",
              job: viewJob(body.job),
            },
          };
        }
        throw err;
      }
    },
  });

export const retryFilm = (api: Api) =>
  defineTool({
    name: "retry_film",
    description:
      "Retry a STOPPED Auto Film from the step that stopped it — the same as the \"Retry from <step>\" button on its story page. Every earlier step's output and spend is kept (the World, sheets and clips are NOT paid for again), the Film's Series is repaired first, and the job runs on server-side from the failed step. The Worker finds the Film's own project from its id. Only for the latest Film in that project, only when get_film says \"stopped\", and only on the author's ask. It REFUSES (never queues) when another of the author's Films is being made, when a newer Film has run since, or when Auto is paused / the allowance is used up — relay `message` and do not retry again. A stopped Film never counted against the allowance, and a retried one that finishes counts once. After a retry, tell the author which step it resumed at and END THE TURN; do not poll get_film.",
    input: v.object({
      filmId: d(v.string(), "The stopped Film's id, from get_film (`job.id`) or make_film (`filmId`)."),
    }),
    async run({ data: input, signal }): Promise<{ output: Json }> {
      const id = encodeURIComponent(String(input.filmId));
      try {
        const res = (await api.post(`/api/auto/films/${id}/retry`, {}, signal)) as {
          job?: Job; repaired?: { fixes?: string[] } | null;
        };
        const resumed = res.job?.steps?.at(-1);
        return {
          output: {
            ok: true,
            resumedAt: resumed ? { key: resumed.key ?? null, label: resumed.label ?? null } : null,
            repaired: (res.repaired?.fixes ?? []) as Json,
            job: viewJob(res.job),
            next: "Retrying server-side from the failed step. Tell the author, and end the turn.",
          },
        };
      } catch (err) {
        const body = (err as { body?: { code?: string; message?: string; job?: Job } }).body;
        if (body?.code) {
          return { output: { ok: false, code: body.code, message: body.message ?? null, job: viewJob(body.job) } };
        }
        throw err;
      }
    },
  });

export const confirmFilm = (api: Api) => answerTool(api, "confirm");
export const declineFilm = (api: Api) => answerTool(api, "decline");

export const getAutoStatus = (api: Api) =>
  defineTool({
    name: "get_auto_status",
    description:
      "Can an Auto Film start right now, and for whom: `available` (+ `reason` when not — paused by the creators or missing a server key; key presence only, never a value), the author's monthly Film `allowance` (limit, used, remaining, resetsAt), and their Auto toggle (`auto: true` = nothing asks; false = the job stops once after the World for a confirm card). Read it before make_film when the allowance or availability is in doubt, and when the author asks how many Films they have left.",
    input: v.object({}),
    async run({ signal }) {
      const [status, allowance, settings] = await Promise.all([
        api.get("/api/auto/status", signal) as Promise<Record<string, Json>>,
        api.get("/api/auto/allowance", signal) as Promise<Record<string, Json>>,
        api.get("/api/auto/settings", signal) as Promise<Record<string, Json>>,
      ]);
      return {
        output: {
          available: status?.ok === true,
          reason: status?.reason ?? null,
          paused: status?.paused ?? false,
          allowance,
          auto: settings?.auto !== false,
        },
      };
    },
  });

export const setAuto = (api: Api) =>
  defineTool({
    name: "set_auto",
    description:
      "Flip the author's Auto toggle — the switch beside the Auto prompt box. ON (default): a Film runs start to finish without asking. OFF: it stops once after the World, before anything is paid for, and waits on a confirm card. Per USER, not per project, and it applies to Films started AFTER the change. Only when the author asks for it.",
    input: v.object({
      auto: d(v.boolean(), "true = never ask; false = ask once after the World."),
    }),
    async run({ data: input, signal }) {
      return { output: await api.req("/api/auto/settings", "PUT", { auto: Boolean(input.auto) }, signal) };
    },
  });
