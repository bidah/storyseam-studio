// GET /api/status — one compact digest of where the episode stands.
//
// Everything here is DERIVED from the per-project docs on every call; nothing is
// stored. It exists because "how far along is this project?" was previously a
// question you could only answer by fetching the world, the script, the shot
// list, the visual world, the radio doc, the sounds and the cuts — seven fat
// payloads, several of them megabytes — and counting by hand. Two callers need
// exactly that count and nothing else:
//
//   - the mobile chat's suggestion cards, which compose their prompts from the
//     project's actual stage (mobile-app/src/lib/suggestions.ts), and
//   - the agent's `get_status` tool, for "what's the status of my episode?".
//
// So the digest is COUNTS AND FLAGS ONLY — never content. It must stay cheap
// enough to fetch on a screen's first paint: parallel doc reads, no R2 listing,
// no media probing, and none of the heavier derived views (buildRadioView /
// buildAnimaticView / buildCutSegments), which re-join the whole episode.
import { readDoc } from "../lib/docs.js";
import { readCompletedSuggestions } from "../lib/suggestion-ledger.js";
import { buildWorldView, MAP_FIELDS, DEPTH_FIELDS } from "./world.js";
import { readStore, pinnedDraft, countLines } from "../lib/script-store.js";
import { readReviews, reviewState, digestReviews } from "../lib/reviews.js";
import { normalizeShot } from "../lib/shots.js";
import { PLUGIN_IDS } from "../lib/plugins.ts";
import { readEnabledPlugins } from "./plugins.js";

const filled = (section, fields) => fields.filter((f) => String(section?.[f] || "").trim());
const missing = (section, fields) => fields.filter((f) => !String(section?.[f] || "").trim());
// Names are the one piece of CONTENT the digest carries, because a composed
// prompt needs them ("generate sheets for Sara and Helena"). Capped so a large
// roster can't bloat the payload.
const NAME_CAP = 8;
const names = (list) => list.slice(0, NAME_CAP).map((x) => String(x?.name || "").trim()).filter(Boolean);

// A stills entry is `db.stills[bundle][shotId]` and may be a single object, an
// array of takes, or missing — mirror routes/storyboard.js's tolerance.
const hasTake = (entry) => (Array.isArray(entry) ? entry.length > 0 : !!entry);


// The single word for "what should happen next", so a caller doesn't have to
// re-derive the pipeline order. Ordered by dependency: nothing downstream is
// worth suggesting while an upstream stage is still empty.
function pipelineStage(s) {
  if (!s.world.exists || s.world.map.filled === 0) return "world";
  if (!s.script.exists) return "script";
  if (!s.visualWorld.exists) return "visual";
  if (s.shotlist.shots === 0) return "shots";
  if (s.storyboard.withStill < s.storyboard.shots) return "board";
  if (s.radio.voiced < s.radio.lines) return "voice";
  if (s.episode.rendered < s.episode.bundles || s.episode.bundles === 0) return "render";
  if (s.cuts.count === 0) return "cut";
  return "done";
}

