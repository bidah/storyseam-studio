// /api/suggestions — the COMPLETED-CARD LEDGER behind "Continue building your
// story" (src/lib/suggestions.ts, rendered by the web AgentChat landing and the
// mobile Chat tab).
//
// The deck is derived: each card exists only while its own gap is open, so a
// card used to vanish the moment the work landed. That threw away the one piece
// of feedback the author had. They tap "Write your script", the agent works for
// twenty minutes, they come back — and the card is simply gone, which looks
// exactly like a card that never applied to this project in the first place.
// Nothing on the screen says "you did that". So a card the author STARTED
// retires VISIBLY: same artwork, same headline, under a scrim and badged
// Completed, until three newer wins push it off the end.
//
// Two documents' worth of state, one row:
//
//   started   — cards the author tapped, by id, each with the copy it wore at
//               the moment of the tap. A card nobody ever started can't
//               complete: a project whose script already existed before this
//               feature shipped must not open on a wall of Completed cards for
//               work the author never watched happen.
//   completed — the ones whose gap has since closed, newest first.
//
// WHAT DECIDES "DONE" is the pipeline, not the model. `reconcile` re-derives the
// digest and asks `openGapIds` which cards still have work outstanding; a
// started card that is no longer among them is done. That means the ledger
// cannot drift from what the deck shows (both read the same pure function), it
// records work finished through the GUI just as happily as work the agent did,
// and a model that hallucinates "I've completed the storyboard" can't write that
// claim into the database — the shots either have stills or they don't.
//
// WHO CALLS IT: the flue agent at the end of every run (flue-agent/src/app.ts
// subscribes to the runtime's `run_end` event — a real lifecycle hook, not an
// instruction the model has to remember), and the landing screen when it loads
// the deck, which is what catches work done entirely in the GUI.
import { updateDoc } from "../lib/docs.js";
import { buildStatus } from "./status.js";
import { openGapIds, isCompletable } from "../lib/suggestions.ts";
import {
  SUGGESTIONS_DOC as DOC,
  LEDGER_FALLBACK as FALLBACK,
  LEDGER_CAP,
  readLedger,
} from "../lib/suggestion-ledger.js";

// The copy a completed card wears is a SNAPSHOT, because a live card's copy is
// composed from its gap: "3 of 148 shots have no still" is a sentence that only
// exists while the gap does. Clipped because it's stored per project and read
// on every landing paint.
const clip = (s, n) => {
  const t = String(s ?? "").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/**
 * Flip every started card whose gap has closed. Shared by the route and any
 * other caller that wants the sweep without an HTTP hop.
 *
 * Returns the ids that flipped THIS call (empty on the common no-op path, which
 * is also the path that skips the write entirely).
 */
export async function reconcileSuggestions(env, pid) {
  const { started } = await readLedger(env, pid);
  const startedIds = Object.keys(started);
  // Nothing has ever been started here — the overwhelmingly common case, and
  // the agent calls this at the end of EVERY run, so it must cost one row read
  // and stop. No status build, no write.
  if (!startedIds.length) return [];

  const status = await buildStatus(env, pid);
  const open = new Set(openGapIds(status));
  const closed = startedIds.filter((id) => !open.has(id) && isCompletable(id));
  if (!closed.length) return [];

  const at = new Date().toISOString();
  // updateDoc, not readDoc + writeDoc: a run ending while the author taps a
  // second card is exactly the concurrent-write case CAS exists for, and the
  // loser here would silently drop one of the two.
  await updateDoc(env, pid, DOC, FALLBACK, (d) => {
    d.started = d.started && typeof d.started === "object" ? d.started : {};
    d.completed = Array.isArray(d.completed) ? d.completed : [];
    for (const id of closed) {
      // Re-read from the doc rather than trusting the snapshot taken before the
      // CAS: another writer may have refreshed the copy in between.
      const s = d.started[id];
      if (!s) continue;
      delete d.started[id];
      // A card can complete twice (a doctor re-reads a new draft). Keep one
      // entry, at its newest completion, rather than stacking duplicates.
      d.completed = d.completed.filter((c) => c?.id !== id);
      d.completed.unshift({
        id,
        kind: s.kind || null,
        title: s.title || "",
        blurb: s.blurb || "",
        at,
        startedAt: s.at || null,
      });
    }
    d.completed = d.completed.slice(0, LEDGER_CAP);
    d.source = "suggestions";
    d.updatedAt = at;
    return {};
  });
  return closed;
}

export function registerSuggestions(app) {
  // The ledger, for debugging and for the agent's own read.
  app.get("/api/suggestions", async (c) => {
    const { started, completed } = await readLedger(c.env, c.get("projectId"));
    return c.json({
      started: Object.entries(started).map(([id, v]) => ({ id, ...v })),
      completed,
    });
  });

  // A card was tapped. The body carries the copy it was WEARING, because that
  // sentence is composed from a gap that is about to close and cannot be
  // re-derived afterwards.
  app.post("/api/suggestions/start", async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const id = String(body?.id || "").trim();
    if (!id) return c.json({ error: "Body must be { id, kind?, title?, blurb? }" }, 400);
    // The evergreen cards ("Where does it stand?") have no gap to close, so
    // tracking one would park it in `started` forever. Accepted, not rejected —
    // the surfaces shouldn't have to special-case which of their cards is which.
    if (!isCompletable(id)) return c.json({ ok: true, tracked: false });

    const at = new Date().toISOString();
    await updateDoc(c.env, c.get("projectId"), DOC, FALLBACK, (d) => {
      d.started = d.started && typeof d.started === "object" ? d.started : {};
      const prev = d.started[id];
      d.started[id] = {
        kind: String(body?.kind || "") || prev?.kind || null,
        title: clip(body?.title, 120) || prev?.title || "",
        blurb: clip(body?.blurb, 400) || prev?.blurb || "",
        // Re-tapping refreshes the COPY (the newer wording is closer to what
        // actually got done) but keeps the original timestamp — "started" means
        // the first time, or a card retried twice would look freshly begun.
        at: prev?.at || at,
        chatId: String(body?.chatId || "") || prev?.chatId || null,
      };
      d.source = "suggestions";
      d.updatedAt = at;
      return {};
    });
    return c.json({ ok: true, tracked: true });
  });

  // The sweep. Idempotent and cheap on the no-op path, which is what lets the
  // agent fire it at the end of every single run.
  app.post("/api/suggestions/reconcile", async (c) => {
    try {
      const pid = c.get("projectId");
      const completed = await reconcileSuggestions(c.env, pid);
      return c.json({ ok: true, completed });
    } catch (e) {
      return c.json({ error: String(e.message || e) }, 500);
    }
  });
}
