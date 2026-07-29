// GUARD: app state never goes back into R2 as a JSON object.
//
// CLAUDE.md: "Per-project JSON state lives in D1, never as objects in R2." That
// rule was written the hard way — R2 has no versioning, no transactions and no
// conditional writes, so a `put` destroys the bytes it replaces with no way
// back, which is how a world bible was lost. Everything per-project now goes
// through worker/src/lib/docs.js into the `docs` table, where it gets CAS
// writes, doc_history, and D1 Time Travel.
//
// The regression is easy to make and invisible once made: `BUCKET.put(...json)`
// looks like every other storage call in the file. So flag any R2 write whose
// key looks like a JSON document. Media bytes — images, audio, video, uploads —
// are exactly what R2 is for and are untouched by this rule.

import { walk, read, rel } from "./lib.mjs";

// `env.BUCKET.put("state/foo.json", …)` / `.put(\`state/${id}.json\`, …)`.
// Matches the key argument only up to the first comma, so a JSON *body* passed
// to a media put doesn't false-positive.
const R2_PUT = /BUCKET\.put\(\s*([^,]*)/g;
const JSON_KEY = /\.json\b/;

export const name = "no-r2-json-state";
export const describe = "no per-project JSON state written to R2";

export function run() {
  const violations = [];
  for (const file of walk("worker/src", [".js", ".ts"])) {
    const text = read(file);
    const lines = text.split("\n");
    for (const match of text.matchAll(R2_PUT)) {
      const key = match[1];
      if (!JSON_KEY.test(key)) continue;
      const line = text.slice(0, match.index).split("\n").length;
      violations.push(
        `${rel(file)}:${line} writes a .json object to R2 (\`${lines[line - 1].trim()}\`). ` +
          `Per-project state belongs in D1 via lib/docs.js — R2 is for media bytes only.`,
      );
    }
  }
  return violations;
}
