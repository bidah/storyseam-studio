// Scoring a kept sitting server-side: MEASURE the film and MIX a cue under it,
// each as one ffmpeg job on the reused Daytona sandbox (lib/ffmpeg.js). The
// Film job runs them DETACHED (lib/jobs.js, polled once per alarm — the same
// pattern as the Stills stage's cutter); the `/api/musicalized/scored` route,
// which has a request to wait in, runs them inline through `runNative`.
//
// The Musicalized tab does both in the browser (src/director/film.ts); this is
// the same work for when there is no browser — the Auto Film job's Score stage
// (ADR 0001) and the agent's `score_sitting` tool. The numbers are shared with
// the browser through src/lib/score-mix.ts, so one set of mix settings means
// the same thing on both paths.
//
// ── Measure ─────────────────────────────────────────────────────────────────
// The film's REAL length (ffprobe — never the cue sheet's), where the picture
// cuts (ffmpeg's scene score, `select='gt(scene,0.3)'`) and one loudness figure
// per second of its own audio (astats RMS), from which the dialogue windows the
// bed ducks under are found (`duckWindows`).
//
// ── Mix ─────────────────────────────────────────────────────────────────────
// `-c:v copy`: the picture's packets are moved, not decoded, so the scored film
// is bit-for-bit the picture that was kept. The cue is padded/cut to the film,
// faded in, held at the bed level (ducked under every measured window, and
// faded out to nothing over every Score silence — a `spans` entry with a
// `rampSec`, see `levelExpression` in score-mix.ts), summed
// with the film's own audio at full level and limited at 0.98 — the browser's
// `mixDown`, as a filter graph. AAC, faststart mp4.
//
// Several pieces: the Film's score is rendered as up to four PIECES (one per
// change of musical family — src/lib/music-cues.ts), so the mix takes `cues`:
// each input faded in and out on its own (`afade`), delayed to its offset in
// the film (`adelay`), and summed (`amix`, normalize=0 — a crossfade is two
// fades that overlap, not a level change); the bed volume expression then runs
// over the sum exactly as it runs over one cue. The single-`cue` path is kept.
import { getSandbox, runNative } from "./ffmpeg.js";
import { createJob, getJob, pollJob, startSandboxJob } from "./jobs.js";
import { filesUrl, mediaKey } from "./media.js";
import { uploadFnBash } from "./upload-snippet.js";
import { DEFAULT_MIX, bedVolumeExpression, duckWindows } from "./score-mix.ts";

/** ffmpeg's scene-change threshold for "the picture turns here". */
export const SCENE_THRESHOLD = 0.3;

/** The R2 key of a `director` media file (sittings, cues and scored films live there). */
export const directorKey = (pid, file) => mediaKey(pid, "director", file);

