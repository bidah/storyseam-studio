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
import { AppState } from 'react-native';
import * as Haptics from 'expo-haptics';
import { create } from 'zustand';
import { useQueryClient } from '@tanstack/react-query';
import { useFlueAgent } from '@flue/react';
import { createFlueClient } from '@flue/sdk';
import { API_ORIGIN } from '../env';
import { getProjectId, useProjectStore } from '../project';
import { useOpenChat } from './chat-route';
import { deleteJson, putJson, apiJson } from '../api';
import {
  activeChatId,
  chatsForProject,
  deriveTitle,
  loadStore,
  makeChat,
  mergeServerChats,
  persistStore,
  takePreloadedStore,
  trimStore,
  withActiveForProject,
  type Chat,
  type ChatStore,
  type ServerChat,
} from './chat-store';
import {
  dropTranscript,
  preloadTranscript,
  pruneTranscripts,
  saveTranscript,
} from './transcript-cache';
import { isChatMessage } from '@/components/chat/helpers';

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

// Where the flue worker mounts the agent (flue-agent/src/app.ts), reached
// through the Worker's /eve proxy — which also picks WHICH flue worker from the
// chat id's prefix (see chat-engine.ts). Outside a browser the URL MUST be
// absolute. No custom fetch: the SDK captures the (already-patched) global fetch
// at construction and uses globalThis.fetch for stream reconnects.
const AGENT_MOUNT = `${API_ORIGIN}/eve/agents/whistlewood`;

const ConversationsContext = createContext<any>(null);

// The session, held in a module store — and THE only place it is held.
//
// <AgentProvider> is mounted inside the tab layout (it needs the resolved project,
// and it renders nothing until flue publishes a session, which no sign-in screen
// should wait on). The chat modal, though, is a ROOT stack route — it has to be,
// or presenting it would switch the visible tab out from under the user — so it
// renders as a sibling of the tabs and context can't reach it. A native modal
// leaves the tabs mounted underneath, so the session is alive and merely out of
// context reach; this store is how the modal gets at the very same one (never a
// second flue session).
//
// It is a STORE rather than a context because the agent object is rebuilt on
// every streamed batch. Held in provider state behind a context, that rebuild
// re-rendered AgentProvider — and with it every screen mounted under the tabs,
// including the ones on tabs nobody was looking at. Profiled over 30s of one
// streaming turn: 140 AgentProvider renders (avg 23.5ms, max 56.6ms), 280
// renders each of the Chat tab's landing screen and WorldSurface, both
// off-screen. That saturated the JS thread, and the visible symptom was the chat
// header's close button and the tab-bar pill silently dropping taps mid-turn
// (measured: ~40% of closes and ~50% of pill taps lost while streaming, versus
// zero when idle). A store lets each caller subscribe to the FIELD it reads, so
// a token batch only re-renders the transcript. See `useAgent`.
type AgentBus = { agent: any; conv: any };
const useAgentBus = create<AgentBus>(() => ({ agent: null, conv: null }));

/** Distinguishes "no session yet" from a selector that legitimately returned undefined. */
const NO_SESSION = Symbol('no-session');

