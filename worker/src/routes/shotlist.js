// Shot-list endpoints, ported from server/index.js (/api/shotlist*). Backed by
// the R2 doc store `state/<projectId>/shotlist.json` instead of a local file.
// The episode manifest (for the "rebuild from episode" seed) is likewise an R2
// doc `state/<projectId>/episode-manifest.json`.
import { readDoc, writeDoc } from "../lib/docs.js";
import { normalizeShot } from "../lib/shots.js";
import { packPreview } from "../lib/pack.js";

async function readShotlist(env, pid) {
  const obj = await readDoc(env, pid, "shotlist", null);
  if (!obj) return { generatedAt: null, source: null, shots: [] };
  return { ...obj, shots: (obj.shots || []).map(normalizeShot) };
}
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

export function registerShotlist(app) {
  // Read the shot list (auto-seeding from the episode on first use) + packs.
  app.get("/api/shotlist", async (c) => {
    const pid = c.get("projectId");
    let sl = await readShotlist(c.env, pid);
    if (!sl.shots.length) {
      const rebuilt = await rebuildShotlistFromEpisode(c.env, pid);
      if (rebuilt) sl = rebuilt;
    }
    return c.json({ ...sl, packs: packPreview(sl.shots) });
  });

  // Replace the whole shot list (agent save_shotlist, or a bulk UI save).
  app.post("/api/shotlist", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON body" }, 400); }
    const { shots, source } = body || {};
    if (!Array.isArray(shots)) return c.json({ error: "shots[] required" }, 400);
    const obj = { generatedAt: new Date().toISOString(), source: source || "agent", shots: shots.map(normalizeShot) };
    await writeShotlist(c.env, pid, obj);
    return c.json({ ok: true, count: obj.shots.length, packs: packPreview(obj.shots) });
  });

  // Edit one shot in place.
  app.put("/api/shotlist/shot/:n", async (c) => {
    const pid = c.get("projectId");
    const n = Number(c.req.param("n"));
    const sl = await readShotlist(c.env, pid);
    const idx = sl.shots.findIndex((s) => s.n === n);
    if (idx < 0) return c.json({ error: `no shot ${n}` }, 404);
    let patch;
    try { patch = await c.req.json(); } catch { patch = {}; }
    sl.shots[idx] = normalizeShot({ ...sl.shots[idx], ...patch }, idx);
    await writeShotlist(c.env, pid, sl);
    return c.json({ ok: true, shot: sl.shots[idx], packs: packPreview(sl.shots) });
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