/** `/director-media/<file>` → `<file>`; a bare file name passes through. */
export function directorFileOf(urlOrFile) {
  const s = String(urlOrFile || "");
  const m = /\/director-media\/([^?#]+)/.exec(s);
  return m ? decodeURIComponent(m[1]) : /^[^/]+$/.test(s) ? s : "";
}

// Sections of the measurement script's stdout.
const MARK = { probe: "@@PROBE", scene: "@@SCENE", rms: "@@RMS", end: "@@END" };

/** The bash that measures `$1` (the film) — exported for the tests. */
export function measureScript() {
  return [
    `f="$1"`,
    `echo ${MARK.probe}`,
    `ffprobe -v error -show_entries format=duration:stream=codec_type,codec_name -of json "$f"`,
    `echo ${MARK.scene}`,
    // Scaled down first: a cut is a cut at 320 px, and the whole film decodes in
    // a fraction of the time.
    `ffmpeg -hide_banner -nostats -v error -i "$f" -an -vf "scale=320:-2,select='gt(scene,${SCENE_THRESHOLD})',metadata=print:file=-" -f null - || true`,
    `echo ${MARK.rms}`,
    `ffmpeg -hide_banner -nostats -v error -i "$f" -vn -ac 1 -ar 48000 -af "asetnsamples=n=48000:p=0,astats=metadata=1:reset=1,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=-" -f null - 2>/dev/null || true`,
    `echo ${MARK.end}`,
  ].join("\n");
}

function section(stdout, from, to) {
  const a = stdout.indexOf(from);
  const b = stdout.indexOf(to, a + 1);
  return a < 0 ? "" : stdout.slice(a + from.length, b < 0 ? undefined : b);
}

/**
 * The measurement script's stdout → the film's numbers.
 * → { durationMs, hasAudio, videoCodec, cuts: [{ at, score }], loudness: [dB per second] }
 */
export function parseMeasurement(stdout) {
  const text = String(stdout || "");
  let probe = null;
  try { probe = JSON.parse(section(text, MARK.probe, MARK.scene).trim()); } catch { /* below */ }
  const durationMs = Math.round(Number(probe?.format?.duration) * 1000);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("could not measure the film — ffprobe reported no duration");
  }
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const video = streams.find((s) => s.codec_type === "video");
  if (!video) throw new Error("the film has no picture to score");

  // metadata=print writes `frame:N pts:P pts_time:T` then `lavfi.scene_score=S`.
  const cuts = [];
  let at = null;
  for (const line of section(text, MARK.scene, MARK.rms).split("\n")) {
    const t = /pts_time:([\d.]+)/.exec(line);
    if (t) { at = Number(t[1]); continue; }
    const s = /lavfi\.scene_score=([\d.]+)/.exec(line);
    if (s && at !== null) { cuts.push({ at, score: Number(s[1]) }); at = null; }
  }

  const loudness = [];
  for (const line of section(text, MARK.rms, MARK.end).split("\n")) {
    const m = /lavfi\.astats\.Overall\.RMS_level=(\S+)/.exec(line);
    if (!m) continue;
    const db = Number(m[1]);
    loudness.push(Number.isFinite(db) ? Math.round(db) : -99);
  }
  // One figure per WHOLE second, as the browser measures it.
  const whole = Math.floor(durationMs / 1000);
  return {
    durationMs,
    hasAudio: streams.some((s) => s.codec_type === "audio"),
    videoCodec: video.codec_name || null,
    cuts,
    loudness: loudness.slice(0, whole),
  };
}

/** The film's numbers plus `ducks` — the measured dialogue windows the bed ducks under. */
export function withDucks(measured) {
  return { ...measured, ducks: measured.hasAudio ? duckWindows(measured.loudness) : [] };
}

/** Measure a kept film INLINE (a request waits for it). `deps.runNative` substitutes the sandbox. */
export async function measureFilm(env, pid, file, deps = {}) {
  const run = deps.runNative || runNative;
  const { stdout } = await run(env, {
    binary: "bash",
    inputs: [{ id: "film", r2key: directorKey(pid, file) }],
    output: null,
    args: (r) => ["-c", measureScript(), "measure", r("film")],
  });
  return withDucks(parseMeasurement(stdout));
}

/** A mix's settings, whole, from a partial one (the default mix underneath). */
export function mixSettings(mix) {
  const m = mix && typeof mix === "object" ? mix : {};
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    baseDb: num(m.baseDb, DEFAULT_MIX.baseDb),
    // A span keeps its `rampSec` (a Score silence fades out and back in); one
    // without keeps the old hard switch.
    spans: Array.isArray(m.spans)
      ? m.spans
        .filter((s) => Number.isFinite(s?.from) && Number.isFinite(s?.to) && Number.isFinite(s?.db) && s.to > s.from)
        .map((s) => ({ from: s.from, to: s.to, db: s.db, ...(Number(s.rampSec) > 0 ? { rampSec: Number(s.rampSec) } : {}) }))
      : [],
    ducks: Array.isArray(m.ducks) ? m.ducks.filter((d) => Array.isArray(d) && d.length === 2 && d.every(Number.isFinite)) : [],
    duckDb: num(m.duckDb, DEFAULT_MIX.duckDb),
    fadeInSec: Math.max(0, num(m.fadeInSec, DEFAULT_MIX.fadeInSec)),
  };
}

const sec3 = (ms) => (Math.max(0, Number(ms) || 0) / 1000).toFixed(3);

/**
 * The bed of several pieces, as a filter graph ending in `[bed]`: input `i + 1`
 * is `cues[i]` = { offsetMs, durationMs?, fadeInSec?, fadeOutSec? }. Each is
 * cut to its own length, faded in and out, delayed to its offset; the sum is
 * padded/cut to the film and held at the bed level. Exported for the tests.
 */
