#!/usr/bin/env bash
# Build + publish the prebuilt Remotion bundle used by the Daytona "Deliver"
# render (worker/src/routes/render.js). The sandbox can't run webpack, so this
# bundles src/editor/RemotionRoot.jsx here (composition id "Editor"), tars the
# output, and uploads it to R2 at remotion-bundle/editor.tar.gz — the key the
# render job curls back at ${WORKER_PUBLIC_URL}/files/remotion-bundle/editor.tar.gz.
#
# Run after ANY change to src/editor/{RemotionRoot,Composition,timeline}.* —
# otherwise the headless render keeps using stale composition code (e.g. it
# would ignore offsetFrames/trimBefore and render splits from source frame 0).
#
# Usage: worker/build-remotion-bundle.sh [--no-upload]
#   --no-upload  build + tar only; leaves the artifact at worker/editor.tar.gz
set -euo pipefail
cd "$(dirname "$0")/.." # repo root — @remotion/bundler comes from the root node_modules

BUCKET="shot-studio-uploads"
KEY="remotion-bundle/editor.tar.gz"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "[bundle] webpack-bundling src/editor/RemotionRoot.jsx …"
OUT_DIR="$WORK/bundle" node --input-type=module -e '
  import { bundle } from "@remotion/bundler";
  await bundle({
    entryPoint: "src/editor/RemotionRoot.jsx",
    outDir: process.env.OUT_DIR,
    onProgress: () => {},
  });
  console.log("[bundle] wrote", process.env.OUT_DIR);
'

# The render job extracts with `tar xzf b.tgz -C bundle`, so the tarball holds
# the bundle CONTENTS at its root (index.html + assets), not a wrapping dir.
echo "[bundle] packing editor.tar.gz …"
tar czf "$WORK/editor.tar.gz" -C "$WORK/bundle" .

if [[ "${1:-}" == "--no-upload" ]]; then
  cp "$WORK/editor.tar.gz" worker/editor.tar.gz
  echo "[bundle] wrote worker/editor.tar.gz (upload skipped)"
  exit 0
fi

echo "[bundle] uploading to r2://$BUCKET/$KEY …"
(cd worker && npx wrangler r2 object put "$BUCKET/$KEY" --file "$WORK/editor.tar.gz" --remote)
echo "[bundle] done — the render sandbox now pulls the fresh bundle from /files/$KEY"
