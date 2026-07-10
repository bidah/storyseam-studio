#!/usr/bin/env bash
# One-time migration of the existing p_default project data into R2, for the
# Cloudflare Hono Worker cutover. Run from shot-studio/worker/:
#     bash migrate-to-r2.sh            # docs only (fast; uses wrangler)
#     bash migrate-to-r2.sh --media    # also sync media (needs R2 S3 creds; see below)
#
# JSON document stores → R2 `state/p_default/<name>.json` (the Worker's readDoc).
# Media files          → R2 `media/p_default/<kind>/…`   (the Worker streams these).
set -euo pipefail
cd "$(dirname "$0")"

BUCKET=shot-studio-uploads
ROOT=../..            # repo root (the old PROJECT_ROOT)
PID=p_default

put_doc () { # <local-json> <docname>
  local src="$1" name="$2"
  if [ -f "$src" ]; then
    echo "  doc: $src → state/$PID/$name.json"
    npx wrangler r2 object put "$BUCKET/state/$PID/$name.json" --remote --file "$src" \
      --content-type application/json >/dev/null
  else
    echo "  (skip $src — not present)"
  fi
}

echo "==> Migrating JSON document stores to R2…"
put_doc "$ROOT/episode-multishot/selections.json"        selections
put_doc "$ROOT/episode-multishot/shotlist.json"          shotlist
put_doc "$ROOT/shot-studio/sound-studio/sounds.json"     sounds
put_doc "$ROOT/episode-multishot/multishot_bundles.json" episode-manifest
put_doc "$ROOT/multishot-s1-shots1-4/multishot.json"     multishot
# (script/p_default.json was already seeded by migrate-projects.sh)

if [ "${1:-}" != "--media" ]; then
  echo "Docs done. Re-run with --media to sync media files."
  exit 0
fi

# --- media -----------------------------------------------------------------
# Media can be gigabytes; wrangler-per-file is impractical. Use the S3 API via
# the AWS CLI against the R2 S3 endpoint. Requires an R2 API token:
#   export R2_ACCOUNT_ID=…  AWS_ACCESS_KEY_ID=…  AWS_SECRET_ACCESS_KEY=…
# (Create at Cloudflare dashboard → R2 → Manage API tokens.)
: "${R2_ACCOUNT_ID:?set R2_ACCOUNT_ID}"
ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
S3="aws s3 --endpoint-url $ENDPOINT"

sync_dir () { # <local-dir> <kind>
  local dir="$1" kind="$2"
  if [ -d "$dir" ]; then
    echo "  media: $dir → media/$PID/$kind/"
    $S3 sync "$dir" "s3://$BUCKET/media/$PID/$kind/"
  fi
}

echo "==> Syncing media to R2…"
sync_dir "$ROOT/_archive/shot-by-shot/shots"    shots
sync_dir "$ROOT/episode-multishot/generations"  gen
sync_dir "$ROOT/shot-studio/sound-studio/media" sound-media
sync_dir "$ROOT/final_selection"                final
sync_dir "$ROOT/shot-by-shot"                   refs
# Voice refs + browsable library images → media/p_default/asset/
sync_dir "$ROOT/audio-as-video-refs"            asset/audio-as-video-refs
echo "Media sync done."
