// Complete Cuts endpoints, ported from server/index.js
// (/api/episode/cuts, /stitch, /score, /trim). This is the ffmpeg-coupled group:
// it stitches the SELECTED take of each bundle into one mp4, overlays a low
// background-music bed (the Sound Studio cues) into a "scored" version, and trims
// individual takes — every op minting a NEW immutable versioned generation.
//
// R2/FFMPEG PORT: media lives in R2 now, not on local disk. Every ffmpeg/ffprobe
// call goes through `runNative(env, spec)` with R2-KEY-based inputs/output
// (`mediaKey(pid, "gen"|"sound-media", file)`); the sandbox pulls inputs from
// presigned R2 GETs and pushes the output to a presigned R2 PUT. Filesystem
// existence checks (`fs.existsSync`) become `mediaExists`. The selections DB and
// the sounds doc are the R2 doc stores (`state/<pid>/selections.json`,
// `state/<pid>/sounds.json`). Media URLs stay `/gen/<file>` / `/sound-media/<file>`.
import { readDoc, writeDoc } from "../lib/docs.js";
import { mediaKey, mediaExists, listMediaSet } from "../lib/media.js";
import { runNative, getSandbox } from "../lib/ffmpeg.js";
import { createJob, startSandboxJob } from "../lib/jobs.js";
import { uploadFnBash } from "../lib/upload-snippet.js";

const b64 = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const x of bytes) bin += String.fromCharCode(x);
  return btoa(bin);
};

// The de-facto selections DB (holds db.video, db.cut, db.cutHistory).
const readDB = (env, pid) => readDoc(env, pid, "selections", { library: {}, episode: {} });
const writeDB = (env, pid, db) => writeDoc(env, pid, "selections", db);

// ---------------------------------------------------------------------------
// Complete cuts: stitch the SELECTED take of each bundle, in order, into one mp4.
// ---------------------------------------------------------------------------
const CUT_FILE = "complete_cut.mp4"; // the full episode cut, MS-01 → last rendered

const bundleNum = (id) => {
  const m = /MS-0*(\d+)/.exec(id || "");
  return m ? Number(m[1]) : 0;
};

// Sort key deciding which selected take wins when more than one is flagged:
// most-recently SELECTED first, then most-recently generated. Guards against
// legacy/raced data where two takes ended up selected at once.
const selKey = (v) => Date.parse(v?.selectedAt) || Date.parse(v?.ts) || 0;

// Pick the chosen take for a bundle: the most-recently-selected take that still
// exists in R2; if none is selected, the first present take (a fallback).
async function pickTake(env, pid, entry, genSet) {
  const set = genSet || (await listMediaSet(env, pid, "gen"));
  const list = Array.isArray(entry) ? entry : entry ? [entry] : [];
  const present = list.filter((v) => v && v.file && set.has(v.file));
  if (!present.length) return null;
  const chosen = present.filter((v) => v.selected);
  if (chosen.length) {
    const sel = chosen
      .slice()
      .sort((a, b) => selKey(b) - selKey(a) || present.indexOf(b) - present.indexOf(a))[0];
    return { take: sel, fallback: false };
  }
  return { take: present[0], fallback: true };
}

// Collapse any bundle that ended up with >1 selected take down to the single
// most-recently-selected one, so the UI, the store, and the stitch always agree.
// Returns true if it changed anything (caller should writeDB).
function normalizeVideoSelections(db) {
  let changed = false;
  for (const entry of Object.values(db.video || {})) {
    const list = Array.isArray(entry) ? entry : entry ? [entry] : [];
    const sel = list.filter((v) => v && v.selected);
    if (sel.length <= 1) continue;
    const keep = sel
      .slice()
      .sort((a, b) => selKey(b) - selKey(a) || list.indexOf(b) - list.indexOf(a))[0];
    for (const v of sel) if (v !== keep) { v.selected = false; changed = true; }
  }
  return changed;
}

