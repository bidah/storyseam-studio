// GET/PUT /api/appstate + GET /api/appstate/screen — WHAT THE AUTHOR IS
// LOOKING AT.
//
// The chat agent shares a window with the GUI but has always been blind to it:
// the author is staring at MS-014 with the shot open and asks "make this one
// wider", and the agent — having no idea which tab is mounted, let alone which
// row is selected — answers with "which shot?". Every such round trip is a
// question the app already knows the answer to. So the client reports its
// current view + selection here, and the agent reads it back through
// `view_screen`.
//
// Two rules keep this from rotting into a second, lying copy of the app state:
//
//   1. What's STORED is ids and short labels only — "view: shotlist, shotId:
//      MS-014" — never records. It's a pointer, not a cache. `PUT` enforces
//      that with a hard size cap rather than trusting callers.
//   2. What's SERVED (`/screen`) re-reads the live documents those ids point
//      at. A stored copy goes stale the instant the agent edits anything, and
//      an agent acting on its own stale snapshot of a shot it just rewrote is
//      strictly worse than an agent that asked.
//
// PER-USER KEYING — the non-obvious part. The `docs` table is keyed
// `(project_id, name)`, i.e. one row per project. But "which tab am I on" is
// not a property of the PROJECT, it's a property of the PERSON: two
// collaborators open on the same episode are looking at different screens, and
// a single project-wide `appstate` row would have them overwriting each other
// on every mouse move — with the agent then answering one author's "this shot"
// with the other author's selection. So the doc NAME carries the user:
// `appstate:<userId>` (and `appstate:anon` when there's no session), which
// gives each collaborator their own row inside the existing schema without a
// migration.
//
// Keying this way used to have a hole: the agent's tools called this Worker
// with no credential at all, so `view_screen` resolved to `appstate:anon` and
// never saw the row the browser wrote. That is fixed at the source rather than
// papered over here — every tool call now carries a signed identity for the
// user whose conversation it is (flue-agent/src/lib/agent-identity.ts), so the
// agent reads exactly the row that user's browser wrote and can't reach anyone
// else's. There is deliberately no "closest matching row" fallback: guessing
// whose screen the agent meant is the bug this keying exists to prevent.
import { readDoc, updateDoc } from "../lib/docs.js";
import { readWorld } from "./world.js";
import { readStore, pinnedDraft, countLines } from "../lib/script-store.js";
import { normalizeShot } from "../lib/shots.js";

const DOC_PREFIX = "appstate:";
const ANON_DOC = `${DOC_PREFIX}anon`;
const docNameFor = (userId) => (userId ? `${DOC_PREFIX}${userId}` : ANON_DOC);

// `source` is the provenance field every doc store carries, and history.js
// throttles snapshots per WRITER. Stamping it keeps a navigation-report burst
// collapsing into one parked version a minute instead of one per route change —
// this document is ephemeral UI state, and its history is worth nothing.
const FALLBACK = { source: "appstate", navigation: null, selection: null, updatedAt: null };

// A pointer, not a payload. 8 KB is far more than "view + a handful of ids"
// needs and far less than any real record, so a caller that starts posting whole
// shots trips it immediately instead of quietly filling the agent's context with
// state that `/screen` was going to re-fetch anyway.
const MAX_BODY_BYTES = 8 * 1024;

