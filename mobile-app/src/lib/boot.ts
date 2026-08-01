import type { QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { authClient, seedSession } from './auth-client';
import { hydrateAgentModel } from './agent-model';
import { hydrateChatProvider } from './chat-provider';
import { hydrateFalKey } from './fal-key';
import { hydrateAtlasKey } from './atlas-key';
import { hydrateProviders } from './providers';
import { hydrateSandboxMode } from './sandbox-mode';
import { hydrateSearchProvider } from './search-provider';
import { hydrateSearchKeys } from './search-keys';
import { hydrateTheme } from './theme';
import { getProjectId, hydrateProjectId, setProjectId } from './project';
import { projectResourceQuery, projectsQuery } from './queries';
import { activeChatId, preloadStore } from './agent/chat-store';
import { preloadTranscript } from './agent/transcript-cache';

// Cold start — everything the first screen needs, done while the native splash
// is still up.
//
// The app used to lift the splash as soon as AsyncStorage came back and then
// discover the rest ON SCREEN: (tabs)/_layout blocked on `useSession()`'s
// network round trip behind a centred spinner, ProjectGate blocked on
// /api/projects behind a second one, <AgentProvider> held the tab body empty
// until the chat store parsed, and Home's deck came up as skeletons while
// /api/status landed. Four waits the author watched, for work that could just as
// well happen behind the picture they were already looking at.
//
// So it happens there. `bootstrap()` resolves when the first frame can be the
// real screen — or when BOOT_DEADLINE_MS is up, whichever comes first. The
// deadline is the point: a phone on a dead network still has to reach the UI, so
// every gate this replaces is still in place downstream. They stop being the
// common path; they don't stop being the fallback.
//
// Order matters only where it has to:
//   · the local stores and the session are independent — both start immediately
//   · /api/projects and /api/status both need the project id (the fetch shim
//     reads it off the store), so they wait on project hydration — but not on
//     each other: with an id already stored, the status prefetch runs alongside
//     the list that merely VALIDATES it, which is one round trip, not two
//   · the chat store is a local read, and needs the project id for the same reason
//
// Nothing here throws. A step that fails leaves the surface it feeds to its own
// loading state, which is exactly the behaviour this replaces.
//
// Not preloaded, deliberately: fonts (the app ships none — every surface is on
// the system face) and bundled images (the first screen draws mesh gradients and
// lucide SVGs; its only pictures are the suggestion-card loops, which stream from
// R2 into expo-video's disk cache — see lib/card-art.ts). Add an `Asset.loadAsync`
// step here the day a screen's first frame needs a file out of `assets/`.

// Long enough for three small round trips on a mediocre connection, short enough
// that a launch which is going badly still becomes a screen you can look at. Past
// it the splash lifts mid-work; the work carries on and lands where it would have.
export const BOOT_DEADLINE_MS = 4000;

type BootState = {
  /**
   * The session question got an ANSWER during boot (signed in or not) — as
   * opposed to still being open, which is what `useSession().isPending` means on
   * a fresh atom. (tabs)/_layout reads this to tell "we know, and it's no" from
   * "we don't know yet": the first is a redirect to /sign-in, the second is the
   * spinner. Stays false when the fetch failed (offline), so the old gate keeps
   * covering that case.
   */
  sessionSettled: boolean;
};

export const useBootStore = create<BootState>(() => ({ sessionSettled: false }));

let running: Promise<void> | null = null;

/** Run the cold-start work. Idempotent — later callers await the first run. */
export function bootstrap(queryClient: QueryClient): Promise<void> {
  if (!running) running = withDeadline(run(queryClient), BOOT_DEADLINE_MS);
  return running;
}

async function run(queryClient: QueryClient) {
  // The session fetch only needs the cookie, which better-auth reads out of
  // SecureStore itself — so it does NOT wait on our stores.
  const session = resolveSession();
  await Promise.all([
    hydrateAgentModel(),
    hydrateChatProvider(),
    hydrateFalKey(),
    hydrateAtlasKey(),
    hydrateProviders(),
    hydrateSandboxMode(),
    hydrateSearchProvider(),
    hydrateSearchKeys(),
    hydrateTheme(),
    hydrateProjectId(),
  ]);

  // Signed out, or we couldn't tell: the sign-in screen needs none of what
  // follows, and every request would 401 anyway.
  if (!(await session)) return;

  const stored = getProjectId();
  const warmStored = stored ? warmProject(queryClient, stored) : null;
  const pid = await resolveProject(queryClient);
  await Promise.all([warmStored, pid && pid !== stored ? warmProject(queryClient, pid) : null]);
}

// Resolve the session ourselves and seed the atom `useSession` reads, so the tab
// layout's first render is settled rather than pending.
async function resolveSession(): Promise<boolean> {
  try {
    const { data, error } = await authClient.getSession();
    if (data) {
      seedSession(data);
      useBootStore.setState({ sessionSettled: true });
      return true;
    }
    // A DEFINITIVE no — the server answered, and the answer is "nobody" (or
    // "not you"). Anything else (offline, 5xx, a proxy eating the request) is
    // not an answer: leave the flag down so the old gate covers it rather than
    // bouncing a signed-in author to /sign-in because their train went into a
    // tunnel.
    if (!error || (error as any).status === 401) useBootStore.setState({ sessionSettled: true });
    return false;
  } catch {
    return false;
  }
}

// Which project the app opens in — the same rule ProjectGate applies, moved
// ahead of the first frame: keep the stored id if the server still lists it,
// otherwise take the server's active project (or the first one there is).
async function resolveProject(queryClient: QueryClient): Promise<string | null> {
  try {
    const list = await queryClient.fetchQuery(projectsQuery());
    const ids = new Set((list.projects || []).map((p) => p.id));
    const stored = getProjectId();
    if (stored && ids.has(stored)) return stored;
    const next = (list.activeId && ids.has(list.activeId) ? list.activeId : list.projects?.[0]?.id) ?? null;
    setProjectId(next);
    return next;
  } catch {
    return getProjectId();
  }
}

// What a project's first screen reads: the status digest behind Home's
// suggestion deck, and the local chat store + the active chat's transcript cover
// that <AgentProvider> gates the whole tab body on.
async function warmProject(queryClient: QueryClient, pid: string) {
  await Promise.all([
    // prefetchQuery swallows its own errors — a 403 for a stale stored id parks
    // nothing in the cache and the mounted query retries under the real one.
    queryClient.prefetchQuery(projectResourceQuery(pid, 'status')),
    warmChatStore(pid),
  ]);
}

async function warmChatStore(pid: string) {
  try {
    const store = await preloadStore(pid);
    const id = activeChatId(store, pid);
    if (id) await preloadTranscript(id);
  } catch {
    // The provider falls back to reading it itself.
  }
}

// Resolves with `p`, or when `ms` is up — whichever lands first. `p`'s remaining
// work keeps going either way; it just stops holding the splash.
function withDeadline(p: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    p.catch(() => {}).then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
