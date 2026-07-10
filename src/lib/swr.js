import { useEffect } from "react";
import { useRevalidator } from "react-router";
import { readTabCache, writeTabCache, invalidateTabCache } from "./tabCache";

// Stale-while-revalidate helper for React Router loaders. Reuses the process-
// global tabCache store so a revisited tab paints its last payload instantly
// (no spinner, no delay) while the fetch runs in the background and refreshes the
// cache. On a cache miss it awaits the fetch. On a fetch error it falls back to
// the cached payload if there is one, else rethrows (→ the route errorElement).
//
// Freshness after a stale paint comes from `useRevalidateOnMount` (below): it
// fires one invalidate+revalidate so the tab updates to fresh data — mirroring
// the old "paint cache, then refetch in a mount effect" behavior. On a cache
// miss the loader already awaited fresh, so the mount revalidate is skipped (no
// double fetch).
const servedStale = new Map();

export async function swr(key, fetcher) {
  const cached = readTabCache(key);
  servedStale.set(key, cached !== undefined);
  const fresh = fetcher()
    .then((data) => {
      writeTabCache(key, data);
      return data;
    })
    .catch((e) => {
      if (cached === undefined) throw e; // no fallback → surface to the errorElement
      return cached; // keep showing the last good payload on a transient failure
    });
  return cached !== undefined ? cached : fresh;
}

// One-shot: did the most recent swr(key) serve stale cache? Reading it resets it.
function servedStaleOnce(key) {
  const was = servedStale.get(key);
  servedStale.set(key, false);
  return !!was;
}

// Follow a stale paint with a single fresh fetch. Call once at the top of a
// route component. A no-op on a cold load (the loader already fetched fresh).
export function useRevalidateOnMount(key) {
  const revalidator = useRevalidator();
  useEffect(() => {
    if (servedStaleOnce(key)) {
      invalidateTabCache(key);
      revalidator.revalidate();
    }
    // Mount-only: refresh the just-painted stale cache exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
