import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiJson } from './api';
import { useProjectStore } from './project';

// Query layer. Every project-scoped resource is keyed [projectId, resource] so
// a project switch or an SSE firehose event can invalidate the whole scope at
// once (react-query only refetches mounted queries — the mobile equivalent of
// the web's per-tab swr cache + invalidateTabCache/revalidate pair).

export const RESOURCES = {
  world: '/api/world',
  script: '/api/script',
  shotlist: '/api/shotlist',
  packs: '/api/shotlist/packs',
  episode: '/api/episode',
  final: '/api/final',
  audio: '/api/audio',
  storyboard: '/api/storyboard',
  cuts: '/api/episode/cuts',
  library: '/api/library',
  sounds: '/api/sounds',
} as const;

export type ResourceKey = keyof typeof RESOURCES;

export function useProjectResource<T = any>(resource: ResourceKey, enabled = true) {
  const projectId = useProjectStore((s) => s.projectId);
  return useQuery<T>({
    queryKey: [projectId, resource],
    queryFn: () => apiJson<T>(RESOURCES[resource]),
    enabled: enabled && !!projectId,
  });
}

// Invalidate one or more project resources after a mutation — the canonical
// post-write pair from the web app (invalidateTabCache + revalidate).
export function useInvalidate() {
  const queryClient = useQueryClient();
  const projectId = useProjectStore((s) => s.projectId);
  return (...resources: ResourceKey[]) => {
    if (!projectId) return;
    if (resources.length === 0) {
      queryClient.invalidateQueries({ queryKey: [projectId] });
      return;
    }
    for (const r of resources) {
      queryClient.invalidateQueries({ queryKey: [projectId, r] });
    }
  };
}

// --- Projects (account-scoped, not project-scoped) -------------------------

export type Project = { id: string; name: string; created_at?: string; updated_at?: string };

export function useProjects() {
  return useQuery<{ projects: Project[]; activeId: string | null }>({
    queryKey: ['account', 'projects'],
    queryFn: () => apiJson('/api/projects'),
  });
}

// --- Higgsfield gallery (infinite) ------------------------------------------

export function useHiggsfieldImages(size = 24) {
  const projectId = useProjectStore((s) => s.projectId);
  return useInfiniteQuery<any>({
    queryKey: [projectId, 'hfImages'],
    queryFn: ({ pageParam }) =>
      apiJson(
        `/api/higgsfield/images?size=${size}${pageParam ? `&cursor=${encodeURIComponent(String(pageParam))}` : ''}`,
      ),
    initialPageParam: undefined as unknown,
    getNextPageParam: (last: any) => last?.nextCursor ?? last?.cursor ?? undefined,
    enabled: !!projectId,
  });
}