export function piecesBedGraph(cues, { durationMs, settings }) {
  const dur = sec3(durationMs);
  const parts = cues.map((c, i) => {
    const len = Number(c.durationMs) > 0 ? Number(c.durationMs) / 1000 : null;
    const fi = Math.max(0, Number(c.fadeInSec) || 0);
    const fo = Math.max(0, Number(c.fadeOutSec) || 0);
    const chain = [
      "aresample=48000",
      len ? `atrim=0:${len.toFixed(3)}` : null,
      fi > 0 ? `afade=t=in:st=0:d=${fi}` : null,
      fo > 0 && len ? `afade=t=out:st=${Math.max(0, len - fo).toFixed(3)}:d=${fo}` : null,
      Number(c.offsetMs) > 0 ? `adelay=delays=${Math.round(Number(c.offsetMs))}:all=1` : null,
    ].filter(Boolean).join(",");
    return `[${i + 1}:a]${chain}[p${i}]`;
  });
  const labels = cues.map((_, i) => `[p${i}]`).join("");
  const sum = cues.length > 1 ? `${labels}amix=inputs=${cues.length}:duration=longest:normalize=0,` : `${labels}`;
  return `${parts.join(";")};${sum}apad,atrim=0:${dur},volume='${bedVolumeExpression(settings)}':eval=frame[bed]`;
}

/**
 * The ffmpeg arguments of the mix — exported for the tests. One `cue` (the
 * whole film long) or several `cues` (paths, with `pieces` giving each one's
 * offset, length and fades).
 */
export function mixArgs({ film, cue, cues, pieces, out, durationMs, hasAudio, mix }) {
  const settings = mixSettings(mix);
  const webm = /\.webm$/i.test(String(out));
  const dur = (durationMs / 1000).toFixed(3);
  const many = Array.isArray(cues) && cues.length > 0;
  const fade = settings.fadeInSec > 0 ? `,afade=t=in:st=0:d=${settings.fadeInSec}` : "";
  const bed = many
    ? piecesBedGraph(cues.map((_, i) => pieces?.[i] || {}), { durationMs, settings })
    : `[1:a]aresample=48000,apad,atrim=0:${dur},volume='${bedVolumeExpression(settings)}':eval=frame${fade}[bed]`;
  const inputs = many ? cues.flatMap((c) => ["-i", c]) : ["-i", cue];
  const graph = hasAudio
    ? `${bed};[0:a]aresample=48000[film];[film][bed]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.98:level=false[a]`
    : `${bed};[bed]alimiter=limit=0.98:level=false[a]`;
  return [
    "-hide_banner", "-nostats", "-v", "error", "-y",
    "-i", film, ...inputs,
    "-filter_complex", graph,
    "-map", "0:v:0", "-map", "[a]",
    "-c:v", "copy",
    ...(webm ? ["-c:a", "libopus", "-b:a", "192k"] : ["-c:a", "aac", "-b:a", "192k"]), "-ar", "48000",
    "-t", dur,
    ...(webm ? [] : ["-movflags", "+faststart"]),
    out,
  ];
}

/**
 * Lay `cueFile` under `filmFile` INLINE and upload the result as `outFile` (all
 * three `director` media). The sitting itself is only READ.
 */
export async function mixScoredFilm(env, pid, { filmFile, cueFile, outFile, durationMs, hasAudio, mix }, deps = {}) {
  const run = deps.runNative || runNative;
  await run(env, {
    binary: "ffmpeg",
    inputs: [
      { id: "film", r2key: directorKey(pid, filmFile) },
      { id: "cue", r2key: directorKey(pid, cueFile) },
    ],
    output: { id: "out", r2key: directorKey(pid, outFile) },
    args: (r) => mixArgs({ film: r("film"), cue: r("cue"), out: r("out"), durationMs, hasAudio, mix }),
  });
  return { file: outFile, r2key: directorKey(pid, outFile) };
}

// ── Detached (the Film job) ────────────────────────────────────────────────

const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

/**
 * The detached measurement: download the film, measure it, and leave the report
 * in the sandbox at `outPath` — read back (and deleted) once the job is done.
 * The report is scratch, never stored: the numbers the job keeps go on its step.
 */
export function measureJobScript(env, { filmKey, outPath }) {
  const dir = `/tmp/score-m-${crypto.randomUUID()}`;
  return [
    "set -eo pipefail",
    `rm -rf ${dir} && mkdir -p ${dir}`,
    `curl -fsS -o ${dir}/film ${shq(filesUrl(env, filmKey))}`,
    `bash -c ${shq(measureScript())} measure ${dir}/film > ${shq(outPath)}`,
    `rm -rf ${dir}`,
  ].join("\n");
}

