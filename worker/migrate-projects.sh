#!/usr/bin/env bash
# One-time migration to enable multi-project support on the DEPLOYED Cloudflare
# Worker (shot-studio-uploads). Run from the worker/ directory:
#
#     cd shot-studio/worker && bash migrate-projects.sh
#
# It is idempotent — safe to re-run. Steps:
#   1. Apply the schema (adds the `projects` table) to the REMOTE D1.
#   2. Seed the `p_default` project row (maps to the existing Whistlewood data).
#   3. Copy the existing R2 script blob  script/current.json → script/p_default.json
#      so the default project keeps its current drafts. The original is left in
#      place as a safety net.
#   4. Deploy the updated Worker (new /projects routes + project-aware /script).
set -euo pipefail
cd "$(dirname "$0")"

DB=shot-studio-uploads
BUCKET=shot-studio-uploads
NOW="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

echo "==> 1/4  Applying schema to remote D1 ($DB)…"
npx wrangler d1 execute "$DB" --remote --file=schema.sql

echo "==> 2/4  Seeding p_default project row…"
npx wrangler d1 execute "$DB" --remote --command \
  "INSERT OR IGNORE INTO projects (id,name,created_at,updated_at,archived) VALUES ('p_default','Whistlewood','$NOW','$NOW',0);"

echo "==> 3/4  Copying R2 script/current.json → script/p_default.json…"
TMP="$(mktemp)"
if npx wrangler r2 object get "$BUCKET/script/current.json" --remote --file "$TMP" 2>/dev/null; then
  npx wrangler r2 object put "$BUCKET/script/p_default.json" --remote --file "$TMP" --content-type application/json
  echo "    copied ($(wc -c < "$TMP") bytes)."
else
  echo "    no existing script/current.json — default project will start blank (fine)."
fi
rm -f "$TMP"

echo "==> 4/4  Deploying Worker…"
npx wrangler deploy

echo "Done. Multi-project support is live."
