import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from "react";
import { getProjectId, setProjectId } from "@/lib/projectFetch";
import { useConversations } from "@/components/AgentProvider";

// Context for the active project + the project list. Wraps the app so any tab
// (and the header switcher) can read/switch projects. The active project id is
// mirrored into the projectFetch shim (which injects it into every request) and
// into the server (so the eve agent + header-less media resolve to it too).

const ProjectContext = createContext(null);

export function useProjects() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProjects must be used inside <ProjectProvider>");
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

export default function ProjectProvider({ children }) {
  const [projects, setProjects] = useState([]);
  const [currentId, setCurrentId] = useState(getProjectId());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { newChat } = useConversations();

  // Tell the server which project is active so the agent + media follow.
  const activate = useCallback(async (id) => {
    try { await api(`/api/projects/${id}/activate`, "POST"); } catch { /* best effort */ }
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { projects: list, activeId } = await api("/api/projects");
      setProjects(list);
      // Prefer the last-used project (localStorage via the shim) if it still
      // exists, else the server's active project, else the first in the list.
      const saved = getProjectId();
      const pick =
        (saved && list.some((p) => p.id === saved) && saved) ||
        (activeId && list.some((p) => p.id === activeId) && activeId) ||
        list[0]?.id ||
        null;
      if (pick) {
        setProjectId(pick);
        setCurrentId(pick);
        if (pick !== activeId) activate(pick);
      }
      return list;
    } catch (e) {
      setError(String(e.message || e));
      return [];
    } finally {
      setLoading(false);
    }
  }, [activate]);

  useEffect(() => { load(); }, [load]);

  const switchTo = useCallback(async (id) => {
    if (!id || id === currentId) return;
    setProjectId(id);   // shim: subsequent requests carry the new id
    setCurrentId(id);   // remounts the app body (keyed on currentId)
    await activate(id);
  }, [currentId, activate]);

  const create = useCallback(async (name) => {
    const { project } = await api("/api/projects", "POST", { name });
    await load();
    await switchTo(project.id);
    // A fresh project starts with a blank chat — don't carry the previous
    // project's conversation history into it.
    newChat();
    return project;
  }, [load, switchTo, newChat]);

  const rename = useCallback(async (id, name) => {
    await api(`/api/projects/${id}`, "PATCH", { name });
    await load();
  }, [load]);

  const remove = useCallback(async (id) => {
    await api(`/api/projects/${id}`, "DELETE");
    if (id === currentId) {
      const rest = projects.filter((p) => p.id !== id);
      if (rest[0]) await switchTo(rest[0].id);
    }
    await load();
  }, [currentId, projects, switchTo, load]);

  const current = useMemo(
    () => projects.find((p) => p.id === currentId) || null,
    [projects, currentId],
  );

  const value = useMemo(
    () => ({ projects, current, currentId, loading, error, switchTo, create, rename, remove, refresh: load }),
    [projects, current, currentId, loading, error, switchTo, create, rename, remove, load],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}