function useConversationManager() {
  const [store, setStore] = useState<ChatStore | null>(null);
  const storeRef = useRef<ChatStore | null>(null);
  storeRef.current = store;

  // The current project (chats and history are scoped to it). The whole app
  // renders behind a boot gate that awaits project hydration, so `getProjectId()`
  // is already correct when the store loads below.
  const pid = useProjectStore((s) => s.projectId);

  // Hydrate once from AsyncStorage, scoped to the project active at load time.
  // On a cold start the boot gate has usually done this read already (behind the
  // splash, cover warmed and all — lib/boot.ts); taking its hand-off publishes on
  // this first render instead of a disk round trip later, with the tab body empty
  // in between. Everything else — a project switch, a remount — reads from disk.
  useEffect(() => {
    let alive = true;
    const pid = getProjectId();
    // The hand-off, when there is one, is the same store `loadStore` would have
    // returned — already read, and with its cover already in memory, so the two
    // awaits below cost nothing and this publishes on the next tick instead of
    // after a disk round trip.
    const handed = takePreloadedStore(pid);
    (handed ? Promise.resolve(handed) : loadStore(pid)).then(async (s) => {
      // Warm the last chat's local transcript cover BEFORE publishing the store:
      // nothing renders until we do, so the chat screen's very first frame can
      // read it synchronously (peekTranscript) and open already-drawn instead of
      // flashing the empty state while flue re-streams durable history.
      const id = activeChatId(s, pid);
      if (id) await preloadTranscript(id);
      if (!alive) return;
      setStore(s);
      // Housekeeping: covers for chats this store no longer knows about (deleted
      // on another launch, or shed by `trimStore`) are dead weight.
      pruneTranscripts(s.order);
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

  // ---- Server sync (worker/src/routes/chats.js) — port of the web wiring ----
  // The local store is a cache; the shared registry in D1 is what makes a chat
  // started on another device (the web app, another phone) show up here.
  //
  // Pull: `refreshChats` fetches this user's chats for the current project and
  // merges them in. Runs after hydration + on project switch; the history sheet
  // re-runs it on open through react-query (keyed [pid, 'chats'], so the
  // turn-settled invalidation refreshes it in the background too).
  //
  // Push: the effect below diffs the store against what was last pushed and
  // PUTs any chat whose title/recency changed. Blank "New chat" placeholders
  // never sync — `withActiveForProject` mints one per project, and syncing
  // those would strew empty rows across every device.
  const pushedRef = useRef(new Map<string, string>()); // chat id → last-pushed signature
  const chatSig = (c: Chat) => `${c.title}|${c.titled ? 1 : 0}|${c.updatedAt}`;
  // Pushes wait for the first successful pull (which seeds the pushed map) —
  // without that gate, every launch would re-PUT the whole local history in one
  // burst against a single compare-and-swapped D1 row. Bumped per pull so the
  // push effect re-runs even when the merge changed nothing locally.
  const [syncEpoch, setSyncEpoch] = useState(0);

  const markSynced = useCallback(
    (id: string) =>
      update((prev) => {
        const chat = prev.chats[id];
        if (!chat || chat.synced) return prev;
        return { ...prev, chats: { ...prev.chats, [id]: { ...chat, synced: true } } };
      }),
    [update],
  );

  const refreshChats = useCallback(async () => {
    const want = getProjectId();
    if (!want) return null;
    try {
      const { chats } = await apiJson<{ chats: ServerChat[] }>('/api/chats');
      if (getProjectId() !== want) return null; // project switched mid-flight
      // Adopted-from-server values must not bounce straight back as pushes —
      // seed the pushed map with the merged signature first. A chat where the
      // LOCAL side is newer keeps a different signature, so the push effect
      // still sends it up.
      update((prev) => {
        const next = mergeServerChats(prev, want, chats);
        for (const s of chats || []) {
          if (next.chats[s.id]) pushedRef.current.set(s.id, chatSig(next.chats[s.id]));
        }
        return next;
      });
      setSyncEpoch((e) => e + 1);
      return chats;
    } catch {
      return null; // offline — the local cache stands
    }
  }, [update]);

  useEffect(() => {
    if (!store) return;
    refreshChats();
    // Re-pull on project switch; `store` is deliberately read through a ref-ish
    // guard (the boolean) so this doesn't refire on every store change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!store, pid, refreshChats]);

  useEffect(() => {
    if (!store || !syncEpoch) return; // no push before the first pull has seeded the map
    for (const id of store.order) {
      const c = store.chats[id];
      // Only this project's chats: the fetch shim stamps x-project-id with the
      // CURRENT project, so pushing another project's chat would file it under
      // the wrong one. Its own turn comes when that project is active.
      if (!c || c.projectId !== pid || c.title === 'New chat') continue;
      const sig = chatSig(c);
      if (pushedRef.current.get(id) === sig) continue;
      pushedRef.current.set(id, sig);
      putJson(`/api/chats/${encodeURIComponent(id)}`, {
        title: c.title,
        titled: !!c.titled,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })
        .then(() => markSynced(id))
        .catch(() => pushedRef.current.delete(id)); // retry on the next store change
    }
  }, [store, pid, syncEpoch, markSynced]);

  // Mint a chat, make it active, and RETURN its id — the caller needs it to
  // navigate to that chat's route (`/(tabs)/chat/<id>`). The chat is built
  // outside the updater so the id survives a double-invoked updater (StrictMode)
  // and is readable synchronously here.
  const newChat = useCallback(() => {
    const c = makeChat(pid ?? null);
    update((prev) =>
      trimStore({
        activeByProject: { ...prev.activeByProject, [pid || '']: c.id },
        order: [c.id, ...prev.order],
        chats: { ...prev.chats, [c.id]: c },
      }),
    );
    return c.id;
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
    (id: string) => {
      dropTranscript(id); // its local cover goes with it
      // Forget it everywhere, not just this device. Fire-and-forget: deleting
      // an id the registry never saw is a no-op on the server.
      pushedRef.current.delete(id);
      deleteJson(`/api/chats/${encodeURIComponent(id)}`).catch(() => {});
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
      });
    },
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
        // An AI-generated title (locked in on the web, arriving here via the
        // server registry) beats the derived first-line fallback.
        const nextTitle = chat.titled ? chat.title : (title ?? chat.title);
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
      refreshChats,
    }),
    [store, pid, activeId, list, newChat, switchChat, deleteChat, noteActivity, saveAttachments, getInitial, refreshChats],
  );
}

// ---------------------------------------------------------------------------
// Agent-stream resilience (a port of the data-firehose recovery in
// src/lib/sse.ts, aimed at the flue observation instead).
//
// flue's SSE observation lives inside @flue/react's AgentSession and has NO
// RN-aware liveness recovery: a fatal transport error (401/403/404) terminates
// it for good with no reconnect, and a half-open socket (app backgrounded, Wi-Fi
// ↔ cellular handoff) zombies it silently — reader.read() never resolves and
// never throws. In every case `status` pins at submitted/streaming and the chat
// sticks on "Thinking…" forever: the pending `submission-settled` is never
// delivered, and even a subsequent send won't stream because the observation is
// dead. `agents.abort` (the Stop button) is the ONLY manual escape today.
//
// We self-heal by REMOUNTING the runner (its `key` carries a resync nonce), which
// builds a fresh AgentSession → fresh observe: it reloads durable history (picking
// up any settlement that landed while we were dead) and reopens the SSE stream.
// Resyncs are rate-limited so a genuinely-dead stream (a real auth expiry) surfaces
// its error card instead of flash-looping.
const AGENT_WATCHDOG_MS = 60000; // busy this long with zero transcript progress → stream is dead
const RESYNC_MAX = 3; // at most this many remounts…
const RESYNC_WINDOW_MS = 30000; // …within this window, then give up and leave the error visible

// Is a tool call still in flight on the last assistant message? A long tool
// (a render) legitimately streams no deltas for minutes, so the watchdog must
// not mistake that quiet for a dead stream.
function hasRunningTool(messages: any[]): boolean {
  const last = messages[messages.length - 1];
  if (!last || last.role === 'user') return false;
  return (last.parts || []).some(
    (p: any) =>
      p.type === 'dynamic-tool' && p.state !== 'output-available' && p.state !== 'output-error',
  );
}

// Is a turn observably in flight, whoever started it?
//
// flue's own `status` only reports busy for sends THIS AgentSession made
// (`activeSubmissionIds` is fed by local sends alone) or while a text/reasoning
// delta is literally mid-flush. But this runner REMOUNTS its session mid-turn
// on purpose — the resync paths below, plus every cold start into a turn that
// is still running (including one started from the web app) — and a remounted
// observer reads `idle` for the rest of the turn outside those flushes.
//
// The durable answer is the SETTLEMENT LEDGER, not the part states: every
// tracked submission gets a `FlueConversationSettlement` row
// (completed/failed/aborted) when its turn ends, the observation streams that
// ledger to every device, and canonical user messages carry their
// `submissionId`. So the turn is in flight exactly while the newest user
// message's submission is unsettled. An earlier version pattern-matched on
// unfinished parts instead, and flickered idle at every step boundary (a tool
// settles, the next step's first delta hasn't flushed — flue batches flushes
// ~1s apart): the shimmer vanished, the composer unlocked, and a message sent
// into that gap tangled the running turn.
//
// A submission that never settles (DO evicted mid-turn) pins this on busy;
// that is deliberate — the shimmer telling the truth ("nothing arrived, turn
// never ended") with Stop as the escape hatch, same as a hung local send.
function turnInFlight(messages: any[], settlements: any[]): boolean {
  // The newest user message names the current turn's submission. An optimistic
  // local echo has no submissionId yet — flue's own status covers that beat
  // (`submitted` while the send awaits admission).
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    if (typeof m.submissionId !== 'string') return false;
    return !settlements.some((s) => s?.submissionId === m.submissionId);
  }
  return false;
}

function AgentSessionRunner({
  activeId,
  projectId,
  conv,
  publish,
  requestResync,
}: {
  activeId: string;
  projectId: string | null;
  conv: any;
  publish: (agent: any) => void;
  requestResync: () => void;
}) {
  // flue's durable key. The Worker prepends `${userId}~`; we own the rest.
  const id = `${projectId ?? ''}~${activeId}`;
  // A flue 2 client addresses exactly ONE conversation — there is no
  // deployment-wide client and no agent-name addressing left, just this URL.
  // Memoized on the URL because a new client instance replaces the session.
  const client = useMemo(() => createFlueClient({ url: `${AGENT_MOUNT}/${id}` }), [id]);
  const flueAgent = useFlueAgent({ client });

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

  // The status the app actually consumes: flue's, lifted to `streaming` while
  // the transcript shows a turn still running that flue lost track of (see
  // `turnInFlight` — a remounted observer has no local record of the
  // submission). Everything below — the settle edge, the resilience refs, the
  // published agent — reads THIS, so the pill, the shimmer and the composer
  // gate agree with the transcript instead of with flue's blinkered status.
  const effectiveStatus =
    flueAgent.status === 'idle' && turnInFlight(flueAgent.messages, flueAgent.settlements ?? [])
      ? 'streaming'
      : flueAgent.status;

  // eve gave us an `onFinish` callback; flue is state-driven, so we edge-trigger
  // on the status settling out of a busy phase (submitted/streaming → idle/error)
  // — the flue equivalent of "the turn just ended". This replaces eve's onFinish
  // as the moment to refetch project data touched by the turn.
  //
  // It is also the ONLY correct moment for the "reply landed" haptic: the tap
  // must fire when the turn is DONE, not when the first token arrives, so it
  // hangs off this same busy → settled edge (edge-triggered ⇒ exactly one tap
  // per turn, however many deltas streamed). Light impact for a normal finish,
  // the Error notification pattern when the turn settled by failing. Living in
  // the provider rather than the chat screen means the tap still fires when the
  // user has navigated to another tab while the agent worked.
  const prevStatusRef = useRef(effectiveStatus);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = effectiveStatus;
    const wasBusy = prev === 'submitted' || prev === 'streaming';
    const settled = effectiveStatus === 'idle' || effectiveStatus === 'error';
    if (!wasBusy || !settled) return;
    invalidateProject();
    if (effectiveStatus === 'error') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  }, [effectiveStatus, invalidateProject]);

  // --- Agent-stream resilience (see the block above the component) ---
  const busy = effectiveStatus === 'submitted' || effectiveStatus === 'streaming';
  const busyRef = useRef(busy);
  busyRef.current = busy;

  // (a) Fatal transport error (401/403/404) terminates the observation for good.
  // Remount to reopen the stream, so the error can clear and the next send streams.
  const errPrevRef = useRef(flueAgent.status);
  useEffect(() => {
    const prev = errPrevRef.current;
    errPrevRef.current = flueAgent.status;
    if (prev !== 'error' && flueAgent.status === 'error') requestResync();
  }, [flueAgent.status, requestResync]);

  // (b) Foreground: iOS silently kills the socket on background. A turn that was
  // in flight while we were away may have finished (or zombied) — rebuild on return.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && busyRef.current) requestResync();
    });
    return () => sub.remove();
  }, [requestResync]);

  // (c) Zombie watchdog: this effect re-arms on every transcript change, so during
  // real streaming (deltas land constantly) it never fires. Only busy-with-zero-
  // progress — and no tool legitimately running — for AGENT_WATCHDOG_MS trips it.
  useEffect(() => {
    if (!busy || hasRunningTool(flueAgent.messages)) return;
    const timer = setTimeout(requestResync, AGENT_WATCHDOG_MS);
    return () => clearTimeout(timer);
  }, [busy, flueAgent.messages, requestResync]);

  // The transcript the app consumes: flue's, minus system advisories (skill /
  // instruction delta narration after a deploy, abort markers — see
  // `isChatMessage`). Memoized on the stable `flueAgent.messages` snapshot so
  // the array identity only moves when the transcript does — consumers select
  // on it (see the streaming re-render notes in conversation.tsx). Everything
  // internal (turnInFlight, hasRunningTool, saveTranscript, deriveTitle) keeps
  // reading the raw messages.
  const messages = useMemo(() => flueAgent.messages.filter(isChatMessage), [flueAgent.messages]);

  // Adapt flue's surface (`messages`, `status`, `sendMessage`) to the shape the
  // rest of the app consumes (`messages`, `status`, `send`, `stop`, `error`).
  // flue's resting status is "idle"; the app treats "ready" as not-busy (see
  // `agentIsBusy`), so map idle → "ready".
  const agent = useMemo(
    () => ({
      // Which chat this session is bound to. The context publishes ONE agent at
      // a time, so a screen opened for a specific chat must be able to tell
      // whether the runner has caught up to it yet (it repoints a render later,
      // keyed on activeId) before rendering a transcript or sending a draft.
      chatId: activeId,
      messages,
      status: effectiveStatus === 'idle' ? 'ready' : effectiveStatus,
      error: flueAgent.error,
      historyReady: flueAgent.historyReady,
      // `send({ message, images })` — `message` is a plain string; `images` is
      // flue's optional `AgentPromptImage[]` (`{ type:'image', data, mimeType }`).
      send: ({ message = '', images }: { message?: string; images?: any[] } = {}) =>
        flueAgent.sendMessage(message, images?.length ? { images } : undefined),
      // Cancel the in-flight turn. `useFlueAgent` surfaces no stop, but the
      // conversation client does: `abort()` POSTs `<mount>/:id/abort`, which the
      // flue worker threads as an AbortSignal through the running turn (and its
      // in-flight tool calls) and settles the submission to `aborted`. It is the
      // SAME client the hook observes, so there is no id to keep in sync any
      // more. Swallow errors — the SSE observation settles the turn regardless.
      // This is also the ONLY recovery path when a turn orphans (DO evicted /
      // hung tool mid-turn): without it `status` stays "streaming" forever, the
      // composer stays disabled, and the chat is unrecoverably stuck on
      // "Thinking…". Mirrors the web adapter (src/components/AgentProvider.jsx).
      // Note the scope: abort cancels this conversation's in-flight AND queued
      // work, not one submission.
      stop: () => {
        client.abort().catch(() => {});
      },
    }),
    [flueAgent, messages, effectiveStatus, activeId, client],
  );

  // Keep the chat list titled + floated from the live transcript (flue owns the
  // transcript, so this replaces eve's onFinish snapshot persistence).
  useEffect(() => {
    const title = deriveTitle(flueAgent.messages);
    if (title) conv.noteActivity(activeId, title);
  }, [flueAgent.messages, activeId, conv]);

  // Mirror the transcript locally so the next cold start can draw this chat on
  // the first frame instead of flashing the empty state while flue re-streams
  // durable history (see transcript-cache.ts). Gated on `historyReady`: before
  // it, `messages` is the empty pre-history state (or a resync's partial), and
  // caching that would clobber a perfectly good cover with nothing.
  useEffect(() => {
    if (!flueAgent.historyReady) return;
    saveTranscript(activeId, flueAgent.messages);
  }, [flueAgent.historyReady, flueAgent.messages, activeId]);

  // Publish before paint so switching chats never flashes stale content.
  useLayoutEffect(() => {
    publish(agent);
  }, [agent, publish]);

  return null;
}

