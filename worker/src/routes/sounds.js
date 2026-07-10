// Sound Studio endpoints, ported from server/index.js (/api/sounds*). Backed by
// the R2 doc store `state/<projectId>/sounds.json` (was `sounds.json` on disk).
//
// Sound Studio is a standalone audio library. Each "track" holds ordered
// versions; editing a prompt saves a NEW version (which starts "pending"). The
// agent renders pending versions with Seed Audio, then attaches the audio.
//
// MEDIA/FFMPEG NOTE: media files (version audio + voice refs) and ffprobe are
// migrated in later stages (media -> R2, ffprobe -> Daytona). Here we keep the
// pure-metadata CRUD faithful and emit `/sound-media/<file>` URLs EXACTLY as
// Express did (a later stage repoints these to R2 streaming). We never touch
// ffmpeg or the filesystem. See the TODO markers below.
import { readDoc, writeDoc } from "../lib/docs.js";

const DEFAULT_SOUND_PARAMS = { model: "seed_audio", format: "wav", sample_rate: 48000 };

const readSounds = (env, pid) => readDoc(env, pid, "sounds", { tracks: [] });
const writeSounds = (env, pid, db) => writeDoc(env, pid, "sounds", db);

const findTrack = (db, id) => (db.tracks || []).find((t) => t.id === id) || null;
const nextVersion = (t) => t.versions.reduce((m, v) => Math.max(m, v.v), 0) + 1;

// Serialize a track for the client, resolving each version's media URL. The
// URLs stay `/sound-media/<file>` (repointed to R2 streaming in a later stage).
const soundView = (t) => ({
  ...t,
  versions: t.versions.map((v) => ({
    ...v,
    url: v.file ? "/sound-media/" + v.file : null,
    // Resolve the URL of the voice reference used for this version (voice acting).
    ref: v.ref
      ? { ...v.ref, url: v.ref.file ? "/sound-media/" + v.ref.file : null }
      : undefined,
  })),
});

