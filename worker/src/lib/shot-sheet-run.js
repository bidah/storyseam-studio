// A shot sheet RUN on the Worker — the half of `routes/shot-sheet.js` that is
// not HTTP, shared with the Auto job's "Shot sheet run" stage
// (lib/film-stages/run.js) so the render button and the job plan, seam,
// submit and finalize through the same code.
//
// A run plans the REELS first and draws one clip per reel (ADR 0002): the plan
// comes from the Reel planner (`planSheets` in lib/shot-sheet.ts), the seams go
// on the Series BEFORE fal is paid, each clip is submitted to fal's queue and
// filed in the `director-sheets` ledger as a `running` take, and a take is
// finalized (bytes into R2, filed as a style model sheet) the first time a poll
// finds it COMPLETED. Nothing here waits: a clip takes minutes.
import { absolutizeSeries, updateSeries, updateSheets } from "./director.js";
import { putMedia } from "./media.js";
import { endpointFor, planSheets, renderBody, slotsOf, validateSheet, withSeams } from "./shot-sheet.ts";
import { seriesInput } from "./series.ts";
import { falAuthorization } from "../routes/stage.js";

export const FAL_QUEUE = "https://queue.fal.run";

const nowIso = () => new Date().toISOString();

/** A ledger row with its playable url. */
export const takeWithUrl = (row) => ({ ...row, url: row.file ? `/director-media/${row.file}` : null });

/**
 * The run a request amounts to: `{ plan, sheets }`.
 *
 * `slots` names which offsets to draw; omitted, every slot the cue sheet offers
 * that is not already refused. The duration is the author's — it is the one
 * number that trades "how many pins fit" against "how long each is held".
 */
export function buildRun(env, pid, series, body = {}) {
  const resolved = absolutizeSeries(env, pid, series);
  const chosen = Array.isArray(body.slots) && body.slots.length
    ? body.slots.map(Number)
    : slotsOf(resolved).filter((s) => !s.refused).map((s) => s.offset);
  const duration = Number.isInteger(body.duration) ? body.duration : undefined;
  const run = planSheets(resolved, chosen, duration);
  if (Number.isInteger(body.seed)) for (const sheet of run.sheets) sheet.seed = body.seed;
  return run;
}

/** The plan as a caller reads it: which beats each reel covers, not its shot text. */
export function planView(plan) {
  return {
    reels: plan.reels.map((reel) => ({
      reel: reel.reel,
      opensAt: reel.opensAt,
      frames: reel.shots.length,
      offsets: reel.shots.map((shot) => shot.offset),
    })),
    seams: plan.seams,
    skipped: plan.skipped,
    clips: plan.clips.length,
    refused: plan.refused,
  };
}

/** What the Director's own Series validation says, as a list of messages. */
export function issuesOf(series) {
  const check = seriesInput.safeParse(series);
  return check.success ? [] : check.error.issues.map((issue) => issue.message);
}

/**
 * The plan's refusal first, then every clip's, named by reel when there is more
 * than one. A reason every clip shares (an empty premise) is said once.
 */
export function runErrors(plan, sheets) {
  const seen = new Set();
  const out = plan.refused ? [{ message: plan.refused }] : [];
  sheets.forEach((sheet, index) => {
    for (const error of validateSheet(sheet)) {
      const message = sheets.length > 1 && error.shot !== undefined
        ? `Reel ${index + 1}: ${error.message}`
        : error.message;
      if (seen.has(message)) continue;
      seen.add(message);
      out.push({ ...error, message, ...(sheets.length > 1 ? { part: index + 1 } : {}) });
    }
  });
  return out;
}

/**
 * Write the plan's seams as the Series' `reelChanges` — re-planned from
 * scratch, so a render always leaves `reelChanges` matching the clips it drew.
 * A pin left inside a new seam's window is cleared. If the seams would make the
 * Series refuse something it did not refuse already, nothing is written.
 *
 * → `{ cleared }` | `{ missing: true }` | `{ introduced: [message] }`
 */
export async function writeSeams(env, pid, seriesId, plan) {
  const res = await updateSeries(env, pid, seriesId, (row) => {
    if (!row?.id) return { abort: true, missing: true };
    const { reelChanges, directions, cleared } = withSeams(row, plan.seams);
    const candidate = { ...row, reelChanges, directions };
    const before = issuesOf(row);
    const introduced = issuesOf(candidate).filter((message) => !before.includes(message));
    if (introduced.length) return { abort: true, introduced };
    Object.assign(row, candidate, { updatedAt: nowIso() });
    return { cleared };
  });
  if (res.missing) return { missing: true };
  if (res.introduced) return { introduced: res.introduced };
  return { cleared: res.cleared || [] };
}

/**
 * Submit clips of a run to fal's queue and file every queued one as a
 * `running` take. Stops at the first clip fal refuses.
 *
 * `parts` (1-based) limits which clips go — a resumed run submits only the
 * ones it is missing; omitted, all of them. `extra` rides on every take (the
 * Auto job's `filmId`).
 *
 * → `{ takes, failed }` — `failed` is the refusal, named by clip when the run
 *   has more than one, or null. The takes already queued are filed even when a
 *   later clip was refused: they are being paid for.
 */
