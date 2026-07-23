// Episode endpoints, ported from server/index.js (/api/final, /api/audio,
// /api/episode*). Backed by the R2 doc store `state/<projectId>/selections.json`
// (the de-facto DB, formerly `episode-multishot/selections.json`) and the
// episode manifest doc `state/<projectId>/episode-manifest.json` (formerly
// `episode-multishot/multishot_bundles.json`).
//
// MEDIA/FFMPEG NOTE: media lives in R2 now. Filesystem scans/existence checks are
// replaced by `listMedia`/`mediaExists`; media URLs stay as the SAME paths
// Express emitted (`/gen/<file>`, `/final/<file>`, `/asset/<rel>`) — a later
// stage repoints these to R2 streaming. The ffmpeg endpoints (/cuts, /stitch,
// /score, /trim) are intentionally NOT ported here (handled separately). See the
// TODO markers for the media-copy step still owed.
import { readDoc, writeDoc } from "../lib/docs.js";
import { listMedia, listMediaSet } from "../lib/media.js";
import { buildBundles } from "../lib/pack.js";
import { normalizeShot } from "../lib/shots.js";

// The de-facto selections DB (library picks + per-bundle episode selections).
const readDB = (env, pid) => readDoc(env, pid, "selections", { library: {}, episode: {} });
const writeDB = (env, pid, db) => writeDoc(env, pid, "selections", db);
// The episode manifest (the packed <=15s bundles); null when not seeded.
const readManifest = (env, pid) => readDoc(env, pid, "episode-manifest", null);
const writeManifest = (env, pid, m) => writeDoc(env, pid, "episode-manifest", m);
// Current shot list, normalized (same source the animatic/radio read from).
const readShots = async (env, pid) => {
  const obj = await readDoc(env, pid, "shotlist", null);
  return (obj?.shots || []).map(normalizeShot);
};
// A bundle's identity for membership matching = its sorted set of shot ids.
const bundleSig = (b) => (b.shots || []).map((s) => s.id).sort().join(",");

// Image extensions accepted in the final-selection pool (was IMG_RE).
const IMG_RE = /\.(png|jpe?g|webp|gif)$/i;

// Voice/sound references (NOT dialogue) — identity locks for the speakers.
// `order` is the speaker order inside the (combined) clip, stated in the prompt.
const AUDIO_REFS = [
  { rel: "audio-as-video-refs/sara_voice_reference.mp4", label: "Sara — voice", order: ["Sara"] },
  { rel: "audio-as-video-refs/helena_voice_reference.mp4", label: "Helena — voice", order: ["Helena"] },
  { rel: "draft-2/references/forest_king_voice_ref.wav", label: "Forest King — voice", order: ["Forest King"] },
  { rel: "audio-as-video-refs/sara_helena_combined_reference.mp4", label: "Sara + Helena — combined", order: ["Sara", "Helena"] },
  { rel: "draft-2/references/combined_3voice_reference.wav", label: "Sara + Helena + Forest King — combined", order: ["Sara", "Helena", "Forest King"] },
];
const A = { sara: AUDIO_REFS[0].rel, helena: AUDIO_REFS[1].rel, king: AUDIO_REFS[2].rel, sh: AUDIO_REFS[3].rel, shk: AUDIO_REFS[4].rel };
// Pick the best single voice reference for the speakers present in a bundle.
function pickAudio(chars) {
  const s = chars.has("Sara"), h = chars.has("Helena"), k = chars.has("Forest King");
  if (k && (s || h)) return A.shk; // covers S+K, H+K, S+H+K
  if (s && h) return A.sh;
  if (s) return A.sara;
  if (h) return A.helena;
  if (k) return A.king;
  return null;
}

// Classify a library image by filename into semantic tags (character / location).
// Supporting cast (parents/teacher/classmates) are NOT main characters — they
// never appear in this episode's shots, so they must not match Sara/Helena.
function classifyRef(rel) {
  const base = String(rel).split("/").pop().toLowerCase();
  const tags = new Set();
  const supporting = /(father|mother|parent|teacher|bramble|classmate|bryn|pip|titch)/.test(base);

  // locations first
  if (base.includes("king") && base.includes("house")) tags.add("loc:kings-house");
  else if (base.includes("deep") && base.includes("forest")) tags.add("loc:deep-wood");
  else if (base.includes("forest") && base.includes("night")) tags.add("loc:forest-night");
  else if (base.includes("forest")) tags.add("loc:forest");
  if (base.includes("classroom")) tags.add("loc:classroom");
  if (base.includes("school")) tags.add("loc:school");

  // main characters only (skip the supporting cast); night versions get a
  // "-night" suffix so late scenes can prefer them.
  if (!supporting) {
    const night = base.includes("night");
    const suf = night ? "-night" : "";
    if (base.includes("sara")) tags.add("char:Sara" + suf);
    if (base.includes("helena")) tags.add("char:Helena" + suf);
    if (base.includes("mote") || base.includes("glow")) tags.add("char:Mote" + suf);
    if (base.includes("king") && !base.includes("house")) tags.add("char:Forest King" + suf);
    if (base.includes("kids")) tags.add("char:Elf kids"); // school-yard fill kids
  }
  return tags;
}

