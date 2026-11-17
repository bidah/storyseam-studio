// Upscale — take a finished film to a higher resolution on fal.
//
// Two places in this studio produce a finished video: the Stage (a kept
// sitting, and the scored version the Musicalized tab lays beside it) and the
// Editor (a Deliver render). Both are low-resolution by construction — the
// Director streams at 720p, the Editor renders its 1280×720 timeline — so this
// is the last step before a film leaves the building.
//
// ── Three calls ──────────────────────────────────────────────────────────────
//   GET  /api/upscale           what can be upscaled, with which models, and
//                               every job this project has started
//   POST /api/upscale           start one (shared contract: shared/schemas/upscale.json)
//   GET  /api/upscale/jobs/:id  how it is going; the first time fal says
//                               COMPLETED the file is copied into OUR bucket
//
// A pass takes minutes and a Worker request does not, so POST only submits.
// The copy is keyed by the job id, so two polls racing to finish it write the
// same object twice rather than minting two files. A fal result url is scratch
// space — fal forgets it — which is why the ledger keeps ours instead.
//
// The ORIGINAL is never touched. An upscale lands as a new file under
// `upscaled/`, and the source keeps playing wherever it was used.
import { requestFalKey } from "../lib/user-fal-key.js";
import { createFalClient } from "@fal-ai/client";
import { directorUrl, readSittings } from "../lib/director.js";
import { normalizeProjectId } from "../lib/docs.js";
import { filesUrl, mediaKey } from "../lib/media.js";
import {
  MAX_JOBS, modelCatalog, readUpscales, updateUpscales, upscaleModel,
} from "../lib/upscale.js";
import { validateBody } from "../lib/validate.js";
import upscaleSchema from "../schemas/upscale.json";

const VIDEO_RE = /\.(mp4|webm|mov|m4v)$/i;
const nowIso = () => new Date().toISOString();
// The author's own key — sent by the browser or stored (lib/user-fal-key.js).
const falKeyOf = (c) => requestFalKey(c);
const falFor = (key) => createFalClient({ credentials: key, suppressLocalCredentialsWarning: true });

// Editor Deliver renders land at `media/<pid>/final/<file>` — written by
// render.js with no episode segment — so they are listed from that exact
// prefix rather than through mediaKey().
const rendersPrefix = (pid) => `media/${normalizeProjectId(pid)}/final/`;
const upscaledKey = (pid, file) => `media/${normalizeProjectId(pid)}/upscaled/${file}`;

/**
 * Everything that can be upscaled, newest first. Each source carries the
 * R2 `key` it streams from — used server-side to hand fal a public url — and
 * the `url` the browser plays it at.
 */
export async function listSources(env, pid) {
  const [sittings, renders] = await Promise.all([
    readSittings(env, pid),
    (async () => {
      const prefix = rendersPrefix(pid);
      const out = [];
      let cursor;
      do {
        const res = await env.BUCKET.list({ prefix, cursor, limit: 1000 });
        for (const o of res.objects) out.push(o);
        cursor = res.truncated ? res.cursor : undefined;
      } while (cursor);
      return out;
    })(),
  ]);

  const sources = [];
  for (const s of sittings.kept || []) {
    const key = mediaKey(pid, "director", s.file);
    sources.push({
      id: `sitting:${s.id}`, origin: "stage", label: s.title || "Sitting",
      detail: "sitting", url: directorUrl(s.file), key,
      seconds: s.seconds || null, bytes: s.bytes || null, at: s.recordedAt,
    });
    if (s.scoredFile) {
      sources.push({
        id: `scored:${s.id}`, origin: "stage", label: s.title || "Sitting",
        detail: "scored", url: directorUrl(s.scoredFile), key: mediaKey(pid, "director", s.scoredFile),
        seconds: s.seconds || null, bytes: null, at: s.scoredAt || s.recordedAt,
      });
    }
  }
  const prefix = rendersPrefix(pid);
  for (const o of renders) {
    const file = o.key.slice(prefix.length);
    if (!file || file.includes("/") || !VIDEO_RE.test(file)) continue;
    sources.push({
      id: `render:${file}`, origin: "editor", label: file, detail: "render",
      url: `/files/${o.key}`, key: o.key, seconds: null, bytes: o.size,
      at: o.uploaded ? new Date(o.uploaded).toISOString() : null,
    });
  }
  return sources.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
}

const publicSource = ({ key, ...rest }) => rest;

