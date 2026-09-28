import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner-native';
import { putJson } from './api';
import { useProjectStore } from './project';
import { useProjectResource } from './queries';

// The project's installed plugins (GET/PUT /api/plugins) — the mobile twin of
// the web's PluginsProvider. Project-level, so both collaborators see the same
// studio. Writes are optimistic, like the web's: the list flips at once and the
// server's answer (or a rollback on failure) settles it.
//
// Uninstalling deletes nothing — the surface goes, the documents stay.

export type PluginsDoc = { enabled: string[]; defaulted?: boolean; updatedAt?: string | null };

export function usePlugins() {
  const projectId = useProjectStore((s) => s.projectId);
  const queryClient = useQueryClient();
  const q = useProjectResource<PluginsDoc>('plugins');
  const key = [projectId, 'plugins'];

  const mutation = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) =>
      putJson<PluginsDoc>('/api/plugins', on ? { enable: [id] } : { disable: [id] }),
    onMutate: async ({ id, on }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<PluginsDoc>(key);
      const enabled = new Set(prev?.enabled ?? []);
      if (on) enabled.add(id);
      else enabled.delete(id);
      queryClient.setQueryData<PluginsDoc>(key, { ...(prev ?? {}), enabled: [...enabled], defaulted: false });
      return { prev };
    },
    onError: (e: any, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(key, ctx.prev);
      toast.error(String(e?.message || e));
    },
    onSuccess: (doc) => queryClient.setQueryData(key, doc),
  });

  const enabled = new Set(q.data?.enabled ?? []);
  return {
    ...q,
    enabled,
    loaded: !!q.data,
    isInstalled: (id: string) => enabled.has(id),
    setInstalled: (id: string, on: boolean) => mutation.mutate({ id, on }),
  };
}
