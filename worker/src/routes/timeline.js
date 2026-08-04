// Editor timeline endpoints, ported from server/index.js (/api/timeline*,
// /api/pool). The editable, per-clip representation of a complete cut used by
// the Remotion <Player> editor tab AND the chat agent. Both the UI and the
// agent read/write it here so a chat edit and a drag on the timeline stay in
// sync.
//
// STORAGE: the timeline lives at `db.editorTimeline` inside the per-project
// `selections` doc (was `db.editorTimeline` in the Express local selections.json).
// The cut generations it can load from live at `db.cutHistory` in the same doc.
//
// MEDIA/FFMPEG NOTE: media stay the same `/gen/<file>` and `/sound-media/<file>`
// URLs the cut uses. The Express handlers used `fs.existsSync` (against GEN_DIR /
// SOUND_MEDIA) to hide clips whose media is missing; here we replace those disk
// checks with `listMedia(env, pid, kind)` against R2. No ffmpeg/ffprobe is
// touched: every segment duration comes from the STORED cut segments
// (`s.start` / `s.duration`, frozen at stitch time) — never a probe. The
// Remotion render ("Deliver") is a separate Stage-4 route (/api/render) and is
// NOT ported here. The SSE stream (/api/timeline/events) is already wired in
// index.js.
import { readDoc, updateDoc } from "../lib/docs.js";
import { validateBody } from "../lib/validate.js";
import timelineSchema from "../schemas/timeline.json";
import { listMedia, putMedia, mediaKey } from "../lib/media.js";
import { broadcast } from "../lib/broadcast.js";

// ---------------------------------------------------------------------------
// Constants + pure helpers — ported verbatim from server/index.js.
// ---------------------------------------------------------------------------
const TL_FPS = 24;
const secFrames = (sec) => Math.max(1, Math.round((sec || 0) * TL_FPS));
const MUSIC_BED_GAIN = 0.08; // ~-22 dB — a low background bed; dialogue/SFX lead
const bundleNum = (id) => {
  const m = /MS-0*(\d+)/.exec(id || "");
  return m ? Number(m[1]) : 0;
};

const SELECTIONS_FALLBACK = { library: {}, episode: {} };
const readSelections = (env, pid) => readDoc(env, pid, "selections", SELECTIONS_FALLBACK);
// CONCURRENCY: `selections` is the SHARED de-facto DB — the Library, Episode,
// Cuts, Script and Storyboard surfaces all keep their state in it. A
// readDoc→writeDoc pair here writes the WHOLE document back, so it silently
// reverts anything another surface changed in between. The Editor autosaves the
// timeline every 600 ms while you drag, which makes this route the most likely
// clobberer in the app. Every mutation therefore goes through `editSelections`
// (compare-and-swap on the doc version). `mutate` may re-run — keep it pure and
// do any side effects (media writes, cut building) BEFORE calling it.
const editSelections = (env, pid, mutate) =>
  updateDoc(env, pid, "selections", SELECTIONS_FALLBACK, mutate);

// Normalized cut history for the API: existing files only, newest-first, url
// added. Replaces the Express `getCutHistory(db)` — the `fs.existsSync` filter
// against GEN_DIR becomes a membership test against the R2 `gen` listing.
// TODO(faithful): the Express `ensureCutHistory` migrated a legacy single
// `db.cut` (+ scored versions) into `db.cutHistory` on first touch via
// `legacyToHistory` (heavily fs-dependent: reads db.cut, CUT_FILE existence,
// listScoredVersions). Modern R2-backed projects persist `db.cutHistory`
// directly, so that one-time legacy migration is intentionally not ported.
async function getCutHistory(env, pid, db) {
  const genFiles = new Set(await listMedia(env, pid, "gen"));
  const hist = Array.isArray(db.cutHistory) ? db.cutHistory : [];
  return hist
    .filter((g) => g.file && genFiles.has(g.file))
    .map((g) => ({ ...g, url: "/gen/" + g.file, withMusic: g.kind === "scored" }))
    .sort((a, b) => (b.v || 0) - (a.v || 0));
}

