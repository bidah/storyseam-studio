// The H3 flow's "Video run" stage (`engine: "h3"` — the MiniMax H3 Film).
//
// The story flow's Video run (story-flow/run.js) on a different endpoint. The
// compiled segments rendered on fal (minimax/h3/reference-to-video, at H3's
// 480P or 768P for the job's resolution, the AUTHOR's fal key `env.FAL_KEY`, swapped in per job by
// lib/user-fal-key.js), ONE AT A TIME, because each one after the first continues the
// one before it:
//
//   segment 1   the sheets alone (Image 1, Image 2 …), 16:9.
//   segment k   the LAST FRAME of segment k−1 (a jpeg cut on the box) as one
//               more image — the frame it opens on — plus its own sheets. H3
//               has no `extension` task, and a reference VIDEO is a
//               performance it re-enacts (./prompts.js), so the seam is a
//               still. Video 1 (the last EXTENSION_TAIL_SECONDS as a clip)
//               is sent only when k−1 was cut before frames were — a job in
//               flight at the change — and the cut keeps making both.
//   every one   Audio 1… = the auditions of the characters who SPEAK in it
//               (the Voices stage) in `reference_audio_urls`, when the Film
//               ran one.
//
// Per segment:  submit → (fal renders) → cut (box: file the clip in R2, cut the
// frame and the tail) → done, then the next one is submitted in the same
// call. The state machine, the retry rules and the reference-mode step-down
// are the story flow's, verbatim — see story-flow/run.js for the account of
// each.
import { FILM_RATES_USD, H3_ENDPOINT, H3_PROMPT_EXPANSION, h3SegmentUsd } from "../../film-plan.ts";
import { absolutize, directorUrl } from "../../director.js";
import { falPoll, falSubmit } from "../../fal.js";
import { filesUrl } from "../../media.js";
import { daytonaStoryBox, storyKey } from "../story-flow/media.js";
import { compileH3Segments, isLikenessRefusal, nextMode } from "./prompts.js";

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim();
const round = (x) => Math.round(x * 1e6) / 1e6;

/** What one segment's render costs: H3's per-second rate, plus the images past the free five. */
export function segmentSpend(seg, resolution) {
  return round(h3SegmentUsd(seg.dur, seg.imageRefs.length, resolution));
}

/**
 * The fal request for one compiled segment. `frameUrl` is the previous
 * segment's last frame (the compiled image ref marked `seam`, whose URL is
 * only known now); `tailUrl` its cut (Video 1), for a segment compiled with
 * the video seam; `reference_audio_urls` are the characters' auditions
 * (Audio 1…, the Voices stage), in the compiled order, when any.
 */
export function segmentInput(env, pid, seg, { h3Resolution, aspectRatio, tailUrl, frameUrl }) {
  const audio = (seg.audioRefs || []).map((r) => absolutize(env, pid, r.url));
  return {
    prompt: seg.prompt,
    reference_image_urls: seg.imageRefs.map((r) => (r.seam ? frameUrl : absolutize(env, pid, r.imageUrl))),
    ...(seg.hasVideo && tailUrl ? { reference_video_urls: [tailUrl] } : {}),
    ...(audio.length ? { reference_audio_urls: audio } : {}),
    duration: Number(seg.dur),
    resolution: h3Resolution,
    aspect_ratio: aspectRatio,
    prompt_expansion_mode: H3_PROMPT_EXPANSION,
    enable_safety_checker: true,
  };
}