// What a bundle needs, as an ordered list of role requirements. Each requirement
// is a priority list of candidate tags (first available image wins) — so a night
// scene prefers forest-night but falls back to day forest if none is selected.
// Beats that play at dusk/night — used to pick night character + forest refs.
// (Beat-level, not group-level: the B7 rescue happens at the hollow at night,
// but the "hollow" group also holds the daytime B3/B4H scenes.)
const NIGHT_BEATS = new Set(["B5H", "B6H", "B6S", "B7", "B8"]);
function bundleRequirements(bundle) {
  const reqs = [];
  const night = NIGHT_BEATS.has(bundle.beat);
  for (const c of new Set(bundle.shots.flatMap((s) => s.characters || []))) {
    // late scenes prefer the night character version, fall back to day
    reqs.push(night ? ["char:" + c + "-night", "char:" + c] : ["char:" + c]);
  }
  for (const im of bundle.images || []) {
    if (im.role !== "location") continue;
    const k = im.key;
    if (k === "deep-wood") reqs.push(["loc:deep-wood", "loc:forest-night", "loc:forest"]);
    else if (k.includes("kings-house")) reqs.push(["loc:kings-house"]);
    else if (k.includes("school")) reqs.push(["loc:school"]);
    else if (k.includes("classroom")) reqs.push(["loc:classroom"]);
    else if (k.includes("forest")) {
      reqs.push(night ? ["loc:forest-night", "loc:forest"] : ["loc:forest"]);
    }
  }
  return reqs;
}

// Revision signing: the SECTIONS of a bundle that can be signed off independently.
const SIGN_SECTIONS = new Set(["images", "prompt", "audio"]);

// Sort key deciding which selected take wins when more than one is flagged:
// most-recently SELECTED first, then most-recently generated. Guards against
// legacy/raced data where two takes ended up selected at once.
const selKey = (v) => Date.parse(v?.selectedAt) || Date.parse(v?.ts) || 0;

// Collapse any bundle that ended up with >1 selected take down to the single
// most-recently-selected one, so the UI, the disk, and the stitch always agree.
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

