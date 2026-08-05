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
  radio: '/api/radio',
  // The animatic's coverage counts (how many shots have a still yet). Derived
  // from the same shot list as `radio`, so the two never disagree.
  animatic: '/api/animatic',
  // The World tab's visual explorer (concept-image generations + prompt presets).
  visualWorld: '/api/visual-world',
  // Where the episode stands: one small counts-and-flags digest of the whole
  // pipeline. Feeds the Chat screen's suggestion cards (lib/suggestions.ts) —
  // which is why it's a digest and not seven full-section fetches.
  status: '/api/status',
} as const;

export type ResourceKey = keyof typeof RESOURCES;

// The key + fetcher for one project-scoped resource, in one place: the cold-start
// path (lib/boot.ts) prefetches some of these into the same cache the hooks read,
// and a key spelled twice is a prefetch that silently warms nothing.
export function projectResourceQuery<T = any>(projectId: string, resource: ResourceKey) {
  return {
    queryKey: [projectId, resource],
    queryFn: () => apiJson<T>(RESOURCES[resource]),
  };
}

export function useProjectResource<T = any>(resource: ResourceKey, enabled = true) {
  const projectId = useProjectStore((s) => s.projectId);
  return useQuery<T>({
    ...projectResourceQuery<T>(projectId as string, resource),
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

export type ProjectList = { projects: Project[]; activeId: string | null };

// Shared with the boot prefetch (lib/boot.ts), same reason as above.
export function projectsQuery() {
  return {
    queryKey: ['account', 'projects'],
    queryFn: () => apiJson<ProjectList>('/api/projects'),
  };
}

export function useProjects() {
  return useQuery<ProjectList>(projectsQuery());
}

// --- Teams / orgs (account-scoped) ------------------------------------------

export type Org = {
  id: string;
  name: string;
  slug?: string;
  personal: boolean;
  role: 'owner' | 'admin' | 'member';
  isOwner: boolean;
  allProjects: boolean;
};

export type OrgGrant = { projectId: string; name: string; role: 'editor' | 'viewer' };

export type OrgMember = {
  userId: string;
  name: string | null;
  email: string | null;
  role: 'owner' | 'admin' | 'member';
  allProjects: boolean;
  grants: OrgGrant[];
};

export type OrgInvitation = {
  id: string;
  email: string;
  role: string;
  scope_mode: 'all' | 'selection';
  project_role: string;
  status: string;
  created_at: string;
  expires_at?: string | null;
};

export function orgsQuery() {
  return {
    queryKey: ['account', 'orgs'] as const,
    queryFn: () => apiJson<{ orgs: Org[] }>('/api/orgs'),
  };
}

// Every org the signed-in user belongs to (their personal one + any they joined).
export function useOrgs() {
  return useQuery(orgsQuery());
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
