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
-- projects exist". Per-project JSON state lives in the `docs` table keyed by
-- `project_id`; media bytes live in R2.
--
-- `owner_user_id` is the creator (the "p_" + short uuid project belongs to the
-- user who made it). `organization_id` is the TENANT the project lives in — a
-- project is always owned by exactly one org, and access is granted at the org
-- level (see org_members / project_member below). Both are nullable for the
-- walking-skeleton legacy rows (an unclaimed p_default, a pre-org project); the
-- access predicate treats a null org as "owner-only" and lib/orgs.js backfills a
-- personal org lazily on first sign-in.
CREATE TABLE IF NOT EXISTS projects (
  id              TEXT PRIMARY KEY,      -- "p_" + short uuid
  name            TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  archived        INTEGER NOT NULL DEFAULT 0,
  owner_user_id   TEXT,                  -- creator; references "user"(id)
  organization_id TEXT                   -- owning tenant; references organizations(id)
);

CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_projects_org ON projects (organization_id);

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
--
-- DOC NAMES ARE A KEY SPACE, and one of them is namespaced. Most surfaces own a
-- single row (`world`, `shotlist`, `sounds`, `radio`, `musical`, `plugins`, …).
-- The Director owns five:
--
--   director              the index: which Series this project has, which is open
--   director:<seriesId>   ONE Series — its cue sheet, model sheets and target audio
--   director-sittings     every kept sitting, and the scored version of each
--   director-cues         cue renders in flight: the body each was sent with
--   director-sheets       every Shot Sheet render, in flight and finished
--
-- A Series gets a row of its own rather than an entry in a list because of what
-- editing one is like: a cue sheet is up to sixty-four beats, moved one at a
-- time, dozens of times, while a second author does the same to another Series.
-- One shared document makes every one of those writes a compare-and-swap retry
-- against work that has nothing to do with it, and makes the history dialog say
-- "the Director changed" rather than "this Series changed".
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
--
-- Attribution (actor / caller / chat_id) describes the write that REPLACED this
-- version, and comes from the authenticated request rather than from the
-- document. `source` is the document's own self-report and can be stale, absent,
-- or simply wrong; it cannot answer "who did this" on a shared project. That
-- question is the whole reason someone opens the history dialog.
-- Existing databases:
--   ALTER TABLE doc_history ADD COLUMN actor TEXT;
--   ALTER TABLE doc_history ADD COLUMN caller TEXT;
--   ALTER TABLE doc_history ADD COLUMN chat_id TEXT;
CREATE TABLE IF NOT EXISTS doc_history (
  project_id   TEXT NOT NULL,
  name         TEXT NOT NULL,
  ts           TEXT NOT NULL,   -- 2026-07-22T21-56-31-995Z, sorts lexicographically
  json         TEXT NOT NULL,
  source       TEXT,            -- the replaced doc's own provenance ("agent", "app", …)
  generated_at TEXT,
  size         INTEGER NOT NULL,
  actor        TEXT,            -- authenticated user id behind the replacing write
  caller       TEXT,            -- "app" | "agent" — which credential answered
  chat_id      TEXT,            -- the agent conversation, when a tool made the write
  PRIMARY KEY (project_id, name, ts)
);

CREATE INDEX IF NOT EXISTS idx_doc_history_doc ON doc_history (project_id, name, ts DESC);

