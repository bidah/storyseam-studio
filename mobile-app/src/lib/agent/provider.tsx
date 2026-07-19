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
import { router, usePathname } from 'expo-router';
import { useEveAgent } from 'eve/react';
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
  type Chat,
  type ChatStore,
} from './chat-store';

// ---------------------------------------------------------------------------
// A single shared eve agent session for the whole app — port of the web
// AgentProvider.jsx. The chat tab and every "drive the agent from the UI"
// button (Render/Stitch/Trim/…) read from the SAME `useEveAgent` instance.
// `AgentSessionRunner` is keyed on the active chat id: switching chats
// remounts only the runner (rebuilding the eve store from that chat's
// persisted events/cursor); consumers merely re-render. The eve client talks
// to the Worker's /eve proxy — the fetch shim routes it through expo/fetch
// (streaming) and injects cookie/project/model headers.
// ---------------------------------------------------------------------------

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

  const saveTurn = useCallback(
    (id: string, snapshot: any) =>
      update((prev) => {
        const chat = prev.chats[id];
        if (!chat) return prev;
        const next: Chat = {
          ...chat,
          events: snapshot.events ?? chat.events,
          session: snapshot.session ?? chat.session,
          title: deriveTitle(snapshot.data?.messages) ?? chat.title,
          updatedAt: Date.now(),
        };
        const order = [id, ...prev.order.filter((x) => x !== id)];
        return { ...prev, order, chats: { ...prev.chats, [id]: next } };
      }),
    [update],
  );

  const saveSession = useCallback(
    (id: string, session: any) =>
      update((prev) => {
        const chat = prev.chats[id];
        if (!chat) return prev;
        return { ...prev, chats: { ...prev.chats, [id]: { ...chat, session } } };
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

  const getInitial = useCallback((id: string) => {
    const chat = storeRef.current?.chats[id];
    return {
      events: chat?.events ?? [],
      session: chat?.session ?? { streamIndex: 0 },
      attachments: chat?.attachments ?? [],
    };
  }, []);

  // History and active selection are scoped to the current project.
  const list = useMemo(() => (store ? chatsForProject(store, pid) : []), [store, pid]);
  const activeId = useMemo(() => (store ? activeChatId(store, pid) : null), [store, pid]);

  return useMemo(
    () => ({
      hydrated: !!store,
      activeId,
      list,
      newChat,
      switchChat,
      deleteChat,
      saveTurn,
      saveSession,
      saveAttachments,
      getInitial,
    }),
    [store, activeId, list, newChat, switchChat, deleteChat, saveTurn, saveSession, saveAttachments, getInitial],
  );
}

function AgentSessionRunner({
  activeId,
  view,
  conv,
  publish,
}: {
  activeId: string;
  view: string;
  conv: any;
  publish: (agent: any) => void;
}) {
  const viewRef = useRef(view);
  viewRef.current = view;

  const initialRef = useRef<any>(null);
  if (initialRef.current === null) initialRef.current = conv.getInitial(activeId);

  const agent = useEveAgent({
    host: API_ORIGIN,
    initialEvents: initialRef.current.events,
    initialSession: initialRef.current.session,
    prepareSend: (input: any) => ({ ...input, clientContext: { screen: viewRef.current } }),
    onFinish: (snapshot: any) => conv.saveTurn(activeId, snapshot),
    onSessionChange: (session: any) => conv.saveSession(activeId, session),
  });

  useLayoutEffect(() => {
    publish(agent);
  }, [agent, publish]);

  return null;
}

export function AgentProvider({ children }: { children: ReactNode }) {
  const conv = useConversationManager();
  const [agent, setAgent] = useState<any>(null);
  const pathname = usePathname();
  // Which surface the user is on — forwarded to the agent every turn.
  const view = pathname.slice(1).split('/')[0] || 'chat';

  // Per-project chat scoping (restore the last chat on project switch) is handled
  // inside the conversation manager — see `useConversationManager`.

  return (
    <ConversationsContext.Provider value={conv}>
      {conv.hydrated && conv.activeId ? (
        <AgentSessionRunner
          key={conv.activeId}
          activeId={conv.activeId}
          view={view}
          conv={conv}
          publish={setAgent}
        />
      ) : null}
      <AgentContext.Provider value={agent}>{agent ? children : null}</AgentContext.Provider>
    </ConversationsContext.Provider>
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
