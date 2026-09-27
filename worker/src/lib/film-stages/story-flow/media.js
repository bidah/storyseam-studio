// The story flow's ffmpeg work, as detached jobs on the reused Daytona sandbox
// (lib/ffmpeg.js getSandbox, lib/jobs.js) — the Score stage's pattern.
//
//   cut     one segment is done on fal: download it, file it in R2, and (when
//           another segment follows) cut its LAST seconds into the "tail" the
//           next segment extends (@Video1). The tail is re-encoded, not copied,
//           so it starts on the exact second rather than the previous keyframe.
//   stitch  every segment, joined into the one film. Each is normalised to one
//           size, frame rate and audio layout first so the concat can copy.
//
// Whether Seedance's EXTENSION output also carries the source video is not
// stated by fal. So the stitch measures each extended segment: one that runs
// past its requested length by (nearly) the tail's length opens with the tail
// replayed, and that opening is trimmed — the film never shows a seam twice.
import { createJob } from "../../jobs.js";
import { getSandbox } from "../../ffmpeg.js";
import { startSandboxJob } from "../../jobs.js";
import { filesUrl, mediaKey } from "../../media.js";
import { uploadFnBash } from "../../upload-snippet.js";
import { daytonaScorer } from "../../film-score.js";
import { EXTENSION_TAIL_SECONDS } from "../../film-plan.ts";

const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
export const storyKey = (pid, file) => mediaKey(pid, "director", file);

/** The final film's frame: Seedance 480p 16:9, one frame rate, one audio layout. */
const W = 854;
const H = 480;
const FPS = 24;
const VF = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS}`;
const ENC = "-c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 160k -ar 48000 -ac 2";

function preamble(env, dir) {
  const base = String(env.WORKER_PUBLIC_URL || "").replace(/\/+$/, "");
  return ["set -eo pipefail", uploadFnBash(), `BASE=${base}`, `TOKEN=${env.INGEST_TOKEN}`, `rm -rf ${dir} && mkdir -p ${dir}`];
}

/** Download the rendered segment, file it, and cut the tail the next one extends. */
export function cutScript(env, { sourceUrl, clipKey, tailKey }) {
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
    `rm -rf ${dir}`,
  ].join("\n");
}

/**
 * Join the segments into one film. `clips` = [{ key, dur, extended }] in order.
 * An extended clip longer than dur + tail − 1 s is trimmed of its first `tail`
 * seconds (the replayed source); a clip with no audio gets silence so the
 * concat keeps one audio stream.
 */
export function stitchScript(env, { clips, outKey }) {
  const dir = `/tmp/sf-stitch-${crypto.randomUUID()}`;
  const lines = [...preamble(env, dir), `: > ${dir}/list.txt`];
  clips.forEach((c, i) => {
    const src = `${dir}/in${i}.mp4`;
    const out = `${dir}/n${i}.mp4`;
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
      `if [ -n "$A" ]; then ffmpeg -hide_banner -v error -y -ss $SS -i ${src} -vf ${shq(VF)} ${ENC} ${out};` +
        ` else ffmpeg -hide_banner -v error -y -ss $SS -i ${src} -f lavfi -i anullsrc=r=48000:cl=stereo -map 0:v -map 1:a -shortest -vf ${shq(VF)} ${ENC} ${out}; fi`,
      `echo "file '${out}'" >> ${dir}/list.txt`,
    );
  });
  lines.push(
    `ffmpeg -hide_banner -v error -y -f concat -safe 0 -i ${dir}/list.txt -c copy -movflags +faststart ${dir}/film.mp4`,
    `upload_r2 ${dir}/film.mp4 ${shq(outKey)}`,
    `rm -rf ${dir}`,
  );
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
 * with the same three methods.
 *   startCut(env, spec) → jobId    startStitch(env, spec) → jobId
 *   poll(env, jobId) → { status: 'running'|'done'|'error', error }
 */
export const daytonaStoryBox = {
  startCut: (env, spec) => start(env, "story-flow-cut", cutScript(env, spec)),
  startStitch: (env, spec) => start(env, "story-flow-stitch", stitchScript(env, spec)),
  poll: (env, jobId) => daytonaScorer.poll(env, jobId),
};
