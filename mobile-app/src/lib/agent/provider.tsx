import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { FlueProvider, useFlueAgent } from '@flue/react';
import { createFlueClient } from '@flue/sdk';
import { API_ORIGIN } from '../env';
import { getProjectId, useProjectStore } from '../project';
import {
  activeChatId,
  chatsForProject,
  deriveTitle,
  loadStore,
  makeChat,
  persistStore,
  trimStore,
  withActiveForProject,
  type ChatStore,
} from './chat-store';

// ---------------------------------------------------------------------------
// A single shared flue agent conversation for the whole app — port of the web
// AgentProvider.jsx. The chat tab and every "drive the agent from the UI"
// button (Render/Stitch/Trim/…) read from the SAME `useFlueAgent` instance.
//
// flue keys a conversation by its instance id, so `AgentSessionRunner` is keyed
// on the active chat id: switching chats (or projects — which mints/reopens a
// per-project chat) remounts only the runner, pointing `useFlueAgent` at the
// new instance id whose durable history flue reloads on its own; consumers
// merely re-render.
//
// The instance id the client passes is `${projectId}~${chatId}`; the Worker
// that proxies `/eve/*` prepends the authenticated `${userId}~` server-side, so
// the full durable key is `userId~projectId~chatId`. The transcript lives in
// the flue Durable Object — the client no longer persists events/sessions. The
// @flue/sdk client uses the global fetch, which the fetch shim (installed at
// index.js import, before this client is constructed) patches to route /eve
// through expo/fetch and inject cookie/project/model headers.
// ---------------------------------------------------------------------------

// The flue agent registered in flue-agent/src/agents/whistlewood.ts.
const AGENT_NAME = 'whistlewood';

// Outside a browser the flue baseUrl MUST be absolute — point it at the
// Worker's /eve proxy. No custom fetch: the SDK captures the (already-patched)
// global fetch at construction and uses globalThis.fetch for stream reconnects.
const flueClient = createFlueClient({ baseUrl: `${API_ORIGIN}/eve` });

const AgentContext = createContext<any>(null);
const ConversationsContext = createContext<any>(null);

