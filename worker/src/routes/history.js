// Version-history endpoints (/api/history/*) over the project JSON doc stores.
//
// Every doc write parks the bytes it replaced (see lib/history.js); these routes
// let the World tab — and the agent — list those versions, read one, and put one
// back. Restoring is itself an ordinary write, so the version you restore OVER
// is parked too: a restore is always undoable.
import { readDoc, writeDoc, normalizeProjectId } from "../lib/docs.js";
import { listSnapshots, readSnapshot } from "../lib/history.js";

// The doc stores a project owns. An allowlist, not a free-form key: `name`
// reaches R2 key construction, and there is no reason to expose more than the
// stores the app actually keeps.
const DOCS = new Set([
  "world",
  "script",
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

  // One-shot warm-up for the R2 → D1 doc cutover. `readDoc` already migrates a
  // document the first time it's read, so this is only about not waiting for
  // that first read — it copies every pre-cutover `state/<pid>/<name>.json` and
  // `script/<pid>.json` object into the `docs` table in one pass. Idempotent
  // (existing rows are left alone), and the R2 objects are deliberately NOT
  // deleted: they stay as a cold, frozen backup of the pre-cutover state.
  app.post("/api/admin/migrate-docs", async (c) => {
    if (!c.get("userId")) return c.json({ error: "Sign in required" }, 401);
    const env = c.env;
    const migrated = [];
    let scanned = 0;
    let skipped = 0;

    const seat = async (pid, name, text) => {
      scanned++;
      try {
        JSON.parse(text);
      } catch {
        skipped++;
        return;
      }
      const res = await env.DB.prepare(
        "INSERT INTO docs (project_id, name, json, version, updated_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT (project_id, name) DO NOTHING",
      )
        .bind(normalizeProjectId(pid), name, text, new Date().toISOString())
        .run();
      if (res?.meta?.changes > 0) migrated.push(`${pid}/${name}`);
      else skipped++;
    };

    for (const prefix of ["state/", "script/"]) {
      let cursor;
      do {
        const page = await env.BUCKET.list({ prefix, cursor, limit: 1000 });
        for (const o of page.objects) {
          if (!o.key.endsWith(".json")) continue;
          // state/<pid>/<name>.json  |  script/<pid>.json
          const rest = o.key.slice(prefix.length, -".json".length);
          const [pid, name] =
            prefix === "state/" ? rest.split("/") : [rest, "script"];
          if (!pid || !name || name.includes("/")) continue;
          const obj = await env.BUCKET.get(o.key);
          if (obj) await seat(pid, name, await obj.text());
        }
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
    }
    return c.json({ ok: true, scanned, migrated: migrated.length, skipped, docs: migrated });
  });

  // Finish the cutover: remove the pre-D1 JSON objects from R2. This is a
  // multi-tenant app and user state belongs in the database — leaving per-tenant
  // documents lying around as loose objects in a blob bucket is the pattern we
  // moved away from, not a backup strategy (D1 Time Travel is the backup).
  //
  // Deletion is CONDITIONAL: an object is only removed once D1 demonstrably
  // holds the same bytes. Anything that doesn't match is seated first and left
  // on disk for the next run, and reported in `kept` — nothing is deleted on the
  // assumption that it migrated.
  app.post("/api/admin/purge-legacy-docs", async (c) => {
    if (!c.get("userId")) return c.json({ error: "Sign in required" }, 401);
    const env = c.env;
    const deleted = [];
    const kept = [];

    for (const prefix of ["state/", "script/", "history/"]) {
      let cursor;
      do {
        const page = await env.BUCKET.list({ prefix, cursor, limit: 1000 });
        for (const o of page.objects) {
          if (!o.key.endsWith(".json")) continue;
          const obj = await env.BUCKET.get(o.key);
          if (!obj) continue;
          const text = await obj.text();
          const rest = o.key.slice(prefix.length, -".json".length);

          if (prefix === "history/") {
            // history/<pid>/<name>/<ts>.json — the first (R2-backed) cut of the
            // version history. Fold those versions into the doc_history table
            // rather than throwing the user's undo points away.
            const [pid, name, ts] = rest.split("/");
            if (!pid || !name || !ts) { kept.push(o.key); continue; }
            let source = null;
            let generatedAt = null;
            try {
              const p = JSON.parse(text);
              source = p?.source ?? null;
              generatedAt = p?.generatedAt ?? null;
            } catch { /* keep the bytes regardless */ }
            await env.DB.prepare(
              "INSERT INTO doc_history (project_id, name, ts, json, source, generated_at, size) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (project_id, name, ts) DO NOTHING",
            )
              .bind(normalizeProjectId(pid), name, ts, text, source, generatedAt, text.length)
              .run();
            await env.BUCKET.delete(o.key);
            deleted.push(o.key);
            continue;
          }

          // state/<pid>/<name>.json | script/<pid>.json
          const [pid, name] = prefix === "state/" ? rest.split("/") : [rest, "script"];
          if (!pid || !name || name.includes("/")) { kept.push(o.key); continue; }
          const row = await env.DB.prepare(
            "SELECT json FROM docs WHERE project_id = ? AND name = ?",
          )
            .bind(normalizeProjectId(pid), name)
            .first();
          // The live document may have moved on since the copy (writes have been
          // landing in D1 since the cutover), so "D1 has a row for this doc" is
          // the bar — not byte equality with a stale object.
          if (row?.json) {
            await env.BUCKET.delete(o.key);
            deleted.push(o.key);
          } else {
            await env.DB.prepare(
              "INSERT INTO docs (project_id, name, json, version, updated_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT (project_id, name) DO NOTHING",
            )
              .bind(normalizeProjectId(pid), name, text, new Date().toISOString())
              .run();
            kept.push(o.key); // seated now; the next run removes it
          }
        }
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
    }
    return c.json({ ok: true, deleted: deleted.length, kept: kept.length, keptKeys: kept });
  });
}
