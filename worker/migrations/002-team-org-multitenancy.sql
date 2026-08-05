-- Teams & multi-tenancy: orgs, scoped membership, per-project grants, invites.
--
-- Adds the tenant boundary described in schema.sql. A project already carries
-- `owner_user_id` in prod (added out-of-band before this file existed — the
-- projects routes have queried it all along); this migration finally records it
-- in the schema AND adds `organization_id`, then creates the four new tables.
--
-- Apply once per database:
--   cd worker && npx wrangler d1 execute shot-studio-uploads --remote \
--     --file=migrations/002-team-org-multitenancy.sql
--
-- Safe ordering: run this BEFORE deploying the worker that reads the new tables,
-- or after — lib/orgs.js#ensurePersonalOrg backfills a personal org and the
-- projects' organization_id lazily on first sign-in, so a project with a null
-- org just behaves as owner-only until then.
--
-- D1/SQLite has no ADD COLUMN IF NOT EXISTS. If `owner_user_id` already exists
-- (it does in prod), that one ALTER errors "duplicate column name" and changes
-- nothing — run the statements individually if you need to skip it, or ignore
-- the error and let the rest apply.
ALTER TABLE projects ADD COLUMN owner_user_id TEXT;
ALTER TABLE projects ADD COLUMN organization_id TEXT;

CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_projects_org ON projects (organization_id);

CREATE TABLE IF NOT EXISTS organizations (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  slug          TEXT,
  owner_user_id TEXT NOT NULL,
  personal      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_organizations_owner ON organizations (owner_user_id);

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

CREATE TABLE IF NOT EXISTS project_member (
  project_id  TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'editor',
  granted_by  TEXT,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_project_member_user ON project_member (user_id);

CREATE TABLE IF NOT EXISTS org_invitations (
  id                TEXT PRIMARY KEY,
  organization_id   TEXT NOT NULL,
  email             TEXT NOT NULL,
  role              TEXT NOT NULL DEFAULT 'member',
  scope_mode        TEXT NOT NULL DEFAULT 'selection',
  scope_project_ids TEXT,
  project_role      TEXT NOT NULL DEFAULT 'editor',
  token             TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  invited_by        TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  expires_at        TEXT,
  accepted_by       TEXT,
  accepted_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_org_invitations_org ON org_invitations (organization_id);
CREATE INDEX IF NOT EXISTS idx_org_invitations_email ON org_invitations (email);
