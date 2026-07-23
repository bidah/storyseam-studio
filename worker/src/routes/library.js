// Library / Shots / Multishot endpoints, ported from server/index.js
// (/api/library*, /api/shots*, /api/multishot). These three groups are all
// media-LISTING feature-changes: in Express they SCANNED a local media monorepo
// (fs.readdirSync over the repo + build-artifact .txt files). There is no repo on
// the Worker — media now lives in R2 under `media/<projectId>/...` — so they are
// re-backed by R2 listings (`listMedia` / `BUCKET.list`) and the JSON doc store.
//
// Doc store: `state/<projectId>/selections.json` holds `db.library` (a map
// rel->true of picked asset-library images). The multishot manifest and the
// shots metadata live in their own docs (`multishot` / `shots`).
//
// MEDIA NOTE: media URLs stay EXACTLY as Express emitted them
// (`/asset/<rel>`, `/media/<file>`, `/multishot-media/<file>`) — the `/asset/*`,
// `/media/*`, `/multishot-media/*` streaming routes serve the R2 objects. See the
// TODO(stage2) markers for the media-copy / build-file work still owed.
import { normalizeProjectId, readDoc, writeDoc } from "../lib/docs.js";
import { listMedia, listProxies, proxyKey, assetRefUrl } from "../lib/media.js";
import { ensureAssetThumbs } from "../lib/proxy.js";

// The de-facto selections DB (library picks + per-bundle episode selections).
const readDB = (env, pid) => readDoc(env, pid, "selections", { library: {}, episode: {} });
const writeDB = (env, pid, db) => writeDoc(env, pid, "selections", db);

// Image extensions accepted in the browsable asset library (was IMG_RE).
const IMG_RE = /\.(png|jpe?g|webp|gif)$/i;

// Sanitize a client-supplied rel: strip leading slashes + parent-traversal, so a
// crafted `rel` can never escape the asset prefix (was safeAbs against the repo).
const cleanRel = (rel) =>
  String(rel || "").replace(/^\/+/, "").replace(/\.\.(\/|\\|$)/g, "");

// The R2 key of a browsable asset-library image (served at `/asset/<rel>`).
const assetKey = (pid, rel) => `media/${normalizeProjectId(pid)}/asset/${cleanRel(rel)}`;

// Resolve a client-supplied rel to an EXISTING library asset. Callers (the flue
// agent especially) don't always send the bare `rel` — they send the `url`
// (`/asset/<rel>`), the `thumb` (`/thumb/<rel>`), the absolute `refUrl`
// (`https://…/files/media/<pid>/asset/<rel>`), a URL-encoded rel, or just the
// file's basename. Try the exact rel first (so legit rels that happen to start
// with e.g. `asset/` still win), then the stripped/decoded variants, then fall
// back to a unique-basename match against the full asset listing.
// Returns the canonical rel, or null when nothing matches.
async function resolveAssetRel(env, pid, raw) {
  const safePid = normalizeProjectId(pid);
  let r = String(raw || "").trim().replace(/^https?:\/\/[^/]+/i, "");
  const candidates = [];
  const push = (v) => {
    const c = cleanRel(v);
    if (c && !candidates.includes(c)) candidates.push(c);
  };
  push(r);
  const stripped = cleanRel(r);
  for (const prefix of [`files/media/${safePid}/asset/`, `media/${safePid}/asset/`, "asset/", "thumb/"]) {
    if (stripped.startsWith(prefix)) push(stripped.slice(prefix.length));
  }
  for (const c of candidates.slice()) {
    try { push(decodeURIComponent(c)); } catch { /* not URL-encoded */ }
  }
  for (const c of candidates) {
    if (await env.BUCKET.head(`media/${safePid}/asset/${c}`)) return c;
  }
  // Last resort: a unique basename match across the library.
  const base = baseOf(candidates[0] || "");
  if (base && IMG_RE.test(base)) {
    const matches = (await listAssets(env, pid)).filter((rel) => baseOf(rel) === base);
    if (matches.length === 1) return matches[0];
  }
  return null;
}

const badPath = (c, pid, rel) =>
  c.json({
    error: `Bad path: no library image "${rel}" in project ${normalizeProjectId(pid)}. Call list_library (GET /api/library) and pass the image's \`rel\` exactly as listed (not its url/thumb/refUrl).`,
  }, 400);

// Directory portion of a rel ("a/b/img.png" -> "a/b"; "img.png" -> "." as Node's
// path.dirname did, which the Express handler used as the folder key).
const dirOf = (rel) => {
  const i = rel.lastIndexOf("/");
  return i === -1 ? "." : rel.slice(0, i);
};
const baseOf = (rel) => {
  const i = rel.lastIndexOf("/");
  return i === -1 ? rel : rel.slice(i + 1);
};

