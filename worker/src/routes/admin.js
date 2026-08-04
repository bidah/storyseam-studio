// Admin: one-shot media optimization backfill. Brings EXISTING gen/multishot
// mp4s up to the standard the new pipeline applies to fresh outputs:
//   1. stream-copy remux the original in place with `+faststart` (moov → head,
//      so the browser plays frame one without range-fetching the file tail),
//   2. generate the 720p preview proxy if it's missing.
// Both are idempotent, so re-running is safe. One detached Daytona job loops
// over every file (`|| true` per file so one bad input doesn't abort the rest);
// poll it at /api/jobs/:id. The lazy `/proxy/*` fallback remains the passive
// safety net for anything this misses.

import { mediaKey, proxyKey, listMedia, listProxies } from "../lib/media.js";
import { uploadFnBash } from "../lib/upload-snippet.js";
import { getSandbox } from "../lib/ffmpeg.js";
import { createJob, startSandboxJob } from "../lib/jobs.js";

function shq(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}
function workerBase(env) {
  return (env.WORKER_PUBLIC_URL || "https://storyseam.app").replace(/\/+$/, "");
}

const PROXY_SCALE =
  'scale=w=1280:h=720:force_original_aspect_ratio=decrease:force_divisible_by=2';

export function registerAdmin(app) {
  app.post("/api/admin/media-optimize", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in required" }, 401);
    const env = c.env, pid = c.get("projectId");

    // Diff originals against existing proxies, per kind.
    const kinds = ["gen", "multishot"];
    const work = [];
    for (const kind of kinds) {
      const files = (await listMedia(env, pid, kind)).filter((f) => /\.mp4$/i.test(f));
      const proxies = new Set(await listProxies(env, pid, kind));
      for (const file of files) work.push({ kind, file, needProxy: !proxies.has(file) });
    }
    if (!work.length) return c.json({ ok: true, jobId: null, count: 0, note: "nothing to optimize" });

    const base = workerBase(env);
    const jd = `/tmp/optimize_${crypto.randomUUID()}`;
    const blocks = work.map(({ kind, file, needProxy }) => {
      const origKey = mediaKey(pid, kind, file);
      const pKey = proxyKey(pid, kind, file);
      const steps = [
        `curl -fsS -o in.mp4 ${shq(`${base}/files/${origKey}`)}`,
        // faststart remux back to the original key (stream copy — no re-encode)
        `ffmpeg -y -i in.mp4 -c copy -movflags +faststart fs.mp4`,
        `upload_r2 fs.mp4 ${shq(origKey)}`,
      ];
      if (needProxy) {
        steps.push(
          `ffmpeg -y -i in.mp4 -vf ${shq(PROXY_SCALE)} -c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p -c:a aac -b:a 96k -movflags +faststart px.mp4`,
          `upload_r2 px.mp4 ${shq(pKey)}`,
        );
      }
      steps.push("rm -f in.mp4 fs.mp4 px.mp4");
      // Each file is its own subshell chained with && so a mid-file failure skips
      // the rest of THAT file; `|| true` lets the loop continue to the next.
      return `( set -e; cd ${jd}; ${steps.join("; ")} ) || true`;
    });

    const script = [
      uploadFnBash(),
      `BASE=${base}`, `TOKEN=${env.INGEST_TOKEN}`,
      `rm -rf ${jd} && mkdir -p ${jd}`,
      ...blocks,
      `rm -rf ${jd}`,
    ].join("\n");

    const jobId = await createJob(env, "media-optimize");
    try {
      const sandbox = await getSandbox(env);
      await startSandboxJob(env, jobId, sandbox, script, null);
    } catch (e) {
      return c.json({ error: `Could not start optimize: ${e.message || e}` }, 502);
    }
    return c.json({ ok: true, jobId, count: work.length, proxies: work.filter((w) => w.needProxy).length });
  });
}
