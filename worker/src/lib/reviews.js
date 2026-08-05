// Which script specialists have already looked at the screenplay — the ledger.
//
// The agent's script "doctors" (flue-agent/src/subagents/*) are advisors: they
// read the pinned draft, hand back findings, and the root applies them. Nothing
// used to record that a pass HAPPENED, so neither the app nor the agent could
// tell "plot-doctor has never seen this script" from "plot-doctor cleared it an
// hour ago". That's the state the chat's suggestion cards need to offer the
// right next move, so it lives in D1 like every other per-project doc (the
// `script-reviews` row) rather than in the agent's conversation memory — which
// is per-chat, and would forget the moment the user started a new chat.
//
// One entry per specialist. Keyed by specialist rather than by draft on purpose:
// a review isn't invalidated by `new_draft` (which copies the pinned draft
// verbatim — the doctor's findings still apply), it's invalidated by the script
// CHANGING. So each entry snapshots the draft + `updatedAt` it read, and a pass
// whose snapshot no longer matches the pinned draft reads as STALE ("the script
// moved since its last pass") rather than never-run.
//
// ── v2: the entry remembers more than the last pass ────────────────────────
// The ledger used to store the LATEST pass and nothing else, which threw away
// the only evidence of whether the script was getting better. Two additions:
//
//   `history` — every previous pass, newest FIRST, the current one at [0]. It's
//     what makes "the plot doctor found 9 things, then 4, then 1" visible, and
//     it's the audit trail behind a stale badge ("cleared on Draft 2, and the
//     script has moved twice since"). CAPPED at 10 because this row is read on
//     every /api/status — the cheapest digest in the app — and an uncapped list
//     of 600-char summaries across a 15-strong roster would quietly turn a
//     counts-and-flags payload into a fat one. Ten passes is far more than any
//     one doctor gets on a single script; older ones are aggregate noise, and
//     `passes` keeps the true lifetime count regardless.
//
//   `notes` — the newest pass's findings as STRUCTURE ({severity, where, issue,
//     fix}) rather than only a count. `findings: 4` tells a surface a badge
//     colour; the notes let the Script Agents board render the four actual
//     problems without asking the model to say them again. Capped at 24: past
//     that a "pass" is really a rewrite, and the list stops being a checklist.
//
// Entries written before v2 have none of these fields; `normalizeEntry` fills
// them in on read (a pre-v2 entry reads as one pass, no notes, and a
// single-element history synthesised from its own top-level fields) so no
// migration has to run and nothing downstream sees an undefined.
import { readDoc, updateDoc } from "./docs.js";
import { SPECIALIST_IDS, isSpecialistId } from "./specialists.ts";

// The roster is defined ONCE, in the vendored specialists.ts, and derived here.
// It used to be a hardcoded array of four ids in this file, which meant adding a
// doctor took an edit in every surface that had its own copy. Re-exported under
// the old name so existing importers (routes/script.js, the MCP server) keep
// working, and in the roster's canonical order — the ordering is load-bearing:
// the landing deck and the Script Agents board both take the head of `pending`,
// so "which doctor do we offer next" is decided by this list's order.
export const SPECIALISTS = SPECIALIST_IDS;

const FALLBACK = { reviews: {} };
const str = (v) => (v == null ? "" : String(v));

// How many passes we keep per specialist, and how many structured notes we keep
// off the newest pass. See the header for why both are bounded.
const HISTORY_CAP = 10;
const NOTES_CAP = 24;
const SEVERITIES = ["high", "medium", "low"];

export const isSpecialist = (id) => isSpecialistId(str(id));

export const readReviews = (env, pid) => readDoc(env, pid, "script-reviews", FALLBACK);

// One structured finding, clamped. Shared with the route that accepts them, so
// what a caller may send and what the ledger may hold are the same rule in one
// place. A member that isn't an object with an `issue` is DROPPED rather than
// rejected: a doctor that formats one note badly should still get its pass
// logged, and half a checklist beats losing the record of the whole pass.
export function cleanNotes(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const issue = str(item.issue).trim().slice(0, 400);
    if (!issue) continue;
    const sev = str(item.severity).trim().toLowerCase();
    out.push({
      severity: SEVERITIES.includes(sev) ? sev : "medium",
      where: str(item.where).trim().slice(0, 160),
      issue,
      fix: str(item.fix).trim().slice(0, 400),
    });
    if (out.length >= NOTES_CAP) break;
  }
  return out;
}

// The snapshot fields one pass carries — the draft it read and what it found.
// `summary` is the doctor's own one-liner; `findings` is how many issues it
// raised (0 = it read the draft and had nothing to fix, which is a real and
// useful result — not the same as never having run).
function normalizePass(raw) {
  const e = raw && typeof raw === "object" ? raw : {};
  const findings = Number(e.findings);
  return {
    at: str(e.at) || null,
    draftId: str(e.draftId) || null,
    draftName: str(e.draftName) || null,
    scriptUpdatedAt: str(e.scriptUpdatedAt) || null,
    summary: str(e.summary),
    findings: Number.isFinite(findings) ? Math.max(0, Math.round(findings)) : null,
  };
}

