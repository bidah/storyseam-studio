// The story flow's "Video run" stage (/story-flow — the Seedance 2.5 Film).
//
// The compiled segments rendered on fal (bytedance/seedance-2.5/reference-to-
// video, 480p, the PLATFORM key `env.FAL_KEY` — ADR 0003), ONE AT A TIME,
// because each one after the first continues the one before it:
//
//   segment 1   task "reference" — the sheets alone (@Image1…), 16:9.
//   segment k   task "extension" — @Video1 = the LAST seconds of segment k−1
//               (EXTENSION_TAIL_SECONDS, cut on the box), plus its own sheets.
//
// Per segment:  submit → (fal renders) → cut (box: file the clip in R2, cut the
// tail) → done, then the next one is submitted in the same call.
//
// ── Across alarms ───────────────────────────────────────────────────────────
// Like every slow stage, each call does what is due and answers
// `{ pending: true }` until the last segment is filed (film-job.js › Pending
// stages). The run's state is this step's own result (`segments[i]`: the fal
// request, the box job, the filed files) — read back from the job on the next
// call, so an evicted alarm resumes exactly where it was.
//
// ── Retry ───────────────────────────────────────────────────────────────────
// A refusal or a failed cut throws; the runner retries once. A retry redoes
// only the phase that failed, of the one segment in flight: a render that fal
// failed is resubmitted; a cut that failed is cut again from the render it
// already has. Finished segments are never paid for twice.
import { FILM_RATES_USD, EXTENSION_TAIL_SECONDS, SEEDANCE_ENDPOINT, STORY_FLOW_RATES_USD } from "../../film-plan.ts";
import { absolutize, directorUrl } from "../../director.js";
import { falPoll, falSubmit } from "../../fal.js";
import { filesUrl } from "../../media.js";
import { daytonaStoryBox, storyKey } from "./media.js";
import { compileSegments, isLikenessRefusal, nextMode } from "./prompts.js";

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim();
const round = (x) => Math.round(x * 1e6) / 1e6;

/** What one segment's render is estimated to cost (fal's 480p rates). */
export function segmentSpend(seg) {
  const R = STORY_FLOW_RATES_USD;
  return round(!seg.hasVideo ? seg.dur * R.seedanceSecond : (seg.dur + EXTENSION_TAIL_SECONDS) * R.seedanceVideoRefSecond);
}

/** The fal request for one compiled segment. `tailUrl` is the previous segment's cut. */
export function segmentInput(env, pid, seg, { resolution, aspectRatio, tailUrl }) {
  return {
    prompt: seg.prompt,
    task: seg.task,
    image_urls: seg.imageRefs.map((r) => absolutize(env, pid, r.imageUrl)),
    ...(seg.task === "extension" ? { video_urls: [tailUrl] } : { aspect_ratio: aspectRatio }),
    resolution,
    duration: String(seg.dur),
    generate_audio: true,
  };
}

