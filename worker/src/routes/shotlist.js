// Shot-list endpoints, ported from server/index.js (/api/shotlist*). Backed by
// the R2 doc store `state/<projectId>/shotlist.json` instead of a local file.
// The episode manifest (for the "rebuild from episode" seed) is likewise an R2
// doc `state/<projectId>/episode-manifest.json`.
//
// SHOT IDs ARE A PUBLIC KEY SPACE — DO NOT LET THEM DRIFT. A shot's `id` keys
// generated media that lives OUTSIDE this doc, most importantly the storyboard
// stills (`db.stills[bundleId][shotId]`, see routes/storyboard.js) that the
// Episode tab and the animatic build join against. `normalizeShot` auto-numbers
// a MISSING id positionally ("01", "02", …), so a bulk save that omits ids used
// to silently rewrite "MS-012"-style ids and orphan every still with no error.
// `preserveIds` below is the guard: ids are carried over from the stored list,
// and the response reports what it had to invent.
import { readDoc, writeDoc, updateDoc } from "../lib/docs.js";
import { validateBody } from "../lib/validate.js";
import shotlistSchema from "../schemas/shotlist.json";
import { normalizeShot } from "../lib/shots.js";
import { packPreview } from "../lib/pack.js";
import { normalizeProductionType } from "../lib/production-type.js";
import { resolveActiveDirector, directorSummary } from "../lib/shot-directors.js";

// Carry stored shot ids onto an incoming bulk save that omitted them.
//
// Matching is by CONTENT, not position. Position is not identity: a save that
// deletes one shot and appends another keeps the count identical, so
// index-inheritance would hand every subsequent shot its predecessor's id and
// mis-key that shot's stills onto the WRONG shot — which is worse than orphaning
// them, because it looks correct. So an id-less shot only inherits when it can
// be matched to exactly ONE stored shot by its action text (the shot's most
// distinguishing field, and the one an edit is least likely to rewrite
// wholesale). Anything ambiguous — no match, several matches, or an id already
// claimed by another shot in this save — gets a fresh positional id and is
// counted in `invented` so the caller can warn.
const contentKey = (s) => `${String(s?.beat || "").trim()}\u0000${String(s?.action || s?.summary || "").trim()}`;

function preserveIds(incoming, stored) {
  // Content key → the single stored shot with that key. Keys shared by more than
  // one stored shot are dropped: they can't identify anything.
  const byContent = new Map();
  for (const s of stored) {
    if (!s?.id) continue;
    const k = contentKey(s);
    if (!k.replace(/\u0000/g, "").trim()) continue; // empty content identifies nothing
    byContent.set(k, byContent.has(k) ? null : s.id);
  }

  // Ids explicitly claimed by this save can't also be inherited by another shot.
  const claimed = new Set(incoming.map((s) => s?.id).filter(Boolean));

  let inherited = 0;
  let invented = 0;
  const shots = incoming.map((s) => {
    const src = s && typeof s === "object" ? s : {};
    if (src.id) return src;
    const prior = byContent.get(contentKey(src));
    if (prior && !claimed.has(prior)) {
      claimed.add(prior);
      inherited++;
      return { ...src, id: prior };
    }
    invented++;
    return src; // normalizeShot assigns the positional fallback
  });
  return { shots, inherited, invented };
}

// --- Character-name canonicalization against the World roster -----------------
//
// Character identity is a free-text name string that the casting rail (radio.js)
// matches to a voice by EXACT uppercased name. The World bible names characters
// in full ("Kai Morales") but a shot list is often authored with the short form
// ("Kai"), so the same person ends up cast twice — once as the shot-list speaker
// and once as the voiced World character. This guardrail rewrites an incoming
// shot-list name to its World character's canonical full name whenever the match
// is UNAMBIGUOUS, so the two collapse to one casting entry. It only ever pulls a
// name TOWARD the World roster (the single source of truth); a name with no World
// match (a background "Teacher", "Store Owner") is left untouched.
const nameKey = (s) => String(s || "").trim().toUpperCase();

