// GUARD: the published Remotion bundle matches the composition in this repo.
//
// The "Deliver" render doesn't run the code in src/editor/. It runs a webpack
// bundle baked at deploy time by worker/build-remotion-bundle.sh and parked in
// R2 at remotion-bundle/editor.tar.gz, which the sandbox curls back down. So a
// change to the composition reaches the PREVIEW immediately and the RENDER never
// — with no error anywhere. The render succeeds; it just delivers an mp4 built
// from whatever the composition looked like the last time someone remembered to
// run the script. That gap once ran three weeks (per-clip speed shipped, renders
// kept ignoring it), which is exactly the silent failure a guard is for.
//
// The bundle lives in a bucket, so it can't be diffed offline. Instead the
// upload stamps the composition it published into worker/remotion-bundle.stamp
// and this compares that against the sources now.
//
// Fix: worker/build-remotion-bundle.sh, then commit the refreshed stamp.

import { createHash } from "node:crypto";
import { join } from "node:path";
import { ROOT, read, exists } from "./lib.mjs";

// Everything webpack pulls into the "Editor" composition. RemotionRoot is the
// entry; Composition is what it renders; timeline.js is the model both read.
export const BUNDLE_SOURCES = [
  "src/editor/RemotionRoot.jsx",
  "src/editor/Composition.jsx",
  "src/editor/timeline.js",
];

export const STAMP_PATH = join(ROOT, "worker/remotion-bundle.stamp");

// Content hash of the composition as it stands right now. Order-stable and
// path-tagged, so moving a line between files still changes the hash.
export function compositionHash() {
  const h = createHash("sha256");
  for (const src of BUNDLE_SOURCES) {
    h.update(src);
    h.update("\0");
    h.update(exists(src) ? read(src) : "<missing>");
    h.update("\0");
  }
  return h.digest("hex");
}

export const name = "remotion-bundle";
export const describe = "the published Remotion bundle matches src/editor/";

export function run() {
  const missing = BUNDLE_SOURCES.filter((s) => !exists(s));
  if (missing.length) {
    return [`${missing.join(", ")} is missing — the guard's source list is stale.`];
  }
  if (!exists(STAMP_PATH)) {
    return [
      "worker/remotion-bundle.stamp is missing, so nothing records which composition the live " +
        "render bundle was built from. Run `worker/build-remotion-bundle.sh` and commit the stamp.",
    ];
  }
  let stamp;
  try {
    stamp = JSON.parse(read(STAMP_PATH));
  } catch (err) {
    return [`worker/remotion-bundle.stamp is not readable JSON (${err?.message || err}).`];
  }
  if (stamp.hash === compositionHash()) return [];
  return [
    `src/editor/ has changed since the render bundle was published (stamped ${stamp.builtAt || "unknown"}). ` +
      "The Deliver render is still using the OLD composition — it will succeed and be wrong. " +
      "Run `worker/build-remotion-bundle.sh` and commit worker/remotion-bundle.stamp.",
  ];
}
