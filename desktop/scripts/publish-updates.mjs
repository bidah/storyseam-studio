// Publish step for auto-update (TOO-27): upload the signed electron-builder
// artifacts + feed metadata from release/ to the existing R2 bucket, under
// desktop/updates/ — the Worker serves that prefix at /desktop/updates/* and
// electron-updater's generic provider points there. Run after `npm run
// desktop:dist` (or via the root `npm run desktop:publish`).
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const releaseDir = join(here, "..", "release");
const workerDir = join(here, "..", "..", "worker");
const BUCKET = "shot-studio-uploads";
const PREFIX = "desktop/updates/";

const CONTENT_TYPES = {
  ".yml": "text/yaml",
  ".zip": "application/zip",
  ".dmg": "application/x-apple-diskimage",
  ".blockmap": "application/octet-stream",
};

const wanted = (name) =>
  Object.keys(CONTENT_TYPES).some((ext) => name.endsWith(ext));

let files;
try {
  files = readdirSync(releaseDir).filter(
    (f) => wanted(f) && statSync(join(releaseDir, f)).isFile(),
  );
} catch {
  console.error(`No ${releaseDir} — run \`npm run desktop:dist\` first.`);
  process.exit(1);
}
if (!files.includes("latest-mac.yml")) {
  console.error("release/ has no latest-mac.yml — electron-builder didn't produce a feed.");
  process.exit(1);
}

// Artifacts first, the feed LAST — an updater that reads the new feed must
// already find the artifacts it points at.
files.sort((a, b) => (a === "latest-mac.yml") - (b === "latest-mac.yml"));

for (const f of files) {
  const ext = Object.keys(CONTENT_TYPES).find((e) => f.endsWith(e));
  console.log(`→ r2://${BUCKET}/${PREFIX}${f}`);
  execFileSync(
    "npx",
    [
      "wrangler", "r2", "object", "put", `${BUCKET}/${PREFIX}${f}`,
      "--file", join(releaseDir, f),
      "--content-type", CONTENT_TYPES[ext],
      "--remote",
    ],
    { cwd: workerDir, stdio: "inherit" },
  );
}
console.log(`\nPublished ${files.length} file(s) to ${PREFIX}`);
