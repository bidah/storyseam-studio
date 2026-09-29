// Early access, client half (the rules live in worker/src/lib/waitlist.js).
//
// Signed out, every way in — the header's sign-in icon, submitting a prompt,
// /login — offers "join the waitlist" first and "already have access? sign in"
// second (components/WaitlistPanel.jsx). Anyone can still sign in with Google,
// so after sign-in the user's standing is checked once (`useWaitlistAccess`)
// and a user who isn't invited is HARD-redirected to /waitlist. The Worker
// refuses them independently (403 + x-waitlist), and the fetch shim
// (lib/projectFetch.js) sends any such answer to the same page.
import { useEffect, useState } from "react";
import { useSession } from "@/lib/auth-client";

export const WAITLIST_PATH = "/waitlist";

// Pages a user who isn't invited may still look at: the waitlist page itself,
// sign-in, and the public pages that need no account.
const OPEN_PATHS = [WAITLIST_PATH, "/login", "/privacy", "/terms", "/director-harness", "/share", "/watch"];

export function goToWaitlist() {
  if (typeof window === "undefined") return;
  if (window.location.pathname === WAITLIST_PATH) return;
  window.location.replace(WAITLIST_PATH);
}

export async function joinWaitlist(email) {
  const res = await fetch("/api/waitlist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Couldn't join the waitlist (${res.status}).`);
  return data;
}

// One answer per signed-in user per page load: access doesn't flip back, and
// an invite that lands mid-session is picked up on the next load.
let cached = null; // { userId, promise }

function fetchStanding(userId) {
  if (cached?.userId === userId) return cached.promise;
  const promise = fetch("/api/waitlist/me", { credentials: "include" })
    .then((res) => (res.ok ? res.json() : { access: true }))
    // A network hiccup must not lock a real user out; the Worker gate still
    // refuses anyone who isn't invited.
    .catch(() => ({ access: true }));
  cached = { userId, promise };
  return promise;
}

/**
 * The signed-in user's access: `null` while the session or the check is
 * resolving (and while signed out), then `true` / `false`. On `false` it
 * redirects to /waitlist itself, so a caller only has to hold its splash.
 */
export function useWaitlistAccess() {
  const { data: session, isPending } = useSession();
  const userId = session?.user?.id || null;
  const [state, setState] = useState({ userId: null, access: null });
  useEffect(() => {
    if (isPending || !userId) return;
    let live = true;
    fetchStanding(userId).then((s) => {
      if (!live) return;
      const access = s?.access !== false;
      setState({ userId, access });
      if (!access && !OPEN_PATHS.some((p) => window.location.pathname.startsWith(p))) goToWaitlist();
    });
    return () => { live = false; };
  }, [isPending, userId]);
  return state.userId === userId ? state.access : null;
}
