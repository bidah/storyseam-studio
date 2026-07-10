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
