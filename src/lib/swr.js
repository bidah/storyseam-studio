import { useEffect, useMemo, useRef } from "react";
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

// Refresh a tab when the agent finishes a turn (it may have written this tab's
// data). EDGE-triggered on the transition into "ready" — never level-triggered
// on `agent.status === "ready"`, and never dependent on the `revalidator`
// OBJECT.
//
// `useRevalidator()` re-memoizes its return value on every `state.revalidation`
// flip (only the inner `revalidate` fn is stable). An effect that deps on the
// object and calls revalidate() therefore re-fires on its own revalidation:
// idle -> loading -> idle -> ... a self-sustaining storm. React Router
// interrupts an in-flight revalidation when a new one starts, so the loader
// result may never commit and `useLoaderData()` stays pinned to the previously
// committed payload — the tab looks frozen on stale data.
export function useRevalidateOnAgentIdle(key, status) {
  const { revalidate } = useRevalidator();
  const prevStatus = useRef(status);
  useEffect(() => {
    const enteredReady = status === "ready" && prevStatus.current !== "ready";
    prevStatus.current = status;
    if (!enteredReady) return;
    invalidateTabCache(key);
    revalidate();
  }, [key, status, revalidate]);
}

// Count the agent's COMPLETED calls to `toolName` across the whole transcript.
// A flue tool call is a `dynamic-tool` message part; it lands its write when the
// state reaches "output-available" (input-available/output-error don't count —
// nothing new is persisted yet).
function countCompletedToolCalls(messages, toolName) {
  let n = 0;
  for (const m of messages || []) {
    for (const p of m.parts || []) {
      if (p.type === "dynamic-tool" && p.toolName === toolName && p.state === "output-available") n++;
    }
  }
  return n;
}

// Refresh a tab each time the agent FINISHES a call to `toolName` — so writes the
// agent streams mid-turn (e.g. `save_shotlist` building the shot list beat by
// beat) reflect on the tab immediately, instead of only when the whole turn ends.
//
// Why not lean on the /api/data/events firehose (RootLayout already revalidates
// on it)? During a heavy generation that channel can be starved behind the long-
// lived agent chat stream, so a burst of mid-turn writes doesn't reach the tab
// until the agent goes idle. The agent's OWN message stream is the one the chat
// panel already renders live, so it's the reliable signal: watch the completed-
// tool-call count and revalidate whenever it climbs. Completions are spaced (one
// bounded tool call per beat), so this can't storm the revalidator. Pairs with
// `useRevalidateOnAgentIdle` as the final catch-up when the turn settles.
export function useRevalidateOnAgentTool(key, messages, toolName) {
  const { revalidate } = useRevalidator();
  const count = useMemo(() => countCompletedToolCalls(messages, toolName), [messages, toolName]);
  const prev = useRef(count); // seed from history so a revisit doesn't refetch spuriously
  useEffect(() => {
    if (count === prev.current) return;
    const grew = count > prev.current;
    prev.current = count;
    if (!grew) return; // a history reset / new chat shrank it — nothing new was written
    invalidateTabCache(key);
    revalidate();
  }, [count, key, revalidate]);
}
