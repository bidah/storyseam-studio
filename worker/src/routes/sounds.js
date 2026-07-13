// Sound Studio endpoints, ported from server/index.js (/api/sounds*). Backed by
// the R2 doc store `state/<projectId>/sounds.json` (was `sounds.json` on disk).
//
// Sound Studio is a standalone audio library. Each "track" holds ordered
// versions; editing a prompt saves a NEW version (which starts "pending"). The
// agent renders pending versions with Seed Audio, then attaches the audio:
// attach downloads the rendered file into R2 (`media/<pid>/sound-media/…`) and
// only then flips the version "ready" — a version must never read ready while
// its media object is missing. Duration comes from the WAV header (0 =
// unknown for non-WAV; a real ffprobe via Daytona is still TODO).
//
// All metadata mutations go through updateDoc (etag-conditional write +
// retry): the agent attaches several versions in quick succession, and plain
// read-modify-write on the single sounds.json doc silently dropped all but
// the last writer's changes.
import { readDoc, updateDoc } from "../lib/docs.js";
import { mediaKey, putMedia } from "../lib/media.js";

const DEFAULT_SOUND_PARAMS = { model: "seed_audio", format: "wav", sample_rate: 48000 };

// Which Sound Studio tab a track belongs to. Stored explicitly on the track;
// tracks created before this field existed fall back to a prompt heuristic in
// the client (see trackKind in src/routes/sounds.jsx).
const TRACK_KINDS = new Set(["music", "sfx", "voice"]);

const AUDIO_TYPES = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
};

const readSounds = (env, pid) => readDoc(env, pid, "sounds", { tracks: [] });
const updateSounds = (env, pid, mutate) => updateDoc(env, pid, "sounds", { tracks: [] }, mutate);

const findTrack = (db, id) => (db.tracks || []).find((t) => t.id === id) || null;
const nextVersion = (t) => t.versions.reduce((m, v) => Math.max(m, v.v), 0) + 1;

// Duration in seconds from a RIFF/WAVE header: data-chunk bytes / byte-rate.
// Returns 0 when the buffer isn't parseable WAV (e.g. mp3) — the UI treats 0
// as "unknown"; playback doesn't depend on it.
function wavDuration(buf) {
  try {
    const dv = new DataView(buf);
    if (dv.getUint32(0) !== 0x52494646 /* RIFF */ || dv.getUint32(8) !== 0x57415645 /* WAVE */)
      return 0;
    let off = 12, byteRate = 0, dataSize = 0;
    while (off + 8 <= dv.byteLength) {
      const chunkId = dv.getUint32(off);
      const size = dv.getUint32(off + 4, true);
      if (chunkId === 0x666d7420 /* "fmt " */) byteRate = dv.getUint32(off + 16, true);
      // Streaming WAVs (ffmpeg pipe output — what the render CDN serves) stamp
      // 0xFFFFFFFF placeholder sizes; clamp to the bytes actually present.
      else if (chunkId === 0x64617461 /* "data" */) dataSize = Math.min(size, dv.byteLength - off - 8);
      off += 8 + size + (size % 2); // chunks are word-aligned
    }
    return byteRate && dataSize ? Math.round((dataSize / byteRate) * 100) / 100 : 0;
  } catch {
    return 0;
  }
}

