// Billing — a PayPal subscription per user, and the credit ledger it pays into.
//
// The subscription is the money; the ledger is what the money buys: agent
// usage, metered as the Workers AI cost of every model call the chat agent
// makes for the user, marked up by the plan (lib/billing-plans.js) so the
// credit shown can be the plan's full price. All amounts are
// micro-USD, so one call costing a fraction of a cent still lands exactly.
//
// A MONTHLY allowance, not a wallet. Each paid cycle (PAYMENT.SALE.COMPLETED)
// resets the balance to the plan's credit: an `adjust` row cancels whatever
// was left (unused credit, or usage from before the subscription), then a
// `grant` row adds the month's credit. Both are keyed by the sale id, so a
// webhook PayPal re-delivers is a no-op. Usage rows are keyed by the model
// call (`turn:<instance>:<turn>`) for the same reason.
//
// Per-USER platform data, so D1 tables (billing_subscriptions, billing_ledger —
// worker/schema.sql), never `docs` rows. Read and written ONLY here.

import { getSubscription } from "./paypal.js";
import { PLANS, planByKey, planByPaypalId, paypalPlanIds, callCostMicros, approxTokens } from "./billing-plans.js";

const now = () => new Date().toISOString();

/** The user's newest subscription row, or null. */
export async function latestSubscription(env, userId) {
  return env.DB.prepare(
    "SELECT * FROM billing_subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
  )
    .bind(userId)
    .first();
}

async function subscriptionById(env, id) {
  return env.DB.prepare("SELECT * FROM billing_subscriptions WHERE subscription_id = ?").bind(id).first();
}

/** Insert or refresh one subscription row. */
export async function saveSubscription(env, { subscriptionId, userId, planId, planKey, status, nextBillingAt }) {
  const t = now();
  await env.DB.prepare(
    `INSERT INTO billing_subscriptions (subscription_id, user_id, plan_id, plan_key, status, next_billing_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(subscription_id) DO UPDATE SET
       status = excluded.status,
       plan_key = COALESCE(excluded.plan_key, billing_subscriptions.plan_key),
       next_billing_at = COALESCE(excluded.next_billing_at, billing_subscriptions.next_billing_at),
       updated_at = excluded.updated_at`,
  )
    .bind(subscriptionId, userId, planId, planKey ?? null, status, nextBillingAt ?? null, t, t)
    .run();
}

/**
 * Re-read a subscription from PayPal and store its status. `userId`, when
 * given, must own it — a caller can't sync someone else's id into their
 * account by naming it.
 */
export async function syncSubscription(env, subscriptionId, userId) {
  const known = await subscriptionById(env, subscriptionId);
  const sub = await getSubscription(env, subscriptionId);
  const owner = known?.user_id || sub?.custom_id;
  if (!owner) throw new Error("Subscription has no owner on record");
  if (userId && owner !== userId) {
    const err = new Error("That subscription belongs to another account");
    err.status = 403;
    throw err;
  }
  await saveSubscription(env, {
    subscriptionId,
    userId: owner,
    planId: sub.plan_id,
    planKey: planByPaypalId(env, sub.plan_id)?.key,
    status: sub.status,
    nextBillingAt: sub.billing_info?.next_billing_time ?? null,
  });
  return subscriptionById(env, subscriptionId);
}

