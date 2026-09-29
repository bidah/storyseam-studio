// The Musicalized cue and the scored film, as plain functions — shared by the
// `/api/musicalized/*` routes (routes/musicalized.js) and the Auto Film job's
// Score stage (lib/film-stages/score.js), so there is one way a cue is
// submitted to fal, one way a finished cue is copied into our bucket and filed
// on the Series, and one way a scored film is filed beside its sitting.
//
// Nothing here reads a request: the fal key is passed in (the author's BYOK key
// on the routes, the platform `FAL_KEY` in the job — ADR 0003), and so is
// `fetch`, so a Vitest can drive the job against a fake queue.
import { directorUrl, readCues, updateCues, updateSeries, updateSittings } from "./director.js";
import { putMedia } from "./media.js";
import { MINIMAX_MUSIC_ENDPOINT, minimaxBody, planTotalMs, renderBody, renderCostUsd, validatePlan } from "./music-plan.ts";
import { MAX_AUDIO_PIECES, audioPiece } from "./series.ts";
import { falAuthorization } from "../routes/stage.js";

export const MUSIC_ENDPOINT = "elevenlabs/music/v2.5";
export const MUSIC_QUEUE = `https://queue.fal.run/${MUSIC_ENDPOINT}`;
// fal's queue answers status and results on the APP's base path (owner/app),
// not the full endpoint: `elevenlabs/music/v2.5/requests/<id>/status` is a 405,
// so a cue polled there reads as running forever. Submit to MUSIC_QUEUE; poll here.
export const MUSIC_STATUS_QUEUE = `https://queue.fal.run/${MUSIC_ENDPOINT.split("/").slice(0, 2).join("/")}`;

/**
 * The score models a cue can render on (music-plan.ts › MusicModel): where it
 * is submitted, where it is polled, the body built from the plan, and what
 * file comes back. The Musicalized tab edits an ElevenLabs composition plan
 * and renders there; the Film's Score stage renders on the job's `music`.
 */
export const MUSIC_MODELS = {
  elevenlabs: {
    queue: MUSIC_QUEUE,
    statusQueue: MUSIC_STATUS_QUEUE,
    label: MUSIC_ENDPOINT,
    body: (plan) => renderBody(plan),
    ext: "mp3",
    contentType: "audio/mpeg",
  },
  minimax: {
    queue: `https://queue.fal.run/${MINIMAX_MUSIC_ENDPOINT}`,
    statusQueue: `https://queue.fal.run/${MINIMAX_MUSIC_ENDPOINT}`,
    label: MINIMAX_MUSIC_ENDPOINT,
    body: (plan) => minimaxBody(plan),
    ext: "wav",
    contentType: "audio/wav",
  },
};
const musicModel = (model) => (MUSIC_MODELS[model] ? model : "elevenlabs");

const nowIso = () => new Date().toISOString();
// A render nobody polled for a day is not coming back for its body.
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Submit one continuous cue to fal's queue. The plan is validated first (against
 * the film's measured length when given), so a plan fal would refuse never
 * spends a request. `extra` rides on the parked pending entry (the Film job
 * stamps its `filmId` there, to find its own render again after an eviction).
 *
 * → { ok: true, requestId, sent, costUsd } | { ok: false, status, error, errors?, code? }
 */
export async function submitCue(env, pid, { seriesId, plan, filmMs, key, extra, model: asked }, fetchFn = fetch) {
  const errors = validatePlan(plan, Number(filmMs) || undefined);
  if (errors.length) return { ok: false, status: 400, error: "fal would refuse this plan", errors };
  if (!key) {
    return { ok: false, status: 401, error: "Rendering a cue needs your fal key — add it in Settings.", code: "no_fal_key" };
  }

  const model = musicModel(asked);
  const sent = MUSIC_MODELS[model].body(plan);
  const submitted = await fetchFn(MUSIC_MODELS[model].queue, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: falAuthorization(key) },
    body: JSON.stringify(sent),
  });
  const queued = await submitted.json().catch(() => null);
  if (!submitted.ok || !queued?.request_id) {
    return { ok: false, status: 502, error: queued?.detail || `fal refused the plan (${submitted.status})` };
  }

  // The body AS SENT is what the finished piece keeps as its prompt — seed
  // included. fal's result echoes the composition plan but not the seed, so
  // it is parked here until the first COMPLETED poll files it.
  const now = Date.now();
  await updateCues(env, pid, (doc) => {
    const pending = Object.fromEntries(
      Object.entries(doc.pending || {}).filter(([, p]) => now - Date.parse(p.at) < PENDING_TTL_MS),
    );
    pending[queued.request_id] = { ...(extra || {}), seriesId, model, sent, plan, filmMs: Number(filmMs) || null, at: nowIso() };
    doc.pending = pending;
    return {};
  });

  return {
    ok: true,
    requestId: queued.request_id,
    model,
    sent,
    costUsd: Number(renderCostUsd(planTotalMs(plan), model).toFixed(3)),
  };
}