export function AgentProvider({ children }: { children: ReactNode }) {
  const conv = useConversationManager();

  // The runner publishes STRAIGHT into the store — never into this component's
  // state. Holding it here re-rendered the whole tab tree on every streamed
  // batch; see the note above `useAgentBus`. Stable identity, so the runner's
  // publish effect doesn't re-fire.
  const publish = useCallback((next: any) => useAgentBus.setState({ agent: next }), []);

  // Per-project chat scoping (restore the last chat on project switch) is handled
  // inside the conversation manager — see `useConversationManager`.

  // Remount the runner (fresh flue AgentSession → fresh SSE observe) to recover a
  // dead/zombied agent stream — see the resilience block above AgentSessionRunner.
  // Rate-limited: a stream that keeps dying (a real auth expiry) stops remounting
  // after RESYNC_MAX in the window, so its error card stays put instead of looping.
  const [resyncNonce, setResyncNonce] = useState(0);
  const resyncTimesRef = useRef<number[]>([]);
  const requestResync = useCallback(() => {
    const now = Date.now();
    const recent = resyncTimesRef.current.filter((t) => now - t < RESYNC_WINDOW_MS);
    if (recent.length >= RESYNC_MAX) {
      resyncTimesRef.current = recent;
      return;
    }
    recent.push(now);
    resyncTimesRef.current = recent;
    setResyncNonce((n) => n + 1);
  }, []);

  // Conversations reach outside this subtree the same way (the chat modal is a
  // root route). Before paint, so the modal's first frame reads what the tabs do.
  useLayoutEffect(() => {
    useAgentBus.setState({ conv });
  }, [conv]);

  // The ONE thing this component still re-renders for. `children` mount once a
  // session has been published — a boolean, so it flips exactly once per session
  // instead of once per streamed batch.
  const ready = useAgentBus((s) => !!s.agent);

  // No FlueProvider: flue 2 clients are conversation-scoped, so the runner
  // builds its own from the active chat's URL.
  return (
    <ConversationsContext.Provider value={conv}>
      {conv.hydrated && conv.activeId ? (
        <AgentSessionRunner
          key={`${conv.activeId}:${resyncNonce}`}
          activeId={conv.activeId}
          projectId={conv.pid ?? null}
          conv={conv}
          publish={publish}
          requestResync={requestResync}
        />
      ) : null}
      {ready ? children : null}
    </ConversationsContext.Provider>
  );
}

