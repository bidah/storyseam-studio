import { createContext, useContext } from "react";

// Shared state that the app shell (RootLayout) hands to the routed tabs. This is
// a temporary Phase-2 shim that reproduces the props the old <App> threaded into
// each tab (reloadKey, the image-modal setter, the script live-edit counter, and
// a hash-based cross-tab jump). Phase 3 replaces `reloadKey` with React Router
// loader revalidation.
export const ShellContext = createContext(null);

export function useShell() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used within RootLayout");
  return ctx;
}
