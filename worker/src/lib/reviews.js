// Which script specialists have already looked at the screenplay.
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
// One entry per specialist, LATEST pass only. Keyed by specialist rather than by
// draft on purpose: a review isn't invalidated by `new_draft` (which copies the
// pinned draft verbatim — the doctor's findings still apply), it's invalidated by
// the script CHANGING. So each entry snapshots the draft + `updatedAt` it read,
// and a pass whose snapshot no longer matches the pinned draft reads as STALE
// ("the script moved since its last pass") rather than never-run.
import { readDoc, updateDoc } from "./docs.js";

// The four top-level script specialists, in the order a script usually wants
// them: structure first, then causality, then coherence, then the lines. Ids
// match the flue agent profile names (flue-agent/src/subagents.ts) so the tool
// that records a pass can send its own name.
export const SPECIALISTS = [
  "story_architect",
  "motivation_doctor",
  "plot_doctor",
  "dialogue_doctor",
];

const FALLBACK = { reviews: {} };
const str = (v) => (v == null ? "" : String(v));

export const isSpecialist = (id) => SPECIALISTS.includes(str(id));

export const readReviews = (env, pid) => readDoc(env, pid, "script-reviews", FALLBACK);

// Record (or overwrite) one specialist's latest pass. Compare-and-swap, because
// a chain of doctors can finish within milliseconds of each other and a bare
// read-then-write would drop all but the last.
export function recordReview(env, pid, specialist, entry) {
  return updateDoc(env, pid, "script-reviews", FALLBACK, (doc) => {
    doc.reviews = doc.reviews || {};
    doc.reviews[specialist] = entry;
    return { entry };
  });
}

// Normalize one stored entry. `summary` is the doctor's own one-liner; `findings`
// is how many issues it raised (0 = it read the draft and had nothing to fix,
// which is a real and useful result — not the same as never having run).
function normalizeEntry(raw) {
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

// The shape the app and the agent both read: every specialist bucketed against
// the CURRENT pinned draft.
//
//   pending — no pass on record at all
//   stale   — passed, but on another draft or before the latest edit
//   fresh   — passed on this draft at its current revision
//
// A script with no content at all has nothing to review, so everything is
// `pending` and callers are expected to gate on `script.exists` first.
export function reviewState(doc, { pinnedId = null, scriptUpdatedAt = null } = {}) {
  const stored = doc?.reviews && typeof doc.reviews === "object" ? doc.reviews : {};
  const latest = {};
  const pending = [];
  const stale = [];
  const fresh = [];
  for (const id of SPECIALISTS) {
    const entry = stored[id] ? normalizeEntry(stored[id]) : null;
    latest[id] = entry;
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
  return { latest, pending, stale, fresh };
}
