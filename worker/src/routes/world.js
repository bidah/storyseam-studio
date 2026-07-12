// World creation endpoints (/api/world*). The "world bible" that seeds the whole
// series: the story map (the 5 shaping questions), the story-depth core elements,
// and the character roster with type breakdowns. Backed by the R2 doc store
// `state/<projectId>/world.json` (whole-document read-modify-write, exactly like
// the shot list). Written by the agent's world-creation skill (save_world) and
// edited field-by-field from the World tab.
import { readDoc, writeDoc } from "../lib/docs.js";

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

// Coerce one character into the canonical shape, minting an id if missing.
function normalizeChar(raw, i = 0) {
  const c = raw || {};
  const out = { id: str(c.id) || `char-${Date.now().toString(36)}-${i}` };
  for (const f of CHAR_FIELDS) out[f] = str(c[f]);
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

export function registerWorld(app) {
  // Read the world bible (seeds an empty skeleton on first use).
  app.get("/api/world", async (c) => {
    const pid = c.get("projectId");
    return c.json(await readWorld(c.env, pid));
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
