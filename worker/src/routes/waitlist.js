// The waitlist surface (lib/waitlist.js holds the rules).
//
//   POST /api/waitlist               PUBLIC — the "join the waitlist" form. No
//                                    account; rate-limited per IP. Sends no
//                                    mail, so the form can't be used to spam
//                                    someone else's inbox.
//   GET  /api/waitlist/me            the signed-in user's standing
//                                    ({ access, onWaitlist, email }); adds them
//                                    to the list if they aren't on it. The
//                                    client calls it after sign-in and hard-
//                                    redirects to /waitlist on access: false.
//   GET  /api/waitlist/admin         counts (total / waiting / invited / unsent)
//   POST /api/waitlist/admin/batch   open a batch: { count?, emails?, send? }
//                                    invites the oldest `count` waiting (and any
//                                    named emails), then — unless send: false —
//                                    mails every invited-but-unsent row now
//                                    instead of waiting for the cron.
//
// The admin routes carry their own bearer (WAITLIST_ADMIN_TOKEN, a wrangler
// secret). UNSET = the admin routes are CLOSED, the same rule as MCP_TOKEN.
import {
  normalizeEmail, joinWaitlist, standingFor, inviteBatch, sendPendingInvites, waitlistStats,
} from "../lib/waitlist.js";

const JOIN_LIMIT = 20; // joins per IP per hour

async function rateLimited(c) {
  const kv = c.env.AUTH_KV;
  if (!kv) return false;
  const ip = c.req.header("cf-connecting-ip") || "unknown";
  const key = `waitlist:rl:${ip}:${Math.floor(Date.now() / 3600e3)}`;
  const n = Number((await kv.get(key)) || 0);
  if (n >= JOIN_LIMIT) return true;
  await kv.put(key, String(n + 1), { expirationTtl: 3700 });
  return false;
}

function adminAuthed(c) {
  const token = c.env.WAITLIST_ADMIN_TOKEN;
  return !!token && c.req.header("authorization") === `Bearer ${token}`;
}

export function registerWaitlist(app) {
  app.post("/api/waitlist", async (c) => {
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const email = normalizeEmail(body?.email);
    if (!email) return c.json({ error: "Enter a valid email address." }, 400);
    if (await rateLimited(c)) return c.json({ error: "Too many requests — try again later." }, 429);
    await joinWaitlist(c.env, email);
    // Same answer whether or not they were already on it: the form shouldn't
    // tell a stranger which addresses are signed up.
    return c.json({ ok: true });
  });

  app.get("/api/waitlist/me", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in required" }, 401);
    return c.json(await standingFor(c.env, userId));
  });

  app.get("/api/waitlist/admin", async (c) => {
    if (!adminAuthed(c)) return c.json({ error: "Unauthorized" }, 401);
    return c.json(await waitlistStats(c.env));
  });

  app.post("/api/waitlist/admin/batch", async (c) => {
    if (!adminAuthed(c)) return c.json({ error: "Unauthorized" }, 401);
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const count = Math.max(0, Math.min(500, Number(body?.count) || 0));
    const emails = (Array.isArray(body?.emails) ? body.emails : []).map(normalizeEmail).filter(Boolean);
    if (!count && !emails.length && body?.send === false) {
      return c.json({ error: "Nothing to do — pass count, emails, or leave send on to mail pending invites." }, 400);
    }
    const invited = await inviteBatch(c.env, { count, emails });
    const mail = body?.send === false ? null : await sendPendingInvites(c.env, { limit: 500 });
    return c.json({ invited, mail, stats: await waitlistStats(c.env) });
  });
}
