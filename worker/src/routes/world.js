// World creation endpoints (/api/world*). The "world bible" that seeds the whole
// series: the story map (the 5 shaping questions), the character LIBRARY (every
// character ever created, with type breakdowns), the locations, and the format.
// Backed by the D1 doc store (`docs` row, name "world"), whole-document
// read-modify-write exactly like the shot list.
//
// SERIES SPLIT: the world bible is shared across every episode of a series, but
// two things are per-EPISODE and live in the `episode-bible` doc instead (which
// lib/docs.js scopes to the active episode): the STORY DEPTH and the episode's
// character ROSTER (a list of ids drawn from the shared library). `world.depth`
// is kept only as the migration source for the first episode's bible — new depth
// writes go to the bible, never back to the world doc. `buildWorldView` overlays
// the active episode's bible onto the world so callers still see one `depth` and
// one `characters` (the episode's cast). See lib/format.js for feature vs series.
import { readDoc, updateDoc, DEFAULT_EPISODE } from "../lib/docs.js";
import { requestContext } from "../lib/request-context.js";
import { assetRefUrl, filesUrl, mediaKey } from "../lib/media.js";
import {
  normalizeProductionType, DEFAULT_PRODUCTION_TYPE, PRODUCTION_TYPE_IDS,
} from "../lib/production-type.js";
import { normalizeFormat, DEFAULT_FORMAT, FORMAT_IDS } from "../lib/format.js";

// The story map — the 5 questions that shape the story (see the World tab).
export const MAP_FIELDS = ["world", "protagonist", "antagonist", "stakes", "theme"];
// Story depth — the core elements that make us understand the story.
export const DEPTH_FIELDS = ["premise", "wantVsNeed", "conflict", "obstacles", "structure"];
// One character's type breakdown.
const CHAR_FIELDS = ["name", "archetype", "role", "want", "need", "traits", "arc", "voice", "appearance"];
// `depth` + `characterIds` shape of the per-episode bible.
const emptyBible = () => ({ depth: emptySection(DEPTH_FIELDS), characterIds: [] });
// One location's fields. `slug` is the KEY that a shot's `location` string resolves
// to, so the Animatic can auto-supply this location's sheet as an image reference.
const LOC_FIELDS = ["name", "slug", "description"];
// One PROP's fields: an object the story turns on, designed apart from anyone
// who carries it. `owner` is the character who usually holds it (a name, or "").
// A character's design is body, face, hair and clothing only — the props are
// drawn as their own sheets and handed to a shot as their own references, so
// a sword painted into a turnaround is never welded to the character.
const PROP_FIELDS = ["name", "slug", "description", "owner"];

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
    // Feature film vs episodic series (see lib/format.js). Absent = "feature", so
    // a project that predates this stays a single-episode production.
    format: DEFAULT_FORMAT,
    map: emptySection(MAP_FIELDS),
    // Legacy field: story depth now lives per-episode in the `episode-bible` doc.
    // Kept here as the migration source for the first episode's bible and never
    // written again — see the header note and `seedBibleFor`.
    depth: emptySection(DEPTH_FIELDS),
    // The character LIBRARY: every character in the series. Each episode picks a
    // roster of these by id (in the episode bible); `anchor` characters are
    // auto-added to every new episode.
    characters: [],
    locations: [],
    props: [],
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
//
// TOLERANT ON INPUT, because the GUI is not the only caller. The World tab picks
// from the MediaPicker and always sends the full `{ rel, url, thumb, name }`; an
// agent or an MCP client holds ONE of those — a `rel` from list_library, or a
// bare URL string — and a strict reading of "unshaped" turned those into `null`,
// i.e. a save that reported ok and linked nothing. (That is exactly how an MCP
// client burned a turn believing it had pinned a character sheet.) So: a bare
// string is a URL; `refUrl`/`src` are accepted aliases for `url`; and a `rel`
// alone derives its own `/asset/` + `/thumb/` paths, which is where every
// library image is served from. The routes below then REJECT anything that
// still can't be shaped, instead of silently storing null — see `imageError`.
function normalizeSheetImage(raw) {
  if (!raw) return null;
  if (typeof raw === "string") {
    const url = raw.trim();
    return url ? { rel: "", url, thumb: "", name: "" } : null;
  }
  if (typeof raw !== "object") return null;
  const rel = str(raw.rel);
  const url = str(raw.url) || str(raw.refUrl) || str(raw.src) || (rel ? `/asset/${rel}` : "");
  if (!url && !rel) return null;
  return {
    rel,
    url,
    thumb: str(raw.thumb) || (rel ? `/thumb/${rel}` : ""),
    name: str(raw.name),
  };
}

