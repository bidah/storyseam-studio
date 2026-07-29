// The agent half of the human-approval gate on destructive tools.
//
// The constraint that shapes all of this: flue cannot suspend a turn mid-tool
// call. There is no `approval_required` event to emit and no loop to park, so
// the only place a human can get a word in is BETWEEN turns — and the only
// thing that puts a word there is the `render_ui` round-trip, where a tap posts
// a string as the next user message. Every gated tool is therefore a two-phase
// call spanning two turns:
//
//   turn 1  tool(args)                 → nothing happens; a token is minted and
//                                        the model is told to draw a confirm card
//   ——— the author taps, which posts their confirmation as a user message ———
//   turn 2  tool({ approval_token })   → the token is burned and the action runs
//
// `consumeApproval` returns the params captured in phase one, and callers MUST
// act on those rather than on the model's phase-two input. That is the whole
// integrity story: the author said yes to the summary drawn from the stored
// params, so anything else executing would be consent laundering. It also keeps
// the confirming call cheap — `save_shotlist` does not have to re-emit an entire
// shot list, which is the exact payload that blows the model's output limit.
//
// The token is not a security boundary against a hostile model (it is handed
// straight to that model). It is a structural one: no token can be minted and
// redeemed inside a single turn's tool loop, so an irreversible write always
// has a user message sitting in front of it.
import type { Api, Json } from "./api.js";

/** What phase one captures while it waits for the author. */
export interface ApprovalRequest {
  /** Stable operation name — the SAME string must be presented on redemption. */
  op: string;
  /** One line naming the concrete consequence, in the author's own terms. */
  summary: string;
  /** The exact arguments to replay in phase two. */
  params: Json;
}

/** The minted gate, as the tool hands it back to the model. */
export interface GatedResult {
  approved: false;
  performed: false;
  approvalToken: string;
  op: string;
  summary: string;
  expiresAt: string;
  /** Label/value pairs for the confirm card, so the model invents no numbers. */
  facts: Record<string, string>;
  note: string;
  [key: string]: Json;
}

type Minted = { token: string; op: string; summary: string; expiresAt: string };
type Redeemed = { params?: Json };

/** Phase one — park the operation and get back the handle for the confirm card. */
export async function requestApproval(
  api: Api,
  req: ApprovalRequest,
  signal?: AbortSignal,
): Promise<Minted> {
  const res = await api.post<{
    token?: string;
    op?: string;
    summary?: string;
    expiresAt?: string;
  }>("/api/approvals", { op: req.op, summary: req.summary, params: req.params }, signal);
  if (!res?.token) {
    throw new Error(
      `Could not register the approval for "${req.op}" — the server returned no token, so nothing was done.`,
    );
  }
  return {
    token: res.token,
    op: res.op ?? req.op,
    summary: res.summary ?? req.summary,
    expiresAt: res.expiresAt ?? "",
  };
}

/**
 * Phase two — burn the token and get back the params the author actually
 * approved. Throws (rather than returning a soft failure) when the token is
 * unknown, expired, already spent, or was minted for a different operation:
 * every one of those means the destructive action is NOT authorised, and a
 * result the model could mistake for success is the worst possible answer.
 */
export async function consumeApproval<T = Json>(
  api: Api,
  token: unknown,
  op: string,
  signal?: AbortSignal,
): Promise<T> {
  const t = String(token ?? "").trim();
  if (!t) throw new Error(`No approval token supplied for "${op}".`);
  let res: Redeemed;
  try {
    res = await api.post<Redeemed>(
      `/api/approvals/${encodeURIComponent(t)}/approve`,
      { op },
      signal,
    );
  } catch (e) {
    throw new Error(
      `Approval "${t}" could not be redeemed for ${op}: ${String((e as Error)?.message ?? e)}. ` +
        `Nothing was changed. Ask the author again with a fresh ${op} call (no token) and a new confirm card — do NOT invent or reuse a token.`,
    );
  }
  return (res?.params ?? null) as T;
}

/**
 * Build phase one's return value: mint the token and hand the model an
 * unambiguous "this did NOT happen yet" payload.
 *
 * Everything the confirm card needs is IN this payload (`summary`, `facts`) so
 * the model never has to reconstruct a count or a name from memory — an
 * invented number on a confirmation card is worse than no card, because the
 * author approves a consequence that was never real.
 */
export async function gateAction(
  api: Api,
  req: ApprovalRequest & { facts?: Record<string, string> },
  signal?: AbortSignal,
): Promise<GatedResult> {
  const minted = await requestApproval(api, req, signal);
  return {
    approved: false,
    performed: false,
    approvalToken: minted.token,
    op: req.op,
    summary: req.summary,
    expiresAt: minted.expiresAt,
    facts: req.facts ?? {},
    note:
      `NOTHING HAS BEEN CHANGED. ${req.op} is destructive, so it needs the author's go-ahead first. ` +
      `Say in one short line what will happen, then call render_ui ONCE with a Card holding the facts above ` +
      `(a KeyValue block) and an Actions block: a primary Action with tone "danger" whose \`send\` is the author ` +
      `confirming in their own voice, and a plain Action to back out. Use ONLY the summary and facts above — ` +
      `invent no counts, names or ids. Then END YOUR TURN. When (and only when) their confirmation arrives as the ` +
      `next user message, call ${req.op} again with approval_token "${minted.token}" and it will run; ` +
      `the arguments you already sent are replayed from the approval, so you do not need to repeat them. ` +
      `If they decline, drop it and offer an alternative — do NOT call ${req.op} again.`,
  };
}
