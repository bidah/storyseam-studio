import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Paths to the pipeline data (sibling of the shot-studio folder).
// ---------------------------------------------------------------------------
const DATA_ROOT = path.resolve(__dirname, "..", "..", "shot-by-shot");
const SHOTS_DIR = path.join(DATA_ROOT, "shots");
const SEEDANCE_FILE = path.join(
  DATA_ROOT,
  "whistlewood_s1_15s_seedance_shotlist.txt"
);
const SEEDAUDIO_FILE = path.join(
  DATA_ROOT,
  "whistlewood_1x01_scene1_FULL_seedaudio_prompt.txt"
);

// Multishot experiment lives as a sibling of shot-by-shot / shot-studio.
const MULTISHOT_DIR = path.resolve(__dirname, "..", "..", "multishot-s1-shots1-4");
const MULTISHOT_MANIFEST = path.join(MULTISHOT_DIR, "multishot.json");

// Full-episode multishot plan (45 bundles) lives as a sibling folder.
const EPISODE_DIR = path.resolve(__dirname, "..", "..", "episode-multishot");
const EPISODE_MANIFEST = path.join(EPISODE_DIR, "multishot_bundles.json");

// Asset library: the whole project root, browsable by folder. Selected images
// are copied into final_selection/ and tracked in a tiny JSON "database".
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const FINAL_DIR = path.join(PROJECT_ROOT, "final_selection");
const SELECTIONS_DB = path.join(EPISODE_DIR, "selections.json");
const IMG_RE = /\.(png|jpe?g|webp|gif)$/i;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "final_selection", "shot-studio", ".DS_Store"]);

function readDB() {
  try {
    return JSON.parse(fs.readFileSync(SELECTIONS_DB, "utf8"));
  } catch {
    return { library: {}, episode: {} };
  }
}
function writeDB(db) {
  fs.writeFileSync(SELECTIONS_DB, JSON.stringify(db, null, 2));
}
// "reference-test-01/sub/img.png" -> "reference-test-01__sub__img.png"
const flatten = (rel) => rel.split(path.sep).join("__");
// resolve a client-supplied relative path safely inside PROJECT_ROOT
function safeAbs(rel) {
  const abs = path.resolve(PROJECT_ROOT, rel);
  if (abs !== PROJECT_ROOT && !abs.startsWith(PROJECT_ROOT + path.sep)) return null;
  return abs;
}
// Recursively collect image files grouped by their containing folder (relative).
function scanLibrary() {
  const folders = new Map(); // relDir -> [{rel, name}]
  const walk = (absDir) => {
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const abs = path.join(absDir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(abs);
      } else if (IMG_RE.test(e.name)) {
        const rel = path.relative(PROJECT_ROOT, abs);
        const dir = path.dirname(rel);
        if (!folders.has(dir)) folders.set(dir, []);
        folders.get(dir).push({ rel, name: e.name });
      }
    }
  };
  walk(PROJECT_ROOT);
  return folders;
}

const PORT = process.env.PORT || 3334;

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

// Returns the list of shot ids found on disk, e.g. ["01","02",...] sorted.
function listShotIds() {
  if (!fs.existsSync(SHOTS_DIR)) return [];
  return fs
    .readdirSync(SHOTS_DIR)
    .map((name) => /^shot(\d+)$/.exec(name))
    .filter(Boolean)
    .map((m) => m[1])
    .sort((a, b) => Number(a) - Number(b));
}

// Generic block finder. Given the file text and a regex that matches the START
// line of a block, returns an array of { key, startLine, endLine, text } where
// the block runs from its start marker up to (but not including) the next marker
// (or EOF). `keyOf` extracts a comparable key (the numeric shot id) from a match.
function findBlocks(text, markerRe, keyOf) {
  const lines = text.split("\n");
  const markers = [];
  for (let i = 0; i < lines.length; i++) {
    const m = markerRe.exec(lines[i]);
    markerRe.lastIndex = 0;
    if (m) markers.push({ index: i, key: keyOf(m) });
  }
  const blocks = [];
  for (let b = 0; b < markers.length; b++) {
    const start = markers[b].index;
    const end = b + 1 < markers.length ? markers[b + 1].index : lines.length;
    blocks.push({
      key: markers[b].key,
      startLine: start,
      endLine: end, // exclusive
      text: lines.slice(start, end).join("\n").replace(/\s+$/, ""),
    });
  }
  return blocks;
}

