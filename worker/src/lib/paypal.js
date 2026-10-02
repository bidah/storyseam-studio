// PayPal REST transport — the few calls billing needs, nothing more.
//
// Config (wrangler.jsonc vars + secrets):
//   PAYPAL_ENV            "sandbox" (default) | "live" — picks the API host.
//   PAYPAL_CLIENT_ID      the REST app's client id      (secret)
//   PAYPAL_CLIENT_SECRET  the REST app's secret         (secret)
//   PAYPAL_WEBHOOK_ID     the webhook registered on that app; signature
//                         verification is checked against it (secret)
//   PAYPAL_PLAN_IDS       {"starter":"P-…",…} — lib/billing-plans.js (var)
//
// Sandbox and live are separate apps with separate credentials, plans and
// webhooks — switching PAYPAL_ENV means switching all of them together.
//
// The token is cached per isolate until a minute before it expires; PayPal's
// client-credentials tokens live ~9 hours, so a warm isolate asks once.

const HOSTS = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
};

export function paypalBase(env) {
  return env.PAYPAL_ENV === "live" ? HOSTS.live : HOSTS.sandbox;
}

/** Which of the required settings are missing — names only, never values. */
export function paypalMissing(env) {
  const missing = ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_WEBHOOK_ID"].filter((k) => !env[k]);
  let plans = {};
  try { plans = JSON.parse(env.PAYPAL_PLAN_IDS || "{}") || {}; } catch { /* malformed = missing */ }
  if (!Object.values(plans).some(Boolean)) missing.push("PAYPAL_PLAN_IDS");
  return missing;
}

let cached = null; // { key, token, expiresAt }

async function accessToken(env) {
  const key = `${paypalBase(env)}|${env.PAYPAL_CLIENT_ID}`;
  if (cached && cached.key === key && cached.expiresAt > Date.now()) return cached.token;
  const res = await fetch(`${paypalBase(env)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`)}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal auth failed (${res.status}): ${await res.text()}`);
  const j = await res.json();
  cached = { key, token: j.access_token, expiresAt: Date.now() + (Number(j.expires_in) - 60) * 1000 };
  return cached.token;
}

async function call(env, method, path, body) {
  const res = await fetch(`${paypalBase(env)}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${await accessToken(env)}`,
      "content-type": "application/json",
      // Lets PayPal de-duplicate a retried create.
      ...(method === "POST" ? { "paypal-request-id": crypto.randomUUID() } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(`PayPal ${method} ${path} failed (${res.status}): ${json?.message || text}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

/**
 * Start a subscription and return PayPal's approval link. The buyer approves
 * on PayPal and comes back to `returnUrl` with ?subscription_id=…
 */
export async function createSubscription(env, { planId, userId, returnUrl, cancelUrl }) {
  const sub = await call(env, "POST", "/v1/billing/subscriptions", {
    plan_id: planId,
    custom_id: userId, // rides back on the sale webhook as `custom`
    application_context: {
      brand_name: "StorySeam",
      user_action: "SUBSCRIBE_NOW",
      shipping_preference: "NO_SHIPPING",
      return_url: returnUrl,
      cancel_url: cancelUrl,
    },
  });
  const approve = sub?.links?.find((l) => l.rel === "approve")?.href;
  if (!approve) throw new Error("PayPal returned no approval link");
  return { subscription: sub, approveUrl: approve };
}

export const getSubscription = (env, id) =>
  call(env, "GET", `/v1/billing/subscriptions/${encodeURIComponent(id)}`);

export const cancelSubscription = (env, id, reason = "Cancelled by the subscriber") =>
  call(env, "POST", `/v1/billing/subscriptions/${encodeURIComponent(id)}/cancel`, { reason });

/**
 * Ask PayPal whether a webhook delivery is genuine. `headers` is the incoming
 * request's Headers; `event` the parsed body. Returns true only on SUCCESS.
 */
export async function verifyWebhook(env, headers, event) {
  const h = (n) => headers.get(n);
  if (!h("paypal-transmission-id") || !h("paypal-transmission-sig")) return false;
  const j = await call(env, "POST", "/v1/notifications/verify-webhook-signature", {
    auth_algo: h("paypal-auth-algo"),
    cert_url: h("paypal-cert-url"),
    transmission_id: h("paypal-transmission-id"),
    transmission_sig: h("paypal-transmission-sig"),
    transmission_time: h("paypal-transmission-time"),
    webhook_id: env.PAYPAL_WEBHOOK_ID,
    webhook_event: event,
  });
  return j?.verification_status === "SUCCESS";
}
