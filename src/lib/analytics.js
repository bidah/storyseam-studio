// PostHog product analytics: the visitor's road from the home page to a
// finished Film — the tour video, the prompt box and its options, sign-in,
// the plan, the Film page's steps and its result.
//
// Events go through `/relay` on our own domain (worker/src/index.js forwards
// them to PostHog US) so ad blockers don't drop them. Without a token nothing
// is sent and `track` is a no-op, so local builds without `.env` stay quiet.
//
// Event names are snake_case `object_verb` ("film_generate_clicked"); the
// Worker sends the Film's server-side stage events under the same user id
// (worker/src/lib/analytics.js).
import { useEffect } from "react";
import posthog from "posthog-js";
import { useSession } from "@/lib/auth-client";

const TOKEN = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN;
const HOST = import.meta.env.VITE_POSTHOG_HOST || "/relay";

export const analyticsEnabled = Boolean(TOKEN) && typeof window !== "undefined";

if (analyticsEnabled) {
  posthog.init(TOKEN, {
    api_host: HOST,
    ui_host: "https://us.posthog.com",
    defaults: "2026-05-30",
    person_profiles: "identified_only",
    capture_exceptions: true,
    session_recording: { maskAllInputs: false, maskInputOptions: { password: true } },
  });
}

export function track(event, properties) {
  if (!analyticsEnabled) return;
  try { posthog.capture(event, properties); } catch { /* analytics never breaks the app */ }
}

// Fire an event once per page load (e.g. the first focus on the prompt box).
const fired = new Set();
export function trackOnce(event, properties) {
  if (fired.has(event)) return;
  fired.add(event);
  track(event, properties);
}

export function captureError(error, properties) {
  if (!analyticsEnabled) return;
  try { posthog.captureException(error, properties); } catch { /* ignore */ }
}

// A user created this recently is a sign-UP, not a sign-in: Google OAuth makes
// both through the same button, so the account's age is what tells them apart.
const NEW_ACCOUNT_MS = 10 * 60 * 1000;

/**
 * Ties this browser's anonymous events to the signed-in user (Better Auth's
 * id — the same id the Worker sends its Film events under), and reports
 * `user_signed_up` / `user_signed_in` once per user per browser session.
 * Mounted once beside the router (src/main.jsx), so it covers every page.
 */
export function AnalyticsIdentity() {
  const { data: session } = useSession();
  const user = session?.user;
  useEffect(() => {
    if (!analyticsEnabled || !user?.id) return;
    if (posthog.get_distinct_id() !== user.id) {
      posthog.identify(user.id, { email: user.email, name: user.name });
    }
    const key = `ph:seen:${user.id}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch { /* private mode: report anyway */ }
    const created = Date.parse(user.createdAt);
    const fresh = Number.isFinite(created) && Date.now() - created < NEW_ACCOUNT_MS;
    track(fresh ? "user_signed_up" : "user_signed_in", { method: "google" });
  }, [user?.id, user?.email, user?.name, user?.createdAt]);
  return null;
}
