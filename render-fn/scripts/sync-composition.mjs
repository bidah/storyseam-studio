// Copy the editor's Remotion composition from the app (../src/editor) into this
// standalone function's vendored `remotion/` dir, so the deployed bundle renders
// exactly what the app renders. Run before every deploy (`npm run deploy` does).
//
// Why vendor? Vercel only deploys files under this project (render-fn/). The
// composition can't be referenced at ../src/editor at bundle time because that
// path isn't part of the deployment. These three files are self-contained
// (they import only `react` + `remotion`), so a straight copy is enough.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "..", "..", "src", "editor");
const DST = path.resolve(__dirname, "..", "remotion");
const FILES = ["RemotionRoot.jsx", "Composition.jsx", "timeline.js"];

const BANNER = (name) =>
  `// VENDORED from shot-studio/src/editor/${name} — keep in sync via ` +
  `\`npm run sync\` (scripts/sync-composition.mjs). Do not edit by hand.\n`;

if (!fs.existsSync(SRC)) {
  console.error(`[sync] source dir not found: ${SRC}`);
  console.error("[sync] run this from inside the shot-studio repo (needs ../src/editor).");
  process.exit(1);
}

fs.mkdirSync(DST, { recursive: true });
for (const name of FILES) {
  const from = path.join(SRC, name);
  const to = path.join(DST, name);
  if (!fs.existsSync(from)) {
    console.error(`[sync] missing source file: ${from}`);
    process.exit(1);
  }
  const original = fs.readFileSync(from, "utf8");
  fs.writeFileSync(to, BANNER(name) + "\n" + original);
  console.log(`[sync] ${name} → remotion/${name}`);
}
console.log("[sync] done. Vendored composition is up to date.");