// The 400 a caller gets when it sent SOMETHING for an image field that carries
// no usable reference. Silence here is the worst outcome: `null` is
// indistinguishable from "no image", so the caller reports success and the
// author finds an empty sheet slot later.
const imageError = (field) =>
  `'${field}' is not a usable image reference. Pass the library image as { rel, url } ` +
  `(rel from GET /api/library), or a plain https URL string. Send null to unlink.`;

// Which image fields of a character/location body are truthy but unshapeable.
const IMAGE_FIELDS = ["sheetImage", "miniatureImage"];
const unshapedImage = (body) =>
  IMAGE_FIELDS.find((f) => body && body[f] && !normalizeSheetImage(body[f]));

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
  // A separate full-figure MINIATURE reference (same shape as the sheet). Used on
  // WIDE / establishing shots where the character is too small in frame for the
  // portrait-heavy sheet to read — see worker/src/lib/pack.js and lib/shots.js.
  out.miniatureImage = normalizeSheetImage(c.miniatureImage);
  out.voiceRef = normalizeVoiceRef(c.voiceRef);
  // An anchor character prevails across the whole series: every new episode is
  // seeded with the anchored cast (e.g. recurring judges). Library-level flag.
  out.anchor = !!c.anchor;
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

// Coerce one prop into the canonical shape, minting an id if missing.
function normalizeProp(raw, i = 0) {
  const p = raw || {};
  const out = { id: str(p.id) || `prop-${Date.now().toString(36)}-${i}` };
  out.name = str(p.name);
  out.slug = slugify(p.slug || p.name);
  out.description = str(p.description);
  out.owner = str(p.owner);
  out.sheetImage = normalizeSheetImage(p.sheetImage);
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

// Same guard for the feature/series format enum.
const keepFormat = (incoming, prev) =>
  FORMAT_IDS.includes(String(incoming || "")) ? String(incoming) : prev;

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
  if (raw && "miniatureImage" in raw) out.miniatureImage = normalizeSheetImage(raw.miniatureImage);
  if (raw && "voiceRef" in raw) out.voiceRef = normalizeVoiceRef(raw.voiceRef);
  if (raw && "anchor" in raw) out.anchor = !!raw.anchor;
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
  base.format = normalizeFormat(w.format);
  base.generatedAt = w.generatedAt ?? null;
  base.source = w.source ?? null;
  for (const f of MAP_FIELDS) base.map[f] = str(w.map?.[f]);
  for (const f of DEPTH_FIELDS) base.depth[f] = str(w.depth?.[f]);
  base.characters = Array.isArray(w.characters) ? w.characters.map(normalizeChar) : [];
  base.locations = Array.isArray(w.locations) ? w.locations.map(normalizeLocation) : [];
  base.props = Array.isArray(w.props) ? w.props.map(normalizeProp) : [];
  return base;
}

// The world doc itself — the shared series bible with the FULL character library.
// `depth` here is the frozen legacy value (the migration source); callers that
// want the active episode's depth/cast use `buildWorldView`.
export const readWorld = async (env, pid) => normalizeWorld(await readDoc(env, pid, "world", null));

// ── Per-episode bible (story depth + this episode's character roster) ──────────
const normalizeBible = (raw) => {
  const b = raw || {};
  return {
    depth: Object.fromEntries(DEPTH_FIELDS.map((f) => [f, str(b.depth?.[f])])),
    characterIds: Array.isArray(b.characterIds) ? b.characterIds.map(str).filter(Boolean) : [],
  };
};

