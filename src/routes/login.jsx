// The sign-in page (/login). A SIBLING of RootLayout — the same reasoning as
// /privacy and /terms: it has to render for someone with no session, and
// wrapping it in the shell (whose LoginGate is what sends people here) would be
// a redirect loop.
//
// `/` is the text-to-story prompt box (routes/director-story.jsx), which asks
// for Google sign-in in its own modal when a signed-out visitor submits. The page body
// lives in components/Login.jsx next to the gate that redirects here, and the
// `?next=` param it reads is set by that gate.
import { useEffect } from "react";
import { Navigate, useLocation } from "react-router";
import { useSession } from "@/lib/auth-client";
import { captureInviteFromLocation } from "@/lib/pendingInvite";
import { SignInPage, Splash } from "@/components/Login";
import { AFTER_SIGN_IN } from "@/lib/home";

export function Component() {
  const { data: session, isPending } = useSession();
  const location = useLocation();
  // Belt and braces on the invite stash. LoginGate already captures it from the
  // invite URL itself, but by the time we're here that URL survives only inside
  // `?next=` — so re-read it from there. Cheap, idempotent, and it means the
  // invite is never riding on the order two effects happen to fire in.
  const next = new URLSearchParams(location.search).get("next") || "";
  useEffect(() => {
    if (!next.startsWith("/accept-invite/")) return;
    const [pathname, search] = next.split("?");
    captureInviteFromLocation({ pathname, search: search ? `?${search}` : "" });
  }, [next]);
  // Already signed in: there is nothing to do here. Honour `?next=` (an
  // already-authenticated user following a shared invite link lands on this
  // route via the gate too), else home (lib/home.js). Same-origin absolute path only.
  // Hold the splash while the session resolves rather than flashing a sign-in
  // button at someone who is already signed in.
  if (isPending) return <Splash />;
  if (session) {
    return <Navigate to={/^\/(?!\/)/.test(next) ? next : AFTER_SIGN_IN} replace />;
  }
  return <SignInPage />;
}
