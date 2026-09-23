/**
 * Vendor the Director's shared model into the two packages that can't import
 * across the repo root.
 *
 *   src/lib/series.ts      →  worker/src/lib/series.ts
 *   src/lib/shot-sheet.ts  →  flue-agent/src/lib/shot-sheet.ts   (and so on)
 *
 * Run after editing the canonical file:  npm run series:sync
 *
 * WHY THIS ONE MATTERS MORE THAN THE OTHER SYNCS. Every number in this file is
 * a ceiling the Director endpoint enforces, and it enforces them by refusing
 * the WHOLE session at `configure` — after the cue sheet was saved, after the
 * frames were drawn, and after the author pressed play. The form checks them
 * while a sheet is being typed, the Worker checks them on the way in, and the
 * agent checks them before it spends a sitting. Three checks, one list. A
 * drifted copy means the form promises a sheet the endpoint will refuse.
 *
 * Unlike `plugins.ts` these files are NOT import-free. The allowed set is
 * `ALLOWED_IMPORTS` below and the check enforces it, because an import that
 * resolves in Vite and not under wrangler fails at DEPLOY time, in the package
 * nobody was looking at.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The Director's shared modules, and where each one lands. `shot-sheet.ts`
// travels with `series.ts` because it is written against it: the sheet's rules
// ARE the Series' ceilings, restated as "which pins fit in one clip".
// `music-plan.ts` is here for the same reason one step later — a composition
// plan is refused by fal whole, so the page, the Worker and the agent check it
// with one function.
const MODULES = ["series.ts", "shot-sheet.ts", "music-plan.ts"];
const PACKAGES = ["worker", "flue-agent"];

/**
 * What these files may reach for.
 *
 * `zod` because all three packages depend on it at the same major. `./series`
 * because the copy lands beside its sibling in every target, so the relative
 * path resolves identically in Vite, wrangler and the flue build. Anything else
 * — a `@/` alias, a path out of this directory — resolves in exactly one of the
 * three and breaks in the other two, silently, at deploy time.
 */
const ALLOWED_IMPORTS = new Set(["zod", "./series"]);

const banner = (module) =>
  `// VENDORED from src/lib/${module} — DO NOT EDIT HERE.\n` +
  "// Edit the canonical file, then run `npm run series:sync`\n" +
  "// (scripts/sync-series.mjs).\n";

for (const module of MODULES) {
  const source = path.join(ROOT, "src/lib", module);
  if (!fs.existsSync(source)) throw new Error(`missing canonical source: ${source}`);

  const body = fs.readFileSync(source, "utf8");
  for (const match of body.matchAll(/^\s*import[^;]*?from\s*["']([^"']+)["']/gm)) {
    const specifier = match[1];
    if (ALLOWED_IMPORTS.has(specifier)) continue;
    throw new Error(
      `src/lib/${module} imports "${specifier}". It is vendored verbatim into two packages ` +
        `that cannot resolve this repo's module graph — only ${[...ALLOWED_IMPORTS].join(", ")} ` +
        `resolve in all three.`,
    );
  }

  const next = banner(module) + "\n" + body;
  for (const pkg of PACKAGES) {
    const target = path.join(ROOT, pkg, "src/lib", module);
    const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
    if (current === next) {
      console.log(`series: ${path.relative(ROOT, target)} already up to date.`);
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, next);
    console.log(`series: ${module} → ${path.relative(ROOT, target)}`);
  }
}
