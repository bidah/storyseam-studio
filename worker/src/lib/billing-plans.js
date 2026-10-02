// The subscription plans, and what a model call costs against them.
//
// A plan buys agent usage: every paid month grants `creditMicros` (micro-USD
// of model cost) to the user's ledger, and every agent model call spends what
// that call cost on Workers AI. Credit is metered in COST rather than raw
// tokens because a model's tokens are not priced alike: GLM-5.3 charges 17×
// more for an output token than a cached input token, so "N tokens" would be
// either a lie or a loss depending on the mix.
//
// Generation (fal) is NOT in here: an author renders on their own fal account
// (BYOK), so the subscription only pays for what runs on StorySeam's.
//
// The customer sees the PRICE as their credit — a $9.99 plan shows $9.99 —
// and what we keep is taken by marking up each call instead (the author's
// call, 2026-10-02). Internally a plan's real model budget is what is left
// after PayPal's fee and StorySeam's cut:
//
//   budget = price − (price × PAYPAL_FEE_PCT + PAYPAL_FEE_FIXED) − price × OUR_CUT
//   markup = price / budget          (Starter ≈ 1.40×, Studio ≈ 1.32×)
//
// so a call that costs us $0.10 is charged $0.14 against a Starter credit,
// and a fully used plan has spent exactly `budget` on Workers AI. The fixed
// fee weighs more on a small plan, hence a per-plan markup. PAYPAL_FEE_* is
// PayPal's US standard domestic rate; an international buyer pays PayPal
// more, which comes out of our cut. The PayPal plan ids live in the
// PAYPAL_PLAN_IDS wrangler var ({"starter":"P-…", …}) because sandbox and
// live each have their own.
export const PAYPAL_FEE_PCT = 0.0349;
export const PAYPAL_FEE_FIXED = 0.49;
export const OUR_CUT = 0.2;

const micros = (usd) => Math.round(Number(usd) * 1_000_000);

function plan(key, name, price) {
  const p = Number(price);
  const budgetMicros = Math.floor((p - (p * PAYPAL_FEE_PCT + PAYPAL_FEE_FIXED) - p * OUR_CUT) * 100) * 10_000;
  return { key, name, price, creditMicros: micros(price), budgetMicros, markup: micros(price) / budgetMicros };
}

export const PLANS = Object.freeze([
  plan("starter", "Starter", "9.99"),
  plan("creator", "Creator", "19.99"),
  plan("studio", "Studio", "49.99"),
]);

export const planByKey = (key) => PLANS.find((p) => p.key === key) || null;

/** {"starter":"P-…"} from the PAYPAL_PLAN_IDS var; {} when unset or malformed. */
export function paypalPlanIds(env) {
  try {
    const j = JSON.parse(env.PAYPAL_PLAN_IDS || "{}");
    return j && typeof j === "object" ? j : {};
  } catch {
    return {};
  }
}

/** The plan a PayPal plan id belongs to, or null. */
export function planByPaypalId(env, paypalPlanId) {
  const ids = paypalPlanIds(env);
  const key = Object.keys(ids).find((k) => ids[k] === paypalPlanId);
  return key ? planByKey(key) : null;
}

// Workers AI list prices, USD per million tokens (= micro-USD per token).
// https://developers.cloudflare.com/workers-ai/platform/pricing/ — checked
// 2026-10-01. Keyed by the Workers AI model id; a flue specifier
// ("cloudflare/@cf/…") matches by suffix.
export const MODEL_PRICES = Object.freeze({
  "@cf/zai-org/glm-5.3": { input: 1.4, cacheRead: 0.26, output: 4.4 },
  "@cf/zai-org/glm-4.7-flash": { input: 0.06, cacheRead: 0.06, output: 0.4 },
  "@cf/moonshotai/kimi-k2.6": { input: 0.95, cacheRead: 0.16, output: 4.0 },
  "@cf/qwen/qwen3.8-27b": { input: 0.45, cacheRead: 0.45, output: 3.2 },
});

function priceFor(model) {
  const m = String(model || "");
  const id = Object.keys(MODEL_PRICES).find((k) => m === k || m.endsWith(`/${k}`) || m.endsWith(k));
  return id ? MODEL_PRICES[id] : null;
}

/**
 * Micro-USD one model call cost. `usage` is flue's PromptUsage shape
 * ({ input, output, cacheRead, cost: { total } }). An unpriced model falls back
 * to the cost flue itself computed (USD), so nothing runs free by omission.
 */
export function callCostMicros(model, usage = {}) {
  const p = priceFor(model);
  if (p) {
    return Math.ceil(
      (Number(usage.input) || 0) * p.input +
        (Number(usage.cacheRead) || 0) * p.cacheRead +
        (Number(usage.output) || 0) * p.output,
    );
  }
  return Math.ceil((Number(usage?.cost?.total) || 0) * 1_000_000);
}

// What a plan's BUDGET buys in tokens, for the label only. Assumes a typical
// agent mix on GLM-5.3 — each call re-reads the conversation, so most tokens
// are input: 60% fresh input, 35% cached input, 5% output → $1.151 per million.
export const BLENDED_MICROS_PER_TOKEN = 0.6 * 1.4 + 0.35 * 0.26 + 0.05 * 4.4;

export const approxTokens = (micros) => Math.round(micros / BLENDED_MICROS_PER_TOKEN);