const anchoredCharacterIds = (world) =>
  (world.characters || []).filter((c) => c.anchor).map((c) => c.id);

// The active episode for this request (from the identity store). Feature films
// and the first episode of a series are DEFAULT_EPISODE, whose bible is unsuffixed.
const activeEpisodeId = () => requestContext().episodeId || DEFAULT_EPISODE;

// What a MISSING episode bible should contain. The first episode migrates the
// single-episode past — it inherits the legacy `world.depth` and starts with the
// whole existing cast, so nothing an old project had disappears. Every later
// episode starts blank with only the anchored characters carried in.
async function seedBibleFor(env, pid, episodeId, world) {
  world = world || (await readWorld(env, pid));
  if (episodeId === DEFAULT_EPISODE) {
    return { depth: { ...world.depth }, characterIds: world.characters.map((c) => c.id) };
  }
  return { depth: emptySection(DEPTH_FIELDS), characterIds: anchoredCharacterIds(world) };
}

export async function readEpisodeBible(env, pid, episodeId = activeEpisodeId(), world) {
  const raw = await readDoc(env, pid, "episode-bible", null, { episodeId });
  return normalizeBible(raw || (await seedBibleFor(env, pid, episodeId, world)));
}

// Mutate the active episode's bible. Same CAS discipline as `editWorld`; the
// fallback is the migrated/seeded shape so a first write to a missing bible
// starts from the right place, not from blank.
export async function editEpisodeBible(env, pid, mutate, episodeId = activeEpisodeId()) {
  const seed = await seedBibleFor(env, pid, episodeId);
  return updateDoc(
    env, pid, "episode-bible", seed,
    (raw) => {
      const bible = normalizeBible(raw);
      const result = mutate(bible) || {};
      if (result.abort) return result;
      for (const k of Object.keys(raw)) delete raw[k];
      Object.assign(raw, bible);
      return result;
    },
    { episodeId },
  );
}

// The world exactly as `GET /api/world` serves it, with the active episode's
// bible overlaid: `depth` and `characters` reflect THIS episode, while
// `charactersLibrary` is the whole series cast (the "add previous character"
// picker reads it). Every linked sheet gets an ungated absolute `refUrl` so a
// non-HTTP caller (the MCP `get_world`, the flue agent) reads the SAME shape the
// GUI sees. Extracted from the route so those callers never drift from it.
export async function buildWorldView(env, pid) {
  const world = await readWorld(env, pid);
  for (const ch of world.characters) {
    if (ch.sheetImage?.rel) ch.sheetImage.refUrl = assetRefUrl(env, pid, ch.sheetImage.rel);
    if (ch.miniatureImage?.rel) ch.miniatureImage.refUrl = assetRefUrl(env, pid, ch.miniatureImage.rel);
  }
  for (const loc of [...world.locations, ...world.props]) {
    if (loc.sheetImage?.rel) loc.sheetImage.refUrl = assetRefUrl(env, pid, loc.sheetImage.rel);
  }
  const episodeId = activeEpisodeId();
  const bible = await readEpisodeBible(env, pid, episodeId, world);
  const byId = new Map(world.characters.map((c) => [c.id, c]));
  const roster = bible.characterIds.map((id) => byId.get(id)).filter(Boolean);
  return {
    ...world,
    depth: bible.depth,
    characters: roster,
    charactersLibrary: world.characters,
    episodeId,
  };
}

// ── Public read-only projection (the /api/share/world/:token viewer) ───────────
// A share-link viewer has no session and no project header, so every image must
// resolve to an UNGATED absolute `/files/...` URL — the gated `/asset/*` and
// `/sound-media/*` routes read `c.get("projectId")` and would 401. So we strip
// each sheet down to its ungated `url` (the library `rel` → `/files/.../asset/`)
// and each voice to an ungated `/files/.../sound-media/` clip. Nothing here is
// editable and nothing that isn't public (ids kept only to key React lists).
const publicImage = (env, pid, img) => {
  if (!img) return null;
  const url = img.rel ? assetRefUrl(env, pid, img.rel) : "";
  return url ? { url, name: str(img.name) } : null;
};