export async function submitClips(env, pid, { seriesId, plan, sheets, key, runId, parts, extra = {} }, fetchFn = fetch) {
  const takes = [];
  let failed = null;
  for (const [index, sheet] of sheets.entries()) {
    const part = index + 1;
    if (parts && !parts.includes(part)) continue;
    const endpoint = endpointFor(sheet);
    const submitted = await fetchFn(`${FAL_QUEUE}/${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: falAuthorization(key) },
      body: JSON.stringify(renderBody(sheet)),
    });
    const queued = await submitted.json().catch(() => null);
    if (!submitted.ok || !queued?.request_id) {
      const reason = queued?.detail || `fal refused the sheet (${submitted.status})`;
      const text = typeof reason === "string" ? reason : JSON.stringify(reason);
      failed = sheets.length > 1 ? `Clip ${part} of ${sheets.length}: ${text}` : text;
      break;
    }
    takes.push({
      id: queued.request_id,
      seriesId,
      runId,
      part,
      // One clip per reel: part N draws reel N, which opens on this beat.
      opensAt: plan.reels[index].opensAt,
      parts: sheets.length,
      status: "running",
      endpoint,
      // The WHOLE sheet, kept verbatim. A take whose prompt was lost is a look
      // that cannot be redrawn, and the grab times are only meaningful beside
      // the shot list they were derived from.
      sheet,
      startedAt: nowIso(),
      file: null,
      error: null,
      ...extra,
    });
  }
  if (takes.length) {
    await updateSheets(env, pid, (db) => {
      db.seq = (db.seq || 0) + 1;
      db.takes = [...takes, ...(db.takes || [])];
      return {};
    });
  }
  return { takes, failed };
}

/**
 * Ask the queue once, and file the take if it is done.
 *
 * Returns the ledger row as it now stands. Filed as a STYLE model sheet on the
 * Series as well as in the ledger, because that is what it is: one pass of the
 * whole look, with the prompt that made it — so the next sheet of this Series
 * can be asked for with the last one in front of it. The row's `status` guards
 * the finalize, so two pollers arriving together cannot file it twice.
 */
export async function finishRender(env, pid, take, key, fetchFn = fetch) {
  const headers = { authorization: falAuthorization(key) };
  const fail = async (error) => {
    const res = await updateSheets(env, pid, (db) => {
      const row = (db.takes || []).find((t) => t.id === take.id);
      if (!row || row.status !== "running") return { abort: true, row };
      row.status = "error";
      row.error = error;
      row.endedAt = nowIso();
      return { row };
    });
    return res.row ?? { ...take, status: "error", error };
  };

  let result = null;
  try {
    // fal's queue answers status/result on the APP's base path (owner/app), not
    // the full endpoint: `minimax/h3-max/reference-to-video/requests/<id>/status`
    // is a 405, so a poll on it never saw COMPLETED and the run waited forever
    // on clips that were done in seconds.
    const base = String(take.endpoint).split("/").slice(0, 2).join("/");
    const status = await fetchFn(`${FAL_QUEUE}/${base}/requests/${take.id}/status`, { headers });
    const state = await status.json().catch(() => null);
    if (state?.status === "FAILED") return fail(state?.error || "fal reported FAILED");
    if (state?.status !== "COMPLETED") return take;

    const done = await fetchFn(`${FAL_QUEUE}/${base}/requests/${take.id}`, { headers });
    result = await done.json().catch(() => null);
  } catch (e) {
    // A transient network failure is not a finished render — leave the row
    // running so the next poll tries again rather than burying a live take.
    return take;
  }

  const url = result?.video?.url || result?.videos?.[0]?.url;
  if (!url) return fail("the render finished with no video");

  try {
    const bytes = await (await fetchFn(url)).arrayBuffer();
    // Derived from the request id, so a second poller that gets here writes the
    // same object rather than minting a copy.
    const file = `shot-sheet_${take.seriesId}_${take.id}.mp4`;
    await putMedia(env, pid, "director", file, bytes, "video/mp4");

    const res = await updateSheets(env, pid, (db) => {
      const row = (db.takes || []).find((t) => t.id === take.id);
      if (!row || row.status !== "running") return { abort: true, row };
      row.status = "done";
      row.file = file;
      row.endedAt = nowIso();
      return { row };
    });

    // One style model sheet per RUN, not per clip: it is one pass of the look,
    // and three copies of it would spend the reference budget on themselves.
    if (!take.part || take.part === 1) await updateSeries(env, pid, take.seriesId, (series) => {
      if (!series?.id) return { abort: true };
      const name = `shot sheet ${take.id.slice(0, 8)}`;
      const sheets = series.modelSheets || [];
      if (sheets.some((sheet) => sheet.name === name)) return { abort: true };
      series.modelSheets = [
        ...sheets,
        {
          kind: "style",
          name,
          prompt: take.sheet?.premise ?? null,
          imageUrl: `/director-media/${file}`,
          model: take.endpoint,
          refs: (take.sheet?.references || []).map((r) => r.url),
        },
      ];
      series.updatedAt = nowIso();
      return {};
    });

    return res.row ?? { ...take, status: "done", file };
  } catch (e) {
    return fail(String(e?.message || e));
  }
}
