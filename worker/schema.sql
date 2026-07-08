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
