-- Attribution for doc_history: who made the write that replaced each version.
--
-- `source` (the document's own self-reported provenance) can't answer "who did
-- this" on a shared project, which is the main question anyone opens the history
-- dialog to ask. These three come from the authenticated request instead — see
-- worker/src/lib/request-context.js.
--
-- Apply once per database:
--   cd worker && npx wrangler d1 execute shot-studio-uploads --remote \
--     --file=migrations/001-doc-history-attribution.sql
--
-- Safe to run before OR after deploying the worker: lib/history.js falls back to
-- the pre-migration column set when these don't exist yet, so version history
-- keeps recording either way (it just records no actor until this runs).
--
-- D1/SQLite has no ADD COLUMN IF NOT EXISTS, so re-running this errors with
-- "duplicate column name" on each statement. That is the whole failure — nothing
-- is modified — and it is the intended signal that the migration already ran.
ALTER TABLE doc_history ADD COLUMN actor TEXT;
ALTER TABLE doc_history ADD COLUMN caller TEXT;
ALTER TABLE doc_history ADD COLUMN chat_id TEXT;
