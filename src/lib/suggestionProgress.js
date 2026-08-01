// The client half of the completed-card ledger (worker/src/routes/suggestions.js
// holds the design). The RN twin is mobile-app/src/lib/suggestion-progress.ts —
// same two calls, same swallowed errors, different fetch layer.
//
//   startSuggestion  — on click, so the worker knows this card was STARTED and
//                      can later retire it as Completed instead of silently
//                      dropping it. It carries the copy the card was wearing,
//                      because that sentence is composed from a gap that is
//                      about to close ("3 of 148 shots have no still") and
//                      cannot be reconstructed once it has.
//   sweepSuggestions — on landing mount, which is what catches work the author
//                      did in the GUI rather than through the agent. The agent
//                      sweeps too, at the end of every run (flue-agent/src/app.ts),
//                      and that's the one that flips a card while the author is
//                      still watching; this is the backstop for everything else.
//
// NOTHING HERE MAY THROW INTO A RENDER PATH. A failed write costs a badge, and
// the landing must still open.

const post = async (path, body) => {
  await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
};

/** Record a clicked card. Resolves either way — errors are swallowed. */
export async function startSuggestion(s) {
  // A finished card doesn't click, so this should be unreachable for one; guard
  // anyway rather than letting a stray call re-open it in `started`.
  if (!s?.id || s.done) return;
  try {
    await post("/api/suggestions/start", {
      id: s.id,
      kind: s.kind,
      title: s.title,
      blurb: s.blurb,
    });
  } catch {
    /* see above */
  }
}

/** Flip any started card whose gap has since closed. Resolves either way. */
export async function sweepSuggestions() {
  try {
    await post("/api/suggestions/reconcile");
  } catch {
    /* see above */
  }
}