export function registerEpisode(app) {
  // The final_selection pool (what shows on the episode tab as reference previews).
  app.get("/api/final", async (c) => {
    const pid = c.get("projectId");
    const db = await readDB(c.env, pid);
    const files = (await listMedia(c.env, pid, "final")).filter((f) => IMG_RE.test(f));
    const items = files.sort().map((name) => ({
      name,
      url: "/final/" + name,
      origin: name.split("__").join("/"),
    }));
    return c.json({ final: items, episode: db.episode || {} });
  });

  // Available voice/sound references + current per-bundle audio picks.
  app.get("/api/audio", async (c) => {
    const pid = c.get("projectId");
    const db = await readDB(c.env, pid);
    const items = AUDIO_REFS.map((a) => ({
      ...a,
      url: "/asset/" + a.rel,
      exists: true, // TODO(stage2): check the reference object exists in R2.
    }));
    return c.json({ audio: items, episode: db.episodeAudio || {} });
  });

  // Toggle a voice reference for one bundle.
  app.post("/api/episode/audio-select", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const { bundle, rel, selected } = body || {};
    if (!bundle || !rel) return c.json({ error: "Missing 'bundle' or 'rel'" }, 400);
    const db = await readDB(c.env, pid);
    db.episodeAudio = db.episodeAudio || {};
    const cur = new Set(db.episodeAudio[bundle] || []);
    if (selected) cur.add(rel);
    else cur.delete(rel);
    db.episodeAudio[bundle] = [...cur];
    await writeDB(c.env, pid, db);
    return c.json({ ok: true, bundle, selected: db.episodeAudio[bundle] });
  });

  // Revision signing: sign off one SECTION of a bundle (images | prompt | audio).
  // Each section is an independent signature { by, at }; clearing sets it null.
  app.post("/api/episode/sign", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const { bundle, section, signed, signedBy } = body || {};
    if (!bundle || !SIGN_SECTIONS.has(section))
      return c.json({ error: "Missing 'bundle' or invalid 'section'" }, 400);
    if (signed && !String(signedBy || "").trim())
      return c.json({ error: "Missing 'signedBy'" }, 400);
    const db = await readDB(c.env, pid);
    db.signoffs = db.signoffs || {};
    const cur = db.signoffs[bundle] || { images: null, prompt: null, audio: null };
    cur[section] = signed ? { by: String(signedBy).trim(), at: new Date().toISOString() } : null;
    db.signoffs[bundle] = cur;
    await writeDB(c.env, pid, db);
    return c.json({ ok: true, bundle, signoff: cur });
  });

  // Toggle a final-selection image as a chosen reference for one bundle/scene.
  app.post("/api/episode/select", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const { bundle, rel, selected } = body || {};
    if (!bundle || !rel) return c.json({ error: "Missing 'bundle' or 'rel'" }, 400);
    const db = await readDB(c.env, pid);
    db.episode = db.episode || {};
    const cur = new Set(db.episode[bundle] || []);
    if (selected) cur.add(rel);
    else cur.delete(rel);
    db.episode[bundle] = [...cur];
    await writeDB(c.env, pid, db);
    return c.json({ ok: true, bundle, selected: db.episode[bundle] });
  });

  // Auto-assign: match each bundle's needs to the library-selected images and
  // write the per-shot picks. With no body it replaces existing picks for EVERY
  // bundle; `{ beat: "B1" }` scopes the run to that beat's bundles and leaves
  // every other bundle's picks untouched.
  app.post("/api/episode/auto-assign", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const beat = typeof body?.beat === "string" && body.beat.trim()
      ? body.beat.trim().toUpperCase()
      : null;
    const manifest = await readManifest(c.env, pid);
    if (!manifest) return c.json({ error: "No episode manifest" }, 400);
    const targets = beat
      ? manifest.bundles.filter((b) => String(b.beat).toUpperCase() === beat)
      : manifest.bundles;
    if (!targets.length) return c.json({ error: `No bundles in beat '${beat}'` }, 400);
    const db = await readDB(c.env, pid);
    const selected = Object.keys(db.library || {}).filter((r) => db.library[r]);
    const tagged = selected.map((rel) => ({ rel, tags: classifyRef(rel) }));

    let totalAssigned = 0;
    const summary = {};
    if (!beat) {
      db.episode = {};
      db.episodeAudio = {};
    }
    db.episode = db.episode || {};
    db.episodeAudio = db.episodeAudio || {};
    for (const b of targets) {
      const reqs = bundleRequirements(b);
      // one image per role; for each role try its candidate tags in priority order
      const matched = [];
      for (const req of reqs) {
        let hit = null;
        for (const tag of req) {
          hit = tagged.find((t) => t.tags.has(tag) && !matched.includes(t.rel));
          if (hit) break;
        }
        if (hit) matched.push(hit.rel);
      }
      db.episode[b.id] = matched;
      summary[b.id] = matched.length;
      totalAssigned += matched.length;

      // audio: one voice reference per bundle based on speaking characters present
      const chars = new Set(b.shots.flatMap((s) => s.characters || []));
      const audioRel = pickAudio(chars);
      db.episodeAudio[b.id] = audioRel ? [audioRel] : [];
    }
    await writeDB(c.env, pid, db);
    return c.json({ ok: true, beat, bundles: targets.length, totalAssigned, summary });
  });

  // Rebuild the episode plan (the packed <=15s bundles) from the CURRENT shot
  // list, so the manifest stops being a frozen offline artifact and tracks shot
  // edits. Bundle ids are positional (MS-NN) and `db.stills`/`db.video`/ref-picks/
  // signoffs are all bundle-keyed, so a naive rebuild would orphan generated media.
  // This remap is LOSSLESS where it matters:
  //   - stills: re-keyed by SHOT id onto each shot's new bundle (never dropped)
  //   - rendered videos: carried to the new bundle the OLD bundle's shots mostly
  //     landed in (renders are expensive — never dropped while any shot survives)
  //   - ref-picks / audio-picks / prompt / signoffs: kept only for bundles whose
  //     shot membership is UNCHANGED; a re-packed bundle correctly needs re-review.
  app.post("/api/episode/rebuild", async (c) => {
    const pid = c.get("projectId");
    const shots = await readShots(c.env, pid);
    if (!shots.length) return c.json({ error: "No shot list yet — write a shot list first." }, 400);

    const bundles = buildBundles(shots);
    const prev = await readManifest(c.env, pid);
    const prevBundles = prev?.bundles || [];

    // shot id -> new bundle id
    const shotToNew = {};
    for (const b of bundles) for (const s of b.shots) shotToNew[s.id] = b.id;
    // old bundle membership signature -> old bundle id (for unchanged-bundle carryover)
    const oldBySig = {};
    for (const b of prevBundles) oldBySig[bundleSig(b)] = b.id;
    // new bundle id -> old bundle id when membership is identical
    const sameOld = {};
    for (const b of bundles) { const o = oldBySig[bundleSig(b)]; if (o) sameOld[b.id] = o; }

    const db = await readDB(c.env, pid);

    // (1) stills: remap by shot id — lossless.
    const newStills = {};
    let stillsMoved = 0, stillsOrphaned = 0;
    for (const shotsMap of Object.values(db.stills || {})) {
      for (const [shotId, takes] of Object.entries(shotsMap || {})) {
        const nb = shotToNew[shotId];
        if (!nb) { stillsOrphaned++; continue; }
        (newStills[nb] ||= {})[shotId] = ((newStills[nb][shotId]) || []).concat(takes);
        stillsMoved++;
      }
    }

    // (2) videos: carry each old bundle's renders to whichever new bundle the
    //     majority of its shots landed in (dropped only if all its shots vanished).
    const newVideo = {};
    let videoMoved = 0, videoOrphaned = 0;
    for (const [oldB, entry] of Object.entries(db.video || {})) {
      const arr = Array.isArray(entry) ? entry : entry ? [entry] : [];
      if (!arr.length) continue;
      const oldShotIds = (prevBundles.find((b) => b.id === oldB)?.shots || []).map((s) => s.id);
      const counts = {};
      for (const sid of oldShotIds) { const nb = shotToNew[sid]; if (nb) counts[nb] = (counts[nb] || 0) + 1; }
      const target = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (target) { newVideo[target] = (newVideo[target] || []).concat(arr); videoMoved += arr.length; }
      else videoOrphaned += arr.length;
    }

    // (3) per-bundle selection data: keep only for unchanged-membership bundles.
    const carryUnchanged = (obj) => {
      const next = {};
      for (const b of bundles) { const o = sameOld[b.id]; if (o && obj?.[o] != null) next[b.id] = obj[o]; }
      return next;
    };

    db.stills = newStills;
    db.video = newVideo;
    db.episode = carryUnchanged(db.episode);
    db.episodeAudio = carryUnchanged(db.episodeAudio);
    db.prompt = carryUnchanged(db.prompt);
    db.signoffs = carryUnchanged(db.signoffs);

    await writeManifest(c.env, pid, {
      ...(prev && typeof prev === "object" ? prev : {}),
      title: prev?.title || "Episode plan",
      totalShots: shots.length,
      generatedAt: new Date().toISOString(),
      source: "rebuild",
      bundles,
    });
    await writeDB(c.env, pid, db);

    const unchanged = Object.keys(sameOld).length;
    return c.json({
      ok: true,
      bundles: bundles.length,
      previousBundles: prevBundles.length,
      unchanged,
      repacked: bundles.length - unchanged,
      stillsMoved, stillsOrphaned,
      videoMoved, videoOrphaned,
    });
  });

  // Full-episode multishot plan: the packed <=15s bundles + per-bundle skill prompt.
  app.get("/api/episode", async (c) => {
    const pid = c.get("projectId");
    const manifest = await readManifest(c.env, pid);
    if (!manifest) return c.json({ episode: null });
    const db = await readDB(c.env, pid);
    if (normalizeVideoSelections(db)) await writeDB(c.env, pid, db); // heal stale multi-selection
    // Attach a list of rendered clips (newest last) for every bundle that has any
    // in R2. db.video[id] is an array of generations; tolerate the old single
    // object shape too. One R2 list (into a Set) replaces a per-take HEAD storm:
    // this used to fire one serial `mediaExists` per generation (100+ round-trips
    // for a full episode) — now it's a single list + in-memory membership checks.
    const genSet = await listMediaSet(c.env, pid, "gen");
    const video = {};
    for (const [id, entry] of Object.entries(db.video || {})) {
      const arr = Array.isArray(entry) ? entry : entry ? [entry] : [];
      const list = [];
      for (const v of arr) {
        if (v && v.file && genSet.has(v.file)) {
          list.push({ ...v, name: v.name || `gen ${list.length + 1}`, url: "/gen/" + v.file });
        }
      }
      if (list.length) video[id] = list;
    }
    return c.json({ episode: manifest, video, prompts: db.prompt || {}, signoffs: db.signoffs || {}, firstFrames: db.episodeFirstFrame || {} });
  });

  // Choose (or clear) the FIRST FRAME for a bundle's video render — a storyboard
  // still the Seedance clip should open on (passed as start_image). Stored per
  // bundle as { shot, file }; `file:null` (or omitted) clears it.
  app.post("/api/episode/first-frame", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const { bundle, shot, file } = body || {};
    if (!bundle) return c.json({ error: "Missing 'bundle'" }, 400);
    const db = await readDB(c.env, pid);
    db.episodeFirstFrame = db.episodeFirstFrame || {};
    if (file) db.episodeFirstFrame[bundle] = { shot: shot || null, file };
    else delete db.episodeFirstFrame[bundle];
    await writeDB(c.env, pid, db);
    return c.json({ ok: true, bundle, firstFrame: db.episodeFirstFrame[bundle] || null });
  });

  // Mark a rendered generation as selected/deselected (for stitching later).
  app.post("/api/episode/video-select", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const { bundle, file, selected } = body || {};
    if (!bundle || !file) return c.json({ error: "Missing 'bundle' or 'file'" }, 400);
    const db = await readDB(c.env, pid);
    const arr = Array.isArray(db.video?.[bundle]) ? db.video[bundle] : db.video?.[bundle] ? [db.video[bundle]] : [];
    const g = arr.find((v) => v.file === file);
    if (!g) return c.json({ error: "Generation not found" }, 404);
    g.selected = !!selected;
    // Single-selection: picking a take clears any other selected take in the
    // bundle and stamps WHEN it was picked, so the most recent pick wins at
    // stitch time even if stale flags linger.
    if (g.selected) {
      g.selectedAt = new Date().toISOString();
      arr.forEach((v) => { if (v.file !== file) v.selected = false; });
    }
    db.video = db.video || {};
    db.video[bundle] = arr;
    await writeDB(c.env, pid, db);
    return c.json({ ok: true, bundle, file, selected: g.selected });
  });

  // Save (or clear) an edited skill prompt for one bundle. Empty/omitted text
  // clears the override so the bundle falls back to the live-composed prompt.
  app.post("/api/episode/prompt", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const { bundle, text } = body || {};
    if (!bundle) return c.json({ error: "Missing 'bundle'" }, 400);
    const db = await readDB(c.env, pid);
    db.prompt = db.prompt || {};
    if (typeof text === "string" && text.length) db.prompt[bundle] = text;
    else delete db.prompt[bundle];
    await writeDB(c.env, pid, db);
    return c.json({ ok: true, bundle, saved: !!db.prompt[bundle] });
  });

  // Attach a rendered Seedance clip to a bundle. APPENDS a new generation (keeps
  // prior ones) and records it as generations/<bundle>_genN.mp4.
  app.post("/api/episode/video", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const { bundle, url, jobId } = body || {};
    if (!bundle || !url) return c.json({ error: "Missing 'bundle' or 'url'" }, 400);
    const db = await readDB(c.env, pid);
    db.video = db.video || {};
    // normalize to an array (migrate old single-object / legacy <bundle>.mp4 entry)
    let list = db.video[bundle];
    list = Array.isArray(list) ? list : list ? [list] : [];
    const n = list.length + 1;
    const file = `${bundle}_gen${n}.mp4`;
    // TODO(stage2): put media into R2 via putMedia — download `url` and store it
    // as the "gen" media object for `file` (Express fetched + wrote it to disk).
    // When implemented, also kick off a preview proxy here:
    //   c.executionCtx.waitUntil(ensureProxy(c.env, { pid, kind: "gen", file }));
    // Until then, gens land in R2 only via /ingest* (which already hooks
    // ensureProxy) or the backfill job / lazy /proxy fallback.
    list.push({ file, name: `gen ${n}`, jobId: jobId || null, source: url, ts: new Date().toISOString() });
    db.video[bundle] = list;
    await writeDB(c.env, pid, db);
    return c.json({ ok: true, bundle, name: `gen ${n}`, count: list.length, url: "/gen/" + file });
  });
}