// --- Seedance: blocks start at "SHOT: NN" --------------------------------
const SEEDANCE_MARKER = /^SHOT:\s*0*(\d+)/;
function seedanceBlocks(text) {
  return findBlocks(text, SEEDANCE_MARKER, (m) => String(Number(m[1])));
}

// --- Seedaudio: organized by SEGMENT with a shot range -------------------
// e.g. "SEGMENT 1 — Shots 01–07 (...)". A given shot maps to the segment whose
// range contains it. Supports both en-dash and hyphen as range separators.
const SEGMENT_MARKER = /^SEGMENT\s+(\d+)\s*[—-]\s*Shots?\s*0*(\d+)\s*[–—-]\s*0*(\d+)/i;
function seedaudioSegments(text) {
  const lines = text.split("\n");
  const markers = [];
  for (let i = 0; i < lines.length; i++) {
    const m = SEGMENT_MARKER.exec(lines[i]);
    if (m) {
      markers.push({
        index: i,
        segment: Number(m[1]),
        from: Number(m[2]),
        to: Number(m[3]),
      });
    }
  }
  const segs = [];
  for (let b = 0; b < markers.length; b++) {
    const start = markers[b].index;
    // Many of these segment headers are immediately preceded by a banner line
    // of "===". Keep the block as the header line through to the next header.
    const end = b + 1 < markers.length ? markers[b + 1].index : lines.length;
    segs.push({
      ...markers[b],
      startLine: start,
      endLine: end,
      text: lines.slice(start, end).join("\n").replace(/\s+$/, ""),
    });
  }
  return segs;
}

// For a given numeric shot id, find the segment block that covers it.
function segmentForShot(segs, shotNum) {
  return segs.find((s) => shotNum >= s.from && shotNum <= s.to) || null;
}