// Resolve a Sound Studio track's ready media file → { file, name } or null.
// Ported from `soundFileForTrack(trackId)`; the SOUNDS_DB read becomes a
// `sounds` doc read and the SOUND_MEDIA `fs.existsSync` becomes a set lookup.
function soundFileForTrack(sdb, soundFiles, trackId) {
  const t = (sdb.tracks || []).find((x) => x.id === trackId);
  if (!t) return null;
  const v =
    [...(t.versions || [])].reverse().find((x) => x.file && x.status === "ready") ||
    (t.versions || []).find((x) => x.file);
  if (!v || !v.file) return null;
  return soundFiles.has(v.file) ? { file: v.file, name: t.name } : null;
}

// Build a fresh timeline from a stored cut generation (its ordered clips + music
// bed). `v` selects the cut version; omitted → the latest generation. Ported
// from `buildTimelineFromCut(db, v)`; durations come from the STORED segments,
// so no ffprobe is needed.
async function buildTimelineFromCut(env, pid, db, v) {
  const hist = await getCutHistory(env, pid, db);
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
        // Source in-point (frames skipped at the head of the source). Fresh
        // cut clips always start at 0; splits/head-trims advance it.
        offsetFrames: 0,
        volume: 1,
      };
    });

  const sdb = await readDoc(env, pid, "sounds", { tracks: [] });
  const soundFiles = new Set(await listMedia(env, pid, "sound-media"));
  const musicItems = (gen.music || [])
    .map((m, i) => {
      const snd = soundFileForTrack(sdb, soundFiles, m.track);
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

// An empty editor project — the "new project" the Editor's toolbar and the
// agent's `new_editor_project` tool both start from. Mirrors `emptyTimeline()`
// in src/editor/timeline.js (same track ids, so a clip dragged in from the
// media pool lands on the same lanes a cut would have built), plus the
// `source` stamp the loaders write so the UI can label the timeline.
// `fps`/`width`/`height` let the caller pick a format (e.g. a vertical
// 1080×1920 project); anything out of range falls back to the 24fps 720p
// default rather than producing a timeline Remotion can't render.
// The author's label for the timeline (`timeline.name`) — shown in the Editor
// header and editable in place. Capped so a paste can't push the row off the
// header or bloat the doc; blank/absent means "no name", not an empty string.
const NAME_MAX = 120;
const cleanName = (v) => (typeof v === "string" ? v.trim().slice(0, NAME_MAX) : "");

const clampInt = (v, fallback, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : fallback;
};
function buildBlankTimeline(opts = {}) {
  return {
    fps: clampInt(opts.fps, TL_FPS, 1, 120),
    width: clampInt(opts.width, 1280, 16, 8192),
    height: clampInt(opts.height, 720, 16, 8192),
    name: cleanName(opts.name) || "Untitled project",
    source: { kind: "blank", at: new Date().toISOString() },
    tracks: [
      { id: "video", name: "Video", type: "video", items: [] },
      { id: "music", name: "Music", type: "audio", items: [] },
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
// Lay a track's items end-to-end from frame 0 (gapless), in current array
// order. Items sharing a `linkId` are LINKED (e.g. a video clip + its separated
// audio, created by the editor UI): each moved item's linked partners on OTHER
// tracks shift by the same delta so the pair never drifts apart.
const repackTrack = (tl, track) => {
  const deltas = new Map(); // linkId → frame delta of its moved member
  let cur = 0;
  for (const it of track.items) {
    if (it.linkId) deltas.set(it.linkId, cur - it.from);
    it.from = cur;
    cur += it.durationInFrames;
  }
  if (!deltas.size) return;
  for (const t of tl.tracks) {
    if (t === track) continue;
    for (const it of t.items) {
      if (it.linkId && deltas.has(it.linkId)) it.from = Math.max(0, it.from + deltas.get(it.linkId));
    }
  }
};

// Apply a list of edit ops to a timeline in place. Ops:
//   { op:"move", id, from, track? }         – set an item's start frame;
//                                             `track` also re-homes the item
//                                             onto another track of the SAME
//                                             media type (the multi-track case:
//                                             e.g. overlapping dialogue on a
//                                             second audio lane)
//   { op:"resize", id, durationInFrames, edge? } – set an item's length. Default
//                                             edge "end" trims the tail (capped
//                                             by the source length past the
//                                             in-point); edge:"start" trims or
//                                             re-extends the HEAD — the clip's
//                                             end stays anchored and its
//                                             `offsetFrames` (source in-point)
//                                             slides with the start.
//   { op:"split", id, at }                  – razor the clip in two at absolute
//                                             timeline frame `at` (strictly
//                                             inside the clip). The right half
//                                             is a NEW item continuing at the
//                                             same source position; linked
//                                             partners containing `at` split
//                                             too, their right halves sharing a
//                                             fresh linkId.
//   { op:"insert", trackId, item }          – add an item to a track. Used to
//                                             RESERVE a picture slot (a slate)
//                                             before its still exists.
//   { op:"replace", id, src, stillFile?, name? } – swap an item's MEDIA in
//                                             place, keeping its position,
//                                             length, kind and links. How a
//                                             generated still lands in the slot
//                                             the Editor reserved for it.
//   { op:"rename", name }                   – set the PROJECT's label
//                                             (`timeline.name`, shown in the
//                                             Editor header); blank clears it
//   { op:"remove", id }                     – delete an item
//   { op:"volume", id, volume }             – set gain (0..2, 1 = unity)
//   { op:"mute", id, muted }                – mute/unmute an item
//   { op:"disable", id, disabled }          – grey out + skip an item in playback
//   { op:"reorder", track, order:[ids] }    – reorder + repack a track gapless
//   { op:"repack", track }                  – close gaps in a track, gapless
//   { op:"addTrack", type, id?, name? }     – append an empty track
//                                             (type "video" | "audio"); the
//                                             agent's counterpart of the
//                                             Editor's + track button
// move/remove/reorder/repack honor item `linkId` links (see repackTrack).
//
// IMAGE ITEMS (`kind:"image"` — the animatic's stills, see routes/animatic.js)
// have no source timeline: `offsetFrames` stays 0 and `sourceDurationInFrames`
// stays absent. `resize edge:"start"` and `split` both do in-point math, so both
// branch on `isImage` — otherwise a head-trimmed or split still would try to
// seek into media that has no frames to seek to. Mirrors src/editor/timeline.js.
const isImage = (it) => it?.kind === "image";

function applyTimelineOps(tl, ops) {
  for (const op of ops || []) {
    if (op.op === "move" && op.id != null) {
      const f = findItem(tl, op.id);
      if (f) {
        // Cross-track move: `track` re-homes the item onto another track of the
        // SAME media type (the Editor is multi-track — e.g. a second dialogue
        // lane for overlapping lines). Unknown/mismatched target → stay put,
        // tolerant like every other op.
        if (op.track && op.track !== f.track.id) {
          const target = tl.tracks.find((x) => x.id === op.track);
          if (target && target.type === f.track.type) {
            f.track.items = f.track.items.filter((x) => x !== f.item);
            target.items.push(f.item);
            f.track = target;
          }
        }
        const next = Math.max(0, Math.round(op.from || 0));
        const delta = next - (f.item.from || 0);
        f.item.from = next;
        // Linked partners (video clip ↔ its separated audio) move together.
        if (f.item.linkId && delta) {
          for (const t of tl.tracks) {
            for (const it of t.items) {
              if (it !== f.item && it.linkId === f.item.linkId) it.from = Math.max(0, (it.from || 0) + delta);
            }
          }
        }
      }
    } else if (op.op === "resize" && op.id != null) {
      const f = findItem(tl, op.id);
      if (f) {
        const it = f.item;
        const off = it.offsetFrames || 0;
        const d = Math.max(1, Math.round(op.durationInFrames || 1));
        if (op.edge === "start") {
          // Head trim/extend, end anchored: the start slides by the duration
          // change and the source in-point follows. Clamps: offsetFrames ≥ 0
          // (can't extend before the source start), from ≥ 0, duration ≥ 1.
          // An image has no source start to bump into, so only from ≥ 0 binds.
          const lo = isImage(it) ? -(it.from || 0) : Math.max(-off, -(it.from || 0));
          const delta = Math.max(lo, Math.min((it.durationInFrames || 1) - 1, (it.durationInFrames || 0) - d));
          it.from = (it.from || 0) + delta;
          if (!isImage(it)) it.offsetFrames = off + delta;
          it.durationInFrames = (it.durationInFrames || 0) - delta;
        } else {
          // End trim: never exceed what's left of the source past the in-point.
          // An image has no source length — it holds for as long as you want.
          it.durationInFrames = it.sourceDurationInFrames
            ? Math.min(d, Math.max(1, it.sourceDurationInFrames - off))
            : d;
        }
      }
    } else if (op.op === "split" && op.id != null) {
      // Razor the clip (and its linked partners under the cut) in two at
      // absolute frame `at`. Metadata-only: the right half plays the same
      // source from an advanced in-point. `at` outside the clip's strict
      // interior (both halves ≥ 1 frame) → tolerant no-op like the other ops.
      const f = findItem(tl, op.id);
      const at = Math.round(op.at);
      const inside = (it) => at > (it.from || 0) && at < (it.from || 0) + (it.durationInFrames || 0);
      if (f && Number.isFinite(at) && inside(f.item)) {
        const targets = [f.item];
        if (f.item.linkId) {
          for (const t of tl.tracks) {
            for (const it of t.items) {
              if (it !== f.item && it.linkId === f.item.linkId && inside(it)) targets.push(it);
            }
          }
        }
        // ≥2 right halves from one link group stay linked to each other under
        // a fresh linkId; a lone right half is unlinked (the old id would
        // tether it to the left group).
        const rightLinkId = targets.length >= 2 ? `link_split_${Date.now()}` : null;
        const targetIds = new Set(targets.map((it) => it.id));
        for (const t of tl.tracks) {
          // Walk backwards so splicing a right half in never shifts unvisited items.
          for (let i = t.items.length - 1; i >= 0; i--) {
            const it = t.items[i];
            if (!targetIds.has(it.id)) continue;
            const leftDur = at - (it.from || 0);
            let rightId = `${it.id}_r${Date.now().toString(36)}`;
            for (let n = 2; findItem(tl, rightId); n++) rightId = `${it.id}_r${Date.now().toString(36)}_${n}`;
            const right = {
              ...it,
              id: rightId,
              from: at,
              durationInFrames: (it.durationInFrames || 0) - leftDur,
              // Both halves of a split still hold the same frame from in-point 0.
              offsetFrames: isImage(it) ? 0 : (it.offsetFrames || 0) + leftDur,
            };
            delete right.fadeInFrames; // fade-in belongs to the left half
            if (rightLinkId) right.linkId = rightLinkId; else delete right.linkId;
            if (right.fadeOutFrames) right.fadeOutFrames = Math.min(right.fadeOutFrames, right.durationInFrames);
            it.durationInFrames = leftDur;
            if (it.fadeInFrames) it.fadeInFrames = Math.min(it.fadeInFrames, leftDur);
            delete it.fadeOutFrames; // fade-out belongs to the right half
            t.items.splice(i + 1, 0, right);
          }
        }
      }
    } else if (op.op === "insert" && op.trackId != null && op.item && op.item.id) {
      // Add an item to a track. Normalized here rather than trusted: an inserted
      // image must obey the image invariants (no in-point, no source cap) even
      // if the caller sent otherwise, and a duplicate id would make every
      // id-keyed op ambiguous.
      const t = tl.tracks.find((x) => x.id === op.trackId);
      if (t && !findItem(tl, op.item.id)) {
        const it = { ...op.item };
        it.from = Math.max(0, Math.round(it.from || 0));
        it.durationInFrames = Math.max(1, Math.round(it.durationInFrames || 1));
        if (isImage(it)) {
          it.offsetFrames = 0;
          delete it.sourceDurationInFrames;
          if (!it.src) it.src = null; // explicit: a slate, not a broken clip
        } else {
          it.offsetFrames = Math.max(0, Math.round(it.offsetFrames || 0));
        }
        t.items.push(it);
      }
    } else if (op.op === "replace" && op.id != null) {
      // Swap the media under an item, keeping everything about its place in the
      // edit: `from`, `durationInFrames`, `kind`, `linkId`, flips, disabled.
      // This is how a freshly generated still fills the slate the Editor put on
      // the timeline when the user asked for it — the slot is reserved first,
      // the picture arrives later, and the timing never moves.
      const f = findItem(tl, op.id);
      if (f && typeof op.src === "string" && op.src) {
        const it = f.item;
        it.src = op.src;
        if (typeof op.name === "string" && op.name) it.name = op.name;
        if (op.stillFile !== undefined) it.stillFile = op.stillFile || null;
        if (isImage(it)) {
          // Re-assert the image invariants: a slate that just became a real
          // still must not inherit a stale in-point or source cap.
          it.offsetFrames = 0;
          delete it.sourceDurationInFrames;
        }
      }
    } else if (op.op === "remove" && op.id != null) {
      // Removing a linked clip takes its partners with it — deleting a video
      // clip also deletes its separated audio, and vice versa.
      const linkId = findItem(tl, op.id)?.item.linkId || null;
      for (const t of tl.tracks) {
        t.items = t.items.filter((x) => x.id !== op.id && (!linkId || x.linkId !== linkId));
      }
    } else if (op.op === "volume" && op.id != null) {
      const f = findItem(tl, op.id);
      if (f) f.item.volume = Math.min(2, Math.max(0, Number(op.volume)));
    } else if (op.op === "mute" && op.id != null) {
      const f = findItem(tl, op.id);
      if (f) f.item.muted = !!op.muted;
    } else if (op.op === "disable" && op.id != null) {
      const f = findItem(tl, op.id);
      if (f) f.item.disabled = !!op.disabled;
    } else if (op.op === "rename") {
      // Rename the PROJECT, not a clip — `op.name` is the timeline's label.
      // A blank name clears it back to unnamed rather than storing "".
      const next = cleanName(op.name);
      if (next) tl.name = next;
      else delete tl.name;
    } else if (op.op === "reorder" && op.track && Array.isArray(op.order)) {
      const t = tl.tracks.find((x) => x.id === op.track);
      if (t) {
        const byId = new Map(t.items.map((it) => [it.id, it]));
        const ordered = op.order.map((id) => byId.get(id)).filter(Boolean);
        for (const it of t.items) if (!ordered.includes(it)) ordered.push(it);
        t.items = ordered;
        repackTrack(tl, t);
      }
    } else if (op.op === "repack" && op.track) {
      const t = tl.tracks.find((x) => x.id === op.track);
      if (t) {
        t.items.sort((a, b) => a.from - b.from);
        repackTrack(tl, t);
      }
    } else if (op.op === "addTrack" && (op.type === "audio" || op.type === "video")) {
      // Add an empty track (the agent's counterpart of the Editor's makeTrack).
      // A caller-supplied id/name wins when the id is free; otherwise fall back
      // to the same non-colliding base-N scheme the Editor uses. Appended last:
      // rows draw top-to-bottom and earlier tracks play on top, so a new lane
      // never covers the existing picture.
      const ids = new Set(tl.tracks.map((x) => x.id));
      let id = typeof op.id === "string" && op.id.trim() && !ids.has(op.id.trim()) ? op.id.trim() : null;
      const base = op.type === "audio" ? "music" : "video";
      for (let n = 2; !id; n++) if (!ids.has(`${base}-${n}`)) id = `${base}-${n}`;
      const name = (typeof op.name === "string" && op.name.trim()) || id;
      tl.tracks.push({ id, name, type: op.type, items: [] });
    }
  }
  return tl;
}

// Broadcast a timeline change to the project's open SSE clients (mirrors the
// Express `broadcastTimeline({ at, clientId })`). The saver's `clientId` lets an
// Editor tab ignore the echo of its OWN autosave and reload only for foreign
// edits (e.g. the chat agent's edit_timeline, which has no clientId).
const broadcastTimeline = (c, pid, clientId) =>
  broadcast(c.env, pid, "timeline", { at: new Date().toISOString(), clientId: clientId ?? null }, c.executionCtx);

export function registerTimeline(app) {
  // Read the saved editor timeline (null if none yet), plus the list of cut
  // generations the editor can load from.
  app.get("/api/timeline", async (c) => {
    const pid = c.get("projectId");
    const db = await readSelections(c.env, pid);
    const cuts = (await getCutHistory(c.env, pid, db)).map((g) => ({
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
    // Radio versions — audio-only timelines assembled on the Radio tab and sent
    // here (see routes/radio.js). Listed alongside cuts so the editor's history
    // can load them back; the full timeline is stored inline on each entry.
    const radioVersions = (Array.isArray(db.radioVersions) ? db.radioVersions : []).map((r) => ({
      v: r.v,
      name: r.name || `radio version v${r.v}`,
      at: r.at || null,
      clips: r.clips || (r.timeline?.tracks?.find((t) => t.type === "audio")?.items?.length || 0),
    }));
    // Animatic versions — picture (storyboard stills) + dialogue timelines built
    // on the Radio tab (see routes/animatic.js). Same inline-timeline shape as
    // radio versions, plus the coverage counts they were built with.
    const animaticVersions = (Array.isArray(db.animaticVersions) ? db.animaticVersions : []).map((r) => ({
      v: r.v,
      name: r.name || `animatic v${r.v}`,
      at: r.at || null,
      clips: r.clips || (r.timeline?.tracks?.find((t) => t.type === "video")?.items?.length || 0),
      coverage: r.coverage || null,
    }));
    return c.json({ timeline: db.editorTimeline || null, cuts, radioVersions, animaticVersions });
  });

  // Load a stored radio version into the editor (replaces the working timeline).
  app.post("/api/timeline/from-radio", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const res = await editSelections(c.env, pid, (db) => {
      const list = Array.isArray(db.radioVersions) ? db.radioVersions : [];
      const entry = body?.v != null ? list.find((r) => r.v === Number(body.v)) : list[list.length - 1];
      if (!entry || !entry.timeline) return { abort: true, missing: true };
      db.editorTimeline = entry.timeline;
      return { timeline: entry.timeline };
    });
    if (res.missing) return c.json({ error: "No matching radio version to load" }, 404);
    await broadcastTimeline(c, pid, body?.clientId);
    return c.json({ ok: true, timeline: res.timeline });
  });

  // Load a stored animatic version into the editor. Mirrors from-radio.
  app.post("/api/timeline/from-animatic", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const res = await editSelections(c.env, pid, (db) => {
      const list = Array.isArray(db.animaticVersions) ? db.animaticVersions : [];
      const entry = body?.v != null ? list.find((r) => r.v === Number(body.v)) : list[list.length - 1];
      if (!entry || !entry.timeline) return { abort: true, missing: true };
      db.editorTimeline = entry.timeline;
      return { timeline: entry.timeline };
    });
    if (res.missing) return c.json({ error: "No matching animatic version to load" }, 404);
    await broadcastTimeline(c, pid, body?.clientId);
    return c.json({ ok: true, timeline: res.timeline });
  });

  // Media pool for the editor — every video generation on disk (+ every Sound
  // Studio audio track's latest render) as draggable source clips. Durations are
  // resolved client-side from the media metadata, so this stays cheap (no
  // ffprobe) and just lists what exists. The Express `fs.existsSync` presence
  // checks become membership tests against the R2 `gen` / `sound-media` listings.
  app.get("/api/pool", async (c) => {
    const pid = c.get("projectId");
    const db = await readSelections(c.env, pid);
    const genFiles = new Set(await listMedia(c.env, pid, "gen"));

    const video = [];
    for (const [bundle, entry] of Object.entries(db.video || {})) {
      const arr = Array.isArray(entry) ? entry : entry ? [entry] : [];
      arr.forEach((v, idx) => {
        if (!v || !v.file || !genFiles.has(v.file)) return;
        video.push({
          id: `pool-v-${bundle}-${v.file}`,
          mediaType: "video",
          bundle,
          name: `${bundle} · ${v.name || `gen ${idx + 1}`}`,
          src: "/gen/" + v.file,
          selected: !!v.selected,
        });
      });
    }
    video.sort((a, b) => bundleNum(a.bundle) - bundleNum(b.bundle) || a.id.localeCompare(b.id));

    const audio = [];
    const sdb = await readDoc(c.env, pid, "sounds", { tracks: [] });
    const soundFiles = new Set(await listMedia(c.env, pid, "sound-media"));
    for (const t of sdb.tracks || []) {
      const latest = [...(t.versions || [])].reverse().find((v) => v.file && soundFiles.has(v.file));
      if (!latest) continue;
      audio.push({
        id: `pool-a-${t.id}`,
        mediaType: "audio",
        name: t.name || t.label || t.id,
        src: "/sound-media/" + latest.file,
      });
    }

    return c.json({ video, audio });
  });

  // Replace the saved timeline outright (the UI autosaves the whole thing here).
  app.post("/api/timeline", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const { timeline, clientId } = body || {};
    if (!timeline || !Array.isArray(timeline.tracks)) {
      return c.json({ error: "Body must be { timeline: { tracks: [...] } }" }, 400);
    }
    // Only the timeline slot is replaced — NOT the whole document, which is
    // what the old read-then-write did at autosave frequency.
    await editSelections(c.env, pid, (db) => { db.editorTimeline = timeline; });
    await broadcastTimeline(c, pid, clientId);
    return c.json({ ok: true, timeline });
  });

  // Load a complete cut into the editor (its clips + music, in order), replacing
  // the working timeline. `v` = cut version (default: latest generation).
  app.post("/api/timeline/from-cut", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    // Build FIRST: buildTimelineFromCut probes media and writes a duration cache
    // back to `selections`, so it must not run inside the compare-and-swap.
    const db = await readSelections(c.env, pid);
    const timeline = await buildTimelineFromCut(c.env, pid, db, body?.v);
    if (!timeline) return c.json({ error: "No matching cut generation to load" }, 404);
    await editSelections(c.env, pid, (doc) => { doc.editorTimeline = timeline; });
    await broadcastTimeline(c, pid, body?.clientId);
    return c.json({ ok: true, timeline });
  });

  // Start a NEW, empty editor project — the same "replace the working timeline"
  // move as from-cut/from-radio/from-animatic, but with nothing preloaded. This
  // is the only way into the editor that isn't derived from something built
  // elsewhere in the pipeline: an author (or the agent) assembles the edit from
  // the media pool instead of from a stitched cut.
  //
  // The replaced timeline is NOT lost — `editSelections` parks the previous
  // `selections` value in doc_history, so a mis-tapped "New project" is one
  // restore_version away.
  app.post("/api/timeline/new", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const timeline = buildBlankTimeline(body || {});
    await editSelections(c.env, pid, (db) => { db.editorTimeline = timeline; });
    await broadcastTimeline(c, pid, body?.clientId);
    return c.json({ ok: true, timeline });
  });

  // Apply granular edit ops to the working timeline (used by the chat agent).
  //
  // Validated against the SHARED contract in shared/schemas/timeline.json — the
  // same file `edit_timeline` builds its tool schema from. The check used to be
  // `Array.isArray(ops)`, so a `split` missing `at`, or a `resize` sending a
  // string where frames were expected, reached `applyTimelineOps` and either did
  // nothing or corrupted a clip's geometry with no error anywhere.
  app.post("/api/timeline/edit", async (c) => {
    const pid = c.get("projectId");
    const parsed = await validateBody(c, timelineSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.value;
    const ops = body.ops;
    const res = await editSelections(c.env, pid, (db) => {
      if (!db.editorTimeline || !Array.isArray(db.editorTimeline.tracks)) {
        return { abort: true, noTimeline: true };
      }
      applyTimelineOps(db.editorTimeline, ops);
      return { timeline: db.editorTimeline };
    });
    if (res.noTimeline) {
      return c.json({
        error:
          "No timeline loaded yet — load a cut into the editor (load_cut_into_editor) " +
          "or start an empty one (new_editor_project) first",
      }, 400);
    }
    // The chat agent has no clientId, so open Editor tabs treat this as a
    // foreign edit and reload — reflecting agent edits in the UI right away.
    await broadcastTimeline(c, pid, body?.clientId);
    return c.json({ ok: true, timeline: res.timeline });
  });

  // Stills — frames "grabbed" from the editor preview via right-click. The PNG
  // bytes live in R2 (media/<pid>/stills/<file>, served at /stills/<file>); the
  // per-still metadata (source clip, playhead time, resolution, …) lives in the
  // `stills` doc so the Stills tab in the media pool can list + inspect them.
  const STILLS_FALLBACK = { items: [] };
  const readStills = (env, pid) => readDoc(env, pid, "stills", STILLS_FALLBACK);
  // Grabbing several frames in quick succession is normal, so the same CAS rule
  // applies here; the R2 bytes are written before the mutate, never inside it.
  const editStills = (env, pid, mutate) => updateDoc(env, pid, "stills", STILLS_FALLBACK, mutate);

  // List saved stills, newest-first, each with its public media URL.
  app.get("/api/stills", async (c) => {
    const pid = c.get("projectId");
    const doc = await readStills(c.env, pid);
    const files = new Set(await listMedia(c.env, pid, "stills"));
    const items = (doc.items || [])
      .filter((s) => s.file && files.has(s.file)) // hide records whose R2 object is gone
      .map((s) => ({ ...s, url: "/stills/" + s.file }))
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    return c.json({ stills: items });
  });

  // Save a grabbed still: PNG as a data URL + its metadata. Writes the bytes to
  // R2 and prepends a record to the `stills` doc.
  app.post("/api/stills", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const image = body?.image;
    const meta = body?.meta || {};
    const m = /^data:image\/png;base64,(.+)$/s.exec(image || "");
    if (!m) return c.json({ error: "Body must be { image: <png data URL>, meta }" }, 400);
    // base64 → bytes (atob is available in the Workers runtime)
    const bin = atob(m[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    const id = crypto.randomUUID();
    const file = `still-${id}.png`;
    await putMedia(c.env, pid, "stills", file, bytes, "image/png");

    const record = { id, file, createdAt: new Date().toISOString(), ...meta };
    await editStills(c.env, pid, (doc) => { doc.items = [record, ...(doc.items || [])]; });
    // The generic post-mutation middleware broadcasts "data" for /api/* writes.
    return c.json({ ok: true, still: { ...record, url: "/stills/" + file } });
  });

  // Delete a still (its R2 object + its metadata record).
  app.delete("/api/stills/:id", async (c) => {
    const pid = c.get("projectId");
    const id = c.req.param("id");
    const doc = await readStills(c.env, pid);
    const hit = (doc.items || []).find((s) => s.id === id);
    if (hit?.file) await c.env.BUCKET.delete(mediaKey(pid, "stills", hit.file));
    await editStills(c.env, pid, (d) => { d.items = (d.items || []).filter((s) => s.id !== id); });
    return c.json({ ok: true });
  });
}
