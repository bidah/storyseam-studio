// Tiny in-memory, per-tab payload cache for stale-while-revalidate loading.
//
// Every feature tab (Episode, Complete cuts, Library, …) is conditionally
// rendered in App, so switching tabs UNMOUNTS the old one and MOUNTS the new
// one — whose effect refetches from scratch and shows a spinner every time,
// even for data you looked at seconds ago. This cache lets a tab paint its last
// payload instantly on mount (no spinner) and then revalidate in the background,
// so the user sees content immediately instead of a loader on every switch.
//
// Scope: the store is process-global (survives unmount) but NOT project-scoped,
// so `clearTabCache()` MUST be called whenever the active project changes, or a
// tab would flash the previous project's data before revalidation replaces it.
const store = new Map();

export function readTabCache(key) {
  return store.get(key);
}

export function writeTabCache(key, payload) {
  store.set(key, payload);
}

export function clearTabCache() {
  store.clear();
}
