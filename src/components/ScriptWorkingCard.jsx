// The "agent is working on this selection" card that sits to the right of the
// script while an inline edit is in flight. It appears the moment a passage is
// sent to the agent (the passage itself is locked + highlighted in the editor),
// and clears itself when the turn ends: either a proposal arrives — in which
// case the whole tab swaps to the diff-review surface and this unmounts — or the
// agent finishes without proposing, in which case we release the lock so the
// author can keep writing.

import { useEffect, useRef } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAgent, agentIsBusy } from "@/components/AgentProvider";
import { useT } from "@/lib/i18n";

// A few lines of the locked passage, so the author can see what's cooking.
function Preview({ text }) {
  return (
    <p className="line-clamp-4 whitespace-pre-wrap rounded-md border bg-muted/40 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
      {text}
    </p>
  );
}

export default function ScriptWorkingCard({ sel, onRelease }) {
  const t = useT();
  const agent = useAgent();
  const busy = agentIsBusy(agent);
  const sawBusy = useRef(false);

  // Note once the turn has actually started streaming, so a not-yet-busy status
  // right after send doesn't read as "already finished".
  useEffect(() => {
    if (busy) sawBusy.current = true;
  }, [busy]);

  // When the turn ends without a proposal taking over the tab, release the lock.
  // (If a proposal DID arrive, the loader shell swaps in the diff review and
  // this component unmounts before the timer fires.)
  useEffect(() => {
    if (!sawBusy.current || busy) return;
    const id = setTimeout(onRelease, 500);
    return () => clearTimeout(id);
  }, [busy, onRelease]);

  // Backstop: never leave the passage locked forever if the turn never registers
  // as busy (e.g. the send failed to start a stream).
  useEffect(() => {
    const id = setTimeout(() => {
      if (!sawBusy.current) onRelease();
    }, 20000);
    return () => clearTimeout(id);
  }, [onRelease]);

  return (
    <div className="rounded-xl border bg-card p-3 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="relative flex h-6 w-6 items-center justify-center rounded-md bg-primary/15 text-primary">
          <Sparkles size={14} />
        </span>
        <span className="text-sm font-semibold">{t("Working on this selection")}</span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-6 w-6 text-muted-foreground"
          aria-label={t("Dismiss")}
          onClick={onRelease}
        >
          <X size={14} />
        </Button>
      </div>

      <div className="mt-2.5 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 size={13} className="animate-spin text-primary" />
        {t("The agent is editing this passage. Please wait…")}
      </div>

      <div className="mt-2.5">
        <Preview text={sel.text} />
      </div>

      <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
        {t(
          "This passage is locked while the agent works. When it comes back you'll get a before → after diff to accept or discard."
        )}
      </p>
    </div>
  );
}
