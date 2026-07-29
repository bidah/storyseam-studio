// GUARD: mutations go through updateDoc, not readDoc + writeDoc.
//
// CLAUDE.md: "`updateDoc` is a compare-and-swap on the row's `version` with
// jittered retry; a bare read-then-write is last-writer-wins and silently drops
// concurrent edits (a burst of parallel roster adds used to lose about half of
// them)." The damage is invisible — no error, no failed request, just changes
// that quietly aren't there. Nothing but a static check catches it.
//
// Two things are checked:
//
//   1. A module that calls BOTH readDoc and writeDoc is doing read-modify-write
//      by hand. That is the exact shape updateDoc exists to replace.
//   2. Any writeDoc call at all needs a justification, because a genuine
//      whole-document REPLACE is rare and worth naming. Annotate the call site
//      with `guard:allow-write-doc — <why>` in a comment directly above it.
//
// The annotation is deliberately inline rather than in a baseline file: the
// reason belongs next to the code it excuses, where the next person to touch it
// will actually read it.

import { walk, read, rel } from "./lib.mjs";

const ALLOW = /guard:allow-write-doc/;
// How far above a call to look for its annotation — enough for a short comment
// block, not enough for an unrelated one two functions up.
const ANNOTATION_WINDOW = 6;

export const name = "doc-mutations";
export const describe = "doc mutations use updateDoc, not readDoc + writeDoc";

export function run() {
  const violations = [];
  for (const file of walk("worker/src", [".js", ".ts"])) {
    // The storage primitive itself defines both — it is the thing being guarded,
    // not a consumer of it.
    if (rel(file).endsWith("worker/src/lib/docs.js")) continue;

    const text = read(file);
    const lines = text.split("\n");
    const writes = [...text.matchAll(/\bwriteDoc\(/g)].map(
      (m) => text.slice(0, m.index).split("\n").length,
    );
    if (!writes.length) continue;

    const unannotated = writes.filter((line) => {
      const from = Math.max(0, line - 1 - ANNOTATION_WINDOW);
      return !ALLOW.test(lines.slice(from, line).join("\n"));
    });

    for (const line of unannotated) {
      violations.push(
        `${rel(file)}:${line} calls writeDoc. Use updateDoc (compare-and-swap) for a ` +
          `mutation — a bare read-then-write is last-writer-wins and silently drops ` +
          `concurrent edits. If this really is a whole-document replace, say why in a ` +
          `\`guard:allow-write-doc — <reason>\` comment above the call.`,
      );
    }

    // Read-modify-write by hand, even if each half is individually annotated.
    if (/\breadDoc\(/.test(text) && unannotated.length) {
      violations.push(
        `${rel(file)} reads with readDoc and writes with writeDoc — that is a ` +
          `read-modify-write, which updateDoc does atomically. Convert it.`,
      );
    }
  }
  return violations;
}