async function probeDuration(env, pid, file) {
  try {
    const { stdout } = await runNative(env, {
      binary: "ffprobe",
      capture: true,
      inputs: [{ id: "in", r2key: mediaKey(pid, "gen", file) }],
      args: (r) => [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        r("in"),
      ],
    });
    return parseFloat(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

// Probe MANY "gen" files for their duration in ONE sandbox round-trip. The old
// code fired one runNative (a remote curl+ffprobe) per take; on the first Cuts
// load of an episode that was ~45 remote commands. This pulls every file into
// one sandbox and ffprobes each, emitting `<file>|<seconds>` lines we parse back
// into a { file: dur } map. Durations are cached onto the take after, so this
// runs at most once per take across the app's lifetime.
async function probeDurations(env, pid, files) {
  const uniq = [...new Set(files.filter(Boolean))];
  if (!uniq.length) return {};
  try {
    const { stdout } = await runNative(env, {
      binary: "bash",
      capture: true,
      inputs: uniq.map((f, i) => ({ id: `f${i}`, r2key: mediaKey(pid, "gen", f) })),
      // Each line: the original filename, a pipe, then its probed duration (or
      // empty on failure). `|| true` keeps one bad file from aborting the batch
      // under the runner's `set -e`.
      args: (r) => ["-c", uniq.map((f, i) =>
        `printf '%s|%s\\n' "${f}" "$(ffprobe -v error -show_entries format=duration ` +
        `-of default=noprint_wrappers=1:nokey=1 "${r(`f${i}`)}" 2>/dev/null || true)"`
      ).join("\n")],
    });
    const out = {};
    for (const line of String(stdout).split("\n")) {
      const i = line.indexOf("|");
      if (i < 0) continue;
      const file = line.slice(0, i);
      const dur = parseFloat(line.slice(i + 1).trim());
      if (file && dur > 0) out[file] = dur;
    }
    return out;
  } catch {
    return {};
  }
}

// Ordered MS-01 … last-rendered plan with the chosen take, duration, and the
// from→to timecode each segment occupies in the stitched output.
async function buildCutSegments(env, pid, { probe = true, genSet, db: dbIn } = {}) {
  const db = dbIn || (await readDB(env, pid));
  const set = genSet || (await listMediaSet(env, pid, "gen"));
  const ids = Object.keys(db.video || {}).sort((a, b) => bundleNum(a) - bundleNum(b));
  const picks = [];
  for (const id of ids) picks.push({ id, picked: await pickTake(env, pid, db.video?.[id], set) });

  // Fill any missing durations in ONE batched probe (a single sandbox round-trip
  // for every un-probed take), caching the result on the take (picked.take is a
  // reference into db.video) so later cuts views never probe again. `probe:false`
  // (stitch) skips this entirely — the concat needs only the ordered file list.
  let dirty = false;
  if (probe) {
    const need = picks.map((p) => p.picked?.take).filter((t) => t && !(Number(t.dur) > 0));
    if (need.length) {
      const durs = await probeDurations(env, pid, need.map((t) => t.file));
      for (const t of need) {
        const dur = durs[t.file];
        if (dur) { t.dur = dur; dirty = true; }
      }
    }
  }

  const segs = [];
  let cursor = 0;
  for (const { id, picked } of picks) {
    if (!picked) {
      segs.push({ id, file: null, missing: true, start: cursor, duration: 0, end: cursor });
      continue;
    }
    const duration = Number(picked.take.dur) || 0;
    segs.push({
      id,
      file: picked.take.file,
      name: picked.take.name || picked.take.file,
      url: "/gen/" + picked.take.file,
      selected: !picked.fallback,
      fallback: picked.fallback,
      start: cursor,
      duration,
      end: cursor + duration,
    });
    cursor += duration;
  }
  if (dirty) { try { await writeDB(env, pid, db); } catch { /* cache best-effort */ } }
  return segs;
}

// First/last bundle id across a segment list (covers the full stitched range).
function segRange(segs) {
  const ids = segs.map((s) => s.id);
  return { from: ids[0] || null, to: ids[ids.length - 1] || null };
}

// ---------------------------------------------------------------------------
// Background music score: overlay the Sound Studio cues (Cue 2 … Cue 11) under
// the stitched cut at a low bed level, producing a second "scored" version.
// Each cue is pinned to the FIRST bundle of its beat; it starts at that
// segment's timecode in the cut and underscores the whole beat.
// ---------------------------------------------------------------------------
const SCORED_CUT_FILE = "complete_cut_scored.mp4";
const MUSIC_BED_GAIN = 0.08; // ~-22 dB — a low background bed; dialogue/SFX lead

const MUSIC_CUES = [
  { track: "trk_12", label: "Cue 2 — The deal", first: 4, last: 8 },
  { track: "trk_13", label: "Cue 3 — Crossing over", first: 9, last: 10 },
  { track: "trk_14", label: "Cue 4 — The Forest King", first: 11, last: 14 },
  { track: "trk_15", label: "Cue 5 — Helena searches", first: 15, last: 16 },
  { track: "trk_16", label: "Cue 6 — Tea & the locked door", first: 17, last: 21 },
  { track: "trk_17", label: "Cue 7 — The plan & Mote", first: 22, last: 25 },
  { track: "trk_18", label: "Cue 8 — Nightfall montage", first: 26, last: 31 },
  { track: "trk_19", label: "Cue 9 — At the window", first: 32, last: 35 },
  { track: "trk_20", label: "Cue 10 — The rescue", first: 36, last: 42 },
  { track: "trk_21", label: "Cue 11 — Home, changed", first: 43, last: 48 },
];

async function soundDuration(env, pid, file) {
  try {
    const { stdout } = await runNative(env, {
      binary: "ffprobe",
      capture: true,
      inputs: [{ id: "in", r2key: mediaKey(pid, "sound-media", file) }],
      args: (r) => [
        "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", r("in"),
      ],
    });
    return parseFloat(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

// Resolve a Sound Studio track's ready media file → { file, name } or null.
// Reads the SOUNDS doc and confirms the media object exists in R2.
async function soundFileForTrack(env, pid, trackId, soundSet, soundsDb) {
  try {
    const db = soundsDb || (await readDoc(env, pid, "sounds", { tracks: [] }));
    const t = (db.tracks || []).find((x) => x.id === trackId);
    if (!t) return null;
    const v =
      [...(t.versions || [])].reverse().find((x) => x.file && x.status === "ready") ||
      (t.versions || []).find((x) => x.file);
    if (!v || !v.file) return null;
    const exists = soundSet ? soundSet.has(v.file) : await mediaExists(env, pid, "sound-media", v.file);
    return exists ? { file: v.file, name: t.name } : null;
  } catch {
    return null;
  }
}

// Placement of each music cue over the stitched segments: where it starts (its
// first bundle's timecode) and the beat span it underscores.
async function buildScoreLayout(env, pid, segments) {
  const present = segments.filter((s) => s.file);
  const numOf = (s) => bundleNum(s.id);
  // One list + one sounds-doc read up front, instead of a HEAD + doc read per cue.
  const soundSet = await listMediaSet(env, pid, "sound-media");
  const soundsDb = await readDoc(env, pid, "sounds", { tracks: [] });
  const layout = [];
  for (const cue of MUSIC_CUES) {
    const firstSeg = present.find((s) => numOf(s) === cue.first);
    if (!firstSeg) continue; // beat not in the cut
    const inBeat = present.filter((s) => numOf(s) >= cue.first && numOf(s) <= cue.last);
    const snd = await soundFileForTrack(env, pid, cue.track, soundSet, soundsDb);
    if (!snd) continue; // no rendered music yet
    const duration = await soundDuration(env, pid, snd.file);
    layout.push({
      track: cue.track,
      label: cue.label,
      name: snd.name,
      file: snd.file,
      url: "/sound-media/" + snd.file,
      first: cue.first,
      last: cue.last,
      start: firstSeg.start,
      beatEnd: inBeat.length ? inBeat[inBeat.length - 1].end : firstSeg.end,
      duration,
      gainDb: Math.round(20 * Math.log10(MUSIC_BED_GAIN)),
    });
  }
  return layout;
}

// Tag each segment with the cue that plays over it (for UI display).
function annotateSegmentsMusic(segments) {
  for (const s of segments) {
    const n = bundleNum(s.id);
    const cue = MUSIC_CUES.find((c) => n >= c.first && n <= c.last);
    s.musicCue = cue ? { track: cue.track, label: cue.label } : null;
  }
  return segments;
}

// Normalized list of scored versions that still exist in R2, newest first.
// Migrates the legacy single `db.cut.scored` into a v1 entry when present.
async function listScoredVersions(env, pid, db, genSet) {
  const set = genSet || (await listMediaSet(env, pid, "gen"));
  let versions = Array.isArray(db.cut?.scoredVersions) ? db.cut.scoredVersions.slice() : [];
  if (!versions.length && db.cut?.scored && set.has(SCORED_CUT_FILE)) {
    versions = [{ v: 1, file: SCORED_CUT_FILE, ...db.cut.scored }];
  }
  const out = [];
  for (const x of versions) {
    if (set.has(x.file)) out.push({ ...x, url: "/gen/" + x.file });
  }
  return out.sort((a, b) => b.v - a.v);
}

// --- Versioned complete-cut history ------------------------------------------
// Every stitch/score mints a NEW, immutable generation file (complete_cut_vN.mp4)
// so nothing is ever overwritten — the UI can show the version number and the
// browser can never serve a stale cached cut. `db.cutHistory` is the ordered
// list of every generation (base stitches + scored versions).
const cutVersionFile = (v) => `complete_cut_v${v}.mp4`;

// Legacy → history: synthesize generation entries from the old single `db.cut`
// (+ its scored versions) so a project stitched before versioning still shows
// its cut and music in the history.
async function legacyToHistory(env, pid, db, genSet) {
  const set = genSet || (await listMediaSet(env, pid, "gen"));
  const out = [];
  const cut = db.cut;
  if (cut && set.has(CUT_FILE)) {
    out.push({ v: 1, kind: "stitch", file: CUT_FILE, at: cut.stitchedAt || null, range: cut.range || null, totalDuration: cut.totalDuration || 0, segments: cut.segments || [] });
  }
  const scored = (await listScoredVersions(env, pid, db, set)).slice().sort((a, b) => a.v - b.v);
  for (const sv of scored) {
    out.push({ v: out.length + 1, kind: "scored", file: sv.file, at: sv.createdAt || null, range: cut?.range || null, totalDuration: cut?.totalDuration || 0, segments: sv.segments || cut?.segments || [], gainDb: sv.gainDb, baseV: 1, music: sv.music || [] });
  }
  return out;
}

// Ensure db.cutHistory exists (migrating legacy on first touch); returns it.
async function ensureCutHistory(env, pid, db, genSet) {
  if (!Array.isArray(db.cutHistory)) db.cutHistory = await legacyToHistory(env, pid, db, genSet);
  return db.cutHistory;
}
// Next monotonic version across ALL generations (stitch + scored).
async function nextCutV(env, pid, db) {
  return (await ensureCutHistory(env, pid, db)).reduce((m, g) => Math.max(m, g.v || 0), 0) + 1;
}
// Per-take duration map from the selections DB (populated by the live probe).
// Used to REPAIR frozen generations whose segments were stitched before their
// takes had durations cached — otherwise their whole timeline collapses to 0.
function durByFile(db) {
  const m = {};
  for (const entry of Object.values(db.video || {})) {
    const arr = Array.isArray(entry) ? entry : entry ? [entry] : [];
    for (const v of arr) if (v?.file && Number(v.dur) > 0) m[v.file] = Number(v.dur);
  }
  return m;
}

// Backfill missing/zero segment durations on a frozen generation from `durMap`
// and recompute the running start/end timecodes (which the player timeline reads).
// A generation that already has real durations is returned unchanged.
function withDurations(gen, durMap) {
  const segs = gen.segments || [];
  if (!segs.length || segs.every((s) => Number(s.duration) > 0)) return gen;
  let cursor = 0;
  const segments = segs.map((s) => {
    const duration = Number(s.duration) > 0 ? Number(s.duration) : (durMap[s.file] || 0);
    const start = cursor;
    cursor += duration;
    return { ...s, duration, start, end: cursor };
  });
  return {
    ...gen,
    segments,
    totalDuration: Number(gen.totalDuration) > 0 ? gen.totalDuration : cursor,
  };
}

// Re-derive each frozen music cue's start/beatEnd from the (repaired) segment
// timecodes. `cleanMusic` dropped the beat range, so we re-match by track against
// MUSIC_CUES — a scored version stitched with 0-duration segments had every cue
// pinned at 0, which the player timeline would otherwise stack at the far left.
function withMusicTimecodes(gen, segments) {
  if (!gen.music?.length || !segments?.length) return gen;
  const present = segments.filter((s) => s.file);
  const numOf = (s) => bundleNum(s.id);
  const music = gen.music.map((m) => {
    const cue = MUSIC_CUES.find((c) => c.track === m.track);
    if (!cue) return m;
    const firstSeg = present.find((s) => numOf(s) === cue.first);
    if (!firstSeg) return m;
    const inBeat = present.filter((s) => numOf(s) >= cue.first && numOf(s) <= cue.last);
    return { ...m, start: firstSeg.start, beatEnd: inBeat.length ? inBeat[inBeat.length - 1].end : firstSeg.end };
  });
  return { ...gen, music };
}

// Normalized history for the API: existing files only, newest-first, url added,
// and frozen 0-duration segments + music cues repaired from live take durations.
async function getCutHistory(env, pid, db, genSet) {
  const set = genSet || (await listMediaSet(env, pid, "gen"));
  const hist = await ensureCutHistory(env, pid, db, set);
  const durMap = durByFile(db);
  const out = [];
  for (const g of hist) {
    if (g.file && set.has(g.file)) {
      const withSegs = withDurations(g, durMap);
      const repaired = withMusicTimecodes(withSegs, withSegs.segments);
      out.push({ ...repaired, url: "/gen/" + g.file, withMusic: g.kind === "scored" });
    }
  }
  return out.sort((a, b) => (b.v || 0) - (a.v || 0));
}

const freezeSegs = (segs) => segs.filter((s) => s.file).map((s) => ({ id: s.id, file: s.file, name: s.name, fallback: s.fallback, start: s.start, duration: s.duration, end: s.end }));
const cleanMusic = (layout) => layout.map((m) => ({ track: m.track, label: m.label, name: m.name, start: m.start, beatEnd: m.beatEnd, duration: m.duration }));

// Overlay the background-music cues under a base cut video → outFile (R2 "gen").
// Music sits at `gain` (linear) under the baked-in dialogue/SFX; the sum is
// soft-limited. baseFile/outFile are "gen" media; each m.file is "sound-media".
async function mixScore(env, pid, baseFile, layout, gain, outFile) {
  const NORM = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";
  const parts = [`[0:a]${NORM}[a0]`];
  const beds = [];
  layout.forEach((m, i) => {
    const k = i + 1;
    const ms = Math.max(0, Math.round(m.start * 1000));
    parts.push(`[${k}:a]${NORM},adelay=${ms}:all=1,volume=${gain}[m${k}]`);
    beds.push(`[m${k}]`);
  });
  const filter = parts.join(";") + `;[a0]${beds.join("")}amix=inputs=${layout.length + 1}:duration=first:normalize=0,alimiter=limit=0.95[aout]`;
  await runNative(env, {
    binary: "ffmpeg",
    inputs: [
      { id: "base", r2key: mediaKey(pid, "gen", baseFile) },
      ...layout.map((m, i) => ({ id: `m${i}`, r2key: mediaKey(pid, "sound-media", m.file) })),
    ],
    output: { id: "out", r2key: mediaKey(pid, "gen", outFile) },
    args: (r) => [
      "-y", "-i", r("base"),
      ...layout.flatMap((m, i) => ["-i", r(`m${i}`)]),
      "-filter_complex", filter,
      "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
      "-movflags", "+faststart",
      r("out"),
    ],
  });
}

// Find the base generation to score: the most recent base stitch present in R2,
// else the latest present generation. (async port of the Express `.find` chain.)
async function findScoreBase(env, pid, hist, genSet) {
  const set = genSet || (await listMediaSet(env, pid, "gen"));
  const rev = [...hist].reverse();
  for (const g of rev) if (g.kind === "stitch" && set.has(g.file)) return g;
  for (const g of rev) if (g.file && set.has(g.file)) return g;
  return null;
}

export function registerCuts(app) {
  // Read the current plan, the latest generation (`output`), and the full history.
  app.get("/api/episode/cuts", async (c) => {
    try {
      const env = c.env, pid = c.get("projectId");
      const db = await readDB(env, pid);
      if (normalizeVideoSelections(db)) await writeDB(env, pid, db); // heal stale multi-selection first
      // One R2 list of the "gen" bucket, shared across every existence check in
      // this request (segments, history, scored versions) — was ~100 serial HEADs.
      const genSet = await listMediaSet(env, pid, "gen");
      const segments = annotateSegmentsMusic(await buildCutSegments(env, pid, { genSet, db }));
      const music = await buildScoreLayout(env, pid, segments);
      const history = await getCutHistory(env, pid, db, genSet);
      return c.json({ range: segRange(segments), segments, music, output: history[0] || null, history });
    } catch (e) {
      return c.json({ error: String(e.message || e) }, 500);
    }
  });

  // Stitch the SELECTED take of each bundle, in order, into one versioned mp4.
  app.post("/api/episode/stitch", async (c) => {
    try {
      const env = c.env, pid = c.get("projectId");
      const db = await readDB(env, pid);
      if (normalizeVideoSelections(db)) await writeDB(env, pid, db); // stitch the take actually picked
      // Probe durations here so the FROZEN segments carry real timecodes — the
      // player timeline reads them. (Probing is cached, so it's ~free once warm;
      // the concat itself needs only the file order, not the durations.)
      const segments = await buildCutSegments(env, pid, { probe: true, db });
      const usable = segments.filter((s) => s.file);
      if (!usable.length) return c.json({ error: "No rendered takes to stitch" }, 400);

      await ensureCutHistory(env, pid, db);
      const v = await nextCutV(env, pid, db);
      const outFile = cutVersionFile(v);
      const outKey = mediaKey(pid, "gen", outFile);

      const totalDuration = usable.reduce((a, s) => a + s.duration, 0);
      const frozen = freezeSegs(segments);
      const range = segRange(usable);
      const at = new Date().toISOString();
      // Optimistic history entry — getCutHistory filters by mediaExists, so it
      // only surfaces once the async concat job writes the file to R2.
      db.cutHistory.push({ v, kind: "stitch", file: outFile, at, range, totalDuration, segments: frozen });
      db.cut = { range, segments: frozen, totalDuration, stitchedAt: at }; // legacy pointer
      await writeDB(env, pid, db);

      // The full-episode concat is long + its output is large (>100MB), so it
      // runs as an async Daytona job: pull each take from /files, concat, and
      // upload_r2 (single PUT or chunked multipart) the result. All takes share
      // codec/res/fps so a stream copy works, with a re-encode fallback.
      const base = (env.WORKER_PUBLIC_URL || "").replace(/\/+$/, "");
      const jd = `/tmp/stitch_${crypto.randomUUID()}`;
      const pulls = usable.map((s, i) => `curl -fsS -o in${i}.mp4 ${base}/files/${mediaKey(pid, "gen", s.file)}`).join("\n");
      const listContent = usable.map((s, i) => `file 'in${i}.mp4'`).join("\n") + "\n";
      const CONCAT = "-y -f concat -safe 0 -i list.txt";
      const script = [
        "set -e", uploadFnBash(),
        `BASE=${base}`, `TOKEN=${env.INGEST_TOKEN}`,
        `rm -rf ${jd} && mkdir -p ${jd} && cd ${jd}`,
        pulls,
        `printf %s ${b64(listContent)} | base64 -d > list.txt`,
        `ffmpeg ${CONCAT} -c copy -fflags +genpts -movflags +faststart out.mp4 || ffmpeg ${CONCAT} -c:v libx264 -preset veryfast -crf 18 -c:a aac -b:a 192k -vsync cfr -r 24 -movflags +faststart out.mp4`,
        `upload_r2 out.mp4 ${outKey}`,
        `rm -rf ${jd}`,
      ].join("\n");

      const jobId = await createJob(env, "stitch");
      try {
        const sandbox = await getSandbox(env);
        await startSandboxJob(env, jobId, sandbox, script, "/gen/" + outFile);
      } catch (e) {
        return c.json({ error: `Could not start stitch: ${e.message || e}` }, 502);
      }
      return c.json({ ok: true, jobId, url: "/gen/" + outFile, file: outFile, version: v, kind: "stitch", totalDuration, count: usable.length });
    } catch (e) {
      return c.json({ error: String(e.message || e) }, 500);
    }
  });

  // Overlay the background-music cues under the latest music-FREE base cut → a NEW
  // versioned scored generation (previous versions are kept for A/B). Music sits
  // low under the baked-in dialogue/SFX; peaks are soft-limited.
  app.post("/api/episode/score", async (c) => {
    try {
      const env = c.env, pid = c.get("projectId");
      let body;
      try { body = await c.req.json(); } catch { body = {}; }
      const db = await readDB(env, pid);
      await ensureCutHistory(env, pid, db);
      // Score the most recent base stitch (clean overlay), else the latest cut.
      const base = await findScoreBase(env, pid, db.cutHistory);
      if (!base) return c.json({ error: "Stitch the cut first" }, 400);

      // Use the base's FROZEN segments so the music timecodes match its video.
      const baseSegs = base.segments && base.segments.length ? base.segments : freezeSegs(await buildCutSegments(env, pid));
      const layout = await buildScoreLayout(env, pid, baseSegs);
      if (!layout.length) return c.json({ error: "No rendered music cues to add" }, 400);

      const gain = typeof body?.gain === "number" && body.gain > 0 ? body.gain : MUSIC_BED_GAIN;
      const v = await nextCutV(env, pid, db);
      const file = cutVersionFile(v);
      await mixScore(env, pid, base.file, layout, gain, file);

      const entry = {
        v, kind: "scored", file, at: new Date().toISOString(),
        range: base.range || segRange(baseSegs),
        totalDuration: base.totalDuration || baseSegs.reduce((a, s) => a + (s.duration || 0), 0),
        // Freeze the full setup this scored mp4 was baked from (background takes +
        // timecodes AND the music cues) so its overlay always matches THIS version.
        segments: baseSegs,
        gainDb: Math.round(20 * Math.log10(gain)),
        baseV: base.v,
        music: cleanMusic(layout),
      };
      db.cutHistory.push(entry);
      await writeDB(env, pid, db);

      return c.json({ ok: true, version: v, url: "/gen/" + file, file, gainDb: entry.gainDb, count: layout.length, music: entry.music });
    } catch (e) {
      return c.json({ error: String(e.message || e) }, 500);
    }
  });

  // Trim a rendered take to a sub-range [from, to] seconds → a NEW "trim" version
  // stored ALONGSIDE the original (the source take is never mutated, so it stays in
  // history and remains selectable). The trim take carries kind:"trim", a sourceFile
  // link, and its trim:{start,end}; the /api/episode selection + stitch flow keys on
  // `file`, so a trim is picked/stitched exactly like any other take. ffmpeg cuts a
  // frame-accurate re-encode (clips are short) so the cut lands where the handle sat.
  app.post("/api/episode/trim", async (c) => {
    try {
      const env = c.env, pid = c.get("projectId");
      let body;
      try { body = await c.req.json(); } catch { body = {}; }
      let { bundle, sourceFile, from, to } = body || {};
      if (!bundle || !sourceFile) return c.json({ error: "Missing 'bundle' or 'sourceFile'" }, 400);
      from = Number(from);
      to = Number(to);
      if (!Number.isFinite(from) || !Number.isFinite(to)) return c.json({ error: "'from' and 'to' must be numbers (seconds)" }, 400);

      const db = await readDB(env, pid);
      db.video = db.video || {};
      let list = db.video[bundle];
      list = Array.isArray(list) ? list : list ? [list] : [];
      const srcIdx = list.findIndex((v) => v.file === sourceFile);
      if (srcIdx < 0) return c.json({ error: "Source take not found" }, 404);
      const src = list[srcIdx];
      if (!(await mediaExists(env, pid, "gen", sourceFile))) return c.json({ error: "Source file missing on disk" }, 404);

      // Clamp the range to the source clip and enforce a minimum length.
      const srcDur = await probeDuration(env, pid, sourceFile);
      from = Math.max(0, from);
      if (srcDur > 0) to = Math.min(to, srcDur);
      if (to - from < 0.1) return c.json({ error: "Trim range must be at least 0.1s ('to' after 'from')" }, 400);

      // Name derived from the source, versioned so repeated trims never collide and
      // the original is always kept: <sourceBase>_trimN.mp4.
      const baseName = sourceFile.replace(/\.mp4$/i, "");
      const trimCount = list.filter((v) => v.kind === "trim" && v.sourceFile === sourceFile).length;
      const file = `${baseName}_trim${trimCount + 1}.mp4`;

      // -ss before -i seeks fast AND accurately when re-encoding; -t (duration) is
      // unambiguous (unlike -to, whose reference point depends on -ss placement).
      await runNative(env, {
        binary: "ffmpeg",
        inputs: [{ id: "src", r2key: mediaKey(pid, "gen", sourceFile) }],
        output: { id: "out", r2key: mediaKey(pid, "gen", file) },
        args: (r) => [
          "-y", "-ss", String(from), "-i", r("src"), "-t", String(to - from),
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
          "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
          r("out"),
        ],
      });

      const trim = { start: Number(from.toFixed(3)), end: Number(to.toFixed(3)) };
      const take = {
        file,
        name: `${src.name || "gen"} · trim`,
        kind: "trim",
        sourceFile,
        trim,
        jobId: src.jobId || null,
        ts: new Date().toISOString(),
      };
      // Insert right after the source so the trim card sits next to its original in
      // the carousel; not selected on creation (the user picks it in the UI).
      list.splice(srcIdx + 1, 0, take);
      db.video[bundle] = list;
      await writeDB(env, pid, db);
      return c.json({ ok: true, bundle, file, name: take.name, kind: "trim", trim, count: list.length, url: "/gen/" + file });
    } catch (e) {
      return c.json({ error: String(e.message || e) }, 500);
    }
  });
}
