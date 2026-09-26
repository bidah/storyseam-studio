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
import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api, Json } from "../lib/api.js";

type Step = {
  key?: string; label?: string; status?: string; summary?: string | null;
  error?: string | null; pending?: boolean;
};
type Job = {
  id?: string; prompt?: string; status?: string; error?: string | null; auto?: boolean;
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
      return "Stopped on our side. Everything already made is kept, and a stopped Film does not count against the allowance. Say which stage stopped and why.";
    case "declined":
      return "The author declined at the confirm card. Nothing after the World was made or paid for.";
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
      `Start an Auto Film from a prompt — the same job the Auto surface's prompt box starts ("make me a two-minute mecha short"). ${PIPELINE} It returns at once: the job id, or \`queued: true\` with a \`position\` when a Film is already being made on this project, or \`started: false\` with the refusal's message (empty/too-long prompt, the project is busy, the monthly Film allowance is used up, Auto is paused/unavailable) — relay a refusal in plain words and start nothing else. After a start, navigate to "auto" so the author watches the cards there, tell them the Film is being made and roughly how long it takes, and END THE TURN. Do NOT poll get_film in a loop; check back with get_film only when the author asks. Never say a Film is done unless get_film reports status "done". Check get_auto_status first when you don't know the allowance.`,
    input: v.object({
      prompt: d(
        v.string(),
        "The author's idea in their own words — what the Film is about. Pass it through; do not expand it into a script (the job derives the Idea and the World itself). Max 4000 characters.",
      ),
      length: v.optional(
        d(
          v.string(),
          'Optional length the author asked for, e.g. "3:00" or "three minutes". A Film is 2:00–4:30 in 30s steps: no length means 2:00, a stated one rounds UP, longer is capped at 4:30. Omit when the prompt already says it.',
        ),
      ),
    }),
    async run({ data: input, signal }): Promise<{ output: Json }> {
      const idea = String(input.prompt ?? "").trim();
      const length = String(input.length ?? "").trim();
      // PREPENDED, not appended: the job reads the FIRST length a prompt
      // states (film-plan.ts parseLength), so an explicit length has to come
      // before any the author's wording happens to contain to actually win.
      const prompt = length ? `Length: ${length}. ${idea}` : idea;
      try {
        const res = (await api.post("/api/auto/films", { prompt }, signal)) as {
          job?: Job; queued?: boolean; position?: number; film?: Job;
        };
        if (res.queued) {
          return {
            output: {
              started: false,
              queued: true,
              position: res.position ?? null,
              filmId: (res.film as Job | undefined)?.id ?? null,
              running: viewJob(res.job),
              next: `Queued behind the Film already being made on this project (position ${res.position ?? "?"}). It starts on its own when that one ends. Tell the author; do not start it again.`,
            },
          };
        }
        return {
          output: {
            started: true,
            filmId: res.job?.id ?? null,
            job: viewJob(res.job),
            next: 'Started. navigate to "auto", tell the author the Film is being made there (20–40 minutes), and end the turn.',
          },
        };
      } catch (err) {
        const body = (err as { body?: { refusal?: { code?: string; message?: string }; job?: Job } }).body;
        if (body?.refusal) {
          return {
            output: {
              started: false,
              refused: true,
              code: body.refusal.code ?? null,
              message: body.refusal.message ?? null,
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
      `The project's current Auto Film: its status (running | awaiting-confirm | done | stopped | declined | refused), every stage that has started with its state and one-line summary, what it has cost so far, the Films queued behind it — and, ONLY when status is "done", the Film itself (\`film.url\`, seconds, title). ${PIPELINE} Call it when the author asks how their Film is going, not on a timer: never call it twice in one turn to wait for progress. A running job is not a done one — never tell the author a Film is ready unless this says "done". A "stopped" job names the stage and reason and keeps everything made so far; say so.`,
    input: v.object({}),
    async run({ signal }) {
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
