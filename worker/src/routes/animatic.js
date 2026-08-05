// Animatic endpoints (/api/animatic*). The animatic is the radio version and
// the storyboard joined: every shot's still on the picture track, timed to the
// voiced dialogue, so the episode can be WATCHED — timed, voiced and framed —
// before a single video clip is rendered.
//
// Radio (routes/radio.js) already builds an audio-only timeline with a
// deliberately empty video track. The animatic fills that track.
//
// STRUCTURE IS DERIVED, never stored — same discipline as radio.js. The shots
// come fresh from the shot list, the voices from the radio doc's takes, and the
// pictures from `db.stills`, so an animatic build always reflects current state.
// Only the RESULT is persisted (`db.animaticVersions` + `db.editorTimeline`).
//
// Two things this does NOT inherit from radio.js, on purpose:
//
//  1. COVERAGE. `deriveLine` yields nothing for a shot with no dialogue, so the
//     radio timeline silently omits every silent beat and is shorter than the
//     episode. An animatic must show those shots, so we iterate the SHOT LIST
//     and fall back to the shot's planned `dur` for its screen time. The
//     dialogue track therefore has real gaps where the episode is silent —
//     which is what the episode actually sounds like.
//  2. MISSING ART. A shot with no still becomes a SLATE (an image item with
//     `src: null`), not a hole. Timing stays correct, the gap is visible and
//     labelled, and it's the right-click target for generating the still. An
//     all-slate animatic is a VALID day-one result, not an error.
import { readDoc, updateDoc } from "../lib/docs.js";
import { normalizeShot } from "../lib/shots.js";
import { readStillsContext } from "../lib/stills.js";
import { broadcast } from "../lib/broadcast.js";
import { appendCapped, nextVersion, MAX_VERSIONS } from "../lib/versions.js";
import { assetRefUrl } from "../lib/media.js";
import { buildRadioView } from "./radio.js";

const TL_FPS = 24;
const secFrames = (sec) => Math.max(1, Math.round((sec || 0) * TL_FPS));
// Screen time for a shot with no voiced line and no planned `dur`. Long enough
// to read a storyboard frame, short enough that a wall of them isn't a slog.
const DEFAULT_SHOT_SEC = 2;

async function readShots(env, pid) {
  const obj = await readDoc(env, pid, "shotlist", null);
  return (obj?.shots || []).map(normalizeShot);
}

// The derived animatic view: one entry per shot, in shot order, carrying its
// picture (still or slate) and its voice take (or none). This is the whole
// feature's join, and it's why `shot.id` must stay stable — see
// lib/stills.js and the id guard in routes/shotlist.js.
export async function buildAnimaticView(env, pid) {
  const shots = await readShots(env, pid);
  const [radioView, stills] = await Promise.all([
    buildRadioView(env, pid),
    readStillsContext(env, pid, shots),
  ]);

  // Radio lines are keyed `sh<shot.n>`; index them back onto their shot.
  const lineByShotN = new Map();
  for (const scene of radioView.scenes || []) {
    for (const line of scene.lines || []) lineByShotN.set(line.shotN, line);
  }

  const entries = [];
  for (const shot of shots) {
    const line = lineByShotN.get(shot.n) || null;
    const take = line?.take?.ready ? line.take : null;
    const hit = stills.resolve(shot.id);
    // Screen time: the voice take leads (the picture must cover its own line),
    // else the shot's planned length, else a readable default.
    //
    // A take can be `ready` with duration 0 (the sounds doc records no length),
    // so estimate from the word count the way buildRadioTimeline does rather
    // than falling through to shot.dur — a 6s line on a 2s shot would otherwise
    // be cut off mid-word.
    const takeSec = take
      ? take.duration > 0
        ? take.duration
        : Math.max(1.2, String(line.text || "").split(/\s+/).filter(Boolean).length / 2.6)
      : 0;
    const seconds = takeSec > 0 ? takeSec : shot.dur > 0 ? shot.dur : DEFAULT_SHOT_SEC;
    entries.push({
      shot,
      line,
      take,
      bundle: hit?.bundle || null,
      still: hit?.take || null,
      bundleSource: hit?.source || null, // "manifest" | "packs" | null
      durationInFrames: secFrames(seconds),
    });
  }
  return { entries, hasManifest: stills.index.hasManifest };
}