export function registerUpscale(app) {
  app.get("/api/upscale", async (c) => {
    const pid = c.get("projectId");
    const [sources, ledger] = await Promise.all([listSources(c.env, pid), readUpscales(c.env, pid)]);
    return c.json({
      models: modelCatalog(),
      sources: sources.map(publicSource),
      jobs: ledger.jobs || [],
    });
  });

  app.post("/api/upscale", async (c) => {
    const pid = c.get("projectId");
    const parsed = await validateBody(c, upscaleSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.value;

    const model = upscaleModel(body.model);
    if (!model) return c.json({ error: `Unknown upscale model "${body.model}"` }, 400);
    if (!model.resolutions.includes(body.resolution)) {
      return c.json({
        error: `${model.label} does not offer ${body.resolution} — pick one of ${model.resolutions.join(", ")}`,
      }, 400);
    }

    const source = (await listSources(c.env, pid)).find((s) => s.id === body.source);
    if (!source) return c.json({ error: `No video "${body.source}" — list_upscales names the ones that exist` }, 404);

    // fal fetches the video itself, so it needs a url anyone can pull.
    const videoUrl = filesUrl(c.env, source.key);
    if (!videoUrl) return c.json({ error: "WORKER_PUBLIC_URL is not set — fal has no way to fetch the video" }, 500);

    const key = await falKeyOf(c);
    if (!key) {
      return c.json({ error: "Upscaling needs your fal key — add it in Settings.", code: "no_fal_key" }, 401);
    }

    const sourceHeight = Number.isInteger(body.sourceHeight) && body.sourceHeight > 0 ? body.sourceHeight : null;
    const input = model.input(videoUrl, body.resolution, sourceHeight);
    let queued;
    try {
      queued = await falFor(key).queue.submit(model.endpoint, { input });
    } catch (e) {
      return c.json({ error: `fal refused the upscale: ${falMessage(e)}` }, 502);
    }

    const job = {
      id: crypto.randomUUID(),
      requestId: queued.request_id,
      model: model.id,
      modelLabel: model.label,
      endpoint: model.endpoint,
      resolution: body.resolution,
      sourceHeight,
      source: publicSource(source),
      status: "running",
      createdAt: nowIso(),
    };
    await updateUpscales(c.env, pid, (doc) => {
      doc.jobs = [job, ...(doc.jobs || [])].slice(0, MAX_JOBS);
      return {};
    });
    return c.json({ ok: true, job });
  });

  app.get("/api/upscale/jobs/:id", async (c) => {
    const pid = c.get("projectId");
    const id = c.req.param("id");
    const job = ((await readUpscales(c.env, pid)).jobs || []).find((j) => j.id === id);
    if (!job) return c.json({ error: "No such upscale job" }, 404);
    // Settled either way — nothing left to ask fal.
    if (job.status !== "running") return c.json({ job });

    const key = await falKeyOf(c);
    if (!key) return c.json({ error: "Checking an upscale needs your fal key", code: "no_fal_key" }, 401);
    const fal = falFor(key);

    let state;
    try {
      state = await fal.queue.status(job.endpoint, { requestId: job.requestId });
    } catch (e) {
      // A transport error is not a verdict on the job — say so and keep it running.
      return c.json({ job, transient: falMessage(e) });
    }
    if (state.status !== "COMPLETED") {
      return c.json({ job: { ...job, queue: state.status, queuePosition: state.queue_position ?? null } });
    }

    let result;
    try {
      result = await fal.queue.result(job.endpoint, { requestId: job.requestId });
    } catch (e) {
      // A job that ran and failed reports its failure HERE, not in the status.
      return c.json({ job: await settle(c.env, pid, id, { status: "error", error: falMessage(e) }) });
    }
    const url = result?.data?.video?.url;
    if (!url) return c.json({ job: await settle(c.env, pid, id, { status: "error", error: "fal finished with no video" }) });

    const fetched = await fetch(url);
    if (!fetched.ok || !fetched.body) {
      return c.json({ job, transient: `could not read fal's result yet (${fetched.status})` });
    }
    const file = `${job.id}_${job.resolution}.mp4`;
    const r2Key = upscaledKey(pid, file);
    const contentType = fetched.headers.get("content-type") || "video/mp4";
    // Streamed, not buffered: a 4K film is far bigger than a Worker's memory.
    // R2 needs the length up front, which a fal CDN response carries.
    const length = Number(fetched.headers.get("content-length"));
    let body = fetched.body;
    if (length > 0) {
      const sized = new FixedLengthStream(length);
      fetched.body.pipeTo(sized.writable);
      body = sized.readable;
    } else {
      body = await fetched.arrayBuffer();
    }
    const stored = await c.env.BUCKET.put(r2Key, body, { httpMetadata: { contentType } });

    return c.json({
      job: await settle(c.env, pid, id, {
        status: "done",
        file,
        url: `/files/${r2Key}`,
        bytes: stored?.size ?? (length || null),
        width: result.data.video.width ?? null,
        height: result.data.video.height ?? null,
        finishedAt: nowIso(),
      }),
    });
  });
}

async function settle(env, pid, id, patch) {
  let settled = null;
  await updateUpscales(env, pid, (doc) => {
    const row = (doc.jobs || []).find((j) => j.id === id);
    if (!row) return { abort: true };
    Object.assign(row, patch);
    settled = { ...row };
    return {};
  });
  return settled;
}

// fal's ApiError carries the useful part in `body.detail` (a string, or a list
// of validation objects with `msg`).
function falMessage(e) {
  const d = e?.body?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => x?.msg || JSON.stringify(x)).join("; ");
  return e?.message || String(e);
}
