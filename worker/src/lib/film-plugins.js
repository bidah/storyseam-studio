// A finished Film's project, opened in the studio: which tabs it has, and what
// the Editor opens on.
//
// A Film runs in a project of its own (routes/auto.js), and "Continue working
// on the video" opens that project's studio at /p/<projectId>/editor. The
// header there is the core surfaces plus the INSTALLED plugins (routes/
// plugins.js), and the user wants exactly the surfaces the pipeline USED — the
// Film decomposed into the layers that were made for it — not the marketplace
// defaults and not a guess from usage counters. Four of those layers (Director,
// Stage, Shot sheet, Musicalized) are not seedable from usage at all, so an
// explicit write is the only way they appear.
//
// So when a Film ends — done, or stopped at a step — its project's `plugins`
// document is REPLACED with the set derived from the steps that finished, and
// (done only) an empty Editor is seeded with the Film on its picture lane, the
// way the media pool already offers it (routes/timeline.js filmsInPool).
// Neither write may fail the Film: both are best-effort and swallowed.
//
// Step → plugin (the surface that actually displays that step's output):
//   shotlist  → shotlist      saveShotlist (routes/shotlist.js), both engines
//   room      → agents        the script-reviews ledger, the /agents board
//   sheets    → director      upsertModelSheet: model sheets live on the Series
//                             (both engines — the story flow's sheets too)
//   cuesheet  → director      the Series' timed beats
//   prompts   → director      the story flow's segments, written against the Series
//   run       → shotsheet     Director: the cue sheet drawn as one clip (run.js)
//             → stage         story flow / H3: the segments, filed with the cut
//   stills    → shotsheet     pinBeat / patchSeries: the frames cut off the run
//   sitting   → stage         the kept sitting (routes/stage.js)
//   stitch    → stage         fileStoryFilm: the joined film is a kept row
//   score     → musicalized   fileScoredFilm: the cue laid under the sitting
import { updateDoc } from "./docs.js";
import { normalizeEnabled } from "./plugins.ts";
import { setEnabledPlugins } from "../routes/plugins.js";
import { runWithContext } from "./request-context.js";
import { broadcast } from "./broadcast.js";
import { isStoryEngine } from "./film-plan.ts";

const DIRECTOR_STEPS = {
  shotlist: ["shotlist"],
  room: ["agents"],
  sheets: ["director"],
  cuesheet: ["director"],
  run: ["shotsheet"],
  stills: ["shotsheet"],
  // Voices land on the World roster; the dialogue clips on the Series' beats
  // (the Director tab). Neither needs a plugin of its own.
  voices: [],
  dialogue: ["director"],
  sitting: ["stage"],
  score: ["musicalized"],
};

const STORY_STEPS = {
  shotlist: ["shotlist"],
  room: ["agents"],
  sheets: ["director"],
  // The auditioned voices land on the World roster (`voiceRef`), which the
  // Bible — a core surface — already shows: no plugin to install for them.
  voices: [],
  prompts: ["director"],
  run: ["stage"],
  stitch: ["stage"],
  score: ["musicalized"],
};

/** The plugin ids a Film's finished steps used, in catalog order. */
export function pluginsForFilm(job) {
  const map = isStoryEngine(job?.engine) ? STORY_STEPS : DIRECTOR_STEPS;
  const out = [];
  for (const step of job?.steps || []) {
    if (step?.status !== "done") continue;
    for (const id of map[step.key] || []) out.push(id);
  }
  return normalizeEnabled(out);
}

const TL_FPS = 24;
const secFrames = (sec) => Math.max(1, Math.round((sec || 0) * TL_FPS));
const SELECTIONS_FALLBACK = { library: {}, episode: {} };

/**
 * The Film on an otherwise empty Editor: one picture-lane item, the scored
 * film, the length the score stage measured. Same item shape and track ids as
 * routes/timeline.js buildTimelineFromCut, so the Editor's tools treat it like
 * any loaded cut. → true when written, false when the Editor already had work.
 */
export async function seedEditorWithFilm(env, job) {
  const film = job?.film;
  if (!film?.url || !job?.projectId) return false;
  const seconds = Number(film.seconds) || Number(job.seconds) || 0;
  if (!(seconds > 0)) return false;
  const frames = secFrames(seconds);
  const timeline = {
    fps: TL_FPS,
    width: 1280,
    height: 720,
    name: film.title || "Film",
    source: { kind: "film", filmId: job.id, file: film.file || null, at: new Date().toISOString() },
    tracks: [
      {
        id: "video",
        name: "Video",
        type: "video",
        items: [
          {
            id: `film_${job.id}`,
            src: film.url,
            name: `Film — ${film.title || "Untitled"}`,
            bundle: "film",
            from: 0,
            durationInFrames: frames,
            sourceDurationInFrames: frames,
            offsetFrames: 0,
            volume: 1,
          },
        ],
      },
      { id: "music", name: "Music", type: "audio", items: [] },
    ],
  };
  const res = await updateDoc(env, job.projectId, "selections", SELECTIONS_FALLBACK, (db) => {
    const have = db.editorTimeline;
    const items = (have?.tracks || []).reduce((n, t) => n + (t.items || []).length, 0);
    // Work in the Editor is never replaced — only an absent or empty timeline.
    if (have && items > 0 && have.source?.filmId !== job.id) return { abort: true, kept: true };
    db.editorTimeline = timeline;
    return { seeded: true };
  });
  if (res?.seeded) {
    await broadcast(env, job.projectId, "timeline", { at: new Date().toISOString(), clientId: null });
  }
  return !!res?.seeded;
}

/**
 * Settle the studio for a Film that ended: install exactly the plugins its
 * steps used, and (done) put the Film on the Editor. Best-effort — returns
 * { plugins, editor, error? } and never throws.
 */
export async function settleFilmStudio(env, job) {
  const out = { plugins: null, editor: false };
  if (!env || !job?.projectId) return out;
  try {
    await runWithContext(
      { userId: job.userId, caller: "auto", chatId: null, episodeId: job.episodeId || undefined },
      async () => {
        out.plugins = pluginsForFilm(job);
        await setEnabledPlugins(env, job.projectId, out.plugins);
        if (job.status === "done") out.editor = await seedEditorWithFilm(env, job);
      },
    );
  } catch (err) {
    out.error = String(err?.message || err);
  }
  return out;
}