// Read the World bible's character + location rosters as reference lookups. Each
// linked sheet yields both a project-scoped `url` (for the tab thumbnail) and an
// ungated `refUrl` (for the image model — the same /files form world.js hands the
// agent). This is the Phase-1 payoff: a shot's `characters` + `location` resolve
// to their sheets automatically, so "Render Scene" supplies references itself
// instead of the user hand-picking them per bundle.
async function readRosterRefs(env, pid) {
  const w = (await readDoc(env, pid, "world", null)) || {};
  const characters = new Map();
  for (const ch of w.characters || []) {
    const name = String(ch.name || "").trim();
    if (!name) continue;
    const sheet = ch.sheetImage;
    characters.set(name.toLowerCase(), {
      name,
      sheetUrl: sheet?.url || null,
      refUrl: sheet?.rel ? assetRefUrl(env, pid, sheet.rel) : null,
    });
  }
  const locations = new Map();
  for (const loc of w.locations || []) {
    const slug = String(loc.slug || "").trim();
    if (!slug) continue;
    const sheet = loc.sheetImage;
    locations.set(slug, {
      slug,
      name: String(loc.name || ""),
      description: String(loc.description || ""),
      sheetUrl: sheet?.url || null,
      refUrl: sheet?.rel ? assetRefUrl(env, pid, sheet.rel) : null,
    });
  }
  return { characters, locations };
}

// Resolve one shot's on-screen characters + location to their roster sheets.
function resolveShotRefs(shot, roster) {
  const characters = (shot.characters || []).map((nm) => {
    const r = roster.characters.get(String(nm).toLowerCase());
    return { name: nm, sheetUrl: r?.sheetUrl || null, refUrl: r?.refUrl || null, hasSheet: !!r?.refUrl };
  });
  const lr = shot.location ? roster.locations.get(shot.location) : null;
  const location = shot.location
    ? {
        slug: shot.location,
        name: lr?.name || null,
        sheetUrl: lr?.sheetUrl || null,
        refUrl: lr?.refUrl || null,
        hasSheet: !!lr?.refUrl,
        known: !!lr,
      }
    : null;
  return { characters, location };
}

// Coverage counts. These exist so a shot-list / manifest divergence surfaces as
// a NUMBER instead of silently producing an all-slate animatic: `unmatched` is
// the count of shots that belong to no bundle at all, which is what a shot-id
// drift looks like from here.
function coverageOf(entries) {
  let withStill = 0, slates = 0, voiced = 0, unmatched = 0, fromPacks = 0;
  for (const e of entries) {
    if (e.still) withStill++; else slates++;
    if (e.take) voiced++;
    if (!e.bundle) unmatched++;
    else if (e.bundleSource === "packs") fromPacks++;
  }
  return { shots: entries.length, withStill, slates, voiced, unmatched, fromPacks };
}

// Assemble the picture + dialogue timeline. Scenes are laid gapless in SHOT
// order; each shot's picture and its line share a `linkId`, so dragging a scene
// carries its dialogue and deleting it removes both (existing link machinery in
// timeline.js — repackTrack/remove/split are all link-aware).
function buildAnimaticTimeline(view) {
  const picture = [];
  const dialogue = [];
  let cursor = 0;

  for (const e of view.entries) {
    const { shot, line, take, still, bundle, durationInFrames } = e;
    const linkId = take ? `link_sh${shot.n}` : undefined;
    const label = `${shot.id}${shot.action ? ` · ${shot.action.slice(0, 40)}` : ""}`;

    picture.push({
      id: `pic_sh${shot.n}`,
      kind: "image",
      // null src ⇒ slate. The item is otherwise ordinary: movable, trimmable,
      // splittable, and the target of "Generate still…".
      src: still ? "/storyboard-media/" + still.file : null,
      name: label,
      from: cursor,
      durationInFrames,
      // Provenance: which picture slot this is, and which take is on screen.
      // The Editor's context menu reads these to open the right modal.
      bundle: bundle || null,
      shot: shot.id,
      stillFile: still?.file || null,
      ...(linkId ? { linkId } : {}),
    });

    if (take && take.url) {
      dialogue.push({
        id: `rl_sh${shot.n}`,
        src: take.url,
        name: `${line.character || "?"}: ${String(line.text || "").slice(0, 40)}`,
        from: cursor,
        durationInFrames,
        // The trim cap is the AUDIO's real length — never the picture's. Only
        // claim it when the take actually reports one: an estimated length
        // stamped here would become a hard cap (both trim clamps honour it), so
        // the user could never drag the clip back out to recover the rest of the
        // line. Absent ⇒ uncapped, which is the safe direction.
        ...(take.duration > 0 ? { sourceDurationInFrames: secFrames(take.duration) } : {}),
        offsetFrames: 0,
        volume: 1,
        linkId,
      });
    }
    cursor += durationInFrames;
  }

  return {
    fps: TL_FPS,
    width: 1280,
    height: 720,
    source: { kind: "animatic", at: new Date().toISOString() },
    tracks: [
      { id: "picture", name: "Picture", type: "video", items: picture },
      { id: "dialogue", name: "Dialogue", type: "audio", items: dialogue },
    ],
  };
}

