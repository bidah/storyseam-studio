// World creation endpoints (/api/world*). The "world bible" that seeds the whole
// series: the story map (the 5 shaping questions), the story-depth core elements,
// and the character roster with type breakdowns. Backed by the D1 doc store
// (`docs` row, name "world"), whole-document read-modify-write exactly like the
// shot list. Written by the agent's world-creation skill (save_world) and edited
// field-by-field from the World tab.
import { readDoc, updateDoc } from "../lib/docs.js";
import { assetRefUrl } from "../lib/media.js";
import {
  normalizeProductionType, DEFAULT_PRODUCTION_TYPE, PRODUCTION_TYPE_IDS,
} from "../lib/production-type.js";

// The story map — the 5 questions that shape the story (see the World tab).
export const MAP_FIELDS = ["world", "protagonist", "antagonist", "stakes", "theme"];
// Story depth — the core elements that make us understand the story.
export const DEPTH_FIELDS = ["premise", "wantVsNeed", "conflict", "obstacles", "structure"];
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
    // What kind of film this is (see lib/production-type.js). It lives on the
    // world bible because it is a property of the SERIES, decided before the
    // script, and everything downstream branches on it — most visibly which
    // shot-list skill the agent runs and which prompt editor the Shot list tab
    // renders. Absent = "2d", so every project that predates this keeps its
    // exact previous behaviour.
    productionType: DEFAULT_PRODUCTION_TYPE,
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

// `keep` for the production-type enum: only a RECOGNISED id overwrites, so a
// partial save or a model typo can never flip the project's type.
const keepProductionType = (incoming, prev) =>
  PRODUCTION_TYPE_IDS.includes(String(incoming || "")) ? String(incoming) : prev;

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
  base.productionType = normalizeProductionType(w.productionType);
  base.generatedAt = w.generatedAt ?? null;
  base.source = w.source ?? null;
  for (const f of MAP_FIELDS) base.map[f] = str(w.map?.[f]);
  for (const f of DEPTH_FIELDS) base.depth[f] = str(w.depth?.[f]);
  base.characters = Array.isArray(w.characters) ? w.characters.map(normalizeChar) : [];
  base.locations = Array.isArray(w.locations) ? w.locations.map(normalizeLocation) : [];
  return base;
}

export const readWorld = async (env, pid) => normalizeWorld(await readDoc(env, pid, "world", null));

// The world exactly as `GET /api/world` serves it — the normalized bible with an
// ungated absolute `refUrl` on every linked sheet. Extracted from the route so a
// non-HTTP caller (the MCP server's `get_world`) reads the SAME shape the GUI
// and the flue agent see, instead of re-deriving refUrls and drifting from them.
export async function buildWorldView(env, pid) {
  const world = await readWorld(env, pid);
  for (const ch of world.characters) {
    if (ch.sheetImage?.rel) ch.sheetImage.refUrl = assetRefUrl(env, pid, ch.sheetImage.rel);
  }
  for (const loc of world.locations) {
    if (loc.sheetImage?.rel) loc.sheetImage.refUrl = assetRefUrl(env, pid, loc.sheetImage.rel);
  }
  return world;
}

// Every MUTATION goes through this, never a bare read-then-write. A plain
// read-modify-write is last-writer-wins, and these routes are hammered
// concurrently — the agent adds a cast in one burst, the Animatic creates a
// roster of locations — so racing writers silently dropped each other's entries
// (adding 8 characters in parallel reliably kept about half). `updateDoc` makes
// the write conditional on the document's version and re-applies `mutate` on a
// conflict, so every entry lands. `mutate` may run more than once: keep it pure.
const editWorld = (env, pid, mutate) =>
  updateDoc(env, pid, "world", emptyWorld(), (raw) => {
    // The stored doc is whatever was last written; normalize inside the retry
    // so each attempt starts from a well-formed world.
    const world = normalizeWorld(raw);
    const result = mutate(world) || {};
    if (result.abort) return result;
    // updateDoc persists the object it handed us, so copy the edited shape back.
    for (const k of Object.keys(raw)) delete raw[k];
    Object.assign(raw, world);
    return result;
  });

// Attach (or clear, with a null voiceRef) a character's voice by case-insensitive
// name. Returns true when a character matched — the voice then lives on the World
// roster, the single source of truth the Radio casting rail shares (so a voice
// cast on the Radio tab also shows on the World tab). Returns false when no such
// character exists, so the caller can fall back to its own store.
export async function setCharacterVoiceByName(env, pid, name, voiceRef) {
  const key = str(name).trim().toUpperCase();
  if (!key) return false;
  const res = await editWorld(env, pid, (world) => {
    const idx = world.characters.findIndex((c) => str(c.name).trim().toUpperCase() === key);
    if (idx < 0) return { abort: true, matched: false };
    world.characters[idx].voiceRef = normalizeVoiceRef(voiceRef);
    return { matched: true };
  });
  return !!res.matched;
}