/**
 * Ask the queue how a cue is going. On COMPLETED, copy the mp3 into our bucket
 * under a key derived from the request id (so asking twice writes the same key
 * twice) and file it on the Series as an `audioPieces` entry of kind `music`
 * carrying the plan verbatim as its prompt.
 *
 * → { status: 'running', queue, queuePosition } | { status: 'error', error }
 *   | { status: 'done', url, file, pieceId, sent, bytes, seconds }
 */
export async function pollCue(env, pid, requestId, { seriesId: askedSeries, key, model: asked }, fetchFn = fetch) {
  const pending = (await readCues(env, pid)).pending?.[requestId] || null;
  const seriesId = askedSeries || pending?.seriesId || "";
  // The model it was SENT to: fal only answers a request on its own app's queue.
  const model = musicModel(asked || pending?.model);
  const { statusQueue, ext, contentType, label } = MUSIC_MODELS[model];

  const headers = { authorization: falAuthorization(key) };
  const status = await fetchFn(`${statusQueue}/requests/${requestId}/status`, { headers });
  const state = await status.json().catch(() => null);
  if (state?.status !== "COMPLETED") {
    if (state?.status === "FAILED") return { status: "error", error: state?.error || "the render failed" };
    return { status: "running", queue: state?.status || null, queuePosition: state?.queue_position ?? null };
  }

  const done = await fetchFn(`${statusQueue}/requests/${requestId}`, { headers });
  // A render that ran and failed reports its failure HERE, not in the status.
  if (!done.ok) {
    const detail = await done.text().catch(() => "");
    return { status: "error", error: `the render failed (${done.status}) ${detail.slice(0, 300)}` };
  }
  const result = await done.json().catch(() => null);
  const url = result?.audio?.url || result?.audio_url;
  if (!url) return { status: "error", error: "the render finished with no audio" };

  const file = `cue_${seriesId || "unfiled"}_${requestId}.${ext}`;
  const fetched = await fetchFn(url);
  if (!fetched.ok) return { status: "error", error: `could not read the render (${fetched.status})` };
  const bytes = await fetched.arrayBuffer();
  if (!bytes.byteLength) return { status: "error", error: "the render was empty" };
  await putMedia(env, pid, "director", file, bytes, contentType);
  const audioUrl = directorUrl(file);

  // The body as sent, or failing that what fal echoed back. The plan,
  // verbatim, is the prompt of the piece it made: a render whose prompt was
  // lost cannot be made again in the same hand.
  const sent = pending?.sent || (result?.composition_plan ? { composition_plan: result.composition_plan } : null);
  const chunks = sent?.composition_plan?.chunks?.length || pending?.plan?.chunks?.length || 0;
  const pieceId = `cue-${requestId.slice(0, 12)}`;
  const seconds = Number(result?.audio?.duration) || (pending?.filmMs ? pending.filmMs / 1000 : null);

  let filed = false;
  if (seriesId && sent) {
    const piece = audioPiece.safeParse({
      id: pieceId,
      kind: "music",
      label: `chunked cue · ${chunks} chunks`,
      prompt: JSON.stringify(sent),
      model: [
        model === "minimax" ? `${label} (fal) arrangement, ${chunks} sections` : `${label} (fal) composition plan, ${chunks} chunks`,
        Number.isInteger(sent.seed) ? `seed ${sent.seed}` : null,
        `req ${requestId.slice(0, 8)}`,
      ].filter(Boolean).join(" ").slice(0, 200),
      audioUrl,
      seconds,
      offset: 0,
      levelDb: -21,
      fadeInSec: 1,
      ducks: [],
      createdAt: nowIso(),
    });
    if (piece.success) {
      const res = await updateSeries(env, pid, seriesId, (series) => {
        if (!series?.id) return { abort: true };
        const pieces = repairPieces(series.audioPieces);
        series.audioPieces = pieces;
        if (pieces.some((p) => p.id === pieceId || p.audioUrl === audioUrl)) return { already: true };
        // Newest first, capped — the same order `addAudioPiece` keeps.
        series.audioPieces = [piece.data, ...pieces].slice(0, MAX_AUDIO_PIECES);
        series.updatedAt = nowIso();
        return {};
      });
      filed = !res?.abort;
    }
  }
  if (pending) {
    await updateCues(env, pid, (doc) => {
      if (!doc.pending?.[requestId]) return { abort: true };
      delete doc.pending[requestId];
      return {};
    });
  }
  return { status: "done", url: audioUrl, file, pieceId: filed ? pieceId : null, sent, bytes: bytes.byteLength, seconds };
}

/**
 * The pending cue render a Film job parked (see `submitCue` `extra`), if any.
 * `piece` narrows it to one of the Film's pieces (the Score stage stamps
 * `extra.piece`); an entry parked before pieces existed counts as piece 0.
 */
export async function pendingCueFor(env, pid, filmId, piece) {
  const pending = (await readCues(env, pid)).pending || {};
  const hit = Object.entries(pending).find(([, p]) =>
    p?.filmId && p.filmId === filmId && (piece === undefined || (Number(p.piece) || 0) === piece));
  return hit ? { requestId: hit[0], ...hit[1] } : null;
}