/**
 * Read the live agent session.
 *
 * **Pass a selector.** The agent object is rebuilt on every streamed batch, so
 * the unselected form re-renders its caller several times a second for the whole
 * length of a turn. Doing that from screens that only wanted "is it busy?" is
 * what saturated the JS thread and made the chat header's close button and the
 * tab-bar pill drop taps mid-turn (see the note above `useAgentBus`). Selecting
 * the field you actually read gives you a stable value, and no render:
 *
 *     const busy = useAgent(agentIsBusy);            // 2 renders per turn
 *     const messages = useAgent((a) => a.messages);  // the transcript, and only it
 *
 * The unselected form is still correct — the transcript genuinely needs the
 * whole object, and `send`/`stop` are rebuilt per batch anyway — so reach for it
 * deliberately, from a component that is already re-rendering with the stream.
 * From an event handler, prefer `getAgent()`: no subscription at all.
 */
export function useAgent<T = any>(selector: (agent: any) => T = (a) => a as T): T {
  const picked = useAgentBus((s) => (s.agent ? selector(s.agent) : (NO_SESSION as unknown as T)));
  if ((picked as unknown) === NO_SESSION) {
    throw new Error('useAgent must be used within <AgentProvider> (or after it mounts)');
  }
  return picked;
}

/**
 * The session, read IMPERATIVELY — for event handlers and callbacks, which run
 * after the fact and therefore never need to re-render to stay current. Null
 * only before the first publish.
 */
