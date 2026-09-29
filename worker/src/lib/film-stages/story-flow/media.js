// The story flow's ffmpeg work, as detached jobs on the reused Daytona sandbox
// (lib/ffmpeg.js getSandbox, lib/jobs.js) — the Score stage's pattern.
//
//   cut     one segment is done on fal: download it, file it in R2, and (when
//           another segment follows) cut its LAST seconds into the "tail" the
//           next segment extends (@Video1). The tail is re-encoded, not copied,
//           so it starts on the exact second rather than the previous keyframe.
//   stitch  every segment, joined into the one film. Each is normalised to one
//           size, frame rate and audio layout, then the seam pass
//           (./seam-edit.js) cuts each joint on the frames that match and
//           crossfades the sound across it.
//   extract every audition take (a 5s video on the Film's engine, or an audio
//           model's render, whatever its container) → one mono mp3 each, filed
//           as the character's voice reference (story-flow/voices.js). One job
//           for the whole cast.
//
// Whether Seedance's EXTENSION output also carries the source video is not
// stated by fal. So the stitch measures each extended segment: one that runs
// past its requested length by (nearly) the tail's length opens with the tail
// replayed, and that opening is trimmed — the film never shows a seam twice.
import { createJob, getJob } from "../../jobs.js";
import { getSandbox } from "../../ffmpeg.js";
import { startSandboxJob } from "../../jobs.js";
import { filesUrl, mediaKey } from "../../media.js";
import { uploadFnBash } from "../../upload-snippet.js";
import { daytonaScorer } from "../../film-score.js";
import { EXTENSION_TAIL_SECONDS, VOICE_REF_SECONDS } from "../../film-plan.ts";
import { SEAM_EDIT_PY } from "./seam-edit.js";

const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
export const storyKey = (pid, file) => mediaKey(pid, "director", file);

/** The final film's frame: the job's resolution at 16:9, one frame rate, one audio layout. */
const FRAME = { "480p": [854, 480], "720p": [1280, 720] };
const FPS = 24;
const vfFor = (resolution) => {
  const [W, H] = FRAME[resolution] || FRAME["480p"];
  return `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS}`;
};
const ENC = "-c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 160k -ar 48000 -ac 2";
// The normalised clip the seam pass reads: near-lossless picture and PCM sound,
// so cutting on a frame and re-encoding once costs no visible generation.
const MEZZ = "-c:v libx264 -preset veryfast -crf 14 -pix_fmt yuv420p -c:a pcm_s16le -ar 48000 -ac 2";

function preamble(env, dir) {
  const base = String(env.WORKER_PUBLIC_URL || "").replace(/\/+$/, "");
  return ["set -eo pipefail", uploadFnBash(), `BASE=${base}`, `TOKEN=${env.INGEST_TOKEN}`, `rm -rf ${dir} && mkdir -p ${dir}`];
}

/**
 * Download the rendered segment, file it, and cut what the next one continues
 * from: the tail Seedance extends (`tailKey`, its last seconds as a clip)
 * and/or the LAST FRAME H3 opens on (`frameKey`, a jpeg — H3 treats a
 * reference video as a performance to re-enact, so it is handed a still).
 * The frame is decoded from the last second with every frame overwriting the
 * same file, so what is left is the final one, not the one nearest a keyframe.
 */
export function cutScript(env, { sourceUrl, clipKey, tailKey, frameKey }) {
  const dir = `/tmp/sf-cut-${crypto.randomUUID()}`;
  return [
    ...preamble(env, dir),
    `curl -fsSL -o ${dir}/clip.mp4 ${shq(sourceUrl)}`,
    `upload_r2 ${dir}/clip.mp4 ${shq(clipKey)}`,
    ...(tailKey
      ? [
          `ffmpeg -hide_banner -v error -y -sseof -${EXTENSION_TAIL_SECONDS} -i ${dir}/clip.mp4 -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart ${dir}/tail.mp4`,
          `upload_r2 ${dir}/tail.mp4 ${shq(tailKey)}`,
        ]
      : []),
    ...(frameKey
      ? [
          `ffmpeg -hide_banner -v error -y -sseof -1 -i ${dir}/clip.mp4 -an -update 1 -q:v 2 ${dir}/frame.jpg`,
          `upload_r2 ${dir}/frame.jpg ${shq(frameKey)}`,
        ]
      : []),
    `rm -rf ${dir}`,
  ].join("\n");
}

/**
 * Join the segments into one film. `clips` = [{ key, dur, extended }] in order.
 * An extended clip longer than dur + tail − 1 s is trimmed of its first `tail`
 * seconds (the replayed source); a clip with no audio gets silence so every
 * clip carries one audio stream.
 *
 * Each clip is normalised to a near-lossless intermediate, then the SEAM PASS
 * (./seam-edit.js — cut-doctor + mix-doctor) cuts every joint on the frame pair
 * that actually matches, levels and crossfades the sound across it, encodes
 * the film once, and leaves its numbers at `reportPath` (scratch, read back by
 * the stage). If that pass fails for any reason the clips are joined as they
 * are — a polish step never costs the author the film.
 */
