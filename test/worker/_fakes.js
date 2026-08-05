// A tiny in-memory stand-in for a Cloudflare R2 bucket binding, implementing the
// slice of the API worker/src/lib/{docs,media}.js actually call: get (with Range
// support + json()), put, head, list (prefix scan). Enough to unit-test the
// storage helpers without wrangler/miniflare.

import { DatabaseSync } from "node:sqlite";

let etagSeq = 0;

const toBytes = (body) =>
  body instanceof Uint8Array
    ? body
    : body instanceof ArrayBuffer
      ? new Uint8Array(body)
      : new TextEncoder().encode(typeof body === "string" ? body : String(body));

export function makeBucket(initial = {}) {
  const store = new Map(); // key -> { bytes, contentType, etag }
  for (const [k, v] of Object.entries(initial)) {
    store.set(k, { bytes: toBytes(v), contentType: "application/octet-stream", etag: `"e${etagSeq++}"` });
  }

  const objFor = (key, entry, range) => {
    const total = entry.bytes.length;
    let bytes = entry.bytes;
    let appliedRange;
    if (range) {
      let offset = 0;
      let length = total;
      if (range.suffix != null) {
        offset = Math.max(0, total - range.suffix);
        length = total - offset;
      } else {
        offset = range.offset ?? 0;
        length = range.length ?? total - offset;
      }
      bytes = entry.bytes.slice(offset, offset + length);
      appliedRange = { offset, length };
    }
    return {
      key,
      size: total,
      etag: entry.etag, // raw (unquoted-style) etag — used by updateDoc's onlyIf
      httpEtag: entry.etag,
      range: appliedRange,
      body: bytes,
      writeHttpMetadata(headers) {
        if (entry.contentType) headers.set("content-type", entry.contentType);
      },
      async json() {
        return JSON.parse(new TextDecoder().decode(entry.bytes));
      },
      async text() {
        return new TextDecoder().decode(entry.bytes);
      },
    };
  };

  return {
    _store: store,
    async get(key, opts) {
      const entry = store.get(key);
      if (!entry) return null;
      return objFor(key, entry, opts?.range);
    },
    async head(key) {
      const entry = store.get(key);
      return entry ? { key, size: entry.bytes.length, httpEtag: entry.etag } : null;
    },
    async put(key, body, opts) {
      // Optimistic concurrency (updateDoc): honor onlyIf.etagMatches — a stale
      // etag means someone else wrote since our read, so the write fails (null).
      const wantEtag = opts?.onlyIf?.etagMatches;
      if (wantEtag != null) {
        const current = store.get(key);
        if (!current || current.etag !== wantEtag) return null;
      }
      const etag = `"e${etagSeq++}"`;
      store.set(key, {
        bytes: toBytes(body),
        contentType: opts?.httpMetadata?.contentType || "application/octet-stream",
        customMetadata: opts?.customMetadata,
        etag,
      });
      return { key, etag }; // R2 put resolves to the written object (truthy)
    },
    async delete(key) {
      store.delete(key);
    },
    async list({ prefix = "", limit = 1000, cursor } = {}) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const slice = keys.slice(start, start + limit);
      const truncated = start + limit < keys.length;
      return {
        // `size` and `customMetadata` are what the version-history listing reads
        // (lib/history.js) — real R2 returns them on list with include.
        objects: slice.map((key) => {
          const e = store.get(key);
          return { key, size: e.bytes.length, customMetadata: e.customMetadata };
        }),
        truncated,
        cursor: truncated ? String(start + limit) : undefined,
      };
    },
  };
}

// `DB` is a real in-memory SQLite by default: the doc stores live in D1 now, so
// almost every helper under test needs one. Pass `overrides.DB` to substitute.
export function makeEnv(overrides = {}) {
  return {
    BUCKET: makeBucket(overrides.files || {}),
    DB: makeDocsDB(DOCS_SCHEMA),
    ...overrides,
  };
}