function useConversationManager() {
  const [store, setStore] = useState<ChatStore | null>(null);
  const storeRef = useRef<ChatStore | null>(null);
  storeRef.current = store;

  // The current project (chats and history are scoped to it). The whole app
  // renders behind a boot gate that awaits project hydration, so `getProjectId()`
  // is already correct when the store loads below.
  const pid = useProjectStore((s) => s.projectId);

  // Hydrate once from AsyncStorage, scoped to the project active at load time.
  useEffect(() => {
    let alive = true;
    loadStore(getProjectId()).then((s) => {
      if (alive) setStore(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  const update = useCallback((fn: (prev: ChatStore) => ChatStore) => {
    setStore((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      if (next === prev) return prev;
      persistStore(next);
      return next;
    });
  }, []);

  // Switching to a project reopens its last-active chat, or mints a fresh one if
  // it has none yet — the core of "chat is per project".
  useEffect(() => {
    if (!store) return;
    update((prev) => withActiveForProject(prev, pid));
  }, [pid, store, update]);

  const newChat = useCallback(() => {
    update((prev) => {
      const c = makeChat(pid ?? null);
      return trimStore({
        activeByProject: { ...prev.activeByProject, [pid || '']: c.id },
        order: [c.id, ...prev.order],
        chats: { ...prev.chats, [c.id]: c },
      });
    });
  }, [update, pid]);

  const switchChat = useCallback(
    (id: string) =>
      update((prev) => {
        const chat = prev.chats[id];
        if (!chat) return prev;
        const key = chat.projectId || '';
        if (prev.activeByProject[key] === id) return prev;
        return { ...prev, activeByProject: { ...prev.activeByProject, [key]: id } };
      }),
    [update],
  );

  const deleteChat = useCallback(
    (id: string) =>
      update((prev) => {
        const chat = prev.chats[id];
        if (!chat) return prev;
        const order = prev.order.filter((x) => x !== id);
        const chats = { ...prev.chats };
        delete chats[id];
        const activeByProject = { ...prev.activeByProject };
        for (const k of Object.keys(activeByProject)) {
          if (activeByProject[k] === id) delete activeByProject[k];
        }
        // If that emptied the chat's project, hand it a fresh blank one.
        return withActiveForProject({ activeByProject, order, chats }, chat.projectId);
      }),
    [update],
  );

  // Note live activity in one chat: refresh its title from the first user line
  // (flue owns the transcript, so the title is all we still derive here) and
  // float it to the top of the list. A no-op once the title has settled, so the
  // runner can call it on every `messages` change without thrashing the store.
  const noteActivity = useCallback(
    (id: string, title: string | null) =>
      update((prev) => {
        const chat = prev.chats[id];
        if (!chat) return prev;
        const nextTitle = title ?? chat.title;
        const alreadyTop = prev.order[0] === id;
        if (nextTitle === chat.title && alreadyTop) return prev;
        const order = alreadyTop ? prev.order : [id, ...prev.order.filter((x) => x !== id)];
        const next = { ...chat, title: nextTitle, updatedAt: Date.now() };
        return { ...prev, order, chats: { ...prev.chats, [id]: next } };
      }),
    [update],
  );

  const saveAttachments = useCallback(
    (id: string, attachments: any[]) =>
      update((prev) => {
        const chat = prev.chats[id];
        if (!chat) return prev;
        return { ...prev, chats: { ...prev.chats, [id]: { ...chat, attachments } } };
      }),
    [update],
  );

  // The composer's client-only attachment record for a given chat. Reads the ref
  // so a runner keyed on a just-created chat still sees it.
  const getInitial = useCallback((id: string) => {
    const chat = storeRef.current?.chats[id];
    return { attachments: chat?.attachments ?? [] };
  }, []);

  // History and active selection are scoped to the current project.
  const list = useMemo(() => (store ? chatsForProject(store, pid) : []), [store, pid]);
  const activeId = useMemo(() => (store ? activeChatId(store, pid) : null), [store, pid]);

  return useMemo(
    () => ({
      hydrated: !!store,
      pid,
      activeId,
      list,
      newChat,
      switchChat,
      deleteChat,
      noteActivity,
      saveAttachments,
      getInitial,
    }),
    [store, pid, activeId, list, newChat, switchChat, deleteChat, noteActivity, saveAttachments, getInitial],
  );
}

function AgentSessionRunner({
  activeId,
  projectId,
  conv,
  publish,
}: {
  activeId: string;
  projectId: string | null;
  conv: any;
  publish: (agent: any) => void;
}) {
  // flue's durable key. The Worker prepends `${userId}~`; we own the rest.
  const id = `${projectId ?? ''}~${activeId}`;
  const flueAgent = useFlueAgent({ name: AGENT_NAME, id });

  // `stop` closes over `id`; reach it through a ref so it stays out of the
  // `agent` memo deps (which key on `flueAgent` only).
  const idRef = useRef(id);
  idRef.current = id;

  // The turn that just settled may have written any project resource (save_shotlist,
  // save_world, a render…). The SSE firehose covers this too, but it is a single
  // remote stream that can be down without anyone noticing — this is the local,
  // always-available signal, and it is naturally edge-triggered (once per turn).
  // A double invalidate is harmless; react-query only refetches mounted queries.
  const queryClient = useQueryClient();
  const invalidateProject = useCallback(() => {
    const pid = getProjectId();
    if (pid) queryClient.invalidateQueries({ queryKey: [pid] });
  }, [queryClient]);

  // eve gave us an `onFinish` callback; flue is state-driven, so we edge-trigger
  // on the status settling out of a busy phase (submitted/streaming → idle/error)
  // — the flue equivalent of "the turn just ended". This replaces eve's onFinish
  // as the moment to refetch project data touched by the turn.
  const prevStatusRef = useRef(flueAgent.status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = flueAgent.status;
    const wasBusy = prev === 'submitted' || prev === 'streaming';
    const settled = flueAgent.status === 'idle' || flueAgent.status === 'error';
    if (wasBusy && settled) invalidateProject();
  }, [flueAgent.status, invalidateProject]);

  // Adapt flue's surface (`messages`, `status`, `sendMessage`) to the shape the
  // rest of the app consumes (`messages`, `status`, `send`, `stop`, `error`).
  // flue's resting status is "idle"; the app treats "ready" as not-busy (see
  // `agentIsBusy`), so map idle → "ready".
  const agent = useMemo(
    () => ({
      messages: flueAgent.messages,
      status: flueAgent.status === 'idle' ? 'ready' : flueAgent.status,
      error: flueAgent.error,
      historyReady: flueAgent.historyReady,
      // `send({ message, images })` — `message` is a plain string; `images` is
      // flue's optional `AgentPromptImage[]` (`{ type:'image', data, mimeType }`).
      send: ({ message = '', images }: { message?: string; images?: any[] } = {}) =>
        flueAgent.sendMessage(message, images?.length ? { images } : undefined),
      // Cancel the in-flight turn. `useFlueAgent` surfaces no stop, but the
      // underlying client does: `agents.abort` POSTs `/agents/:name/:id/abort`,
      // which the flue worker threads as an AbortSignal through the running turn
      // (and its in-flight tool calls) and settles the submission to `aborted`.
      // The `/eve` proxy prepends `${userId}~`, so `id` matches the one
      // `useFlueAgent` observes. Swallow errors — the SSE observation settles the
      // turn regardless. This is also the ONLY recovery path when a turn orphans
      // (DO evicted / hung tool mid-turn): without it `status` stays "streaming"
      // forever, the composer stays disabled, and the chat is unrecoverably stuck
      // on "Thinking…". Mirrors the web adapter (src/components/AgentProvider.jsx).
      stop: () => {
        flueClient.agents.abort(AGENT_NAME, idRef.current).catch(() => {});
      },
    }),
    [flueAgent],
  );

  // Keep the chat list titled + floated from the live transcript (flue owns the
  // transcript, so this replaces eve's onFinish snapshot persistence).
  useEffect(() => {
    const title = deriveTitle(flueAgent.messages);
    if (title) conv.noteActivity(activeId, title);
  }, [flueAgent.messages, activeId, conv]);

  // Publish before paint so switching chats never flashes stale content.
  useLayoutEffect(() => {
    publish(agent);
  }, [agent, publish]);

  return null;
}

export function AgentProvider({ children }: { children: ReactNode }) {
  const conv = useConversationManager();
  const [agent, setAgent] = useState<any>(null);

  // Per-project chat scoping (restore the last chat on project switch) is handled
  // inside the conversation manager — see `useConversationManager`.

  return (
    <FlueProvider client={flueClient}>
      <ConversationsContext.Provider value={conv}>
        {conv.hydrated && conv.activeId ? (
          <AgentSessionRunner
            key={conv.activeId}
            activeId={conv.activeId}
            projectId={conv.pid ?? null}
            conv={conv}
            publish={setAgent}
          />
        ) : null}
        <AgentContext.Provider value={agent}>{agent ? children : null}</AgentContext.Provider>
      </ConversationsContext.Provider>
    </FlueProvider>
  );
}

export function useAgent() {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error('useAgent must be used within <AgentProvider>');
  return ctx;
}

export function useConversations() {
  const ctx = useContext(ConversationsContext);
  if (!ctx) throw new Error('useConversations must be used within <AgentProvider>');
  return ctx;
}

// Is the agent mid-turn (can't accept a new `send`)?
export function agentIsBusy(agent: any) {
  return agent?.status === 'submitted' || agent?.status === 'streaming';
}

// Drive the agent from anywhere in the UI and reveal the Chat tab so the user
// lands where the turn streams in. On the web app chat is an always-visible
// side panel, so a bare `agent.send` is enough; on mobile chat is its own tab,
// so every "drive the agent from a button" surface (World/Script/Render/
// Stitch/Trim/Score/Sound…) must navigate to Chat. This is the single
// mechanism for that — prefer it over calling `agent.send` directly from those
// surfaces. Returns the send promise (rejects if the agent is mid-turn; the
// button should already be disabled via `agentIsBusy`).
export function useSendToAgent() {
  const agent = useAgent();
  return useCallback(
    (message: string) => {
      router.navigate('/(tabs)/chat');
      return agent?.send?.({ message });
    },
    [agent],
  );
}
