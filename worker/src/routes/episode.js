// Episode endpoints, ported from server/index.js (/api/final, /api/audio,
// /api/episode*). Backed by the D1 doc store (`docs` row `selections`)
// (the de-facto DB, formerly `episode-multishot/selections.json`) and the
// episode manifest doc (`docs` row `episode-manifest`, formerly
// `episode-multishot/multishot_bundles.json`).
//
// MEDIA/FFMPEG NOTE: media lives in R2 now. Filesystem scans/existence checks are
// replaced by `listMedia`/`mediaExists`; media URLs stay as the SAME paths
// Express emitted (`/gen/<file>`, `/final/<file>`, `/asset/<rel>`) — a later
// stage repoints these to R2 streaming. The ffmpeg endpoints (/cuts, /stitch,
// /score, /trim) are intentionally NOT ported here (handled separately). See the
// TODO markers for the media-copy step still owed.
import { readDoc, updateDoc } from "../lib/docs.js";
import { listMedia, listMediaSet, mediaKey, filesUrl, putMedia } from "../lib/media.js";
import { ensureProxy } from "../lib/proxy.js";
import { buildBundles, charKey, bundleSpeakers } from "../lib/pack.js";
import { normalizeShot } from "../lib/shots.js";
import { SEED_PROMPTS } from "./visual-world.js";

// The de-facto selections DB (library picks + per-bundle episode selections).
const DB_FALLBACK = { library: {}, episode: {} };
const readDB = (env, pid) => readDoc(env, pid, "selections", DB_FALLBACK);
// CONCURRENCY: `selections` is the SHARED de-facto DB (Library, Editor, Cuts,
// Script and Storyboard all live in it), so a readDoc→writeDoc pair writes the
// whole document back and reverts whatever another surface changed in between.
// Mutations go through `editDB` — compare-and-swap on the doc version. `mutate`
// may re-run, so keep it pure: do renders, probes and media writes BEFORE it.
const editDB = (env, pid, mutate, opts) => updateDoc(env, pid, "selections", DB_FALLBACK, mutate, opts);
// The episode manifest (the packed <=15s bundles); null when not seeded.
const readManifest = (env, pid) => readDoc(env, pid, "episode-manifest", null);
// Current shot list, normalized (same source the animatic/radio read from).
const readShots = async (env, pid) => {
  const obj = await readDoc(env, pid, "shotlist", null);
  return (obj?.shots || []).map(normalizeShot);
};
// A bundle's identity for membership matching = its sorted set of shot ids.
const bundleSig = (b) => (b.shots || []).map((s) => s.id).sort().join(",");

// Image extensions accepted in the final-selection pool (was IMG_RE).
const IMG_RE = /\.(png|jpe?g|webp|gif)$/i;

// ---- World-roster reference sourcing ---------------------------------------
// The World bible (state/<pid>/world.json) is the SINGLE source of truth for
// reference material: each character carries its linked sheet image (an asset-
// library rel) and its linked Sound Studio voice; each location carries its
// sheet keyed by slug (the shot-list `location` string). Auto-assign reads ONLY
// from this roster — it never guesses from filenames and never falls back to
// loose per-project reference files.
const readWorld = (env, pid) => readDoc(env, pid, "world", { characters: [], locations: [] });

// Stable per-bundle audio pick id for a World character's voice. Keyed by the
// CHARACTER (not the take), so re-linking a new voice take doesn't orphan picks.
const worldVoiceRel = (ch) => "world-voice:" + (ch.id || charKey(ch.name));

// The audio-reference pool entries contributed by the World roster: one per
// character with a linked voice. `refUrl` is the ungated absolute /files URL an
// anonymous fetcher (the render agent / Higgsfield import) can pull — the
// stored project-scoped `/sound-media/...` url needs the project header (same
// trick as radio.js voiceRef.refUrl).
function worldVoicePool(env, pid, world) {
  const out = [];
  for (const ch of world.characters || []) {
    const name = String(ch.name || "").trim();
    const vref = ch.voiceRef;
    if (!name || !vref?.url) continue;
    const m = /\/sound-media\/(.+)$/.exec(vref.url);
    out.push({
      rel: worldVoiceRel(ch),
      label: `${name} — voice`,
      order: [name],
      character: name,
      url: vref.url,
      refUrl: m ? filesUrl(env, mediaKey(pid, "sound-media", m[1])) : "",
      trackId: vref.trackId || null,
      v: vref.v ?? null,
      source: "world",
      exists: true,
    });
  }
  return out;
}

