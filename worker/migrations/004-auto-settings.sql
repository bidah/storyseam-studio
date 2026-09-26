-- Auto settings (Auto, issue #65): the per-USER Auto toggle that sits beside
-- the prompt on /auto. See the comment block in schema.sql and
-- worker/src/lib/auto-settings.js.
--
-- Apply once per database (idempotent):
--   cd worker && npx wrangler d1 execute shot-studio-uploads --remote \
--     --file=migrations/004-auto-settings.sql
--
-- Ordering: reads fall back to the default (Auto ON) while the table is
-- missing, so deploying first is harmless; saving the toggle needs the table.

CREATE TABLE IF NOT EXISTS auto_settings (
  user_id    TEXT PRIMARY KEY,
  auto       INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
