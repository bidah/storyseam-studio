// Storage for the completed-card ledger behind "Continue building your story".
// The ROUTES and the sweep live in routes/suggestions.js (which is also where
// the design is written down); this holds only the row's name, shape and reads.
//
// Split out because both routes/suggestions.js and routes/status.js need to
// read it, and routes/suggestions.js already imports `buildStatus` from
// status.js — putting the read there too would make that a cycle. A cycle whose
// only saving grace is that every use is inside a function body is not one to
// leave lying around.
import { readDoc } from "./docs.js";

export const SUGGESTIONS_DOC = "suggestions";

export const LEDGER_FALLBACK = { source: "suggestions", started: {}, completed: [] };

// How many finished cards the row remembers. The deck shows three
// (MAX_COMPLETED in src/lib/suggestions.ts); the surplus is kept so that a card
// coming back open — pin a new draft and its doctor is pending again — doesn't
// permanently cost the ledger its older entries when it's re-completed later.
export const LEDGER_CAP = 20;

/** The whole row, normalized to the shape the rest of the code assumes. */
export async function readLedger(env, pid) {
  const doc = await readDoc(env, pid, SUGGESTIONS_DOC, null);
  return {
    started: doc?.started && typeof doc.started === "object" ? doc.started : {},
    completed: Array.isArray(doc?.completed) ? doc.completed : [],
  };
}

/**
 * The completed list as `buildStatus` carries it into the digest — the shape
 * `Status.suggestions` is typed for in src/lib/suggestions.ts, and the deck
 * reads it straight from there rather than paying for a second fetch on the
 * landing screen's first paint.
 */
export async function readCompletedSuggestions(env, pid) {
  const { completed } = await readLedger(env, pid);
  return completed.slice(0, LEDGER_CAP);
}