export function stitchScript(env, { clips, outKey, resolution, reportPath }) {
  const VF = vfFor(resolution);
  const [W, H] = FRAME[resolution] || FRAME["480p"];
  const dir = `/tmp/sf-stitch-${crypto.randomUUID()}`;
  const report = reportPath || `${dir}/seams.json`;
  const lines = [...preamble(env, dir), `: > ${dir}/list.txt`];
  clips.forEach((c, i) => {
    const src = `${dir}/in${i}.mp4`;
    const out = `${dir}/n${i}.mkv`;
    lines.push(
      `curl -fsS -o ${src} ${shq(filesUrl(env, c.key))}`,
      `SS=0`,
      ...(c.extended
        ? [
            `D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 ${src})`,
            `if awk "BEGIN{exit !($D > ${c.dur + EXTENSION_TAIL_SECONDS - 1})}"; then SS=${EXTENSION_TAIL_SECONDS}; fi`,
          ]
        : []),
      `A=$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 ${src} | head -1)`,
      `if [ -n "$A" ]; then ffmpeg -hide_banner -v error -y -ss $SS -i ${src} -vf ${shq(VF)} ${MEZZ} ${out};` +
        ` else ffmpeg -hide_banner -v error -y -ss $SS -i ${src} -f lavfi -i anullsrc=r=48000:cl=stereo -map 0:v -map 1:a -shortest -vf ${shq(VF)} ${MEZZ} ${out}; fi`,
      `echo "file '${out}'" >> ${dir}/list.txt`,
    );
  });
  const outs = clips.map((_, i) => `${dir}/n${i}.mkv`).join(" ");
  lines.push(
    // The box image predates the seam pass; install python once per sandbox.
    `if ! command -v python3 >/dev/null 2>&1; then (apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends python3) >/dev/null 2>&1 || true; fi`,
    `rm -f ${shq(report)}`,
    `cat > ${dir}/seam_edit.py <<'SEAM_EDIT_PY'`,
    SEAM_EDIT_PY.replace(/^\n/, ""),
    `SEAM_EDIT_PY`,
    `if ! python3 ${dir}/seam_edit.py --out ${dir}/film.mp4 --report ${shq(report)} --fps ${FPS} --width ${W} --height ${H} ${outs}; then`,
    `  echo "seam pass failed — joining the segments as they are" >&2`,
    `  rm -f ${shq(report)}`,
    `  ffmpeg -hide_banner -v error -y -f concat -safe 0 -i ${dir}/list.txt ${ENC} -bsf:v setts=pts=PTS-STARTPTS:dts=DTS-STARTPTS -movflags +faststart ${dir}/film.mp4`,
    `fi`,
    `upload_r2 ${dir}/film.mp4 ${shq(outKey)}`,
    `rm -rf ${dir}`,
  );
  return lines.join("\n");
}

/**
 * Cut every take's audio to a mono mp3 of exactly VOICE_REF_SECONDS (faded out
 * over its last 0.3s) and file it. `items` = [{ sourceUrl, outKey }]. The
 * trim is the point: H3 takes at most 15s of audio across three files, and a
 * reference past ~4s makes it mumble at the start of a take; and a take with no audio track
 * fails the job — a voice with no voice is not a reference.
 */
export function extractScript(env, { items }) {
  const dir = `/tmp/sf-voices-${crypto.randomUUID()}`;
  const lines = [...preamble(env, dir)];
  const fade = `afade=t=out:st=${Math.max(0, VOICE_REF_SECONDS - 0.3)}:d=0.3`;
  (items || []).forEach((it, i) => {
    const src = `${dir}/in${i}`;
    const out = `${dir}/voice${i}.mp3`;
    lines.push(
      `curl -fsSL -o ${src} ${shq(it.sourceUrl)}`,
      `ffmpeg -hide_banner -v error -y -i ${src} -vn -ac 1 -ar 44100 -b:a 128k -t ${VOICE_REF_SECONDS} -af ${shq(fade)} ${out}`,
      `upload_r2 ${out} ${shq(it.outKey)}`,
    );
  });
  lines.push(`rm -rf ${dir}`);
  return lines.join("\n");
}

async function start(env, kind, script) {
  const jobId = await createJob(env, kind);
  const sandbox = await getSandbox(env);
  await startSandboxJob(env, jobId, sandbox, script, null);
  return jobId;
}

/**
 * The real box: detached jobs on the platform Daytona key. A test passes a fake
 * with the same four methods.
 *   startCut(env, spec) → jobId    startStitch(env, spec) → jobId
 *   startExtract(env, spec) → jobId
 *   poll(env, jobId) → { status: 'running'|'done'|'error', error }
 *   readReport(env, jobId, path) → the seam pass's report (JSON), or null
 */
export const daytonaStoryBox = {
  startCut: (env, spec) => start(env, "story-flow-cut", cutScript(env, spec)),
  startStitch: (env, spec) => start(env, "story-flow-stitch", stitchScript(env, spec)),
  startExtract: (env, spec) => start(env, "story-flow-voices", extractScript(env, spec)),
  poll: (env, jobId) => daytonaScorer.poll(env, jobId),
  // The report is scratch in the sandbox's /tmp: gone if the sandbox stopped
  // since, and then the film simply carries no seam numbers.
  async readReport(env, jobId, path) {
    try {
      const row = await getJob(env, jobId);
      if (!row?.sandbox_id || !path) return null;
      const { Daytona } = await import("@daytona/sdk");
      const sandbox = await new Daytona({ apiKey: env.DAYTONA_API_KEY }).get(row.sandbox_id);
      const bytes = await sandbox.fs.downloadFile(path);
      try { await sandbox.fs.deleteFile(path); } catch { /* scratch */ }
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return null;
    }
  },
};
