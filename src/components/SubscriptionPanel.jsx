// The PayPal plan panel — Settings › Subscription and the /billing page.
import { useEffect, useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/shared";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { track } from "@/lib/analytics";

async function send(path, method, body) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || "Request failed");
  return j;
}
const post = (path, body) => send(path, "POST", body);

// The PayPal plan (worker routes/billing.js). A plan buys AGENT usage: each
// paid month resets the credit to the plan's amount, and every chat model call
// spends its Workers AI cost. Renders run on the author's own fal account and
// are not part of it. Subscribe sends the author to PayPal and back here with
// ?billing=return, where a sync reads the status straight from PayPal instead
// of waiting on the webhook; the credit itself arrives with the payment
// webhook, so it can trail by a beat.
const dollars = (micros) => `$${(Number(micros || 0) / 1_000_000).toFixed(2)}`;
const tokensLabel = (n) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}k` : String(n || 0);

// `returnPath` is where PayPal sends the author back (default: this page);
// `onBilling` hears every state the panel loads or changes to.
export function SubscriptionPanel({ returnPath, onBilling } = {}) {
  const t = useT();
  const [billing, setBilling] = useState(null); // null = loading
  const [busy, setBusy] = useState(null); // the plan key (or "cancel") in flight
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => { if (billing && !billing.error) onBilling?.(billing); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [billing]);

  useEffect(() => {
    let cancelled = false;
    const url = new URL(window.location.href);
    const back = url.searchParams.get("billing");
    if (back) {
      for (const k of ["billing", "subscription_id", "ba_token", "token"]) url.searchParams.delete(k);
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
    const load = back === "return" ? post("/api/billing/sync", {}) : send("/api/billing", "GET");
    load
      .catch(() => send("/api/billing", "GET"))
      .then((j) => {
        if (cancelled) return;
        // Back from PayPal with a live plan: the subscription went through.
        if (back === "return") track(j?.active ? "subscription_activated" : "subscription_not_active", { plan: j?.subscription?.plan?.key || null, status: j?.subscription?.status || null });
        else if (back === "cancel") track("subscription_checkout_cancelled");
        setBilling(j);
      })
      .catch((e) => { if (!cancelled) { setBilling({ error: true }); setErr(String(e?.message || e)); } });
    return () => { cancelled = true; };
  }, []);

  const run = async (key, fn) => {
    setBusy(key);
    setErr(null);
    try { await fn(); } catch (e) { setErr(String(e?.message || e)); }
    finally { setBusy(null); }
  };

  const subscribe = (plan) => run(plan, async () => {
    const p = billing?.plans?.find((x) => x.key === plan);
    track("subscription_plan_clicked", { plan, price: p?.price ?? null, page: window.location.pathname });
    const j = await post("/api/billing/subscribe", { plan, returnPath: returnPath || window.location.pathname });
    window.location.href = j.approveUrl;
  });
  const cancel = () => run("cancel", async () => {
    track("subscription_cancelled", { plan: current });
    setBilling(await post("/api/billing/cancel", {}));
    setConfirmCancel(false);
  });

  const sub = billing?.subscription;
  const current = billing?.active ? sub?.plan?.key : null;
  const used = billing?.period;
  return (
    <Panel title={<span className="flex items-center gap-2"><CreditCard size={15} className="text-primary" /> {t("Subscription")}</span>}>
      <p className="mb-3 text-sm text-muted-foreground">
        {t("A plan pays for the agent — every message it reads and writes. Renders run on your own fal account and aren't counted here. Paid monthly with PayPal; unused credit doesn't roll over.")}
      </p>

      {billing && !billing.error ? (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border p-3 text-sm">
          <span>
            {t("Plan")}: <b>{sub?.plan && billing.active ? sub.plan.name : t("None")}</b>
          </span>
          {sub?.status && !billing.active ? <Badge variant="warning">{sub.status.replace(/_/g, " ").toLowerCase()}</Badge> : null}
          <span>
            {t("Credit left")}: <b>{dollars(Math.max(0, billing.balanceMicros))}</b>
          </span>
          <span className="text-muted-foreground">
            {t("Used this month")}: {dollars(used?.usedMicros)} · {tokensLabel(used?.usedTokens)} {t("tokens")}
          </span>
          {billing.active && sub?.nextBillingAt ? (
            <span className="text-muted-foreground">{t("Renews")} {new Date(sub.nextBillingAt).toLocaleDateString()}</span>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-3">
        {(billing?.plans || []).map((p) => {
          const isCurrent = current === p.key;
          return (
            <div key={p.key} className={cn("flex flex-col rounded-lg border p-3", isCurrent && "border-primary")}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{p.name}</span>
                {isCurrent ? <Badge variant="success">{t("Current")}</Badge> : null}
              </div>
              <div className="mt-1 text-lg font-semibold">${p.price}<span className="text-xs font-normal text-muted-foreground"> / {t("month")}</span></div>
              <p className="mt-1 text-xs text-muted-foreground">
                {dollars(p.creditMicros)} {t("of agent usage")} · ≈{tokensLabel(p.approxTokens)} {t("tokens")}
              </p>
              <div className="mt-3">
                {isCurrent ? null : (
                  <Button
                    size="sm" className="w-full"
                    disabled={Boolean(busy) || billing?.configured === false || !p.available || Boolean(current)}
                    onClick={() => subscribe(p.key)}
                  >
                    {busy === p.key ? <Loader2 size={14} className="animate-spin" /> : null}
                    {t("Subscribe with PayPal")}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {billing === null ? <p className="mt-2 text-xs text-muted-foreground">{t("Checking…")}</p> : null}
      {billing?.configured === false ? (
        <p className="mt-2 text-xs text-muted-foreground">{t("Plans aren't open yet.")}</p>
      ) : null}
      {current ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted-foreground">
            {confirmCancel
              ? t("PayPal stops billing right away. Credit you already have stays until it runs out.")
              : t("To switch plans, cancel this one first.")}
          </p>
          <div className="ml-auto flex gap-2">
            {confirmCancel ? (
              <>
                <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => setConfirmCancel(false)}>{t("Keep it")}</Button>
                <Button size="sm" variant="destructive" disabled={Boolean(busy)} onClick={cancel}>
                  {busy === "cancel" ? <Loader2 size={14} className="animate-spin" /> : null}
                  {t("Confirm cancel")}
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirmCancel(true)}>
                {t("Cancel subscription")}
              </Button>
            )}
          </div>
        </div>
      ) : null}
      {err ? <p className="mt-2 text-xs text-destructive">{err}</p> : null}
    </Panel>
  );
}
