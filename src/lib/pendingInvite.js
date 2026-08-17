// A project invite arrives as /accept-invite/:id?token=… . A signed-out visitor
// who clicks it can't accept yet — accepting needs an identity to attach the
// membership to — and the invite id + token would otherwise be lost across the
// Google OAuth round-trip and the post-login provider-connect gate (both of which
// navigate away from the invite URL). So the moment we see the URL we stash it in
// localStorage; a global modal (components/PendingInviteModal) then offers to
// accept it once the user is signed in and inside the app, no matter how many
// redirects happened in between.

const KEY = "storyseam.pendingInvite";

export function savePendingInvite(invite) {
  if (!invite?.id || !invite?.token) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ id: invite.id, token: invite.token }));
  } catch {
    /* private mode / storage disabled — nothing to persist, the callbackURL
       round-trip still covers the happy path */
  }
}

export function readPendingInvite() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    return v?.id && v?.token ? { id: v.id, token: v.token } : null;
  } catch {
    return null;
  }
}

export function clearPendingInvite() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

// If the current URL is an invite link, persist it and return {id, token}; else
// null. Called on every arrival at an invite URL (LoginGate), including while
// signed out — when the /accept-invite route itself can't render because
// LoginGate shows the homepage in its place.
const INVITE_PATH = /^\/accept-invite\/([^/?#]+)/;
export function captureInviteFromLocation(loc = window.location) {
  const m = INVITE_PATH.exec(loc.pathname || "");
  if (!m) return null;
  const id = decodeURIComponent(m[1]);
  const token = new URLSearchParams(loc.search || "").get("token") || "";
  if (!id || !token) return null;
  savePendingInvite({ id, token });
  return { id, token };
}