const slug = (s) => str(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

/**
 * deps (optional): { fal: { submit, poll }, box: daytonaStoryBox-shaped }.
 *
 * result = { seriesId, segments: [{ index, dur, title, status: 'queued'|
 *   'rendering'|'cutting'|'done', requestId, renderAttempt, sourceUrl, seed,
 *   cutJobId, cutAttempt, file, url, frameFile, tailFile, extended }] }
 */
export async function runH3RunStage({ job, results, env, attempt = 1 }, deps = {}) {
  const fal = deps.fal || { submit: falSubmit, poll: falPoll };
  const box = deps.box || daytonaStoryBox;
  const pid = job.projectId;
  if (!results?.prompts?.segments?.length) throw new Error("The Film has no segment prompts — the prompts step did not finish.");
  const key = str(env?.FAL_KEY);
  if (!key) throw new Error("No fal key connected — add yours in Settings › Connectors; the segments cannot be rendered.");
  if (!deps.box && !env?.DAYTONA_API_KEY) throw new Error("DAYTONA_API_KEY is not set on the Worker — the segments cannot be cut");

  const prev = (job.steps || []).find((s) => s.key === "run")?.result;
  const had = new Map((prev?.segments || []).map((s) => [s.index, s]));
  const segs = results.prompts.segments.map((c) => ({
    index: c.index, dur: c.dur, title: c.title, status: "queued", ...(had.get(c.index) || {}),
  }));
  // The seam each segment is compiled with: the frame, unless the segment
  // before it was cut (by the Worker as it was) with a tail and no frame.
  const seamOf = (i) => {
    const before = segs[i - 1];
    return before?.tailFile && !before?.frameFile ? "video" : "frame";
  };
  const compiled = compileH3Segments({ job, results }, (i) => segs[i]?.mode || null, seamOf);
  const tag = slug(job.id);
  const total = segs.length;
  let spend = 0;

  const view = () => {
    const done = segs.filter((s) => s.status === "done").length;
    const now = segs.find((s) => s.status !== "done");
    const phase = now?.status === "cutting" ? "cutting" : now?.status === "rendering" ? "rendering" : "queued";
    const words = now && now.mode && now.mode !== "full" ? ` (${now.mode === "no-video" ? "no video or character images" : "characters in words"})` : "";
    const doing = now ? ` · segment ${now.index + 1} ${phase}${words}` : "";
    return { summary: `${done} of ${total} segments rendered${doing}`, result: { seriesId: compiled.seriesId, segments: segs } };
  };
  const pending = () => ({ pending: true, ...view(), spend });
  const fail = (message) => {
    const err = new Error(message);
    if (spend > 0) err.spend = spend;
    return err;
  };
  const stepDown = (seg, c, message) => {
    const next = isLikenessRefusal(message) ? nextMode(c.mode, seg.index) : null;
    if (!next) return false;
    const refusals = [...(seg.refusals || []), { mode: c.mode, error: String(message).slice(0, 300), at: new Date().toISOString() }];
    Object.assign(seg, { status: "queued", requestId: null, mode: next, refusals });
    return true;
  };

  for (const seg of segs) {
    if (seg.status === "done") continue;
    const c = compiled.segments[seg.index];
    const where = `Segment ${seg.index + 1} of ${total}`;

    if (seg.status === "rendering" && (seg.renderAttempt || 1) < attempt) Object.assign(seg, { status: "queued", requestId: null });
    if (seg.status === "cutting" && (seg.cutAttempt || 1) < attempt) Object.assign(seg, { status: "rendered", cutJobId: null });

    if (seg.status === "queued") {
      let tailUrl = null;
      let frameUrl = null;
      if (c.hasFrame) {
        const before = segs[seg.index - 1];
        if (!before?.frameFile) throw fail(`${where}: the previous segment has no last frame to open on.`);
        frameUrl = filesUrl(env, storyKey(pid, before.frameFile));
      }
      if (c.hasVideo) {
        const before = segs[seg.index - 1];
        if (!before?.tailFile) throw fail(`${where}: the previous segment has no cut to continue from.`);
        tailUrl = filesUrl(env, storyKey(pid, before.tailFile));
      }
      const input = segmentInput(env, pid, c, { h3Resolution: compiled.h3Resolution, aspectRatio: compiled.aspectRatio, tailUrl, frameUrl });
      let requestId;
      try {
        ({ requestId } = await fal.submit(key, H3_ENDPOINT, input));
      } catch (err) {
        if (stepDown(seg, c, err?.message || err)) return pending();
        throw fail(`${where}: ${String(err?.message || err)}`);
      }
      Object.assign(seg, { status: "rendering", requestId, mode: c.mode, extended: c.hasVideo, renderAttempt: attempt, submittedAt: new Date().toISOString() });
      return pending();
    }

    if (seg.status === "rendering") {
      const polled = await fal.poll(key, H3_ENDPOINT, seg.requestId);
      if (!polled?.done) return pending();
      if (polled.failed || !polled.url) {
        if (stepDown(seg, c, polled.error)) return pending();
        throw fail(`${where}: ${polled.error || "fal returned no video"}`);
      }
      spend += segmentSpend(c, compiled.resolution);
      Object.assign(seg, { status: "rendered", sourceUrl: polled.url, seed: polled.output?.seed ?? null });
    }

    if (seg.status === "rendered") {
      const n = String(seg.index + 1).padStart(2, "0");
      const stamp = crypto.randomUUID().slice(0, 6);
      const file = `h3-${tag}-seg${n}-${stamp}.mp4`;
      const last = seg.index === total - 1;
      const frameFile = last ? null : `h3-${tag}-seg${n}-last-${stamp}.jpg`;
      const tailFile = last ? null : `h3-${tag}-seg${n}-tail-${stamp}.mp4`;
      const cutJobId = await box.startCut(env, {
        sourceUrl: seg.sourceUrl,
        clipKey: storyKey(pid, file),
        frameKey: frameFile ? storyKey(pid, frameFile) : null,
        tailKey: tailFile ? storyKey(pid, tailFile) : null,
      });
      spend += FILM_RATES_USD.sandboxMinute;
      Object.assign(seg, { status: "cutting", cutJobId, cutAttempt: attempt, file, frameFile, tailFile });
      return pending();
    }

    if (seg.status === "cutting") {
      const polled = await box.poll(env, seg.cutJobId);
      if (polled.status === "running") return pending();
      if (polled.status === "error") throw fail(`${where}: the cut failed — ${polled.error || "the sandbox failed"}`);
      Object.assign(seg, { status: "done", url: directorUrl(seg.file), doneAt: new Date().toISOString() });
    }
  }

  return { ...view(), spend };
}
