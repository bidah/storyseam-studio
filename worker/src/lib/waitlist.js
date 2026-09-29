// The waitlist — early access, opened a few people at a time.
//
// One row per email in the `waitlist` table (schema.sql). A person may use the
// app when their row has `invited = 1`; that is the whole rule, and hasAccess()
// is the only place it is decided. Everyone else who signs in is added to the
// list (source "signin") and the client sends them to /waitlist, so "you're
// already on the waitlist" is true by the time they read it.
//
// Two flags, two steps. Opening a batch (inviteBatch) flips `invited` on the
// oldest N rows; sending the "you're in" email is a SEPARATE step
// (sendPendingInvites) that mails every row invited but not yet sent and flips
// `invitation_sent` per successful send. The cron runs that sweep every five
// minutes, so a row flipped by hand in SQL gets its email too, and a failed
// send is simply retried on the next tick.
//
// Enforcement is switched by the WAITLIST_ENFORCED var ("1" = on). Off, every
// signed-in user has access and nothing is gated — the list still fills.
import { sendWaitlistInviteEmail } from "./email.js";

export function waitlistEnforced(env) {
  return String(env?.WAITLIST_ENFORCED || "") === "1";
}

export function normalizeEmail(raw) {
  const email = String(raw || "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

const now = () => new Date().toISOString();

// Per-isolate cache of the access answer. The gate asks on every /api request,
// and a D1 round trip each time would be pure overhead for an answer that
// changes once per person. A "yes" is kept for 5 minutes (it never flips back
// in practice); a "no" for 30 seconds, so an invite takes effect almost at once.
const cache = new Map();
const YES_MS = 5 * 60e3;
const NO_MS = 30e3;

export async function hasAccess(env, userId) {
  if (!waitlistEnforced(env)) return true;
  if (!userId) return false;
  const hit = cache.get(userId);
  if (hit && hit.until > Date.now()) return hit.ok;
  let ok = false;
  try {
    const row = await env.DB.prepare(
      `SELECT w.invited AS invited FROM "user" u JOIN waitlist w ON w.email = lower(u.email) WHERE u.id = ?`,
    ).bind(userId).first();
    ok = row?.invited === 1;
  } catch (err) {
    // No table yet (migration not applied): fail OPEN rather than lock every
    // user out of the app over a missing migration. Not cached.
    console.error("waitlist: access check failed:", err?.message || err);
    return true;
  }
  cache.set(userId, { ok, until: Date.now() + (ok ? YES_MS : NO_MS) });
  return ok;
}

// The signed-in user's standing, adding them to the list if they aren't on it.
// Returns { access, onWaitlist, email }.
export async function standingFor(env, userId) {
  const user = await env.DB.prepare(`SELECT id, email FROM "user" WHERE id = ?`).bind(userId).first();
  const email = normalizeEmail(user?.email);
  if (!email) return { access: await hasAccess(env, userId), onWaitlist: false, email: null };
  await env.DB.prepare(
    `INSERT INTO waitlist (email, user_id, source, created_at) VALUES (?, ?, 'signin', ?)
     ON CONFLICT(email) DO UPDATE SET user_id = COALESCE(waitlist.user_id, excluded.user_id)`,
  ).bind(email, userId, now()).run();
  cache.delete(userId);
  return { access: await hasAccess(env, userId), onWaitlist: true, email };
}

// The public form. Idempotent: joining twice keeps the original place in line.
export async function joinWaitlist(env, email) {
  const res = await env.DB.prepare(
    `INSERT OR IGNORE INTO waitlist (email, source, created_at) VALUES (?, 'form', ?)`,
  ).bind(email, now()).run();
  return { added: (res?.meta?.changes || 0) > 0 };
}

// Let an address straight in, with no "you're in" email — the caller has sent
// its own (an org invite, whose mail IS the invitation).
export async function grantAccess(env, email, source) {
  const at = now();
  await env.DB.prepare(
    `INSERT INTO waitlist (email, source, invited, invited_at, invitation_sent, invitation_sent_at, created_at)
     VALUES (?, ?, 1, ?, 1, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       invited = 1,
       invited_at = COALESCE(waitlist.invited_at, excluded.invited_at),
       invitation_sent = 1,
       invitation_sent_at = COALESCE(waitlist.invitation_sent_at, excluded.invitation_sent_at)`,
  ).bind(email, source, at, at, at).run();
  cache.clear();
}

// Open a batch: the oldest `count` people still waiting, and/or named emails
// (added to the list if they weren't on it). Only flips `invited`; the email
// goes out through sendPendingInvites.
export async function inviteBatch(env, { count = 0, emails = [] } = {}) {
  const at = now();
  const invited = [];
  for (const email of emails) {
    await env.DB.prepare(
      `INSERT INTO waitlist (email, source, invited, invited_at, created_at) VALUES (?, 'admin', 1, ?, ?)
       ON CONFLICT(email) DO UPDATE SET invited = 1, invited_at = COALESCE(waitlist.invited_at, excluded.invited_at)`,
    ).bind(email, at, at).run();
    invited.push(email);
  }
  if (count > 0) {
    const { results } = await env.DB.prepare(
      `UPDATE waitlist SET invited = 1, invited_at = ?
       WHERE email IN (SELECT email FROM waitlist WHERE invited = 0 ORDER BY created_at ASC LIMIT ?)
       RETURNING email`,
    ).bind(at, count).all();
    for (const r of results || []) invited.push(r.email);
  }
  cache.clear();
  return invited;
}

// Mail every row that is invited but hasn't had its email, oldest invite
// first, at most `limit` per call. A failed send leaves the row unsent, so the
// next sweep retries it.
export async function sendPendingInvites(env, { limit = 50 } = {}) {
  const { results } = await env.DB.prepare(
    `SELECT email FROM waitlist WHERE invited = 1 AND invitation_sent = 0 ORDER BY invited_at ASC LIMIT ?`,
  ).bind(limit).all();
  const appUrl = (env.WORKER_PUBLIC_URL || "https://storyseam.app").replace(/\/+$/, "") + "/login";
  const sent = [];
  const failed = [];
  for (const { email } of results || []) {
    const r = await sendWaitlistInviteEmail(env, { email, appUrl });
    if (r.sent) {
      await env.DB.prepare(
        `UPDATE waitlist SET invitation_sent = 1, invitation_sent_at = ? WHERE email = ?`,
      ).bind(now(), email).run();
      sent.push(email);
    } else {
      failed.push({ email, reason: r.reason });
    }
  }
  return { sent, failed };
}

export async function waitlistStats(env) {
  return env.DB.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN invited = 0 THEN 1 ELSE 0 END) AS waiting,
       SUM(CASE WHEN invited = 1 THEN 1 ELSE 0 END) AS invited,
       SUM(CASE WHEN invited = 1 AND invitation_sent = 0 THEN 1 ELSE 0 END) AS unsent
     FROM waitlist`,
  ).first();
}
