// World creation endpoints (/api/world*). The "world bible" that seeds the whole
// series: the story map (the 5 shaping questions), the story-depth core elements,
// and the character roster with type breakdowns. Backed by the R2 doc store
// `state/<projectId>/world.json` (whole-document read-modify-write, exactly like
// the shot list). Written by the agent's world-creation skill (save_world) and
// edited field-by-field from the World tab.
import { readDoc, writeDoc } from "../lib/docs.js";
import { assetRefUrl } from "../lib/media.js";

// The story map — the 5 questions that shape the story (see the World tab).
const MAP_FIELDS = ["world", "protagonist", "antagonist", "stakes", "theme"];
// Story depth — the core elements that make us understand the story.
const DEPTH_FIELDS = ["premise", "wantVsNeed", "conflict", "obstacles", "structure"];
// One character's type breakdown.
const CHAR_FIELDS = ["name", "archetype", "role", "want", "need", "traits", "arc", "voice", "appearance"];

const emptySection = (fields) => Object.fromEntries(fields.map((f) => [f, ""]));

function emptyWorld() {
  return {
    generatedAt: null,
    source: null,
    title: "",
    logline: "",
    map: emptySection(MAP_FIELDS),
    depth: emptySection(DEPTH_FIELDS),
    characters: [],
  };
}

const str = (v) => (v == null ? "" : String(v));

// A linked character-sheet image, pulled from the project asset library (never
// the raw Higgsfield library). We keep the library `rel` (canonical id) plus the
// full-res `url`, small `thumb`, and display `name` so the World tab can render a
// thumbnail without another lookup. Anything unshaped (or an explicit unlink)
// normalizes to null.
function normalizeSheetImage(raw) {
  if (!raw || typeof raw !== "object") return null;
  const url = str(raw.url);
  const rel = str(raw.rel);
  if (!url && !rel) return null;
  return { rel, url, thumb: str(raw.thumb), name: str(raw.name) };
}

// A voice attached to a character: a liked take from the Sound Studio. We snapshot
// the display name and the playable `url` (relative `/sound-media/<file>`) plus the
// source track id + version so the original take can be found again. Anything
// unshaped (or an explicit unlink) normalizes to null.
function normalizeVoiceRef(raw) {
  if (!raw || typeof raw !== "object") return null;
  const url = str(raw.url);
  const trackId = str(raw.trackId);
  if (!url && !trackId) return null;
  const v = Number(raw.v);
  return { trackId, v: Number.isFinite(v) ? v : null, name: str(raw.name), url };
}

// Coerce one character into the canonical shape, minting an id if missing.
function normalizeChar(raw, i = 0) {
  const c = raw || {};
  const out = { id: str(c.id) || `char-${Date.now().toString(36)}-${i}` };
  for (const f of CHAR_FIELDS) out[f] = str(c[f]);
  out.sheetImage = normalizeSheetImage(c.sheetImage);
  out.voiceRef = normalizeVoiceRef(c.voiceRef);
  return out;
}

// Merge a (possibly partial) world onto the empty skeleton so every field always
// exists and the UI never has to null-check. Sections are shallow-merged; unknown
// keys are dropped.
function normalizeWorld(raw) {
  const base = emptyWorld();
  const w = raw || {};
  base.title = str(w.title);
  base.logline = str(w.logline);
  base.generatedAt = w.generatedAt ?? null;
  base.source = w.source ?? null;
  for (const f of MAP_FIELDS) base.map[f] = str(w.map?.[f]);
  for (const f of DEPTH_FIELDS) base.depth[f] = str(w.depth?.[f]);
  base.characters = Array.isArray(w.characters) ? w.characters.map(normalizeChar) : [];
  return base;
}

const readWorld = async (env, pid) => normalizeWorld(await readDoc(env, pid, "world", null));
const writeWorld = (env, pid, world) => writeDoc(env, pid, "world", world);

