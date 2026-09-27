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
import {
  AUDITION_SECONDS, DEFAULT_DEEP_SPECIALISTS, DEFAULT_FILM_RESOLUTION, DEFAULT_FILM_VOICES, FILM_DEPTHS, FILM_ENGINES, FILM_RESOLUTIONS, FILM_STEPS, FILM_STYLES, FILM_VOICES, FILM_WRITERS, ROOM_PASS_SECONDS, ROOM_REWRITE_SECONDS,
  STORY_FLOW_STEPS, filmLength, formatLength, isStoryEngine, storyFlowLength,
} from "../lib/film-plan.js";
import { SPECIALIST_IDS } from "../lib/specialists.js";

type Step = {
  key?: string; label?: string; status?: string; summary?: string | null;
  error?: string | null; pending?: boolean;
};
type Job = {
  id?: string; prompt?: string; seconds?: number; engine?: string; voices?: string; status?: string; error?: string | null; auto?: boolean;
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
    engine: job.engine || "director",
    ...(job.voices ? { voices: job.voices } : {}),
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
          `Optional length the author asked for, IN SECONDS (three minutes → 180, "3:10" → 190). A Director Film is 2:00–5:00 in 30s steps (${FILM_STEPS.join(", ")}): no length means 2:00. A story-flow Film (engine "seedance" or "h3") can also be ONE MINUTE (${STORY_FLOW_STEPS.join(", ")}): no length means 1:00. Anything else rounds UP to the next step, longer is capped at 5:00 (the result says \`capped\` — tell the author). It wins over any length in the prompt — the same as the length setting on the Auto surface's input.`,
        ),
      ),
      style: v.optional(
        d(
          v.picklist(FILM_STYLES.map((st) => st.id) as [string, ...string[]]),
          `Optional LOOK: ${FILM_STYLES.map((st) => `"${st.id}" (${st.label})`).join(", ")} — the same choice as the Look setting on the Auto surface's input. Pass it only when the author names a look; omitted, the Worker reads it off the prompt ("a pixar like story" → pixar), else 80s anime.`,
        ),
      ),
      writer: v.optional(
        d(
          v.picklist(FILM_WRITERS.map((w) => w.id) as [string, ...string[]]),
          `Optional WRITING MODEL — the LLM that writes every text step of the Film (Idea, World, the Script's passes, a Deep Film's writers' room, sheet prompts, Shot list, cue sheet, music cues): ${FILM_WRITERS.map((w) => `"${w.id}" (${w.label} — ${w.blurb})`).join(", ")}. The same choice as the model picker on the Auto surface's input. Pass "claude" only when the author asks for Claude / Fable / a stronger writer; omitted is "default".`,
        ),
      ),
      depth: v.optional(
        d(
          v.picklist(FILM_DEPTHS.map((x) => x.id) as [string, ...string[]]),
          `Optional DEPTH of the story work — the Writer button on the Auto surface's input: ${FILM_DEPTHS.map((x) => `"${x.id}" (${x.label} — ${x.blurb})`).join(", ")}. Every Film is written from a screenplay (the Script stage, saved on the Film project's Script tab); "deep" adds the writers' room after it — the chosen specialists read the draft and it is rewritten on their notes, a few minutes more. Pass "deep" only when the author asks for a deeper / better / reviewed story or names the specialists; omitted is "fast".`,
        ),
      ),
      specialists: v.optional(
        d(
          v.array(v.picklist(SPECIALIST_IDS as [string, ...string[]])),
          `With depth "deep": which specialists read the script, by id (${SPECIALIST_IDS.join(", ")}). Omitted, the default room reads it: ${DEFAULT_DEEP_SPECIALISTS.join(", ")}. The room runs on the Film's writer (the "writer" above) in rounds by roster stage (outline → draft → polish → lock): a round's passes read side by side (about ${ROOM_PASS_SECONDS}s), then one rewrite (about ${ROOM_REWRITE_SECONDS}s) — quote roomEstimate-style time when the author asks.`,
        ),
      ),
      resolution: v.optional(
        d(
          v.picklist(FILM_RESOLUTIONS as unknown as [string, ...string[]]),
          `Optional: what the video renders at, ${FILM_RESOLUTIONS.join(" or ")} — the same choice as the Resolution setting on the prompt box. Both engines take it. Omit for ${DEFAULT_FILM_RESOLUTION} (the default, and the cheapest). Pass "720p" only when the author asks for 720p, HD or higher quality; on Seedance it costs about 2.25× as much per second.`,
        ),
      ),
      engine: v.optional(
        d(
          v.picklist(FILM_ENGINES as unknown as [string, ...string[]]),
          'Optional PIPELINE — the same choice as the Gen mode on the prompt box at /. "director" (default): the live Director — a cue sheet pinned with a drawn frame every ~4s, played as one sitting, then scored. "seedance": the STORY FLOW on Seedance 2.5 — character sheets (turnaround + face) and empty location plates, a shot list of segments of up to 30s (one Seedance 2.5 take each; the screenplay is written one scene per take) as staged narrative, each segment rendered as an extension of a cut of the previous one, then one final cut and the score; Seedance writes the dialogue and effects, and a story can be one minute (the cheap way to test one). "h3": the same story flow on MiniMax H3 (fal\'s minimax/h3/reference-to-video) — segments of at most 15s (H3\'s own ceiling), the sheets go in as Image 1, Image 2 …, each segment after the first continues a cut of the previous one handed over as Video 1, then the final cut and the score. Pass "seedance" when the author asks for Seedance or the story flow, "h3" when they ask for MiniMax, Hailuo or H3; either for a quick one-minute test.',
        ),
      ),
      voices: v.optional(
        d(
          v.picklist(FILM_VOICES.map((x) => x.id) as [string, ...string[]]),
          `Optional VOICES pass — story engines ("seedance", "h3") ONLY; the Director cannot take a voice reference and ignores it. A story engine writes the sound itself and gives a character a different voice in every segment, so after the sheets the job AUDITIONS every character once — the same lines, read in their own voice as the World describes it, as a clean voice-only recording — files the take as an mp3, and every later segment they speak in binds it as their voice reference (Seedance @Audio1, H3 Audio 1). How the audition is made, all on fal: ${FILM_VOICES.map((x) => `"${x.id}" (${x.label} — ${x.blurb})`).join(", ")}. "video" is a ${AUDITION_SECONDS}s generation per character on the Film's own model — the voice that model gives that face, so it persists best, and it costs the most. The same choice as the Voices setting on the prompt box's gear. Omitted on a story engine, "${DEFAULT_FILM_VOICES}" is sent; pass "seedaudio" or "elevenlabs" when the author names them or asks for a cheaper voice pass.`,
        ),
      ),
      score: v.optional(
        d(
          v.boolean(),
          "Optional: whether the Film ends with the Score stage — one continuous music cue written to the finished film and laid under it. Every engine is scored by default (the video models are told NO MUSIC so the score never fights baked-in music); the same switch as Score on the prompt box's settings. Pass false only when the author asks for no music / no score.",
        ),
      ),
    }),
    async run({ data: input, signal }): Promise<{ output: Json }> {
      const prompt = String(input.prompt ?? "").trim();
      const seedance = isStoryEngine(input.engine);
      // `d()` types the list as unknown; the picklist already refused anything but ids.
      const room = Array.isArray(input.specialists) ? (input.specialists as string[]) : [];
      // The same `seconds` the surface's length gear sends: one of the steps,
      // so a spoken "three minutes and ten" is rounded here, not refused there.
      const asked = typeof input.seconds === "number" && Number.isFinite(input.seconds) && input.seconds > 0
        ? input.seconds
        : null;
      const chosen = asked == null ? null : seedance ? storyFlowLength(asked) : filmLength(asked);
      const lengthNote = chosen
        ? { seconds: chosen.seconds, length: formatLength(chosen.seconds), ...(chosen.capped ? { capped: true } : {}) }
        : {};
      try {
        const res = (await api.post(
          "/api/auto/films",
          {
            prompt,
            ...(chosen ? { seconds: chosen.seconds } : {}),
            ...(input.style ? { style: input.style } : {}),
            ...(input.engine && input.engine !== "director" ? { engine: input.engine } : {}),
            ...(input.writer && input.writer !== "default" ? { writer: input.writer } : {}),
            ...(input.resolution && input.resolution !== DEFAULT_FILM_RESOLUTION ? { resolution: input.resolution } : {}),
            ...(input.score === false ? { score: false } : {}),
            // The Voices pass rides only with a story engine, defaulting as the GUI does.
            ...(seedance ? { voices: input.voices || DEFAULT_FILM_VOICES } : {}),
            ...(input.depth === "deep" ? { depth: "deep", ...(room.length ? { specialists: room } : {}) } : {}),
          },
          signal,
        )) as { job?: Job; projectId?: string };
        const filmId = res.job?.id ?? null;
        return {
          output: {
            started: true,
            filmId,
            projectId: res.projectId ?? null,
            ...(filmId ? { page: `/create/${encodeURIComponent(filmId)}` } : {}),
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
          "Optional: read ONE Film by its id (make_film's `filmId`, or the id in a /create/<id> link, or an older /director-story/create/<id> or /story-flow/create/<id> one) instead of the latest — any of the author's Films, running or finished/stopped, whichever project it is in. Omit for the latest Film.",
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

// The public link to a finished Film (worker/src/lib/film-share.js) — the same
// as the Share button under the Film on its story page.
const PUBLIC_ORIGIN = "https://storyseam.app";

export const shareFilm = (api: Api) =>
  defineTool({
    name: "share_film",
    description:
      "Get a PUBLIC link to a FINISHED Film — the same as the Share button under the video on its story page. Anyone with the link can watch AND download the Film at /watch/<token> without an account. Calling it again returns the SAME link (it is not re-minted). `stop: true` revokes the link: every copy of it stops working at once (404) — do that only when the author asks to stop sharing. Only for a Film get_film reports as `done` (otherwise `code: not-done`). Give the author the `url` as-is.",
    input: v.object({
      filmId: d(v.string(), "The Film's id — make_film's `filmId`, get_film's `job.id`, or list_films' `filmId`."),
      stop: v.optional(d(v.boolean(), "true = revoke the share link instead of getting it.")),
    }),
    async run({ data: input, signal }): Promise<{ output: Json }> {
      const path = `/api/auto/films/${encodeURIComponent(String(input.filmId))}/share`;
      try {
        const res = (input.stop ? await api.req(path, "DELETE", undefined, signal) : await api.post(path, {}, signal)) as {
          shared?: boolean; path?: string | null;
        };
        return {
          output: {
            ok: true,
            shared: !!res.shared,
            url: res.path ? `${PUBLIC_ORIGIN}${res.path}` : null,
            ...(input.stop ? { next: "The link is revoked. Tell the author it no longer works." } : {}),
          },
        };
      } catch (err) {
        const body = (err as { body?: { code?: string; error?: string } }).body;
        if (body?.code) return { output: { ok: false, code: body.code, message: body.error ?? null } };
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

export const listFilms = (api: Api) =>
  defineTool({
    name: "list_films",
    description:
      "The author's Auto Films, newest first — the \"Latest stories\" list under the prompt box at /. Each row: filmId, projectId (every Film has a project of its own), title, prompt, status (running | awaiting-confirm | done | stopped | declined | refused | unknown), seconds, and the finished film's `url` when done. Use it when the author asks what stories they have made, or to find one by name before get_film / retry_film. Read-only.",
    input: v.object({
      limit: v.optional(d(v.number(), "How many to list, newest first (default 30, at most 100).")),
    }),
    async run({ data: input, signal }): Promise<{ output: Json }> {
      const limit = Math.max(1, Math.min(100, Math.round(Number(input?.limit) || 30)));
      const path = "/api/auto/films/mine";
      return { output: (await api.get(`${path}?limit=${limit}`, signal)) as Json };
    },
  });