// The canonical World name for a free-text character name, or null when there's
// no unambiguous match. Matches exactly, or on a shared LEADING token — a first
// name: "Kai" ↔ "Kai Morales". If two World characters share that first name the
// match is ambiguous → null + ambiguous:true, so the caller warns instead of
// guessing which one it meant.
function matchWorldName(name, worldNames) {
  const k = nameKey(name);
  if (!k) return { canonical: null, ambiguous: false };
  const exact = worldNames.find((w) => nameKey(w) === k);
  if (exact) return { canonical: exact, ambiguous: false };
  const related = worldNames.filter((w) => {
    const wk = nameKey(w);
    return wk.startsWith(k + " ") || k.startsWith(wk + " ");
  });
  if (related.length === 1) return { canonical: related[0], ambiguous: false };
  if (related.length > 1) return { canonical: null, ambiguous: true };
  return { canonical: null, ambiguous: false };
}

const DIALOGUE_PREFIX = /^\s*([A-Za-z][A-Za-z0-9 .'’-]{0,30}?):\s*(.+)$/s;

// Rewrite every character name in a batch of shots (the on-screen `characters[]`
// and any leading "NAME:" dialogue prefix) to its canonical World name. Returns
// the rewritten shots plus what changed: `remaps` (from → to) and `ambiguous`
// (names that matched more than one World character and were left as-is).
function canonicalizeShotNames(shots, worldNames) {
  if (!worldNames.length) return { shots, remaps: [], ambiguous: [] };
  const remaps = new Map();     // fromKey → { from, to }
  const ambiguous = new Set();
  const canon = (name) => {
    const { canonical, ambiguous: amb } = matchWorldName(name, worldNames);
    if (amb) ambiguous.add(String(name).trim());
    if (canonical && nameKey(canonical) !== nameKey(name)) {
      remaps.set(nameKey(name), { from: String(name).trim(), to: canonical });
      return canonical;
    }
    return name;
  };
  const out = shots.map((s) => {
    if (!s || typeof s !== "object") return s;
    const next = { ...s };
    if (Array.isArray(s.characters)) next.characters = s.characters.map((c) => (c ? canon(c) : c));
    const m = DIALOGUE_PREFIX.exec(String(s.dialogue || "").trim());
    if (m) {
      const to = canon(m[1].trim());
      if (nameKey(to) !== nameKey(m[1].trim())) next.dialogue = `${to}: ${m[2].trim()}`;
    }
    return next;
  });
  return { shots: out, remaps: [...remaps.values()], ambiguous: [...ambiguous] };
}

const NO_DIALOGUE = /^\(?\s*no dialogue\s*\)?\.?$/i;

// Speaker attribution for one shot (mirrors radio.js deriveLine): a "NAME:"
// dialogue prefix wins, else the first on-screen character. Null when the shot
// has no spoken line.
function shotSpeaker(shot) {
  const raw = String(shot?.dialogue || "").trim();
  if (!raw || NO_DIALOGUE.test(raw)) return null;
  const chars = Array.isArray(shot?.characters) ? shot.characters.filter(Boolean) : [];
  const m = DIALOGUE_PREFIX.exec(raw);
  if (m) {
    const named = m[1].trim();
    return chars.find((c) => nameKey(c) === nameKey(named)) || named;
  }
  return chars[0] || null;
}

// Speaking characters in the shot list that have NO World roster record — the
// candidates to promote into the World bible. The agent surfaces these after a
// save so a recurring speaker can be added as a character (add_world_character)
// while genuine one-off bit-parts are left off the roster. Each carries its line
// count and the shots/beats it appears in, so the agent can tell a real
// character (many lines, several beats) from a background role (one line) and
// write a role note that cites where they appear. Sorted most-lines first.
function newSpeakersNotInWorld(shots, worldNames) {
  if (!worldNames.length) return [];
  const worldKeys = new Set(worldNames.map(nameKey));
  const byKey = new Map();
  for (const s of shots) {
    const spk = shotSpeaker(s);
    const key = nameKey(spk);
    if (!key || worldKeys.has(key)) continue;
    let e = byKey.get(key);
    if (!e) { e = { character: spk, lines: 0, shots: new Set(), beats: new Set() }; byKey.set(key, e); }
    e.lines++;
    if (s.id) e.shots.add(s.id);
    if (s.beat) e.beats.add(s.beat);
  }
  return [...byKey.values()]
    .map((e) => ({ character: e.character, lines: e.lines, shots: [...e.shots], beats: [...e.beats] }))
    .sort((a, b) => b.lines - a.lines);
}

// Warn when the render prompts a batch carries don't match the shape the
// project's ACTIVE SHOT DIRECTOR calls for. Neither case is an error — the shots
// save either way — but both produce a render prompt the author didn't intend,
// and silently is how you find out three bundles later:
//   - a "blocks" director got paragraph `prompt`s: the shot renders, but without
//     the block structure that director exists to produce.
//   - a "paragraph" director got `promptBlocks`: the blocks compose into `prompt`
//     fine, so this is only worth saying when it looks like the wrong skill ran.
//   - a shot with NEITHER renders from an empty prompt.
//
// It reads the DIRECTOR, not the production type, because the director is what
// the author actually picked: a 2D project running the Seedance block director
// is a legitimate setup, and warning it off its own choice would be noise.
function promptShapeWarnings(shots, director, productionType) {
  const w = [];
  const empty = shots.filter((s) => !s.promptBlocks && !String(s.prompt || "").trim());
  if (empty.length) {
    w.push(
      `${empty.length} shot(s) have no render prompt at all (neither \`prompt\` nor \`promptBlocks\`) — they will render from an empty prompt.`,
    );
  }
  const wantsBlocks = director?.promptForm === "blocks";
  const blocked = shots.filter((s) => s.promptBlocks).length;
  const paragraph = shots.length - blocked - empty.length;
  const where = `This ${normalizeProductionType(productionType)} project writes shots with the "${director?.name || "default"}" shot director`;
  if (wantsBlocks && paragraph > 0) {
    w.push(
      `${where}, whose prompt form is \`blocks\` — but ${paragraph} shot(s) carry a one-paragraph \`prompt\` instead of \`promptBlocks\`. Read the director with get_shot_director and rewrite them as blocks.`,
    );
  }
  if (!wantsBlocks && blocked > 0) {
    w.push(
      `${where}, whose prompt form is \`paragraph\` — but ${blocked} shot(s) carry \`promptBlocks\`. Those blocks were composed into \`prompt\`, but this director writes one vivid paragraph per shot.`,
    );
  }
  return w;
}

// The script-coverage marker: how much of the screenplay the shot list already
// covers, so the NEXT chunk starts where the last one stopped instead of
// re-cutting the same scene. Written by whoever generates shots (the "generate
// the next ~15s" button hands it straight back to the agent) and read by the
// Shot list tab's progress line. Absent on an old list — that reads as "nothing
// recorded", not "nothing covered".
function normalizeProgress(raw, prev) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return prev ?? null;
  const idx = Number(raw.throughIndex);
  return {
    throughIndex: Number.isInteger(idx) && idx >= 0 ? idx : (prev?.throughIndex ?? null),
    throughLine: raw.throughLine == null ? (prev?.throughLine ?? "") : String(raw.throughLine).slice(0, 300),
    note: raw.note == null ? (prev?.note ?? "") : String(raw.note).slice(0, 1000),
    complete: raw.complete == null ? !!prev?.complete : !!raw.complete,
    draft: raw.draft == null ? (prev?.draft ?? null) : String(raw.draft).slice(0, 120),
    updatedAt: new Date().toISOString(),
  };
}

// Human-readable warnings for a canonicalization pass (empty when nothing moved).
function nameWarnings(remaps, ambiguous) {
  const w = [];
  if (remaps.length) {
    w.push(
      `Normalized ${remaps.length} character name(s) to the World roster so casting doesn't duplicate them: ` +
        remaps.map((r) => `"${r.from}" → "${r.to}"`).join(", ") + ".",
    );
  }
  if (ambiguous.length) {
    w.push(
      `Left ${ambiguous.length} character name(s) as-is — each matches more than one World character, so the intended one is ambiguous: ` +
        ambiguous.map((n) => `"${n}"`).join(", ") +
        ". Use the exact full name from the World roster.",
    );
  }
  return w;
}

// The shape of an absent shot list — shared by the reader and by `updateDoc`,
// which needs it to materialise the document on a project's first save.
const SHOTLIST_FALLBACK = { generatedAt: null, source: null, shots: [] };

async function readShotlist(env, pid) {
  const obj = await readDoc(env, pid, "shotlist", null);
  if (!obj) return { generatedAt: null, source: null, shots: [] };
  return { ...obj, shots: (obj.shots || []).map(normalizeShot) };
}
// guard:allow-write-doc — the ONLY remaining whole-document replace here is the
// rebuild-from-episode seed, which derives the entire list from another document
// and has nothing in the current one to preserve. Every edit goes through
// `updateDoc` below instead: this list is written by the author's bulk save, the
// agent building it beat by beat, and per-shot edits, and a read-then-write
// among those silently drops whichever landed second.
const writeShotlist = (env, pid, obj) => writeDoc(env, pid, "shotlist", obj);

// Flatten the episode manifest's bundles into one globally-numbered shot list.
async function rebuildShotlistFromEpisode(env, pid) {
  const manifest = await readDoc(env, pid, "episode-manifest", null);
  if (!manifest) return null;
  const flat = [];
  for (const b of manifest.bundles || []) {
    for (const s of b.shots || []) {
      flat.push(normalizeShot({ ...s, action: s.summary || s.action, beat: b.beat, beatTitle: b.beatTitle }, flat.length));
    }
  }
  const obj = { generatedAt: new Date().toISOString(), source: "episode", shots: flat };
  await writeShotlist(env, pid, obj);
  return obj;
}

// The shot list as `GET /api/shotlist` serves it: stored shots (auto-seeded from
// the episode manifest on first use) plus the live <=15s pack preview. Extracted
// so a non-HTTP caller (the MCP server's `get_shotlist`) inherits the auto-seed
// and the packs instead of reading the raw doc and missing both.
export async function buildShotlistView(env, pid) {
  let sl = await readShotlist(env, pid);
  if (!sl.shots.length) {
    const rebuilt = await rebuildShotlistFromEpisode(env, pid);
    if (rebuilt) sl = rebuilt;
  }
  // The project's production type AND its active shot director ride along on the
  // read. Both live in other documents, but every consumer of the shot list needs
  // them to know which form a shot's render prompt takes — the Shot list tab
  // picks its prompt editor from `director.promptForm`, and the agent gets it
  // without a second get_world / get_shot_director.
  const world = await readDoc(env, pid, "world", null);
  const productionType = normalizeProductionType(world?.productionType);
  const { director } = await resolveActiveDirector(env, pid, productionType);
  return {
    ...sl,
    productionType,
    director: directorSummary(director),
    promptForm: director.promptForm,
    progress: sl.progress || null,
    packs: packPreview(sl.shots),
  };
}

// Replace the whole shot list, or append a batch to the end (`mode:"append"`).
// Append lets a writer build a long list one beat at a time in bounded turns
// instead of emitting the whole episode in one giant call (which can blow a
// model's output limit and fail the turn).
//
// Extracted from the route because EVERY guardrail that makes this write safe
// lives here — id preservation (shot ids key storyboard stills that live in
// another document), World-roster name canonicalization, and the warnings that
// tell the caller when either had to give up. A second entry point that skipped
// them would silently orphan media, so the MCP server calls exactly this.
// Returns `{ error }` on bad input (the caller decides the status code).
// Mint a fresh, non-colliding id for each brand-new inserted shot. Existing ids
// key media that lives in other documents (storyboard stills, the animatic's
// picture track), so a new shot must never be handed an id already in use.
//
// An inserted shot is named RELATIVE to the shot it sits after, so its id itself
// reads as "a new node between the numbered shots": `<anchor>-node-1`, `-node-2`,
// … (the very start of the list has no anchor, so the base is "00"). Numbering
// continues past any node already minted at this anchor, and any collision (a
// stored id, or an earlier shot in this same batch) is skipped.
function mintInsertIds(shots, anchorId, existingIds) {
  const used = new Set(existingIds);
  const base = anchorId == null || anchorId === "" ? "00" : anchorId;
  const prefix = `${base}-node-`;
  let k = 1;
  for (const id of used) {
    if (typeof id === "string" && id.startsWith(prefix)) {
      const num = Number(id.slice(prefix.length));
      if (Number.isInteger(num) && num >= k) k = num + 1;
    }
  }
  return shots.map((s) => {
    const src = s && typeof s === "object" ? s : {};
    let id;
    do { id = `${prefix}${k++}`; } while (used.has(id));
    used.add(id);
    // Stamp the durable "added after the script" flag so the UI badges it as an
    // extra shot regardless of the id (which the author can later edit).
    return { ...src, id, extra: true };
  });
}

export async function saveShotlist(env, pid, body) {
  const { shots: rawShots, source, mode, anchorId, progress } = body || {};
  if (!Array.isArray(rawShots)) return { error: "shots[] required" };

  // The World roster is a different document and only read, so it stays outside
  // the compare-and-swap below — pulling it in would retry an expensive read for
  // no benefit.
  //
  // Pull every incoming character name toward the roster's canonical full name
  // (so casting doesn't list "Kai" and "Kai Morales" as two people). Names with
  // no World match are left untouched; ambiguous ones are surfaced.
  const world = await readDoc(env, pid, "world", { characters: [] });
  const worldNames = (world.characters || []).map((ch) => String(ch?.name || "").trim()).filter(Boolean);
  const productionType = normalizeProductionType(world?.productionType);
  const { director } = await resolveActiveDirector(env, pid, productionType);
  const { shots, remaps, ambiguous } = canonicalizeShotNames(rawShots, worldNames);
  const nameWarns = [
    ...nameWarnings(remaps, ambiguous),
    ...promptShapeWarnings(shots, director, productionType),
  ];

  // COMPARE-AND-SWAP, not read-then-write. Three writers share this document —
  // the author's bulk save on the Shot list tab, the agent appending a beat at a
  // time, and the per-shot edit below — and a plain read-modify-write hands the
  // whole list back to whoever finishes last, silently discarding the other's
  // batch. `mutate` re-runs against a fresh read on conflict, so an append that
  // races a save lands on top of it instead of erasing it.
  //
  // Everything inside is pure (`preserveIds` and `normalizeShot` derive from
  // their inputs only), which is what makes re-running safe.
  return await updateDoc(env, pid, "shotlist", SHOTLIST_FALLBACK, (doc) => {
    const prevShots = (doc.shots || []).map(normalizeShot);

    // Script coverage travels with the batch that produced it, so a chunked
    // build ("write the next ~15 seconds") records where it stopped in the SAME
    // atomic write that stores the shots. Recording it separately would let a
    // crash between the two leave a list whose marker points at the wrong place,
    // which is worse than no marker at all.
    if (progress) doc.progress = normalizeProgress(progress, doc.progress || null);
    const progressOut = doc.progress || null;
    const shared = {
      productionType,
      director: directorSummary(director),
      ...(progressOut ? { progress: progressOut } : {}),
    };

    // Append: add these shots to the end and renumber the whole list. Appended
    // shots keep their explicit `id` or get a fresh positional id continuing the
    // list; there is no id-inheritance here (that only makes sense when incoming
    // REPLACES the stored list). The list stays durably persisted after each
    // batch, so a crash mid-generation leaves resumable partial progress.
    if (mode === "append") {
      doc.shots = [...prevShots, ...shots].map(normalizeShot);
      doc.generatedAt = new Date().toISOString();
      doc.source = source || doc.source || "agent";
      const newSpeakers = newSpeakersNotInWorld(doc.shots, worldNames);
      return {
        ok: true, mode: "append", appended: shots.length, count: doc.shots.length,
        ...shared,
        ...(nameWarns.length ? { warnings: nameWarns } : {}),
        ...(newSpeakers.length ? { newSpeakers } : {}),
        packs: packPreview(doc.shots),
      };
    }

    // Insert: splice these NEW shots into the middle of the list, right after
    // the anchor shot (or at the very start when there's no anchor). Every stored
    // shot keeps its id and its media; the inserted shots get fresh minted ids.
    // This is the "add a shot between two existing ones" path — it never touches
    // the shots around it, so unlike a "replace" it can't shrink or orphan.
    if (mode === "insert") {
      const existingIds = new Set(prevShots.map((s) => s.id).filter(Boolean));
      const minted = mintInsertIds(shots, anchorId, existingIds);
      let at;
      if (anchorId == null || anchorId === "") {
        at = 0; // no anchor → insert at the very start of the list
      } else {
        const idx = prevShots.findIndex((s) => s.id === anchorId);
        if (idx < 0) {
          return { abort: true, error: `No shot "${anchorId}" to insert after — pass the id of an existing shot as anchorId, or omit it to insert at the start.` };
        }
        at = idx + 1; // immediately AFTER the anchor
      }
      doc.shots = [...prevShots.slice(0, at), ...minted, ...prevShots.slice(at)].map(normalizeShot);
      doc.generatedAt = new Date().toISOString();
      doc.source = source || doc.source || "agent";
      const newSpeakers = newSpeakersNotInWorld(doc.shots, worldNames);
      return {
        ok: true, mode: "insert", inserted: minted.length,
        insertedIds: minted.map((s) => s.id),
        anchorId: anchorId || null, count: doc.shots.length,
        ...shared,
        ...(nameWarns.length ? { warnings: nameWarns } : {}),
        ...(newSpeakers.length ? { newSpeakers } : {}),
        packs: packPreview(doc.shots),
      };
    }

    const { shots: kept, inherited, invented } = preserveIds(shots, prevShots);
    doc.shots = kept.map(normalizeShot);
    doc.generatedAt = new Date().toISOString();
    doc.source = source || "agent";
    const newSpeakers = newSpeakersNotInWorld(doc.shots, worldNames);
    // `invented` ids are the ones that can orphan stills — surface them so the
    // agent (and anyone reading the response) sees it happen.
    const warnings = [
      ...nameWarns,
      ...(invented
        ? [`${invented} shot(s) had no id and were auto-numbered positionally — any storyboard stills keyed to their previous ids are now orphaned. Pass an explicit \`id\` per shot to keep them.`]
        : []),
    ];
    return {
      ok: true,
      count: doc.shots.length,
      ...shared,
      idsPreserved: inherited,
      idsInvented: invented,
      ...(warnings.length ? { warnings } : {}),
      ...(newSpeakers.length ? { newSpeakers } : {}),
      packs: packPreview(doc.shots),
    };
  });
}

export function registerShotlist(app) {
  // Read the shot list (auto-seeding from the episode on first use) + packs.
  app.get("/api/shotlist", async (c) =>
    c.json(await buildShotlistView(c.env, c.get("projectId"))));

  // Replace the whole shot list (agent save_shotlist, or a bulk UI save), OR
  // append a batch to the end (`mode:"append"`).
  //
  // Validated against the SHARED contract in shared/schemas/shotlist.json — the
  // same file the agent's `save_shotlist` builds its tool schema from. Until
  // that existed this route checked `Array.isArray(shots)` and nothing else, so
  // a shot missing `dur` or `prompt` was accepted here and only surfaced later
  // as a broken pack preview or an empty render prompt. The agent path was
  // strictly typed and every other caller was not.
  app.post("/api/shotlist", async (c) => {
    const parsed = await validateBody(c, shotlistSchema);
    if (!parsed.ok) return parsed.response;
    const res = await saveShotlist(c.env, c.get("projectId"), parsed.value);
    return res.error ? c.json(res, 400) : c.json(res);
  });

  // Edit one shot in place. Same compare-and-swap reasoning as the bulk save:
  // this is a read-modify-write over the whole list, so doing it non-atomically
  // would let a concurrent bulk save erase the edit (or vice versa).
  app.put("/api/shotlist/shot/:n", async (c) => {
    const pid = c.get("projectId");
    const n = Number(c.req.param("n"));
    let patch;
    try { patch = await c.req.json(); } catch { patch = {}; }
    const res = await updateDoc(c.env, pid, "shotlist", SHOTLIST_FALLBACK, (doc) => {
      const shots = (doc.shots || []).map(normalizeShot);
      const idx = shots.findIndex((s) => s.n === n);
      if (idx < 0) return { abort: true, missing: true };
      // On a shot that has blocks, `prompt` is DERIVED — normalizeShot would
      // recompose it and throw this edit away. Silently accepting the write and
      // showing the old text back is the worst version of that, so say no. (Any
      // client still offering a single prompt box for a live-action shot — the
      // mobile app does — lands here rather than losing the author's typing.)
      if ("prompt" in patch && shots[idx].promptBlocks) {
        return { abort: true, derived: true };
      }
      // `promptBlocks` merges rather than replaces: the Shot list tab edits ONE
      // live-action block at a time and sends just that block, so a spread would
      // wipe the other sixteen. Clearing a block is sending it as "".
      const next = { ...shots[idx], ...patch };
      if (patch.promptBlocks && typeof patch.promptBlocks === "object") {
        next.promptBlocks = { ...(shots[idx].promptBlocks || {}), ...patch.promptBlocks };
      }
      shots[idx] = normalizeShot(next, idx);
      doc.shots = shots;
      return { shot: shots[idx], packs: packPreview(shots) };
    });
    if (res.missing) return c.json({ error: `no shot ${n}` }, 404);
    if (res.derived) {
      return c.json({
        error: `Shot ${n} is a live-action shot: its \`prompt\` is composed from \`promptBlocks\` and cannot be edited directly. Patch the block you mean instead, e.g. { "promptBlocks": { "lighting": "…" } }.`,
      }, 409);
    }
    return c.json({ ok: true, shot: res.shot, packs: res.packs });
  });

  // Recreate the shot list from the current episode manifest.
  app.post("/api/shotlist/rebuild-from-episode", async (c) => {
    const pid = c.get("projectId");
    const obj = await rebuildShotlistFromEpisode(c.env, pid);
    if (!obj) return c.json({ error: "No episode manifest to rebuild from" }, 400);
    return c.json({ ...obj, packs: packPreview(obj.shots) });
  });

  // The live <=15s multishot pack preview for the current shot list.
  app.get("/api/shotlist/packs", async (c) => {
    const pid = c.get("projectId");
    const sl = await readShotlist(c.env, pid);
    return c.json({ packs: packPreview(sl.shots) });
  });
}
