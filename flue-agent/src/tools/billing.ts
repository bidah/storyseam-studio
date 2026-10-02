// The billing tools — the author's PayPal plan and agent-usage credit.
//
// Paying happens on PayPal, not in the chat: start_subscription only mints the
// approval link, and the author follows it themselves. Cancelling is the
// author's click in the account menu › Plan & billing (scripts/guards/baselines/
// agent-parity.txt says why) — the agent never ends a paid plan.
import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api, Json } from "../lib/api.js";

export const getBilling = (api: Api) =>
  defineTool({
    name: "get_billing",
    description:
      "The author's plan and agent-usage credit. `plans` (key, name, price, creditMicros, approxTokens, available), `active`, `subscription` (plan, status, nextBillingAt), `balanceMicros` (credit left, micro-USD — divide by 1,000,000 for dollars), `period` (usedMicros / usedTokens since the last payment), `configured` (false = plans aren't open yet), `enforced` (true = the chat stops when credit runs out). Credit pays for THIS chat's model calls — renders run on the author's own fal account and are not in it. Pass refresh: true right after the author says they finished paying on PayPal. Read-only; never invent a balance.",
    input: v.object({
      refresh: v.optional(d(v.boolean(), "Re-read the subscription from PayPal first (after the author approved it).")),
    }),
    async run({ data: input, signal }) {
      if (input.refresh) {
        try {
          return { output: (await api.post("/api/billing/sync", {}, signal)) as Json };
        } catch {
          /* no subscription yet — fall through to the plain read */
        }
      }
      return { output: (await api.get("/api/billing", signal)) as Json };
    },
  });

export const startSubscription = (api: Api) =>
  defineTool({
    name: "start_subscription",
    description:
      "Start the author's PayPal subscription to one plan and get the `approveUrl` they open to pay. ONLY when the author asks to subscribe / buy agent credit. Give them the link as a markdown link and END THE TURN — payment happens on PayPal, never in the chat, and nothing is active until they approve it there. A 409 means they already have an active plan — switching means cancelling it in Settings first; a 503 means subscriptions aren't open yet — say so plainly. Cancelling is the author's own click in the account menu › Plan & billing; you cannot cancel.",
    input: v.object({
      plan: d(
        v.picklist(["starter", "creator", "studio"]),
        "Which plan: starter ($9.99/month), creator ($19.99) or studio ($49.99) — the author's pick, never yours. Unsure → draw the plans (get_billing) as options and ask.",
      ),
    }),
    async run({ data: input, signal }) {
      return {
        output: (await api.post(
          "/api/billing/subscribe",
          { plan: input.plan, returnPath: "/billing" },
          signal,
        )) as Json,
      };
    },
  });
