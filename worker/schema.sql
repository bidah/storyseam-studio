-- Chat-attachment upload metadata. One row per stored object; the bytes live
-- in R2 under `key`, served publicly via the Worker's GET /files/<key>.
CREATE TABLE IF NOT EXISTS uploads (
  id           TEXT PRIMARY KEY,
  key          TEXT NOT NULL,
  name         TEXT,
  content_type TEXT,
  size         INTEGER,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_uploads_created_at ON uploads (created_at DESC);

-- Project registry. One row per project; the source of truth for "what
-- projects exist". Per-project script drafts live in R2 at `script/<id>.json`;
-- other per-project data lives in local subfolders (walking-skeleton phase).
-- A future per-user split adds a `user_id` column + index; nothing else changes.
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,      -- "p_" + short uuid
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  archived    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects (updated_at DESC);

-- Secrets KV store (ported from the file-backed `.secrets/` store). GLOBAL, not
-- per-project: these are the single user's credentials (e.g. the Higgsfield
-- OAuth token at `higgsfield:token:shot-studio-local:local-user`). `value` is a
-- JSON-encoded string (the token record is an object). The eve agent writes
-- here via PUT /api/secrets/<key>.
CREATE TABLE IF NOT EXISTS secrets (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TEXT
);

-- Async jobs for long-running Daytona work (Remotion render, full-episode
-- stitch) that can't complete inside a single Worker request. The Worker starts
-- a detached Daytona session command and stores its handles; a poll endpoint
-- (GET /api/jobs/:id) checks the command's status on demand and records the
-- result (an R2 media URL) or error. status ∈ pending|running|done|error.
CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  status      TEXT NOT NULL,
  sandbox_id  TEXT,
  session_id  TEXT,
  cmd_id      TEXT,
  result      TEXT,
  error       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Better Auth core schema (email/password login + sessions). Column names are
-- camelCase to match better-auth's native (kysely) D1 adapter — generated via
-- getMigrations().compileMigrations(). See worker/src/auth.js.
CREATE TABLE IF NOT EXISTS "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);
CREATE TABLE IF NOT EXISTS "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);
CREATE TABLE IF NOT EXISTS "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);
CREATE TABLE IF NOT EXISTS "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);
CREATE INDEX IF NOT EXISTS "session_userId_idx" on "session" ("userId");
CREATE INDEX IF NOT EXISTS "account_userId_idx" on "account" ("userId");
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" on "verification" ("identifier");

-- Per-project JSON application state. THE source of truth for the doc stores
-- (world, shotlist, sounds, cuts, episode, visual-world, script, …), which used
-- to live as R2 objects at `state/<projectId>/<name>.json`.
--
-- Why D1 and not R2: R2 is blob storage with no versioning, no transactions and
-- no conditional semantics beyond etags — a `put` silently destroys the previous
-- bytes, which is exactly how a world bible was lost. D1 gives real transactional
-- writes, a `version` column for optimistic concurrency (replacing the etag
-- retry dance), and Time Travel — 30 days of automatic point-in-time recovery
-- for the whole database. Media blobs stay in R2, where they belong.
CREATE TABLE IF NOT EXISTS docs (
  project_id  TEXT NOT NULL,
  name        TEXT NOT NULL,
  json        TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,  -- bumped per write; the CAS token
  updated_at  TEXT NOT NULL,
  -- Per-write nonce, used ONLY to make a multi-document write atomic: the
  -- secondary rows in a batch are guarded on the primary row carrying the token
  -- this attempt just wrote, so either every row lands or none does. Version
  -- alone can't do that job — a concurrent writer bumping the primary by one
  -- would satisfy a "version = expected + 1" guard and let a partial write
  -- through. See `also` in lib/docs.js.
  -- Existing databases: ALTER TABLE docs ADD COLUMN write_token TEXT;
  write_token TEXT,
  PRIMARY KEY (project_id, name)
);

-- Per-document version history: the value each write REPLACED. Time Travel is
-- whole-database and destructive, so it can't serve "undo just this document" —
-- that's what this is for. Retention is a ring buffer per doc (see lib/history.js).
CREATE TABLE IF NOT EXISTS doc_history (
  project_id   TEXT NOT NULL,
  name         TEXT NOT NULL,
  ts           TEXT NOT NULL,   -- 2026-07-22T21-56-31-995Z, sorts lexicographically
  json         TEXT NOT NULL,
  source       TEXT,            -- the replaced doc's own provenance ("agent", "app", …)
  generated_at TEXT,
  size         INTEGER NOT NULL,
  PRIMARY KEY (project_id, name, ts)
);

CREATE INDEX IF NOT EXISTS idx_doc_history_doc ON doc_history (project_id, name, ts DESC);