// A minimal D1 stand-in for the `jobs` table access in worker/src/lib/jobs.js.
// It understands exactly the three query shapes that module issues:
//   INSERT INTO jobs (id, kind, status, created_at, updated_at) VALUES (?,?,'pending',?,?)
//   UPDATE jobs SET <col = ?, ...>, updated_at = ? WHERE id = ?
//   SELECT * FROM jobs WHERE id = ?
export function makeD1(seed = {}) {
  const rows = new Map(Object.entries(seed));

  function run(sql, binds) {
    const q = sql.trim();
    if (/^INSERT INTO jobs/i.test(q)) {
      // binds are the 4 placeholders: id, kind, created_at, updated_at
      const [id, kind, createdAt, updatedAt] = binds;
      rows.set(id, { id, kind, status: "pending", created_at: createdAt, updated_at: updatedAt });
      return { success: true };
    }
    if (/^UPDATE jobs SET/i.test(q)) {
      const setClause = /SET (.+) WHERE id = \?/is.exec(q)[1];
      const cols = setClause.split(",").map((c) => c.trim().split("=")[0].trim());
      const id = binds[binds.length - 1];
      const row = rows.get(id);
      if (row) cols.forEach((c, i) => (row[c] = binds[i]));
      return { success: true };
    }
    throw new Error(`makeD1: unsupported run() query: ${q}`);
  }

  function first(sql, binds) {
    if (/^SELECT \* FROM jobs WHERE id = \?/i.test(sql.trim())) {
      return rows.get(binds[0]) ?? null;
    }
    throw new Error(`makeD1: unsupported first() query: ${sql}`);
  }

  return {
    _rows: rows,
    prepare(sql) {
      let binds = [];
      const stmt = {
        bind(...vals) {
          binds = vals;
          return stmt;
        },
        async run() {
          return run(sql, binds);
        },
        async first() {
          return first(sql, binds);
        },
      };
      return stmt;
    },
  };
}

// A fake Daytona sandbox process handle for the job runner. `commandResult`
// seeds executeSessionCommand's return; `poll` seeds getSessionCommand/logs.
export function makeSandbox({ id = "sbx_1", cmdId = "cmd_1", exitCode, logs = "", throwOn = {} } = {}) {
  const seen = { sessions: [], commands: [], deleted: [] };
  return {
    id,
    _seen: seen,
    process: {
      async createSession(sessionId) {
        seen.sessions.push(sessionId);
      },
      async executeSessionCommand(sessionId, opts) {
        seen.commands.push({ sessionId, ...opts });
        return { cmdId };
      },
      async getSessionCommand(sessionId, cid) {
        if (throwOn.getSessionCommand) throw new Error("transient");
        return { exitCode, sessionId, cid };
      },
      async getSessionCommandLogs() {
        return logs;
      },
      async deleteSession(sessionId) {
        seen.deleted.push(sessionId);
      },
    },
  };
}

// A D1 stand-in backed by a REAL in-memory SQLite (node:sqlite), rather than a
// hand-written SQL matcher. The doc store leans on genuine SQL semantics —
// `ON CONFLICT DO UPDATE`, the conditional `WHERE version = ?` compare-and-swap,
// a `NOT IN (SELECT … LIMIT …)` ring-buffer prune — and faking those by pattern
// matching would test the fake, not the code. This runs the actual statements.
export function makeDocsDB(schema) {
  const db = new DatabaseSync(":memory:");
  db.exec(schema);

  const exec = (sql, binds) => {
    const stmt = db.prepare(sql);
    // node:sqlite rejects null prototypes round-tripping as undefined; D1 binds
    // undefined as null, so normalize the same way.
    const args = binds.map((b) => (b === undefined ? null : b));
    if (/^\s*select/i.test(sql)) return { rows: stmt.all(...args) };
    const r = stmt.run(...args);
    return { changes: Number(r.changes) };
  };

  const statement = (sql, binds = []) => ({
    sql,
    binds,
    bind: (...args) => statement(sql, args),
    async first() {
      return exec(sql, binds).rows?.[0] ?? null;
    },
    async all() {
      return { results: exec(sql, binds).rows ?? [], success: true };
    },
    async run() {
      const { changes = 0 } = exec(sql, binds);
      return { success: true, meta: { changes } };
    },
  });

  return {
    _db: db,
    prepare: (sql) => statement(sql),
    // A real transaction, like D1's: the batch commits as a unit, so a test can
    // actually observe the all-or-nothing guarantee that multi-document writes
    // depend on (see `also` in lib/docs.js).
    async batch(stmts) {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

// The doc-store slice of worker/schema.sql, inlined so the fake doesn't have to
// read the file (and so a schema drift shows up as a failing test, not a silent
// pass). Keep in sync with the `docs` / `doc_history` tables there.
export const DOCS_SCHEMA = `
CREATE TABLE docs (
  project_id TEXT NOT NULL,
  name       TEXT NOT NULL,
  json       TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL,
  write_token TEXT,
  PRIMARY KEY (project_id, name)
);
CREATE TABLE doc_history (
  project_id   TEXT NOT NULL,
  name         TEXT NOT NULL,
  ts           TEXT NOT NULL,
  json         TEXT NOT NULL,
  source       TEXT,
  generated_at TEXT,
  size         INTEGER NOT NULL,
  PRIMARY KEY (project_id, name, ts)
);
`;
