// /waitlist — where a signed-in user who hasn't been invited yet is sent
// (lib/waitlist.js hard-redirects here; so does the fetch shim on the Worker's
// 403 + x-waitlist). A SIBLING of RootLayout like /login: the studio shell is
// exactly what this user can't open. By the time they land, GET
// /api/waitlist/me has already put their email on the list, so "you're on the
// waitlist" is true, not a promise.
import { Navigate } from "react-router";
import { Clock, LogOut } from "lucide-react";
import { useSession, signOut, authClient } from "@/lib/auth-client";
import { useWaitlistAccess } from "@/lib/waitlist";
import { Splash } from "@/components/Login";
import { HudHeader } from "@/components/HudHeader";
import { WaitlistPanel } from "@/components/WaitlistPanel";
import { HUD, DISPLAY, DISPLAY_TRACKING, BODY, MONO } from "@/lib/hudTheme";
import { AFTER_SIGN_IN } from "@/lib/home";

export function Component() {
  const { data: session, isPending } = useSession();
  const access = useWaitlistAccess();
  if (isPending || (session && access === null)) return <Splash />;
  // Let in since (or never held back): nothing to wait for.
  if (session && access === true) return <Navigate to={AFTER_SIGN_IN} replace />;
  const email = session?.user?.email;

  return (
    <div
      className="flex min-h-dvh flex-col bg-[var(--br-neutral)] px-4 pb-12 text-[var(--br-primary)] sm:px-8"
      style={{ ...HUD, fontFamily: BODY, fontSize: "0.92rem", lineHeight: 1.5 }}
    >
      <div className="mx-auto w-full max-w-7xl">
        <HudHeader />
      </div>
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center py-12 text-center">
        <Clock size={28} className="text-[var(--br-secondary)]" aria-hidden />
        <h1
          className="mt-6 text-[2.6rem] font-bold uppercase leading-none"
          style={{ fontFamily: DISPLAY, letterSpacing: DISPLAY_TRACKING }}
        >
          {session ? "You're on the waitlist" : "StorySeam is in early access"}
        </h1>
        {session ? (
          <>
            <p className="mt-4 text-[var(--br-secondary)]">
              StorySeam is opening to a few people at a time, and we're adding spots every day.
              We'll email {email ? <b className="text-[var(--br-primary)]">{email}</b> : "you"} as soon as yours is ready — then sign in with Google again and you're in.
            </p>
            <button
              type="button"
              onClick={() => signOut().then(() => window.location.assign("/"))}
              className="mt-8 flex items-center gap-2 border border-[var(--br-secondary)]/40 px-5 py-3 text-[0.72rem] uppercase text-[var(--br-primary)] transition-colors hover:border-[var(--br-primary)]"
              style={{ fontFamily: MONO, letterSpacing: "0.08em" }}
            >
              <LogOut size={14} />
              Sign out
            </button>
          </>
        ) : (
          <>
            <p className="mt-4 mb-8 text-[var(--br-secondary)]">
              We're opening spots a few at a time. Leave your email and we'll let you know when yours opens.
            </p>
            <WaitlistPanel onSignIn={() => authClient.signIn.social({ provider: "google", callbackURL: AFTER_SIGN_IN })} />
          </>
        )}
      </div>
    </div>
  );
}