// Legacy loose voice-reference files (the original hand-managed pool). Listed
// ONLY when the file actually exists in THIS project's asset space, so another
// project's clips never show up as available refs here. Never auto-assigned.
const LEGACY_AUDIO_REFS = [
  { rel: "audio-as-video-refs/sara_voice_reference.mp4", label: "Sara — voice", order: ["Sara"] },
  { rel: "audio-as-video-refs/helena_voice_reference.mp4", label: "Helena — voice", order: ["Helena"] },
  { rel: "draft-2/references/forest_king_voice_ref.wav", label: "Forest King — voice", order: ["Forest King"] },
  { rel: "audio-as-video-refs/sara_helena_combined_reference.mp4", label: "Sara + Helena — combined", order: ["Sara", "Helena"] },
  { rel: "draft-2/references/combined_3voice_reference.wav", label: "Sara + Helena + Forest King — combined", order: ["Sara", "Helena", "Forest King"] },
];
async function legacyAudioPool(env, pid) {
  const found = await Promise.all(
    LEGACY_AUDIO_REFS.map(async (a) => {
      const head = await env.BUCKET.head(mediaKey(pid, "asset", a.rel));
      return head ? { ...a, url: "/asset/" + a.rel, source: "legacy", exists: true } : null;
    }),
  );
  return found.filter(Boolean);
}

// Roster lookup maps shared by auto-assign and needs validation: characters by
// charKey(name), locations by slug (the shot-list `location` string).
function rosterMaps(world) {
  const chars = new Map();
  for (const ch of world?.characters || []) {
    const k = charKey(ch.name);
    if (k && !chars.has(k)) chars.set(k, ch);
  }
  const locs = new Map();
  for (const l of world?.locations || []) {
    const slug = String(l.slug || "").trim();
    if (slug && !locs.has(slug)) locs.set(slug, l);
  }
  return { chars, locs };
}

// ---- Scene-needs validation -------------------------------------------------
// A bundle's needs live in the manifest (bundle.images = the location/character
// entries "Build episode plan" derived from the shots, bundle.speakers = who has
// dialogue). An IMAGE need is fulfilled when the bundle's picked refs contain
// either the need's World sheet image (auto-match) or a ref the user explicitly
// linked to that need (db.needLinks[bundle][needId]). A VOICE need is fulfilled
// when a picked audio ref covers that speaker. `enforced` is false when the
// World roster is empty (the legacy offline-built Whistlewood project), keeping
// signing ungated there exactly as before needs existed.
const needIdOf = (im) => `${im.role}:${im.key}`;

// Which speakers the picked audio refs cover (a Set of charKeys): a world-voice
// pick covers its character; a legacy loose ref covers the names in its `order`.
function audioCoverage(maps, audioRels) {
  const byRel = new Map();
  for (const ch of maps.chars.values()) byRel.set(worldVoiceRel(ch), ch.name);
  const covered = new Set();
  for (const rel of audioRels || []) {
    const worldName = byRel.get(rel);
    if (worldName) { covered.add(charKey(worldName)); continue; }
    const legacy = LEGACY_AUDIO_REFS.find((a) => a.rel === rel);
    for (const n of legacy?.order || []) covered.add(charKey(n));
  }
  return covered;
}

function needsStateFor(b, maps, db) {
  const links = db.needLinks?.[b.id] || {};
  const picks = new Set(db.episode?.[b.id] || []);
  const covered = audioCoverage(maps, db.episodeAudio?.[b.id]);
  const needs = (b.images || []).map((im) => {
    const id = needIdOf(im);
    const sheetRel = im.role === "location"
      ? maps.locs.get(im.key)?.sheetImage?.rel || null
      : maps.chars.get(charKey(im.key))?.sheetImage?.rel || null;
    const link = links[id] && picks.has(links[id]) ? links[id] : null;
    const auto = sheetRel && picks.has(sheetRel) ? sheetRel : null;
    return {
      id, key: im.key, role: im.role,
      sheetRel,                    // the World sheet rel that auto-fulfills this need
      link: links[id] || null,     // stored manual link (may point at a removed pick)
      fulfilled: !!(link || auto),
      via: link || auto,           // the picked rel actually covering it
    };
  });
  const voice = (b.speakers || []).map((name) => ({
    id: "voice:" + name, name, fulfilled: covered.has(charKey(name)),
  }));
  return {
    needs, voice,
    enforced: maps.chars.size > 0 || maps.locs.size > 0,
    complete: {
      images: needs.every((n) => n.fulfilled),
      audio: voice.every((v) => v.fulfilled),
    },
  };
}

