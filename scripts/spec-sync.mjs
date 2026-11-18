#!/usr/bin/env node
// Vendors the open-source Storyseam engine (github.com/bidah/storyseam, checked
// out beside this repo as ../storyseam, or wherever STORYSEAM_DIR points) into
// public/spec/, which the Worker serves as static assets under /spec/*:
//
//   /spec/storyseam.md   the storyseam.md specification   (docs/spec.md)
//   /spec/agent.md       the agent prompt                 (docs/agent.md)
//   /spec/template.md    a blank storyseam.md             (docs/storyseam.template.md)
//   /spec/example.md     a rendered story's storyseam.md  (test/storyseam.md)
//   /spec/storyseam.tgz  the whole engine, `npm pack`ed — `npx -y <url> init`
//   /spec/skills.json    every skill, specialist, command, schema and doc, with
//                        a raw url and the path it belongs at in a story
//   /spec/files/...      those raw files
//
// The /spec page (src/routes/spec.jsx) reads skills.json for its file list.
// Re-run after any change in the storyseam repo: `npm run spec:sync`.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const src = path.resolve(process.env.STORYSEAM_DIR || path.join(root, "..", "storyseam"));
const out = path.join(root, "public", "spec");
const ORIGIN = "https://storyseam.app";

if (!fs.existsSync(path.join(src, "docs", "spec.md"))) {
  console.error(`spec:sync: no storyseam checkout at ${src} (set STORYSEAM_DIR)`);
  process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const copy = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
};

copy(path.join(src, "docs", "spec.md"), path.join(out, "storyseam.md"));
copy(path.join(src, "docs", "agent.md"), path.join(out, "agent.md"));
copy(path.join(src, "docs", "storyseam.template.md"), path.join(out, "template.md"));
copy(path.join(src, "test", "storyseam.md"), path.join(out, "example.md"));

// The engine tarball. A stable name, so the url in the agent prompt never moves.
const packed = execFileSync("npm", ["pack", "--silent", "--pack-destination", out], { cwd: src, encoding: "utf8" })
  .trim()
  .split("\n")
  .pop();
fs.renameSync(path.join(out, packed), path.join(out, "storyseam.tgz"));

// The file list: what a hand-built story needs, at Claude Code's paths
// (`init --agent codex|cursor` maps .claude/skills -> .storyseam/skills).
const files = [];
const walk = (dir, kind, dest) => {
  const abs = path.join(src, dir);
  if (!fs.existsSync(abs)) return;
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    if (ent.name.startsWith(".")) continue;
    const rel = path.join(dir, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) walk(rel, kind, to);
    else add(rel, kind, to);
  }
};
const add = (rel, kind, dest) => {
  // No dot-directories in the SERVED path (`.claude/` -> `claude/`): static
  // asset uploads skip dotfiles, and the target path is in the manifest anyway.
  const served = path.posix.join("files", ...dest.split(path.sep).map((seg) => seg.replace(/^\./, "")));
  copy(path.join(src, rel), path.join(out, served));
  files.push({ kind, path: dest.split(path.sep).join("/"), url: `${ORIGIN}/spec/${served}` });
};

const pkg = JSON.parse(fs.readFileSync(path.join(src, "package.json"), "utf8"));
const PIPELINE = pkg.files
  .filter((f) => f.startsWith(".claude/skills/"))
  .map((f) => f.replace(/^\.claude\/skills\//, "").replace(/\/$/, ""));
for (const name of PIPELINE) walk(path.join(".claude", "skills", name), "skill", path.join(".claude", "skills", name));
// Model directors and provider adapters come from the registry's sources.
for (const name of fs.readdirSync(path.join(src, "registry", "sources"))) {
  const skill = path.join("registry", "sources", name, "SKILL.md");
  if (fs.existsSync(path.join(src, skill))) add(skill, "registry", path.join(".claude", "skills", name, "SKILL.md"));
}
walk(path.join(".claude", "agents"), "specialist", path.join(".claude", "agents"));
walk(path.join(".claude", "commands"), "command", path.join(".claude", "commands"));
walk("schema", "schema", "schema");
walk(path.join("docs", "adr"), "doc", path.join("docs", "adr"));
for (const doc of ["spec.md", "storyseam.template.md", "specialist-contract.md"]) {
  add(path.join("docs", doc), "doc", path.join("docs", doc));
}

const manifest = {
  name: "storyseam",
  version: pkg.version,
  spec: `${ORIGIN}/spec/storyseam.md`,
  agent_prompt: `${ORIGIN}/spec/agent.md`,
  install: `npx -y ${ORIGIN}/spec/storyseam.tgz init <folder>`,
  tarball: `${ORIGIN}/spec/storyseam.tgz`,
  repository: "https://github.com/bidah/storyseam",
  note: "Paths are Claude Code's. Skills reference engine scripts under bin/; installing with the tarball rewrites those to `npx storyseam`, a hand-copied tree keeps them as written.",
  files,
};
fs.writeFileSync(path.join(out, "skills.json"), JSON.stringify(manifest, null, 2) + "\n");

const counts = files.reduce((m, f) => ((m[f.kind] = (m[f.kind] || 0) + 1), m), {});
console.log(`spec:sync: ${src} -> public/spec (v${pkg.version})`, counts);
