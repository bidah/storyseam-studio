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
//                                     prompt, model, refs, shotSnapshot,
//                                     selected, selectedAt } ]   // newest last
//
// Mirrors the episode-video append/select pattern (see episode.js `db.video`),
// but keyed per shot and holding images. Unlike the episode-video attach (which
// records a source URL and waits for /ingest), the attach here downloads the
// bytes into R2 immediately (like /api/higgsfield/import) so the still shows up
// without a second round-trip; on a fetch failure it still records the source
// URL so an /ingest push can land it later.
//
// PROVENANCE (`prompt` / `model` / `refs` / `shotSnapshot`): what the image was
// actually made FROM, captured at attach time. Without it "regenerate with
// edits" can only re-derive intent from the CURRENT shot list and the CURRENT
// reference picks, which is wrong the moment either changes — the Editor's
// "New still…" modal prefills from these fields.
//
// CONCURRENCY: writes go through `updateDoc` (read-modify-write conditional on
// the R2 etag), not readDoc→writeDoc. `selections.json` is a shared doc and the
// agent attaches takes back-to-back when filling a whole bundle or animatic, so
// last-writer-wins silently drops takes. Same reasoning as radio.js.
import { readDoc, updateDoc } from "../lib/docs.js";
import { listMediaSet, putMedia, mediaKey } from "../lib/media.js";

const DB_FALLBACK = { library: {}, episode: {} };
const readDB = (env, pid) => readDoc(env, pid, "selections", DB_FALLBACK);
const updateDB = (env, pid, mutate) => updateDoc(env, pid, "selections", DB_FALLBACK, mutate);

// Normalize a per-shot entry (array | single object | missing) to an array.
const asArray = (entry) => (Array.isArray(entry) ? entry : entry ? [entry] : []);

export function registerStoryboard(app) {
  // All storyboard stills for the project, grouped bundle → shot → takes.
  // Filtered against ONE R2 listing so a stale record (image gone) never shows.
  app.get("/api/storyboard", async (c) => {
    const pid = c.get("projectId");
    const db = await readDB(c.env, pid);
    const stillSet = await listMediaSet(c.env, pid, "storyboard");

    // `url` is the project-scoped `/storyboard-media/<file>` path, which resolves
    // via the request's project header — an image model fetching it sends none,
    // so it would silently read p_default (or 404) instead of this project.
    // `refUrl` is the absolute, un-gated `/files/<r2key>` form that encodes the
    // project in the key, so it's the one to hand a generator as a reference.
    // Same trick, same reason as radio.js's voiceRef.refUrl.
    const publicBase = String(c.env.WORKER_PUBLIC_URL || "").replace(/\/+$/, "");
    const refUrlFor = (file) => (publicBase ? `${publicBase}/files/${mediaKey(pid, "storyboard", file)}` : null);

    const out = {};
    for (const [bundle, shots] of Object.entries(db.stills || {})) {
      const bag = {};
      for (const [shot, entry] of Object.entries(shots || {})) {
        const list = [];
        for (const v of asArray(entry)) {
          if (v && v.file && stillSet.has(v.file)) {
            list.push({
              ...v,
              name: v.name || `still ${list.length + 1}`,
              url: "/storyboard-media/" + v.file,
              refUrl: refUrlFor(v.file),
            });
          }
        }
        if (list.length) bag[shot] = list;
      }
      if (Object.keys(bag).length) out[bundle] = bag;
    }
    return c.json({ stills: out });
  });

  // Attach a generated still to one SHOT of a bundle. APPENDS a new take (keeps
  // prior ones) as storyboard/<bundle>_<shot>_genN_<rand>.png and downloads the
  // bytes into R2 so it renders immediately.
  app.post("/api/storyboard/image", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const { bundle, shot, url, angle, jobId, prompt, model, refs, shotSnapshot } = body || {};
    if (!bundle || !shot || !url) return c.json({ error: "Missing 'bundle', 'shot' or 'url'" }, 400);

    // The take's ordinal (and therefore its filename) depends on how many takes
    // the shot already has, so read that BEFORE fetching the bytes. A racing
    // attach can claim the same ordinal, so the filename also carries a RANDOM
    // suffix: parallel attaches (the agent filling a bundle, or a whole
    // animatic) land in the same millisecond, so a timestamp is not unique
    // enough — two racers would overwrite each other's R2 object and both
    // records would point at one image. The updateDoc mutate below is the
    // authority on the final ordinal/name.
    const existing = asArray((await readDB(c.env, pid)).stills?.[bundle]?.[shot]);
    const n = existing.length + 1;
    const safeShot = String(shot).replace(/[^a-zA-Z0-9._-]/g, "") || `shot${n}`;
    const file = `${bundle}_${safeShot}_gen${n}_${crypto.randomUUID().slice(0, 8)}.png`;

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

    const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
    const take = {
      file,
      angle: str(angle),
      jobId: jobId || null,
      source: url,
      ts: new Date().toISOString(),
      // Provenance — how this image was made (all optional; older takes have none).
      prompt: str(prompt),
      model: str(model),
      refs: Array.isArray(refs)
        ? refs
            .filter((r) => r && (r.key || r.url))
            .map((r) => ({ key: str(r.key), role: str(r.role), url: str(r.url) }))
        : null,
      shotSnapshot:
        shotSnapshot && typeof shotSnapshot === "object"
          ? {
              location: str(shotSnapshot.location),
              camera: str(shotSnapshot.camera),
              action: str(shotSnapshot.action),
              dialogue: str(shotSnapshot.dialogue),
              dur: Number(shotSnapshot.dur) || null,
            }
          : null,
    };

    // `name` is the take's ordinal label, assigned inside the mutate so a racing
    // attach can't hand two takes the same "still 3".
    const { count } = await updateDB(c.env, pid, (db) => {
      db.stills = db.stills || {};
      db.stills[bundle] = db.stills[bundle] || {};
      const list = asArray(db.stills[bundle][shot]);
      list.push({ ...take, name: `still ${list.length + 1}` });
      db.stills[bundle][shot] = list;
      return { count: list.length };
    });

    return c.json({
      ok: true, bundle, shot, file, name: `still ${count}`, count, stored,
      url: "/storyboard-media/" + file,
    });
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
    const res = await updateDB(c.env, pid, (db) => {
      const arr = asArray(db.stills?.[bundle]?.[shot]);
      const g = arr.find((v) => v.file === file);
      if (!g) return { abort: true, missing: true };
      g.selected = !!selected;
      if (g.selected) {
        g.selectedAt = new Date().toISOString();
        arr.forEach((v) => { if (v.file !== file) v.selected = false; });
      }
      db.stills = db.stills || {};
      db.stills[bundle] = db.stills[bundle] || {};
      db.stills[bundle][shot] = arr;
      return { selected: g.selected };
    });
    if (res.missing) return c.json({ error: "Still not found" }, 404);
    return c.json({ ok: true, bundle, shot, file, selected: res.selected });
  });
}
