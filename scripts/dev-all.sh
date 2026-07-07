#!/usr/bin/env bash
# Run the full Shot Studio stack:
#   • Express data API  → http://localhost:3334
#   • eve chat agent    → http://localhost:2000   (needs Node >= 24)
#   • Vite UI           → http://localhost:3333   (proxies /eve → :2000)
#
# Usage:  npm run stack     (from shot-studio/)
set -uo pipefail
cd "$(dirname "$0")/.."

# Load .env (model + Higgsfield credentials) if present.
if [ -f .env ]; then set -a; . ./.env; set +a; fi

# eve requires Node >= 24. Find a compatible node and expose its bin dir.
EVE_NODE_DIR=""
for cand in "$(command -v node || true)" \
            /opt/homebrew/opt/node/bin/node \
            /opt/homebrew/opt/node@24/bin/node \
            /opt/homebrew/opt/node@25/bin/node; do
  [ -n "$cand" ] && [ -x "$cand" ] || continue
  major="$("$cand" -pe 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$major" -ge 24 ] 2>/dev/null; then EVE_NODE_DIR="$(dirname "$cand")"; break; fi
done
if [ -z "$EVE_NODE_DIR" ]; then
  echo "✖ Need Node >= 24 for the eve agent. Try: brew install node@24" >&2
  exit 1
fi
echo "→ eve will use node: $("$EVE_NODE_DIR/node" -v)"

pids=()
cleanup() { echo; echo "stopping…"; for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup INT TERM EXIT

# 1) Express API
npm run server & pids+=($!)

# 2) eve agent (build once, then start). Rebuild picks up agent/ changes.
( PATH="$EVE_NODE_DIR:$PATH" npx eve build && PATH="$EVE_NODE_DIR:$PATH" npx eve start --port 2000 ) & pids+=($!)

# 3) Vite UI
npm run dev & pids+=($!)

echo "→ open http://localhost:3333"
wait