// Newest first, capped. A pre-v2 entry has no `history` at all, so its own
// top-level fields ARE its history — synthesise the single element rather than
// returning [], or the board would show "1 pass" with nothing behind it.
function normalizeHistory(raw, current) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const item of list) {
    const pass = normalizePass(item);
    if (!pass.at) continue; // a passless entry is noise, not history
    out.push(pass);
    if (out.length >= HISTORY_CAP) break;
  }
  if (!out.length && current.at) return [current];
  return out;
}

// Normalize one stored entry. Never throws: anything unrecognised degrades to
// the empty shape, because a single malformed row must not take down the status
// digest that reads this on every screen's first paint.
function normalizeEntry(raw) {
  const e = raw && typeof raw === "object" ? raw : {};
  const current = normalizePass(e);
  const count = Number(e.passes);
  return {
    ...current,
    // Pre-v2 entries have no count. They recorded exactly one pass (the write
    // was an overwrite), so that's what they read back as.
    passes: Number.isFinite(count) && count > 0
      ? Math.round(count)
      : (current.at ? 1 : 0),
    notes: cleanNotes(e.notes),
    history: normalizeHistory(e.history, current),
  };
}

// Record one specialist's pass. MERGES with what's there: the previous entry
// becomes history, the lifetime `passes` count goes up by one, and the new pass
// takes the top-level fields. Compare-and-swap, because a chain of doctors can
// finish within milliseconds of each other and a bare read-then-write would drop
// all but the last — which with a merge is worse than before, since it would
// lose the losers' history too, not just their latest row.
export function recordReview(env, pid, specialist, entry) {
  return updateDoc(env, pid, "script-reviews", FALLBACK, (doc) => {
    doc.reviews = doc.reviews || {};
    const prev = normalizeEntry(doc.reviews[specialist]);
    const pass = normalizePass(entry);
    const merged = {
      ...pass,
      passes: prev.passes + 1,
      notes: cleanNotes(entry?.notes),
      // The new pass IS history[0] — a surface that renders the history list
      // never has to special-case "and also the current one".
      history: [pass, ...(prev.at ? prev.history : [])].slice(0, HISTORY_CAP),
    };
    doc.reviews[specialist] = merged;
    return { entry: merged };
  });
}

// The shape the app and the agent both read: every specialist bucketed against
// the CURRENT pinned draft.
//
//   pending — no pass on record at all
//   stale   — passed, but on another draft or before the latest edit
//   fresh   — passed on this draft at its current revision
//
// A script with no content at all has nothing to review, so everything is
// `pending` and callers are expected to gate on `script.exists` first.
//
// `latest[id]` carries the newest pass plus its `passes` count and `notes`;
// the per-specialist `history` is returned in its own map rather than nested
// inside `latest` so a caller that only wants the badges doesn't have to walk
// (or ship) the whole ledger twice.
export function reviewState(doc, { pinnedId = null, scriptUpdatedAt = null } = {}) {
  const stored = doc?.reviews && typeof doc.reviews === "object" ? doc.reviews : {};
  const latest = {};
  const passes = {};
  const history = {};
  const pending = [];
  const stale = [];
  const fresh = [];
  let totalPasses = 0;
  // Canonical roster order — see the SPECIALISTS re-export above for why the
  // iteration order is part of the contract, not an implementation detail.
  for (const id of SPECIALISTS) {
    const entry = stored[id] ? normalizeEntry(stored[id]) : null;
    const { history: entryHistory, ...head } = entry || {};
    latest[id] = entry ? head : null;
    passes[id] = entry?.passes || 0;
    history[id] = entryHistory || [];
    totalPasses += passes[id];
    if (!entry?.at) {
      pending.push(id);
      continue;
    }
    // Missing snapshot fields (an entry written by an older tool) can't be
    // proven current, so they read as stale rather than silently fresh.
    const sameDraft = !!pinnedId && entry.draftId === pinnedId;
    const sameRevision = !!scriptUpdatedAt && entry.scriptUpdatedAt === scriptUpdatedAt;
    if (sameDraft && sameRevision) fresh.push(id);
    else stale.push(id);
  }
  return {
    latest,
    pending,
    stale,
    fresh,
    passes,
    history,
    totals: {
      pending: pending.length,
      stale: stale.length,
      fresh: fresh.length,
      passes: totalPasses,
    },
  };
}

// The ledger trimmed to what a DIGEST may carry: buckets, latest-pass summaries
// and the pass tallies stay; per-specialist `history` and the newest pass's
// structured `notes` are dropped.
//
// `reviewState` returns the whole v2 ledger, which is right for
// /api/script/reviews (and the agent's `get_script_reviews`) and wrong for every
// other caller. `/api/status` is fetched on every screen's first paint and
// `get_script` is the agent's most-called read — shipping fifteen specialists'
// pass history and up to 24 structured notes each through either of them
// multiplies a counts-and-flags payload for data neither one reads. One place to
// fetch the full ledger, one shape for everyone else.
export function digestReviews(state) {
  const { history, latest, ...rest } = state;
  const heads = {};
  for (const id of Object.keys(latest || {})) {
    if (!latest[id]) {
      heads[id] = null;
      continue;
    }
    const { notes, ...head } = latest[id];
    heads[id] = head;
  }
  return { ...rest, latest: heads };
}
