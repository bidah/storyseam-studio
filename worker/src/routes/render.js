// Remotion "Deliver" render — on Daytona (a node+chromium+remotion sandbox),
// NOT Vercel. The render is long (minutes), so it runs as an async job:
//   POST /api/render        → start a detached render job → { jobId, url }
//   GET  /api/jobs/:id       → poll → { status, url? , error? }
//
// The sandbox pulls the prebuilt Remotion bundle (R2 `remotion-bundle/editor.tar.gz`)
// and the timeline media from the Worker's public /files/, renders, and PUTs the
// mp4 to /ingest. The prebuilt bundle is produced at deploy time (webpack can't
// run on a Worker). See worker/build-remotion-bundle.sh.

import { readDoc } from "../lib/docs.js";
import { createJob, pollJob, startSandboxJob, jobView } from "../lib/jobs.js";

const RENDER_LABELS = { app: "shot-studio", role: "render" };

// Keep the render inside the sandbox's 8 GB. Left to its own devices Remotion
// sizes both its tab pool and its OffthreadVideo frame cache from what it reads
// as available memory — which inside a container is the HOST's, not the cgroup
// limit — so a picture lane with several 720p clips walks straight past the cap
// and the kernel SIGKILLs the Rust compositor mid-render ("Compositor quit with
// signal SIGKILL"). Bounding all three is what makes the render fit:
//   concurrency         — how many Chrome tabs render frames at once
//   offthreadvideo …    — hard ceiling on the decoded-frame cache
//   disallow-parallel…  — don't hold an encode and a render in memory together
// Raising these is a memory tradeoff, not a free speedup; raise the sandbox's
// `resources.memory` first if a render ever needs to go faster.
const MEMORY_FLAGS = [
  "--concurrency=2",
  "--offthreadvideo-cache-size-in-bytes=536870912",
  "--disallow-parallel-encoding",
].join(" ");

async function daytonaClient(env) {
  const { Daytona } = await import("@daytona/sdk");
  return new Daytona({ apiKey: env.DAYTONA_API_KEY });
}

async function getRenderSandbox(env) {
  const { Daytona, Image } = await import("@daytona/sdk");
  const daytona = new Daytona({ apiKey: env.DAYTONA_API_KEY });
  for await (const s of daytona.list({ labels: RENDER_LABELS })) {
    const st = String(s.state || "").toLowerCase();
    if (st && st !== "started" && st !== "running") {
      try { await s.start(); await s.waitUntilStarted?.(); } catch { break; }
    }
    return s;
  }
  // First-run: build the render image (node + chromium libs + remotion). Slow
  // once, then reused warm. (Better: bake a DAYTONA_RENDER_SNAPSHOT.)
  const img = Image.base("node:20-bookworm-slim")
    .runCommands(
      "apt-get update",
      "apt-get install -y --no-install-recommends curl ca-certificates ffmpeg " +
        "libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 " +
        "libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 libatspi2.0-0 " +
        "libx11-6 libxcb1 libxext6 libxi6 libxshmfence1 fonts-liberation",
      "rm -rf /var/lib/apt/lists/*",
      "mkdir -p /app",
    )
    .workdir("/app")
    .runCommands(
      "npm init -y",
      "npm i remotion@4.0.486 @remotion/cli@4.0.486 @remotion/renderer@4.0.486",
      "node -e \"require('@remotion/renderer').ensureBrowser()\"",
    );
  return daytona.create(
    { image: img, resources: { cpu: 4, memory: 8, disk: 10 }, autoStopInterval: 30, labels: RENDER_LABELS },
    { timeout: 0, onSnapshotCreateLogs: () => {} },
  );
}

// Rewrite timeline media srcs (/gen/…, /sound-media/…) to the Worker's public
// /files/media/<pid>/<kind>/… so the sandbox's headless Chrome can fetch them.
// Root-relative media prefix → R2 media kind. EVERY prefix an item's `src` can
// carry must be here: a miss leaves the src root-relative, which resolves
// against nothing in the headless renderer and fails to load. `/storyboard-media/`
// is how animatic picture items (kind:"image") reference their stills.
const PREFIX_KIND = {
  "/gen/": "gen", "/sound-media/": "sound-media", "/media/": "shots",
  "/final/": "final", "/multishot-media/": "multishot", "/refs/": "refs",
  "/storyboard-media/": "storyboard", "/stills/": "stills",
  // A finished Film (Auto) and any kept sitting: /api/pool offers them.
  "/director-media/": "director",
};
function absolutizeTracks(tracks, base, pid) {
  return (tracks || []).map((t) => ({
    ...t,
    items: (t.items || []).map((it) => {
      let src = it.src;
      if (src && src.startsWith("/")) {
        for (const [pre, kind] of Object.entries(PREFIX_KIND)) {
          if (src.startsWith(pre)) { src = `${base}/files/media/${pid}/${kind}/${src.slice(pre.length)}`; break; }
        }
      }
      return { ...it, src };
    }),
  }));
}