// ---------------------------------------------------------------------------
// Build the shots payload
// ---------------------------------------------------------------------------
function buildShots() {
  const ids = listShotIds();

  const seedanceText = fs.existsSync(SEEDANCE_FILE)
    ? fs.readFileSync(SEEDANCE_FILE, "utf8")
    : "";
  const seedaudioText = fs.existsSync(SEEDAUDIO_FILE)
    ? fs.readFileSync(SEEDAUDIO_FILE, "utf8")
    : "";

  const sBlocks = seedanceBlocks(seedanceText);
  const aSegs = seedaudioSegments(seedaudioText);

  return ids.map((id) => {
    const num = Number(id);
    const sBlock = sBlocks.find((b) => Number(b.key) === num);
    const seg = segmentForShot(aSegs, num);

    const folder = path.join(SHOTS_DIR, `shot${id}`);
    const mp3 = path.join(folder, `shot${id}_audio.mp3`);
    const mp4 = path.join(folder, `shot${id}_FINAL.mp4`);
    const takesDir = path.join(folder, "takes");

    // Versioned takes (newest first). Two separate audio stems are tracked:
    //   speech = dialogue-only (Seedance lip-syncs to this)
    //   vfx    = SFX/ambience-only, no voices (layered onto the video later)
    const speechTakes = [];
    const vfxTakes = [];
    const videoTakes = [];
    if (fs.existsSync(takesDir)) {
      for (const f of fs.readdirSync(takesDir)) {
        let m;
        if ((m = /_speech_take(\d+)_([0-9-]+)\.mp3$/.exec(f))) {
          speechTakes.push({ take: Number(m[1]), ts: m[2], title: f, url: `/media/shot${id}/takes/${f}` });
        } else if ((m = /_vfx_take(\d+)_([0-9-]+)\.mp3$/.exec(f))) {
          vfxTakes.push({ take: Number(m[1]), ts: m[2], title: f, url: `/media/shot${id}/takes/${f}` });
        } else if ((m = /_(lipsync|withvfx|final)_take(\d+)_([0-9-]+)\.mp4$/i.exec(f))) {
          videoTakes.push({ take: Number(m[2]), ts: m[3], variant: m[1].toLowerCase(), title: f, url: `/media/shot${id}/takes/${f}` });
        }
      }
    }
    speechTakes.sort((a, b) => b.take - a.take);
    vfxTakes.sort((a, b) => b.take - a.take);
    videoTakes.sort((a, b) => b.take - a.take || a.variant.localeCompare(b.variant));
    // Fallback: a shot with only a flat audio file shows it as speech take 1.
    if (speechTakes.length === 0 && fs.existsSync(mp3))
      speechTakes.push({ take: 1, ts: null, title: `shot${id}_audio.mp3`, url: `/media/shot${id}/shot${id}_audio.mp3` });
    if (videoTakes.length === 0 && fs.existsSync(mp4))
      videoTakes.push({ take: 1, ts: null, variant: "final", title: `shot${id}_FINAL.mp4`, url: `/media/shot${id}/shot${id}_FINAL.mp4` });

    // Prefer a per-shot audio prompt file; fall back to the shared segment block.
    const promptFile = path.join(folder, `shot${id}_audio_prompt.txt`);
    const perShotAudio = fs.existsSync(promptFile)
      ? fs.readFileSync(promptFile, "utf8").replace(/\s+$/, "")
      : null;

    return {
      id,
      seedanceText: sBlock ? sBlock.text : "",
      seedanceFound: Boolean(sBlock),
      audioText: perShotAudio != null ? perShotAudio : seg ? seg.text : "",
      audioFound: perShotAudio != null ? true : Boolean(seg),
      audioPerShot: perShotAudio != null,
      audioSegment: seg ? seg.segment : null,
      // The segment header line (e.g. "SEGMENT 1 — Shots 01–07 …"), shown as a
      // non-editable header above the per-shot audio prompt box.
      audioSegmentLabel: seg ? seg.text.split("\n")[0].trim() : null,
      audioUrl: speechTakes[0] ? speechTakes[0].url : null,
      videoUrl: videoTakes[0] ? videoTakes[0].url : null,
      speechTakes,
      vfxTakes,
      videoTakes,
    };
  });
}

// ---------------------------------------------------------------------------
// Write-back helpers: replace only the target block, preserve everything else.
// ---------------------------------------------------------------------------
function writeSeedanceBlock(shotId, newText) {
  const num = Number(shotId);
  const text = fs.readFileSync(SEEDANCE_FILE, "utf8");
  const lines = text.split("\n");
  const blocks = seedanceBlocks(text);
  const block = blocks.find((b) => Number(b.key) === num);
  if (!block) throw new Error(`No seedance block found for shot ${shotId}`);

  const replacement = newText.replace(/\r\n/g, "\n").replace(/\s+$/, "").split("\n");
  const updated = [
    ...lines.slice(0, block.startLine),
    ...replacement,
    ...lines.slice(block.endLine),
  ];
  fs.writeFileSync(SEEDANCE_FILE, updated.join("\n"), "utf8");
}

function writeSeedaudioBlock(shotId, newText) {
  // If the shot has its own folder, persist edits to a per-shot prompt file
  // (the audio column is per-shot, not the shared segment).
  const folder = path.join(SHOTS_DIR, `shot${shotId}`);
  if (fs.existsSync(folder)) {
    const normalized =
      newText.replace(/\r\n/g, "\n").replace(/\s+$/, "") + "\n";
    fs.writeFileSync(
      path.join(folder, `shot${shotId}_audio_prompt.txt`),
      normalized,
      "utf8"
    );
    return;
  }

  // Fallback: replace the shared SEGMENT block in the seedaudio file.
  const num = Number(shotId);
  const text = fs.readFileSync(SEEDAUDIO_FILE, "utf8");
  const lines = text.split("\n");
  const segs = seedaudioSegments(text);
  const seg = segmentForShot(segs, num);
  if (!seg) throw new Error(`No seedaudio segment found for shot ${shotId}`);

  const replacement = newText.replace(/\r\n/g, "\n").replace(/\s+$/, "").split("\n");
  const updated = [
    ...lines.slice(0, seg.startLine),
    ...replacement,
    ...lines.slice(seg.endLine),
  ];
  fs.writeFileSync(SEEDAUDIO_FILE, updated.join("\n"), "utf8");
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: "1mb" }));

