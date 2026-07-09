import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import { promisify } from "util";
import { AwsClient } from "aws4fetch";
import { randomUUID } from "node:crypto";
import { packPreview } from "./lib/pack.js";

const execFileP = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load shot-studio/.env so the R2 upload credentials (and any other env) are
// available even when the server is started on its own (not via the eve stack).
try {
  process.loadEnvFile(path.join(__dirname, "..", ".env"));
} catch {
  /* no .env present — rely on the ambient environment */
}

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
// Editable flat shot list (the granular per-shot list, pre-packing). Unlike the
// read-only build outputs above, this is read AND written by the app.
const SHOTLIST_FILE = path.join(EPISODE_DIR, "shotlist.json");

// Asset library: the whole project root, browsable by folder. Selected images
// are copied into final_selection/ and tracked in a tiny JSON "database".
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const FINAL_DIR = path.join(PROJECT_ROOT, "final_selection");
const SELECTIONS_DB = path.join(EPISODE_DIR, "selections.json");

// Rendered Seedance clips, one per bundle (MS-01.mp4, ...). Shown in the card.
const GEN_DIR = path.join(EPISODE_DIR, "generations");

// Sound Studio: a standalone audio library (sibling of the other data folders).
// Each "track" holds ordered versions; the media files live in media/.
const SOUND_DIR = path.join(PROJECT_ROOT, "sound-studio");
const SOUND_MEDIA = path.join(SOUND_DIR, "media");
const SOUNDS_DB = path.join(SOUND_DIR, "sounds.json");
const DEFAULT_SOUND_PARAMS = { model: "seed_audio", format: "wav", sample_rate: 48000 };

// Script tab: a single Notion-style / screenplay document (TipTap ProseMirror
// JSON) persisted to a small JSON file.
const SCRIPT_DIR = path.join(PROJECT_ROOT, "script-studio");
const SCRIPT_FILE = path.join(SCRIPT_DIR, "script.json");

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
app.use("/gen", express.static(GEN_DIR));
app.use("/sound-media", express.static(SOUND_MEDIA));

// --- Script tab: load / save the single screenplay document ----------------
// Durable store is the Cloudflare Worker's R2 object (GET/PUT {worker}/script),
// derived from the same Worker used for chat uploads (VITE_UPLOAD_URL). Falls
// back to a local script.json when the Worker isn't configured/reachable (e.g.
// before the updated Worker is deployed), so the tab keeps working either way.
const SCRIPT_STORE_URL = (() => {
  const explicit = process.env.SCRIPT_STORE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const upload = process.env.VITE_UPLOAD_URL;
  if (upload) {
    try { return new URL(upload).origin + "/script"; } catch { /* ignore */ }
  }
  return null;
})();

// The persisted store is a *set of drafts* with one "pinned" (active) draft:
//   { v: 2, pinnedId, drafts: [ { id, name, title, doc, createdAt, updatedAt,
//     clientId } ] }
// The editor and the agent tools all talk to the PINNED draft through the same
// /api/script GET/PUT — the draft set lives behind those endpoints so nothing
// downstream has to know about versioning. Version-control endpoints below
// (list / create / pin / rename / delete) manage the set itself.

const nowIso = () => new Date().toISOString();
const newDraftId = () => `d_${randomUUID().slice(0, 8)}`;

// Count the non-empty top-level blocks in a ProseMirror doc (a rough line count
// for the drafts UI — mirrors how the agent's docToElements drops empty blocks).
function countLines(doc) {
  const blocks = doc && doc.type === "doc" && Array.isArray(doc.content) ? doc.content : [];
  let n = 0;
  for (const node of blocks) {
    if (node?.type === "title") continue;
    const text = JSON.stringify(node?.content || "");
    if (/"text"\s*:\s*"[^"]/.test(text)) n += 1;
  }
  return n;
}

function makeDraft({ name, title = "", doc = null, clientId = null }) {
  const ts = nowIso();
  return { id: newDraftId(), name: name || "Draft 1", title, doc, createdAt: ts, updatedAt: ts, clientId };
}

// Accept any of: a v2 store, a legacy single { title, doc } record, or {} /
// null — and always return a well-formed v2 store with a valid pinnedId.
function normalizeStore(obj) {
  if (obj && Array.isArray(obj.drafts) && obj.drafts.length) {
    const drafts = obj.drafts.map((d) => ({
      id: typeof d.id === "string" ? d.id : newDraftId(),
      name: typeof d.name === "string" && d.name ? d.name : "Draft",
      title: typeof d.title === "string" ? d.title : "",
      doc: d.doc ?? null,
      createdAt: d.createdAt || nowIso(),
      updatedAt: d.updatedAt || d.createdAt || nowIso(),
      clientId: d.clientId ?? null,
    }));
    const pinnedId = drafts.some((d) => d.id === obj.pinnedId) ? obj.pinnedId : drafts[0].id;
    return { v: 2, pinnedId, drafts };
  }
  // Legacy single-doc record (pre-versioning) → wrap it as the first draft.
  if (obj && (typeof obj.title === "string" || obj.doc)) {
    const d = makeDraft({ name: "Draft 1", title: obj.title || "", doc: obj.doc ?? null });
    if (obj.updatedAt) d.updatedAt = obj.updatedAt;
    return { v: 2, pinnedId: d.id, drafts: [d] };
  }
  // Empty / unknown → a fresh single blank draft.
  const d = makeDraft({ name: "Draft 1" });
  return { v: 2, pinnedId: d.id, drafts: [d] };
}

const pinnedDraft = (store) =>
  store.drafts.find((d) => d.id === store.pinnedId) || store.drafts[0];

const draftMeta = (d, pinnedId) => ({
  id: d.id,
  name: d.name,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
  lineCount: countLines(d.doc),
  pinned: d.id === pinnedId,
});
const metaList = (store) => store.drafts.map((d) => draftMeta(d, store.pinnedId));

function readStoreLocal() {
  try {
    return normalizeStore(JSON.parse(fs.readFileSync(SCRIPT_FILE, "utf8")));
  } catch {
    return normalizeStore(null);
  }
}
function writeStoreLocal(store) {
  fs.mkdirSync(SCRIPT_DIR, { recursive: true });
  fs.writeFileSync(SCRIPT_FILE, JSON.stringify(store, null, 2));
}

async function readStore() {
  if (SCRIPT_STORE_URL) {
    try {
      const r = await fetch(SCRIPT_STORE_URL, { method: "GET" });
      if (r.ok) return normalizeStore(await r.json());
      // 404 etc. (e.g. /script not deployed yet) → fall back to local.
    } catch {
      /* network error → fall back to local */
    }
  }
  return readStoreLocal();
}
async function writeStore(store) {
  if (SCRIPT_STORE_URL) {
    try {
      const r = await fetch(SCRIPT_STORE_URL, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(store),
      });
      if (r.ok) return;
      // else fall through to local so a save is never lost.
    } catch {
      /* network error → persist locally instead */
    }
  }
  writeStoreLocal(store);
}

// Live updates: any client (browser) or the chat agent that PUTs the script
// broadcasts a change to every open Script tab over Server-Sent Events. The
// payload carries the saver's `clientId` so a browser can ignore the echo of
// its own save (and glow / reload only for edits made elsewhere — e.g. the agent).
const scriptClients = new Set();
function broadcastScript(payload) {
  const frame = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of scriptClients) {
    try { res.write(frame); } catch { /* drop dead connections on next close */ }
  }
}