/**
 * The detached mix: download film + cue(s), mix, upload to `outKey` through
 * `/ingest`. `cues` = [{ key, offsetMs, durationMs, fadeInSec, fadeOutSec }]
 * lays several pieces; `cueKey` alone lays one cue under the whole film.
 */
export function mixJobScript(env, { filmKey, cueKey, cues, outKey, durationMs, hasAudio, mix }) {
  const dir = `/tmp/score-x-${crypto.randomUUID()}`;
  const base = String(env.WORKER_PUBLIC_URL || "").replace(/\/+$/, "");
  const out = `${dir}/scored.${/\.webm$/i.test(outKey) ? "webm" : "mp4"}`;
  const many = Array.isArray(cues) && cues.length > 0;
  const downloads = many
    ? cues.map((c, i) => `curl -fsS -o ${dir}/cue${i}.mp3 ${shq(filesUrl(env, c.key))}`)
    : [`curl -fsS -o ${dir}/cue.mp3 ${shq(filesUrl(env, cueKey))}`];
  const args = many
    ? mixArgs({ film: `${dir}/film`, cues: cues.map((_, i) => `${dir}/cue${i}.mp3`), pieces: cues, out, durationMs, hasAudio, mix })
    : mixArgs({ film: `${dir}/film`, cue: `${dir}/cue.mp3`, out, durationMs, hasAudio, mix });
  return [
    "set -eo pipefail",
    uploadFnBash(),
    `BASE=${base}`,
    `TOKEN=${env.INGEST_TOKEN}`,
    `rm -rf ${dir} && mkdir -p ${dir}`,
    `curl -fsS -o ${dir}/film ${shq(filesUrl(env, filmKey))}`,
    ...downloads,
    ["ffmpeg", ...args.map(shq)].join(" "),
    `upload_r2 ${out} ${shq(outKey)}`,
    `rm -rf ${dir}`,
  ].join("\n");
}

async function daytonaClient(env) {
  const { Daytona } = await import("@daytona/sdk");
  return new Daytona({ apiKey: env.DAYTONA_API_KEY });
}

/**
 * The real scorer: detached jobs on the reused ffmpeg sandbox, on the platform
 * Daytona key (ADR 0003). A test passes a fake with the same four methods.
 *
 *   startMeasure(env, { filmKey })  → { jobId, outPath }
 *   readMeasure(env, jobId, outPath) → the report (the measurement's stdout)
 *   startMix(env, { filmKey, cueKey | cues, outKey, durationMs, hasAudio, mix }) → jobId
 *   poll(env, jobId) → { status: 'running'|'done'|'error', error }
 */
export const daytonaScorer = {
  async startMeasure(env, spec) {
    const jobId = await createJob(env, "score-measure");
    const outPath = `/tmp/score-measure-${jobId}.txt`;
    const sandbox = await getSandbox(env);
    await startSandboxJob(env, jobId, sandbox, measureJobScript(env, { ...spec, outPath }), null);
    return { jobId, outPath };
  },
  async readMeasure(env, jobId, outPath) {
    const row = await getJob(env, jobId);
    if (!row?.sandbox_id) throw new Error("the measurement job was lost");
    const sandbox = await (await daytonaClient(env)).get(row.sandbox_id);
    const bytes = await sandbox.fs.downloadFile(outPath);
    try { await sandbox.fs.deleteFile(outPath); } catch { /* scratch */ }
    return new TextDecoder().decode(bytes);
  },
  async startMix(env, spec) {
    const jobId = await createJob(env, "score-mix");
    const sandbox = await getSandbox(env);
    await startSandboxJob(env, jobId, sandbox, mixJobScript(env, spec), null);
    return jobId;
  },
  async poll(env, jobId) {
    const client = await daytonaClient(env);
    const row = await pollJob(env, jobId, (id) => client.get(id));
    if (!row) return { status: "error", error: "the sandbox job was lost" };
    if (row.status === "done") return { status: "done", error: null };
    if (row.status === "error") return { status: "error", error: row.error || "the sandbox failed" };
    return { status: "running", error: null };
  },
};

/** A fresh scored-film name beside its sitting (same naming as the browser's upload). */
// A VP8 picture (a WebM recording) cannot be copied into an mp4, so it stays in
// WebM (Opus audio); everything else is a faststart mp4.
export const scoredName = (sittingId, videoCodec) =>
  `scored_${sittingId || "film"}_${crypto.randomUUID().slice(0, 8)}.${videoCodec === "vp8" ? "webm" : "mp4"}`;
