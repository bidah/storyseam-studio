// The two things the app needs before it makes anything — a Film from the
// prompt box, or a blank studio project — asked for at the moment of making,
// one dialog after the other:
//
//   1. a PLAN (the PayPal subscription, components/SubscriptionPanel.jsx). The
//      Worker refuses POST /api/auto/films and POST /api/projects without one
//      (worker/src/lib/billing.js planAllowed); this dialog is the friendly
//      side of that refusal.
//   2. the author's own fal.ai KEY (lib/falKey.js), which every render bills.
//
// useCreateGate().ensure() answers true when both are in place; otherwise it
// opens the first missing step and answers false, and `onReady` fires once the
// author has finished both — the caller then resumes whatever it was making.
// Subscribing leaves for PayPal and comes back with `?billing=return`; the
// hook syncs the subscription on mount and carries on from there.
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, ExternalLink, KeyRound, Lock } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SubscriptionPanel } from "@/components/SubscriptionPanel";
import { getFalKey, setFalKey } from "@/lib/falKey";
import { setActiveProvider } from "@/lib/providers";
import { HUD, BODY, DISPLAY, DISPLAY_TRACKING } from "@/lib/hudTheme";
import { track } from "@/lib/analytics";
import { HOME_PATH } from "@/lib/home";

const planOk = (b) => Boolean(b && (b.canCreate || b.active));

async function loadBilling() {
  const url = new URL(window.location.href);
  const back = url.searchParams.get("billing");
  if (back) {
    for (const k of ["billing", "subscription_id", "ba_token", "token"]) url.searchParams.delete(k);
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }
  const get = () => fetch("/api/billing").then((r) => (r.ok ? r.json() : null));
  if (back === "return") {
    const synced = await fetch("/api/billing/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    // The sync answers the summary without `canCreate`; ask again for it.
    if (synced) {
      const billing = await get().catch(() => synced);
      track(billing?.active ? "subscription_activated" : "subscription_not_active", { plan: billing?.subscription?.plan?.key || null, status: billing?.subscription?.status || null });
      return billing;
    }
  }
  if (back === "cancel") track("subscription_checkout_cancelled");
  return get();
}

export function useCreateGate({ enabled = true, onReady } = {}) {
  const [step, setStep] = useState(null); // null | "plan" | "key"
  // Each gate step the author is shown: the plan, then the fal key.
  useEffect(() => {
    if (step === "plan") track("plan_dialog_shown");
    else if (step === "key") track("fal_key_dialog_shown");
  }, [step]);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  const advance = useCallback((billing) => {
    if (!planOk(billing)) { setStep("plan"); return false; }
    if (!getFalKey()) { setStep("key"); return false; }
    setStep(null);
    return true;
  }, []);

  const ensure = useCallback(async () => {
    let billing = null;
    try { billing = await loadBilling(); } catch { /* treated as no plan */ }
    return advance(billing);
  }, [advance]);

  // Back from PayPal: sync, then carry on to the key — and to the work.
  useEffect(() => {
    if (!enabled || !new URL(window.location.href).searchParams.has("billing")) return;
    ensure().then((ok) => { if (ok) readyRef.current?.(); });
  }, [enabled, ensure]);

  const finish = () => { setStep(null); readyRef.current?.(); };

  const dialogs = (
    <>
      <PlanDialog
        open={step === "plan"}
        onOpenChange={(o) => { if (!o) setStep(null); }}
        onBilling={(b) => {
          if (step !== "plan" || !planOk(b)) return;
          if (getFalKey()) finish();
          else setStep("key");
        }}
      />
      <FalKeyDialog
        open={step === "key"}
        onOpenChange={(o) => { if (!o) setStep(null); }}
        onSaved={finish}
      />
    </>
  );
  return { ensure, dialogs };
}

const contentClass =
  "max-h-[90dvh] overflow-y-auto rounded-none border-[var(--br-secondary)]/40 bg-[var(--br-surface)] text-[var(--br-primary)]";
const titleProps = {
  style: { fontFamily: DISPLAY, letterSpacing: DISPLAY_TRACKING },
  className: "mt-2 pr-6 text-2xl font-bold uppercase",
};

function PlanDialog({ open, onOpenChange, onBilling }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${contentClass} sm:max-w-3xl`} style={{ ...HUD, fontFamily: BODY }}>
        <DialogTitle {...titleProps}>Choose a plan</DialogTitle>
        <DialogDescription className="text-[var(--br-secondary)]">
          StorySeam needs a plan to make stories. Pick one — you'll come back here and your premise starts right after.
        </DialogDescription>
        {/* Back to the root with the premise saved; ?resume=1 starts it. */}
        {open ? <SubscriptionPanel returnPath={`${HOME_PATH}?resume=1`} onBilling={onBilling} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function FalKeyDialog({ open, onOpenChange, onSaved }) {
  const [draft, setDraft] = useState("");
  const plausible = /^[\w:.-]{10,200}$/.test(draft.trim());
  useEffect(() => { if (open) setDraft(""); }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${contentClass} sm:max-w-[484px]`} style={{ ...HUD, fontFamily: BODY }}>
        <DialogTitle {...titleProps}>Add your fal.ai key</DialogTitle>
        <DialogDescription className="text-[var(--br-secondary)]">
          Images, video, voices and soundtracks render on your own fal.ai account and bill to it. Paste your API key to continue.
        </DialogDescription>
        <Button asChild variant="outline" className="w-full gap-2">
          <a href="https://fal.ai/dashboard/keys" target="_blank" rel="noreferrer">
            <KeyRound size={16} /> Generate a key on fal.ai <ExternalLink size={14} />
          </a>
        </Button>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!plausible) return;
            track("fal_key_saved");
            setFalKey(draft.trim());
            setActiveProvider("fal");
            onSaved();
          }}
        >
          <Input
            type="password"
            autoComplete="off"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="key_id:key_secret"
            className="h-10 font-mono text-sm"
            aria-label="fal.ai API key"
          />
          <Button type="submit" className="w-full gap-2" disabled={!plausible}>
            Save & continue <ArrowRight size={16} />
          </Button>
        </form>
        <p className="flex items-start gap-2 text-xs text-[var(--br-secondary)]">
          <Lock size={13} className="mt-0.5 shrink-0" aria-hidden />
          <span>Every render bills your own fal account. Your key is stored encrypted on your StorySeam account, so a Film keeps rendering after you close the tab, and is used only for your own generations.</span>
        </p>
      </DialogContent>
    </Dialog>
  );
}
