#!/usr/bin/env bash
# One command for the whole PayPal setup, with the client secret read from the
# macOS clipboard so it is never typed, echoed or written to a file.
#
#   1. In the PayPal developer dashboard, click the copy icon next to the app's
#      Secret (sandbox or live — match PAYPAL_ENV).
#   2. cd worker && PAYPAL_ENV=sandbox scripts/paypal-bootstrap.sh <client id>
#
# It creates the product, the three plans and the webhook (paypal-setup.mjs),
# then stores PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET / PAYPAL_WEBHOOK_ID as
# Worker secrets. The plan ids it prints go into wrangler.jsonc PAYPAL_PLAN_IDS.
set -euo pipefail
cd "$(dirname "$0")/.."

CLIENT_ID="${1:?usage: PAYPAL_ENV=sandbox scripts/paypal-bootstrap.sh <client id>}"
SECRET="$(pbpaste | tr -d '[:space:]')"
if [ ${#SECRET} -lt 40 ]; then
  echo "The clipboard doesn't look like a PayPal secret — copy it from the dashboard first." >&2
  exit 1
fi

OUT="$(PAYPAL_CLIENT_ID="$CLIENT_ID" PAYPAL_CLIENT_SECRET="$SECRET" node scripts/paypal-setup.mjs)"
echo "$OUT"
WEBHOOK_ID="$(printf '%s\n' "$OUT" | awk '/^webhook /{print $2}')"
[ -n "$WEBHOOK_ID" ] || { echo "No webhook id in the setup output." >&2; exit 1; }

printf '%s' "$CLIENT_ID"  | npx wrangler secret put PAYPAL_CLIENT_ID
printf '%s' "$SECRET"     | npx wrangler secret put PAYPAL_CLIENT_SECRET
printf '%s' "$WEBHOOK_ID" | npx wrangler secret put PAYPAL_WEBHOOK_ID
printf '' | pbcopy  # don't leave the secret on the clipboard
echo "Secrets stored. Paste the plan lines above back to Claude for PAYPAL_PLAN_IDS."
