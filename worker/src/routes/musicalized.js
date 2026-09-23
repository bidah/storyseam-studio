// The Musicalized version — a kept sitting with a score laid under it.
//
// ── What this file is, and what it deliberately is not ─────────────────────
// Rendering the cue is the ONE piece of scoring that cannot happen in the
// browser: ElevenLabs Music runs on fal, and fal wants a key. Everything else —
// measuring the film, finding where the picture turns, ducking the cue under
// the dialogue, writing the new file — is the browser's, because the browser is
// what has the film decoded and on screen, and because the picture's packets
// are COPIED there rather than re-encoded. The film you scored is the film you
// kept, bit for bit.
//
// That is also why this is not folded into the Cuts tab's `score_cut`, which
// already lays a music bed under a stitched episode with ffmpeg in a sandbox.
// Two things differ and both matter: the cue here is ONE continuous piece
// written in chunks that turn where the picture turns, and the mix costs no
// server time at all.
//
// ── The plan is measured from the FILM, never from the cue sheet ───────────
// The Director's chunks run long. A composition plan built from `directions[]`
// is early by two to seven seconds — which is not a rounding error, it is the
// score arriving before the cut it was written for, every time, cumulatively.
// So the length that matters is the one measured off the finished file, and the
// browser measures it before it asks for anything.
//
// ── Two calls, not one ─────────────────────────────────────────────────────
// A render takes a minute or more and a Worker request does not. POST submits
// and hands back the queue's id; GET asks how it is going, and the first time
// it says COMPLETED the mp3 is copied out of fal's storage into OUR bucket
// under a key derived from the request id — so asking twice writes the same key
// twice rather than minting two copies. A provider url is scratch space.
import {
  directorUrl, readCues, readSeries, readSittings, updateCues, updateSeries, updateSittings,
} from "../lib/director.js";
import { putMedia } from "../lib/media.js";
import { planTotalMs, renderBody, renderCostUsd, validatePlan } from "../lib/music-plan.ts";
import { MAX_AUDIO_PIECES, audioPiece } from "../lib/series.ts";
import { falAuthorization } from "./stage.js";

export const MUSIC_ENDPOINT = "elevenlabs/music/v2.5";
const QUEUE = `https://queue.fal.run/${MUSIC_ENDPOINT}`;

const nowIso = () => new Date().toISOString();
// A render nobody polled for a day is not coming back for its body.
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
const falKeyOf = (c) => c.req.header("x-fal-key") || c.env.FAL_KEY || "";