-- ─── Teams & multi-tenancy ──────────────────────────────────────────────────
--
-- The tenant boundary. Every user gets a PERSONAL org on first sign-in (owner =
-- that user), and every project lives in exactly one org. A user can be a member
-- of other people's orgs too, with a scope chosen by whoever invited them.
--
-- Access to a project = the caller is the project's owner_user_id, OR an
-- org_members row for the project's org grants it (owner/admin see everything;
-- a plain member sees only projects they hold a project_member grant on, unless
-- their membership is marked all_projects). The predicate lives in one place,
-- lib/orgs.js#canAccessProject, and is applied to BOTH credentials (the session
-- cookie and the agent's signed header) by the middleware in index.js.
CREATE TABLE IF NOT EXISTS organizations (
  id            TEXT PRIMARY KEY,     -- "o_" + short uuid
  name          TEXT NOT NULL,
  slug          TEXT,
  owner_user_id TEXT NOT NULL,        -- the user who owns the tenant; references "user"(id)
  personal      INTEGER NOT NULL DEFAULT 0,  -- 1 = the owner's auto-created personal workspace
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_organizations_owner ON organizations (owner_user_id);

-- Who belongs to an org, and how much of it they see.
--   role         owner | admin | member
--                owner/admin ⇒ access to EVERY project in the org.
--                member      ⇒ access only to granted projects (project_member),
--                              UNLESS all_projects = 1.
--   all_projects 1 ⇒ this member sees all current AND FUTURE projects of the org
--                    without being an admin (the inviter picked "all" scope).
CREATE TABLE IF NOT EXISTS org_members (
  organization_id TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'member',
  all_projects    INTEGER NOT NULL DEFAULT 0,
  invited_by      TEXT,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members (user_id);

-- Per-project grant: a scoped member sees exactly these projects. Present only
-- when the inviter chose a selection (or a single project); "all" scope is the
-- all_projects flag on org_members instead. role gates writes within the project.
--   role  editor | viewer
CREATE TABLE IF NOT EXISTS project_member (
  project_id  TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'editor',
  granted_by  TEXT,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_project_member_user ON project_member (user_id);

-- A pending invite into an org, carrying the scope the inviter chose. The token
-- is the credential the invitee presents to accept (no email provider is wired,
-- so the invite is delivered as a copy-link; when email lands it just sends this
-- same link). On accept we materialise the org_members row (+ all_projects for
-- "all" scope) and the project_member grants named in scope_project_ids.
--   scope_mode        all | selection
--   scope_project_ids JSON array of project ids (for "selection")
--   status            pending | accepted | revoked
CREATE TABLE IF NOT EXISTS org_invitations (
  id                TEXT PRIMARY KEY,   -- "inv_" + short uuid
  organization_id   TEXT NOT NULL,
  email             TEXT NOT NULL,
  role              TEXT NOT NULL DEFAULT 'member',
  scope_mode        TEXT NOT NULL DEFAULT 'selection',
  scope_project_ids TEXT,               -- JSON array
  project_role      TEXT NOT NULL DEFAULT 'editor',
  token             TEXT NOT NULL,      -- 128-bit hex secret, verified constant-time
  status            TEXT NOT NULL DEFAULT 'pending',
  invited_by        TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  expires_at        TEXT,
  accepted_by       TEXT,
  accepted_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_org_invitations_org ON org_invitations (organization_id);
CREATE INDEX IF NOT EXISTS idx_org_invitations_email ON org_invitations (email);

-- ─── Film allowance (Auto) ──────────────────────────────────────────────────
--
-- How many Films a user may make on StorySeam's own keys (CONTEXT.md, "Film
-- allowance"; ADR 0003). Per-USER platform data, not per-project doc state, so
-- it is a table rather than a `docs` row. Read and written ONLY through
-- worker/src/lib/film-allowance.js. Prod gets it from
-- migrations/003-film-allowance.sql, which also carries the override SQL.
--
-- film_allowances  the creator-set limit. NO ROW = the default (10 a month); a
--                  row exists only for a user whose limit was overridden. No
--                  UI — the creators change it by direct database update.
CREATE TABLE IF NOT EXISTS film_allowances (
  user_id       TEXT PRIMARY KEY,             -- references "user"(id)
  monthly_limit INTEGER NOT NULL DEFAULT 10,
  updated_at    TEXT NOT NULL
);

-- film_counts  the ledger of Films that COUNTED. Only `new` and `reshoot` are
--              ever written — a music-only rescore and a failed Film never land
--              here. Keyed (user_id, film_id) so counting one Film twice is a
--              no-op (a re-shoot passes its VERSION id as film_id). `period` is
--              the UTC calendar month ('YYYY-MM'); the allowance "resets" on the
--              1st simply because a new month has no rows yet.
CREATE TABLE IF NOT EXISTS film_counts (
  user_id    TEXT NOT NULL,
  film_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,                   -- new | reshoot
  period     TEXT NOT NULL,                   -- 'YYYY-MM', UTC
  counted_at TEXT NOT NULL,                   -- ISO timestamp
  PRIMARY KEY (user_id, film_id)
);
CREATE INDEX IF NOT EXISTS idx_film_counts_period ON film_counts (user_id, period);

-- The Auto toggle (CONTEXT.md, "Auto"; issue #65): ON by default — nothing
-- asks; OFF — the Film job pauses ONCE, after the World and before anything is
-- paid for, on a confirm card. Per-USER (it follows the author across projects
-- and devices), so a table rather than a `docs` row. NO ROW = Auto on. Read and
-- written ONLY through worker/src/lib/auto-settings.js. Prod gets it from
-- migrations/004-auto-settings.sql.
CREATE TABLE IF NOT EXISTS auto_settings (
  user_id    TEXT PRIMARY KEY,             -- references "user"(id)
  auto       INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

-- A project per Film (CONTEXT.md, "Film"): every Auto Film runs in a NEW
-- project of its own, so its World, shot list and every other project-level
-- doc start empty instead of merging into the author's current project. This
-- maps a Film to that project, per user: the /director-story page by URL, the
-- agent's get_film / retry_film, "one Film at a time per user" and the user's
-- latest Film all read it. Read and written ONLY through worker/src/lib/films.js.
-- Prod gets it from migrations/005-films.sql.
CREATE TABLE IF NOT EXISTS films (
  film_id    TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,                -- references projects(id)
  user_id    TEXT NOT NULL,                -- references "user"(id)
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_films_user ON films (user_id, created_at DESC);

-- The waitlist (early access). The app is open only to people whose email has
-- `invited = 1`; everyone else who signs in is added here and sent to /waitlist.
-- `invitation_sent` is separate from `invited` on purpose: opening a batch flips
-- `invited`, and the email is a second step — the cron in index.js sends it for
-- any row invited but not yet sent, so a row flipped by hand in SQL is mailed
-- too. Read and written ONLY through worker/src/lib/waitlist.js.
-- Prod gets it from migrations/006-waitlist.sql (which also grandfathers every
-- existing account).
CREATE TABLE IF NOT EXISTS waitlist (
  email              TEXT PRIMARY KEY,
  user_id            TEXT,
  source             TEXT NOT NULL DEFAULT 'form',
  invited            INTEGER NOT NULL DEFAULT 0,
  invited_at         TEXT,
  invitation_sent    INTEGER NOT NULL DEFAULT 0,
  invitation_sent_at TEXT,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_waitlist_queue ON waitlist (invited, created_at);
CREATE INDEX IF NOT EXISTS idx_waitlist_unsent ON waitlist (invited, invitation_sent);

-- Billing (worker/src/lib/billing.js): a PayPal subscription per user, and the
-- credit ledger it pays into. Per-USER platform data, so tables rather than
-- `docs` rows. Read and written ONLY through lib/billing.js.
--
-- billing_subscriptions  one row per PayPal subscription the user started; the
--                        newest is the one that counts. `status` mirrors
--                        PayPal's, refreshed by webhook and by /api/billing/sync.
-- billing_ledger         every credit movement, in micro-USD of model cost. A
--                        paid cycle (PAYMENT.SALE.COMPLETED) writes a `grant`
--                        keyed `paypal-sale:<sale id>`; each agent model call
--                        writes a `usage` keyed `turn:<instance>:<turn>`, so a
--                        re-delivery is a no-op. Balance = SUM(amount_micros).
-- Prod gets them from migrations/007-billing.sql.
CREATE TABLE IF NOT EXISTS billing_subscriptions (
  subscription_id    TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL,
  plan_id            TEXT NOT NULL,
  plan_key           TEXT,
  status             TEXT NOT NULL,
  next_billing_at    TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_billing_subs_user ON billing_subscriptions (user_id, updated_at);

CREATE TABLE IF NOT EXISTS billing_ledger (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT NOT NULL,
  amount_micros INTEGER NOT NULL,
  kind         TEXT NOT NULL,
  model        TEXT,
  tokens       INTEGER,
  ref          TEXT UNIQUE,
  note         TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_billing_ledger_user ON billing_ledger (user_id, created_at);