const deleteMedia = (env, pid, files) =>
  files.length
    ? env.BUCKET.delete(files.map((f) => mediaKey(pid, "sound-media", f)))
    : Promise.resolve();

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
    const { name, prompt, params, kind } = body || {};
    if (typeof prompt !== "string" || !prompt.trim())
      return c.json({ error: "Missing 'prompt'" }, 400);
    if (!TRACK_KINDS.has(kind))
      return c.json({ error: "Missing 'kind' — must be 'music', 'sfx', or 'voice' (picks the Sound Studio tab)" }, 400);
    const res = await updateSounds(c.env, pid, (db) => {
      db.seq = (db.seq || 0) + 1;
      const now = new Date().toISOString();
      const track = {
        id: `trk_${db.seq}`,
        name: (name && name.trim()) || `sound ${db.seq}`,
        kind,
        createdAt: now,
        versions: [{
          v: 1, prompt: prompt.trim(), name: null, file: null,
          status: "pending", liked: false, params: params || DEFAULT_SOUND_PARAMS, ts: now,
        }],
      };
      db.tracks = db.tracks || [];
      db.tracks.push(track);
      return { track };
    });
    return c.json({ ok: true, track: soundView(res.track) });
  });

  // Rename and/or reclassify a track.
  app.patch("/api/sounds/:id", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const { name, kind } = body || {};
    const res = await updateSounds(c.env, pid, (db) => {
      const t = findTrack(db, c.req.param("id"));
      if (!t) return { abort: true, notFound: "No such track" };
      if (typeof name === "string" && name.trim()) t.name = name.trim();
      if (TRACK_KINDS.has(kind)) t.kind = kind;
      return { track: t };
    });
    if (res.notFound) return c.json({ error: res.notFound }, 404);
    return c.json({ ok: true, track: soundView(res.track) });
  });

  // Delete a track, then its media files.
  app.delete("/api/sounds/:id", async (c) => {
    const pid = c.get("projectId");
    const res = await updateSounds(c.env, pid, (db) => {
      const t = findTrack(db, c.req.param("id"));
      if (!t) return { abort: true, notFound: "No such track" };
      db.tracks = db.tracks.filter((x) => x.id !== t.id);
      // Version audio only — ref files can be shared across tracks.
      return { files: t.versions.map((v) => v.file).filter(Boolean) };
    });
    if (res.notFound) return c.json({ error: res.notFound }, 404);
    await deleteMedia(c.env, pid, res.files);
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
    const res = await updateSounds(c.env, pid, (db) => {
      const t = findTrack(db, c.req.param("id"));
      if (!t) return { abort: true, notFound: "No such track" };
      const prev = t.versions[t.versions.length - 1];
      const v = nextVersion(t);
      t.versions.push({
        v, prompt: prompt.trim(), name: (name && name.trim()) || null, file: null,
        status: "pending", liked: false, params: params || prev?.params || DEFAULT_SOUND_PARAMS,
        ts: new Date().toISOString(),
      });
      return { v, track: t };
    });
    if (res.notFound) return c.json({ error: res.notFound }, 404);
    return c.json({ ok: true, version: res.v, track: soundView(res.track) });
  });

  // Edit a version in place (prompt and/or name) WITHOUT creating a new version.
  app.patch("/api/sounds/:id/version/:v", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const { prompt, name } = body || {};
    const res = await updateSounds(c.env, pid, (db) => {
      const t = findTrack(db, c.req.param("id"));
      if (!t) return { abort: true, notFound: "No such track" };
      const ver = t.versions.find((x) => x.v === Number(c.req.param("v")));
      if (!ver) return { abort: true, notFound: "No such version" };
      if (typeof prompt === "string") ver.prompt = prompt;
      if (typeof name === "string") ver.name = name.trim() || null;
      return { track: t };
    });
    if (res.notFound) return c.json({ error: res.notFound }, 404);
    return c.json({ ok: true, track: soundView(res.track) });
  });

  // Toggle a version's "like".
  app.post("/api/sounds/:id/version/:v/like", async (c) => {
    const pid = c.get("projectId");
    const res = await updateSounds(c.env, pid, (db) => {
      const t = findTrack(db, c.req.param("id"));
      if (!t) return { abort: true, notFound: "No such track" };
      const ver = t.versions.find((x) => x.v === Number(c.req.param("v")));
      if (!ver) return { abort: true, notFound: "No such version" };
      ver.liked = !ver.liked;
      return { liked: ver.liked };
    });
    if (res.notFound) return c.json({ error: res.notFound }, 404);
    return c.json({ ok: true, liked: res.liked });
  });

  // Delete a single version (removes the track if it was the last one), then
  // its media file.
  app.delete("/api/sounds/:id/version/:v", async (c) => {
    const pid = c.get("projectId");
    const res = await updateSounds(c.env, pid, (db) => {
      const t = findTrack(db, c.req.param("id"));
      if (!t) return { abort: true, notFound: "No such track" };
      const ver = t.versions.find((x) => x.v === Number(c.req.param("v")));
      if (!ver) return { abort: true, notFound: "No such version" };
      t.versions = t.versions.filter((x) => x.v !== ver.v);
      if (!t.versions.length) db.tracks = db.tracks.filter((x) => x.id !== t.id);
      return { files: ver.file ? [ver.file] : [] };
    });
    if (res.notFound) return c.json({ error: res.notFound }, 404);
    await deleteMedia(c.env, pid, res.files);
    return c.json({ ok: true });
  });

  // Attach rendered audio to a version: download the source URL into R2, probe
  // the duration from the WAV header, and mark the version ready. The Express
  // server also accepted a `localPath`; the Worker has no filesystem, so that
  // now fails loudly instead of recording metadata for media that never lands.
  app.post("/api/sounds/:id/version/:v/attach", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const { url, localPath } = body || {};
    if (!url) {
      const error = localPath
        ? "localPath is not supported on the Worker backend — pass a public 'url'"
        : "Provide 'url'";
      return c.json({ error }, 400);
    }
    const id = c.req.param("id");
    const vNum = Number(c.req.param("v"));

    // Cheap existence check before the download; the authoritative re-check
    // happens inside the conditional update below.
    const db = await readSounds(c.env, pid);
    const t = findTrack(db, id);
    if (!t) return c.json({ error: "No such track" }, 404);
    if (!t.versions.find((x) => x.v === vNum)) return c.json({ error: "No such version" }, 404);

    const m = /\.(wav|mp3|ogg|opus|m4a|aac)(?:\?|$)/i.exec(url);
    const ext = m ? "." + m[1].toLowerCase() : ".wav";
    const file = `${id}_v${vNum}${ext}`;

    // Copy the media into R2 BEFORE flipping any metadata — a version must
    // never read "ready" while its media object is missing.
    let buf;
    try {
      const src = await fetch(url);
      if (!src.ok) return c.json({ error: `Source fetch failed (HTTP ${src.status})` }, 502);
      buf = await src.arrayBuffer();
    } catch (e) {
      return c.json({ error: `Source fetch failed: ${e.message}` }, 502);
    }
    if (!buf.byteLength) return c.json({ error: "Source audio is empty" }, 502);
    await putMedia(c.env, pid, "sound-media", file, buf, AUDIO_TYPES[ext] || "application/octet-stream");
    const duration = wavDuration(buf);

    const res = await updateSounds(c.env, pid, (db2) => {
      const t2 = findTrack(db2, id);
      const ver = t2?.versions.find((x) => x.v === vNum);
      if (!ver) return { abort: true, notFound: "Track/version disappeared during attach" };
      ver.file = file;
      ver.status = "ready";
      ver.duration = duration || ver.duration || 0;
      ver.source = url;
      ver.ts = new Date().toISOString();
      return { duration: ver.duration };
    });
    if (res.notFound) return c.json({ error: res.notFound }, 404);
    return c.json({ ok: true, version: vNum, url: "/sound-media/" + file, duration: res.duration });
  });
}