function b64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const x of bytes) bin += String.fromCharCode(x);
  return btoa(bin);
}

export function registerRender(app) {
  app.post("/api/render", async (c) => {
    const pid = c.get("projectId");
    const body = await c.req.json().catch(() => ({}));
    const db = await readDoc(c.env, pid, "selections", {});
    const timeline = body.timeline || db.editorTimeline;
    if (!timeline || !Array.isArray(timeline.tracks)) {
      return c.json({ error: "No timeline to render — load a cut into the editor first" }, 400);
    }
    const codec = body.codec === "h265" ? "h265" : "h264";
    const crf = Number.isFinite(+body.crf) ? Math.min(51, Math.max(1, Math.round(+body.crf))) : 18;
    const scale = [0.5, 1, 2].includes(+body.scale) ? +body.scale : 1;
    const relFile = ((body.out && String(body.out).trim()) || "editor-render.mp4").split("/").pop();
    const file = (/\.mp4$/i.test(relFile) ? relFile : `${relFile}.mp4`).replace(/[^a-zA-Z0-9._-]/g, "_");
    const outKey = `media/${pid}/final/${file}`;

    const base = (c.env.WORKER_PUBLIC_URL || "").replace(/\/+$/, "");
    const fps = timeline.fps || 24;
    const width = timeline.width || 1280;
    const height = timeline.height || 720;
    const inputProps = { tracks: absolutizeTracks(timeline.tracks, base, pid), fps, width, height };
    // Longest track end — the same rule RemotionRoot's calculateMetadata applies.
    // Echoed back so the client can report what it asked for while the job runs.
    let end = 0;
    for (const t of timeline.tracks || []) {
      for (const it of t.items || []) end = Math.max(end, (it.from || 0) + (it.durationInFrames || 0));
    }
    const durationInFrames = Math.max(1, Math.round(end));
    const jobId = await createJob(c.env, "render");
    const jd = `/tmp/${jobId}`;
    const script = [
      "set -e",
      `cd /tmp && rm -rf ${jd} && mkdir -p ${jd} && cd ${jd}`,
      `curl -fsS -o b.tgz ${base}/files/remotion-bundle/editor.tar.gz`,
      "mkdir bundle && tar xzf b.tgz -C bundle",
      `printf %s ${b64(JSON.stringify(inputProps))} | base64 -d > props.json`,
      `cd /app && npx remotion render ${jd}/bundle Editor ${jd}/out.mp4 --props=${jd}/props.json ` +
        `--codec=${codec} --crf=${crf} --scale=${scale} --log=error ${MEMORY_FLAGS}`,
      // Move the moov atom to the head so the browser can start playback without
      // range-fetching the file tail first (stream copy — no re-encode).
      `ffmpeg -y -i ${jd}/out.mp4 -c copy -movflags +faststart ${jd}/out_fs.mp4 && mv ${jd}/out_fs.mp4 ${jd}/out.mp4`,
      `curl -fsS -X PUT -H "authorization: Bearer ${c.env.INGEST_TOKEN}" -T ${jd}/out.mp4 ${base}/ingest/${outKey}`,
      `rm -rf ${jd}`,
    ].join("\n");

    try {
      const sandbox = await getRenderSandbox(c.env);
      await startSandboxJob(c.env, jobId, sandbox, script, `/files/${outKey}`);
    } catch (e) {
      return c.json({ error: `Could not start render: ${e.message || e}` }, 502);
    }
    // The mp4 does NOT exist yet — this only started the sandbox. `url` is where
    // it WILL land; the caller must poll /api/jobs/:id before offering it.
    return c.json({
      ok: true, jobId, status: "running", url: `/files/${outKey}`,
      out: outKey, file, codec, crf, scale, fps, width, height, durationInFrames,
    });
  });

  app.get("/api/jobs/:id", async (c) => {
    const client = await daytonaClient(c.env);
    const row = await pollJob(c.env, c.req.param("id"), (id) => client.get(id));
    if (!row) return c.json({ error: "no such job" }, 404);
    return c.json(jobView(row));
  });
}