const slug = (s) => str(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

/**
 * deps (optional): { fal: { submit, poll }, box: daytonaStoryBox-shaped }.
 *
 * result = { seriesId, segments: [{ index, dur, title, status: 'queued'|
 *   'rendering'|'cutting'|'done', requestId, renderAttempt, sourceUrl, seed,
 *   cutJobId, cutAttempt, file, url, tailFile }] }
 */
export async function runStoryFlowRunStage({ job, results, env, attempt = 1 }, deps = {}) {
  const fal = deps.fal || { submit: falSubmit, poll: falPoll };
  const box = deps.box || daytonaStoryBox;
  const pid = job.projectId;
  if (!results?.prompts?.segments?.length) throw new Error("The Film has no segment prompts — the prompts step did not finish.");
  const key = str(env?.FAL_KEY);
  if (!key) throw new Error("FAL_KEY is not set on the Worker — the segments cannot be rendered");
  if (!deps.box && !env?.DAYTONA_API_KEY) throw new Error("DAYTONA_API_KEY is not set on the Worker — the segments cannot be cut");

  // This step's own state from the last call (a pending answer's result).
  const prev = (job.steps || []).find((s) => s.key === "run")?.result;
  const had = new Map((prev?.segments || []).map((s) => [s.index, s]));
  const segs = results.prompts.segments.map((c) => ({
    index: c.index, dur: c.dur, title: c.title, status: "queued", ...(had.get(c.index) || {}),
  }));
  // The prompts again, from the same inputs the prompts step checked — each in
  // the reference mode its segment is at (a likeness refusal steps it down).
  const compiled = compileSegments({ job, results }, (i) => segs[i]?.mode || null);
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
  // Seedance refused the references as a real person's likeness: send less
  // (prompts.js › Reference modes) and render the segment again, rather than
  // stop. Only a refusal with no mode left to step down to fails the stage.
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

    // A retry redoes the phase that failed on an earlier attempt.
    if (seg.status === "rendering" && (seg.renderAttempt || 1) < attempt) Object.assign(seg, { status: "queued", requestId: null });
    if (seg.status === "cutting" && (seg.cutAttempt || 1) < attempt) Object.assign(seg, { status: "rendered", cutJobId: null });

    if (seg.status === "queued") {
      let tailUrl = null;
      if (c.task === "extension") {
        const before = segs[seg.index - 1];
        if (!before?.tailFile) throw fail(`${where}: the previous segment has no cut to extend.`);
        tailUrl = filesUrl(env, storyKey(pid, before.tailFile));
      }
      const input = segmentInput(env, pid, c, { resolution: compiled.resolution, aspectRatio: compiled.aspectRatio, tailUrl });
      let requestId;
      try {
        ({ requestId } = await fal.submit(key, SEEDANCE_ENDPOINT, input));
      } catch (err) {
        if (stepDown(seg, c, err?.message || err)) return pending();
        throw fail(`${where}: ${String(err?.message || err)}`);
      }
      Object.assign(seg, { status: "rendering", requestId, mode: c.mode, renderAttempt: attempt, submittedAt: new Date().toISOString() });
      return pending();
    }

    if (seg.status === "rendering") {
      const polled = await fal.poll(key, SEEDANCE_ENDPOINT, seg.requestId);
      if (!polled?.done) return pending();
      if (polled.failed || !polled.url) {
        if (stepDown(seg, c, polled.error)) return pending();
        throw fail(`${where}: ${polled.error || "fal returned no video"}`);
      }
      // Counted when fal delivers: a refused request is not billed.
      spend += segmentSpend(c);
      Object.assign(seg, { status: "rendered", sourceUrl: polled.url, seed: polled.output?.seed ?? null });
    }

    if (seg.status === "rendered") {
      const n = String(seg.index + 1).padStart(2, "0");
      const stamp = crypto.randomUUID().slice(0, 6);
      const file = `story-${tag}-seg${n}-${stamp}.mp4`;
      const last = seg.index === total - 1;
      const tailFile = last ? null : `story-${tag}-seg${n}-tail-${stamp}.mp4`;
      const cutJobId = await box.startCut(env, {
        sourceUrl: seg.sourceUrl,
        clipKey: storyKey(pid, file),
        tailKey: tailFile ? storyKey(pid, tailFile) : null,
      });
      spend += FILM_RATES_USD.sandboxMinute;
      Object.assign(seg, { status: "cutting", cutJobId, cutAttempt: attempt, file, tailFile });
      return pending();
    }

    if (seg.status === "cutting") {
      const polled = await box.poll(env, seg.cutJobId);
      if (polled.status === "running") return pending();
      if (polled.status === "error") throw fail(`${where}: the cut failed — ${polled.error || "the sandbox failed"}`);
      Object.assign(seg, { status: "done", url: directorUrl(seg.file), doneAt: new Date().toISOString() });
      // Straight on to the next segment in this same call.
    }
  }

  return { ...view(), spend };
}
