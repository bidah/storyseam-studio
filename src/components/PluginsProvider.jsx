import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import { normalizeEnabled, PLUGIN_IDS } from "@/lib/plugins";
import { onProjectChange } from "@/lib/projectFetch";

// Which plugins this project has installed — the set the header, the route
// guard and the marketplace all read.
//
// NOT loaderized, on purpose. Every other data fetch in this app hangs off a
// route `loader` (src/lib/swr.js), but this isn't tab data: it decides which
// TABS EXIST. A loader is scoped to the route it belongs to, so the header
// would have to wait for whatever route happens to be open — and would lose the
// set again the moment a route without that loader rendered. It is shell state,
// so it lives in the shell, next to the project and episode providers.
//
// Project-scoped: `GET /api/plugins` reads the project's `plugins` doc, so a
// project switch has to re-fetch or the header keeps showing the previous
// project's tabs.

const PluginsContext = createContext(null);

export function usePlugins() {
  const ctx = useContext(PluginsContext);
  if (!ctx) throw new Error("usePlugins must be used inside <PluginsProvider>");
  return ctx;
}

async function api(method, body) {
  const res = await fetch("/api/plugins", {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${method} /api/plugins failed`);
  return data;
}

export function PluginsProvider({ children }) {
  const [enabled, setEnabledState] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // True while the set is the server's read-only seed (no `plugins` doc yet).
  // The marketplace says so; the first write materialises it and it's false
  // forever after.
  const [defaulted, setDefaulted] = useState(false);

  // The optimistic writers need the CURRENT set to compute their next value and
  // the PREVIOUS one to roll back to, and both would be stale inside a callback
  // that doesn't re-create per render.
  const enabledRef = useRef(enabled);
  const setEnabledLocal = useCallback((ids) => {
    enabledRef.current = ids;
    setEnabledState(ids);
  }, []);

  // A project switch can land mid-flight; only the newest load may write state.
  const genRef = useRef(0);

  const load = useCallback(async () => {
    const gen = ++genRef.current;
    setLoading(true);
    try {
      const data = await api("GET");
      if (gen !== genRef.current) return;
      setEnabledLocal(normalizeEnabled(data.enabled));
      setDefaulted(!!data.defaulted);
      setError(null);
    } catch (e) {
      if (gen !== genRef.current) return;
      // FAIL OPEN. A flaky request must never look like "your work is gone":
      // an empty set would hide the Radio tab from someone mid-recording and
      // gate the tab they were already on. Showing every plugin is the wrong
      // header at worst; showing none is a lockout. The error is surfaced so
      // the marketplace can say the set couldn't be read.
      setEnabledLocal(PLUGIN_IDS.slice());
      setDefaulted(false);
      setError(String(e.message || e));
    } finally {
      if (gen === genRef.current) setLoading(false);
    }
  }, [setEnabledLocal]);

  useEffect(() => { load(); }, [load]);

  // Switching projects re-points the fetch shim at a different `plugins` doc.
  useEffect(() => onProjectChange(() => { load(); }), [load]);

  // Apply the change locally FIRST so the header moves on the tap, then take
  // the server's returned set as truth (it normalises, and another collaborator
  // may have installed something since). A failed write rolls back exactly.
  const mutate = useCallback(async (body, optimistic) => {
    const prev = enabledRef.current;
    const prevDefaulted = defaulted;
    setEnabledLocal(normalizeEnabled(optimistic(prev)));
    setDefaulted(false); // any write materialises the document
    try {
      const data = await api("PUT", body);
      setEnabledLocal(normalizeEnabled(data.enabled));
      setDefaulted(!!data.defaulted);
      setError(null);
    } catch (e) {
      setEnabledLocal(prev);
      setDefaulted(prevDefaulted);
      setError(String(e.message || e));
      throw e;
    }
  }, [defaulted, setEnabledLocal]);

  const install = useCallback(
    (id) => mutate({ enable: [id] }, (prev) => prev.concat([id])),
    [mutate],
  );

  const remove = useCallback(
    (id) => mutate({ disable: [id] }, (prev) => prev.filter((x) => x !== id)),
    [mutate],
  );

  const setEnabled = useCallback(
    (ids) => mutate({ enabled: normalizeEnabled(ids) }, () => ids),
    [mutate],
  );

  const isEnabled = useCallback((id) => enabled.indexOf(id) >= 0, [enabled]);

  const value = useMemo(
    () => ({ enabled, loading, error, defaulted, isEnabled, install, remove, setEnabled, refresh: load }),
    [enabled, loading, error, defaulted, isEnabled, install, remove, setEnabled, load],
  );

  return <PluginsContext.Provider value={value}>{children}</PluginsContext.Provider>;
}

export default PluginsProvider;