const insertLedger = (env, { userId, amountMicros, kind, model = null, tokens = null, ref = null, note = null }) =>
  env.DB.prepare(
    "INSERT OR IGNORE INTO billing_ledger (user_id, amount_micros, kind, model, tokens, ref, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(userId, Math.round(amountMicros), kind, model, tokens, ref, note, now());

export async function balanceMicros(env, userId) {
  const row = await env.DB.prepare(
    "SELECT COALESCE(SUM(amount_micros), 0) AS n FROM billing_ledger WHERE user_id = ?",
  )
    .bind(userId)
    .first();
  return Number(row?.n) || 0;
}

/** Usage since the last grant (the current paid month), or all-time without one. */
async function periodUsage(env, userId) {
  const row = await env.DB.prepare(
    `SELECT COALESCE(-SUM(amount_micros), 0) AS micros, COALESCE(SUM(tokens), 0) AS tokens
       FROM billing_ledger
      WHERE user_id = ? AND kind = 'usage'
        AND created_at >= COALESCE(
          (SELECT MAX(created_at) FROM billing_ledger WHERE user_id = ? AND kind = 'grant'), '')`,
  )
    .bind(userId, userId)
    .first();
  return { micros: Number(row?.micros) || 0, tokens: Number(row?.tokens) || 0 };
}

/** Reset the balance to one cycle of `plan`'s credit, idempotent per sale. */
export async function grantCycle(env, userId, plan, saleId, note) {
  const balance = await balanceMicros(env, userId);
  const [reset, grant] = await env.DB.batch([
    insertLedger(env, { userId, amountMicros: -balance, kind: "adjust", ref: `reset:${saleId}`, note: "Monthly reset" }),
    insertLedger(env, { userId, amountMicros: plan.creditMicros, kind: "grant", ref: `paypal-sale:${saleId}`, note }),
  ]);
  return Number(grant?.meta?.changes) > 0 || Number(reset?.meta?.changes) > 0;
}

/**
 * Charge one agent model call. Idempotent per `ref`. Returns the micros
 * charged (0 for a duplicate).
 */
export async function recordUsage(env, userId, { model, usage, ref }) {
  // Charged at the user's plan markup (billing-plans.js); without a plan, at
  // Starter's — that usage is wiped by the first payment's reset anyway.
  const sub = await latestSubscription(env, userId);
  const plan = planByKey(sub?.plan_key) || PLANS[0];
  const micros = Math.ceil(callCostMicros(model, usage) * plan.markup);
  const tokens =
    Number(usage?.totalTokens) ||
    (Number(usage?.input) || 0) + (Number(usage?.output) || 0) + (Number(usage?.cacheRead) || 0);
  const res = await insertLedger(env, {
    userId,
    amountMicros: -micros,
    kind: "usage",
    model: String(model || "").slice(0, 120),
    tokens,
    ref,
  }).run();
  return Number(res?.meta?.changes) > 0 ? micros : 0;
}

const planView = (p, env) => ({
  key: p.key,
  name: p.name,
  price: p.price,
  creditMicros: p.creditMicros,
  approxTokens: approxTokens(p.budgetMicros),
  available: Boolean(paypalPlanIds(env)[p.key]),
});

/** What GET /api/billing answers for one user. */
export async function billingSummary(env, userId) {
  const [sub, balance, used] = await Promise.all([
    latestSubscription(env, userId),
    balanceMicros(env, userId),
    periodUsage(env, userId),
  ]);
  const plan = sub?.plan_key ? planByKey(sub.plan_key) : null;
  return {
    plans: PLANS.map((p) => planView(p, env)),
    enforced: env.BILLING_ENFORCED === "1",
    subscription: sub
      ? {
          id: sub.subscription_id,
          plan: plan ? planView(plan, env) : null,
          status: sub.status,
          nextBillingAt: sub.next_billing_at,
          updatedAt: sub.updated_at,
        }
      : null,
    active: sub?.status === "ACTIVE",
    balanceMicros: balance,
    period: { usedMicros: used.micros, usedTokens: used.tokens },
  };
}

/**
 * May this user start an agent turn? Always yes unless BILLING_ENFORCED = "1";
 * then they need an active subscription with credit left.
 */
export async function agentAllowed(env, userId) {
  if (env.BILLING_ENFORCED !== "1") return { ok: true };
  const [sub, balance] = await Promise.all([latestSubscription(env, userId), balanceMicros(env, userId)]);
  if (sub?.status !== "ACTIVE") {
    return { ok: false, message: "The agent needs a subscription — pick a plan in Settings › Subscription." };
  }
  if (balance <= 0) {
    return { ok: false, message: "You've used this month's agent credit. It renews with your next payment, or move to a bigger plan in Settings › Subscription." };
  }
  return { ok: true };
}

/**
 * May this user MAKE something — start a Film, create a project? Unlike
 * agentAllowed this is not behind BILLING_ENFORCED: the app needs a plan to be
 * used at all. An ACTIVE subscription passes; so does an email listed in
 * BILLING_EXEMPT_EMAILS (comma-separated — the studio's own accounts).
 * → { ok } or { ok: false, code: "plan", message }
 */
export async function planAllowed(env, userId) {
  const sub = await latestSubscription(env, userId);
  if (sub?.status === "ACTIVE") return { ok: true };
  const exempt = String(env.BILLING_EXEMPT_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (exempt.length) {
    const row = await env.DB.prepare('SELECT email FROM "user" WHERE id = ?').bind(userId).first();
    if (row?.email && exempt.includes(String(row.email).toLowerCase())) return { ok: true };
  }
  return { ok: false, code: "plan", message: "Choose a plan to start making stories." };
}

const SUBSCRIPTION_EVENTS = new Set([
  "BILLING.SUBSCRIPTION.CREATED",
  "BILLING.SUBSCRIPTION.ACTIVATED",
  "BILLING.SUBSCRIPTION.UPDATED",
  "BILLING.SUBSCRIPTION.EXPIRED",
  "BILLING.SUBSCRIPTION.CANCELLED",
  "BILLING.SUBSCRIPTION.SUSPENDED",
  "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
]);

/**
 * Apply one VERIFIED webhook event. Returns a short label for the log.
 * Unknown event types are acknowledged and ignored, so PayPal stops retrying.
 */
export async function applyWebhookEvent(env, event) {
  const type = event?.event_type;
  const r = event?.resource || {};

  if (SUBSCRIPTION_EVENTS.has(type)) {
    if (!r.id) return "ignored: no subscription id";
    const known = await subscriptionById(env, r.id);
    const userId = known?.user_id || r.custom_id;
    if (!userId) return "ignored: unknown subscription";
    await saveSubscription(env, {
      subscriptionId: r.id,
      userId,
      planId: r.plan_id || known?.plan_id || "",
      planKey: planByPaypalId(env, r.plan_id)?.key,
      status: r.status || known?.status || "UNKNOWN",
      nextBillingAt: r.billing_info?.next_billing_time ?? null,
    });
    return `subscription ${r.id} → ${r.status}`;
  }

  if (type === "PAYMENT.SALE.COMPLETED") {
    const subscriptionId = r.billing_agreement_id;
    if (!subscriptionId) return "ignored: sale is not a subscription payment";
    const known = await subscriptionById(env, subscriptionId);
    const userId = known?.user_id || r.custom;
    if (!userId) return "ignored: unknown subscription";
    const plan = planByKey(known?.plan_key) || planByPaypalId(env, known?.plan_id);
    if (!plan) return `ignored: subscription ${subscriptionId} has no known plan`;
    const added = await grantCycle(
      env,
      userId,
      plan,
      r.id,
      `${plan.name} payment ${r.amount?.total ?? ""} ${r.amount?.currency ?? ""} (${subscriptionId})`.trim(),
    );
    return added ? `granted ${plan.key} to ${userId}` : "duplicate sale";
  }

  return `ignored: ${type}`;
}