/**
 * File a scored film BESIDE the sitting it came from (never over it: a sitting
 * and its scored version are two files of one film), and write down how it was
 * laid — the bed level, the fade, the spans and the ducks go on the cue's own
 * piece, so the next take is mixed from the same numbers; the brief it was
 * scored by becomes the Series' standing one.
 *
 * `pieces` (the Auto Film's score, several renders) = [{ file, url, offsetMs,
 * lengthMs, plan, cues }]: all of them are kept on the row as `cuePieces`, and
 * each one's Series piece gets its offset; the FIRST is also filed as the row's
 * `cueFile`/`cueUrl`/`cuePlan`, so a reader that knows one cue still finds one.
 *
 * `name` is the scored file, already in the bucket under the `director` kind.
 * → { ok: true, scoredUrl, file, seriesId } | { ok: false, missing: true }
 */
export async function fileScoredFilm(env, pid, { sittingId, seriesId: askedSeries, name, plan, cueFile, cueUrl, mix, musicStyle, pieces }) {
  const many = Array.isArray(pieces) && pieces.length > 0;
  if (many) {
    plan = plan ?? pieces[0].plan;
    cueFile = cueFile ?? pieces[0].file;
    cueUrl = cueUrl ?? pieces[0].url;
  }
  const offsets = new Map((many ? pieces : []).map((p) => [p.url, (Number(p.offsetMs) || 0) / 1000]));
  const res = await updateSittings(env, pid, (db) => {
    const row = (db.kept || []).find((s) => s.id === sittingId);
    if (!row) return { abort: true, missing: true };
    row.scoredFile = name;
    row.scoredAt = nowIso();
    // What it was scored WITH, so a version can be argued with later.
    row.cuePlan = typeof plan === "string" ? plan : plan ? JSON.stringify(plan) : (row.cuePlan ?? null);
    row.cueFile = typeof cueFile === "string" ? cueFile : (row.cueFile ?? null);
    row.cueUrl = typeof cueUrl === "string" ? cueUrl : (row.cueUrl ?? null);
    row.mix = mix ?? row.mix ?? null;
    if (many) {
      row.cuePieces = pieces.map((p) => ({
        file: p.file,
        url: p.url,
        offsetMs: Number(p.offsetMs) || 0,
        lengthMs: Number(p.lengthMs) || null,
        cues: Array.isArray(p.cues) ? p.cues : [],
        plan: typeof p.plan === "string" ? p.plan : p.plan ? JSON.stringify(p.plan) : null,
      }));
    } else if (row.cuePieces) {
      delete row.cuePieces; // a single cue replaced an earlier score's pieces
    }
    return { seriesId: row.seriesId };
  });
  if (res?.missing) return { ok: false, missing: true };

  const seriesId = String(askedSeries || res?.seriesId || "");
  const brief = typeof musicStyle === "string" ? musicStyle.trim() : undefined;
  if (seriesId && (mix || brief !== undefined)) {
    await updateSeries(env, pid, seriesId, (series) => {
      if (!series?.id) return { abort: true };
      if (brief !== undefined) series.prompts = { ...(series.prompts || {}), musicStyle: brief || null };
      if (mix && cueUrl) {
        series.audioPieces = repairPieces(series.audioPieces).map((p) => {
          if (p.audioUrl !== cueUrl && !offsets.has(p.audioUrl)) return p;
          const spans = (mix.spans || []).map((sp) => `${sp.db} dB ${sp.from}–${sp.to} s`).join(", ");
          const next = audioPiece.safeParse({
            ...p,
            levelDb: Number(mix.baseDb),
            fadeInSec: Number(mix.fadeInSec),
            ducks: (mix.ducks || []).slice(0, 64),
            ...(offsets.has(p.audioUrl) ? { offset: offsets.get(p.audioUrl) } : {}),
            model: [String(p.model || "").replace(/ — mixed .*$/, ""), `— mixed under ${String(sittingId).slice(0, 8)}, ${mix.baseDb} dB`, spans ? `/ ${spans}` : null]
              .filter(Boolean).join(" ").slice(0, 200),
          });
          return next.success ? next.data : p;
        });
      }
      series.updatedAt = nowIso();
      return {};
    });
  }
  return { ok: true, scoredUrl: directorUrl(name), file: name, seriesId };
}

// The first port filed cues with `name` and no `id`/`label`, which the Series
// schema refuses — and one refused piece makes every later patch of that
// Series fail validation. Repair them on the next write that touches the list.
export function repairPieces(pieces) {
  return (pieces || []).map((p) => {
    if (p?.id) return p;
    const fixed = audioPiece.safeParse({
      ...p,
      id: `cue-${String(p?.audioUrl || p?.name || crypto.randomUUID()).replace(/[^A-Za-z0-9]/g, "").slice(-12)}`,
      label: p?.label || p?.name || "",
      prompt: p?.prompt && p.prompt !== "null" ? p.prompt : "{}",
      createdAt: p?.createdAt || p?.renderedAt || null,
    });
    if (!fixed.success) return p;
    return fixed.data;
  });
}
