// Storyboard endpoints (/api/storyboard*). The storyboard is the still-image
// stage that precedes video generation: one generated still per SHOT inside an
// episode bundle, with multiple takes per shot so different camera angles can be
// compared and one selected. It shares the Episode tab (Images mode).
//
// Backed by the same de-facto DB doc as episodes (`state/<pid>/selections.json`)
// under a new `stills` map, and R2 image bytes under the `storyboard` media kind
// (served at `/storyboard-media/<file>`):
//
//   db.stills[bundleId][shotId] = [ { file, name, angle, jobId, source, ts,
//                                     selected, selectedAt } ]   // newest last
//
// Mirrors the episode-video append/select pattern (see episode.js `db.video`),
// but keyed per shot and holding images. Unlike the episode-video attach (which
// records a source URL and waits for /ingest), the attach here downloads the
// bytes into R2 immediately (like /api/higgsfield/import) so the still shows up
// without a second round-trip; on a fetch failure it still records the source
// URL so an /ingest push can land it later.
import { readDoc, writeDoc } from "../lib/docs.js";
import { listMediaSet, putMedia } from "../lib/media.js";

const readDB = (env, pid) => readDoc(env, pid, "selections", { library: {}, episode: {} });
const writeDB = (env, pid, db) => writeDoc(env, pid, "selections", db);

// Normalize a per-shot entry (array | single object | missing) to an array.
const asArray = (entry) => (Array.isArray(entry) ? entry : entry ? [entry] : []);

export function registerStoryboard(app) {
  // All storyboard stills for the project, grouped bundle → shot → takes.
  // Filtered against ONE R2 listing so a stale record (image gone) never shows.
  app.get("/api/storyboard", async (c) => {
    const pid = c.get("projectId");
    const db = await readDB(c.env, pid);
    const stillSet = await listMediaSet(c.env, pid, "storyboard");
    const out = {};
    for (const [bundle, shots] of Object.entries(db.stills || {})) {
      const bag = {};
      for (const [shot, entry] of Object.entries(shots || {})) {
        const list = [];
        for (const v of asArray(entry)) {
          if (v && v.file && stillSet.has(v.file)) {
            list.push({ ...v, name: v.name || `still ${list.length + 1}`, url: "/storyboard-media/" + v.file });
          }
        }
        if (list.length) bag[shot] = list;
      }
      if (Object.keys(bag).length) out[bundle] = bag;
    }
    return c.json({ stills: out });
  });

  // Attach a generated still to one SHOT of a bundle. APPENDS a new take (keeps
  // prior ones) as storyboard/<bundle>_<shot>_genN.png and downloads the bytes
  // into R2 so it renders immediately.
  app.post("/api/storyboard/image", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const { bundle, shot, url, angle, jobId } = body || {};
    if (!bundle || !shot || !url) return c.json({ error: "Missing 'bundle', 'shot' or 'url'" }, 400);
    const db = await readDB(c.env, pid);
    db.stills = db.stills || {};
    db.stills[bundle] = db.stills[bundle] || {};
    const list = asArray(db.stills[bundle][shot]);
    const n = list.length + 1;
    const safeShot = String(shot).replace(/[^a-zA-Z0-9._-]/g, "") || `shot${n}`;
    const file = `${bundle}_${safeShot}_gen${n}.png`;

    // Download the image into R2 (like /api/higgsfield/import). On failure keep
    // going and record just the source URL — an /ingest PUT to the same key can
    // land it later, and GET /api/storyboard filters out records with no object.
    let stored = false;
    try {
      const res = await fetch(url);
      if (res.ok) {
        const ct = res.headers.get("content-type") || "image/png";
        await putMedia(c.env, pid, "storyboard", file, await res.arrayBuffer(), ct);
        stored = true;
      }
    } catch { /* fall back to source URL */ }

    list.push({
      file,
      name: `still ${n}`,
      angle: (typeof angle === "string" && angle.trim()) || null,
      jobId: jobId || null,
      source: url,
      ts: new Date().toISOString(),
    });
    db.stills[bundle][shot] = list;
    await writeDB(c.env, pid, db);
    return c.json({ ok: true, bundle, shot, name: `still ${n}`, count: list.length, stored, url: "/storyboard-media/" + file });
  });

  // Mark one still take as the selected one for its shot. Single-selection:
  // picking a take clears any other selected take in the same shot and stamps
  // when it was picked (so the most recent pick wins if stale flags linger).
  app.post("/api/storyboard/select", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const { bundle, shot, file, selected } = body || {};
    if (!bundle || !shot || !file) return c.json({ error: "Missing 'bundle', 'shot' or 'file'" }, 400);
    const db = await readDB(c.env, pid);
    const arr = asArray(db.stills?.[bundle]?.[shot]);
    const g = arr.find((v) => v.file === file);
    if (!g) return c.json({ error: "Still not found" }, 404);
    g.selected = !!selected;
    if (g.selected) {
      g.selectedAt = new Date().toISOString();
      arr.forEach((v) => { if (v.file !== file) v.selected = false; });
    }
    db.stills = db.stills || {};
    db.stills[bundle] = db.stills[bundle] || {};
    db.stills[bundle][shot] = arr;
    await writeDB(c.env, pid, db);
    return c.json({ ok: true, bundle, shot, file, selected: g.selected });
  });
}
