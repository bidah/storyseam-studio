// Human-approval gate for the agent's destructive tools — the server half.
//
// flue cannot suspend a turn mid-tool-call. A tool's `run` either returns or it
// doesn't; there is no "pause here and wait for a human" the way agent-native
// emits an `approval_required` event and parks its loop. The one thing that CAN
// wait for the author is the `render_ui` transcript round-trip — the agent draws
// a card, the author taps it, and the tap posts a string as the next USER
// message. That round-trip IS our suspend mechanism, and this document is what
// makes it binding instead of advisory.
//
// Without a server-side token the gate would be pure prompt text, and prompt
// text is not a gate: a model that decided to call the tool twice inside one
// turn would blow the shot list away regardless. So a destructive tool called
// with NO token performs nothing at all — it only mints a pending op here — and
// the second call has to present that token back. A token can only be minted in
// one turn and redeemed in another, and a later turn exists only because a user
// message arrived to start it.
//
// Two properties this file has to hold, both learned from how these failures
// actually look:
//
//   • SINGLE USE. Approving DELETES the entry. An agent that retries a failing
//     step three times must not get three deletions out of one tap, and a stale
//     token left lying in the transcript must not still be spendable tomorrow.
//   • THE APPROVED PARAMS ARE THE EXECUTED PARAMS. `approve` hands back the
//     arguments captured when the op was requested, and the tool acts on those —
//     never on whatever the model re-typed on the confirming call. Otherwise a
//     card that read "delete version 3" could be redeemed as "delete version 1",
//     and the author's yes would have authorised something they never saw.
//
// Pending ops live in the `approvals` doc row like every other piece of
// per-project state. They are deliberately NOT durable beyond half an hour: an
// approval is consent to a specific action in a specific conversational moment,
// so an unanswered one should rot rather than sit around waiting to be spent
// against a project that has moved on.
import { readDoc, updateDoc } from "../lib/docs.js";

const DOC = "approvals";
const EMPTY = { pending: [] };

// How long a mint stays spendable. Long enough that the author can wander off
// mid-turn and come back; short enough that the state it describes ("the list
// has 42 shots, this drops it to 12") is probably still true when it's redeemed.
const TTL_MS = 30 * 60 * 1000;

// Ceiling on live entries, applied after expiry pruning. This doc is written by
// the agent, not by a human clicking, so a loop that gates the same op over and
// over is the realistic way it grows — the cap makes that self-healing instead
// of unbounded. Oldest go first; the one the author is actually looking at is
// always the newest.
const MAX_PENDING = 20;

const expiresAt = (createdAt) =>
  new Date(Date.parse(createdAt) + TTL_MS).toISOString();

// Drop expired and malformed entries and cap the survivors. Runs on every read
// AND every write, so the doc can't grow without bound and a read can never
// report an op that is already too old to spend.
function prune(list, now) {
  const live = (Array.isArray(list) ? list : []).filter(
    (e) =>
      e &&
      typeof e.token === "string" &&
      now - Date.parse(e.createdAt) < TTL_MS, // NaN for junk → false → dropped
  );
  return live.slice(-MAX_PENDING);
}

// The short, unguessable handle the model carries between the two calls. Short
// because it round-trips through the model's context twice and a full UUID is
// noise; unguessable because it is the only thing standing between a tool call
// and an irreversible write.
const mintToken = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);

export function registerApprovals(app) {
  // Live pending ops. Exists so the outstanding gate is inspectable — by the
  // agent (did I already ask about this?), and by a human debugging a card that
  // never came back.
  //
  // `params` is deliberately withheld: it can be an entire shot list, and
  // nothing that lists gates needs to read the payload — only `approve` does,
  // and only once.
  app.get("/api/approvals", async (c) => {
    const doc = await readDoc(c.env, c.get("projectId"), DOC, null);
    const pending = prune(doc?.pending, Date.now()).map((e) => ({
      token: e.token,
      op: e.op,
      summary: e.summary,
      createdAt: e.createdAt,
      expiresAt: expiresAt(e.createdAt),
    }));
    return c.json({ pending });
  });

  // Register a pending op. This is phase one of every gated tool call: the tool
  // has decided WHAT it would do, captured the arguments, and is now handing the
  // decision to the author instead of executing.
  app.post("/api/approvals", async (c) => {
    let body;
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON body" }, 400); }
    const op = String(body?.op || "").trim();
    if (!op) return c.json({ error: "op required" }, 400);
    // The summary is what the author is shown and what they are consenting to,
    // so an entry without one is a gate that can't be presented honestly.
    const summary = String(body?.summary || "").trim();
    if (!summary) return c.json({ error: "summary required" }, 400);

    const entry = {
      token: mintToken(),
      op,
      summary,
      params: body?.params ?? null,
      createdAt: new Date().toISOString(),
    };
    await updateDoc(c.env, c.get("projectId"), DOC, EMPTY, (doc) => {
      doc.pending = prune(doc.pending, Date.now());
      doc.pending.push(entry);
    });
    return c.json({
      token: entry.token,
      op: entry.op,
      summary: entry.summary,
      createdAt: entry.createdAt,
      expiresAt: expiresAt(entry.createdAt),
    });
  });

  // Redeem a pending op: hand back the arguments the author approved and burn
  // the token in the same compare-and-swap, so the read and the consume can't
  // interleave with a second redemption of the same token.
  //
  // An `op` in the body is checked against the mint. A token is scoped to the
  // operation it was created for — carrying `stitch_cuts`'s token into
  // `restore_version` must fail loudly, not quietly authorise the wrong thing.
  // A mismatch ABORTS (no write), so the real approval survives for its own tool.
  app.post("/api/approvals/:token/approve", async (c) => {
    const token = c.req.param("token");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const wantOp = String(body?.op || "").trim();

    const res = await updateDoc(c.env, c.get("projectId"), DOC, EMPTY, (doc) => {
      const live = prune(doc.pending, Date.now());
      const found = live.find((e) => e.token === token);
      if (!found) {
        return { abort: true, status: 404, error: `No pending approval "${token}" — it was already used, expired, or never existed.` };
      }
      if (wantOp && found.op !== wantOp) {
        return { abort: true, status: 409, error: `Approval "${token}" was granted for "${found.op}", not "${wantOp}".` };
      }
      doc.pending = live.filter((e) => e.token !== token);
      return { entry: found };
    });
    if (res.abort) return c.json({ error: res.error }, res.status);

    return c.json({
      ok: true,
      op: res.entry.op,
      summary: res.entry.summary,
      params: res.entry.params ?? null,
      requestedAt: res.entry.createdAt,
    });
  });
}