// ---- Episode render style ---------------------------------------------------
// Which visual-world style preset (Settings › Style prompts) is prepended to
// each bundle's composed skillPrompt. Deliberately NO baked-in default: with no
// selection the prompt ships style-free — image references alone can carry the
// look (e.g. realistic renders). Stored in the selections DB:
//   db.episodeStyle          — episode-wide preset id ("" = none)
//   db.sceneStyle[bundleId]  — per-scene override: a preset id, or the sentinel
//                              "none" to force one scene style-free while the
//                              episode has a style. Absent = follow the episode.
const SCENE_STYLE_NONE = "none";

// The project's style-preset library: the visual-world doc's prompts, falling
// back to the seeds (same rule as normalizeVisualWorld) so the selector isn't
// empty before the Visual World tab is first opened.
const stylePresetsOf = (vw) =>
  Array.isArray(vw?.prompts) && vw.prompts.length ? vw.prompts : SEED_PROMPTS;

// One-line style text of a preset: its image look + video motion, joined.
function styleTextOf(presets, presetId) {
  if (!presetId) return "";
  const p = presets.find((x) => x?.id === presetId);
  return [p?.image, p?.video]
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ");
}

const resolveStyleId = (db, bundleId) => {
  const scene = db.sceneStyle?.[bundleId];
  if (scene === SCENE_STYLE_NONE) return "";
  return scene || db.episodeStyle || "";
};

// Insert (or drop) the STYLE line of a composed skill prompt. Pre-selector
// manifests baked the house style into skillPrompt at rebuild time — strip any
// existing STYLE line first so those compose cleanly without a rebuild.
function applyStyle(prompt, styleText) {
  const lines = String(prompt || "")
    .split("\n")
    .filter((l) => !/^STYLE:/i.test(l));
  if (styleText) lines.splice(1, 0, "STYLE: " + styleText.replace(/^STYLE:\s*/i, ""));
  return lines.join("\n");
}

// Revision signing: the SECTIONS of a bundle that can be signed off independently.
const SIGN_SECTIONS = new Set(["images", "prompt", "audio"]);

// Sort key deciding which selected take wins when more than one is flagged:
// most-recently SELECTED first, then most-recently generated. Guards against
// legacy/raced data where two takes ended up selected at once.
const selKey = (v) => Date.parse(v?.selectedAt) || Date.parse(v?.ts) || 0;

// Collapse any bundle that ended up with >1 selected take down to the single
// most-recently-selected one, so the UI, the disk, and the stitch always agree.
// Returns true if it changed anything (caller should persist the doc).
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

// ---- Rendered takes: bytes, not just records -------------------------------
// A take is only VISIBLE if its mp4 is an object in R2 — `buildEpisodeView`
// lists generations by membership in the `gen` key set. So a record that has a
// `source` URL and no bytes is a take the author can never see: the agent
// announces "live as gen 3 in the carousel", the carousel shows nothing, and
// Refresh doesn't help because there is nothing to find. That was the state of
// EVERY take attached by URL while `/api/episode/video` only wrote the record
// (its download was left as a TODO through the R2 migration).
//
// The write path now downloads. These two exist for the takes recorded before
// it did: on read, pull their bytes from `source` so the backlog heals on the
// next load instead of needing a migration.

/** At most this many orphaned takes are pulled in per episode read. */
const HYDRATE_LIMIT = 8;

/** How long a failed pull is trusted — a dead source shouldn't be refetched every load. */
const HYDRATE_RETRY_MS = 24 * 60 * 60 * 1000;

