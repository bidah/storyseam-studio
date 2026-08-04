// Record which composition the live Remotion bundle was built from.
//
// Run by worker/build-remotion-bundle.sh right after a successful upload to
// r2://shot-studio-uploads/remotion-bundle/editor.tar.gz. The stamp is the only
// link between the bundle sitting in R2 and the source in this repo — the
// `remotion-bundle` guard compares it against the current composition and fails
// when they've diverged.

import { writeFileSync } from "node:fs";
import { BUNDLE_SOURCES, STAMP_PATH, compositionHash } from "./guards/remotion-bundle.mjs";

const stamp = {
  hash: compositionHash(),
  sources: BUNDLE_SOURCES,
  builtAt: new Date().toISOString(),
};

writeFileSync(STAMP_PATH, `${JSON.stringify(stamp, null, 2)}\n`);
console.log(`[bundle] stamped ${stamp.hash.slice(0, 12)} — commit worker/remotion-bundle.stamp with this change`);
