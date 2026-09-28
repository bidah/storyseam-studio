import { useQueryClient } from '@tanstack/react-query';
import { postJson } from './api';
import { useProjectStore } from './project';
import type { ProjectList } from './queries';

// Make `id` the current project — the same three moves as the header's project
// switcher (stored id → every header and media URL follows; drop project-scoped
// caches so nothing stale crosses over; mirror it server-side). A Film makes a
// project of its own, so opening one adopts it: its studio is then the Studio
// tab, the agent's chat is its chat, and its media resolves.
//
// Only project-scoped queries (keyed [projectId, …]) are dropped: account-level
// ones (['account', …], ['film', …]) survive the switch.
export function useAdoptProject() {
  const queryClient = useQueryClient();
  return (id: string | null | undefined, name?: string) => {
    if (!id) return;
    const current = useProjectStore.getState().projectId;
    if (id === current) return;
    // Put it in the cached project list FIRST: the tabs' ProjectGate falls back
    // to the server's active project when the stored id isn't listed, and a
    // Film's project is brand new — the cached list predates it.
    queryClient.setQueryData<ProjectList>(['account', 'projects'], (prev) =>
      prev && !prev.projects.some((p) => p.id === id)
        ? { ...prev, projects: [{ id, name: name || 'Film' }, ...prev.projects], activeId: id }
        : prev,
    );
    useProjectStore.getState().setProjectId(id);
    if (current) queryClient.removeQueries({ queryKey: [current] });
    queryClient.invalidateQueries({ queryKey: ['account', 'projects'] });
    postJson(`/api/projects/${id}/activate`).catch(() => {});
  };
}
