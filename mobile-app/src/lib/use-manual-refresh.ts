import { useState } from 'react';

// `RefreshControl.refreshing` must reflect ONLY a user-initiated pull — never a
// background refetch. react-query's `isRefetching` is true for ANY auto refetch
// (stale-on-mount when you navigate into a screen, on-focus, SSE/agent
// invalidation), so binding the spinner to it makes the loader flash whenever
// you jump into a screen whose cache is stale. This hook tracks the pull
// explicitly: `refreshing` is set true only while `onRefresh` runs, and cleared
// once every passed refetch settles.
//
// Pass one or more react-query `refetch` fns. `onRefresh` is recreated each
// render (it closes over the latest refetchers), which is harmless — it's only
// ever invoked imperatively by RefreshControl.
export function useManualRefresh(...refetchers: (() => unknown | Promise<unknown>)[]) {
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all(refetchers.map((r) => Promise.resolve(r())));
    } finally {
      setRefreshing(false);
    }
  };

  return { refreshing, onRefresh };
}
