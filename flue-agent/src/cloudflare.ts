// Worker-level Cloudflare code, merged into the generated entry by @flue/vite
// (every named export here is re-exported from the Worker). HTTP stays in
// app.ts; this file holds what is not an agent: the Deep Film's writers' room
// workflow.
//
// WritersRoomWorkflow — flue's "durable workflow" pattern
// (node_modules/@flue/cli/docs/guide/workflows.md): a Cloudflare Workflow in
// the same Worker as the agents, driving them through init() handles, one
// checkpointed step per unit of work. The main worker's Film job starts it
// (POST /rooms/:instanceId, app.ts) and then only reads the room doc it keeps.
//
// For each ROUND (the roster's stages in order — outline, draft, polish, lock):
//   1. every specialist of the round reads the pinned draft SIDE BY SIDE, each
//      as its own WritersRoom agent instance on the Film's writer (`model`). A pass is two
//      steps: `dispatch` (checkpoints the receipt the moment it exists) and
//      `read` (awaits the settled reply and reports it to the worker). A
//      restart between them re-attaches with the same receipt rather than
//      prompting again; a pass whose run FAILED is dispatched once more.
//   2. the screenwriter applies the round's notes as a new pinned draft — a
//      worker route (…/room/rewrite), because the Film's budget and the
//      author's locked lines are worker code. The next round reads THAT draft.
// Then …/room/finish. What already happened (a retried Film, a new instance
// after a failure) is read first and skipped, so no pass is paid for twice.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { init } from "@flue/runtime";
import { WritersRoom, type RoomPassData } from "./agents/writers-room.js";
import { createApi, type Api } from "./lib/api.js";
import { ROOM_MODEL, roomModel } from "./lib/models.js";

export type RoomRound = { round: number; stage: string; specialists: string[] };
export type RoomParams = {
  filmId: string;
  projectId: string;
  userId: string;
  episodeId?: string | null;
  rounds: RoomRound[];
  /** The Film's constraints, written by the worker (length, budget, language, the author's lines). */
  brief: string;
  /** The Film's writer as a flue specifier — the passes read on it (lib/models.ts roomModel). */
  model?: string | null;
};

type RoomDoc = {
  passes?: Record<string, { round?: number; report?: string }>;
  rewrites?: Record<string, unknown>;
} | null;

// A pass has ONE retry budget, and it is flue's: WritersRoom.durability
// (3 attempts, a 15-minute deadline — agents/writers-room.ts). The workflow
// dispatches a pass once and waits for it to settle; it used to add its own
// layers on top (a 25-minute read × 3 tries × 2 dispatches, over flue's
// default 10 attempts / 1 hour), which let one silent pass hold a Film for
// hours. READ_TIMEOUT is the deadline plus flue's grace for settling a hung
// attempt; the read's own retry only RE-ATTACHES to the same submission after
// the workflow itself was interrupted (a deploy) — it never re-runs the pass.
const READ_TIMEOUT = "18 minutes" as const;
const REWRITE_TIMEOUT = "15 minutes" as const;

