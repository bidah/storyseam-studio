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
import { readDoc, writeDoc } from "../lib/docs.js";
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

const readSelections = (env, pid) => readDoc(env, pid, "selections", { library: {}, episode: {} });
const writeSelections = (env, pid, db) => writeDoc(env, pid, "selections", db);

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
//   { op:"move", id, from }                 – set an item's start frame
//   { op:"resize", id, durationInFrames }   – set an item's length
//   { op:"remove", id }                     – delete an item
//   { op:"volume", id, volume }             – set gain (0..2, 1 = unity)
//   { op:"mute", id, muted }                – mute/unmute an item
//   { op:"disable", id, disabled }          – grey out + skip an item in playback
//   { op:"reorder", track, order:[ids] }    – reorder + repack a track gapless
//   { op:"repack", track }                  – close gaps in a track, gapless
// move/remove/reorder/repack honor item `linkId` links (see repackTrack).
function applyTimelineOps(tl, ops) {
  for (const op of ops || []) {
    if (op.op === "move" && op.id != null) {
      const f = findItem(tl, op.id);
      if (f) {
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
        let d = Math.max(1, Math.round(op.durationInFrames || 1));
        if (f.item.sourceDurationInFrames) d = Math.min(d, f.item.sourceDurationInFrames); // can't exceed source length
        f.item.durationInFrames = d;
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
    return c.json({ timeline: db.editorTimeline || null, cuts });
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
    const db = await readSelections(c.env, pid);
    db.editorTimeline = timeline;
    await writeSelections(c.env, pid, db);
    await broadcastTimeline(c, clientId);
    return c.json({ ok: true, timeline });
  });

  // Load a complete cut into the editor (its clips + music, in order), replacing
  // the working timeline. `v` = cut version (default: latest generation).
  app.post("/api/timeline/from-cut", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const db = await readSelections(c.env, pid);
    const timeline = await buildTimelineFromCut(c.env, pid, db, body?.v);
    if (!timeline) return c.json({ error: "No matching cut generation to load" }, 404);
    db.editorTimeline = timeline;
    await writeSelections(c.env, pid, db);
    await broadcastTimeline(c, body?.clientId);
    return c.json({ ok: true, timeline });
  });

  // Apply granular edit ops to the working timeline (used by the chat agent).
  app.post("/api/timeline/edit", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const ops = body?.ops;
    if (!Array.isArray(ops)) return c.json({ error: "Body must be { ops: [...] }" }, 400);
    const db = await readSelections(c.env, pid);
    if (!db.editorTimeline || !Array.isArray(db.editorTimeline.tracks)) {
      return c.json({ error: "No timeline loaded yet — load a cut into the editor first" }, 400);
    }
    applyTimelineOps(db.editorTimeline, ops);
    await writeSelections(c.env, pid, db);
    // The chat agent has no clientId, so open Editor tabs treat this as a
    // foreign edit and reload — reflecting agent edits in the UI right away.
    await broadcastTimeline(c, body?.clientId);
    return c.json({ ok: true, timeline: db.editorTimeline });
  });

  // Stills — frames "grabbed" from the editor preview via right-click. The PNG
  // bytes live in R2 (media/<pid>/stills/<file>, served at /stills/<file>); the
  // per-still metadata (source clip, playhead time, resolution, …) lives in the
  // `stills` doc so the Stills tab in the media pool can list + inspect them.
  const readStills = (env, pid) => readDoc(env, pid, "stills", { items: [] });

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
    const doc = await readStills(c.env, pid);
    doc.items = [record, ...(doc.items || [])];
    await writeDoc(c.env, pid, "stills", doc);
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
    doc.items = (doc.items || []).filter((s) => s.id !== id);
    await writeDoc(c.env, pid, "stills", doc);
    return c.json({ ok: true });
  });
}