// Free text a client may have pasted into a label. Long strings here are always
// a mistake (see above) but must never blow up a response.
const clip = (s, n = 240) => {
  const t = String(s ?? "");
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

// The stored doc, projected to exactly the three public fields (never `source`).
const publicState = (doc) => ({
  navigation: doc?.navigation ?? null,
  selection: doc?.selection ?? null,
  updatedAt: doc?.updatedAt ?? null,
});

// Every request that reaches this route is authenticated (the ownership
// middleware fails closed), so this is a plain mapping — kept as a function
// only so the doc-name convention lives in one place.
const resolveDocName = (userId) => docNameFor(userId);

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------

// Per-request memoized doc reads. The view hydration and the selection
// hydration overlap constantly (a `shotlist` view with a shot selected wants the
// same list twice, `cuts` + a cut selection want the same `selections` doc), and
// D1 reads are the only cost in this route — so each document is fetched at most
// once per request.
function loaders(env, pid) {
  const cache = new Map();
  const once = (key, fn) => {
    if (!cache.has(key)) cache.set(key, fn());
    return cache.get(key);
  };
  return {
    shots: () =>
      once("shots", async () => {
        const doc = await readDoc(env, pid, "shotlist", null);
        return (doc?.shots || []).map(normalizeShot);
      }),
    world: () => once("world", () => readWorld(env, pid)),
    selections: () => once("selections", () => readDoc(env, pid, "selections", {})),
    sounds: () => once("sounds", () => readDoc(env, pid, "sounds", { tracks: [] })),
    manifest: () => once("manifest", () => readDoc(env, pid, "episode-manifest", null)),
    radio: () => once("radio", () => readDoc(env, pid, "radio", {})),
    musical: () => once("musical", () => readDoc(env, pid, "musical", { segments: [] })),
    script: () => once("script", () => readStore(env, pid)),
    moodboard: () => once("moodboard", () => readDoc(env, pid, "moodboard", null)),
  };
}

// One shot as the agent needs to SEE it on screen. `prompt` (the Seedance
// prompt, easily the bulkiest field) is dropped: it's a render input, not
// something the author is reading, and `get_shotlist` has it.
const shotLine = (s) => ({
  n: s.n,
  id: s.id,
  beat: s.beat,
  beatTitle: s.beatTitle,
  dur: s.dur,
  location: s.location,
  characters: s.characters,
  camera: clip(s.camera, 120),
  action: clip(s.action, 200),
  dialogue: clip(s.dialogue, 200),
});
// How many shots the on-screen list carries. A long episode runs to hundreds;
// past this the agent should be reading `get_shotlist`, not the screen.
const SHOT_CAP = 200;

// A stills entry is `db.stills[bundle][shotId]`: an object, an array of takes,
// or missing (mirrors routes/storyboard.js's tolerance).
const hasTake = (entry) => (Array.isArray(entry) ? entry.length > 0 : !!entry);
function stilledShotIds(db) {
  const out = new Set();
  for (const perShot of Object.values(db?.stills || {})) {
    for (const [shotId, entry] of Object.entries(perShot || {})) {
      if (hasTake(entry)) out.add(shotId);
    }
  }
  return out;
}

const cutLine = (g) => ({
  v: g?.v ?? null,
  kind: g?.kind || null,
  file: g?.file || null,
  at: g?.at || null,
  totalDuration: g?.totalDuration ?? null,
  segments: Array.isArray(g?.segments) ? g.segments.length : 0,
});

async function shotlistScreen(nav, L) {
  const shots = await L.shots();
  const focusId = String(nav?.shotId || "");
  const focus = focusId
    ? shots.find((s) => s.id === focusId || String(s.n) === focusId) || null
    : null;
  return {
    tab: "Shot list",
    count: shots.length,
    shots: shots.slice(0, SHOT_CAP).map(shotLine),
    ...(shots.length > SHOT_CAP ? { truncated: shots.length - SHOT_CAP } : {}),
    // The one place a FULL record is warranted: the author has this shot open,
    // so "this shot" almost certainly means this one.
    openShot: focus,
    ...(focusId && !focus ? { note: `No shot matches navigation.shotId "${focusId}".` } : {}),
  };
}

// What the author is looking at on the Moodboard. Notes carry their text (that
// IS the content, and it's short); images/videos/links carry only a label —
// the agent can't see pixels, and a wall of R2 filenames is noise.
async function moodboardScreen(L) {
  const board = await L.moodboard();
  const cards = Object.values(board?.cards || {});
  const notes = cards.filter((c) => c.type === "postIt");
  return {
    tab: "Moodboard",
    counts: {
      notes: notes.length,
      images: cards.filter((c) => c.type === "image").length,
      videos: cards.filter((c) => c.type === "video").length,
      links: cards.filter((c) => c.type === "link").length,
    },
    notes: notes.slice(0, NOTE_CAP).map((c) => ({ id: c.id, text: clip(stripTags(c.content), 200) })),
    links: cards
      .filter((c) => c.type === "link")
      .slice(0, NOTE_CAP)
      .map((c) => ({ id: c.id, url: c.url, title: c.previewData?.title || null })),
  };
}
// Past this the agent should be reading `get_moodboard`, not the screen.
const NOTE_CAP = 60;
// Post-it bodies are TipTap HTML; the agent wants the words.
const stripTags = (html) =>
  String(html || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

async function worldScreen(L) {
  const world = await L.world();
  const characters = Array.isArray(world.characters) ? world.characters : [];
  const locations = Array.isArray(world.locations) ? world.locations : [];
  // Names and coverage flags only — the full sheets are `get_world`'s job.
  return {
    tab: "World",
    title: String(world.title || ""),
    characters: characters.map((ch) => ({
      id: ch.id,
      name: ch.name,
      hasSheet: !!ch.sheetImage,
      hasVoice: !!ch.voiceRef,
    })),
    locations: locations.map((l) => ({
      id: l.id,
      name: l.name,
      slug: l.slug,
      hasSheet: !!l.sheetImage,
    })),
  };
}

async function scriptScreen(L) {
  const store = await L.script();
  const draft = pinnedDraft(store);
  // Never the doc itself: a screenplay is the biggest document in the app, and
  // `get_script` exists for when the agent actually needs the words.
  return {
    tab: "Script",
    title: String(draft.title || ""),
    draftId: draft.id,
    draftName: draft.name,
    drafts: store.drafts.length,
    lines: countLines(draft.doc),
    updatedAt: draft.updatedAt || null,
    hasProposal: !!draft.proposal,
  };
}

async function cutsScreen(nav, L) {
  const db = await L.selections();
  const history = (Array.isArray(db?.cutHistory) ? db.cutHistory : [])
    .slice()
    .sort((a, b) => (b?.v || 0) - (a?.v || 0));
  // Which cut the Editor is on comes from the working timeline's provenance
  // (`db.editorTimeline.source`, stamped by /api/timeline/from-cut); an explicit
  // `navigation.cutV` from the Cuts tab wins over it.
  const source = db?.editorTimeline?.source || null;
  const navV = nav?.cutV ?? nav?.cutId ?? null;
  const openV = navV != null ? Number(navV) : source?.v ?? null;
  const open = openV != null ? history.find((g) => g?.v === openV) : null;
  return {
    tab: nav?.view === "editor" ? "Editor" : "Complete cuts",
    count: history.length,
    cuts: history.map(cutLine),
    openCut: open ? cutLine(open) : null,
    editorTimeline: db?.editorTimeline
      ? { source, tracks: (db.editorTimeline.tracks || []).map((t) => ({ id: t.id, type: t.type, items: (t.items || []).length })) }
      : null,
  };
}

async function soundsScreen(L) {
  const sounds = await L.sounds();
  const tracks = Array.isArray(sounds?.tracks) ? sounds.tracks : [];
  return {
    tab: "Sound studio",
    count: tracks.length,
    tracks: tracks.map((t) => ({
      id: t.id,
      name: t.name,
      kind: t.kind || null,
      versions: (t.versions || []).length,
      ready: (t.versions || []).filter((v) => v?.file).length,
    })),
  };
}

// What the author sees on the Musical tab: the uploaded song, how it split, and
// which shots still need a lyric/prompt authored. Enough for "write the prompts"
// or "the split looks wrong" to resolve without a round-trip.
async function musicalScreen(L) {
  const db = await L.musical();
  const segments = Array.isArray(db?.segments) ? db.segments : [];
  return {
    tab: "Musical",
    song: db?.song
      ? { title: db.song.title || null, totalSec: db.song.totalSec || 0,
          hasStem: !!db.song.voxFile, hasMix: !!db.song.mixFile, hasLyrics: !!(db.song.lyrics || "").trim() }
      : null,
    split: db?.split?.status || null,
    shots: segments.length,
    authored: segments.filter((s) => String(s.prompt || "").trim()).length,
    segments: segments.slice(0, 40).map((s) => ({
      label: s.label, t0: s.t0, t1: s.t1, dur: s.dur,
      lyric: clip(s.lyric, 120), hasPrompt: !!String(s.prompt || "").trim(),
    })),
  };
}

async function radioScreen(L) {
  const [shots, radio] = await Promise.all([L.shots(), L.radio()]);
  const withDialogue = shots.filter((s) => String(s.dialogue || "").trim());
  const takes = radio?.takes && typeof radio.takes === "object" ? radio.takes : {};
  return {
    tab: "Radio",
    lines: withDialogue.length,
    voiced: Object.values(takes).filter(hasTake).length,
    cast: Object.keys(radio?.casting || {}).length,
  };
}

async function animaticScreen(L) {
  const [shots, db] = await Promise.all([L.shots(), L.selections()]);
  const stilled = stilledShotIds(db);
  const covered = shots.filter((s) => stilled.has(s.id)).length;
  return {
    tab: "Animatic",
    shots: shots.length,
    // A shot with no still renders as a SLATE on the picture track — that's the
    // number the author is looking at when they say "the empty ones".
    stills: covered,
    slates: shots.length - covered,
  };
}

async function episodeScreen(L) {
  const [manifest, db] = await Promise.all([L.manifest(), L.selections()]);
  const bundles = Array.isArray(manifest?.bundles) ? manifest.bundles : [];
  return {
    tab: "Episode",
    bundles: bundles.length,
    rendered: bundles.filter((b) => (db?.video?.[b.id] || []).length > 0).length,
    signed: Object.keys(db?.signoffs || {}).length,
  };
}

// The view → screen map. `shots` / `multishot` are the (hidden) sample-code tabs
// over the same shot list, so they hydrate as one.
async function screenForView(nav, L) {
  switch (nav?.view) {
    case "shotlist":
    case "shots":
    case "multishot":
      return await shotlistScreen(nav, L);
    case "world":
      return await worldScreen(L);
    case "script":
      return await scriptScreen(L);
    case "cuts":
    case "editor":
      return await cutsScreen(nav, L);
    case "sounds":
      return await soundsScreen(L);
    case "musical":
      return await musicalScreen(L);
    case "radio":
      return await radioScreen(L);
    case "animatic":
      return await animaticScreen(L);
    case "episode":
      return await episodeScreen(L);
    case "moodboard":
      return await moodboardScreen(L);
    default:
      // library / settings / anything new: the view name alone is still useful
      // context, and inventing a hydration for it would just be a guess.
      return { tab: nav?.view || null };
  }
}

// Turn `{ kind, ids }` into the records the author has actually highlighted.
// Unknown kinds echo back rather than 400: a newer client reporting a selection
// this Worker doesn't know yet must degrade to "something is selected", not
// break `view_screen`.
async function resolveSelection(sel, L) {
  const kind = String(sel?.kind || "");
  const ids = (Array.isArray(sel?.ids) ? sel.ids : sel?.ids ? [sel.ids] : []).map(String);
  if (!kind || !ids.length) return null;
  const base = { kind, ids, ...(sel?.label ? { label: clip(sel.label) } : {}) };
  const has = (v) => ids.includes(String(v));

  switch (kind) {
    case "shot": {
      const shots = await L.shots();
      return { ...base, items: shots.filter((s) => has(s.id) || has(s.n)) };
    }
    case "character": {
      const world = await L.world();
      return {
        ...base,
        items: (world.characters || []).filter((ch) => has(ch.id) || has(ch.name)),
      };
    }
    case "location": {
      const world = await L.world();
      return {
        ...base,
        items: (world.locations || []).filter((l) => has(l.id) || has(l.slug) || has(l.name)),
      };
    }
    case "sound":
    case "track": {
      const sounds = await L.sounds();
      return { ...base, items: (sounds?.tracks || []).filter((t) => has(t.id) || has(t.name)) };
    }
    case "cut": {
      const db = await L.selections();
      const hist = Array.isArray(db?.cutHistory) ? db.cutHistory : [];
      return { ...base, items: hist.filter((g) => has(g?.v) || has(g?.file)).map(cutLine) };
    }
    case "bundle": {
      const manifest = await L.manifest();
      return { ...base, items: (manifest?.bundles || []).filter((b) => has(b.id)) };
    }
    case "draft": {
      const store = await L.script();
      return {
        ...base,
        items: store.drafts
          .filter((d) => has(d.id))
          .map((d) => ({ id: d.id, name: d.name, title: d.title, lines: countLines(d.doc), updatedAt: d.updatedAt })),
      };
    }
    default:
      return { ...base, items: [], note: `No resolver for selection kind "${kind}" — ids only.` };
  }
}

export function registerAppState(app) {
  // What the client last reported. Cheap: one row.
  app.get("/api/appstate", async (c) => {
    const pid = c.get("projectId");
    const name = await resolveDocName(c.get("userId"));
    const doc = await readDoc(c.env, pid, name, FALLBACK);
    return c.json(publicState(doc));
  });

  // Merge a report. An ABSENT field is left alone (a navigation report must not
  // wipe the selection, and vice versa — they're written by different surfaces
  // at different moments); an explicit `null` clears it.
  app.put("/api/appstate", async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ error: "Body must be an object { navigation?, selection? }" }, 400);
    }
    const bytes = new TextEncoder().encode(JSON.stringify(body)).length;
    if (bytes > MAX_BODY_BYTES) {
      return c.json(
        {
          error:
            `App state is ${bytes} bytes; the cap is ${MAX_BODY_BYTES}. Report POINTERS — ` +
            "ids plus short labels (e.g. { view: \"shotlist\", shotId: \"MS-014\" }), never whole " +
            "records. GET /api/appstate/screen re-reads the live documents those ids name, so a " +
            "bulky copy here would only ever be a stale duplicate.",
        },
        400,
      );
    }

    const name = docNameFor(c.get("userId"));
    const { state } = await updateDoc(c.env, c.get("projectId"), name, FALLBACK, (doc) => {
      if ("navigation" in body) doc.navigation = body.navigation ?? null;
      if ("selection" in body) doc.selection = body.selection ?? null;
      doc.source = "appstate";
      doc.updatedAt = new Date().toISOString();
      return { state: publicState(doc) };
    });
    return c.json(state);
  });

  // The agent's eyes: stored pointers + the LIVE records they point at.
  app.get("/api/appstate/screen", async (c) => {
    try {
      const pid = c.get("projectId");
      const name = await resolveDocName(c.get("userId"));
      const doc = await readDoc(c.env, pid, name, null);
      const navigation = doc?.navigation ?? null;
      const selection = doc?.selection ?? null;

      if (!navigation && !selection) {
        return c.json({
          navigation: null,
          selection: null,
          screen: {
            message:
              "The app hasn't reported a view for this project yet — nobody has it open, or " +
              "this client predates app-state reporting. Ask the author what they're looking " +
              "at, or use get_status for where the episode stands overall.",
          },
        });
      }

      const L = loaders(c.env, pid);
      const [screen, resolved] = await Promise.all([
        navigation ? screenForView(navigation, L) : Promise.resolve({}),
        selection ? resolveSelection(selection, L) : Promise.resolve(null),
      ]);
      return c.json({
        navigation,
        selection: resolved,
        at: new Date().toISOString(),
        reportedAt: doc?.updatedAt ?? null,
        screen,
      });
    } catch (e) {
      return c.json({ error: String(e.message || e) }, 500);
    }
  });
}