// The digest itself, extracted from the route so other handlers can ground on
// the project's real state without an HTTP hop back into the worker
// (POST /api/next-questions does exactly that). Pure read: no writes, no
// broadcast, safe to call from anywhere.
export async function buildStatus(env, pid) {
  const [world, store, reviewDoc, db, shotlistDoc, vw, radio, sounds, manifest, moodboardDoc, musical, completedCards] =
    await Promise.all([
      // The episode-merged view: `depth` and `characters` reflect the ACTIVE
      // episode's bible/roster, so the digest describes the episode in play.
      buildWorldView(env, pid),
      readStore(env, pid),
      readReviews(env, pid),
      readDoc(env, pid, "selections", {}),
      readDoc(env, pid, "shotlist", null),
      readDoc(env, pid, "visual-world", null),
      readDoc(env, pid, "radio", {}),
      readDoc(env, pid, "sounds", { tracks: [] }),
      readDoc(env, pid, "episode-manifest", null),
      // Two documents read ONLY for the `usage` counters below — the marketplace
      // has to know whether this project has ever used the Moodboard or the
      // Musical, and neither surface is otherwise part of the digest. Both are
      // single indexed rows in the same parallel batch, so they cost a round
      // trip, not a round trip each.
      readDoc(env, pid, "moodboard", null),
      readDoc(env, pid, "musical", null),
      // The one part of the digest that is STORED rather than derived — see
      // routes/suggestions.js for why "done" can't be recomputed from the gap
      // that closed. It rides along here so the landing screen gets the live
      // deck and its finished tail from the single fetch it already makes.
      readCompletedSuggestions(env, pid),
    ]);

  // --- World ------------------------------------------------------------
  const characters = Array.isArray(world.characters) ? world.characters : [];
  const locations = Array.isArray(world.locations) ? world.locations : [];
  const mapFilled = filled(world.map, MAP_FIELDS);
  const depthFilled = filled(world.depth, DEPTH_FIELDS);
  const noSheet = characters.filter((ch) => !ch.sheetImage);
  const noVoice = characters.filter((ch) => !ch.voiceRef);
  const locNoSheet = locations.filter((l) => !l.sheetImage);
  const worldState = {
    // "Exists" means somebody has put something in it — an empty skeleton
    // (which readWorld seeds on first read) is not a world.
    exists: !!(String(world.title || "").trim() || String(world.logline || "").trim() || mapFilled.length || characters.length),
    title: String(world.title || ""),
    hasLogline: !!String(world.logline || "").trim(),
    // Which kind of film this is — "2d" | "3d-pixar" | "live-action". It decides
    // which shot-list skill the agent runs, so it belongs in the digest the
    // agent grounds on rather than behind a separate get_world.
    productionType: world.productionType,
    // Feature film vs series — governs whether the episode axis is in play.
    format: world.format,
    map: { filled: mapFilled.length, total: MAP_FIELDS.length, missing: missing(world.map, MAP_FIELDS) },
    depth: { filled: depthFilled.length, total: DEPTH_FIELDS.length, missing: missing(world.depth, DEPTH_FIELDS) },
    characters: {
      count: characters.length,
      withSheet: characters.length - noSheet.length,
      withVoice: characters.length - noVoice.length,
      missingSheet: names(noSheet),
      missingVoice: names(noVoice),
    },
    locations: {
      count: locations.length,
      withSheet: locations.length - locNoSheet.length,
      missingSheet: names(locNoSheet),
    },
  };

  // --- Script (+ which doctors have read it) ----------------------------
  const draft = pinnedDraft(store);
  const lines = countLines(draft.doc);
  const signed = !!db?.scriptSignoff?.[draft.id];
  // Hoisted out of `digestReviews(...)` because `usage.agents` needs the raw
  // buckets: a specialist pass that went stale still happened, so fresh + stale
  // is the honest count of "has the writers' room ever run here".
  const reviews = reviewState(reviewDoc, { pinnedId: draft.id, scriptUpdatedAt: draft.updatedAt });
  const scriptState = {
    exists: lines > 0,
    lines,
    title: String(draft.title || ""),
    draftId: draft.id,
    draftName: draft.name,
    drafts: store.drafts.length,
    updatedAt: draft.updatedAt || null,
    signed,
    hasProposal: !!draft.proposal,
    reviews: digestReviews(reviews),
  };

  // --- Visual world -----------------------------------------------------
  const gens = Array.isArray(vw?.generations) ? vw.generations : [];
  // Stills and clips share one generation store (`kind` lives on the ITEM), and
  // the total alone no longer tells a caller which MEDIUM the project has —
  // Image generation and Video generation are separate installable surfaces now,
  // so the split is what decides whether either is in the header.
  const images = gens.filter((g) => g?.kind !== "video");
  const videos = gens.filter((g) => g?.kind === "video");
  const boardNodes = Array.isArray(vw?.board?.nodes) ? vw.board.nodes.length : 0;
  const visualState = {
    // A visual world is only real once a frame has actually come back — the
    // doc is seeded with style presets before anyone has generated anything.
    exists: gens.some((g) => g?.status === "ready"),
    generations: gens.length,
    images: images.length,
    videos: videos.length,
    ready: gens.filter((g) => g?.status === "ready").length,
    pending: gens.filter((g) => g?.status === "processing").length,
    // Has the style been tuned at all, or is it still the seeded default?
    promptRevisions: Array.isArray(vw?.promptRevisions) ? vw.promptRevisions.length : 0,
    boardNodes,
  };

  // --- Shot list / storyboard -------------------------------------------
  const shots = (shotlistDoc?.shots || []).map(normalizeShot);
  const withDialogue = shots.filter((s) => String(s.dialogue || "").trim());
  // `db.stills` is keyed by bundle then shot id; a shot id is unique across
  // bundles, so flattening the keys is enough to count coverage — no need for
  // lib/stills.js's shot→bundle index here.
  const stilled = new Set();
  for (const perShot of Object.values(db?.stills || {})) {
    for (const [shotId, entry] of Object.entries(perShot || {})) {
      if (hasTake(entry)) stilled.add(shotId);
    }
  }
  const covered = shots.filter((s) => stilled.has(s.id));
  const shotlistState = {
    shots: shots.length,
    withDialogue: withDialogue.length,
    locations: new Set(shots.map((s) => s.location).filter(Boolean)).size,
  };
  const storyboardState = {
    shots: shots.length,
    withStill: covered.length,
    // What the next storyboard pass would generate, by shot number.
    missing: shots.filter((s) => !stilled.has(s.id)).slice(0, 20).map((s) => s.n),
  };

  // --- Radio (voiced dialogue) ------------------------------------------
  const takes = radio?.takes && typeof radio.takes === "object" ? radio.takes : {};
  const voiced = Object.values(takes).filter((t) => (Array.isArray(t) ? t.length > 0 : !!t)).length;
  const radioState = {
    // Lines are DERIVED per shot by routes/radio.js; a shot with dialogue is
    // the unit the app renders, so it's the honest denominator here without
    // paying for the full join.
    lines: withDialogue.length,
    voiced,
    cast: Object.keys(radio?.casting || {}).length,
  };

  // --- Sound studio -----------------------------------------------------
  const tracks = Array.isArray(sounds?.tracks) ? sounds.tracks : [];
  const soundsState = {
    tracks: tracks.length,
    rendered: tracks.filter((t) => (t?.versions || []).some((v) => v?.file)).length,
  };

  // --- Episode video / cuts ---------------------------------------------
  const bundles = Array.isArray(manifest?.bundles) ? manifest.bundles : [];
  const episodeState = {
    bundles: bundles.length,
    rendered: bundles.filter((b) => (db?.episode?.[b.id] || []).length > 0).length,
  };
  const cutHistory = Array.isArray(db?.cutHistory) ? db.cutHistory : [];
  const cutsState = { count: cutHistory.length, latestAt: cutHistory[0]?.at || null };

  // --- Plugin usage -----------------------------------------------------
  // One integer per installable surface: HAS THIS PROJECT ACTUALLY USED IT.
  // Nothing else reads these as a measurement — they exist so the marketplace
  // can seed a pre-existing project's header from its own work instead of
  // opening it empty (see routes/plugins.js). Every one of them is counted off
  // a document this digest already read, which is the constraint: the seed must
  // not make /api/status any more expensive than it was.
  const usage = {
    // A pass that went stale still happened; only `pending` means never-run.
    agents: reviews.fresh.length + reviews.stale.length,
    moodboard: Object.keys(moodboardDoc?.cards || {}).length,
    shotlist: shots.length,
    images: images.length,
    videos: videos.length,
    nodes: boardNodes,
    // The animatic's picture track is the storyboard stills, so a shot with a
    // still is the honest unit of "this project has an animatic".
    animatic: covered.length,
    radio: voiced,
    sounds: tracks.length,
    musical: Array.isArray(musical?.segments) ? musical.segments.length : 0,
    // A bundle is what the Episodes tab is made of; a project that never packed
    // one never used it.
    episode: bundles.length,
    cuts: cutHistory.length,
    // A PROXY, and deliberately so: this counts generations that were promoted
    // into the library (`savedRel`), not the library's real contents — uploads
    // and provider imports never pass through here. A true count needs an R2
    // listing, which this digest is not allowed to do (see the header). It
    // under-reports, which is the safe direction for a seed: the worst case is
    // an author installing Library themselves.
    library: gens.filter((g) => String(g?.savedRel || "")).length,
  };

  const out = {
    at: new Date().toISOString(),
    projectId: pid || null,
    world: worldState,
    script: scriptState,
    visualWorld: visualState,
    shotlist: shotlistState,
    storyboard: storyboardState,
    radio: radioState,
    sounds: soundsState,
    episode: episodeState,
    cuts: cutsState,
    usage,
    suggestions: { completed: completedCards },
  };
  out.stage = pipelineStage(out);
  // One extra indexed row read, and NOT mutual recursion: the usage map is
  // handed over, so readEnabledPlugins never builds a status of its own from
  // here (routes/plugins.js explains the split).
  const { enabled, defaulted } = await readEnabledPlugins(env, pid, usage);
  out.plugins = {
    enabled,
    disabled: PLUGIN_IDS.filter((id) => enabled.indexOf(id) < 0),
    // true = nobody has chosen yet; `enabled` was derived from `usage` above.
    defaulted,
  };
  return out;
}

export function registerStatus(app) {
  app.get("/api/status", async (c) => {
    try {
      return c.json(await buildStatus(c.env, c.get("projectId")));
    } catch (e) {
      return c.json({ error: String(e.message || e) }, 500);
    }
  });
}
