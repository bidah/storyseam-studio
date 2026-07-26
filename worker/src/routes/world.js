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
// One location's fields. `slug` is the KEY that a shot's `location` string resolves
// to, so the Animatic can auto-supply this location's sheet as an image reference.
const LOC_FIELDS = ["name", "slug", "description"];

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
    locations: [],
  };
}

const str = (v) => (v == null ? "" : String(v));
// Match the shot-list `location` slug convention (e.g. "school-clearing").
const slugify = (s) => str(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

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

// Coerce one location into the canonical shape, minting an id if missing. `slug`
// falls back to a slugified name so it always matches a shot's `location` string;
// `sheetImage` is the location's reference art (same shape as a character sheet).
function normalizeLocation(raw, i = 0) {
  const l = raw || {};
  const out = { id: str(l.id) || `loc-${Date.now().toString(36)}-${i}` };
  out.name = str(l.name);
  out.slug = slugify(l.slug || l.name);
  out.description = str(l.description);
  out.sheetImage = normalizeSheetImage(l.sheetImage);
  return out;
}

// The agent's bulk save must never DESTROY what it didn't send. A partial
// `save_world` (the model sending, say, just `{ title: "T" }`) used to overwrite
// the whole document with blanks — that is how Whistlewood's world bible was
// wiped on 2026-07-22. So on that path a field only overwrites when it arrives
// with actual content: an omitted field, and an empty string, both keep what's
// stored. Clearing a field on purpose is a HUMAN action and goes through
// `PUT /api/world` (the World tab's inline editors), which still honours "".
const keep = (incoming, prev) => {
  if (incoming == null) return prev;
  const s = str(incoming);
  return s.trim() ? s : prev;
};

const mergeSection = (fields, incoming, prev) =>
  Object.fromEntries(fields.map((f) => [f, keep(incoming?.[f], prev?.[f])]));

// Merge one incoming character/location onto its stored twin, field by field.
// `sheetImage`/`voiceRef` are objects, not strings: an explicit `null` means
// unlink, an absent key means keep whatever is linked.
function mergeEntry(fields, raw, prev, i, normalize) {
  if (!prev) return normalize(raw, i);
  const out = { ...prev };
  for (const f of fields) out[f] = keep(raw?.[f], prev[f]);
  if (raw && "sheetImage" in raw) out.sheetImage = normalizeSheetImage(raw.sheetImage);
  if (raw && "voiceRef" in raw) out.voiceRef = normalizeVoiceRef(raw.voiceRef);
  return normalize(out, i);
}

// Merge an incoming roster onto the stored one. Entries match by id, falling
// back to a case-insensitive name so an agent that forgot to pass ids updates
// the cast instead of duplicating it; unmatched entries are appended. Entries
// the caller did NOT send are PRESERVED — removing one is an explicit DELETE,
// never a side effect of a bulk save.
function mergeRoster(fields, incoming, prev, normalize) {
  if (!Array.isArray(incoming)) return prev;
  const out = prev.slice();
  const byId = new Map();
  const byName = new Map();
  out.forEach((e, i) => {
    if (e.id) byId.set(e.id, i);
    const n = str(e.name).trim().toLowerCase();
    if (n && !byName.has(n)) byName.set(n, i);
  });
  for (const raw of incoming) {
    const id = str(raw?.id);
    const name = str(raw?.name).trim().toLowerCase();
    const idx = id && byId.has(id) ? byId.get(id) : name && byName.has(name) ? byName.get(name) : -1;
    if (idx >= 0) {
      out[idx] = mergeEntry(fields, raw, out[idx], idx, normalize);
    } else {
      const entry = mergeEntry(fields, raw, null, out.length, normalize);
      out.push(entry);
      if (entry.id) byId.set(entry.id, out.length - 1);
      if (name) byName.set(name, out.length - 1);
    }
  }
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
  base.locations = Array.isArray(w.locations) ? w.locations.map(normalizeLocation) : [];
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
    for (const loc of world.locations) {
      if (loc.sheetImage?.rel) loc.sheetImage.refUrl = assetRefUrl(c.env, pid, loc.sheetImage.rel);
    }
    return c.json(world);
  });

  // Fill in the world bible (the agent's save_world). This is a MERGE, not a
  // replace: everything the caller sends with content wins, everything else —
  // omitted fields, empty strings, unmentioned cast/places — is carried over
  // from the stored world (see `keep`/`mergeRoster` above). The agent is a
  // fallible writer that regularly sends partial documents, so a blind
  // overwrite here is a data-loss bug, not a feature; deletions are explicit
  // (DELETE /api/world/character|location/:id) and clearing a field is the
  // human PUT path.
  app.post("/api/world", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON body" }, 400); }
    const incoming = body && typeof body === "object" && body.world ? body.world : body;
    const prev = await readWorld(c.env, pid);
    const merged = {
      title: keep(incoming?.title, prev.title),
      logline: keep(incoming?.logline, prev.logline),
      map: mergeSection(MAP_FIELDS, incoming?.map, prev.map),
      depth: mergeSection(DEPTH_FIELDS, incoming?.depth, prev.depth),
      characters: mergeRoster(CHAR_FIELDS, incoming?.characters, prev.characters, normalizeChar),
      locations: mergeRoster(LOC_FIELDS, incoming?.locations, prev.locations, normalizeLocation),
    };
    const world = normalizeWorld(merged);
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

  // Add a location to the roster.
  app.post("/api/world/location", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const world = await readWorld(c.env, pid);
    const loc = normalizeLocation({ name: "New location", ...body }, world.locations.length);
    if (loc.sheetImage?.rel) loc.sheetImage.refUrl = assetRefUrl(c.env, pid, loc.sheetImage.rel);
    world.locations.push(loc);
    await writeWorld(c.env, pid, world);
    return c.json({ ok: true, location: loc, world });
  });

  // Edit one location in place.
  app.put("/api/world/location/:id", async (c) => {
    const pid = c.get("projectId");
    const id = c.req.param("id");
    const world = await readWorld(c.env, pid);
    const idx = world.locations.findIndex((x) => x.id === id);
    if (idx < 0) return c.json({ error: `no location ${id}` }, 404);
    let patch;
    try { patch = await c.req.json(); } catch { patch = {}; }
    world.locations[idx] = normalizeLocation({ ...world.locations[idx], ...patch, id }, idx);
    const loc = world.locations[idx];
    if (loc.sheetImage?.rel) loc.sheetImage.refUrl = assetRefUrl(c.env, pid, loc.sheetImage.rel);
    await writeWorld(c.env, pid, world);
    return c.json({ ok: true, location: loc, world });
  });

  // Remove a location.
  app.delete("/api/world/location/:id", async (c) => {
    const pid = c.get("projectId");
    const id = c.req.param("id");
    const world = await readWorld(c.env, pid);
    const before = world.locations.length;
    world.locations = world.locations.filter((x) => x.id !== id);
    if (world.locations.length === before) return c.json({ error: `no location ${id}` }, 404);
    await writeWorld(c.env, pid, world);
    return c.json({ ok: true, world });
  });
}
