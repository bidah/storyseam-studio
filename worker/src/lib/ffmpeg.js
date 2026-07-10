// ffmpeg/ffprobe orchestration from the Worker, via a reused Daytona sandbox.
//
// The Worker has no local disk, so jobs move bytes through the WORKER itself
// (not the Worker's memory, and no R2 S3 credentials needed):
//   • inputs  — the sandbox `curl`s each from the Worker's public `/files/<key>`
//               (which streams the R2 object via the Worker's binding).
//   • output  — the sandbox `curl -T`s the result to the Worker's token-guarded
//               `/ingest/<key>` (which writes to R2 via the binding).
// So the only secrets are DAYTONA_API_KEY + INGEST_TOKEN (and WORKER_PUBLIC_URL).
//
// A spec:
//   { binary, inputs:[{id,r2key}], files:[{id,content:(resolve)=>string}],
//     output:{id,r2key}|null, args:(resolve)=>string[], capture?:bool }
// resolve(id) → the sandbox path for that id.

import { uploadFnBash } from "./upload-snippet.js";

function shq(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

function workerBase(env) {
  return (env.WORKER_PUBLIC_URL || "https://shot-studio-uploads.rodrigofigueroa-name.workers.dev").replace(/\/+$/, "");
}

// A reused Daytona sandbox, looked up by label so it survives the Worker's
// ephemeral isolates (the warm sandbox lives in Daytona, not memory). Exported
// so long ffmpeg jobs (stitch) can run on it as async jobs.
export async function getSandbox(env) {
  const { Daytona, Image } = await import("@daytona/sdk");
  const daytona = new Daytona({ apiKey: env.DAYTONA_API_KEY });

  try {
    for await (const s of daytona.list({ labels: { app: "shot-studio", role: "ffmpeg" } })) {
      const st = String(s.state || "").toLowerCase();
      if (st && st !== "started" && st !== "running") {
        try { await s.start(); await s.waitUntilStarted?.(); } catch { break; }
      }
      return s;
    }
  } catch { /* list failed — create a fresh one */ }

  const snapshot = env.DAYTONA_SNAPSHOT;
  const base = snapshot
    ? { snapshot }
    : {
        image: Image.base("debian:bookworm-slim").runCommands(
          "apt-get update",
          "apt-get install -y --no-install-recommends ffmpeg curl ca-certificates jq",
          "rm -rf /var/lib/apt/lists/*",
        ),
        resources: { cpu: 2, memory: 4, disk: 10 },
      };
  return daytona.create({ ...base, autoStopInterval: 30, labels: { app: "shot-studio", role: "ffmpeg" } });
}

export async function runNative(env, spec) {
  const sandbox = await getSandbox(env);
  const base = workerBase(env);
  const jobDir = `/tmp/nr-${crypto.randomUUID()}`;
  const lines = [`set -e`, uploadFnBash(), `BASE=${base}`, `TOKEN=${env.INGEST_TOKEN}`, `mkdir -p ${jobDir}`];
  const map = new Map();

  let n = 0;
  for (const i of spec.inputs || []) {
    const local = `${jobDir}/in${n++}_${i.r2key.split("/").pop()}`;
    lines.push(`curl -fsS -o ${shq(local)} ${shq(`${base}/files/${i.r2key}`)}`);
    map.set(i.id, local);
  }
  if (spec.output) map.set(spec.output.id, `${jobDir}/out_${spec.output.r2key.split("/").pop()}`);

  const resolve = (id) => {
    if (!map.has(id)) throw new Error(`ffmpeg-runner: unknown id "${id}"`);
    return map.get(id);
  };

  for (const f of spec.files || []) {
    const local = `${jobDir}/${f.id}`;
    const bytes = new TextEncoder().encode(f.content(resolve));
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    lines.push(`printf %s ${shq(btoa(bin))} | base64 -d > ${shq(local)}`);
    map.set(f.id, local);
  }

  lines.push([spec.binary, ...spec.args(resolve).map(shq)].join(" "));

  if (spec.output) {
    lines.push(`upload_r2 ${shq(resolve(spec.output.id))} ${shq(spec.output.r2key)}`);
  }
  lines.push(`rm -rf ${jobDir}`);

  const res = await sandbox.process.executeCommand(`bash -c ${shq(lines.join("\n"))}`);
  if (res.exitCode !== 0) {
    throw new Error(`${spec.binary} failed (exit ${res.exitCode}): ${(res.result || "").slice(-800)}`);
  }
  return { stdout: res.result || "" };
}
