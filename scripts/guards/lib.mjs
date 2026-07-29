// Shared plumbing for the guard scripts.
//
// A guard is a small module exporting `{ name, describe, run }`. `run` returns
// an array of violation strings — empty means the rule holds. The runner
// (scripts/run-guards.mjs) collects them all and exits non-zero if any fired, so
// one broken rule doesn't hide the rest.
//
// Guards exist because CLAUDE.md's rules are the kind that fail SILENTLY: the
// build passes, the tests pass, and the app is subtly wrong until someone
// notices weeks later (a vendored copy left stale, an /api route the agent can't
// reach, a mutation that quietly drops concurrent edits). A rule nobody can
// forget is worth more than a rule written down well.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const rel = (p) => relative(ROOT, p).split("\\").join("/");

export function read(p) {
  return readFileSync(p.startsWith("/") ? p : join(ROOT, p), "utf8");
}

export function exists(p) {
  return existsSync(p.startsWith("/") ? p : join(ROOT, p));
}

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".output", ".vercel",
  "coverage", ".expo", "ios", "android", ".wrangler", "test-results",
]);

// Every file under `dir` whose name matches one of `exts`. Depth-first, with the
// usual build/vendor directories pruned.
export function walk(dir, exts, out = []) {
  const abs = dir.startsWith("/") ? dir : join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const entry of readdirSync(abs)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(abs, entry);
    if (statSync(full).isDirectory()) {
      walk(full, exts, out);
    } else if (exts.some((e) => entry.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

// A generated/vendored file carries a banner and then the source verbatim. To
// compare it against its origin we strip every leading comment line plus the
// blank line the banner writers add, then normalise trailing whitespace.
export function stripBanner(text) {
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length && (lines[i].startsWith("//") || lines[i].trim() === "")) i++;
  return lines.slice(i).join("\n").trimEnd();
}

// Baselines record violations that already existed when a guard was written, so
// the rule can start blocking NEW ones immediately instead of waiting on a
// refactor. One violation per line; `#` comments and blanks ignored.
//
// A baseline is a debt ledger, not an exemption list: the guard reports when an
// entry no longer fires so the line gets deleted rather than lingering forever.
export function loadBaseline(name) {
  const p = join(ROOT, "scripts/guards/baselines", `${name}.txt`);
  if (!existsSync(p)) return new Set();
  return new Set(
    readFileSync(p, "utf8")
      .split("\n")
      .map((l) => l.replace(/#.*$/, "").trim())
      .filter(Boolean),
  );
}

// Apply a baseline to a set of found violations. Returns the ones that must
// fail, plus any baseline entries that no longer occur (stale debt to delete).
export function applyBaseline(name, found) {
  const baseline = loadBaseline(name);
  const foundSet = new Set(found.map((f) => (typeof f === "string" ? f : f.key)));
  return {
    violations: found.filter((f) => !baseline.has(typeof f === "string" ? f : f.key)),
    stale: [...baseline].filter((b) => !foundSet.has(b)),
  };
}
