import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from "react";
import { getEpisodeId, setEpisodeId, onProjectChange } from "@/lib/projectFetch";

// Context for the active EPISODE of a series + the episode list. Sits one level
// below the project (a project is a feature film or a series of episodes). For a
// feature film the format is "feature", there is a single implicit episode, and
// the switcher stays hidden — everything behaves as it did before episodes
// existed. For a series, switching episode re-points the whole downstream
// pipeline (script → shot list → animatic → editor → cut); the world bible is
// shared across episodes.
//
// The active episode id is mirrored into the projectFetch shim (which sends it as
// `x-episode-id` on every request) and into the server (POST activate), so the
// eve agent + header-less media loads resolve to the same episode.

const DEFAULT_EPISODE = "ep1";
const EpisodeContext = createContext(null);

export function useEpisodes() {
  const ctx = useContext(EpisodeContext);
  if (!ctx) throw new Error("useEpisodes must be used inside <EpisodeProvider>");
  return ctx;
}

async function api(path, method = "GET", body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${method} ${path} failed`);
  return data;
}

export default function EpisodeProvider({ children }) {
  const [episodes, setEpisodes] = useState([]);
  const [format, setFormat] = useState("feature");
  const [activeId, setActiveId] = useState(getEpisodeId() || DEFAULT_EPISODE);
  const [loading, setLoading] = useState(true);

  // Tell the server which episode is active so header-less media loads follow.
  const activate = useCallback(async (id) => {
    try { await api(`/api/episodes/${id}/activate`, "POST"); } catch { /* best effort */ }
  }, []);

  const load = useCallback(async () => {
    try {
      const { episodes: list, activeId: srvActive, format: fmt, defaultEpisodeId } =
        await api("/api/episodes");
      const def = defaultEpisodeId || DEFAULT_EPISODE;
      const eps = Array.isArray(list) && list.length ? list : [{ id: def, number: 1, title: "Episode 1" }];
      setEpisodes(eps);
      setFormat(fmt || "feature");
      // Prefer the last-open episode (localStorage via the shim) if it still
      // exists, else the server's active episode, else the default.
      const saved = getEpisodeId();
      const pick =
        (saved && eps.some((e) => e.id === saved) && saved) ||
        (srvActive && eps.some((e) => e.id === srvActive) && srvActive) ||
        def;
      // Always send the id explicitly (even the default `ep1`, which the server
      // treats as the unsuffixed baseline) so a fetch never depends on the
      // server-side active-episode race.
      setEpisodeId(pick);
      setActiveId(pick);
      // Sync the server's active episode so header-less media loads (`<img>`,
      // which can't send the header) resolve to the picked episode after a
      // reload, not to whatever was last activated.
      if (pick !== srvActive) activate(pick);
    } catch { /* ignore — a fresh/offline project just shows the default */ }
    finally { setLoading(false); }
  }, [activate]);

  useEffect(() => { load(); }, [load]);
  // This provider sits ABOVE the body that remounts on project switch, so it
  // reloads its own episode list when the project changes.
  useEffect(() => onProjectChange(() => { setLoading(true); load(); }), [load]);

  const switchEpisode = useCallback(async (id) => {
    if (!id || id === activeId) return;
    setEpisodeId(id);   // fires onEpisodeChange → RootLayout clears caches + remounts
    setActiveId(id);
    await activate(id);
  }, [activeId, activate]);

  const createEpisode = useCallback(async (title) => {
    const { episode } = await api("/api/episodes", "POST", { title });
    await load();
    await switchEpisode(episode.id);
    return episode;
  }, [load, switchEpisode]);

  const renameEpisode = useCallback(async (id, title) => {
    await api(`/api/episodes/${id}`, "PATCH", { title });
    await load();
  }, [load]);

  const removeEpisode = useCallback(async (id) => {
    await api(`/api/episodes/${id}`, "DELETE");
    if (id === activeId) await switchEpisode(DEFAULT_EPISODE);
    await load();
  }, [activeId, switchEpisode, load]);

  const active = useMemo(
    () => episodes.find((e) => e.id === activeId) || null,
    [episodes, activeId],
  );

  const value = useMemo(
    () => ({
      episodes, format, isSeries: format === "series", active, activeId, loading,
      switchEpisode, createEpisode, renameEpisode, removeEpisode, refresh: load,
    }),
    [episodes, format, active, activeId, loading, switchEpisode, createEpisode, renameEpisode, removeEpisode, load],
  );

  return <EpisodeContext.Provider value={value}>{children}</EpisodeContext.Provider>;
}