export function getAgent(): any {
  return useAgentBus.getState().agent;
}

/**
 * WHICH chat an "open the agent" action should land in, read imperatively — the
 * twin of the accessory pill's `chatId ?? conv.activeId`, for callers that run
 * after the fact and must not subscribe (the tab bar's voice capture, which
 * navigates once a transcription comes back). Null only before the first publish.
 */
export function getActiveChatId(): string | null {
  const { agent, conv } = useAgentBus.getState();
  return agent?.chatId ?? conv?.activeId ?? null;
}

export function useConversations() {
  const ctx = useContext(ConversationsContext);
  const bus = useAgentBus((s) => s.conv);
  const conv = ctx ?? bus;
  if (!conv) {
    throw new Error('useConversations must be used within <AgentProvider> (or after it mounts)');
  }
  return conv;
}

// Is the agent mid-turn (can't accept a new `send`)?
export function agentIsBusy(agent: any) {
  return agent?.status === 'submitted' || agent?.status === 'streaming';
}

// Is the active chat still a blank one? The chat landing screen asks this before
// sending its first message: a blank active chat is REUSED rather than pushed
// aside, so the per-project placeholder (`withActiveForProject` mints one for
// every project) doesn't pile up as a row of untouched "New chat" entries in
// history. Anything else and the landing screen mints a fresh chat.
//
// Untouched = the store still has the placeholder title (it's derived from the
// first user line, so any real chat has one) and no composer attachments. The
// title check is what keeps an existing chat out of the reuse path during the
// beat where flue hasn't re-streamed its durable history yet and `messages` is
// still empty.
export function useIsFreshChat(): boolean {
  const conv = useConversations();
  // Selected down to the BOOLEAN. This hook is called by the Chat tab's landing
  // screen, which stays mounted underneath the chat modal — subscribing it to the
  // whole agent re-rendered that screen, and its entire scroll view, on every
  // streamed token batch (280 renders per 30s, measured).
  return useAgent((agent) => isFresh(agent, conv));
}

