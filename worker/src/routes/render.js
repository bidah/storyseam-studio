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
const PREFIX_KIND = {
  "/gen/": "gen", "/sound-media/": "sound-media", "/media/": "shots",
  "/final/": "final", "/multishot-media/": "multishot", "/refs/": "refs",
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
    const inputProps = {
      tracks: absolutizeTracks(timeline.tracks, base, pid),
      fps: timeline.fps || 24, width: timeline.width || 1280, height: timeline.height || 720,
    };
    const jobId = await createJob(c.env, "render");
    const jd = `/tmp/${jobId}`;
    const script = [
      "set -e",
      `cd /tmp && rm -rf ${jd} && mkdir -p ${jd} && cd ${jd}`,
      `curl -fsS -o b.tgz ${base}/files/remotion-bundle/editor.tar.gz`,
      "mkdir bundle && tar xzf b.tgz -C bundle",
      `printf %s ${b64(JSON.stringify(inputProps))} | base64 -d > props.json`,
      `cd /app && npx remotion render ${jd}/bundle Editor ${jd}/out.mp4 --props=${jd}/props.json --codec=${codec} --crf=${crf} --scale=${scale} --log=error`,
      `curl -fsS -X PUT -H "authorization: Bearer ${c.env.INGEST_TOKEN}" -T ${jd}/out.mp4 ${base}/ingest/${outKey}`,
      `rm -rf ${jd}`,
    ].join("\n");

    try {
      const sandbox = await getRenderSandbox(c.env);
      await startSandboxJob(c.env, jobId, sandbox, script, `/files/${outKey}`);
    } catch (e) {
      return c.json({ error: `Could not start render: ${e.message || e}` }, 502);
    }
    return c.json({ ok: true, jobId, url: `/files/${outKey}` });
  });

  app.get("/api/jobs/:id", async (c) => {
    const client = await daytonaClient(c.env);
    const row = await pollJob(c.env, c.req.param("id"), (id) => client.get(id));
    if (!row) return c.json({ error: "no such job" }, 404);
    return c.json(jobView(row));
  });
}
