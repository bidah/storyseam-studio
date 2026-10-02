#!/usr/bin/env node
// One-time PayPal setup: the Product, the three monthly Plans, and the webhook that
// tells the Worker about payments. Run once per environment (sandbox, then
// live) with that environment's REST app credentials:
//
//   PAYPAL_ENV=sandbox PAYPAL_CLIENT_ID=… PAYPAL_CLIENT_SECRET=… \
//     node worker/scripts/paypal-setup.mjs
//
// Optional: CURRENCY (USD),
//           WEBHOOK_URL (default https://storyseam.app/api/billing/webhook).
//
// It prints the plan ids (→ PAYPAL_PLAN_IDS in wrangler.jsonc) and the webhook
// id (→ `wrangler secret put PAYPAL_WEBHOOK_ID`). Re-running creates NEW ones;
// PayPal plans can't be deleted, only deactivated, so run it once.

const env = process.env;
const base = env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
const currency = env.CURRENCY || "USD";
const webhookUrl = env.WEBHOOK_URL || "https://storyseam.app/api/billing/webhook";

if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
  console.error("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (and PAYPAL_ENV=live for production).");
  process.exit(1);
}

const tokenRes = await fetch(`${base}/v1/oauth2/token`, {
  method: "POST",
  headers: {
    authorization: `Basic ${Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString("base64")}`,
    "content-type": "application/x-www-form-urlencoded",
  },
  body: "grant_type=client_credentials",
});
if (!tokenRes.ok) throw new Error(`auth failed: ${tokenRes.status} ${await tokenRes.text()}`);
const { access_token } = await tokenRes.json();

async function post(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${access_token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${JSON.stringify(j)}`);
  return j;
}

const product = await post("/v1/catalogs/products", {
  name: "StorySeam",
  description: "StorySeam subscription — monthly agent usage credit",
  type: "SERVICE",
  category: "SOFTWARE",
});
console.log(`product  ${product.id}`);

// Keep in lockstep with src/lib/billing-plans.js PLANS (key, name, price).
const PLANS = [
  { key: "starter", name: "Starter", price: "9.99" },
  { key: "creator", name: "Creator", price: "19.99" },
  { key: "studio", name: "Studio", price: "49.99" },
];
const planIds = {};
for (const p of PLANS) {
  const plan = await post("/v1/billing/plans", {
    product_id: product.id,
    name: `StorySeam ${p.name}`,
    description: `${currency} ${p.price} a month — agent usage credit`,
    status: "ACTIVE",
    billing_cycles: [
      {
        frequency: { interval_unit: "MONTH", interval_count: 1 },
        tenure_type: "REGULAR",
        sequence: 1,
        total_cycles: 0, // until cancelled
        pricing_scheme: { fixed_price: { value: p.price, currency_code: currency } },
      },
    ],
    payment_preferences: {
      auto_bill_outstanding: true,
      payment_failure_threshold: 1,
    },
  });
  planIds[p.key] = plan.id;
  console.log(`plan     ${p.key.padEnd(8)} ${plan.id}  (${currency} ${p.price}/month)`);
}

const webhook = await post("/v1/notifications/webhooks", {
  url: webhookUrl,
  event_types: [
    "BILLING.SUBSCRIPTION.CREATED",
    "BILLING.SUBSCRIPTION.ACTIVATED",
    "BILLING.SUBSCRIPTION.UPDATED",
    "BILLING.SUBSCRIPTION.EXPIRED",
    "BILLING.SUBSCRIPTION.CANCELLED",
    "BILLING.SUBSCRIPTION.SUSPENDED",
    "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
    "PAYMENT.SALE.COMPLETED",
  ].map((name) => ({ name })),
});
console.log(`webhook  ${webhook.id}  → ${webhookUrl}`);

console.log(`
Next:
  1. worker/wrangler.jsonc  "PAYPAL_PLAN_IDS": ${JSON.stringify(JSON.stringify(planIds))}
                           "PAYPAL_ENV": "${env.PAYPAL_ENV === "live" ? "live" : "sandbox"}"
  2. cd worker && npx wrangler secret put PAYPAL_CLIENT_ID
                  npx wrangler secret put PAYPAL_CLIENT_SECRET
                  npx wrangler secret put PAYPAL_WEBHOOK_ID     # ${webhook.id}`);
