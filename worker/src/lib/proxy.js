// Preview-proxy generation. The editor timeline / cuts page preview a small
// ~720p (video) or aac (audio) proxy instead of the full-res original, so
// playback and scrubbing move far fewer bytes. Originals stay authoritative for
// stills, duration, and headless export.
//
// ensureProxy is fire-and-forget background work (called under `waitUntil` from
// the ingest write paths and the `/proxy/*` lazy fallback). It reuses the warm
// Daytona ffmpeg sandbox + the async-job plumbing that stitch uses: pull the
// original from the Worker's public `/files/<key>`, encode, `upload_r2` back to
// the proxy key. Guarded so it never re-encodes an existing proxy and won't
// stampede when several requests race on the same fresh file.

import { mediaKey, proxyKey } from "./media.js";
import { uploadFnBash } from "./upload-snippet.js";
import { getSandbox } from "./ffmpeg.js";
import { createJob, startSandboxJob } from "./jobs.js";

function workerBase(env) {
  return (env.WORKER_PUBLIC_URL || "https://shot-studio-uploads.rodrigofigueroa-name.workers.dev").replace(/\/+$/, "");
}

const LOCK_TTL_MS = 15 * 60 * 1000; // a lock older than this is presumed dead

// Best-effort stampede guard: a tiny marker object `<proxyKey>.lock`. Not
// atomic (R2 has no create-if-absent), but good enough — the accepted failure
// mode is two concurrent encodes of the same file, which both land on the same
// idempotent proxy key. A stale lock (>15 min, e.g. a `waitUntil` cut off mid
// cold-start) is ignored so the next request retries. We never delete the lock
// explicitly: once the proxy exists, `head(proxyKey)` short-circuits and the
// marker is inert.
async function lockedRecently(env, lockKey) {
  const obj = await env.BUCKET.head(lockKey);
  if (!obj) return false;
  const age = Date.now() - (obj.uploaded?.getTime?.() ?? 0);
  return age >= 0 && age < LOCK_TTL_MS;
}

// Generate the preview proxy for one media file if it doesn't already exist.
// `kind` is the R2 kind: "gen" | "multishot" (video) or "sound-media" (audio).
// The proxy key reuses the ORIGINAL basename (proxyKey(pid, kind, file)); the
// container may differ (video→mp4, audio→m4a) but browsers sniff by content, so
// the serving route stays a uniform head-then-stream with no per-kind casing.
export async function ensureProxy(env, { pid, kind, file }) {
  try {
    if (!pid || !kind || !file) return;
    const isVideo = kind !== "sound-media";
    // Only handle mp4 for video; any container for audio.
    if (isVideo && !/\.mp4$/i.test(file)) return;

    const pKey = proxyKey(pid, kind, file);
    if (await env.BUCKET.head(pKey)) return; // already have a proxy

    const lockKey = `${pKey}.lock`;
    if (await lockedRecently(env, lockKey)) return; // another encode in flight
    await env.BUCKET.put(lockKey, new Uint8Array(0)); // stamp the lock (uploaded=now)

    const base = workerBase(env);
    const jd = `/tmp/proxy_${crypto.randomUUID()}`;
    const inKey = mediaKey(pid, kind, file);
    const inName = `in_${file.split("/").pop()}`;
    const outName = isVideo ? "out.mp4" : "out.m4a";
    const encode = isVideo
      ? `ffmpeg -y -i ${inName} ` +
        `-vf "scale=w=1280:h=720:force_original_aspect_ratio=decrease:force_divisible_by=2" ` +
        `-c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p ` +
        `-c:a aac -b:a 96k -movflags +faststart ${outName}`
      : `ffmpeg -y -i ${inName} -vn -c:a aac -b:a 96k -movflags +faststart ${outName}`;

    const script = [
      "set -e", uploadFnBash(),
      `BASE=${base}`, `TOKEN=${env.INGEST_TOKEN}`,
      `rm -rf ${jd} && mkdir -p ${jd} && cd ${jd}`,
      `curl -fsS -o ${inName} ${base}/files/${inKey}`,
      encode,
      `upload_r2 ${outName} ${pKey}`,
      `rm -rf ${jd}`,
    ].join("\n");

    const jobId = await createJob(env, "proxy");
    const sandbox = await getSandbox(env);
    await startSandboxJob(env, jobId, sandbox, script, `/proxy/${kind}/${file}`);
  } catch {
    // Best-effort: a failed proxy just means the fallback keeps serving the
    // original. The lock expires and a later request retries.
  }
}

// Downscale to fit a 640px box, never upscale. libwebp default quality (75).
const THUMB_SCALE = "scale='min(640,iw)':'min(640,ih)':force_original_aspect_ratio=decrease";
// Rels with characters outside this set are skipped (they'd need shell/URL
// escaping through curl + upload_r2); their /thumb/* just keeps serving the
// original via the fallback.
const SAFE_REL = /^[A-Za-z0-9._/-]+$/;

// Batched thumbnail generation for asset-library images. Unlike the per-file
// ensureProxy, this runs ONE sandbox job for the whole missing set (the library
// page can surface hundreds of images at once) — the caller (/api/library)
// diffs assets against existing thumbs and passes only the missing rels.
// `/thumb/<rel>` serves originals until the thumbs land. One project-level lock
// marker prevents every page load from re-launching the batch while it runs.
export async function ensureAssetThumbs(env, pid, rels) {
  try {
    const safe = (rels || []).filter((r) => SAFE_REL.test(r)).slice(0, 500);
    // pid may be null (mediaKey defaults it to p_default) — don't reject it,
    // just keep keys consistent with what listAssets/listProxies resolved.
    if (!safe.length) return;

    const lockKey = mediaKey(pid, "proxy/asset", ".thumbs.lock");
    if (await lockedRecently(env, lockKey)) return;
    await env.BUCKET.put(lockKey, new Uint8Array(0));

    const base = workerBase(env);
    const jd = `/tmp/thumbs_${crypto.randomUUID()}`;
    // Per-file subshell chained with && so one bad image skips only itself.
    const blocks = safe.map((rel) => {
      const inKey = mediaKey(pid, "asset", rel);
      const outKey = proxyKey(pid, "asset", rel);
      return (
        `( set -e; cd ${jd}; curl -fsS -o in "${base}/files/${inKey}"; ` +
        `ffmpeg -y -i in -frames:v 1 -vf "${THUMB_SCALE}" -c:v libwebp out.webp; ` +
        `upload_r2 out.webp "${outKey}"; rm -f in out.webp ) || true`
      );
    });

    const script = [
      uploadFnBash(),
      `BASE=${base}`, `TOKEN=${env.INGEST_TOKEN}`,
      `rm -rf ${jd} && mkdir -p ${jd}`,
      ...blocks,
      `rm -rf ${jd}`,
    ].join("\n");

    const jobId = await createJob(env, "thumbs");
    const sandbox = await getSandbox(env);
    await startSandboxJob(env, jobId, sandbox, script, null);
  } catch {
    // Best-effort: /thumb/* keeps serving originals; the lock expires and the
    // next library load retries.
  }
}