// Attach (or clear, with a null voiceRef) a character's voice by case-insensitive
// name. Returns true when a character matched — the voice then lives on the World
// roster, the single source of truth the Radio casting rail shares (so a voice
// cast on the Radio tab also shows on the World tab). Returns false when no such
// character exists, so the caller can fall back to its own store.
export async function setCharacterVoiceByName(env, pid, name, voiceRef) {
  const key = str(name).trim().toUpperCase();
  if (!key) return false;
  const world = await readWorld(env, pid);
  const idx = world.characters.findIndex((c) => str(c.name).trim().toUpperCase() === key);
  if (idx < 0) return false;
  world.characters[idx].voiceRef = normalizeVoiceRef(voiceRef);
  await writeWorld(env, pid, world);
  return true;
}

export function registerWorld(app) {
  // Read the world bible (seeds an empty skeleton on first use). Each linked
  // character sheet gets an absolute `refUrl` (ungated `/files/...`) so the agent
  // can feed the sheet to Higgsfield `media_import_url` as an image reference —
  // the stored relative `url` (`/asset/...`) isn't fetchable by an anonymous MCP.
  app.get("/api/world", async (c) => {
    const pid = c.get("projectId");
    const world = await readWorld(c.env, pid);
    for (const ch of world.characters) {
      if (ch.sheetImage?.rel) ch.sheetImage.refUrl = assetRefUrl(c.env, pid, ch.sheetImage.rel);
    }
    return c.json(world);
  });

  // Replace the WHOLE world (the agent's save_world). Read-first isn't required —
  // this overwrites — so the agent should send the complete object it wants.
  app.post("/api/world", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON body" }, 400); }
    const incoming = body && typeof body === "object" && body.world ? body.world : body;
    const world = normalizeWorld(incoming);
    world.generatedAt = new Date().toISOString();
    world.source = str(body?.source) || "agent";
    await writeWorld(c.env, pid, world);
    return c.json({ ok: true, world });
  });

  // Merge-patch the top-level sections (inline UI edits to title/logline and the
  // map/depth fields). Only known sections/fields are applied.
  app.put("/api/world", async (c) => {
    const pid = c.get("projectId");
    let patch;
    try { patch = await c.req.json(); } catch { patch = {}; }
    const world = await readWorld(c.env, pid);
    if (typeof patch.title === "string") world.title = patch.title;
    if (typeof patch.logline === "string") world.logline = patch.logline;
    if (patch.map && typeof patch.map === "object") {
      for (const f of MAP_FIELDS) if (f in patch.map) world.map[f] = str(patch.map[f]);
    }
    if (patch.depth && typeof patch.depth === "object") {
      for (const f of DEPTH_FIELDS) if (f in patch.depth) world.depth[f] = str(patch.depth[f]);
    }
    await writeWorld(c.env, pid, world);
    return c.json({ ok: true, world });
  });

  // Add a character to the roster.
  app.post("/api/world/character", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const world = await readWorld(c.env, pid);
    const char = normalizeChar({ name: "New character", ...body }, world.characters.length);
    world.characters.push(char);
    await writeWorld(c.env, pid, world);
    return c.json({ ok: true, character: char, world });
  });

  // Edit one character in place.
  app.put("/api/world/character/:id", async (c) => {
    const pid = c.get("projectId");
    const id = c.req.param("id");
    const world = await readWorld(c.env, pid);
    const idx = world.characters.findIndex((x) => x.id === id);
    if (idx < 0) return c.json({ error: `no character ${id}` }, 404);
    let patch;
    try { patch = await c.req.json(); } catch { patch = {}; }
    world.characters[idx] = normalizeChar({ ...world.characters[idx], ...patch, id }, idx);
    await writeWorld(c.env, pid, world);
    return c.json({ ok: true, character: world.characters[idx], world });
  });

  // Remove a character.
  app.delete("/api/world/character/:id", async (c) => {
    const pid = c.get("projectId");
    const id = c.req.param("id");
    const world = await readWorld(c.env, pid);
    const before = world.characters.length;
    world.characters = world.characters.filter((x) => x.id !== id);
    if (world.characters.length === before) return c.json({ error: `no character ${id}` }, 404);
    await writeWorld(c.env, pid, world);
    return c.json({ ok: true, world });
  });
}