export function registerWorld(app) {
  // Read the world bible (seeds an empty skeleton on first use). Each linked
  // character sheet gets an absolute `refUrl` (ungated `/files/...`) so the agent
  // can feed the sheet to Higgsfield `media_import_url` as an image reference —
  // the stored relative `url` (`/asset/...`) isn't fetchable by an anonymous MCP.
  app.get("/api/world", async (c) => c.json(await buildWorldView(c.env, c.get("projectId"))));

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
    const { world } = await editWorld(c.env, pid, (prev) => {
      const merged = normalizeWorld({
        title: keep(incoming?.title, prev.title),
        logline: keep(incoming?.logline, prev.logline),
        // Same merge rule as every other field, but checked against the enum
        // FIRST: `normalizeWorld` coerces anything unrecognised to "2d", so
        // passing a typo straight through would silently demote a live-action
        // project. An omitted or invalid value keeps what's stored.
        productionType: keepProductionType(incoming?.productionType, prev.productionType),
        map: mergeSection(MAP_FIELDS, incoming?.map, prev.map),
        depth: mergeSection(DEPTH_FIELDS, incoming?.depth, prev.depth),
        characters: mergeRoster(CHAR_FIELDS, incoming?.characters, prev.characters, normalizeChar),
        locations: mergeRoster(LOC_FIELDS, incoming?.locations, prev.locations, normalizeLocation),
      });
      merged.generatedAt = new Date().toISOString();
      merged.source = str(body?.source) || "agent";
      Object.assign(prev, merged);
      return { world: prev };
    });
    return c.json({ ok: true, world });
  });

  // Merge-patch the top-level sections (inline UI edits to title/logline and the
  // map/depth fields). Only known sections/fields are applied.
  app.put("/api/world", async (c) => {
    const pid = c.get("projectId");
    let patch;
    try { patch = await c.req.json(); } catch { patch = {}; }
    const { world } = await editWorld(c.env, pid, (world) => {
      if (typeof patch.title === "string") world.title = patch.title;
      if (typeof patch.logline === "string") world.logline = patch.logline;
      // The World tab's production-type selector. Unlike the free-text fields
      // this one is an enum, so an unrecognised id is rejected rather than
      // written — there is no "clear it" state to honour here.
      if (PRODUCTION_TYPE_IDS.includes(String(patch.productionType || ""))) {
        world.productionType = String(patch.productionType);
      }
      if (patch.map && typeof patch.map === "object") {
        for (const f of MAP_FIELDS) if (f in patch.map) world.map[f] = str(patch.map[f]);
      }
      if (patch.depth && typeof patch.depth === "object") {
        for (const f of DEPTH_FIELDS) if (f in patch.depth) world.depth[f] = str(patch.depth[f]);
      }
      return { world };
    });
    return c.json({ ok: true, world });
  });

  // Add a character to the roster.
  app.post("/api/world/character", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const { character, world } = await editWorld(c.env, pid, (world) => {
      const char = normalizeChar({ name: "New character", ...body }, world.characters.length);
      world.characters.push(char);
      return { character: char, world };
    });
    return c.json({ ok: true, character, world });
  });

  // Edit one character in place.
  app.put("/api/world/character/:id", async (c) => {
    const pid = c.get("projectId");
    const id = c.req.param("id");
    let patch;
    try { patch = await c.req.json(); } catch { patch = {}; }
    const res = await editWorld(c.env, pid, (world) => {
      const idx = world.characters.findIndex((x) => x.id === id);
      if (idx < 0) return { abort: true, missing: true };
      world.characters[idx] = normalizeChar({ ...world.characters[idx], ...patch, id }, idx);
      return { character: world.characters[idx], world };
    });
    if (res.missing) return c.json({ error: `no character ${id}` }, 404);
    return c.json({ ok: true, character: res.character, world: res.world });
  });

  // Remove a character.
  app.delete("/api/world/character/:id", async (c) => {
    const pid = c.get("projectId");
    const id = c.req.param("id");
    const res = await editWorld(c.env, pid, (world) => {
      const before = world.characters.length;
      world.characters = world.characters.filter((x) => x.id !== id);
      if (world.characters.length === before) return { abort: true, missing: true };
      return { world };
    });
    if (res.missing) return c.json({ error: `no character ${id}` }, 404);
    return c.json({ ok: true, world: res.world });
  });

  // Add a location to the roster.
  app.post("/api/world/location", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const { location, world } = await editWorld(c.env, pid, (world) => {
      const loc = normalizeLocation({ name: "New location", ...body }, world.locations.length);
      world.locations.push(loc);
      return { location: loc, world };
    });
    if (location.sheetImage?.rel) location.sheetImage.refUrl = assetRefUrl(c.env, pid, location.sheetImage.rel);
    return c.json({ ok: true, location, world });
  });

  // Edit one location in place.
  app.put("/api/world/location/:id", async (c) => {
    const pid = c.get("projectId");
    const id = c.req.param("id");
    let patch;
    try { patch = await c.req.json(); } catch { patch = {}; }
    const res = await editWorld(c.env, pid, (world) => {
      const idx = world.locations.findIndex((x) => x.id === id);
      if (idx < 0) return { abort: true, missing: true };
      world.locations[idx] = normalizeLocation({ ...world.locations[idx], ...patch, id }, idx);
      return { location: world.locations[idx], world };
    });
    if (res.missing) return c.json({ error: `no location ${id}` }, 404);
    if (res.location.sheetImage?.rel) res.location.sheetImage.refUrl = assetRefUrl(c.env, pid, res.location.sheetImage.rel);
    return c.json({ ok: true, location: res.location, world: res.world });
  });

  // Remove a location.
  app.delete("/api/world/location/:id", async (c) => {
    const pid = c.get("projectId");
    const id = c.req.param("id");
    const res = await editWorld(c.env, pid, (world) => {
      const before = world.locations.length;
      world.locations = world.locations.filter((x) => x.id !== id);
      if (world.locations.length === before) return { abort: true, missing: true };
      return { world };
    });
    if (res.missing) return c.json({ error: `no location ${id}` }, 404);
    return c.json({ ok: true, world: res.world });
  });
}