/** The pass's final message → its full notes, plus the JSON block filed beneath them. */
export function parsePassReply(text: string): { report: string; summary: string; findings: unknown[] } {
  const body = String(text || "").trim();
  const fences = [...body.matchAll(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/g)];
  const candidates = fences.length ? [fences[fences.length - 1]] : [];
  for (const m of candidates) {
    try {
      const parsed = JSON.parse(m[1]);
      const report = body.slice(0, m.index).trim() || body;
      return {
        report,
        summary: typeof parsed?.summary === "string" ? parsed.summary : "",
        findings: Array.isArray(parsed?.findings) ? parsed.findings : [],
      };
    } catch {
      /* fall through: the whole reply is the report */
    }
  }
  const firstLine = body.split("\n").find((l) => l.trim()) || "";
  return { report: body, summary: firstLine.replace(/^#+\s*/, "").slice(0, 200), findings: [] };
}

/**
 * What actually stopped a pass, in words the Film card can show. flue's
 * AgentRunError says only "Agent run failed (submission …)"; the provider's
 * refusal is on its `cause`. The two Claude refusals worth naming come from AI
 * Gateway's Unified Billing: 2021 (the credits are spent — no retry helps)
 * and 2018 (its rate limit — a later retry does).
 */
export function describeRoomError(err: unknown): { message: string; fatal: boolean } {
  const parts: string[] = [];
  let e: unknown = err;
  for (let i = 0; e && i < 5; i++) {
    const msg = e instanceof Error ? e.message : typeof e === "string" ? e : (() => { try { return JSON.stringify(e); } catch { return String(e); } })();
    if (msg) parts.push(msg);
    e = (e as { cause?: unknown })?.cause;
  }
  const text = parts.join(" — ");
  if (/Insufficient balance|"code":\s*2021|Insufficient AI Gateway credits/i.test(text)) {
    return { fatal: true, message: "Claude's AI Gateway credits are used up (Cloudflare 402, code 2021). Top up the gateway's Unified Billing credits, then retry the Film — the passes already read are kept." };
  }
  if (/Wholesale rate limit|"code":\s*2018/i.test(text)) {
    return { fatal: false, message: "Claude's AI Gateway rate limit refused the pass (Cloudflare 429, code 2018)." };
  }
  return { fatal: false, message: (parts[parts.length - 1] || parts[0] || "The pass failed").slice(0, 400) };
}

/**
 * flue's AgentRunError does not carry the provider's refusal, so a failed pass
 * can't say WHY on its own. Ask Claude directly — one token, through the same
 * binding and gateway — and name what comes back (a spent balance, a rate
 * limit); null when Claude answers fine, and the failure was something else.
 */
async function probeClaude(env: Record<string, unknown>): Promise<{ message: string; fatal: boolean } | null> {
  const ai = env.AI as { run(model: string, input: unknown, opts: unknown): Promise<unknown> } | undefined;
  if (!ai?.run) return null;
  try {
    await ai.run(
      String(ROOM_MODEL).replace(/^cloudflare\//, ""),
      { max_tokens: 1, messages: [{ role: "user", content: "ok" }] },
      { gateway: { id: (env.CLAUDE_GATEWAY_ID as string) || "auto-look" } },
    );
    return null;
  } catch (err) {
    const why = describeRoomError(err);
    return why.fatal || /2018/.test(why.message) ? why : null;
  }
}

function passMessage(p: RoomParams, round: RoomRound, specialist: string): string {
  return [
    `Writers' room — round ${round.round} of ${p.rounds.length} (the ${round.stage} round).`,
    `Read the Film's pinned draft with get_script and give your pass on it.`,
    "",
    "THE FILM'S CONSTRAINTS:",
    p.brief,
    "",
    round.specialists.length > 1
      ? `Reading this round beside you: ${round.specialists.filter((s) => s !== specialist).join(", ")}. Stay in your own lane.`
      : "You are the only reader this round.",
  ].join("\n");
}

export class WritersRoomWorkflow extends WorkflowEntrypoint<Record<string, unknown>, RoomParams> {
  async run(event: WorkflowEvent<RoomParams>, step: WorkflowStep) {
    const p = event.payload;
    const api: Api = createApi(p.projectId, p.userId, `room-${p.filmId}`, p.episodeId ?? null);
    const base = `/api/auto/films/${encodeURIComponent(p.filmId)}/room`;

    try {
      const before = await step.do("what the room already has", async () => {
        const { room } = (await api.get(base)) as unknown as { room: RoomDoc };
        const passes = Object.entries(room?.passes || {})
          .filter(([, pass]) => typeof pass?.report === "string")
          .map(([id, pass]) => `${pass.round ?? 0}:${id}`);
        return { passes, rewrites: Object.keys(room?.rewrites || {}) };
      });

      for (const round of p.rounds) {
        if (before.rewrites.includes(String(round.round))) continue;
        const todo = round.specialists.filter((id) => !before.passes.includes(`${round.round}:${id}`));

        const results = await Promise.all(
          todo.map(async (specialist): Promise<{ specialist: string; ok: boolean }> => {
            // A fresh agent id per room instance: a new instance (a Film
            // retried after a failure) must not queue behind a submission an
            // earlier instance left running on the same conversation.
            // (A room's first instance keeps the bare id it always had, so a
            // room running across the deploy that introduced this re-attaches.)
            const n = Number(event.instanceId.split("-").pop()) || 1;
            const agentId = `room-${p.filmId}-r${round.round}-${specialist}${n > 1 ? `-${n}` : ""}`;
            const initialData: RoomPassData = {
              projectId: p.projectId, userId: p.userId, filmId: p.filmId,
              specialist, round: round.round, stage: round.stage, episodeId: p.episodeId ?? null,
              model: roomModel(p.model),
            };
            const receipt = await step.do(`dispatch r${round.round} ${specialist}`, async () => {
              const r = await init(WritersRoom, { id: agentId }).dispatch({
                message: passMessage(p, round, specialist),
                initialData,
              });
              return { submissionId: r.submissionId, acceptedAt: r.acceptedAt, uid: r.uid };
            });
            try {
              await step.do(
                `read r${round.round} ${specialist}`,
                { retries: { limit: 1, delay: "10 seconds", backoff: "constant" }, timeout: READ_TIMEOUT },
                async () => {
                  const reply = await init(WritersRoom, { id: agentId }).read(receipt);
                  const pass = parsePassReply(reply.text);
                  if (!pass.report) throw new Error(`${specialist} came back with nothing`);
                  await api.post(`${base}/pass`, { round: round.round, specialist, ...pass });
                  return { specialist, summary: pass.summary, findings: pass.findings.length };
                },
              );
              return { specialist, ok: true };
            } catch (err) {
              let why = describeRoomError(err);
              // Only a Claude pass is worth probing Claude for.
              if (!why.fatal && roomModel(p.model) === ROOM_MODEL) why = (await probeClaude(this.env as Record<string, unknown>)) ?? why;
              console.warn("[room] pass failed", { filmId: p.filmId, specialist, error: why.message });
              // Spent credits stop the room: every other pass is refused the same way.
              if (why.fatal) throw new Error(`${specialist}: ${why.message}`);
              // Anything else skips this one specialist and the room goes on.
              await step.do(`skip r${round.round} ${specialist}`, () =>
                api.post(`${base}/pass`, { round: round.round, specialist, skipped: true, error: why.message }).then(() => ({ ok: true })),
              );
              return { specialist, ok: false };
            }
          }),
        );

        // A round nobody finished has no notes to apply: its draft stands, and
        // the next round reads it. (Passes already on file count as finished.)
        const reported = round.specialists.length - todo.length + results.filter((r) => r.ok).length;
        if (!reported) continue;

        await step.do(
          `rewrite r${round.round}`,
          { retries: { limit: 2, delay: "30 seconds", backoff: "constant" }, timeout: REWRITE_TIMEOUT },
          async () => {
            const { rewrite } = (await api.post(`${base}/rewrite`, { round: round.round })) as {
              rewrite?: { draftName?: string; changes?: string[] };
            };
            return { draftName: rewrite?.draftName ?? null, changes: rewrite?.changes?.length ?? 0 };
          },
        );
      }

      await step.do("finish", () => api.post(`${base}/finish`, { status: "done" }).then(() => ({ ok: true })));
      return { ok: true };
    } catch (err) {
      const error = describeRoomError(err).message.slice(0, 500);
      await step.do("report the failure", () =>
        api.post(`${base}/finish`, { status: "failed", error }).then(() => ({ ok: false })),
      );
      throw err;
    }
  }
}

// ── FilmScriptWorkflow — every Film's Script stage ───────────────────────────
//
// The screenplay in passes (worker/src/lib/film-stages/script-flow.js):
// outline → draft → revise, and a second revision only when the first says a
// measured problem survived it. Each pass is a worker route
// (…/script/pass) — the model call runs THERE, on the Film's own writer, since
// the budget, the World and the author's lines are worker code — and each is a
// checkpointed step here, so a deploy of either worker mid-pass retries that
// pass instead of stranding the Film. Passes already on file are skipped.
export type ScriptParams = { filmId: string; projectId: string; userId: string; episodeId?: string | null };

type ScriptDoc = { passes?: Record<string, { again?: boolean }> } | null;

// A Claude draft of a five-minute film is minutes; the fast writer, seconds.
const SCRIPT_PASS_TIMEOUT = "15 minutes" as const;

export class FilmScriptWorkflow extends WorkflowEntrypoint<Record<string, unknown>, ScriptParams> {
  async run(event: WorkflowEvent<ScriptParams>, step: WorkflowStep) {
    const p = event.payload;
    const api: Api = createApi(p.projectId, p.userId, `script-${p.filmId}`, p.episodeId ?? null);
    const base = `/api/auto/films/${encodeURIComponent(p.filmId)}/script`;
    const pass = (name: string) =>
      step.do(
        `pass ${name}`,
        { retries: { limit: 2, delay: "20 seconds", backoff: "constant" }, timeout: SCRIPT_PASS_TIMEOUT },
        async () => {
          const { pass: entry } = (await api.post(`${base}/pass`, { pass: name })) as { pass?: { again?: boolean; draftName?: string } };
          return { again: !!entry?.again, draftName: entry?.draftName ?? null };
        },
      );

    try {
      const before = await step.do("what the script already has", async () => {
        const { script } = (await api.get(base)) as unknown as { script: ScriptDoc };
        return { passes: Object.keys(script?.passes || {}), again: !!script?.passes?.["revise-1"]?.again };
      });
      let again = before.again;
      for (const name of ["outline", "draft", "revise-1"]) {
        if (before.passes.includes(name)) continue;
        const out = await pass(name);
        if (name === "revise-1") again = out.again;
      }
      if (again && !before.passes.includes("revise-2")) await pass("revise-2");

      await step.do("finish", () => api.post(`${base}/finish`, { status: "done" }).then(() => ({ ok: true })));
      return { ok: true };
    } catch (err) {
      const error = describeRoomError(err).message.slice(0, 500);
      await step.do("report the failure", () =>
        api.post(`${base}/finish`, { status: "failed", error }).then(() => ({ ok: false })),
      );
      throw err;
    }
  }
}
