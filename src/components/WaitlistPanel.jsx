// The signed-out call to action while StorySeam is in early access: join the
// waitlist first, and — for someone who has already been let in — sign in with
// Google second. Shared by the prompt box's modal (DirectorStory SignInDialog)
// and the /login page, so both ways in say the same thing. The sign-in itself
// stays with the caller (`onSignIn`), because each one has its own callbackURL.
// Rules: lib/waitlist.js (client), worker/src/lib/waitlist.js (server).
import { useState } from "react";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { joinWaitlist } from "@/lib/waitlist";
import { MONO } from "@/lib/hudTheme";
import { cn } from "@/lib/utils";

export function WaitlistPanel({ onSignIn, signingIn = false, signInError = null, className = "", onJoined }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [joined, setJoined] = useState(false);
  const plausible = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const join = async (e) => {
    e.preventDefault();
    if (!plausible || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await joinWaitlist(email.trim());
      // A caller that owns the surrounding copy (the modal) swaps to its own
      // thank-you; otherwise the panel shows one in place.
      if (onJoined) onJoined(email.trim());
      else setJoined(true);
    } catch (e2) {
      setErr(String(e2?.message || e2));
    } finally {
      setBusy(false);
    }
  };

  const label = "text-[0.72rem] uppercase";
  const labelStyle = { fontFamily: MONO, letterSpacing: "0.08em" };

  return (
    <div className={cn("flex w-full max-w-sm flex-col gap-3 text-left", className)} data-waitlist-panel>
      {joined ? (
        <div className="flex items-start gap-2 border border-[var(--br-secondary)]/40 p-3 text-sm" role="status">
          <Check size={16} className="mt-0.5 shrink-0 text-[var(--br-tertiary)]" aria-hidden />
          <span>
            <b>Thank you!</b> You're on the waitlist. We're adding spots every day — we'll email{" "}
            <b>{email.trim()}</b> when yours opens.
          </span>
        </div>
      ) : (
        <form onSubmit={join} className="flex flex-col gap-2">
          <label htmlFor="waitlist-email" className={`${label} text-[var(--br-secondary)]`} style={labelStyle}>
            Join the waitlist
          </label>
          <input
            id="waitlist-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="h-11 border border-[var(--br-secondary)]/40 bg-transparent px-3 text-[var(--br-primary)] placeholder:text-[var(--br-secondary)]/60 focus:border-[var(--br-primary)] focus:outline-none"
          />
          <button
            type="submit"
            disabled={!plausible || busy}
            className={`flex h-11 items-center justify-center gap-2 bg-[var(--br-tertiary)] ${label} text-[var(--br-on-primary)] transition-opacity hover:opacity-90 disabled:opacity-60`}
            style={labelStyle}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : null}
            Join the waitlist
            {!busy ? <ArrowRight size={14} /> : null}
          </button>
          {err ? <p className="text-xs text-[var(--br-tertiary)]">{err}</p> : null}
        </form>
      )}

      <div className="mt-2 flex flex-col gap-2 border-t border-[var(--br-secondary)]/25 pt-4">
        <span className={`${label} text-[var(--br-secondary)]`} style={labelStyle}>
          Already have access?
        </span>
        <button
          type="button"
          onClick={onSignIn}
          disabled={signingIn}
          className={`flex h-11 items-center justify-center gap-2 border border-[var(--br-secondary)]/40 ${label} text-[var(--br-primary)] transition-colors hover:border-[var(--br-primary)] disabled:opacity-60`}
          style={labelStyle}
          data-google-signin
        >
          {signingIn ? <Loader2 size={14} className="animate-spin" /> : null}
          Sign in with Google
        </button>
        {signInError ? <p className="text-xs text-[var(--br-tertiary)]">{signInError}</p> : null}
      </div>
    </div>
  );
}
