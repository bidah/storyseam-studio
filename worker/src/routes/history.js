// Version-history endpoints (/api/history/*) over the project JSON doc stores.
//
// Every doc write parks the bytes it replaced (see lib/history.js); these routes
// let the World tab — and the agent — list those versions, read one, and put one
// back. Restoring is itself an ordinary write, so the version you restore OVER
// is parked too: a restore is always undoable.
import { readDoc, writeDoc } from "../lib/docs.js";
import { listSnapshots, readSnapshot } from "../lib/history.js";

// The doc stores a project owns. An allowlist, not a free-form key: `name`
// reaches R2 key construction, and there is no reason to expose more than the
// stores the app actually keeps.
const DOCS = new Set([
  "world",
  "shotlist",
  "sounds",
  "cuts",
  "episode",
  "visual-world",
  "radio",
  "stills",
  "multishot",
  "timeline",
  "library",
]);

export function registerHistory(app) {
  // List the stored versions of one doc, newest first.
  app.get("/api/history/:name", async (c) => {
    const name = c.req.param("name");
    if (!DOCS.has(name)) return c.json({ error: `no history for "${name}"` }, 404);
    const pid = c.get("projectId");
    const snapshots = await listSnapshots(c.env, pid, name);
    return c.json({ name, snapshots });
  });

  // Read one stored version (for a preview / diff before restoring).
  app.get("/api/history/:name/:ts", async (c) => {
    const name = c.req.param("name");
    if (!DOCS.has(name)) return c.json({ error: `no history for "${name}"` }, 404);
    const pid = c.get("projectId");
    const value = await readSnapshot(c.env, pid, name, c.req.param("ts"));
    if (value == null) return c.json({ error: "no such version" }, 404);
    return c.json({ name, ts: c.req.param("ts"), value });
  });

  // Put a stored version back. The current document is parked first (writeDoc
  // snapshots what it replaces), so this is reversible in the same UI.
  app.post("/api/history/:name/:ts/restore", async (c) => {
    const name = c.req.param("name");
    if (!DOCS.has(name)) return c.json({ error: `no history for "${name}"` }, 404);
    const pid = c.get("projectId");
    const ts = c.req.param("ts");
    const value = await readSnapshot(c.env, pid, name, ts);
    if (value == null) return c.json({ error: "no such version" }, 404);
    // forceSnapshot: park the CURRENT document even if it was written moments
    // ago, so restoring is never a one-way door.
    await writeDoc(c.env, pid, name, value, { forceSnapshot: true });
    return c.json({ ok: true, name, ts, value: await readDoc(c.env, pid, name, null) });
  });
}