export function registerAnimatic(app) {
  // The derived coverage view — what the Radio tab shows before you build
  // ("34 shots · 12 stills · 22 slates").
  app.get("/api/animatic", async (c) => {
    const pid = c.get("projectId");
    const view = await buildAnimaticView(c.env, pid);
    return c.json({
      ...coverageOf(view.entries),
      hasManifest: view.hasManifest,
      shotsDetail: view.entries.map((e) => ({
        shot: e.shot.id,
        n: e.shot.n,
        bundle: e.bundle,
        still: e.still?.file || null,
        voiced: !!e.take,
        seconds: e.durationInFrames / TL_FPS,
      })),
    });
  });

  // The full Animatic-tab view: shots grouped by beat (the scene), each carrying
  // its resolved still (or slate), voice status, bundle, and the auto-resolved
  // character/location references the "Render Scene" turn will hand the model.
  app.get("/api/animatic/view", async (c) => {
    const pid = c.get("projectId");
    const [view, roster] = await Promise.all([
      buildAnimaticView(c.env, pid),
      readRosterRefs(c.env, pid),
    ]);

    const scenes = [];
    const byBeat = new Map();
    for (const e of view.entries) {
      const key = e.shot.beat || "";
      let sc = byBeat.get(key);
      if (!sc) { sc = { beat: key, beatTitle: e.shot.beatTitle || "", shots: [] }; byBeat.set(key, sc); scenes.push(sc); }
      sc.shots.push({
        id: e.shot.id,
        n: e.shot.n,
        action: e.shot.action,
        dialogue: e.shot.dialogue,
        camera: e.shot.camera,
        location: e.shot.location,
        characters: e.shot.characters,
        bundle: e.bundle,
        // `url` is the original; `thumb`/`display` are the webp tiers the grid
        // and the viewer render (worker/src/lib/images.js). The TIMELINE item's
        // `src` above deliberately stays the original — render.js absolutizes it
        // into the export source.
        still: e.still
          ? {
              file: e.still.file,
              url: "/storyboard-media/" + e.still.file,
              thumb: "/img/thumb/storyboard-media/" + e.still.file,
              display: "/img/display/storyboard-media/" + e.still.file,
            }
          : null,
        voiced: !!e.take,
        seconds: e.durationInFrames / TL_FPS,
        refs: resolveShotRefs(e.shot, roster),
      });
    }

    // Location coverage across the whole shot list: which slugs are used, whether
    // each is a known roster entry, and whether it has reference art. Drives the
    // Animatic's "locations pass" (link/create the places that lack a sheet).
    const locUsage = new Map();
    for (const e of view.entries) {
      const slug = e.shot.location;
      if (!slug) continue;
      if (!locUsage.has(slug)) {
        const lr = roster.locations.get(slug);
        locUsage.set(slug, { slug, name: lr?.name || null, known: !!lr, hasSheet: !!lr?.refUrl, shots: 0 });
      }
      locUsage.get(slug).shots++;
    }

    return c.json({
      ...coverageOf(view.entries),
      hasManifest: view.hasManifest,
      scenes,
      locations: [...locUsage.values()],
      roster: {
        characters: [...roster.characters.values()].map((r) => ({ name: r.name, hasSheet: !!r.refUrl })),
        locations: [...roster.locations.values()].map((r) => ({ slug: r.slug, name: r.name, hasSheet: !!r.refUrl })),
      },
    });
  });

  // Build the animatic and load it into the Editor. Mirrors
  // POST /api/radio/to-editor (append a named version, set the working
  // timeline, broadcast so an open Editor reloads).
  app.post("/api/animatic/to-editor", async (c) => {
    const pid = c.get("projectId");
    const view = await buildAnimaticView(c.env, pid);
    if (!view.entries.length) {
      return c.json({ error: "No shots yet — write a shot list first." }, 400);
    }
    const timeline = buildAnimaticTimeline(view);
    const coverage = coverageOf(view.entries);

    const at = new Date().toISOString();
    // updateDoc, not readDoc→writeDoc: `selections` is the shared doc, and a
    // build takes long enough (it reads the shot list, radio and stills first)
    // that a concurrent still-attach can land inside the window and be clobbered.
    const { v, pruned } = await updateDoc(c.env, pid, "selections", { library: {}, episode: {} }, (db) => {
      db.animaticVersions = Array.isArray(db.animaticVersions) ? db.animaticVersions : [];
      const next = nextVersion(db.animaticVersions);
      const { pruned } = appendCapped(db.animaticVersions, {
        v: next,
        name: `animatic v${next}`,
        at,
        clips: timeline.tracks[0].items.length,
        coverage,
        timeline,
      });
      db.editorTimeline = timeline;
      return { v: next, pruned };
    });

    await broadcast(c.env, pid, "timeline", { at, clientId: null }, c.executionCtx);
    return c.json({
      ok: true,
      version: { v, name: `animatic v${v}`, at, clips: timeline.tracks[0].items.length },
      // The cap drops the oldest builds for good — report it instead of a bare ok.
      ...(pruned ? { pruned, warning: `Dropped the ${pruned} oldest animatic(s) — only the ${MAX_VERSIONS} most recent are kept.` } : {}),
      coverage,
      timeline,
    });
  });
}
