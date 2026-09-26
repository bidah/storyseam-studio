-- A project per Film: which project each Auto Film runs in. See the comment
-- block in schema.sql and worker/src/lib/films.js.
--
-- Apply once per database (idempotent):
--   cd worker && npx wrangler d1 execute shot-studio-uploads --remote \
--     --file=migrations/005-films.sql
--
-- Ordering: apply BEFORE deploying the Worker that writes it. Reads tolerate a
-- missing table (they answer "no such Film" and fall back to the request's
-- project), but a Film started without the table has no by-URL lookup.

CREATE TABLE IF NOT EXISTS films (
  film_id    TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_films_user ON films (user_id, created_at DESC);
