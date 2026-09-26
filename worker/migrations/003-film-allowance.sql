-- Film allowance (Auto, issue #63): per-user monthly Film limit + the ledger of
-- Films that counted against it. See the comment block in schema.sql and
-- worker/src/lib/film-allowance.js.
--
-- Apply once per database (idempotent — every statement is IF NOT EXISTS, so
-- re-running it is harmless):
--   cd worker && npx wrangler d1 execute shot-studio-uploads --remote \
--     --file=migrations/003-film-allowance.sql
--
-- Safe ordering: apply BEFORE deploying a worker that calls checkAllowance /
-- countFilm, or those calls fail with "no such table".
--
-- CREATOR OVERRIDE (no UI yet — a paid plan will set this later). Set one
-- user's monthly limit:
--   npx wrangler d1 execute shot-studio-uploads --remote --command \
--     "INSERT INTO film_allowances (user_id, monthly_limit, updated_at)
--      VALUES ('<userId>', 50, datetime('now'))
--      ON CONFLICT(user_id) DO UPDATE SET monthly_limit = excluded.monthly_limit,
--      updated_at = excluded.updated_at;"
-- Back to the default:  DELETE FROM film_allowances WHERE user_id = '<userId>';
-- A user's id by email: SELECT id FROM "user" WHERE email = '<email>';

CREATE TABLE IF NOT EXISTS film_allowances (
  user_id       TEXT PRIMARY KEY,
  monthly_limit INTEGER NOT NULL DEFAULT 10,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS film_counts (
  user_id    TEXT NOT NULL,
  film_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,
  period     TEXT NOT NULL,
  counted_at TEXT NOT NULL,
  PRIMARY KEY (user_id, film_id)
);
CREATE INDEX IF NOT EXISTS idx_film_counts_period ON film_counts (user_id, period);