export function registerMusicalized(app) {
  // Everything the tab needs to open: which sittings can be scored, which
  // already are, and per Series the standing music brief plus every cue already
  // rendered for it — the plans the next take can start from.
  app.get("/api/musicalized", async (c) => {
    const pid = c.get("projectId");
    const db = await readSittings(c.env, pid);
    const kept = [...(db.kept || [])].sort((a, b) =>
      String(b.recordedAt).localeCompare(String(a.recordedAt)),
    );
    // One read per Series rather than per sitting: several sittings of one
    // Series is the normal case, and the brief belongs to the Series.
    const ids = [...new Set(kept.map((s) => s.seriesId))];
    const rows = await Promise.all(ids.map((id) => readSeries(c.env, pid, id)));
    const series = Object.fromEntries(
      ids.map((id, i) => {
        const row = rows[i];
        return [id, row ? {
          id,
          title: row.title || "",
          prompts: row.prompts || {},
          // Empty or absent is a real answer, not a missing one: a piece can be
          // carried entirely by its sound design.
          musicStyle: row.prompts?.musicStyle || null,
          cues: (row.audioPieces || []).filter((p) => p.kind === "music"),
        } : null];
      }),
    );
    return c.json({
      sittings: kept.map((s) => ({
        ...s,
        url: directorUrl(s.file),
        scoredUrl: directorUrl(s.scoredFile),
        musicStyle: series[s.seriesId]?.musicStyle ?? null,
      })),
      series,
      model: MUSIC_ENDPOINT,
    });
  });

  // Rehearse: what the plan would cost, how long it adds up to, and every reason
  // fal would refuse it. Free, and the author sees it before the render.
  app.post("/api/musicalized/plan/check", async (c) => {
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const filmMs = Number(body.filmMs) || undefined;
    const errors = validatePlan(body.plan, filmMs);
    const totalMs = errors.length ? 0 : planTotalMs(body.plan);
    return c.json({
      errors,
      totalMs,
      filmMs: filmMs ?? null,
      // Said in dollars because it is the number that decides whether a plan is
      // worth another pass, and nobody converts minutes to money in their head.
      costUsd: errors.length ? null : Number(renderCostUsd(totalMs).toFixed(3)),
    });
  });

  // ── Render the cue ────────────────────────────────────────────────────────
  //
  // Deliberately NOT routed through the Stage's fal proxy. That proxy is pinned
  // to the Director endpoint and its session routes, and the pin is the whole
  // point of it — a proxy that forwards to whatever model a body names is a fal
  // key with extra steps. So this is a second, equally narrow door: one model,
  // one queue, the plan validated here before a cent is spent.
  app.post("/api/musicalized/cue", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }

    const seriesId = String(body.seriesId || "");
    const series = await readSeries(c.env, pid, seriesId);
    if (!series) return c.json({ error: "A cue is written for a Series — send a `seriesId` that exists" }, 404);

    const errors = validatePlan(body.plan, Number(body.filmMs) || undefined);
    if (errors.length) return c.json({ error: "fal would refuse this plan", errors }, 400);

    const key = falKeyOf(c);
    if (!key) {
      return c.json({ error: "Rendering a cue needs your fal key — add it in Settings.", code: "no_fal_key" }, 401);
    }

    const sent = renderBody(body.plan);
    const submitted = await fetch(QUEUE, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: falAuthorization(key) },
      body: JSON.stringify(sent),
    });
    const queued = await submitted.json().catch(() => null);
    if (!submitted.ok || !queued?.request_id) {
      return c.json({ error: queued?.detail || `fal refused the plan (${submitted.status})` }, 502);
    }

    // The body AS SENT is what the finished piece keeps as its prompt — seed
    // included. fal's result echoes the composition plan but not the seed, so
    // it is parked here until the first COMPLETED poll files it.
    const now = Date.now();
    await updateCues(c.env, pid, (doc) => {
      const pending = Object.fromEntries(
        Object.entries(doc.pending || {}).filter(([, p]) => now - Date.parse(p.at) < PENDING_TTL_MS),
      );
      pending[queued.request_id] = { seriesId, sent, filmMs: Number(body.filmMs) || null, at: nowIso() };
      doc.pending = pending;
      return {};
    });

    return c.json({
      ok: true,
      requestId: queued.request_id,
      sent,
      costUsd: Number(renderCostUsd(planTotalMs(body.plan)).toFixed(3)),
    });
  });

  // Ask the queue how it is going. On the first COMPLETED, copy the mp3 into our
  // bucket and file it on the Series as an `audioPieces` entry of kind `music`
  // carrying the PLAN as its prompt — verbatim, with the seed beside it, so
  // "the same but quieter" is a small change rather than a new piece.
  app.get("/api/musicalized/cue/:requestId", async (c) => {
    const pid = c.get("projectId");
    const requestId = c.req.param("requestId");
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) return c.json({ error: "unusable request id" }, 400);
    const pending = (await readCues(c.env, pid)).pending?.[requestId] || null;
    const seriesId = c.req.query("seriesId") || pending?.seriesId || "";
    const key = falKeyOf(c);
    if (!key) return c.json({ error: "no fal key", code: "no_fal_key" }, 401);

    const headers = { authorization: falAuthorization(key) };
    const status = await fetch(`${QUEUE}/requests/${requestId}/status`, { headers });
    const state = await status.json().catch(() => null);
    if (state?.status !== "COMPLETED") {
      if (state?.status === "FAILED") return c.json({ status: "error", error: state?.error || "the render failed" });
      return c.json({ status: "running", queue: state?.status || null, queuePosition: state?.queue_position ?? null });
    }

    const done = await fetch(`${QUEUE}/requests/${requestId}`, { headers });
    // A render that ran and failed reports its failure HERE, not in the status.
    if (!done.ok) {
      const detail = await done.text().catch(() => "");
      return c.json({ status: "error", error: `the render failed (${done.status}) ${detail.slice(0, 300)}` });
    }
    const result = await done.json().catch(() => null);
    const url = result?.audio?.url || result?.audio_url;
    if (!url) return c.json({ status: "error", error: "the render finished with no audio" });

    // Derived from the request id, so a second poll overwrites the same object
    // instead of minting a copy.
    const file = `cue_${seriesId || "unfiled"}_${requestId}.mp3`;
    const fetched = await fetch(url);
    if (!fetched.ok) return c.json({ status: "error", error: `could not read the render (${fetched.status})` });
    const bytes = await fetched.arrayBuffer();
    if (!bytes.byteLength) return c.json({ status: "error", error: "the render was empty" });
    await putMedia(c.env, pid, "director", file, bytes, "audio/mpeg");
    const audioUrl = directorUrl(file);

    // The body as sent, or failing that what fal echoed back. The plan,
    // verbatim, is the prompt of the piece it made: a render whose prompt was
    // lost cannot be made again in the same hand.
    const sent = pending?.sent || (result?.composition_plan ? { composition_plan: result.composition_plan } : null);
    const chunks = sent?.composition_plan?.chunks?.length || 0;
    const pieceId = `cue-${requestId.slice(0, 12)}`;

    let filed = false;
    if (seriesId && sent) {
      const piece = audioPiece.safeParse({
        id: pieceId,
        kind: "music",
        label: `chunked cue · ${chunks} chunks`,
        prompt: JSON.stringify(sent),
        model: [
          `${MUSIC_ENDPOINT} (fal) composition plan, ${chunks} chunks`,
          Number.isInteger(sent.seed) ? `seed ${sent.seed}` : null,
          `req ${requestId.slice(0, 8)}`,
        ].filter(Boolean).join(" ").slice(0, 200),
        audioUrl,
        seconds: Number(result?.audio?.duration) || (pending?.filmMs ? pending.filmMs / 1000 : null),
        offset: 0,
        levelDb: -21,
        fadeInSec: 1,
        ducks: [],
        createdAt: nowIso(),
      });
      if (piece.success) {
        const res = await updateSeries(c.env, pid, seriesId, (series) => {
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
      await updateCues(c.env, pid, (doc) => {
        if (!doc.pending?.[requestId]) return { abort: true };
        delete doc.pending[requestId];
        return {};
      });
    }
    return c.json({ status: "done", url: audioUrl, file, pieceId: filed ? pieceId : null, sent, bytes: bytes.byteLength });
  });

  // ── The scored film, coming back ──────────────────────────────────────────
  //
  // Mixed in the browser and uploaded whole. Filed BESIDE the sitting it came
  // from rather than over it: a sitting and its scored version are two files of
  // one film, and the rail shows the two together.
  app.post("/api/musicalized/scored", async (c) => {
    const pid = c.get("projectId");
    let form;
    try { form = await c.req.parseBody(); } catch { return c.json({ error: "Expected multipart form data" }, 400); }

    const sittingId = String(form.sittingId || "");
    const film = form.film;
    if (!(film instanceof File)) return c.json({ error: "Attach the scored film as `film`" }, 400);
    const bytes = await film.arrayBuffer();
    if (!bytes.byteLength) return c.json({ error: "The scored film is empty" }, 400);

    const name = `scored_${sittingId}_${crypto.randomUUID().slice(0, 8)}.mp4`;
    await putMedia(c.env, pid, "director", name, bytes, film.type || "video/mp4");

    const res = await updateSittings(c.env, pid, (db) => {
      const row = (db.kept || []).find((s) => s.id === sittingId);
      if (!row) return { abort: true, missing: true };
      row.scoredFile = name;
      row.scoredAt = nowIso();
      // What it was scored WITH, so a version can be argued with later.
      row.cuePlan = typeof form.plan === "string" ? form.plan : (row.cuePlan ?? null);
      row.cueFile = typeof form.cueFile === "string" ? form.cueFile : (row.cueFile ?? null);
      row.cueUrl = typeof form.cueUrl === "string" ? form.cueUrl : (row.cueUrl ?? null);
      row.mix = parseJson(form.mix) ?? row.mix ?? null;
      return { seriesId: row.seriesId };
    });
    if (res.missing) return c.json({ error: "No such sitting" }, 404);

    // Write down how it was laid: the bed level, the fade, the spans and the
    // ducks go on the cue's own piece, so the next take is mixed from the same
    // numbers. And the brief it was scored by becomes the Series' standing one.
    const seriesId = String(form.seriesId || res.seriesId || "");
    const mix = parseJson(form.mix);
    const cueUrl = typeof form.cueUrl === "string" ? form.cueUrl : "";
    const brief = typeof form.musicStyle === "string" ? form.musicStyle.trim() : undefined;
    if (seriesId && (mix || brief !== undefined)) {
      await updateSeries(c.env, pid, seriesId, (series) => {
        if (!series?.id) return { abort: true };
        if (brief !== undefined) series.prompts = { ...(series.prompts || {}), musicStyle: brief || null };
        if (mix && cueUrl) {
          series.audioPieces = repairPieces(series.audioPieces).map((p) => {
            if (p.audioUrl !== cueUrl) return p;
            const spans = (mix.spans || []).map((sp) => `${sp.db} dB ${sp.from}–${sp.to} s`).join(", ");
            const next = audioPiece.safeParse({
              ...p,
              levelDb: Number(mix.baseDb),
              fadeInSec: Number(mix.fadeInSec),
              ducks: (mix.ducks || []).slice(0, 64),
              model: [String(p.model || "").replace(/ — mixed .*$/, ""), `— mixed under ${sittingId.slice(0, 8)}, ${mix.baseDb} dB`, spans ? `/ ${spans}` : null]
                .filter(Boolean).join(" ").slice(0, 200),
            });
            return next.success ? next.data : p;
          });
        }
        series.updatedAt = nowIso();
        return {};
      });
    }

    return c.json({ ok: true, scoredUrl: directorUrl(name), file: name });
  });
}

// The first port filed cues with `name` and no `id`/`label`, which the Series
// schema refuses — and one refused piece makes every later patch of that
// Series fail validation. Repair them on the next write that touches the list.
function repairPieces(pieces) {
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

function parseJson(value) {
  if (typeof value !== "string" || !value) return null;
  try { return JSON.parse(value); } catch { return null; }
}