/** Download one take's mp4 into R2. Returns false on any failure — best effort. */
async function hydrateGen(env, pid, file, source) {
  try {
    const res = await fetch(source);
    if (!res.ok) return false;
    await putMedia(
      env, pid, "gen", file,
      await res.arrayBuffer(),
      res.headers.get("content-type") || "video/mp4",
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Pull in every recorded take that has a `source` but no bytes, up to
 * HYDRATE_LIMIT. Mutates `genSet` with what landed so the caller lists them in
 * the same response. A take whose source is gone (an expired CDN link) is
 * stamped so the next read skips it for a day rather than refetching forever.
 */
async function hydrateOrphanedTakes(env, pid, db, genSet) {
  const now = Date.now();
  const orphans = [];
  for (const entry of Object.values(db.video || {})) {
    const arr = Array.isArray(entry) ? entry : entry ? [entry] : [];
    for (const v of arr) {
      if (!v?.file || !v.source || genSet.has(v.file)) continue;
      const failedAt = Date.parse(v.hydrateFailedAt) || 0;
      if (failedAt && now - failedAt < HYDRATE_RETRY_MS) continue;
      orphans.push(v);
    }
  }
  if (!orphans.length) return;

  const batch = orphans.slice(0, HYDRATE_LIMIT);
  const landed = await Promise.all(batch.map((v) => hydrateGen(env, pid, v.file, v.source)));
  const failed = new Set();
  batch.forEach((v, i) => {
    if (landed[i]) genSet.add(v.file);
    else failed.add(v.file);
  });

  // Stamp the dead ones inside the CAS so the note can't revert a concurrent
  // edit. The preview proxy is left to the lazy `/proxy/gen/*` fallback.
  if (!failed.size) return;
  await editDB(env, pid, (d) => {
    for (const entry of Object.values(d.video || {})) {
      const arr = Array.isArray(entry) ? entry : entry ? [entry] : [];
      for (const v of arr) if (v?.file && failed.has(v.file)) v.hydrateFailedAt = new Date().toISOString();
    }
  });
}

export { rosterMaps, needsStateFor };

// The full episode plan as `GET /api/episode` serves it: the packed <=15s
// bundles, the rendered takes that still exist in R2, per-bundle prompt
// overrides, sign-offs, first frames, style refs, and the scene-needs state.
// Extracted from the route so a non-HTTP caller (the MCP server's `get_episode`)
// gets the same joined view — reading the bare `episode-manifest` doc instead
// would report bundles as unrendered whose media is sitting right there in R2.
export async function buildEpisodeView(env, pid) {
  const [manifest, world, vw, legacy] = await Promise.all([
    readManifest(env, pid),
    readWorld(env, pid),
    readDoc(env, pid, "visual-world", null),
    legacyAudioPool(env, pid),
  ]);
  if (!manifest) return { episode: null };
  const db = await readDB(env, pid);
  // Heal stale multi-selection. Re-applied inside the CAS so the repair can't
  // revert a concurrent edit made between the read and the write.
  if (normalizeVideoSelections(db)) await editDB(env, pid, (d) => { normalizeVideoSelections(d); });
  // Attach a list of rendered clips (newest last) for every bundle that has any
  // in R2. db.video[id] is an array of generations; tolerate the old single
  // object shape too. One R2 list (into a Set) replaces a per-take HEAD storm:
  // this used to fire one serial `mediaExists` per generation (100+ round-trips
  // for a full episode) — now it's a single list + in-memory membership checks.
  const genSet = await listMediaSet(env, pid, "gen");
  // Takes recorded by URL before the download existed have no bytes — pull them
  // in now so they appear in THIS response rather than staying invisible.
  await hydrateOrphanedTakes(env, pid, db, genSet);
  const video = {};
  for (const [id, entry] of Object.entries(db.video || {})) {
    const arr = Array.isArray(entry) ? entry : entry ? [entry] : [];
    const list = [];
    for (const v of arr) {
      if (v && v.file && genSet.has(v.file)) {
        // refUrl: ungated absolute /files URL an anonymous fetcher (the render
        // agent / Higgsfield import) can pull — the /gen/ url needs the
        // project header. Same trick as storyboard.js still refUrl.
        list.push({
          ...v,
          name: v.name || `gen ${list.length + 1}`,
          url: "/gen/" + v.file,
          refUrl: filesUrl(env, mediaKey(pid, "gen", v.file)),
        });
      }
    }
    if (list.length) video[id] = list;
  }
  // Per-bundle scene-needs state (image needs, voice needs, completeness) —
  // what the UI's needs checklist and the sign gate both read.
  const maps = rosterMaps(world);
  const needs = {};
  for (const b of manifest.bundles || []) needs[b.id] = needsStateFor(b, maps, db);
  // Compose each bundle's skillPrompt with its resolved render style (episode
  // default, per-scene override, or none). Done at read time — the manifest
  // stores the style-free prompt — so a style switch needs no rebuild. Every
  // consumer (web, mobile, MCP get_episode, the agent's get_episode) reads
  // through this view, so they all see the styled prompt. `styleId` rides on
  // each bundle so clients can show which preset is in effect.
  const presets = stylePresetsOf(vw);
  const bundles = (manifest.bundles || []).map((b) => {
    const styleId = resolveStyleId(db, b.id);
    return { ...b, styleId, skillPrompt: applyStyle(b.skillPrompt, styleTextOf(presets, styleId)) };
  });
  return {
    episode: { ...manifest, bundles },
    video,
    prompts: db.prompt || {},
    signoffs: db.signoffs || {},
    firstFrames: db.episodeFirstFrame || {},
    refVideos: db.episodeRefVideo || {},
    needs,
    // Voice/sound reference pool + per-bundle picks, so a caller (the agent's
    // get_episode, the MCP server) can see the voices attached to a bundle and
    // fetch their `refUrl` — the same data `/api/audio` serves the GUI.
    audio: [...worldVoicePool(env, pid, world), ...legacy],
    audioPicks: db.episodeAudio || {},
    style: {
      episode: db.episodeStyle || "",
      scenes: db.sceneStyle || {},
      presets: presets.map((p) => ({ id: p.id, name: p.name })),
    },
  };
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

  // Available voice/sound references + current per-bundle audio picks. The pool
  // is the World roster's linked character voices, plus any legacy loose files
  // that actually exist in this project's asset space.
  app.get("/api/audio", async (c) => {
    const pid = c.get("projectId");
    const [db, world, legacy] = await Promise.all([
      readDB(c.env, pid),
      readWorld(c.env, pid),
      legacyAudioPool(c.env, pid),
    ]);
    const items = [...worldVoicePool(c.env, pid, world), ...legacy];
    return c.json({ audio: items, episode: db.episodeAudio || {} });
  });

  // Toggle a voice reference for one bundle.
  app.post("/api/episode/audio-select", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const { bundle, rel, selected } = body || {};
    if (!bundle || !rel) return c.json({ error: "Missing 'bundle' or 'rel'" }, 400);
    const { picked } = await editDB(c.env, pid, (db) => {
      db.episodeAudio = db.episodeAudio || {};
      const cur = new Set(db.episodeAudio[bundle] || []);
      if (selected) cur.add(rel);
      else cur.delete(rel);
      db.episodeAudio[bundle] = [...cur];
      return { picked: db.episodeAudio[bundle] };
    });
    return c.json({ ok: true, bundle, selected: picked });
  });

  // Revision signing: sign off one SECTION of a bundle (images | prompt | audio).
  // Each section is an independent signature { by, at }; clearing sets it null.
  // GATED on scene needs: the images section can't be signed while an image need
  // is unfulfilled, audio while a speaker lacks a voice pick — signing is the
  // trust step before Render, so it must not pass on an incomplete scene.
  app.post("/api/episode/sign", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const { bundle, section, signed, signedBy } = body || {};
    if (!bundle || !SIGN_SECTIONS.has(section))
      return c.json({ error: "Missing 'bundle' or invalid 'section'" }, 400);
    if (signed && !String(signedBy || "").trim())
      return c.json({ error: "Missing 'signedBy'" }, 400);
    // Evaluate the needs gate BEFORE the compare-and-swap: it reads two other
    // documents, and the mutate may re-run.
    const db = await readDB(c.env, pid);
    if (signed && (section === "images" || section === "audio")) {
      const [manifest, world] = await Promise.all([readManifest(c.env, pid), readWorld(c.env, pid)]);
      const b = manifest?.bundles?.find((x) => x.id === bundle);
      if (b) {
        const state = needsStateFor(b, rosterMaps(world), db);
        if (state.enforced && !state.complete[section]) {
          const unmet = section === "images"
            ? state.needs.filter((n) => !n.fulfilled).map((n) => n.key)
            : state.voice.filter((v) => !v.fulfilled).map((v) => v.name);
          return c.json({
            error: `Can't sign ${section} for ${bundle} — unmet scene needs: ${unmet.join(", ")}. ` +
              `Assign a reference covering each need (or link one of the chosen references to it) first.`,
            needs: state,
          }, 409);
        }
      }
    }
    const { signoff } = await editDB(c.env, pid, (doc) => {
      doc.signoffs = doc.signoffs || {};
      const cur = doc.signoffs[bundle] || { images: null, prompt: null, audio: null };
      cur[section] = signed ? { by: String(signedBy).trim(), at: new Date().toISOString() } : null;
      doc.signoffs[bundle] = cur;
      return { signoff: cur };
    });
    return c.json({ ok: true, bundle, signoff });
  });

  // Toggle a final-selection image as a chosen reference for one bundle/scene.
  app.post("/api/episode/select", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const { bundle, rel, selected } = body || {};
    if (!bundle || !rel) return c.json({ error: "Missing 'bundle' or 'rel'" }, 400);
    const { picked } = await editDB(c.env, pid, (db) => {
      db.episode = db.episode || {};
      const cur = new Set(db.episode[bundle] || []);
      if (selected) cur.add(rel);
      else cur.delete(rel);
      db.episode[bundle] = [...cur];
      return { picked: db.episode[bundle] };
    });
    return c.json({ ok: true, bundle, selected: picked });
  });

  // Link one chosen reference to a scene NEED (an entry of bundle.images that
  // roster auto-matching can't resolve — e.g. an uploaded image standing in for
  // a character with no World sheet). `need` is the need id ("character:Kid" /
  // "location:ext-nyc-street"); rel null/"" unlinks. A need holds ONE link; the
  // link only counts as fulfilled while its rel is among the bundle's picks.
  app.post("/api/episode/link", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const { bundle, need, rel } = body || {};
    if (!bundle || !need) return c.json({ error: "Missing 'bundle' or 'need'" }, 400);
    const { links } = await editDB(c.env, pid, (db) => {
      db.needLinks = db.needLinks || {};
      const cur = db.needLinks[bundle] || {};
      if (rel) cur[need] = String(rel);
      else delete cur[need];
      db.needLinks[bundle] = cur;
      return { links: cur };
    });
    return c.json({ ok: true, bundle, links });
  });

  // Auto-assign: source every bundle's image + audio references from the World
  // roster — each on-screen character contributes their linked sheet image and
  // (for speakers) their linked voice; each shot location contributes its
  // location sheet by slug. VALIDATES FIRST: when any needed character is not
  // fully linked in the World it assigns NOTHING and returns ok:false with a
  // validation report — the caller must surface that to the user and stop,
  // never substitute refs from the Sound Studio pool or another project. With
  // no body it replaces the picks of EVERY bundle; `{ beat: "B1" }` scopes the
  // run to that beat's bundles and leaves every other bundle's picks untouched.
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

    const world = await readWorld(c.env, pid);
    const { chars: charByKey, locs: locBySlug } = rosterMaps(world);

    // Everyone on screen needs a linked sheet image; everyone who speaks needs
    // a linked voice. Collect the gaps across ALL target bundles up front.
    const onScreen = new Map(); // charKey -> display name
    const speakers = new Map();
    for (const b of targets) {
      for (const s of b.shots) for (const name of s.characters || []) {
        const k = charKey(name);
        if (k && !onScreen.has(k)) onScreen.set(k, name);
      }
      for (const [k, name] of bundleSpeakers(b)) if (!speakers.has(k)) speakers.set(k, name);
    }
    const notInWorld = [], missingSheet = [], missingVoice = [];
    for (const [k, name] of onScreen) {
      const ch = charByKey.get(k);
      if (!ch) notInWorld.push(name);
      else if (!ch.sheetImage?.rel) missingSheet.push(ch.name || name);
    }
    for (const [k, name] of speakers) {
      const ch = charByKey.get(k);
      if (!ch) { if (!onScreen.has(k)) notInWorld.push(name); }
      else if (!ch.voiceRef?.url) missingVoice.push(ch.name || name);
    }
    if (notInWorld.length || missingSheet.length || missingVoice.length) {
      const parts = [];
      if (notInWorld.length) parts.push(`not in the World roster: ${notInWorld.join(", ")}`);
      if (missingSheet.length) parts.push(`no character sheet image linked: ${missingSheet.join(", ")}`);
      if (missingVoice.length) parts.push(`no voice linked: ${missingVoice.join(", ")}`);
      return c.json({
        ok: false,
        validation: { notInWorld, missingSheet, missingVoice },
        message:
          "Auto-assign stopped — the World roster is the source of truth for character sheets and voices, " +
          `and these characters aren't fully linked yet: ${parts.join("; ")}. Nothing was assigned. ` +
          "Link each character's sheet image and voice on the World tab (attach_character_sheet / " +
          "attach_character_voice), then re-run. Do not substitute references from the Sound Studio " +
          "pool or another project.",
      });
    }

    let totalAssigned = 0;
    const summary = {};
    const locNoSheet = new Set();
    await editDB(c.env, pid, (db) => {
    totalAssigned = 0;
    for (const k of Object.keys(summary)) delete summary[k];
    locNoSheet.clear();
    if (!beat) {
      db.episode = {};
      db.episodeAudio = {};
    }
    db.episode = db.episode || {};
    db.episodeAudio = db.episodeAudio || {};
    for (const b of targets) {
      const images = [];
      const audio = [];
      for (const s of b.shots) for (const name of s.characters || []) {
        const rel = charByKey.get(charKey(name))?.sheetImage?.rel;
        if (rel && !images.includes(rel)) images.push(rel);
      }
      for (const s of b.shots) {
        const slug = String(s.location || "").trim();
        if (!slug) continue;
        const rel = locBySlug.get(slug)?.sheetImage?.rel;
        if (rel) { if (!images.includes(rel)) images.push(rel); }
        else locNoSheet.add(slug);
      }
      for (const [k] of bundleSpeakers(b)) {
        const ch = charByKey.get(k);
        if (!ch) continue;
        const rel = worldVoiceRel(ch);
        if (!audio.includes(rel)) audio.push(rel);
      }
      db.episode[b.id] = images;
      db.episodeAudio[b.id] = audio;
      summary[b.id] = images.length;
      totalAssigned += images.length;
    }
    });
    return c.json({
      ok: true, beat, bundles: targets.length, totalAssigned, summary, source: "world",
      warnings: locNoSheet.size
        ? [`No World location sheet linked for: ${[...locNoSheet].sort().join(", ")} — affected bundles got character sheets only.`]
        : [],
    });
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
    // The visual-world doc rides along only for its generation defaults — the
    // Seedance model/resolution that go into each bundle's `Params:` line, so a
    // rebuild picks up whatever is currently set on Settings. Read raw: the
    // params helper clamps whatever it finds.
    const [shots, world, vw] = await Promise.all([
      readShots(c.env, pid),
      readWorld(c.env, pid),
      readDoc(c.env, pid, "visual-world", null),
    ]);
    if (!shots.length) return c.json({ error: "No shot list yet — write a shot list first." }, 400);

    const bundles = buildBundles(shots, world, vw?.settings);
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

    // Counters live OUTSIDE the mutate (the response reports them) and are reset
    // at the top of each attempt, because `mutate` re-runs on a version conflict.
    let stillsMoved = 0, stillsOrphaned = 0, videoMoved = 0, videoOrphaned = 0;
    // The remap below and the manifest write are ONE operation: bundle ids are
    // positional slot numbers, so if only one of the two documents lands, the
    // surviving picks/stills/renders point at the wrong scenes. `also` puts both
    // in a single transaction — see `updateDoc`.
    const manifest = {
      ...(prev && typeof prev === "object" ? prev : {}),
      title: prev?.title || "Episode plan",
      totalShots: shots.length,
      generatedAt: new Date().toISOString(),
      source: "rebuild",
      bundles,
    };
    await editDB(c.env, pid, (db) => {
    stillsMoved = 0; stillsOrphaned = 0; videoMoved = 0; videoOrphaned = 0;

    // (1) stills: remap by shot id — lossless.
    const newStills = {};
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
    db.needLinks = carryUnchanged(db.needLinks);
    db.sceneStyle = carryUnchanged(db.sceneStyle); // episode-wide style survives as-is

    }, { also: [{ name: "episode-manifest", value: manifest }] });

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
  app.get("/api/episode", async (c) =>
    c.json(await buildEpisodeView(c.env, c.get("projectId"))));

  // Choose (or clear) the FIRST FRAME for a bundle's video render — a storyboard
  // still the Seedance clip should open on (passed as start_image). Stored per
  // bundle as { shot, file }; `file:null` (or omitted) clears it.
  app.post("/api/episode/first-frame", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const { bundle, shot, file } = body || {};
    if (!bundle) return c.json({ error: "Missing 'bundle'" }, 400);
    const { firstFrame } = await editDB(c.env, pid, (db) => {
      db.episodeFirstFrame = db.episodeFirstFrame || {};
      if (file) db.episodeFirstFrame[bundle] = { shot: shot || null, file };
      else delete db.episodeFirstFrame[bundle];
      return { firstFrame: db.episodeFirstFrame[bundle] || null };
    });
    return c.json({ ok: true, bundle, firstFrame });
  });

  // Choose (or clear) the VIDEO STYLE CONTINUITY REFERENCE for a bundle's render —
  // an already-rendered generation (from any bundle) the new clip should match in
  // style/colors/feeling (passed as video_references). Stored per bundle as
  // { from: <source bundle id>, file }; `file:null` (or omitted) clears it.
  app.post("/api/episode/ref-video", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const { bundle, from, file } = body || {};
    if (!bundle) return c.json({ error: "Missing 'bundle'" }, 400);
    const { refVideo } = await editDB(c.env, pid, (db) => {
      db.episodeRefVideo = db.episodeRefVideo || {};
      if (file) db.episodeRefVideo[bundle] = { from: from || null, file };
      else delete db.episodeRefVideo[bundle];
      return { refVideo: db.episodeRefVideo[bundle] || null };
    });
    return c.json({ ok: true, bundle, refVideo });
  });

  // Mark a rendered generation as selected/deselected (for stitching later).
  app.post("/api/episode/video-select", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const { bundle, file, selected } = body || {};
    if (!bundle || !file) return c.json({ error: "Missing 'bundle' or 'file'" }, 400);
    const res = await editDB(c.env, pid, (db) => {
      const arr = Array.isArray(db.video?.[bundle]) ? db.video[bundle] : db.video?.[bundle] ? [db.video[bundle]] : [];
      const g = arr.find((v) => v.file === file);
      if (!g) return { abort: true, missing: true };
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
      return { selected: g.selected };
    });
    if (res.missing) return c.json({ error: "Generation not found" }, 404);
    return c.json({ ok: true, bundle, file, selected: res.selected });
  });

  // Choose the render STYLE for the whole episode or one scene. Body:
  // { presetId, bundle? }. `presetId` is a visual-world style-preset id, "" (or
  // omitted) to clear — no style, references alone carry the look — or, with a
  // `bundle`, the sentinel "none" to force that one scene style-free while the
  // episode has a style. Without `bundle` it sets the episode-wide default every
  // scene follows unless overridden. Styles are prepended to skillPrompt at
  // read time, so a switch restyles every live-composed prompt instantly (a
  // per-bundle prompt OVERRIDE — db.prompt — is user text and is left alone).
  app.post("/api/episode/style", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const bundle = String(body?.bundle || "").trim();
    const presetId = String(body?.presetId || "").trim();
    if (presetId && !(bundle && presetId === SCENE_STYLE_NONE)) {
      const vw = await readDoc(c.env, pid, "visual-world", null);
      if (!stylePresetsOf(vw).some((p) => p?.id === presetId)) {
        return c.json({
          error: `Unknown style preset '${presetId}' — pick a visual-world style-prompt id, or "" for no style.`,
        }, 400);
      }
    }
    const { style } = await editDB(c.env, pid, (db) => {
      if (bundle) {
        db.sceneStyle = db.sceneStyle || {};
        if (presetId) db.sceneStyle[bundle] = presetId;
        else delete db.sceneStyle[bundle];
      } else {
        db.episodeStyle = presetId;
      }
      return { style: { episode: db.episodeStyle || "", scenes: db.sceneStyle || {} } };
    });
    return c.json({ ok: true, bundle: bundle || null, style });
  });

  // Save (or clear) an edited skill prompt for one bundle. Empty/omitted text
  // clears the override so the bundle falls back to the live-composed prompt.
  app.post("/api/episode/prompt", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const { bundle, text } = body || {};
    if (!bundle) return c.json({ error: "Missing 'bundle'" }, 400);
    const { saved } = await editDB(c.env, pid, (db) => {
      db.prompt = db.prompt || {};
      if (typeof text === "string" && text.length) db.prompt[bundle] = text;
      else delete db.prompt[bundle];
      return { saved: !!db.prompt[bundle] };
    });
    return c.json({ ok: true, bundle, saved });
  });

  // Attach a rendered Seedance clip to a bundle. APPENDS a new generation (keeps
  // prior ones) and records it as generations/<bundle>_genN.mp4.
  app.post("/api/episode/video", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const { bundle, url, jobId } = body || {};
    if (!bundle || !url) return c.json({ error: "Missing 'bundle' or 'url'" }, 400);
    // The take's ordinal (and so its filename) depends on how many the bundle
    // already has, so read that BEFORE fetching the bytes — `editDB`'s mutate
    // may re-run under CAS and must stay pure. The filename also carries a
    // RANDOM suffix, like storyboard stills: two renders attaching in the same
    // moment would otherwise claim the same ordinal, overwrite each other's R2
    // object, and leave two records pointing at one clip. The mutate below is
    // still the authority on the "gen N" LABEL.
    const priorEntry = (await readDB(c.env, pid)).video?.[bundle];
    const prior = Array.isArray(priorEntry) ? priorEntry : priorEntry ? [priorEntry] : [];
    const file = `${bundle}_gen${prior.length + 1}_${crypto.randomUUID().slice(0, 8)}.mp4`;

    // Download the clip into R2. Without this the record is invisible: the
    // episode view lists only takes whose object exists, so the author is told
    // the take is live and finds an empty carousel. On failure keep the record
    // — it holds `source`, and the read path retries the pull — but say so in
    // the response rather than reporting a clean success.
    let stored = false;
    try {
      const res = await fetch(url);
      if (res.ok) {
        await putMedia(
          c.env, pid, "gen", file,
          await res.arrayBuffer(),
          res.headers.get("content-type") || "video/mp4",
        );
        stored = true;
      }
    } catch { /* fall back to the source URL; the read path hydrates it later */ }

    const { name, count } = await editDB(c.env, pid, (db) => {
      db.video = db.video || {};
      // normalize to an array (migrate old single-object / legacy <bundle>.mp4 entry)
      let list = db.video[bundle];
      list = Array.isArray(list) ? list : list ? [list] : [];
      const n = list.length + 1;
      list.push({ file, name: `gen ${n}`, jobId: jobId || null, source: url, ts: new Date().toISOString() });
      db.video[bundle] = list;
      return { name: `gen ${n}`, count: list.length };
    });

    // 720p preview proxy for the editor/cuts pages, same as an /ingest write.
    if (stored) c.executionCtx.waitUntil(ensureProxy(c.env, { pid, kind: "gen", file }));

    return c.json({
      ok: true, bundle, name, count, file, stored, url: "/gen/" + file,
      ...(stored ? {} : {
        warning:
          "The clip was recorded but its bytes could not be downloaded from `url` — the take will not appear in the Episode tab until the download succeeds. Tell the author, and re-attach with a fresh URL if the source has expired.",
      }),
    });
  });
}
