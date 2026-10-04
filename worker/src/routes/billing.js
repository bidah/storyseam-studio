// Billing routes — the PayPal subscription and the credit balance.
//
//   GET  /api/billing            the caller's plan, subscription and balance
//   POST /api/billing/subscribe  { plan } — start a subscription →
//                                { approveUrl } to send the author to PayPal
//   POST /api/billing/sync       re-read the subscription from PayPal (the
//                                return page calls it so the status is right
//                                before the webhook lands)
//   POST /api/billing/cancel     cancel the active subscription
//   POST /api/billing/usage      the flue agent reports one model call's
//                                tokens; the cost is priced HERE
//                                (lib/billing-plans.js), never trusted from
//                                the body. Agent credential only.
//   POST /api/billing/webhook    PayPal → us. No user: its credential is the
//                                PayPal signature, verified before anything
//                                is written.
//
// USER-scoped, not project-scoped: /api/billing is exempt from the ownership
// middleware (index.js) and every route but the webhook 401s without a userId
// itself, the same shape as /api/auto/allowance.
import {
  billingSummary,
  latestSubscription,
  saveSubscription,
  syncSubscription,
  applyWebhookEvent,
  recordUsage,
  planAllowed,
} from "../lib/billing.js";
import { planByKey, paypalPlanIds } from "../lib/billing-plans.js";
import {
  paypalMissing,
  createSubscription,
  cancelSubscription,
  verifyWebhook,
} from "../lib/paypal.js";

const LIVE = new Set(["APPROVAL_PENDING", "APPROVED", "ACTIVE", "SUSPENDED"]);

function needUser(c) {
  const userId = c.get("userId");
  return userId ? null : c.json({ error: "Sign in required" }, 401);
}

function notConfigured(c) {
  const missing = paypalMissing(c.env);
  return missing.length
    ? c.json({ error: `Billing is not configured yet (missing ${missing.join(", ")})`, missing }, 503)
    : null;
}

// Only a same-origin path may be a return target — never a full URL a caller
// chose, or the PayPal round-trip becomes an open redirect.
function returnTarget(c, path, fallback) {
  const p = typeof path === "string" && path.startsWith("/") && !path.startsWith("//") ? path : fallback;
  return new URL(p, new URL(c.req.url).origin).toString();
}

export function registerBilling(app) {
  app.get("/api/billing", async (c) => {
    const denied = needUser(c);
    if (denied) return denied;
    const userId = c.get("userId");
    const [summary, allowed] = await Promise.all([billingSummary(c.env, userId), planAllowed(c.env, userId)]);
    return c.json({
      configured: paypalMissing(c.env).length === 0,
      ...summary,
      // May this user make Films and projects (lib/billing.js planAllowed)?
      canCreate: allowed.ok,
    });
  });

  app.post("/api/billing/subscribe", async (c) => {
    const denied = needUser(c) || notConfigured(c);
    if (denied) return denied;
    const userId = c.get("userId");
    const body = await c.req.json().catch(() => ({}));

    const plan = planByKey(body.plan);
    const paypalPlanId = plan && paypalPlanIds(c.env)[plan.key];
    if (!paypalPlanId) return c.json({ error: `Unknown or unavailable plan "${body.plan}"` }, 400);

    const current = await latestSubscription(c.env, userId);
    if (current?.status === "ACTIVE") {
      return c.json(
        { error: "You already have an active subscription — cancel it before switching plans", subscription: current },
        409,
      );
    }

    const returnPath = body.returnPath || "/";
    const { subscription, approveUrl } = await createSubscription(c.env, {
      planId: paypalPlanId,
      userId,
      returnUrl: returnTarget(c, `${returnPath}${returnPath.includes("?") ? "&" : "?"}billing=return`, "/?billing=return"),
      cancelUrl: returnTarget(c, `${returnPath}${returnPath.includes("?") ? "&" : "?"}billing=cancel`, "/?billing=cancel"),
    });
    // Recorded BEFORE the author approves, so the webhook that follows always
    // finds its owner here rather than leaning on custom_id alone.
    await saveSubscription(c.env, {
      subscriptionId: subscription.id,
      userId,
      planId: paypalPlanId,
      planKey: plan.key,
      status: subscription.status || "APPROVAL_PENDING",
    });
    return c.json({ approveUrl, subscriptionId: subscription.id });
  });

  app.post("/api/billing/sync", async (c) => {
    const denied = needUser(c) || notConfigured(c);
    if (denied) return denied;
    const userId = c.get("userId");
    const body = await c.req.json().catch(() => ({}));
    const id = body.subscriptionId || (await latestSubscription(c.env, userId))?.subscription_id;
    if (!id) return c.json({ error: "No subscription to sync" }, 404);
    try {
      await syncSubscription(c.env, id, userId);
    } catch (e) {
      return c.json({ error: String(e.message || e) }, e.status === 403 ? 403 : 502);
    }
    return c.json({ configured: true, ...(await billingSummary(c.env, userId)) });
  });

  app.post("/api/billing/cancel", async (c) => {
    const denied = needUser(c) || notConfigured(c);
    if (denied) return denied;
    const userId = c.get("userId");
    const current = await latestSubscription(c.env, userId);
    if (!current || !LIVE.has(current.status)) {
      return c.json({ error: "No active subscription to cancel" }, 404);
    }
    await cancelSubscription(c.env, current.subscription_id);
    await syncSubscription(c.env, current.subscription_id, userId);
    return c.json({ configured: true, ...(await billingSummary(c.env, userId)) });
  });

  app.post("/api/billing/usage", async (c) => {
    const userId = c.get("userId");
    if (!userId || c.get("caller") !== "agent") return c.json({ error: "Agent credential required" }, 401);
    const body = await c.req.json().catch(() => ({}));
    if (!body.ref || !body.usage) return c.json({ error: "ref and usage are required" }, 400);
    const micros = await recordUsage(c.env, userId, {
      model: body.model,
      usage: body.usage,
      ref: String(body.ref).slice(0, 200),
    });
    return c.json({ ok: true, chargedMicros: micros });
  });

  app.post("/api/billing/webhook", async (c) => {
    if (paypalMissing(c.env).length) return c.json({ error: "Billing not configured" }, 503);
    let event;
    try {
      event = await c.req.json();
    } catch {
      return c.json({ error: "Bad JSON" }, 400);
    }
    let ok = false;
    try {
      ok = await verifyWebhook(c.env, c.req.raw.headers, event);
    } catch (e) {
      // PayPal unreachable: a 5xx makes PayPal retry the delivery later.
      console.error("[billing] webhook verification errored", e);
      return c.json({ error: "Verification unavailable" }, 503);
    }
    if (!ok) return c.json({ error: "Invalid signature" }, 401);
    const result = await applyWebhookEvent(c.env, event);
    console.log(`[billing] ${event.event_type} ${event.id}: ${result}`);
    return c.json({ ok: true });
  });
}
