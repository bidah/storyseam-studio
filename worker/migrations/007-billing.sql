-- Billing: a PayPal subscription per user, and the credit ledger it pays into.
-- See the comment block in schema.sql and worker/src/lib/billing.js.
--
-- Apply once per database (idempotent):
--   cd worker && npx wrangler d1 execute shot-studio-uploads --remote \
--     --file=migrations/007-billing.sql
--
-- Apply BEFORE deploying the Worker that reads it.

CREATE TABLE IF NOT EXISTS billing_subscriptions (
  subscription_id    TEXT PRIMARY KEY,          -- PayPal's id, I-XXXXXXXX
  user_id            TEXT NOT NULL,             -- "user"(id)
  plan_id            TEXT NOT NULL,             -- PayPal plan, P-XXXXXXXX
  plan_key           TEXT,                      -- starter | creator | studio (lib/billing-plans.js)
  status             TEXT NOT NULL,             -- APPROVAL_PENDING | APPROVED | ACTIVE | SUSPENDED | CANCELLED | EXPIRED
  next_billing_at    TEXT,                      -- ISO, from billing_info.next_billing_time
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_billing_subs_user ON billing_subscriptions (user_id, updated_at);

CREATE TABLE IF NOT EXISTS billing_ledger (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT NOT NULL,
  amount_micros INTEGER NOT NULL,               -- micro-USD: + credit, - spend
  kind         TEXT NOT NULL,                   -- grant | usage | adjust
  model        TEXT,                            -- usage: the model specifier
  tokens       INTEGER,                         -- usage: total tokens of the call
  ref          TEXT UNIQUE,                     -- idempotency key, e.g. paypal-sale:<id>
  note         TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_billing_ledger_user ON billing_ledger (user_id, created_at);