function isFresh(agent: any, conv: any): boolean {
  const chat = (conv?.list as { id: string; title?: string; attachments?: unknown[] }[])?.find(
    (c) => c.id === conv.activeId,
  );
  const untouched = !chat || (chat.title === 'New chat' && !chat.attachments?.length);
  return untouched && (agent?.messages?.length ?? 0) === 0;
}

/**
 * The same reuse-or-mint decision behind a "New chat" BUTTON, and the id to open
 * as a result — reusing a blank active chat, or minting one.
 *
 * Read IMPERATIVELY from the mirror store rather than through `useIsFreshChat`,
 * because the callers are header configs (the chat modal's bar items, its history
 * sheet): a component that subscribed to the agent would re-render — and re-apply
 * its native bar button items — on every streamed token batch.
 *
 * Null only if no session has published yet, which the button's surface can't
 * normally be reached without.
 */
export function startNewChat(): string | null {
  const { agent, conv } = useAgentBus.getState();
  if (!conv) return null;
  return isFresh(agent, conv) && conv.activeId ? conv.activeId : conv.newChat();
}

// Drive the agent from anywhere in the UI and reveal the conversation so the user
// lands where the turn streams in. On the web app chat is an always-visible side
// panel, so a bare `agent.send` is enough; on mobile the conversation is its own
// screen, so every "drive the agent from a button" surface (World/Script/Render/
// Stitch/Trim/Score/Sound…) must navigate to it. This is the single mechanism for
// that — prefer it over calling `agent.send` directly from those surfaces.
//
// WHICH presentation it opens is `useOpenChat`'s call: in-stack on the Home tab,
// the chat modal from anywhere else. These buttons live on Story / Episode /
// Cuts / Assets, so in practice this is the modal — pressing Render no longer
// throws the user onto another tab to watch it stream.
//
// Returns the send promise (rejects if the agent is mid-turn; the button should
// already be disabled via `agentIsBusy`).
export function useSendToAgent() {
  const conv = useConversations();
  const openChat = useOpenChat();
  const activeId: string | null = conv.activeId;
  return useCallback(
    (message: string) => {
      // Read the session at CALL time (`getAgent`) rather than subscribing to it.
      // These buttons live on Story / Episode / Cuts / Assets — screens that have
      // no other reason to re-render while a turn streams, and used to re-render
      // on every batch just by holding this callback.
      openChat(activeId);
      return getAgent()?.send?.({ message });
    },
    [activeId, openChat],
  );
}