// List every browsable asset-library image (rel = key sans `media/<pid>/asset/`).
// Replaces the Express recursive fs scan of the repo (scanLibrary()).
async function listAssets(env, pid) {
  const prefix = `media/${normalizeProjectId(pid)}/asset/`;
  const out = [];
  let cursor;
  do {
    const res = await env.BUCKET.list({ prefix, cursor, limit: 1000 });
    for (const o of res.objects) {
      const rel = o.key.slice(prefix.length);
      if (rel && IMG_RE.test(rel)) out.push(rel);
    }
    cursor = res.truncated ? res.cursor : undefined;
  } while (cursor);
  return out;
}

// --- /api/shots take reconstruction ----------------------------------------
// Group the R2 media listing under `media/<pid>/shots/` by shot id and parse the
// versioned take file names EXACTLY as Express's buildShots() did. Each listed
// name is the key sans `media/<pid>/shots/` (e.g. "shot01/takes/..._speech...mp3"
// or the flat "shot01/shot01_audio.mp3"); its served URL is `/media/<name>`.
function takesForShot(files, id) {
  const speechTakes = [];
  const vfxTakes = [];
  const videoTakes = [];
  const takePrefix = `shot${id}/takes/`;
  for (const rel of files) {
    if (!rel.startsWith(takePrefix)) continue;
    const f = rel.slice(takePrefix.length);
    if (f.includes("/")) continue; // takes are flat inside the takes/ dir
    let m;
    if ((m = /_speech_take(\d+)_([0-9-]+)\.mp3$/.exec(f))) {
      speechTakes.push({ take: Number(m[1]), ts: m[2], title: f, url: `/media/${rel}` });
    } else if ((m = /_vfx_take(\d+)_([0-9-]+)\.mp3$/.exec(f))) {
      vfxTakes.push({ take: Number(m[1]), ts: m[2], title: f, url: `/media/${rel}` });
    } else if ((m = /_(lipsync|withvfx|final)_take(\d+)_([0-9-]+)\.mp4$/i.exec(f))) {
      videoTakes.push({ take: Number(m[2]), ts: m[3], variant: m[1].toLowerCase(), title: f, url: `/media/${rel}` });
    }
  }
  speechTakes.sort((a, b) => b.take - a.take);
  vfxTakes.sort((a, b) => b.take - a.take);
  videoTakes.sort((a, b) => b.take - a.take || a.variant.localeCompare(b.variant));

  // Fallback: a shot with only a flat audio/video file shows it as take 1.
  const flatAudio = `shot${id}/shot${id}_audio.mp3`;
  const flatVideo = `shot${id}/shot${id}_FINAL.mp4`;
  if (speechTakes.length === 0 && files.includes(flatAudio))
    speechTakes.push({ take: 1, ts: null, title: `shot${id}_audio.mp3`, url: `/media/${flatAudio}` });
  if (videoTakes.length === 0 && files.includes(flatVideo))
    videoTakes.push({ take: 1, ts: null, variant: "final", title: `shot${id}_FINAL.mp4`, url: `/media/${flatVideo}` });

  return { speechTakes, vfxTakes, videoTakes };
}

