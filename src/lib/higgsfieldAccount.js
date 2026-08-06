// Higgsfield as a CONNECTOR — since sign-in moved to Google, the Higgsfield
// OAuth account is something you LINK to the signed-in user (Better Auth
// genericOAuth /oauth2/link) rather than the way in. The link stores the
// per-user Higgsfield bearer on the account row, which is what the worker's
// render/import paths use (worker/src/lib/higgsfield.js).
//
// This module is the shared client seam: a reactive "is Higgsfield linked?"
// read (used by the login gate and Settings › Connectors) plus the
// connect/disconnect actions, desktop-aware like the sign-in flow.
import { useEffect, useSyncExternalStore } from "react";
import { authClient } from "@/lib/auth-client";
import { desktop, isDesktop } from "@/lib/desktop";

let state = { status: "idle", accounts: [] }; // idle | loading | ready | error
const listeners = new Set();

function set(next) {
  state = next;
  for (const fn of listeners) { try { fn(); } catch { /* ignore */ } }
}

async function load() {
  if (state.status === "loading") return;
  set({ ...state, status: "loading" });
  const { data, error } = await authClient.listAccounts();
  if (error) { set({ status: "error", accounts: state.accounts }); return; }
  set({ status: "ready", accounts: data || [] });
}

export function refreshLinkedAccounts() {
  return load();
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Reactive account-list read; kicks off the first load on mount.
export function useLinkedAccounts() {
  const s = useSyncExternalStore(subscribe, () => state);
  useEffect(() => { if (s.status === "idle") load(); }, [s.status]);
  return s;
}

// null while unknown (first load in flight), "error" when the list couldn't be
// fetched (callers decide how graceful to be — the login gate lets the app
// through rather than deadlocking on the splash), else boolean.
export function useHiggsfieldLinked() {
  const s = useLinkedAccounts();
  if (s.status === "ready") return s.accounts.some((a) => a.providerId === "higgsfield");
  if (s.status === "error") return "error";
  return s.accounts.length ? s.accounts.some((a) => a.providerId === "higgsfield") : null;
}

// Non-reactive read of the CURRENT link state, for callers outside React (the
// projectFetch shim, which stamps a "render ready" bit on agent sends). Returns
// true / false only once the account list has loaded; null while it's still
// unknown, so callers can stay optimistic and not falsely report "not linked".
export function higgsfieldLinkedNow() {
  if (state.status === "ready") return state.accounts.some((a) => a.providerId === "higgsfield");
  if (state.accounts.length) return state.accounts.some((a) => a.providerId === "higgsfield");
  return null;
}

// Start the Higgsfield OAuth link flow for the CURRENT session. On the web the
// Better Auth client redirects this tab to Higgsfield and back to callbackURL.
// On desktop /oauth2/link has no disableRedirect, so ask the endpoint directly
// (same-origin POST, session cookie rides) and run the returned authorize URL
// through the main process's OAuth child window — then refresh the account list.
export async function connectHiggsfield(callbackURL = "/") {
  if (isDesktop) {
    const res = await fetch("/api/auth/oauth2/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: "higgsfield", callbackURL }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.url) throw new Error(j.message || "Could not start the Higgsfield link");
    const r = await desktop.oauth.start(j.url);
    if (!r?.ok) {
      throw new Error(r?.reason === "closed" ? "Link window closed" : "Link timed out");
    }
    await load();
    return;
  }
  const { error } = await authClient.oauth2.link({ providerId: "higgsfield", callbackURL });
  if (error) throw new Error(error.message || "Could not start the Higgsfield link");
}

export async function disconnectHiggsfield() {
  const { error } = await authClient.unlinkAccount({ providerId: "higgsfield" });
  if (error) throw new Error(error.message || "Could not disconnect Higgsfield");
  await load();
}
