// Version-history endpoints (/api/history/*) over the project JSON doc stores.
//
// Every doc write parks the bytes it replaced (see lib/history.js); these routes
// let the World tab — and the agent — list those versions, read one, and put one
// back. Restoring is itself an ordinary write, so the version you restore OVER
// is parked too: a restore is always undoable.
import { readDoc, writeDoc, normalizeProjectId } from "../lib/docs.js";
import { listSnapshots, readSnapshot } from "../lib/history.js";

// Which documents these routes will talk about.
//
// This used to be a hardcoded allowlist, and it was WRONG: it listed route names
// ("cuts", "episode", "timeline", "library") that are not documents, and omitted
// the two biggest ones that are — `selections` (the shared de-facto DB holding
// episode picks, cut history, the editor timeline and the library) and
// `episode-manifest`. Their versions were being captured all along and the API
// refused to show them. A hand-maintained list of names that already exist in the
// database is pure drift risk, so the check is now "does this project actually
// have that document (or history for it)". `name` is a bound SQL parameter, not
// string-concatenated into a key, so there is no injection surface to defend —
// the character guard is hygiene, keeping the 404 cheap for junk input.
const NAME_OK = /^[a-zA-Z0-9._-]{1,64}$/;

async function knownDoc(env, projectId, name) {
  if (!NAME_OK.test(String(name || ""))) return false;
  const pid = normalizeProjectId(projectId);
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM docs WHERE project_id = ? AND name = ?
     UNION ALL
     SELECT 1 AS ok FROM doc_history WHERE project_id = ? AND name = ? LIMIT 1`,
  )
    .bind(pid, name, pid, name)
    .first();
  return !!row;
}

export function registerHistory(app) {
  // Which documents this project has, and how many stored versions each carries.
  // Exists so no caller has to keep its own list of document names in sync.
  app.get("/api/history", async (c) => {
    const pid = normalizeProjectId(c.get("projectId"));
    const { results } = await c.env.DB.prepare(
      `SELECT d.name AS name, length(d.json) AS bytes, d.updated_at AS updatedAt,
              (SELECT COUNT(*) FROM doc_history h WHERE h.project_id = d.project_id AND h.name = d.name) AS versions
         FROM docs d WHERE d.project_id = ? ORDER BY d.name`,
    )
      .bind(pid)
      .all();
    return c.json({ docs: results || [] });
  });

  // List the stored versions of one doc, newest first.
  app.get("/api/history/:name", async (c) => {
    const name = c.req.param("name");
    const pid = c.get("projectId");
    if (!(await knownDoc(c.env, pid, name))) return c.json({ error: `no history for "${name}"` }, 404);
    const snapshots = await listSnapshots(c.env, pid, name);
    return c.json({ name, snapshots });
  });

  // Read one stored version (for a preview / diff before restoring).
  app.get("/api/history/:name/:ts", async (c) => {
    const name = c.req.param("name");
    const pid = c.get("projectId");
    if (!(await knownDoc(c.env, pid, name))) return c.json({ error: `no history for "${name}"` }, 404);
    const value = await readSnapshot(c.env, pid, name, c.req.param("ts"));
    if (value == null) return c.json({ error: "no such version" }, 404);
    return c.json({ name, ts: c.req.param("ts"), value });
  });

  // Put a stored version back. The current document is parked first (writeDoc
  // snapshots what it replaces), so this is reversible in the same UI.
  app.post("/api/history/:name/:ts/restore", async (c) => {
    const name = c.req.param("name");
    const pid = c.get("projectId");
    if (!(await knownDoc(c.env, pid, name))) return c.json({ error: `no history for "${name}"` }, 404);
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

// Duplicate a project — its documents AND its media — into a brand-new project.
//
// Documents are cheap: they are rows, and none of them embed the project id
// (media is referenced by relative file name, resolved per active project), so
// copying a row under a new `project_id` is enough. Media is the expensive half:
// R2 keys are `media/<pid>/<kind>/<file>`, so every object has to be read and
// re-written under the new prefix — the binding has no server-side copy.
//
// RESUMABLE by design. A project's renders run to hundreds of megabytes, which
// is more than one request should stream, so each call copies until it hits a
// budget and returns a cursor; keep calling with that cursor until `done`. The
// SOURCE project is never touched.
export function registerClone(app) {
  const MAX_OBJECTS = 150;      // per call
  const MAX_BYTES = 250 * 1024 * 1024;
  // Objects are copied concurrently: each one is a read and a write against R2,
  // so the request spends nearly all its time waiting on the network. Serially
  // this ran at ~2 MB/s, which puts a multi-gigabyte project near half an hour.
  //
  // The ceiling is NOT the subrequest budget — it's the Workers limit on
  // SIMULTANEOUS OPEN CONNECTIONS. Each object holds two at once (the source
  // stream and the destination upload), so a pool of 12 reliably died with
  // "Response closed due to connection limit" mid-copy. Four leaves headroom.
  const CONCURRENCY = 4;

  app.post("/api/admin/clone-project", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in required" }, 401);
    let body;
    try { body = await c.req.json(); } catch { body = {}; }

    const from = normalizeProjectId(body?.from);
    const env = c.env;

    // Measure-only pass, so the size of the job is knowable before starting it.
    if (body?.dryRun) {
      let objects = 0, bytes = 0;
      const byKind = {};
      let cursor;
      do {
        const page = await env.BUCKET.list({ prefix: `media/${from}/`, cursor, limit: 1000 });
        for (const o of page.objects) {
          objects++; bytes += o.size;
          const kind = o.key.split("/")[2] || "?";
          byKind[kind] = byKind[kind] || { objects: 0, bytes: 0 };
          byKind[kind].objects++; byKind[kind].bytes += o.size;
        }
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      const { results: docs } = await env.DB.prepare(
        "SELECT name, length(json) AS bytes FROM docs WHERE project_id = ?",
      ).bind(from).all();
      return c.json({ dryRun: true, from, docs, media: { objects, bytes, byKind } });
    }

    // First call mints the project and copies the documents; later calls pass
    // `to` back and only continue the media copy.
    let to = body?.to ? normalizeProjectId(body.to) : null;
    const copiedDocs = [];
    if (!to) {
      const name = String(body?.name || "").trim() || "Copy";
      to = `p_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
      const ts = new Date().toISOString();
      await env.DB.prepare(
        "INSERT INTO projects (id, name, created_at, updated_at, archived, owner_user_id) VALUES (?, ?, ?, ?, 0, ?)",
      ).bind(to, name, ts, ts, userId).run();
      const { results } = await env.DB.prepare(
        "SELECT name, json FROM docs WHERE project_id = ?",
      ).bind(from).all();
      for (const row of results || []) {
        await env.DB.prepare(
          "INSERT INTO docs (project_id, name, json, version, updated_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT (project_id, name) DO NOTHING",
        ).bind(to, row.name, row.json, ts).run();
        copiedDocs.push(row.name);
      }
    }

    // Media, in budgeted batches. `skipped` counts objects already present, so a
    // re-run after an interruption resumes instead of re-uploading.
    // Failures are reported rather than surfacing as a bare 500: a clone is a
    // long, resumable job and the caller needs to know WHICH object broke and how
    // far it got, so it can pick up from there.
    let copied = 0, skipped = 0, bytes = 0, done = true;
    let cursor = body?.cursor || undefined;
    const prefix = `media/${from}/`;
    let failed = null;

    const copyOne = async (o) => {
      const destKey = `media/${to}/${o.key.slice(prefix.length)}`;
      try {
        if (await env.BUCKET.head(destKey)) { skipped++; return; }
        const src = await env.BUCKET.get(o.key);
        if (!src) { skipped++; return; }
        await env.BUCKET.put(destKey, src.body, { httpMetadata: src.httpMetadata });
        copied++; bytes += o.size;
      } catch (e) {
        failed = failed || { key: o.key, size: o.size, error: String(e?.message || e) };
      }
    };

    // Resume by KEY, not by list cursor. A whole project fits in one 1000-object
    // page, so a cursor is null every time and each call would restart the scan
    // from the first object — re-head()ing everything already copied. That grows
    // with progress (quadratic in calls) and had throughput collapsing to well
    // under 1 MB/s by the third call. `startAfter` picks up exactly where the
    // last call stopped, so every call does only new work.
    //
    // `after` advances only on a FULLY completed chunk, so a partial chunk is
    // redone rather than skipped; the head() check makes that overlap free.
    let after = body?.after || undefined;
    outer: do {
      const page = await env.BUCKET.list({ prefix, cursor, startAfter: after, limit: 1000 });
      if (!page.objects.length) break;
      for (let i = 0; i < page.objects.length; i += CONCURRENCY) {
        const chunk = page.objects.slice(i, i + CONCURRENCY);
        await Promise.all(chunk.map(copyOne));
        if (failed) { done = false; break outer; }
        after = chunk[chunk.length - 1].key;
        if (copied >= MAX_OBJECTS || bytes >= MAX_BYTES) { done = false; break outer; }
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);

    return c.json({
      ok: !failed, from, to, copiedDocs, copied, skipped, bytes, done, failed,
      after: done ? null : after ?? null,
    });
  });
}