export function registerLibrary(app) {
  // -------------------------------------------------------------------------
  // Library — the browsable asset image library, grouped into folders, with
  // per-image `selected` from db.library.
  // -------------------------------------------------------------------------
  app.get("/api/library", async (c) => {
    const pid = c.get("projectId");
    const db = await readDB(c.env, pid);
    const rels = await listAssets(c.env, pid);

    // Small-thumb backfill: grids render `/thumb/<rel>` (tiny webp under
    // media/<pid>/proxy/asset/) instead of the full-res original. Diff assets
    // against existing thumbs and batch-generate the missing ones in the
    // background; /thumb/* serves originals until they land.
    const thumbs = new Set(await listProxies(c.env, pid, "asset"));
    const missing = rels.filter((r) => !thumbs.has(r));
    if (missing.length) c.executionCtx.waitUntil(ensureAssetThumbs(c.env, pid, missing));

    // Group by containing folder (Node path.dirname of the rel), matching Express.
    const folders = new Map(); // dir -> [{ rel, name }]
    for (const rel of rels) {
      const dir = dirOf(rel);
      if (!folders.has(dir)) folders.set(dir, []);
      folders.get(dir).push({ rel, name: baseOf(rel) });
    }

    const list = [...folders.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([dir, imgs]) => {
        const sorted = imgs.slice().sort((a, b) => a.name.localeCompare(b.name));
        return {
          folder: dir,
          count: sorted.length,
          preview: "/thumb/" + sorted[0].rel,
          images: sorted.map((im) => ({
            rel: im.rel,
            name: im.name,
            url: "/asset/" + im.rel,
            thumb: "/thumb/" + im.rel,
            // Absolute ungated `/files/...` URL for an anonymous external fetcher
            // (the flue agent feeds this to Higgsfield `media_import_url` to use a
            // library image as a reference — the relative `url` isn't fetchable).
            refUrl: assetRefUrl(c.env, pid, im.rel),
            // NOTE: Express also emitted `abs` (the on-disk absolute path). There
            // is no filesystem on the Worker, so `abs` is intentionally dropped.
            selected: !!db.library[im.rel],
          })),
        };
      });
    return c.json({ folders: list });
  });

  // Import a chat upload (POST /upload → `chat-uploads/<uuid>-<name>` in R2)
  // into the project asset library, returning its library `rel`. This is the
  // upload twin of /api/visual-world/save-to-library: surfaces that need a
  // library rel (episode reference picks, sheet links) can accept an image the
  // user just uploaded through the shared MediaPicker.
  app.post("/api/library/import", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const key = String(body?.key || "");
    if (!/^chat-uploads\/[^/]+$/.test(key)) return c.json({ error: "Invalid upload 'key'" }, 400);
    const obj = await c.env.BUCKET.get(key);
    if (!obj) return c.json({ error: "Upload not found" }, 404);
    const dir = String(body?.folder || "uploads").replace(/[^a-zA-Z0-9._/-]/g, "").replace(/^\/+|\/+$/g, "") || "uploads";
    // Original filename = the key minus its `<uuid>-` prefix (see safeName in index.js).
    const orig = key.slice("chat-uploads/".length).replace(/^[0-9a-f-]{36}-/, "");
    const ext = (/\.([a-zA-Z0-9]+)$/.exec(orig) || [, "png"])[1];
    const base = (String(body?.name || "").replace(/[^a-zA-Z0-9._-]/g, "") || orig).replace(/\.[^.]*$/, "");
    const rel = `${dir}/${base}.${ext}`;
    const safePid = normalizeProjectId(pid);
    await c.env.BUCKET.put(`media/${safePid}/asset/${rel}`, obj.body, {
      httpMetadata: { contentType: obj.httpMetadata?.contentType || "image/png" },
    });
    return c.json({ ok: true, rel, name: `${base}.${ext}`, folder: dir, url: `/asset/${rel}` });
  });

  // Toggle a source image's membership in the final_selection set. Verbatim db
  // mutation from Express; the physical copy into the final pool is deferred.
  app.post("/api/library/toggle", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    if (typeof body?.rel !== "string") return c.json({ error: "Missing 'rel'" }, 400);
    // Mirror Express's "Bad path" guard: the source asset must exist in R2 —
    // but resolve tolerant rel shapes (url/thumb/refUrl/encoded) first.
    const rel = await resolveAssetRel(c.env, pid, body.rel);
    if (!rel) return badPath(c, pid, body.rel);

    const db = await readDB(c.env, pid);
    db.library = db.library || {};
    let selected;
    if (db.library[rel]) {
      // deselect: drop from db.library and from any per-bundle episode picks.
      delete db.library[rel];
      for (const k of Object.keys(db.episode || {})) {
        db.episode[k] = (db.episode[k] || []).filter((r) => r !== rel);
      }
      // TODO(stage2): remove the copied image from the final_selection R2 pool
      // (Express did fs.rmSync(dest) — the flattened final/<rel> media object).
      selected = false;
    } else {
      db.library[rel] = true;
      // TODO(stage2): copy the asset into the final_selection R2 pool (Express
      // did fs.copyFileSync(src, final/<flatten(rel)>) so it shows in /api/final).
      selected = true;
    }
    await writeDB(c.env, pid, db);
    return c.json({ ok: true, rel, selected });
  });

  // Drop a rel from db.library + every per-bundle episode pick (shared by
  // remove; mirrors the deselect branch of /toggle).
  const deselectRel = async (env, pid, rel) => {
    const db = await readDB(env, pid);
    if (!db.library?.[rel]) return;
    delete db.library[rel];
    for (const k of Object.keys(db.episode || {})) {
      db.episode[k] = (db.episode[k] || []).filter((r) => r !== rel);
    }
    await writeDB(env, pid, db);
  };

  // Delete an asset image from the library outright: the R2 original + its
  // thumb, plus its final_selection / episode membership if it was selected.
  app.post("/api/library/remove", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    if (typeof body?.rel !== "string") return c.json({ error: "Missing 'rel'" }, 400);
    const rel = await resolveAssetRel(c.env, pid, body.rel);
    if (!rel) return badPath(c, pid, body.rel);
    const key = assetKey(pid, rel);

    await c.env.BUCKET.delete(key);
    await c.env.BUCKET.delete(proxyKey(pid, "asset", rel));
    await deselectRel(c.env, pid, rel);
    return c.json({ ok: true, rel });
  });

  // Rename an asset image (same folder, new basename) so assets can carry
  // meaningful names — e.g. the character they show — instead of the opaque
  // Higgsfield delivery file names. Moves the R2 original + thumb and rewrites
  // the rel inside db.library / episode picks so selections survive the rename.
  app.post("/api/library/rename", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const { name } = body || {};
    if (typeof body?.rel !== "string" || typeof name !== "string" || !name.trim())
      return c.json({ error: "Missing 'rel'/'name'" }, 400);
    const rel = await resolveAssetRel(c.env, pid, body.rel);
    if (!rel) return badPath(c, pid, body.rel);

    // One filesystem-tame basename segment (mirrors cleanSeg in higgsfield.js);
    // keep the original extension when the new name doesn't spell one.
    let base = name
      .replace(/[^A-Za-z0-9 ._-]/g, "_")
      .replace(/^[. ]+|[. ]+$/g, "")
      .slice(0, 80)
      .trim();
    if (!IMG_RE.test(base)) {
      const ext = (IMG_RE.exec(baseOf(rel)) || [""])[0];
      base += ext;
    }
    if (!base || !IMG_RE.test(base)) return c.json({ error: "Not an image name" }, 400);

    const dir = dirOf(rel);
    const newRel = dir === "." ? base : `${dir}/${base}`;
    if (newRel === rel) return c.json({ ok: true, rel: newRel, name: base });

    const oldKey = assetKey(pid, rel);
    const newKey = assetKey(pid, newRel);
    const obj = await c.env.BUCKET.get(oldKey);
    if (!obj) return badPath(c, pid, rel);
    if (await c.env.BUCKET.head(newKey)) return c.json({ error: "An image with that name already exists" }, 409);

    await c.env.BUCKET.put(newKey, obj.body, { httpMetadata: obj.httpMetadata });
    await c.env.BUCKET.delete(oldKey);

    // Move the thumb too (best-effort — ensureAssetThumbs regenerates if lost).
    const th = await c.env.BUCKET.get(proxyKey(pid, "asset", rel));
    if (th) {
      await c.env.BUCKET.put(proxyKey(pid, "asset", newRel), th.body, { httpMetadata: th.httpMetadata });
      await c.env.BUCKET.delete(proxyKey(pid, "asset", rel));
    }

    const db = await readDB(c.env, pid);
    if (db.library?.[rel]) {
      delete db.library[rel];
      db.library[newRel] = true;
      for (const k of Object.keys(db.episode || {})) {
        db.episode[k] = (db.episode[k] || []).map((r) => (r === rel ? newRel : r));
      }
      await writeDB(c.env, pid, db);
    }
    return c.json({ ok: true, rel: newRel, name: base });
  });

  // -------------------------------------------------------------------------
  // Shots — per-shot Seedance/Seedaudio prompts + versioned takes.
  //
  // In Express this scanned `shot-by-shot/shots/shotNN/` folders for takes and
  // parsed TWO monorepo .txt build files (the whole-episode Seedance shotlist +
  // the Seedaudio segment prompt) via seedanceBlocks()/seedaudioSegments(). Those
  // .txt build files DO NOT EXIST in R2, so their derived fields (seedanceText,
  // audioText, audioSegment/label) can only come from a `shots` doc if one was
  // seeded — otherwise they degrade to empty. Takes are re-derived from the R2
  // media listing under `media/<pid>/shots/`.
  // -------------------------------------------------------------------------
  app.get("/api/shots", async (c) => {
    const pid = c.get("projectId");
    const doc = await readDoc(c.env, pid, "shots", null);
    if (!doc) return c.json({ shots: [] });

    // Accept either a bare array or a { shots: [...] } document.
    const shotsIn = Array.isArray(doc) ? doc : Array.isArray(doc.shots) ? doc.shots : [];
    if (!shotsIn.length) return c.json({ shots: [] });

    const files = await listMedia(c.env, pid, "shots");
    const shots = shotsIn.map((s) => {
      const id = String(s.id);
      const { speechTakes, vfxTakes, videoTakes } = takesForShot(files, id);
      // seedanceText / audioText / segment fields come from the doc when present
      // (the .txt build files they used to be parsed from are gone in R2).
      // TODO(stage2): if the Seedance shotlist / Seedaudio prompt are ever
      // re-homed into R2 (as docs or media), repopulate these from there.
      const seedanceText = typeof s.seedanceText === "string" ? s.seedanceText : "";
      const perShotAudio = typeof s.audioText === "string" ? s.audioText : null;
      return {
        id,
        seedanceText,
        seedanceFound: !!seedanceText,
        audioText: perShotAudio != null ? perShotAudio : "",
        audioFound: perShotAudio != null,
        audioPerShot: perShotAudio != null,
        audioSegment: s.audioSegment ?? null,
        audioSegmentLabel: s.audioSegmentLabel ?? null,
        audioUrl: speechTakes[0] ? speechTakes[0].url : null,
        videoUrl: videoTakes[0] ? videoTakes[0].url : null,
        speechTakes,
        vfxTakes,
        videoTakes,
      };
    });
    return c.json({ shots });
  });

  // Edit a shot's Seedance prompt.
  //
  // LEGACY / FLAGGED: in Express this was a BUILD-FILE editor — it rewrote the
  // matching `SHOT: NN` block inside the monorepo `whistlewood_s1_15s_seedance_
  // shotlist.txt` on disk. That .txt build file does not exist in R2. Ported here
  // to update the `shots` doc's per-shot `seedanceText` instead. If the Seedance
  // shotlist is not managed via this doc, this endpoint no longer applies — flag
  // for a decision (see report).
  app.put("/api/shots/:id/seedance", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const { text } = body || {};
    if (typeof text !== "string") return c.json({ error: "Missing 'text'" }, 400);
    const doc = (await readDoc(c.env, pid, "shots", null)) || { shots: [] };
    const shots = Array.isArray(doc) ? doc : (doc.shots = doc.shots || []);
    const shot = shots.find((s) => String(s.id) === String(c.req.param("id")));
    if (!shot) return c.json({ error: `No such shot ${c.req.param("id")}` }, 404);
    shot.seedanceText = text.replace(/\r\n/g, "\n").replace(/\s+$/, "");
    await writeDoc(c.env, pid, "shots", doc);
    return c.json({ ok: true });
  });

  // Edit a shot's Seedaudio prompt.
  //
  // LEGACY / FLAGGED: in Express this wrote a per-shot `shotNN_audio_prompt.txt`
  // file (or, as a fallback, rewrote the shared SEGMENT block in the monorepo
  // Seedaudio .txt). Neither build file exists in R2. Ported here to update the
  // `shots` doc's per-shot `audioText` instead — same flag as above.
  app.put("/api/shots/:id/audio", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const { text } = body || {};
    if (typeof text !== "string") return c.json({ error: "Missing 'text'" }, 400);
    const doc = (await readDoc(c.env, pid, "shots", null)) || { shots: [] };
    const shots = Array.isArray(doc) ? doc : (doc.shots = doc.shots || []);
    const shot = shots.find((s) => String(s.id) === String(c.req.param("id")));
    if (!shot) return c.json({ error: `No such shot ${c.req.param("id")}` }, 404);
    shot.audioText = text.replace(/\r\n/g, "\n").replace(/\s+$/, "");
    await writeDoc(c.env, pid, "shots", doc);
    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // Multishot — the standalone S1 shots-1-4 manifest (images/audio/generations).
  // Read from the `multishot` doc (was multishot-s1-shots1-4/multishot.json).
  // -------------------------------------------------------------------------
  app.get("/api/multishot", async (c) => {
    const pid = c.get("projectId");
    const manifest = await readDoc(c.env, pid, "multishot", null);
    if (!manifest) return c.json({ multishot: null });

    // Rewrite media file names to served URLs (`/multishot-media/<file>`).
    const toUrl = (file) => (file ? `/multishot-media/${file}` : null);
    const images = (manifest.images || []).map((m) => ({ ...m, url: toUrl(m.file) }));
    const audio = (manifest.audio || []).map((m) => ({ ...m, url: toUrl(m.file) }));

    // Each generation's video → served URL; drop entries whose video file is gone
    // (Express did fs.existsSync; here we check the R2 multishot media listing).
    const present = new Set(await listMedia(c.env, pid, "multishot"));
    const generations = (manifest.generations || [])
      .map((g) => ({ ...g, videoUrl: toUrl(g.video) }))
      .filter((g) => (g.video ? present.has(g.video) : true));

    return c.json({ multishot: { ...manifest, images, audio, generations } });
  });
}