app.get("/api/script/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.write(": connected\n\n");
  scriptClients.add(res);
  const heartbeat = setInterval(() => {
    try { res.write(": ping\n\n"); } catch { /* ignore */ }
  }, 25000);
  req.on("close", () => {
    clearInterval(heartbeat);
    scriptClients.delete(res);
  });
});

// Read the PINNED draft (plus the drafts index so the UI can render the
// version-control menu in one round-trip). Shape stays backward-compatible:
// { title, doc, updatedAt, clientId } is what the editor + agent tools read.
app.get("/api/script", async (req, res) => {
  try {
    const store = await readStore();
    const d = pinnedDraft(store);
    const sign = readDB().scriptSignoff?.[d.id] || null;
    res.json({
      title: d.title,
      doc: d.doc,
      updatedAt: d.updatedAt,
      clientId: d.clientId,
      draftId: d.id,
      draftName: d.name,
      pinnedId: store.pinnedId,
      drafts: metaList(store),
      // Pipeline gate: the pinned draft's sign-off + whether a shot list already
      // exists (so the Script tab can enable/disable "Generate shot list").
      signed: !!sign,
      signedAt: sign?.at || null,
      shotlistExists: shotlistShots().length > 0,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Sign / unsign the PINNED script draft. A signed draft unlocks the next stage
// (generate the shot list). Any edit to the draft clears this (see PUT above).
app.post("/api/script/sign", async (req, res) => {
  try {
    const { signed = true, by } = req.body || {};
    const store = await readStore();
    const d = pinnedDraft(store);
    const db = readDB();
    db.scriptSignoff = db.scriptSignoff || {};
    if (signed) db.scriptSignoff[d.id] = { at: new Date().toISOString(), by: by || null };
    else delete db.scriptSignoff[d.id];
    writeDB(db);
    res.json({ ok: true, draftId: d.id, signed: !!signed, signedAt: db.scriptSignoff[d.id]?.at || null });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Save into the PINNED draft (the editor autosave + agent save/append tools).
app.put("/api/script", async (req, res) => {
  try {
    const { title, doc, clientId } = req.body || {};
    const store = await readStore();
    const d = pinnedDraft(store);
    d.title = typeof title === "string" ? title : "";
    d.doc = doc ?? null;
    d.updatedAt = nowIso();
    d.clientId = clientId ?? null;
    await writeStore(store);
    // Editing the script invalidates its sign-off — it must be re-signed before
    // the shot list can be (re)generated from it.
    const db = readDB();
    if (db.scriptSignoff?.[d.id]) { delete db.scriptSignoff[d.id]; writeDB(db); }
    broadcastScript({ updatedAt: d.updatedAt, clientId: clientId ?? null, pinnedId: store.pinnedId });
    res.json({ ok: true, updatedAt: d.updatedAt, draftId: d.id });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// --- Script drafts (version control) --------------------------------------
// List every draft + which one is pinned.
app.get("/api/script/drafts", async (req, res) => {
  try {
    const store = await readStore();
    res.json({ drafts: metaList(store), pinnedId: store.pinnedId });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Create a new draft. By default it clones the current pinned draft's content
// (so "save current, keep writing on a fresh version"); pass { blank: true } to
// start empty. The new draft becomes pinned; the previous one stays in history.
app.post("/api/script/drafts", async (req, res) => {
  try {
    const { name, blank, clientId } = req.body || {};
    const store = await readStore();
    const cur = pinnedDraft(store);
    const draft = makeDraft({
      name: typeof name === "string" && name.trim() ? name.trim() : `Draft ${store.drafts.length + 1}`,
      title: blank ? "" : cur.title,
      doc: blank ? null : cur.doc,
      clientId: clientId ?? null,
    });
    store.drafts.push(draft);
    store.pinnedId = draft.id;
    await writeStore(store);
    broadcastScript({ updatedAt: draft.updatedAt, clientId: clientId ?? null, pinnedId: store.pinnedId });
    res.json({ ok: true, draft: draftMeta(draft, store.pinnedId), drafts: metaList(store), pinnedId: store.pinnedId });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Switch the pinned (active) draft — everything (editor + agent) now edits it.
app.post("/api/script/pin", async (req, res) => {
  try {
    const { id, clientId } = req.body || {};
    const store = await readStore();
    if (!store.drafts.some((d) => d.id === id)) {
      return res.status(404).json({ error: `no draft ${id}` });
    }
    store.pinnedId = id;
    await writeStore(store);
    const d = pinnedDraft(store);
    broadcastScript({ updatedAt: d.updatedAt, clientId: clientId ?? null, pinnedId: store.pinnedId });
    res.json({ ok: true, pinnedId: store.pinnedId, drafts: metaList(store) });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Rename a draft.
app.patch("/api/script/drafts/:id", async (req, res) => {
  try {
    const { name, clientId } = req.body || {};
    const store = await readStore();
    const d = store.drafts.find((x) => x.id === req.params.id);
    if (!d) return res.status(404).json({ error: `no draft ${req.params.id}` });
    if (typeof name === "string" && name.trim()) d.name = name.trim();
    await writeStore(store);
    broadcastScript({ updatedAt: nowIso(), clientId: clientId ?? null, pinnedId: store.pinnedId });
    res.json({ ok: true, drafts: metaList(store), pinnedId: store.pinnedId });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Delete a draft (never the last one). If the pinned draft is removed, pin the
// most recently updated of what remains.
app.delete("/api/script/drafts/:id", async (req, res) => {
  try {
    const clientId = req.body?.clientId ?? null;
    const store = await readStore();
    if (store.drafts.length <= 1) {
      return res.status(400).json({ error: "cannot delete the only draft" });
    }
    const idx = store.drafts.findIndex((d) => d.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: `no draft ${req.params.id}` });
    const wasPinned = store.pinnedId === req.params.id;
    store.drafts.splice(idx, 1);
    if (wasPinned) {
      store.pinnedId = [...store.drafts].sort((a, b) =>
        (b.updatedAt || "").localeCompare(a.updatedAt || ""))[0].id;
    }
    await writeStore(store);
    const d = pinnedDraft(store);
    broadcastScript({ updatedAt: d.updatedAt, clientId, pinnedId: store.pinnedId });
    res.json({ ok: true, drafts: metaList(store), pinnedId: store.pinnedId });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// --- Shot list: the editable granular per-shot list -----------------------
// The flat shot list (every ~2-3s shot with its own Seedance prompt), which
// auto-packs into the <=15s multishot bundles. Its own mutable file; the .txt /
// multishot_bundles.json remain read-only build outputs.

// One shot's canonical field set (SHOT | TIME | CAMERA | ACTION |
// SEEDANCE-PROMPT | AUDIO-SYNC — the columns from the source shot list).
function normalizeShot(s, i) {
  const n = i + 1;
  return {
    n,
    id: s.id || String(n).padStart(2, "0"),
    src: s.src || s.id || String(n).padStart(2, "0"),
    beat: s.beat || "",
    beatTitle: s.beatTitle || "",
    dur: Number(s.dur) || 0,
    location: s.location || "",
    characters: Array.isArray(s.characters) ? s.characters : (s.characters ? [s.characters] : []),
    camera: s.camera || "",
    action: s.action || s.summary || "",
    dialogue: s.dialogue || "",
    audioSync: s.audioSync || "",
    prompt: s.prompt || "",
  };
}

function readShotlist() {
  try {
    const obj = JSON.parse(fs.readFileSync(SHOTLIST_FILE, "utf8"));
    return { ...obj, shots: (obj.shots || []).map(normalizeShot) };
  } catch {
    return { generatedAt: null, source: null, shots: [] };
  }
}
function writeShotlist(obj) {
  fs.mkdirSync(path.dirname(SHOTLIST_FILE), { recursive: true });
  fs.writeFileSync(SHOTLIST_FILE, JSON.stringify(obj, null, 2));
}
const shotlistShots = () => readShotlist().shots;

// Recreate the shot list from the existing episode manifest: flatten every
// bundle's ordered shots into one globally-numbered list. 2D-directing / audio
// aren't in the manifest (that build dropped them) → left blank to fill in later.
function rebuildShotlistFromEpisode() {
  const manifest = JSON.parse(fs.readFileSync(EPISODE_MANIFEST, "utf8"));
  const flat = [];
  for (const b of manifest.bundles || []) {
    for (const s of b.shots || []) {
      flat.push(normalizeShot({ ...s, action: s.summary || s.action, beat: b.beat, beatTitle: b.beatTitle }, flat.length));
    }
  }
  const obj = { generatedAt: new Date().toISOString(), source: "episode", shots: flat };
  writeShotlist(obj);
  return obj;
}

// Read the shot list (auto-seeding from the current episode on first use) plus
// the live <=15s pack preview.
app.get("/api/shotlist", (req, res) => {
  try {
    let sl = readShotlist();
    if (!sl.shots.length && fs.existsSync(EPISODE_MANIFEST)) sl = rebuildShotlistFromEpisode();
    res.json({ ...sl, packs: packPreview(sl.shots) });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Replace the whole shot list (agent `save_shotlist`, or a bulk UI save).
app.post("/api/shotlist", (req, res) => {
  try {
    const { shots, source } = req.body || {};
    if (!Array.isArray(shots)) return res.status(400).json({ error: "shots[] required" });
    const obj = { generatedAt: new Date().toISOString(), source: source || "agent", shots: shots.map(normalizeShot) };
    writeShotlist(obj);
    res.json({ ok: true, count: obj.shots.length, packs: packPreview(obj.shots) });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Edit one shot in place (inline editing on the Shot list tab).
app.put("/api/shotlist/shot/:n", (req, res) => {
  try {
    const n = Number(req.params.n);
    const sl = readShotlist();
    const idx = sl.shots.findIndex((s) => s.n === n);
    if (idx < 0) return res.status(404).json({ error: `no shot ${n}` });
    const patch = req.body || {};
    sl.shots[idx] = normalizeShot({ ...sl.shots[idx], ...patch }, idx);
    writeShotlist(sl);
    res.json({ ok: true, shot: sl.shots[idx], packs: packPreview(sl.shots) });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Recreate the shot list from the current episode (the "Rebuild" button).
app.post("/api/shotlist/rebuild-from-episode", (req, res) => {
  try {
    if (!fs.existsSync(EPISODE_MANIFEST)) return res.status(400).json({ error: "No episode manifest to rebuild from" });
    const obj = rebuildShotlistFromEpisode();
    res.json({ ...obj, packs: packPreview(obj.shots) });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// The live <=15s multishot pack preview for the current shot list.
app.get("/api/shotlist/packs", (req, res) => {
  try {
    res.json({ packs: packPreview(shotlistShots()) });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

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
            abs: path.join(PROJECT_ROOT, im.rel),
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
    db.episodeAudio = {};
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

      // audio: one voice reference per bundle based on speaking characters present
      const chars = new Set(b.shots.flatMap((s) => s.characters || []));
      const audioRel = pickAudio(chars);
      db.episodeAudio[b.id] = audioRel ? [audioRel] : [];
    }
    writeDB(db);
    res.json({ ok: true, bundles: manifest.bundles.length, totalAssigned, summary });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Available voice/sound references + current per-bundle audio picks.
app.get("/api/audio", (req, res) => {
  try {
    const db = readDB();
    const items = AUDIO_REFS.map((a) => ({
      ...a,
      abs: path.join(PROJECT_ROOT, a.rel),
      url: "/asset/" + a.rel.split(path.sep).join("/"),
      exists: fs.existsSync(path.join(PROJECT_ROOT, a.rel)),
    }));
    res.json({ audio: items, episode: db.episodeAudio || {} });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Toggle a voice reference for one bundle.
app.post("/api/episode/audio-select", (req, res) => {
  try {
    const { bundle, rel, selected } = req.body || {};
    if (!bundle || !rel) return res.status(400).json({ error: "Missing 'bundle' or 'rel'" });
    const db = readDB();
    db.episodeAudio = db.episodeAudio || {};
    const cur = new Set(db.episodeAudio[bundle] || []);
    if (selected) cur.add(rel);
    else cur.delete(rel);
    db.episodeAudio[bundle] = [...cur];
    writeDB(db);
    res.json({ ok: true, bundle, selected: db.episodeAudio[bundle] });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Revision signing: sign off one SECTION of a bundle (images | prompt | audio).
// Each section is an independent signature { by, at }; clearing sets it null.
const SIGN_SECTIONS = new Set(["images", "prompt", "audio"]);
app.post("/api/episode/sign", (req, res) => {
  try {
    const { bundle, section, signed, signedBy } = req.body || {};
    if (!bundle || !SIGN_SECTIONS.has(section))
      return res.status(400).json({ error: "Missing 'bundle' or invalid 'section'" });
    if (signed && !String(signedBy || "").trim())
      return res.status(400).json({ error: "Missing 'signedBy'" });
    const db = readDB();
    db.signoffs = db.signoffs || {};
    const cur = db.signoffs[bundle] || { images: null, prompt: null, audio: null };
    cur[section] = signed ? { by: String(signedBy).trim(), at: new Date().toISOString() } : null;
    db.signoffs[bundle] = cur;
    writeDB(db);
    res.json({ ok: true, bundle, signoff: cur });
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
    const db = readDB();
    if (normalizeVideoSelections(db)) writeDB(db); // heal any stale multi-selection
    // Attach a list of rendered clips (newest last) for every bundle that has any
    // on disk. db.video[id] is an array of generations; tolerate the old single
    // object shape too.
    const video = {};
    for (const [id, entry] of Object.entries(db.video || {})) {
      const arr = Array.isArray(entry) ? entry : entry ? [entry] : [];
      const list = arr
        .filter((v) => v && v.file && fs.existsSync(path.join(GEN_DIR, v.file)))
        .map((v, idx) => ({ ...v, name: v.name || `gen ${idx + 1}`, url: "/gen/" + v.file }));
      if (list.length) video[id] = list;
    }
    res.json({ episode: manifest, video, prompts: db.prompt || {}, signoffs: db.signoffs || {} });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Mark a rendered generation as selected/deselected (for stitching later).
app.post("/api/episode/video-select", (req, res) => {
  try {
    const { bundle, file, selected } = req.body || {};
    if (!bundle || !file) return res.status(400).json({ error: "Missing 'bundle' or 'file'" });
    const db = readDB();
    const arr = Array.isArray(db.video?.[bundle]) ? db.video[bundle] : db.video?.[bundle] ? [db.video[bundle]] : [];
    const g = arr.find((v) => v.file === file);
    if (!g) return res.status(404).json({ error: "Generation not found" });
    g.selected = !!selected;
    // Single-selection: picking a take clears any other selected take in the
    // bundle and stamps WHEN it was picked, so the most recent pick wins at
    // stitch time even if stale flags linger.
    if (g.selected) {
      g.selectedAt = new Date().toISOString();
      arr.forEach((v) => { if (v.file !== file) v.selected = false; });
    }
    db.video[bundle] = arr;
    writeDB(db);
    res.json({ ok: true, bundle, file, selected: g.selected });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

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
// exists on disk; if none is selected, the first present take (a fallback).
function pickTake(entry) {
  const list = Array.isArray(entry) ? entry : entry ? [entry] : [];
  const present = list.filter((v) => v && v.file && fs.existsSync(path.join(GEN_DIR, v.file)));
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

async function probeDuration(file) {
  try {
    const { stdout } = await execFileP("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      path.join(GEN_DIR, file),
    ]);
    return parseFloat(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

// Ordered MS-01 … last-rendered plan with the chosen take, duration, and the
// from→to timecode each segment occupies in the stitched output.
async function buildCutSegments() {
  const db = readDB();
  const ids = Object.keys(db.video || {}).sort((a, b) => bundleNum(a) - bundleNum(b));
  const segs = [];
  let cursor = 0;
  for (const id of ids) {
    const picked = pickTake(db.video?.[id]);
    if (!picked) {
      segs.push({ id, file: null, missing: true, start: cursor, duration: 0, end: cursor });
      continue;
    }
    const duration = await probeDuration(picked.take.file);
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

// Resolve a Sound Studio track's ready media file → { abs, file, name } or null.
function soundFileForTrack(trackId) {
  try {
    const db = JSON.parse(fs.readFileSync(SOUNDS_DB, "utf8"));
    const t = (db.tracks || []).find((x) => x.id === trackId);
    if (!t) return null;
    const v =
      [...(t.versions || [])].reverse().find((x) => x.file && x.status === "ready") ||
      (t.versions || []).find((x) => x.file);
    if (!v || !v.file) return null;
    const abs = path.join(SOUND_MEDIA, v.file);
    return fs.existsSync(abs) ? { abs, file: v.file, name: t.name } : null;
  } catch {
    return null;
  }
}

// Placement of each music cue over the stitched segments: where it starts (its
// first bundle's timecode) and the beat span it underscores.
async function buildScoreLayout(segments) {
  const present = segments.filter((s) => s.file);
  const numOf = (s) => bundleNum(s.id);
  const layout = [];
  for (const cue of MUSIC_CUES) {
    const firstSeg = present.find((s) => numOf(s) === cue.first);
    if (!firstSeg) continue; // beat not in the cut
    const inBeat = present.filter((s) => numOf(s) >= cue.first && numOf(s) <= cue.last);
    const snd = soundFileForTrack(cue.track);
    if (!snd) continue; // no rendered music yet
    const duration = await soundDuration(snd.abs);
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

// Normalized list of scored versions that still exist on disk, newest first.
// Migrates the legacy single `db.cut.scored` into a v1 entry when present.
function listScoredVersions(db) {
  let versions = Array.isArray(db.cut?.scoredVersions) ? db.cut.scoredVersions.slice() : [];
  if (!versions.length && db.cut?.scored && fs.existsSync(path.join(GEN_DIR, SCORED_CUT_FILE))) {
    versions = [{ v: 1, file: SCORED_CUT_FILE, ...db.cut.scored }];
  }
  return versions
    .filter((x) => fs.existsSync(path.join(GEN_DIR, x.file)))
    .map((x) => ({ ...x, url: "/gen/" + x.file }))
    .sort((a, b) => b.v - a.v);
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
function legacyToHistory(db) {
  const out = [];
  const cut = db.cut;
  if (cut && fs.existsSync(path.join(GEN_DIR, CUT_FILE))) {
    out.push({ v: 1, kind: "stitch", file: CUT_FILE, at: cut.stitchedAt || null, range: cut.range || null, totalDuration: cut.totalDuration || 0, segments: cut.segments || [] });
  }
  for (const sv of listScoredVersions(db).slice().sort((a, b) => a.v - b.v)) {
    out.push({ v: out.length + 1, kind: "scored", file: sv.file, at: sv.createdAt || null, range: cut?.range || null, totalDuration: cut?.totalDuration || 0, segments: sv.segments || cut?.segments || [], gainDb: sv.gainDb, baseV: 1, music: sv.music || [] });
  }
  return out;
}

// Ensure db.cutHistory exists (migrating legacy on first touch); returns it.
function ensureCutHistory(db) {
  if (!Array.isArray(db.cutHistory)) db.cutHistory = legacyToHistory(db);
  return db.cutHistory;
}
// Next monotonic version across ALL generations (stitch + scored).
function nextCutV(db) {
  return ensureCutHistory(db).reduce((m, g) => Math.max(m, g.v || 0), 0) + 1;
}
// Normalized history for the API: existing files only, newest-first, url added.
function getCutHistory(db) {
  return ensureCutHistory(db)
    .filter((g) => g.file && fs.existsSync(path.join(GEN_DIR, g.file)))
    .map((g) => ({ ...g, url: "/gen/" + g.file, withMusic: g.kind === "scored" }))
    .sort((a, b) => (b.v || 0) - (a.v || 0));
}

const freezeSegs = (segs) => segs.filter((s) => s.file).map((s) => ({ id: s.id, file: s.file, name: s.name, fallback: s.fallback, start: s.start, duration: s.duration, end: s.end }));
const cleanMusic = (layout) => layout.map((m) => ({ track: m.track, label: m.label, name: m.name, start: m.start, beatEnd: m.beatEnd, duration: m.duration }));

// Overlay the background-music cues under a base cut video → outAbs. Music sits
// at `gain` (linear) under the baked-in dialogue/SFX; the sum is soft-limited.
async function mixScore(baseAbs, layout, gain, outAbs) {
  const inputs = ["-i", baseAbs];
  for (const m of layout) inputs.push("-i", path.join(SOUND_MEDIA, m.file));
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
  await execFileP("ffmpeg", ["-y", ...inputs, "-filter_complex", filter, "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", outAbs]);
}

// Read the current plan, the latest generation (`output`), and the full history.
app.get("/api/episode/cuts", async (req, res) => {
  try {
    const db = readDB();
    if (normalizeVideoSelections(db)) writeDB(db); // heal stale multi-selection first
    const segments = annotateSegmentsMusic(await buildCutSegments());
    const music = await buildScoreLayout(segments);
    const history = getCutHistory(db);
    res.json({ range: segRange(segments), segments, music, output: history[0] || null, history });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ---------------------------------------------------------------------------
// Editor timeline — the editable, per-clip representation of a complete cut used
// by the Remotion <Player> editor tab and the chat agent. Stored as
// `db.editorTimeline`. Frames are at TL_FPS; media are the same /gen and
// /sound-media URLs the cut uses. Both the UI and the agent read/write it here
// so a chat edit and a drag on the timeline stay in sync.
// ---------------------------------------------------------------------------
const TL_FPS = 24;
const secFrames = (sec) => Math.max(1, Math.round((sec || 0) * TL_FPS));

// Build a fresh timeline from a stored cut generation (its ordered clips + music
// bed). `v` selects the cut version; omitted → the latest generation.
function buildTimelineFromCut(db, v) {
  const hist = getCutHistory(db);
  const gen = v != null ? hist.find((g) => g.v === Number(v)) : hist[0];
  if (!gen) return null;
  const videoItems = (gen.segments || [])
    .filter((s) => s.file)
    .map((s, i) => {
      const from = Math.round((s.start || 0) * TL_FPS);
      return {
        id: `v${gen.v}_${i}_${s.id}`,
        src: "/gen/" + s.file,
        name: `${s.id} · ${s.name || s.file}`,
        bundle: s.id,
        from,
        durationInFrames: secFrames(s.duration),
        // The clip's natural (full source) length in frames — a video can be
        // trimmed shorter but never stretched past this on the timeline.
        sourceDurationInFrames: secFrames(s.duration),
        volume: 1,
      };
    });
  const musicItems = (gen.music || [])
    .map((m, i) => {
      const snd = soundFileForTrack(m.track);
      if (!snd) return null;
      const from = Math.round((m.start || 0) * TL_FPS);
      const endSec = m.beatEnd != null ? m.beatEnd : (m.start || 0) + (m.duration || 0);
      const end = Math.round(endSec * TL_FPS);
      return {
        id: `m${gen.v}_${i}_${m.track}`,
        src: "/sound-media/" + snd.file,
        name: m.name || m.label || m.track,
        track: m.track,
        from,
        durationInFrames: Math.max(1, end - from),
        volume: gen.gainDb != null ? Math.pow(10, gen.gainDb / 20) : MUSIC_BED_GAIN,
      };
    })
    .filter(Boolean);
  return {
    fps: TL_FPS,
    width: 1280,
    height: 720,
    source: { kind: gen.kind, v: gen.v, file: gen.file, at: gen.at || null },
    tracks: [
      { id: "video", name: "Video", type: "video", items: videoItems },
      { id: "music", name: "Music", type: "audio", items: musicItems },
    ],
  };
}

const findItem = (tl, id) => {
  for (const t of tl.tracks || []) {
    const it = (t.items || []).find((x) => x.id === id);
    if (it) return { track: t, item: it };
  }
  return null;
};
// Lay a track's items end-to-end from frame 0 (gapless), in current array order.
const repackTrack = (track) => {
  let cur = 0;
  for (const it of track.items) {
    it.from = cur;
    cur += it.durationInFrames;
  }
};

// Apply a list of edit ops to a timeline in place. Ops:
//   { op:"move", id, from }                 – set an item's start frame
//   { op:"resize", id, durationInFrames }   – set an item's length
//   { op:"remove", id }                     – delete an item
//   { op:"volume", id, volume }             – set gain (0..2, 1 = unity)
//   { op:"mute", id, muted }                – mute/unmute an item
//   { op:"reorder", track, order:[ids] }    – reorder + repack a track gapless
//   { op:"repack", track }                  – close gaps in a track, gapless
function applyTimelineOps(tl, ops) {
  for (const op of ops || []) {
    if (op.op === "move" && op.id != null) {
      const f = findItem(tl, op.id);
      if (f) f.item.from = Math.max(0, Math.round(op.from || 0));
    } else if (op.op === "resize" && op.id != null) {
      const f = findItem(tl, op.id);
      if (f) {
        let d = Math.max(1, Math.round(op.durationInFrames || 1));
        if (f.item.sourceDurationInFrames) d = Math.min(d, f.item.sourceDurationInFrames); // can't exceed source length
        f.item.durationInFrames = d;
      }
    } else if (op.op === "remove" && op.id != null) {
      for (const t of tl.tracks) t.items = t.items.filter((x) => x.id !== op.id);
    } else if (op.op === "volume" && op.id != null) {
      const f = findItem(tl, op.id);
      if (f) f.item.volume = Math.min(2, Math.max(0, Number(op.volume)));
    } else if (op.op === "mute" && op.id != null) {
      const f = findItem(tl, op.id);
      if (f) f.item.muted = !!op.muted;
    } else if (op.op === "disable" && op.id != null) {
      const f = findItem(tl, op.id);
      if (f) f.item.disabled = !!op.disabled;
    } else if (op.op === "reorder" && op.track && Array.isArray(op.order)) {
      const t = tl.tracks.find((x) => x.id === op.track);
      if (t) {
        const byId = new Map(t.items.map((it) => [it.id, it]));
        const ordered = op.order.map((id) => byId.get(id)).filter(Boolean);
        for (const it of t.items) if (!ordered.includes(it)) ordered.push(it);
        t.items = ordered;
        repackTrack(t);
      }
    } else if (op.op === "repack" && op.track) {
      const t = tl.tracks.find((x) => x.id === op.track);
      if (t) {
        t.items.sort((a, b) => a.from - b.from);
        repackTrack(t);
      }
    }
  }
  return tl;
}

// Read the saved editor timeline (null if none yet), plus the list of cut
// generations the editor can load from.
app.get("/api/timeline", (req, res) => {
  try {
    const db = readDB();
    const cuts = getCutHistory(db).map((g) => ({
      v: g.v,
      kind: g.kind,
      file: g.file,
      url: g.url,
      at: g.at || null,
      withMusic: g.withMusic,
      clips: (g.segments || []).filter((s) => s.file).length,
      music: (g.music || []).length,
      totalDuration: g.totalDuration || 0,
    }));
    res.json({ timeline: db.editorTimeline || null, cuts });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Replace the saved timeline outright (the UI autosaves the whole thing here).
app.post("/api/timeline", (req, res) => {
  try {
    const { timeline } = req.body || {};
    if (!timeline || !Array.isArray(timeline.tracks)) {
      return res.status(400).json({ error: "Body must be { timeline: { tracks: [...] } }" });
    }
    const db = readDB();
    db.editorTimeline = timeline;
    writeDB(db);
    res.json({ ok: true, timeline });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Load a complete cut into the editor (its clips + music, in order), replacing
// the working timeline. `v` = cut version (default: latest generation).
app.post("/api/timeline/from-cut", (req, res) => {
  try {
    const db = readDB();
    const timeline = buildTimelineFromCut(db, req.body?.v);
    if (!timeline) return res.status(404).json({ error: "No matching cut generation to load" });
    db.editorTimeline = timeline;
    writeDB(db);
    res.json({ ok: true, timeline });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Apply granular edit ops to the working timeline (used by the chat agent).
app.post("/api/timeline/edit", (req, res) => {
  try {
    const ops = req.body?.ops;
    if (!Array.isArray(ops)) return res.status(400).json({ error: "Body must be { ops: [...] }" });
    const db = readDB();
    if (!db.editorTimeline || !Array.isArray(db.editorTimeline.tracks)) {
      return res.status(400).json({ error: "No timeline loaded yet — load a cut into the editor first" });
    }
    applyTimelineOps(db.editorTimeline, ops);
    writeDB(db);
    res.json({ ok: true, timeline: db.editorTimeline });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Stitch the selected takes (MS-01 … last rendered) into a NEW versioned mp4 via
// ffmpeg. Never overwrites a prior generation; if music was added before, the
// fresh cut is re-scored so the newest version still has the background music.
app.post("/api/episode/stitch", async (req, res) => {
  try {
    const db = readDB();
    if (normalizeVideoSelections(db)) writeDB(db); // stitch the take actually picked
    const segments = await buildCutSegments();
    const usable = segments.filter((s) => s.file);
    if (!usable.length) return res.status(400).json({ error: "No rendered takes to stitch" });

    fs.mkdirSync(GEN_DIR, { recursive: true });
    ensureCutHistory(db);
    const v = nextCutV(db);
    const outPath = path.join(GEN_DIR, cutVersionFile(v));

    // ffmpeg concat-demuxer list file (abs paths, single quotes escaped).
    const listPath = path.join(GEN_DIR, ".complete_cut_list.txt");
    fs.writeFileSync(
      listPath,
      usable.map((s) => `file '${path.join(GEN_DIR, s.file).replace(/'/g, "'\\''")}'`).join("\n") + "\n",
      "utf8",
    );
    // All takes share codec/res/fps (h264 1280x720 24fps + aac), so a fast
    // stream copy works; if it ever fails, fall back to a re-encode.
    const concatArgs = (extra) => ["-y", "-f", "concat", "-safe", "0", "-i", listPath, ...extra, outPath];
    try {
      await execFileP("ffmpeg", concatArgs(["-c", "copy", "-fflags", "+genpts"]));
    } catch {
      await execFileP("ffmpeg", concatArgs(["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-vsync", "cfr", "-r", "24"]));
    }
    fs.rmSync(listPath, { force: true });

    const totalDuration = usable.reduce((a, s) => a + s.duration, 0);
    const frozen = freezeSegs(segments);
    const range = segRange(usable);
    const base = { v, kind: "stitch", file: cutVersionFile(v), at: new Date().toISOString(), range, totalDuration, segments: frozen };
    db.cutHistory.push(base);

    // Carry the background music forward: if music was ever added, re-score this
    // fresh cut (at the most recent bed level) so the NEWEST version still has
    // music. Prior generations are preserved in the history regardless.
    let latest = base;
    let carriedMusic = false;
    const scoredBefore = db.cutHistory.filter((g) => g.kind === "scored");
    if (scoredBefore.length) {
      const layout = await buildScoreLayout(segments);
      if (layout.length) {
        const lastDb = scoredBefore[scoredBefore.length - 1].gainDb;
        const gain = typeof lastDb === "number" ? Math.pow(10, lastDb / 20) : MUSIC_BED_GAIN;
        const sv = nextCutV(db);
        await mixScore(outPath, layout, gain, path.join(GEN_DIR, cutVersionFile(sv)));
        latest = { v: sv, kind: "scored", file: cutVersionFile(sv), at: new Date().toISOString(), range, totalDuration, segments: frozen, gainDb: Math.round(20 * Math.log10(gain)), baseV: v, music: cleanMusic(layout) };
        db.cutHistory.push(latest);
        carriedMusic = true;
      }
    }

    db.cut = { range, segments: frozen, totalDuration, stitchedAt: base.at }; // legacy pointer
    delete db.cut.scored;
    writeDB(db);

    res.json({ ok: true, url: "/gen/" + latest.file, file: latest.file, version: latest.v, kind: latest.kind, carriedMusic, totalDuration, count: usable.length });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Overlay the background-music cues under the latest music-FREE base cut → a NEW
// versioned scored generation (previous versions are kept for A/B). Music sits
// low under the baked-in dialogue/SFX; peaks are soft-limited.
app.post("/api/episode/score", async (req, res) => {
  try {
    const db = readDB();
    ensureCutHistory(db);
    // Score the most recent base stitch (clean overlay), else the latest cut.
    const base =
      [...db.cutHistory].reverse().find((g) => g.kind === "stitch" && fs.existsSync(path.join(GEN_DIR, g.file))) ||
      [...db.cutHistory].reverse().find((g) => g.file && fs.existsSync(path.join(GEN_DIR, g.file)));
    if (!base) return res.status(400).json({ error: "Stitch the cut first" });

    // Use the base's FROZEN segments so the music timecodes match its video.
    const baseSegs = base.segments && base.segments.length ? base.segments : freezeSegs(await buildCutSegments());
    const layout = await buildScoreLayout(baseSegs);
    if (!layout.length) return res.status(400).json({ error: "No rendered music cues to add" });

    const gain = typeof req.body?.gain === "number" && req.body.gain > 0 ? req.body.gain : MUSIC_BED_GAIN;
    const v = nextCutV(db);
    const file = cutVersionFile(v);
    await mixScore(path.join(GEN_DIR, base.file), layout, gain, path.join(GEN_DIR, file));

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
    writeDB(db);

    res.json({ ok: true, version: v, url: "/gen/" + file, file, gainDb: entry.gainDb, count: layout.length, music: entry.music });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Save (or clear) an edited skill prompt for one bundle. Empty/omitted text
// clears the override so the bundle falls back to the live-composed prompt.
app.post("/api/episode/prompt", (req, res) => {
  try {
    const { bundle, text } = req.body || {};
    if (!bundle) return res.status(400).json({ error: "Missing 'bundle'" });
    const db = readDB();
    db.prompt = db.prompt || {};
    if (typeof text === "string" && text.length) db.prompt[bundle] = text;
    else delete db.prompt[bundle];
    writeDB(db);
    res.json({ ok: true, bundle, saved: !!db.prompt[bundle] });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Attach a rendered Seedance clip to a bundle. APPENDS a new generation (keeps
// prior ones) — downloads `url` into generations/<bundle>_genN.mp4 and records it.
app.post("/api/episode/video", async (req, res) => {
  try {
    const { bundle, url, jobId } = req.body || {};
    if (!bundle || !url) return res.status(400).json({ error: "Missing 'bundle' or 'url'" });
    fs.mkdirSync(GEN_DIR, { recursive: true });
    const db = readDB();
    db.video = db.video || {};
    // normalize to an array (migrate old single-object / legacy <bundle>.mp4 entry)
    let list = db.video[bundle];
    list = Array.isArray(list) ? list : list ? [list] : [];
    const n = list.length + 1;
    const file = `${bundle}_gen${n}.mp4`;
    const resp = await fetch(url);
    if (!resp.ok) return res.status(502).json({ error: `Download failed: ${resp.status}` });
    const buf = Buffer.from(await resp.arrayBuffer());
    fs.writeFileSync(path.join(GEN_DIR, file), buf);
    list.push({ file, name: `gen ${n}`, jobId: jobId || null, source: url, ts: new Date().toISOString() });
    db.video[bundle] = list;
    writeDB(db);
    res.json({ ok: true, bundle, name: `gen ${n}`, count: list.length, url: "/gen/" + file });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Trim a rendered take to a sub-range [from, to] seconds → a NEW "trim" version
// stored ALONGSIDE the original (the source take is never mutated, so it stays in
// history and remains selectable). The trim take carries kind:"trim", a sourceFile
// link, and its trim:{start,end}; the /api/episode selection + stitch flow keys on
// `file`, so a trim is picked/stitched exactly like any other take. ffmpeg cuts a
// frame-accurate re-encode (clips are short) so the cut lands where the handle sat.
app.post("/api/episode/trim", async (req, res) => {
  try {
    let { bundle, sourceFile, from, to } = req.body || {};
    if (!bundle || !sourceFile) return res.status(400).json({ error: "Missing 'bundle' or 'sourceFile'" });
    from = Number(from);
    to = Number(to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return res.status(400).json({ error: "'from' and 'to' must be numbers (seconds)" });

    const db = readDB();
    db.video = db.video || {};
    let list = db.video[bundle];
    list = Array.isArray(list) ? list : list ? [list] : [];
    const srcIdx = list.findIndex((v) => v.file === sourceFile);
    if (srcIdx < 0) return res.status(404).json({ error: "Source take not found" });
    const src = list[srcIdx];
    const srcPath = path.join(GEN_DIR, sourceFile);
    if (!fs.existsSync(srcPath)) return res.status(404).json({ error: "Source file missing on disk" });

    // Clamp the range to the source clip and enforce a minimum length.
    const srcDur = await probeDuration(sourceFile);
    from = Math.max(0, from);
    if (srcDur > 0) to = Math.min(to, srcDur);
    if (to - from < 0.1) return res.status(400).json({ error: "Trim range must be at least 0.1s ('to' after 'from')" });

    fs.mkdirSync(GEN_DIR, { recursive: true });
    // Name derived from the source, versioned so repeated trims never collide and
    // the original is always kept: <sourceBase>_trimN.mp4.
    const base = sourceFile.replace(/\.mp4$/i, "");
    const trimCount = list.filter((v) => v.kind === "trim" && v.sourceFile === sourceFile).length;
    const file = `${base}_trim${trimCount + 1}.mp4`;

    // -ss before -i seeks fast AND accurately when re-encoding; -t (duration) is
    // unambiguous (unlike -to, whose reference point depends on -ss placement).
    await execFileP("ffmpeg", [
      "-y", "-ss", String(from), "-i", srcPath, "-t", String(to - from),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
      "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
      path.join(GEN_DIR, file),
    ]);

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
    writeDB(db);
    res.json({ ok: true, bundle, file, name: take.name, kind: "trim", trim, count: list.length, url: "/gen/" + file });
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

// ===========================================================================
// Sound Studio — a standalone audio library. Each "track" holds ordered
// versions; editing a prompt saves a NEW version (which starts "pending").
// The agent renders pending versions with Seed Audio, then attaches the audio
// (by remote URL or a local file path) — mirroring the episode video flow.
// ===========================================================================
function readSounds() {
  try {
    return JSON.parse(fs.readFileSync(SOUNDS_DB, "utf8"));
  } catch {
    return { tracks: [], seq: 0 };
  }
}
function writeSounds(db) {
  fs.mkdirSync(SOUND_DIR, { recursive: true });
  fs.writeFileSync(SOUNDS_DB, JSON.stringify(db, null, 2));
}
const findTrack = (db, id) => (db.tracks || []).find((t) => t.id === id) || null;
const nextVersion = (t) => t.versions.reduce((m, v) => Math.max(m, v.v), 0) + 1;
async function soundDuration(abs) {
  try {
    const { stdout } = await execFileP("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", abs,
    ]);
    return parseFloat(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}
// Serialize a track for the client, resolving each version's media URL.
const soundView = (t) => ({
  ...t,
  versions: t.versions.map((v) => ({
    ...v,
    url: v.file ? "/sound-media/" + v.file : null,
    // Resolve the URL of the voice reference used for this version (voice acting).
    ref: v.ref
      ? { ...v.ref, url: v.ref.file ? "/sound-media/" + v.ref.file : null }
      : undefined,
  })),
});

// List every track (newest first).
app.get("/api/sounds", (req, res) => {
  try {
    const db = readSounds();
    const tracks = [...(db.tracks || [])].reverse().map(soundView);
    res.json({ tracks });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Create a new track with an initial v1 (pending render).
app.post("/api/sounds", (req, res) => {
  try {
    const { name, prompt, params } = req.body || {};
    if (typeof prompt !== "string" || !prompt.trim())
      return res.status(400).json({ error: "Missing 'prompt'" });
    const db = readSounds();
    db.seq = (db.seq || 0) + 1;
    const now = new Date().toISOString();
    const track = {
      id: `trk_${db.seq}`,
      name: (name && name.trim()) || `sound ${db.seq}`,
      createdAt: now,
      versions: [{
        v: 1, prompt: prompt.trim(), name: null, file: null,
        status: "pending", liked: false, params: params || DEFAULT_SOUND_PARAMS, ts: now,
      }],
    };
    db.tracks = db.tracks || [];
    db.tracks.push(track);
    writeSounds(db);
    res.json({ ok: true, track: soundView(track) });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Rename a track.
app.patch("/api/sounds/:id", (req, res) => {
  try {
    const { name } = req.body || {};
    const db = readSounds();
    const t = findTrack(db, req.params.id);
    if (!t) return res.status(404).json({ error: "No such track" });
    if (typeof name === "string" && name.trim()) t.name = name.trim();
    writeSounds(db);
    res.json({ ok: true, track: soundView(t) });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Delete a track and all its media.
app.delete("/api/sounds/:id", (req, res) => {
  try {
    const db = readSounds();
    const t = findTrack(db, req.params.id);
    if (!t) return res.status(404).json({ error: "No such track" });
    for (const v of t.versions)
      if (v.file) fs.rmSync(path.join(SOUND_MEDIA, v.file), { force: true });
    db.tracks = db.tracks.filter((x) => x.id !== t.id);
    writeSounds(db);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Add a new version from an edited prompt — bumps the number, starts pending.
app.post("/api/sounds/:id/version", (req, res) => {
  try {
    const { prompt, name, params } = req.body || {};
    if (typeof prompt !== "string" || !prompt.trim())
      return res.status(400).json({ error: "Missing 'prompt'" });
    const db = readSounds();
    const t = findTrack(db, req.params.id);
    if (!t) return res.status(404).json({ error: "No such track" });
    const prev = t.versions[t.versions.length - 1];
    const v = nextVersion(t);
    t.versions.push({
      v, prompt: prompt.trim(), name: (name && name.trim()) || null, file: null,
      status: "pending", liked: false, params: params || prev?.params || DEFAULT_SOUND_PARAMS,
      ts: new Date().toISOString(),
    });
    writeSounds(db);
    res.json({ ok: true, version: v, track: soundView(t) });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Edit a version in place (prompt and/or name) WITHOUT creating a new version.
app.patch("/api/sounds/:id/version/:v", (req, res) => {
  try {
    const { prompt, name } = req.body || {};
    const db = readSounds();
    const t = findTrack(db, req.params.id);
    if (!t) return res.status(404).json({ error: "No such track" });
    const ver = t.versions.find((x) => x.v === Number(req.params.v));
    if (!ver) return res.status(404).json({ error: "No such version" });
    if (typeof prompt === "string") ver.prompt = prompt;
    if (typeof name === "string") ver.name = name.trim() || null;
    writeSounds(db);
    res.json({ ok: true, track: soundView(t) });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Toggle a version's "like".
app.post("/api/sounds/:id/version/:v/like", (req, res) => {
  try {
    const db = readSounds();
    const t = findTrack(db, req.params.id);
    if (!t) return res.status(404).json({ error: "No such track" });
    const ver = t.versions.find((x) => x.v === Number(req.params.v));
    if (!ver) return res.status(404).json({ error: "No such version" });
    ver.liked = !ver.liked;
    writeSounds(db);
    res.json({ ok: true, liked: ver.liked });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Delete a single version (removes the track if it was the last one).
app.delete("/api/sounds/:id/version/:v", (req, res) => {
  try {
    const db = readSounds();
    const t = findTrack(db, req.params.id);
    if (!t) return res.status(404).json({ error: "No such track" });
    const ver = t.versions.find((x) => x.v === Number(req.params.v));
    if (!ver) return res.status(404).json({ error: "No such version" });
    if (ver.file) fs.rmSync(path.join(SOUND_MEDIA, ver.file), { force: true });
    t.versions = t.versions.filter((x) => x.v !== ver.v);
    if (!t.versions.length) db.tracks = db.tracks.filter((x) => x.id !== t.id);
    writeSounds(db);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Attach rendered audio to a version — from a remote URL (downloaded) or a
// local file path (copied). Marks the version ready and probes its duration.
app.post("/api/sounds/:id/version/:v/attach", async (req, res) => {
  try {
    const { url, localPath } = req.body || {};
    const db = readSounds();
    const t = findTrack(db, req.params.id);
    if (!t) return res.status(404).json({ error: "No such track" });
    const ver = t.versions.find((x) => x.v === Number(req.params.v));
    if (!ver) return res.status(404).json({ error: "No such version" });
    fs.mkdirSync(SOUND_MEDIA, { recursive: true });

    let ext = ".wav";
    if (localPath) ext = path.extname(localPath) || ".wav";
    else if (url) {
      const m = /\.(wav|mp3|ogg|opus|m4a|aac)(?:\?|$)/i.exec(url);
      if (m) ext = "." + m[1].toLowerCase();
    }
    const file = `${t.id}_v${ver.v}${ext}`;
    const dest = path.join(SOUND_MEDIA, file);

    if (localPath) {
      if (!fs.existsSync(localPath)) return res.status(400).json({ error: "localPath not found" });
      fs.copyFileSync(localPath, dest);
    } else if (url) {
      const resp = await fetch(url);
      if (!resp.ok) return res.status(502).json({ error: `Download failed: ${resp.status}` });
      fs.writeFileSync(dest, Buffer.from(await resp.arrayBuffer()));
    } else {
      return res.status(400).json({ error: "Provide 'url' or 'localPath'" });
    }

    ver.file = file;
    ver.status = "ready";
    ver.duration = await soundDuration(dest);
    ver.source = url || localPath;
    ver.ts = new Date().toISOString();
    writeSounds(db);
    res.json({ ok: true, version: ver.v, url: "/sound-media/" + file, duration: ver.duration });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ---------------------------------------------------------------------------
// Agent secrets KV — a tiny local-only store the eve agent uses to persist
// OAuth credentials (e.g. the Higgsfield refresh token + registered client id)
// across turns and server restarts. Lives outside the data root and is
// gitignored (.secrets/). Keys are namespaced by the caller (e.g.
// "higgsfield:token:<principal>"). This is a localhost dev surface only.
// ---------------------------------------------------------------------------
const SECRETS_DIR = path.join(__dirname, "..", ".secrets");
const SECRETS_FILE = path.join(SECRETS_DIR, "agent-oauth.json");
const SAFE_SECRET_KEY = /^[A-Za-z0-9._:/-]{1,200}$/;

function readSecrets() {
  try {
    return JSON.parse(fs.readFileSync(SECRETS_FILE, "utf8"));
  } catch {
    return {};
  }
}
function writeSecrets(db) {
  fs.mkdirSync(SECRETS_DIR, { recursive: true });
  fs.writeFileSync(SECRETS_FILE, JSON.stringify(db, null, 2));
}

// App login state. The app is gated behind a Higgsfield sign-in (the same
// OAuth the render skills use); we're "logged in" when a pre-provisioned static
// bearer is configured, or when the interactive OAuth has stored a token for
// the local principal (see agent/lib/higgsfield-oauth.ts → higgsfield:token:*).
const HIGGSFIELD_TOKEN_KEY = "higgsfield:token:shot-studio-local:local-user";
app.get("/api/auth/status", (req, res) => {
  if (process.env.HIGGSFIELD_MCP_TOKEN) {
    return res.json({ loggedIn: true, method: "static" });
  }
  const db = readSecrets();
  const rec = db[HIGGSFIELD_TOKEN_KEY];
  const loggedIn = Boolean(rec && rec.accessToken);
  res.json({ loggedIn, method: loggedIn ? "oauth" : null });
});

// Sign out: drop the stored Higgsfield credential so the app re-gates.
app.post("/api/auth/logout", (req, res) => {
  const db = readSecrets();
  delete db[HIGGSFIELD_TOKEN_KEY];
  writeSecrets(db);
  res.json({ ok: true });
});

app.get("/api/secrets/:key", (req, res) => {
  const key = req.params.key;
  if (!SAFE_SECRET_KEY.test(key)) return res.status(400).json({ error: "bad key" });
  const db = readSecrets();
  if (!(key in db)) return res.status(404).json({ error: "not found" });
  res.json({ value: db[key] });
});

app.put("/api/secrets/:key", (req, res) => {
  const key = req.params.key;
  if (!SAFE_SECRET_KEY.test(key)) return res.status(400).json({ error: "bad key" });
  const db = readSecrets();
  db[key] = req.body?.value ?? null;
  writeSecrets(db);
  res.json({ ok: true });
});

app.delete("/api/secrets/:key", (req, res) => {
  const key = req.params.key;
  if (!SAFE_SECRET_KEY.test(key)) return res.status(400).json({ error: "bad key" });
  const db = readSecrets();
  delete db[key];
  writeSecrets(db);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Chat attachments → Cloudflare R2. The agent chat uploads images here; we
// stream the bytes straight to an R2 bucket over the S3-compatible API (signed
// with aws4fetch) and hand back the public URL. That URL is what gets attached
// to the eve message so the model can actually see the image.
//
// Configure in shot-studio/.env:
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
//   R2_PUBLIC_BASE_URL (the bucket's public origin — an r2.dev URL or a custom
//   domain; must be publicly reachable so the model can fetch the image).
// ---------------------------------------------------------------------------
const R2 = {
  accountId: process.env.R2_ACCOUNT_ID,
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  bucket: process.env.R2_BUCKET,
  publicBase: (process.env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, ""),
};
const r2Configured = () =>
  Boolean(R2.accountId && R2.accessKeyId && R2.secretAccessKey && R2.bucket && R2.publicBase);

let _r2Client = null;
function r2Client() {
  if (!_r2Client) {
    _r2Client = new AwsClient({
      accessKeyId: R2.accessKeyId,
      secretAccessKey: R2.secretAccessKey,
      service: "s3",
      region: "auto",
    });
  }
  return _r2Client;
}

// Accept the raw file bytes (no multipart / no base64) with the mime type in
// Content-Type and the original name in X-Filename.
app.post("/api/upload", express.raw({ type: () => true, limit: "25mb" }), async (req, res) => {
  try {
    if (!r2Configured()) {
      return res.status(501).json({
        error:
          "R2 not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET and R2_PUBLIC_BASE_URL in shot-studio/.env",
      });
    }
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0)
      return res.status(400).json({ error: "Empty upload body" });

    const contentType = req.headers["content-type"] || "application/octet-stream";
    const rawName = String(req.headers["x-filename"] || "upload");
    const safeName =
      decodeURIComponent(rawName).replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^_+/, "").slice(-80) ||
      "upload";
    const key = `chat-uploads/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;

    const endpoint = `https://${R2.accountId}.r2.cloudflarestorage.com/${R2.bucket}/${key}`;
    const put = await r2Client().fetch(endpoint, {
      method: "PUT",
      body,
      headers: { "content-type": contentType },
    });
    if (!put.ok) {
      const detail = await put.text().catch(() => "");
      return res.status(502).json({ error: `R2 upload failed: ${put.status} ${detail.slice(0, 200)}` });
    }

    res.json({
      ok: true,
      url: `${R2.publicBase}/${key}`,
      key,
      name: safeName,
      contentType,
      size: body.length,
    });
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