const publicVoice = (env, pid, vref) => {
  if (!vref?.url) return null;
  const m = /\/sound-media\/(.+)$/.exec(vref.url);
  const url = m ? filesUrl(env, mediaKey(pid, "sound-media", m[1])) : "";
  return url ? { name: str(vref.name), v: vref.v ?? null, url } : null;
};

// The written world exactly as the World tab shows it, stripped to the public,
// read-only shape. Deliberately NOT episode-scoped via requestContext (the public
// route has no identity store): a series link lands on the first episode's roster
// and depth, which is the shared bible's default view.
export async function buildSharedWorld(env, pid) {
  const world = await readWorld(env, pid);
  const bible = await readEpisodeBible(env, pid, DEFAULT_EPISODE, world);
  const byId = new Map(world.characters.map((c) => [c.id, c]));
  const roster = bible.characterIds.map((id) => byId.get(id)).filter(Boolean);
  const is2d = normalizeProductionType(world.productionType) === "2d";
  return {
    title: world.title,
    logline: world.logline,
    productionType: world.productionType,
    format: world.format,
    map: world.map,
    depth: bible.depth,
    characters: roster.map((c) => ({
      id: c.id,
      name: c.name, archetype: c.archetype, role: c.role, want: c.want, need: c.need,
      traits: c.traits, arc: c.arc, voice: c.voice, appearance: c.appearance,
      sheetImage: publicImage(env, pid, c.sheetImage),
      miniatureImage: is2d ? publicImage(env, pid, c.miniatureImage) : null,
      voiceRef: publicVoice(env, pid, c.voiceRef),
    })),
    locations: world.locations.map((l) => ({
      id: l.id, name: l.name, slug: l.slug, description: l.description,
      sheetImage: publicImage(env, pid, l.sheetImage),
    })),
    props: world.props.map((p) => ({
      id: p.id, name: p.name, slug: p.slug, description: p.description, owner: p.owner,
      sheetImage: publicImage(env, pid, p.sheetImage),
    })),
  };
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

// The bulk MERGE save behind `POST /api/world` (the agent's save_world) — and
// the Auto Film job's World stage (lib/film-job.js), so there is ONE World
// format and one merge rule. `body` is `{ ...world, source }` or
// `{ world, source }`. The episode that receives depth and new cast is the
// request context's (lib/request-context.js). → `{ ok, world }` (the view).
export async function saveWorld(env, pid, body) {
  const incoming = body && typeof body === "object" && body.world ? body.world : body;
  const { addedIds } = await editWorld(env, pid, (prev) => {
    const prevIds = new Set(prev.characters.map((x) => x.id));
    const merged = normalizeWorld({
      title: keep(incoming?.title, prev.title),
      logline: keep(incoming?.logline, prev.logline),
      // Same merge rule as every other field, but checked against the enum
      // FIRST: `normalizeWorld` coerces anything unrecognised to "2d", so
      // passing a typo straight through would silently demote a live-action
      // project. An omitted or invalid value keeps what's stored.
      productionType: keepProductionType(incoming?.productionType, prev.productionType),
      format: keepFormat(incoming?.format, prev.format),
      map: mergeSection(MAP_FIELDS, incoming?.map, prev.map),
      // `depth` is per-episode now — carried untouched on the world doc and
      // folded into the active episode's bible below.
      depth: prev.depth,
      characters: mergeRoster(CHAR_FIELDS, incoming?.characters, prev.characters, normalizeChar),
      locations: mergeRoster(LOC_FIELDS, incoming?.locations, prev.locations, normalizeLocation),
      props: mergeRoster(PROP_FIELDS, incoming?.props, prev.props, normalizeProp),
    });
    merged.generatedAt = new Date().toISOString();
    merged.source = str(body?.source) || "agent";
    // Characters the merge just introduced to the library — they belong in the
    // episode the agent is writing for, so they join its roster below.
    const addedIds = merged.characters.map((x) => x.id).filter((id) => !prevIds.has(id));
    Object.assign(prev, merged);
    return { addedIds };
  });
  // Per-episode side of a bulk save: story depth and the new cast land in the
  // active episode's bible, not on the shared world doc.
  const incomingDepth = incoming?.depth && typeof incoming.depth === "object" ? incoming.depth : null;
  if (incomingDepth || addedIds.length) {
    await editEpisodeBible(env, pid, (bible) => {
      if (incomingDepth) {
        for (const f of DEPTH_FIELDS) bible.depth[f] = keep(incomingDepth[f], bible.depth[f]);
      }
      for (const id of addedIds) if (!bible.characterIds.includes(id)) bible.characterIds.push(id);
    });
  }
  return { ok: true, world: await buildWorldView(env, pid) };
}

// Link drawn sheets onto the World's roster — the Auto Film's sheets stages,
// whose pictures otherwise live only on the Film's Director Series, so the
// Bible showed a cast with no faces. `links` = [{ kind: "character" |
// "location" | "prop", name, field: "sheetImage" | "miniatureImage", image }],
// matched by case-insensitive name. A slot the author filled by hand is left
// alone: only an empty slot, or one an earlier Film run linked (`rel` under
// FILM_SHEETS_DIR), is (re)written. → the number of slots linked.
export const FILM_SHEETS_DIR = "film-sheets";
export async function linkWorldSheets(env, pid, links) {
  const list = (links || []).filter((l) => l?.image && str(l.name));
  if (!list.length) return 0;
  const res = await editWorld(env, pid, (world) => {
    const roster = { character: world.characters, location: world.locations, prop: world.props };
    let linked = 0;
    for (const l of list) {
      const entry = (roster[l.kind] || []).find((e) => str(e.name).trim().toLowerCase() === str(l.name).trim().toLowerCase());
      const field = l.field === "miniatureImage" && l.kind === "character" ? "miniatureImage" : "sheetImage";
      if (!entry) continue;
      const have = entry[field];
      if (have && !str(have.rel).startsWith(`${FILM_SHEETS_DIR}/`)) continue;
      entry[field] = normalizeSheetImage(l.image);
      linked += 1;
    }
    return linked ? { linked } : { abort: true, linked: 0 };
  });
  return res?.linked || 0;
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
    return c.json(await saveWorld(c.env, pid, body));
  });

  // Merge-patch the top-level sections (inline UI edits to title/logline, the
  // production type, the format, and the story map). Only known sections/fields
  // are applied. Story depth is per-episode and routed to the bible below.
  app.put("/api/world", async (c) => {
    const pid = c.get("projectId");
    let patch;
    try { patch = await c.req.json(); } catch { patch = {}; }
    await editWorld(c.env, pid, (world) => {
      if (typeof patch.title === "string") world.title = patch.title;
      if (typeof patch.logline === "string") world.logline = patch.logline;
      // The World tab's production-type selector. Unlike the free-text fields
      // this one is an enum, so an unrecognised id is rejected rather than
      // written — there is no "clear it" state to honour here.
      if (PRODUCTION_TYPE_IDS.includes(String(patch.productionType || ""))) {
        world.productionType = String(patch.productionType);
      }
      // Feature vs series — the sibling enum picked right after production type.
      if (FORMAT_IDS.includes(String(patch.format || ""))) {
        world.format = String(patch.format);
      }
      if (patch.map && typeof patch.map === "object") {
        for (const f of MAP_FIELDS) if (f in patch.map) world.map[f] = str(patch.map[f]);
      }
      return { world };
    });
    // Story depth belongs to the active episode, so its inline editor writes the
    // episode bible rather than the shared world doc.
    if (patch.depth && typeof patch.depth === "object") {
      await editEpisodeBible(c.env, pid, (bible) => {
        for (const f of DEPTH_FIELDS) if (f in patch.depth) bible.depth[f] = str(patch.depth[f]);
      });
    }
    return c.json({ ok: true, world: await buildWorldView(c.env, pid) });
  });

  // The full series character LIBRARY — every character across every episode,
  // with ungated `refUrl`s. The "add previous character" picker reads this to
  // pull a character created in another episode into the current one.
  app.get("/api/world/characters/library", async (c) => {
    const pid = c.get("projectId");
    const world = await readWorld(c.env, pid);
    for (const ch of world.characters) {
      if (ch.sheetImage?.rel) ch.sheetImage.refUrl = assetRefUrl(c.env, pid, ch.sheetImage.rel);
      if (ch.miniatureImage?.rel) ch.miniatureImage.refUrl = assetRefUrl(c.env, pid, ch.miniatureImage.rel);
    }
    return c.json({ characters: world.characters });
  });

  // Create a character: it joins the series LIBRARY and the ACTIVE episode's
  // roster (you make a character while working on an episode, so it belongs to
  // that episode).
  app.post("/api/world/character", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const bad = unshapedImage(body);
    if (bad) return c.json({ error: imageError(bad) }, 400);
    const { character } = await editWorld(c.env, pid, (world) => {
      const char = normalizeChar({ name: "New character", ...body }, world.characters.length);
      world.characters.push(char);
      return { character: char };
    });
    await editEpisodeBible(c.env, pid, (bible) => {
      if (!bible.characterIds.includes(character.id)) bible.characterIds.push(character.id);
    });
    if (character.sheetImage?.rel) character.sheetImage.refUrl = assetRefUrl(c.env, pid, character.sheetImage.rel);
    if (character.miniatureImage?.rel) character.miniatureImage.refUrl = assetRefUrl(c.env, pid, character.miniatureImage.rel);
    return c.json({ ok: true, character, world: await buildWorldView(c.env, pid) });
  });

  // Edit one library character in place — the change propagates to every episode
  // whose roster references it (single source of truth). `anchor` is accepted
  // here too, though the dedicated toggle below is the usual path.
  app.put("/api/world/character/:id", async (c) => {
    const pid = c.get("projectId");
    const id = c.req.param("id");
    let patch;
    try { patch = await c.req.json(); } catch { patch = {}; }
    const bad = unshapedImage(patch);
    if (bad) return c.json({ error: imageError(bad) }, 400);
    const res = await editWorld(c.env, pid, (world) => {
      const idx = world.characters.findIndex((x) => x.id === id);
      if (idx < 0) return { abort: true, missing: true };
      world.characters[idx] = normalizeChar({ ...world.characters[idx], ...patch, id }, idx);
      return { character: world.characters[idx] };
    });
    if (res.missing) return c.json({ error: `no character ${id}` }, 404);
    const character = res.character;
    if (character.sheetImage?.rel) character.sheetImage.refUrl = assetRefUrl(c.env, pid, character.sheetImage.rel);
    if (character.miniatureImage?.rel) character.miniatureImage.refUrl = assetRefUrl(c.env, pid, character.miniatureImage.rel);
    return c.json({ ok: true, character, world: await buildWorldView(c.env, pid) });
  });

  // Toggle (or set) whether a character is an ANCHOR — a character every new
  // episode is seeded with. Library-level flag; POST `{ anchor: true|false }`,
  // or an empty body to flip it.
  app.post("/api/world/character/:id/anchor", async (c) => {
    const pid = c.get("projectId");
    const id = c.req.param("id");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const res = await editWorld(c.env, pid, (world) => {
      const ch = world.characters.find((x) => x.id === id);
      if (!ch) return { abort: true, missing: true };
      ch.anchor = "anchor" in body ? !!body.anchor : !ch.anchor;
      return { anchor: ch.anchor };
    });
    if (res.missing) return c.json({ error: `no character ${id}` }, 404);
    return c.json({ ok: true, anchor: res.anchor, world: await buildWorldView(c.env, pid) });
  });

  // Remove a character. `?scope=episode` (the series default) drops it from THIS
  // episode's roster but keeps it in the library; `?scope=library` deletes it
  // from the library entirely (and from the active roster). Feature films have
  // one implicit episode, so the library delete is the meaningful one there.
  app.delete("/api/world/character/:id", async (c) => {
    const pid = c.get("projectId");
    const id = c.req.param("id");
    const scope = c.req.query("scope") === "episode" ? "episode" : "library";
    if (scope === "episode") {
      const res = await editEpisodeBible(c.env, pid, (bible) => {
        const before = bible.characterIds.length;
        bible.characterIds = bible.characterIds.filter((x) => x !== id);
        if (bible.characterIds.length === before) return { abort: true, missing: true };
      });
      if (res.missing) return c.json({ error: `character ${id} not in this episode` }, 404);
    } else {
      const res = await editWorld(c.env, pid, (world) => {
        const before = world.characters.length;
        world.characters = world.characters.filter((x) => x.id !== id);
        if (world.characters.length === before) return { abort: true, missing: true };
      });
      if (res.missing) return c.json({ error: `no character ${id}` }, 404);
      // Drop the now-dead id from the active roster; other episodes' rosters lose
      // it lazily (buildWorldView filters ids the library no longer has).
      await editEpisodeBible(c.env, pid, (bible) => {
        bible.characterIds = bible.characterIds.filter((x) => x !== id);
      });
    }
    return c.json({ ok: true, world: await buildWorldView(c.env, pid) });
  });

  // Add already-existing library characters to the ACTIVE episode's roster (the
  // "add previous character" action). Body: `{ characterIds: [...] }` or `{ id }`.
  app.post("/api/episode/roster", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const ids = Array.isArray(body?.characterIds)
      ? body.characterIds.map(str)
      : body?.id ? [str(body.id)] : [];
    await editEpisodeBible(c.env, pid, (bible) => {
      for (const id of ids) if (id && !bible.characterIds.includes(id)) bible.characterIds.push(id);
    });
    return c.json({ ok: true, world: await buildWorldView(c.env, pid) });
  });

  // Add a location to the roster.
  app.post("/api/world/location", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const bad = unshapedImage(body);
    if (bad) return c.json({ error: imageError(bad) }, 400);
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
    const bad = unshapedImage(patch);
    if (bad) return c.json({ error: imageError(bad) }, 400);
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
  // ── Props — objects the story turns on, designed apart from the characters.
  // Same three routes as a location: add, edit in place, remove.
  app.post("/api/world/prop", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const bad = unshapedImage(body);
    if (bad) return c.json({ error: imageError(bad) }, 400);
    const { prop, world } = await editWorld(c.env, pid, (world) => {
      const p = normalizeProp({ name: "New prop", ...body }, world.props.length);
      world.props.push(p);
      return { prop: p, world };
    });
    if (prop.sheetImage?.rel) prop.sheetImage.refUrl = assetRefUrl(c.env, pid, prop.sheetImage.rel);
    return c.json({ ok: true, prop, world });
  });

  app.put("/api/world/prop/:id", async (c) => {
    const pid = c.get("projectId");
    const id = c.req.param("id");
    let patch;
    try { patch = await c.req.json(); } catch { patch = {}; }
    const bad = unshapedImage(patch);
    if (bad) return c.json({ error: imageError(bad) }, 400);
    const res = await editWorld(c.env, pid, (world) => {
      const idx = world.props.findIndex((x) => x.id === id);
      if (idx < 0) return { abort: true, missing: true };
      world.props[idx] = normalizeProp({ ...world.props[idx], ...patch, id }, idx);
      return { prop: world.props[idx], world };
    });
    if (res.missing) return c.json({ error: `no prop ${id}` }, 404);
    if (res.prop.sheetImage?.rel) res.prop.sheetImage.refUrl = assetRefUrl(c.env, pid, res.prop.sheetImage.rel);
    return c.json({ ok: true, prop: res.prop, world: res.world });
  });

  app.delete("/api/world/prop/:id", async (c) => {
    const pid = c.get("projectId");
    const id = c.req.param("id");
    const res = await editWorld(c.env, pid, (world) => {
      const before = world.props.length;
      world.props = world.props.filter((x) => x.id !== id);
      if (world.props.length === before) return { abort: true, missing: true };
      return { world };
    });
    if (res.missing) return c.json({ error: `no prop ${id}` }, 404);
    return c.json({ ok: true, world: res.world });
  });
}