// Serve the media files statically.
app.use("/media", express.static(SHOTS_DIR));

// Serve the multishot experiment media (references, gen video) statically.
app.use("/multishot-media", express.static(MULTISHOT_DIR));

// Serve the character/location reference images (shot-by-shot/character, /location).
app.use("/refs", express.static(DATA_ROOT));

// Serve any project image by relative path, and the final_selection folder.
app.use("/asset", express.static(PROJECT_ROOT));
app.use("/final", express.static(FINAL_DIR));

// --- Asset library: folders of images, browsable + selectable -------------
app.get("/api/library", (req, res) => {
  try {
    const db = readDB();
    const folders = scanLibrary();
    const list = [...folders.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([dir, imgs]) => ({
        folder: dir,
        count: imgs.length,
        preview: "/asset/" + imgs[0].rel.split(path.sep).join("/"),
        images: imgs
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((im) => ({
            rel: im.rel,
            name: im.name,
            url: "/asset/" + im.rel.split(path.sep).join("/"),
            selected: !!db.library[im.rel],
          })),
      }));
    res.json({ folders: list });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Toggle a source image's membership in the final_selection set.
app.post("/api/library/toggle", (req, res) => {
  try {
    const { rel } = req.body || {};
    if (typeof rel !== "string") return res.status(400).json({ error: "Missing 'rel'" });
    const abs = safeAbs(rel);
    if (!abs || !fs.existsSync(abs)) return res.status(400).json({ error: "Bad path" });
    const db = readDB();
    const flat = flatten(rel);
    const dest = path.join(FINAL_DIR, flat);
    let selected;
    if (db.library[rel]) {
      // deselect: remove from final + db, and from any per-bundle episode picks
      delete db.library[rel];
      if (fs.existsSync(dest)) fs.rmSync(dest);
      // a removed library image also drops out of any per-shot assignments
      for (const k of Object.keys(db.episode || {})) {
        db.episode[k] = (db.episode[k] || []).filter((r) => r !== rel);
      }
      selected = false;
    } else {
      fs.mkdirSync(FINAL_DIR, { recursive: true });
      fs.copyFileSync(abs, dest);
      db.library[rel] = true;
      selected = true;
    }
    writeDB(db);
    res.json({ ok: true, rel, selected });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// The final_selection pool (what shows on the episode tab as reference previews).
app.get("/api/final", (req, res) => {
  try {
    const db = readDB();
    const files = fs.existsSync(FINAL_DIR)
      ? fs.readdirSync(FINAL_DIR).filter((f) => IMG_RE.test(f))
      : [];
    const items = files.sort().map((name) => ({
      name,
      url: "/final/" + name,
      origin: name.split("__").join("/"),
    }));
    res.json({ final: items, episode: db.episode || {} });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Classify a library image by filename into semantic tags (character / location).
// Supporting cast (parents/teacher/classmates) are NOT main characters — they
// never appear in this episode's shots, so they must not match Sara/Helena.
function classifyRef(rel) {
  const base = path.basename(rel).toLowerCase();
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
  }
  return tags;
}

// What a bundle needs, as an ordered list of role requirements. Each requirement
// is a priority list of candidate tags (first available image wins) — so a night
// scene prefers forest-night but falls back to day forest if none is selected.
const NIGHT_GROUPS = new Set([
  "forest-path-night", "night-clearing", "boundary-stone-night", "montage", "hollow-dusk", "whistlewood-aerial",
]);
function bundleRequirements(bundle) {
  const reqs = [];
  const night = NIGHT_GROUPS.has(bundle.group);
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
      const night = /night|montage|dusk/.test(k); // late scenes -> forest-night
      reqs.push(night ? ["loc:forest-night", "loc:forest"] : ["loc:forest"]);
    }
  }
  return reqs;
}

// Auto-assign: match each bundle's needs to the library-selected images and
// write the per-shot picks. Replaces existing picks for every bundle.
app.post("/api/episode/auto-assign", (req, res) => {
  try {
    if (!fs.existsSync(EPISODE_MANIFEST)) return res.status(400).json({ error: "No episode manifest" });
    const manifest = JSON.parse(fs.readFileSync(EPISODE_MANIFEST, "utf8"));
    const db = readDB();
    const selected = Object.keys(db.library || {}).filter((r) => db.library[r]);
    const tagged = selected.map((rel) => ({ rel, tags: classifyRef(rel) }));

    let totalAssigned = 0;
    const summary = {};
    db.episode = {};
    for (const b of manifest.bundles) {
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
    }
    writeDB(db);
    res.json({ ok: true, bundles: manifest.bundles.length, totalAssigned, summary });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Toggle a final-selection image as a chosen reference for one bundle/scene.
app.post("/api/episode/select", (req, res) => {
  try {
    const { bundle, rel, selected } = req.body || {};
    if (!bundle || !rel) return res.status(400).json({ error: "Missing 'bundle' or 'rel'" });
    const db = readDB();
    db.episode = db.episode || {};
    const cur = new Set(db.episode[bundle] || []);
    if (selected) cur.add(rel);
    else cur.delete(rel);
    db.episode[bundle] = [...cur];
    writeDB(db);
    res.json({ ok: true, bundle, selected: db.episode[bundle] });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Full-episode multishot plan: the 45 packed <=15s bundles + per-bundle skill prompt.
app.get("/api/episode", (req, res) => {
  try {
    if (!fs.existsSync(EPISODE_MANIFEST)) return res.json({ episode: null });
    const manifest = JSON.parse(fs.readFileSync(EPISODE_MANIFEST, "utf8"));
    res.json({ episode: manifest });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Multishot experiment manifest + media listing. Reads multishot.json and, if a
// generated video exists in gen/, exposes its URL so the UI can play it.
app.get("/api/multishot", (req, res) => {
  try {
    if (!fs.existsSync(MULTISHOT_MANIFEST)) {
      return res.json({ multishot: null });
    }
    const manifest = JSON.parse(fs.readFileSync(MULTISHOT_MANIFEST, "utf8"));

    // Rewrite media file paths to served URLs.
    const toUrl = (file) => (file ? `/multishot-media/${file}` : null);
    const images = (manifest.images || []).map((m) => ({ ...m, url: toUrl(m.file) }));
    const audio = (manifest.audio || []).map((m) => ({ ...m, url: toUrl(m.file) }));

    // Each generation's video file → served URL (drop entries whose file is gone).
    const generations = (manifest.generations || [])
      .map((g) => ({ ...g, videoUrl: toUrl(g.video) }))
      .filter((g) => {
        if (!g.video) return true;
        return fs.existsSync(path.join(MULTISHOT_DIR, g.video));
      });

    res.json({
      multishot: { ...manifest, images, audio, generations },
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/shots", (req, res) => {
  try {
    res.json({ shots: buildShots() });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.put("/api/shots/:id/seedance", (req, res) => {
  try {
    const { text } = req.body || {};
    if (typeof text !== "string")
      return res.status(400).json({ error: "Missing 'text'" });
    writeSeedanceBlock(req.params.id, text);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.put("/api/shots/:id/audio", (req, res) => {
  try {
    const { text } = req.body || {};
    if (typeof text !== "string")
      return res.status(400).json({ error: "Missing 'text'" });
    writeSeedaudioBlock(req.params.id, text);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Optionally serve the built front-end if it exists.
const distDir = path.resolve(__dirname, "..", "dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
}

app.listen(PORT, () => {
  console.log(`shot-studio API listening on http://localhost:${PORT}`);
  console.log(`  data root: ${DATA_ROOT}`);
});