export function registerSounds(app) {
  // List every track (newest first).
  app.get("/api/sounds", async (c) => {
    const pid = c.get("projectId");
    const db = await readSounds(c.env, pid);
    const tracks = [...(db.tracks || [])].reverse().map(soundView);
    return c.json({ tracks });
  });

  // Create a new track with an initial v1 (pending render).
  app.post("/api/sounds", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const { name, prompt, params } = body || {};
    if (typeof prompt !== "string" || !prompt.trim())
      return c.json({ error: "Missing 'prompt'" }, 400);
    const db = await readSounds(c.env, pid);
    db.seq = (db.seq || 0) + 1;
    const now = new Date().toISOString();
    const track = {
      id: `trk_${db.seq}`,
      name: (name && name.trim()) || `sound ${db.seq}`,
      createdAt: now,
      versions: [{
        v: 1, prompt: prompt.trim(), name: null, file: null,
        status: "pending", liked: false, params: params || DEFAULT_SOUND_PARAMS, ts: now,
      }],
    };
    db.tracks = db.tracks || [];
    db.tracks.push(track);
    await writeSounds(c.env, pid, db);
    return c.json({ ok: true, track: soundView(track) });
  });

  // Rename a track.
  app.patch("/api/sounds/:id", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const { name } = body || {};
    const db = await readSounds(c.env, pid);
    const t = findTrack(db, c.req.param("id"));
    if (!t) return c.json({ error: "No such track" }, 404);
    if (typeof name === "string" && name.trim()) t.name = name.trim();
    await writeSounds(c.env, pid, db);
    return c.json({ ok: true, track: soundView(t) });
  });

  // Delete a track and all its media.
  app.delete("/api/sounds/:id", async (c) => {
    const pid = c.get("projectId");
    const db = await readSounds(c.env, pid);
    const t = findTrack(db, c.req.param("id"));
    if (!t) return c.json({ error: "No such track" }, 404);
    // TODO(stage2): delete this track's media files in R2 (each v.file).
    db.tracks = db.tracks.filter((x) => x.id !== t.id);
    await writeSounds(c.env, pid, db);
    return c.json({ ok: true });
  });

  // Add a new version from an edited prompt — bumps the number, starts pending.
  app.post("/api/sounds/:id/version", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const { prompt, name, params } = body || {};
    if (typeof prompt !== "string" || !prompt.trim())
      return c.json({ error: "Missing 'prompt'" }, 400);
    const db = await readSounds(c.env, pid);
    const t = findTrack(db, c.req.param("id"));
    if (!t) return c.json({ error: "No such track" }, 404);
    const prev = t.versions[t.versions.length - 1];
    const v = nextVersion(t);
    t.versions.push({
      v, prompt: prompt.trim(), name: (name && name.trim()) || null, file: null,
      status: "pending", liked: false, params: params || prev?.params || DEFAULT_SOUND_PARAMS,
      ts: new Date().toISOString(),
    });
    await writeSounds(c.env, pid, db);
    return c.json({ ok: true, version: v, track: soundView(t) });
  });

  // Edit a version in place (prompt and/or name) WITHOUT creating a new version.
  app.patch("/api/sounds/:id/version/:v", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const { prompt, name } = body || {};
    const db = await readSounds(c.env, pid);
    const t = findTrack(db, c.req.param("id"));
    if (!t) return c.json({ error: "No such track" }, 404);
    const ver = t.versions.find((x) => x.v === Number(c.req.param("v")));
    if (!ver) return c.json({ error: "No such version" }, 404);
    if (typeof prompt === "string") ver.prompt = prompt;
    if (typeof name === "string") ver.name = name.trim() || null;
    await writeSounds(c.env, pid, db);
    return c.json({ ok: true, track: soundView(t) });
  });

  // Toggle a version's "like".
  app.post("/api/sounds/:id/version/:v/like", async (c) => {
    const pid = c.get("projectId");
    const db = await readSounds(c.env, pid);
    const t = findTrack(db, c.req.param("id"));
    if (!t) return c.json({ error: "No such track" }, 404);
    const ver = t.versions.find((x) => x.v === Number(c.req.param("v")));
    if (!ver) return c.json({ error: "No such version" }, 404);
    ver.liked = !ver.liked;
    await writeSounds(c.env, pid, db);
    return c.json({ ok: true, liked: ver.liked });
  });

  // Delete a single version (removes the track if it was the last one).
  app.delete("/api/sounds/:id/version/:v", async (c) => {
    const pid = c.get("projectId");
    const db = await readSounds(c.env, pid);
    const t = findTrack(db, c.req.param("id"));
    if (!t) return c.json({ error: "No such track" }, 404);
    const ver = t.versions.find((x) => x.v === Number(c.req.param("v")));
    if (!ver) return c.json({ error: "No such version" }, 404);
    // TODO(stage2): delete this version's media file in R2 (ver.file).
    t.versions = t.versions.filter((x) => x.v !== ver.v);
    if (!t.versions.length) db.tracks = db.tracks.filter((x) => x.id !== t.id);
    await writeSounds(c.env, pid, db);
    return c.json({ ok: true });
  });

  // Attach rendered audio to a version — from a remote URL or a local file path.
  // Marks the version ready and records its media file name. The metadata effect
  // is preserved; the actual media copy + duration probe land in later stages.
  app.post("/api/sounds/:id/version/:v/attach", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const { url, localPath } = body || {};
    const db = await readSounds(c.env, pid);
    const t = findTrack(db, c.req.param("id"));
    if (!t) return c.json({ error: "No such track" }, 404);
    const ver = t.versions.find((x) => x.v === Number(c.req.param("v")));
    if (!ver) return c.json({ error: "No such version" }, 404);

    // Derive the destination extension EXACTLY as Express did.
    let ext = ".wav";
    if (localPath) {
      const m = /\.([a-z0-9]+)$/i.exec(localPath);
      ext = m ? "." + m[1] : ".wav";
    } else if (url) {
      const m = /\.(wav|mp3|ogg|opus|m4a|aac)(?:\?|$)/i.exec(url);
      if (m) ext = "." + m[1].toLowerCase();
    } else {
      return c.json({ error: "Provide 'url' or 'localPath'" }, 400);
    }
    const file = `${t.id}_v${ver.v}${ext}`;

    // TODO(stage2): copy media into R2 — download `url` (fetch) or copy
    // `localPath` to the R2 media key for `file`. Until then we only record the
    // metadata linking this version to its (future) media object.

    ver.file = file;
    ver.status = "ready";
    // TODO(stage3): ffprobe via Daytona — probe the real duration of the copied
    // media. Keep whatever is already stored (or 0) for now; do NOT call ffmpeg.
    ver.duration = ver.duration || 0;
    ver.source = url || localPath;
    ver.ts = new Date().toISOString();
    await writeSounds(c.env, pid, db);
    return c.json({ ok: true, version: ver.v, url: "/sound-media/" + file, duration: ver.duration });
  });
}
