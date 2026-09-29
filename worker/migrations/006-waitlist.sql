-- The waitlist: who may use the app while it opens to a few people at a time.
-- See the comment block in schema.sql and worker/src/lib/waitlist.js.
--
-- Apply once per database (idempotent):
--   cd worker && npx wrangler d1 execute shot-studio-uploads --remote \
--     --file=migrations/006-waitlist.sql
--
-- Ordering: apply BEFORE deploying the Worker that enforces it. The backfill at
-- the bottom grandfathers every account that already exists, so nobody who uses
-- the app today is locked out by the deploy.

CREATE TABLE IF NOT EXISTS waitlist (
  email              TEXT PRIMARY KEY,         -- lowercased + trimmed
  user_id            TEXT,                     -- "user"(id), once they sign in
  source             TEXT NOT NULL DEFAULT 'form',  -- form | signin | org-invite | backfill | admin
  invited            INTEGER NOT NULL DEFAULT 0,    -- 1 = may use the app
  invited_at         TEXT,
  invitation_sent    INTEGER NOT NULL DEFAULT 0,    -- 1 = the "you're in" email went out
  invitation_sent_at TEXT,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_waitlist_queue ON waitlist (invited, created_at);
CREATE INDEX IF NOT EXISTS idx_waitlist_unsent ON waitlist (invited, invitation_sent);

-- Grandfather every existing account: invited, and marked sent so the cron
-- doesn't email people who are already using the app.
INSERT OR IGNORE INTO waitlist (email, user_id, source, invited, invited_at, invitation_sent, invitation_sent_at, created_at)
SELECT lower(trim(email)), id, 'backfill', 1, datetime('now'), 1, datetime('now'), datetime('now') FROM "user";
