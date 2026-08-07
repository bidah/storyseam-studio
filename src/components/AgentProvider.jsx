import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useFlueAgent } from "@flue/react";
import { createFlueClient } from "@flue/sdk";
import {
  activeChatId,
  chatsForProject,
  deriveTitle,
  firstUserText,
  loadStore,
  makeChat,
  mergeServerChats,
  persistStore,
  trimStore,
  withActiveForProject,
} from "@/lib/chat-store";
import { toast } from "sonner";
import { engineForChatId } from "@/lib/chatEngine";
import { generateChatTitle } from "@/lib/agentTitle";
import { dropTranscript, loadTranscript, saveTranscript } from "@/lib/transcript-cache";
import { getProjectId, onProjectChange } from "@/lib/projectFetch";
import { isLiveAction } from "@/lib/productionType";

// ---------------------------------------------------------------------------
// A single shared flue agent conversation for the whole app, backed by a
// persistent, switchable list of chats.
//
// `useFlueAgent({ name, id })` follows ONE conversation instance, so the chat
// panel and any "drive the agent from the UI" affordances (e.g. the sound-studio
// Render buttons) must read from the SAME instance. flue keys a conversation by
// its instance id, so pointing at a different chat means a different id — which
// we do by keying `AgentSessionRunner` on the active chat id.
//
// The instance id the client passes is `${projectId}~${chatId}`; the worker that
// proxies `/eve/*` prepends the authenticated `${userId}~` server-side, so the
// full durable key is `userId~projectId~chatId`. Project scope now travels in
// this id (not the old `x-project-id` header), and the transcript lives in the
// flue Durable Object — the client no longer persists events/sessions.
//
// To switch conversations WITHOUT remounting the whole app, the runner renders
// nothing: it just runs the hook and publishes an adapted agent snapshot up to
// `AgentProvider`, which hands it down through a stable `AgentContext`. Only the
// runner remounts on a chat switch; every consumer merely re-renders with the
// new conversation. `ConversationsContext` (the history manager) never remounts.
// ---------------------------------------------------------------------------

// Where the flue worker mounts the agent (flue-agent/src/app.ts). The
// shot-studio-uploads worker proxies `/eve/*` through to it and picks WHICH flue
// worker from the chat id's prefix — see src/lib/chatEngine.js.
const AGENT_MOUNT = "/eve/agents/whistlewood";

const AgentContext = createContext(null);
const ConversationsContext = createContext(null);

// Owns the persisted set of conversations and the active selection. Stable
// across the app's lifetime — mutations flow through `update`, which persists.
function useConversationManager() {
  const [store, setStore] = useState(loadStore);
  // The current project, tracked straight off the projectFetch shim (a plain
  // module value + subscription) so this manager — which sits ABOVE the
  // ProjectProvider — can still scope chats per project. Chats and history are
  // filtered to this id; the active chat is remembered per project.
  const [pid, setPid] = useState(getProjectId);
  useEffect(() => onProjectChange(setPid), []);

  // Latest store, readable synchronously from callbacks (e.g. `getInitial` at a
  // freshly-keyed runner mount, before the next render commits).
  const storeRef = useRef(store);
  storeRef.current = store;

  const update = useCallback((fn) => {
    setStore((prev) => {
      const next = fn(prev);
      if (next === prev) return prev;
      persistStore(next);
      return next;
    });
  }, []);

  // Switching to a project reopens its last-active chat, or mints a fresh one if
  // it has none yet — the core of "chat is per project".
  useEffect(() => {
    update((prev) => withActiveForProject(prev, pid));
  }, [pid, update]);

  // ---- Server sync (worker/src/routes/chats.js) ----------------------------
  // The local store is a cache; the shared registry in D1 is what makes a chat
  // started on another device (the phone, another browser) show up here.
  //
  // Pull: `refreshChats` fetches this user's chats for the current project and
  // merges them in. Runs on mount + project switch, and the history sheet calls
  // it again on open (show the cached list instantly, fold the fetch in as it
  // lands).
  //
  // Push: the effect below diffs the store against what was last pushed and
  // PUTs any chat whose title/recency changed. Blank "New chat" placeholders
  // never sync — `withActiveForProject` mints one per project, and syncing
  // those would strew empty rows across every device.
  const pushedRef = useRef(new Map()); // chat id → last-pushed signature
  const chatSig = (c) => `${c.title}|${c.titled ? 1 : 0}|${c.updatedAt}`;
  // Pushes wait for the first successful pull (which seeds the pushed map) —
  // without that gate, every page load would re-PUT the whole local history in
  // one burst against a single compare-and-swapped D1 row. Bumped per pull so
  // the push effect re-runs even when the merge changed nothing locally.
  const [syncEpoch, setSyncEpoch] = useState(0);

  const markSynced = useCallback(
    (id) =>
      update((prev) => {
        const chat = prev.chats[id];
        if (!chat || chat.synced) return prev;
        return { ...prev, chats: { ...prev.chats, [id]: { ...chat, synced: true } } };
      }),
    [update],
  );

  const refreshChats = useCallback(async () => {
    const want = getProjectId();
    if (!want) return;
    try {
      const res = await fetch("/api/chats");
      if (!res.ok) return;
      const { chats } = await res.json();
      if (getProjectId() !== want) return; // project switched mid-flight
      // Adopted-from-server values must not bounce straight back as pushes —
      // seed the pushed map with the server's signature first. A chat where the
      // LOCAL side is newer keeps a different signature, so the push effect
      // still sends it up. (The map seed must not resurrect a locally-deleted
      // chat as "pushed", so only seed ids the merge will actually keep.)
      update((prev) => {
        const next = mergeServerChats(prev, want, chats);
        for (const s of chats || []) {
          if (next.chats[s.id]) pushedRef.current.set(s.id, chatSig(next.chats[s.id]));
        }
        return next;
      });
      setSyncEpoch((e) => e + 1);
    } catch {
      /* offline — the local cache stands */
    }
  }, [update]);

  useEffect(() => {
    refreshChats();
  }, [pid, refreshChats]);

  useEffect(() => {
    if (!syncEpoch) return; // no push before the first pull has seeded the map
    for (const id of store.order) {
      const c = store.chats[id];
      // Only this project's chats: the fetch shim stamps x-project-id with the
      // CURRENT project, so pushing another project's chat would file it under
      // the wrong one. Its own turn comes when that project is active.
      if (!c || c.projectId !== pid || c.title === "New chat") continue;
      const sig = chatSig(c);
      if (pushedRef.current.get(id) === sig) continue;
      pushedRef.current.set(id, sig);
      fetch(`/api/chats/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: c.title,
          titled: !!c.titled,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        }),
      })
        .then((res) => {
          if (res.ok) markSynced(id);
          else pushedRef.current.delete(id); // retry on the next store change
        })
        .catch(() => pushedRef.current.delete(id));
    }
  }, [store, pid, syncEpoch, markSynced]);

  const newChat = useCallback(() => {
    update((prev) => {
      const c = makeChat(pid ?? null);
      return trimStore({
        activeByProject: { ...prev.activeByProject, [pid || ""]: c.id },
        order: [c.id, ...prev.order],
        chats: { ...prev.chats, [c.id]: c },
      });
    });
  }, [update, pid]);

  const switchChat = useCallback(
    (id) =>
      update((prev) => {
        const chat = prev.chats[id];
        if (!chat) return prev;
        const key = chat.projectId || "";
        if (prev.activeByProject[key] === id) return prev;
        return { ...prev, activeByProject: { ...prev.activeByProject, [key]: id } };
      }),
    [update],
  );

  const deleteChat = useCallback(
    (id) => {
      // Forget it everywhere, not just this device. Fire-and-forget: deleting
      // an id the registry never saw is a no-op on the server.
      pushedRef.current.delete(id);
      dropTranscript(id);
      fetch(`/api/chats/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
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
        // If that emptied the chat's project, hand it a fresh blank one so the
        // panel always has a live conversation to show.
        return withActiveForProject({ activeByProject, order, chats }, chat.projectId);
      });
    },
    [update],
  );

  // Note live activity in one chat: refresh its title from the first user line
  // (flue owns the transcript, so the title is all we still derive here) and
  // float it to the top of the list. A no-op once the title has settled, so the
  // runner can call it on every `messages` change without thrashing the store.
  // Once a chat has an AI-generated title (`titled`), we keep that and only
  // float the chat — the derived first-line title is just the instant fallback.
  const noteActivity = useCallback(
    (id, title) =>
      update((prev) => {
        const chat = prev.chats[id];
        if (!chat) return prev;
        const nextTitle = chat.titled ? chat.title : (title ?? chat.title);
        const alreadyTop = prev.order[0] === id;
        if (nextTitle === chat.title && alreadyTop) return prev;
        const order = alreadyTop ? prev.order : [id, ...prev.order.filter((x) => x !== id)];
        const next = { ...chat, title: nextTitle, updatedAt: Date.now() };
        return { ...prev, order, chats: { ...prev.chats, [id]: next } };
      }),
    [update],
  );

  // Set the AI-generated title on a chat and lock it in (`titled: true`), so the
  // first-line fallback in `noteActivity` no longer overrides it. Ignores an
  // empty title (the AI call is best-effort — the fallback stays).
  const setAiTitle = useCallback(
    (id, title) =>
      update((prev) => {
        const chat = prev.chats[id];
        if (!chat || !title) return prev;
        if (chat.titled && chat.title === title) return prev;
        return { ...prev, chats: { ...prev.chats, [id]: { ...chat, title, titled: true, updatedAt: Date.now() } } };
      }),
    [update],
  );

  // Has this chat already been given an AI title? Reads the ref so a runner
  // keyed on a just-created chat sees the current value synchronously.
  const isTitled = useCallback((id) => !!storeRef.current.chats[id]?.titled, []);

  // The composer's ordinal-aligned attachment record (client-only state).
  const saveAttachments = useCallback(
    (id, attachments) =>
      update((prev) => {
        const chat = prev.chats[id];
        if (!chat) return prev;
        return { ...prev, chats: { ...prev.chats, [id]: { ...chat, attachments } } };
      }),
    [update],
  );

  // The composer's client-only attachment record for a given chat. Reads the ref
  // so a runner keyed on a just-created chat still sees it.
  const getInitial = useCallback((id) => {
    const chat = storeRef.current.chats[id];
    return { attachments: chat?.attachments ?? [] };
  }, []);

  // History and active selection are scoped to the current project.
  const list = useMemo(() => chatsForProject(store, pid), [store, pid]);
  const activeId = useMemo(() => activeChatId(store, pid), [store, pid]);

  return useMemo(
    () => ({
      pid,
      activeId,
      list,
      newChat,
      switchChat,
      deleteChat,
      noteActivity,
      setAiTitle,
      isTitled,
      saveAttachments,
      getInitial,
      refreshChats,
    }),
    [pid, activeId, list, newChat, switchChat, deleteChat, noteActivity, setAiTitle, isTitled, saveAttachments, getInitial, refreshChats],
  );
}

// Is a turn observably in flight, whoever started it?
//
// flue's own `status` only reports busy for sends THIS AgentSession made
// (`activeSubmissionIds` is fed by local sends alone) or while a text/reasoning
// delta is literally mid-stream. A tab that is merely OBSERVING a running turn
// — the page reloaded mid-turn, or the turn was started from the mobile app —
// therefore reads `idle` during every tool run, and the busy-driven surfaces
// (the shimmer, the composer gate) show the agent as free while it works.
//
// The durable answer is the settlement ledger: every tracked submission gets a
// `FlueConversationSettlement` row (completed/failed/aborted) when its turn
// ends, the observation streams that ledger to every device, and canonical
// user messages carry their `submissionId`. So the turn is in flight exactly
// while the newest user message's submission is unsettled. Mirrors the mobile
// runner (mobile-app/src/lib/agent/provider.tsx), where session remounts made
// the same gap show up as a flickering "Thinking…" row.
function turnInFlight(messages, settlements) {
  // The newest user message names the current turn's submission. An optimistic
  // local echo has no submissionId yet — flue's own status covers that beat
  // (`submitted` while the send awaits admission).
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    if (typeof m.submissionId !== "string") return false;
    return !settlements.some((s) => s?.submissionId === m.submissionId);
  }
  return false;
}

// flue appends framework-authored "signal" records to the transcript: skill /
// instruction delta narration after a deploy ("System instructions updated.",
// "The skill "radio" was updated: …"), abort and interruption advisories. They
// project as role:"system" with display:"diagnostic" or "hidden" — model-facing
// bookkeeping the SDK contract says to keep out of the primary transcript
// (only display:"visible" is chat). Without this filter, any `flue:deploy`
// that touches a skill description dumps the whole new description into every
// open chat as assistant-looking prose.
function isChatMessage(m) {
  if (m.role === "system") return false;
  return m.display == null || m.display === "visible";
}

// Follows the flue conversation for the active chat and publishes an adapted
// snapshot upward. Rendered with `key={activeId}` so a chat switch remounts it
// (pointing `useFlueAgent` at the new instance id, whose durable history flue
// reloads on its own); renders nothing so no consumer remounts.
function AgentSessionRunner({ activeId, projectId, conv, publish }) {
  // flue's durable key. The worker prepends `${userId}~`; we own the rest.
  const id = `${projectId ?? ""}~${activeId}`;
  // A flue 2 client addresses exactly ONE conversation — there is no
  // deployment-wide client and no agent-name addressing left, just this URL.
  // Memoized on the URL because a new client instance replaces the session.
  const client = useMemo(
    () => createFlueClient({ url: `${AGENT_MOUNT}/${id}` }),
    [id],
  );
  const flueAgent = useFlueAgent({ client });

  // `useFlueAgent()` returns a FRESH wrapper object every render — it spreads the
  // useSyncExternalStore snapshot and rebinds `sendMessage` (`.bind()`) each time.
  // The snapshot FIELDS (messages/status/error/historyReady) are referentially
  // stable (getSnapshot caches), but the wrapper and `sendMessage` are not. So
  // memoizing `agent` on the whole `flueAgent` object recomputes every render,
  // which re-fires the publish() layout effect below → setState → re-render →
  // infinite loop ("Maximum update depth exceeded"). Depend on the stable fields
  // only, and reach `sendMessage` through a ref so `send` need not be a dep.
  const sendRef = useRef(flueAgent.sendMessage);
  sendRef.current = flueAgent.sendMessage;

  // Instant paint on chat switch: flue reloads durable history in one
  // unpaginated fetch, which on a long transcript is seconds of spinner. Until
  // it settles, publish this chat's cached last-rendered transcript (plus any
  // optimistic sends flue already holds — those are new, so no overlap) and let
  // the durable snapshot replace it wholesale when it lands. The runner is
  // keyed on the chat id, so the cache read happens once per mount.
  const [cachedMessages] = useState(() => loadTranscript(activeId));
  // Memoized so the merged array is referentially stable across renders — a
  // fresh array each render would re-fire the publish effect below and loop
  // (see the `agent` memo's stability note).
  // Filtered through `isChatMessage` AFTER the merge, so system advisories are
  // dropped from the live transcript and from cached copies written before the
  // filter existed alike.
  const messages = useMemo(
    () =>
      (flueAgent.historyReady || cachedMessages.length === 0
        ? flueAgent.messages
        : [...cachedMessages, ...flueAgent.messages]
      ).filter(isChatMessage),
    [flueAgent.historyReady, flueAgent.messages, cachedMessages],
  );

  // Keep the cache fresh from the SETTLED transcript only — while history is
  // still loading, `messages` includes the cached copy itself, and writing that
  // back would loop stale data. Debounced past flue's ~1s streaming batches;
  // the trailing write flushes on unmount so a quick switch-away still caches
  // the newest turn.
  const saveTimerRef = useRef(null);
  useEffect(() => {
    if (!flueAgent.historyReady || flueAgent.messages.length === 0) return;
    const msgs = flueAgent.messages;
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      saveTranscript(activeId, msgs);
    }, 1500);
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        saveTranscript(activeId, msgs);
      }
    };
  }, [flueAgent.historyReady, flueAgent.messages, activeId]);

  // The status the app actually consumes: flue's, lifted to `streaming` while
  // the durable transcript shows a turn still running that this session has no
  // local record of (see `turnInFlight`). Read off the canonical messages, not
  // the cache-merged `messages` — a cached user message with no settlement
  // loaded yet must not report busy (moot in practice: status is `connecting`,
  // not `idle`, until history lands).
  const effectiveStatus =
    flueAgent.status === "idle" &&
    turnInFlight(flueAgent.messages, flueAgent.settlements ?? [])
      ? "streaming"
      : flueAgent.status;

  // Adapt flue's surface (`messages`, `status`, `sendMessage`) to the shape the
  // rest of the app consumes (`messages`, `status`, `send`, `stop`, `error`).
  // flue's resting status is "idle"; the app treats "ready" as idle (e.g.
  // `useRevalidateOnAgentIdle` edge-triggers on it), so map idle → "ready".
  const agent = useMemo(
    () => ({
      messages,
      status: effectiveStatus === "idle" ? "ready" : effectiveStatus,
      error: flueAgent.error,
      historyReady: flueAgent.historyReady,
      // `send({ message, images })` — `message` is a plain string; `images` is
      // flue's optional `AgentPromptImage[]` (`{ data: base64, mimeType }`).
      // A pre-migration (unprefixed) chat lives on flue 1, which this client
      // cannot speak to — the old worker answers with 400 "Request is
      // malformed". Block the send here, the one choke point every path
      // (composer, quick suggestions, card responses, voice) goes through.
      send: ({ message = "", images } = {}) => {
        if (engineForChatId(activeId) === "flue1") {
          toast.error("This chat runs on the previous agent engine", {
            description:
              "It's read-only now — start a new chat to keep working with the agent.",
          });
          return Promise.resolve();
        }
        return sendRef.current(message, images?.length ? { images } : undefined);
      },
      // Cancel the in-flight turn. `useFlueAgent` doesn't surface a stop, but the
      // conversation client does: `abort()` POSTs `<mount>/:id/abort`, which the
      // flue worker threads as an AbortSignal through the running turn (and its
      // in-flight tool calls). It is the SAME client the hook observes, so there
      // is no id to keep in sync any more. Swallow errors — the SSE observation
      // will settle the turn regardless. Note the scope: abort cancels this
      // conversation's in-flight AND queued work, not one submission.
      stop: () => {
        client.abort().catch(() => {});
      },
    }),
    [client, messages, effectiveStatus, flueAgent.error, flueAgent.historyReady],
  );

  // Keep the chat list titled + floated from the live transcript (flue owns the
  // transcript, so this replaces eve's onFinish snapshot persistence). This sets
  // the INSTANT fallback title (raw first line); the AI titling below upgrades
  // it and, once `titled`, `noteActivity` stops overriding it.
  useEffect(() => {
    const title = deriveTitle(flueAgent.messages);
    if (title) conv.noteActivity(activeId, title);
  }, [flueAgent.messages, activeId, conv]);

  // On the FIRST message of a brand-new chat, ask the Worker (Cloudflare Workers
  // AI) for a rounded, descriptive title and lock it in — a better history label
  // than the raw first line. Fire exactly once per chat, only on the 0→1
  // user-message transition, so reopening an old chat (whose history loads with
  // messages already present) never re-titles it. Best-effort: on any failure
  // the fallback title just stays.
  const titledFiredRef = useRef(false);
  const prevUserCountRef = useRef(null);
  useEffect(() => {
    // Wait until durable history has settled so a reopened chat establishes its
    // baseline count (many messages) rather than looking like a 0→N jump.
    if (!flueAgent.historyReady) return;
    const msgs = flueAgent.messages || [];
    const userCount = msgs.reduce((n, m) => (m.role === "user" ? n + 1 : n), 0);
    const prev = prevUserCountRef.current;
    prevUserCountRef.current = userCount;
    if (prev === null) return; // first post-historyReady observation: baseline only
    if (prev !== 0 || userCount < 1) return; // only the very first message
    if (titledFiredRef.current || conv.isTitled(activeId)) return;
    titledFiredRef.current = true;
    const text = firstUserText(msgs);
    if (!text) return;
    generateChatTitle(text)
      .then((title) => {
        if (title) conv.setAiTitle(activeId, title);
      })
      .catch(() => {});
  }, [flueAgent.historyReady, flueAgent.messages, activeId, conv]);

  // Publish before paint so switching chats never flashes stale content.
  useLayoutEffect(() => {
    publish(agent);
  }, [agent, publish]);

  return null;
}

export function AgentProvider({ children }) {
  const conv = useConversationManager();
  const [agent, setAgent] = useState(null);

  return (
    <ConversationsContext.Provider value={conv}>
      {/* activeId is briefly null right after switching to a project with no
          chats yet — the manager's effect mints one on the next tick. Skip the
          runner until then; `agent` keeps its previous value so children stay
          mounted (and the ProjectProvider below keeps driving the switch). */}
      {conv.activeId ? (
        <AgentSessionRunner
          key={conv.activeId}
          activeId={conv.activeId}
          projectId={conv.pid}
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
  if (!ctx) throw new Error("useAgent must be used within <AgentProvider>");
  return ctx;
}

export function useConversations() {
  const ctx = useContext(ConversationsContext);
  if (!ctx) throw new Error("useConversations must be used within <AgentProvider>");
  return ctx;
}

// Is the agent mid-turn (can't accept a new `send`)?
export function agentIsBusy(agent) {
  return agent.status === "submitted" || agent.status === "streaming";
}

// Build the chat turn that drives the render → attach loop for one pending
// sound version. Mirrors the agent's own instructions (load seed-audio →
// generate via Higgsfield → attach_sound), and hands it the prompt/params so it
// doesn't have to guess.
export function renderSoundMessage(track, ver) {
  const label = `${track.id} v${ver.v}${ver.name ? ` (${ver.name})` : ""}`;
  return [
    `Render the pending sound version ${label} now.`,
    `Load the seed-audio skill, generate the audio from this version's exact prompt` +
      ` and params, then call attach_sound for ${track.id} v${ver.v} so it flips to` +
      ` "ready" and plays in the UI. Confirm the Higgsfield submit with me first, as usual.`,
    "",
    `Track: ${track.name || track.id}`,
    ver.duration ? `Target duration: ~${ver.duration}s` : null,
    "",
    "Prompt:",
    ver.prompt,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

// Build the chat turn that asks the agent to AUTHOR the shot bible on the
// Musical tab: for each already-cut segment, write the exact sung lyric and a
// Seedance/Kling director prompt (lip-sync to Audio 1, one global continuity
// lock across all shots), then save them with save_musical_segments. The song
// is already split into segments server-side; this is the creative pass. The
// agent reads the segments and any pasted lyrics off get_musical / view_screen.
export function renderMusicalMessage(song) {
  return [
    "Author the shot bible on the Musical tab now.",
    "Load the musical skill. The song is already split into audio segments" +
      " (each shot's vocal-only + full-mix cut). For EACH segment: write the exact" +
      " sung lyric for that shot and a Seedance/Kling director prompt whose mouth" +
      " movements match those words in Audio 1, plus one global continuity lock" +
      " pasted across every shot. Call get_musical to read the segments and the" +
      " pasted lyrics, then save_musical_segments (matched by label) with the lyric" +
      " + prompt for each, and the continuity lock.",
    "",
    song?.title ? `Song: ${song.title}` : null,
    song?.lyrics ? `\nLyrics the author pasted:\n${song.lyrics}` : "\n(No lyrics pasted — ask the author for them, or transcribe from the audio.)",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

// Build the chat turn that drives the render → attach loop for one episode
// bundle, once its revision has been fully signed off. Mirrors the agent's own
// instructions (load generate-multishot → render via Higgsfield → attach_episode_video)
// and hands it the fully-composed prompt (refs + audio refs + body) so it doesn't
// have to reassemble it.
// `firstFrameUrl` (optional) is a storyboard still's ungated refUrl to open the
// clip on — the agent passes it to Seedance as `start_image` (the generate-multishot
// skill's optional first-frame path), on TOP of the semantic image_references.
// `refVideoUrl` (optional) is a previously-rendered generation's ungated refUrl —
// the agent passes it to Seedance as `video_references` (the skill's optional
// style-continuity path) so the new clip continues its style/colors/feeling.
export function renderEpisodeMessage(bundle, prompt, firstFrameUrl, refVideoUrl) {
  const label = `${bundle.id}${bundle.beatTitle ? ` — ${bundle.beatTitle}` : ""}`;
  return [
    `Render episode bundle ${label} now — its revision is signed off.`,
    `Load the generate-multishot skill, render this bundle's multi-shot Seedance` +
      ` video from the exact prompt below (image + audio references included), then` +
      ` call attach_episode_video for ${bundle.id} with the resulting mp4 URL so the` +
      ` take shows up in the UI. Confirm the Higgsfield submit with me first, as usual.`,
    firstFrameUrl
      ? `FIRST FRAME: open the clip on this exact image — pass it to Seedance as` +
        ` start_image (per the skill's optional first-frame path), in ADDITION to the` +
        ` image_references in the prompt: ${firstFrameUrl}`
      : null,
    refVideoUrl
      ? `VIDEO STYLE CONTINUITY: pass this previously-rendered clip to Seedance as a` +
        ` video_references entry (per the skill's optional style-continuity path), in` +
        ` ADDITION to the image_references, and keep the continuity sentence from the` +
        ` prompt below — it tells the model to continue this clip's style, colors, and` +
        ` feeling: ${refVideoUrl}`
      : null,
    "",
    bundle.duration ? `Target duration: ~${bundle.duration}s` : null,
    "",
    "Prompt:",
    prompt,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

// Build the chat turn that drives the render → attach loop for ONE storyboard
// still: a single Nano Banana Pro image for one shot of a bundle. Mirrors the
// agent's own instructions (load generate-storyboard → generate_image via the
// Higgsfield MCP → attach_still) and hands it the shot details + the composed
// image-reference block so it doesn't have to reassemble them. `angle` is an
// optional camera-angle/variation note for this take (for "New angle" re-rolls).
export function renderStoryboardMessage(bundle, shot, refBlock, angle) {
  const label = `${bundle.id} / ${shot.id}`;
  const dlg = shot.dialogue && !/\(no dialogue\)/i.test(shot.dialogue) ? shot.dialogue : null;
  return [
    `Render a storyboard still for shot ${label}${angle ? ` — angle: ${angle}` : ""} now.`,
    `Load the generate-storyboard skill and generate ONE still image with Nano Banana` +
      ` Pro (the Higgsfield MCP generate_image tool) for this shot, using the character` +
      ` and location reference images below to lock identity and setting. Then call` +
      ` attach_still for bundle="${bundle.id}", shot="${shot.id}"${angle ? `, angle="${angle}"` : ""}` +
      ` with the resulting image URL so the still shows up in the Episode tab's Images` +
      ` mode. Confirm the Higgsfield submit with me first, as usual.`,
    "",
    `Shot ${shot.id} — ${shot.location || ""}${shot.camera ? ` · ${shot.camera}` : ""}${shot.dur ? ` (${shot.dur}s)` : ""}`,
    shot.summary ? `Action: ${shot.summary}` : null,
    dlg ? `Dialogue (for expression/pose only — it's a still): ${dlg}` : null,
    angle ? `Camera angle / variation for this take: ${angle}` : null,
    "",
    refBlock,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

// Build the chat turn for generating a still FROM THE EDITOR, into a picture slot
// that already exists on the timeline (a slate the user just created, or a still
// being re-rolled). Same generate → attach_still loop as renderStoryboardMessage,
// plus a closing `edit_timeline` replace so the image lands in THAT item —
// keeping the position and duration the user set. The agent's write carries no
// clientId, so the open Editor live-reloads and the still simply appears.
//
// `prompt` is the user's (possibly edited) prompt from the modal. `reuse` is a
// take whose image should be passed as an extra reference — the "reuse this
// image, give me a variation" path.
//
// Unlike renderStoryboardMessage (called from the Episode tab, which HAS the
// bundle's picked references in hand), the Editor doesn't know them — so the
// agent is told to look them up with get_episode rather than being handed a
// reference block that would be a guess.
export function renderAnimaticStillMessage({ bundle, shot, itemId, prompt, angle, reuse }) {
  const label = `${bundle} / ${shot.id}`;
  const dlg = shot.dialogue && !/\(no dialogue\)/i.test(shot.dialogue) ? shot.dialogue : null;
  // A reused take must be handed over as its `refUrl` — the absolute /files/ URL
  // that encodes the project in the R2 key. Its `url` is the project-scoped
  // /storyboard-media/ path, which needs a header the image model doesn't send,
  // so it would resolve against p_default and 404 for every other project (and
  // the model would then quietly generate WITHOUT the reference).
  const reuseUrl = reuse?.refUrl || null;
  return [
    `Generate a storyboard still for shot ${label} and put it on the animatic's timeline${angle ? ` — angle: ${angle}` : ""}.`,
    `Load the generate-storyboard skill and generate ONE still image with Nano Banana` +
      ` Pro (the Higgsfield MCP generate_image tool) for this shot. Call get_episode first` +
      ` and pass bundle ${bundle}'s chosen character/location reference images as` +
      ` image_references, so identity and setting stay locked to the rest of the episode.`,
    reuseUrl
      ? `ALSO pass this existing take as an image reference and keep its framing — the user wants a VARIATION of it, not a new composition: ${reuseUrl}`
      : reuse
        ? `The user asked for a variation of an existing take, but its reference URL isn't available — say so and ask before generating something unrelated.`
        : null,
    "",
    `Then, in this order:`,
    `1. attach_still with bundle="${bundle}", shot="${shot.id}"${angle ? `, angle="${angle}"` : ""}, and pass` +
      ` the prompt you used, the model id you resolved, and the refs you passed — so this take can be re-rolled later.`,
    `2. edit_timeline with [{ op: "replace", id: "${itemId}", src: "<the attach_still url>", stillFile: "<the attach_still file>", name: "${shot.id} · <take name>" }]` +
      ` — this drops the image into the picture slot already waiting for it on the timeline. Do NOT move or resize it; the user set that timing.`,
    `Confirm the Higgsfield submit with me first, as usual.`,
    "",
    `Shot ${shot.id} — ${shot.location || ""}${shot.camera ? ` · ${shot.camera}` : ""}${shot.dur ? ` (${shot.dur}s)` : ""}`,
    shot.action || shot.summary ? `Action: ${shot.action || shot.summary}` : null,
    dlg ? `Dialogue (for expression/pose only — it's a still): ${dlg}` : null,
    "",
    `Prompt to use (the user may have edited this — use it as written):`,
    prompt,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

// Combined turn: render a still for EVERY shot in one bundle, one at a time.
export function renderStoryboardAllMessage(bundle, refBlock) {
  const shots = bundle.shots
    .map(
      (s) =>
        `- ${s.id}${s.dur ? ` (${s.dur}s)` : ""}${s.location ? `, ${s.location}` : ""}` +
        `${s.camera ? `, ${s.camera}` : ""}: ${s.summary || ""}`,
    )
    .join("\n");
  return [
    `Render a storyboard still for EVERY shot in bundle ${bundle.id}${bundle.beatTitle ? ` — ${bundle.beatTitle}` : ""} now, one at a time.`,
    `Load the generate-storyboard skill. For each shot below, generate ONE still with` +
      ` Nano Banana Pro (Higgsfield MCP generate_image), using the reference images to` +
      ` lock the characters and location, then call attach_still for that bundle + shot` +
      ` with the resulting image URL. Confirm the first Higgsfield submit with me, then` +
      ` proceed through the rest.`,
    "",
    "Shots:",
    shots,
    "",
    refBlock,
  ].join("\n");
}

// Render a still for every renderable shot in ONE animatic scene (a beat), one at
// a time. Unlike renderStoryboardAllMessage (bundle-scoped, one shared reference
// block), each shot here carries its OWN references — auto-resolved from the World
// roster (each on-screen character's sheet + the location's sheet) — so identity
// and setting stay locked without the user hand-picking per bundle. `shots` come
// from GET /api/animatic/view (each with bundle, id, refs.characters[], refs.location).
export function renderAnimaticSceneMessage(scene, shots) {
  const lines = shots.map((s) => {
    const refs = [];
    for (const ch of s.refs?.characters || []) if (ch.refUrl) refs.push(`${ch.name}: ${ch.refUrl}`);
    if (s.refs?.location?.refUrl) refs.push(`${s.refs.location.name || s.location} (location): ${s.refs.location.refUrl}`);
    const refStr = refs.length ? refs.join("; ") : "(no roster references linked — generate from the description alone)";
    const dlg = s.dialogue && !/\(no dialogue\)/i.test(s.dialogue) ? s.dialogue : null;
    return [
      `- bundle="${s.bundle}", shot="${s.id}"${s.location ? `, ${s.location}` : ""}${s.camera ? `, ${s.camera}` : ""}: ${s.action || ""}`,
      dlg ? `    (dialogue, for expression/pose only — it's a still: ${dlg})` : null,
      `    image_references: ${refStr}`,
    ].filter(Boolean).join("\n");
  }).join("\n");
  return [
    `Render a storyboard still for EVERY shot in the "${scene.beatTitle || scene.beat}" scene now, one at a time.`,
    `Load the generate-storyboard skill. For each shot below, generate ONE still with` +
      ` Nano Banana Pro (the Higgsfield MCP generate_image tool), passing THAT shot's listed` +
      ` image_references to lock the characters and location, then call attach_still for that` +
      ` bundle + shot with the resulting image URL. Confirm the first Higgsfield submit with` +
      ` me, then proceed through the rest.`,
    "",
    "Shots:",
    lines,
  ].join("\n");
}

// The Animatic's "locations pass": have the agent produce a reference sheet for
// every listed place and link each onto the World roster. Follows the
// sheet-generation skill's contract — the USER picks each reference image via
// ask_question (never auto-picked), and the finish path is
// attach_visual_generation → save_generation_to_library → attach_location_sheet,
// so the art lands on the roster and unblocks every scene filmed there.
// `locations` come from GET /api/animatic/view (each with slug, name, shots).
export function renderLocationSheetsMessage(locations, sceneTitle) {
  const lines = locations.map((l) => {
    const label = l.name && l.name !== l.slug ? `${l.slug} (${l.name})` : l.slug;
    return `- ${label}${l.shots ? ` — used by ${l.shots} shot${l.shots > 1 ? "s" : ""}` : ""}`;
  });
  return [
    sceneTitle
      ? `Generate the location sheet${locations.length > 1 ? "s" : ""} the "${sceneTitle}" scene still needs, and link ${locations.length > 1 ? "each one" : "it"} on the World roster:`
      : `Generate a location sheet for ${locations.length > 1 ? "each of these places" : "this place"} and link ${locations.length > 1 ? "each one" : "it"} on the World roster:`,
    ...lines,
    "",
    `Load the sheet-generation skill and follow it, ONE location at a time. Build each`,
    `subject from the roster entry (get_world) plus what the shots filmed there need`,
    `(get_shotlist), and ask me to pick the reference image with ask_question before`,
    `generating — never auto-pick.`,
    `Finish each location with attach_visual_generation, then save_generation_to_library,`,
    `then attach_location_sheet (location id from get_world) so the sheet shows on the`,
    `World roster and the Animatic auto-feeds it to every shot at that place.`,
  ].join("\n");
}

// Build the chat turn that kicks off world-building — the "Let's create the
// world" button on the World tab. Routed through the agent (the world-creation
// skill) so it interviews the user across the story map, story depth, and
// character roster, then writes the result back with save_world.
export function createWorldMessage() {
  return [
    `Let's build the world for this series. Load the world-creation skill and follow it.`,
    ``,
    `Interview me with ask_question (a few focused questions at a time, building on my`,
    `answers) across all of it: the world / where it takes place, the protagonist and`,
    `their main goal, the antagonist, the stakes if they fail, and the theme; then the`,
    `deeper story — the premise (what it's really about beneath the plot), each main`,
    `character's want vs. need, the central conflict and why the audience should care,`,
    `the obstacles the protagonist faces and the consequences of failure, and the story`,
    `structure. Also build the character roster with type breakdowns.`,
    ``,
    `When you have enough, call save_world to write it into the World tab (call get_world`,
    `first if a world already exists so you don't clobber it). Then tell me to review it`,
    `on the World tab and that I can edit any field directly.`,
  ].join("\n");
}

// Build the chat turn that kicks off the VISUAL world exploration — the "Let the
// agent explore the look" button on the World › Visual sub-tab. Routed through the
// agent (the visual-world skill) so it generates character/place concept images
// with Nano Banana Pro and attaches each one so it lands live on the Visual tab.
export function createVisualWorldMessage(hint) {
  return [
    `Let's explore the VISUAL world for this series — how the characters and places`,
    `actually look. Load the visual-world skill and follow it.`,
    ``,
    hint ? `Focus: ${hint}` : `Start from the written world (get_world) and the visual world so far` +
      ` (get_visual_world). Propose a few characters/places to visualize, then generate`,
    `concept images with Nano Banana Pro (Higgsfield MCP generate_image), using the 2D`,
    `prompt preset for the house style. Generate a small batch, and when the user likes a`,
    `direction, iterate by passing a chosen image back as an image reference.`,
    ``,
    `Attach every result with attach_visual_generation so it appears on the World › Visual`,
    `tab immediately. Keep the chat concise; the images do the talking.`,
  ].join("\n");
}

// Build the chat turn that generates the granular shot list from the signed
// script. Routed through the agent like the Render buttons — but through WHICH
// skill depends on the project's production type, so the button names it
// explicitly rather than leaving the model to infer it. A live-action shot list
// is a different run producing a different prompt document, and the two skills'
// trigger phrases overlap almost completely ("generate the shot list"), so
// relying on description-matching alone would route by coin flip.
export function generateShotListMessage(productionType) {
  const tail =
    ` Do NOT render any video and do NOT pack the bundles yourself —` +
    ` the app auto-packs into <=15s multishots. When done, tell me how many shots you wrote` +
    ` and how many <=15s multishots they pack into. Then reconcile speakers with the World` +
    ` roster per the skill: if save_shotlist reports newSpeakers, surface them and offer to` +
    ` promote the recurring ones into the World with add_world_character.`;
  if (isLiveAction(productionType)) {
    return [
      `Generate the shot list from the script now — the pinned draft is signed.`,
      `This is a LIVE-ACTION production. Load the shot-list-live-action skill (NOT the` +
        ` shot-list skill) and follow it: call get_script, break the screenplay into an` +
        ` ordered list of short (~2-4s) shots, each with beat/location, camera, action,` +
        ` dialogue and an audio-sync note, and write every shot's Seedance prompt as` +
        ` promptBlocks — the block document the skill specifies, not one paragraph —` +
        ` then call save_shotlist.` + tail,
    ].join("\n");
  }
  return [
    `Generate the shot list from the script now — the pinned draft is signed.`,
    `Load the shot-list skill and follow it: call get_script, break the screenplay into an` +
      ` ordered list of short (~2-4s) shots, each with beat/location, camera, action,` +
      ` dialogue, an audio-sync note, and a Seedance prompt, then` +
      ` call save_shotlist.` + tail,
  ].join("\n");
}

// Build the chat turn behind the "+" insert node between two shot cards on the
// Shot list tab: the author wants a NEW shot slotted in, and typed what the scene
// should be. Routed through the agent (the create-new-shots-for-shotlist skill) so
// it authors the shot to the same standard as the shot-list build, shows it as a
// render_ui approve/reject card, and only writes it (save_shotlist mode:"insert")
// once approved. `prev`/`next` are the shots ABOVE and BELOW the node (either may
// be null at the ends of the list); `description` is the author's free text.
function shotBrief(s) {
  const dlg = s.dialogue && !/\(no dialogue\)/i.test(s.dialogue) ? ` — dialogue: "${s.dialogue}"` : "";
  return `shot ${s.id} — ${s.beatTitle || s.beat || "?"}${s.location ? ` · ${s.location}` : ""}${s.camera ? ` · ${s.camera}` : ""}: ${s.action || ""}${dlg}`;
}
export function insertShotMessage({ prev, next, description }) {
  const where = prev && next
    ? `between shot ${prev.id} and shot ${next.id}`
    : prev
      ? `after shot ${prev.id} (the end of the shot list)`
      : next
        ? `before shot ${next.id} (the very start of the shot list)`
        : `into the shot list`;
  const anchorLine = prev
    ? `Insert it AFTER shot ${prev.id} — call save_shotlist with mode:"insert" and anchorId:"${prev.id}".`
    : `Insert it at the very START of the list — call save_shotlist with mode:"insert" and NO anchorId.`;
  return [
    `I want to add a new shot ${where} on the Shot list.`,
    ``,
    `What the new scene should be: ${description}`,
    ``,
    `Load the create-new-shots-for-shotlist skill and follow it. Author ONE new shot that fits` +
      ` between these neighbours — match the surrounding beat, location and style unless my` +
      ` description says otherwise — then DRAFT it and show it to me as a render_ui confirm card` +
      ` (Approve / Reject). ${anchorLine} Only write it once I approve; if I reject, drop it.`,
    ``,
    `Neighbouring shots for context:`,
    prev ? `- Previous: ${shotBrief(prev)}` : `- (this is the START of the shot list — no shot before it)`,
    next ? `- Next: ${shotBrief(next)}` : `- (this is the END of the shot list — no shot after it)`,
  ].join("\n");
}

// Build the chat turn for an inline "change this passage" request from the Script
// tab: the user drag-selected a range of the screenplay and typed the change they
// want. Routed through the agent (the script-writing skill) so it proposes the
// edit as a diff scoped to that passage — propose → confirm → apply, like every
// other script change.
export function scriptEditRequest(selectedText, instruction) {
  return [
    `The user is on the Script tab and has selected these lines of the screenplay that need to change:`,
    ``,
    `"""`,
    selectedText,
    `"""`,
    ``,
    `The specific request is: ${instruction}`,
    ``,
    `Load the script-writing skill and follow it: call get_script to read the current pinned` +
      ` draft, locate this exact passage, and propose an edit that applies the request to just` +
      ` these lines while leaving the rest of the script untouched. Propose it as a diff` +
      ` (save_script / append_script) and confirm before applying — don't commit it until the` +
      ` user says so.`,
  ].join("\n");
}

// Build the chat turn that renders one Radio-version scene: for each dialogue
// line, voice it with Seed Audio using the character's favorited voiceRef as the
// reference clip, then link the take back to the line. Mirrors the agent's radio
// skill (create_sound → seed-audio → attach_sound → attach_radio_take).
export function renderRadioSceneMessage(scene, lines) {
  const rows = lines.map((l) => {
    const clip = l.voiceRef?.refUrl || l.voiceRef?.url;
    const voice = clip
      ? `voiced by ${l.voiceRef.name || "their voice"} (reference clip: ${clip})`
      : `NO VOICE CAST — skip or ask me to cast a voice first`;
    return `- line ${l.id} — ${l.character || "?"} ${voice}: "${l.text}"`;
  });
  return [
    `Render the radio dialogue for scene "${scene.beatTitle || scene.beat}" now.`,
    `Load the radio skill and follow it. For EACH line below, voice it with Seed Audio` +
      ` using that character's reference voice clip so the character sounds consistent,` +
      ` then attach it and call attach_radio_take with the line id so it shows up under` +
      ` the line on the Radio tab. Confirm the first Higgsfield submit with me, then` +
      ` proceed through the rest of the scene.`,
    "",
    "Lines (in order):",
    ...rows,
    "",
    `Each line's reference clip is an absolute public URL — download it directly (curl/web_fetch)` +
      ` and upload it as the Seed Audio audio_references clip (@Audio1) so the voice matches.` +
      ` Keep each take to just the spoken line, clean (no music, no SFX).`,
  ].join("\n");
}

// Build the chat turn behind a single line's "Recreate" (the kebab menu on a
// Radio line). Re-voices JUST that one line with Seed Audio and attaches the
// take — which the worker APPENDS as a new version and auto-selects, so the
// prior take stays available as an alternative. Same skill/flow as a full scene
// render, scoped to one line.
export function recreateRadioLineMessage(scene, line) {
  const clip = line.voiceRef?.refUrl || line.voiceRef?.url;
  const voice = clip
    ? `voiced by ${line.voiceRef.name || "their voice"} (reference clip: ${clip})`
    : `NO VOICE CAST — ask me to cast a voice first`;
  return [
    `Re-render ONLY this one radio line (a fresh take) — everything else stays as is.`,
    `Load the radio skill and follow it for this single line: voice it with Seed Audio` +
      ` using the character's reference voice clip so it stays consistent, attach it, and` +
      ` call attach_radio_take with the line id. The new take is added as another version` +
      ` under the line and becomes the selected one automatically.`,
    "",
    `- line ${line.id} — ${line.character || "?"} ${voice}: "${line.text}"`,
    "",
    `The reference clip is an absolute public URL — download it directly (curl/web_fetch)` +
      ` and upload it as the Seed Audio audio_references clip (@Audio1). Keep the take to just` +
      ` the spoken line, clean (no music, no SFX).`,
  ].join("\n");
}

// Build the chat turn behind "Agent pacing" on the Radio tab. The gapless
// first pass was JUST sent to the Editor (POST /api/radio/to-editor); this asks
// the agent for the editorial second pass — re-time the space between the
// takes from the Shot list so the audio-only cut plays like a story. Mirrors
// the agent's radio-pacing skill (get_timeline + get_shotlist → edit_timeline
// move ops, never resize/reorder).
export function paceRadioTimelineMessage() {
  return [
    `I just sent the radio version to the Editor — the gapless first pass, every voiced` +
      ` line back-to-back on the Dialogue track. Do the editorial pacing pass now.`,
    ``,
    `Load the radio-pacing skill and follow it: read the timeline (get_timeline) and the` +
      ` Shot list (get_shotlist), then re-time the Dialogue track with edit_timeline move` +
      ` ops. Keep every take and their order — only shape the SPACE between lines: quick` +
      ` exchanges stay tight, beat changes get a breath, and silent shots between spoken` +
      ` lines become real pauses sized from their planned durations. If two lines should` +
      ` genuinely overlap (an interruption, a reaction over a line), put the overlapping` +
      ` take on a second dialogue lane — never overlap items on one track.`,
    ``,
    `When you're done, tell me the runtime before → after and where the big pauses landed and why.`,
  ].join("\n");
}

// Build the chat turn that delegates CASTING a voice to the agent — the "Voice
// with agent" buttons on the Radio Casting rail. One or many speaker names.
// Tells the agent to design a fitting voice, render a short in-character sample
// with Seed Audio, and cast it with the RIGHT tool per name: a World-roster
// character → attach_character_voice (by id); a background/one-off speaker with
// no World record → cast_radio_voice (by name). It figures out which via
// get_world, so the same button works for either kind of casting-rail entry.
export function castVoiceMessage(characters) {
  const list = Array.isArray(characters) ? characters : [characters];
  const names = list.map((c) => `"${c}"`).join(", ");
  const many = list.length > 1;
  return [
    `Cast a voice for ${many ? "each of these Radio speakers" : "the Radio speaker"} ${names} on the Casting rail.`,
    ``,
    `First call get_world and get_radio. Then for EACH name, in order:`,
    `- If the name is on the World roster, read their voice / traits / appearance and design a voice that fits.` +
      ` Otherwise it's a background / one-off speaker with no World record — pick a voice that suits the role.`,
    `- Load the seed-audio skill and generate a SHORT, clean in-character voice sample (use one of that character's` +
      ` own dialogue lines if they have one, else a neutral line — no music, no SFX). Then create_sound(kind:"voice"),` +
      ` attach_sound so it flips to "ready", and like_sound_version so the take is castable.`,
    `- Cast it with the RIGHT tool: a World character → attach_character_voice with that character's id;` +
      ` a background speaker with no World record → cast_radio_voice by name.`,
    ``,
    `Confirm the first Higgsfield submit with me, then proceed through the rest without re-confirming.` +
      ` When done, tell me which voices are cast — they'll show on the Casting rail (and, for World characters, the World tab).`,
  ].join("\n");
}

// Build the chat turn that (re)stitches the complete cut. Routed through the
// agent — like every other mutation — so it uses the same get_cuts → stitch_cuts
// flow (which runs ffmpeg locally) and picks up whatever takes are currently
// selected. `count` and `range` are just context for the agent's summary.
export function stitchCutMessage(range, count) {
  const span = range?.from ? ` (${range.from} → ${range.to})` : "";
  return [
    `Re-stitch the complete cut${span} now.`,
    `Load the complete-cut skill, call get_cuts to confirm the current stitch plan,` +
      ` then stitch_cuts to concatenate the selected take of every bundle (in order).` +
      ` Pick up whatever takes are selected right now — I just changed a selection on` +
      ` the Episodes tab, so the new cut must reflect it. This mints a NEW version` +
      ` (the previous ones are kept in history) and, if background music was already` +
      ` added, the fresh cut is automatically re-scored so the newest version keeps` +
      ` the music. Tell me the new version number when it's done.`,
    count ? `\nExpecting ~${count} scenes in the cut.` : null,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

// Build the chat turn that scores the stitched cut (background music under the
// dialogue/SFX). Routed through the agent so it uses score_cut.
export function scoreCutMessage(range) {
  const span = range?.from ? ` (${range.from} → ${range.to})` : "";
  return [
    `Add the background music to the complete cut${span} now — mint a new scored version.`,
    `Load the complete-cut skill and call score_cut to overlay the Sound Studio` +
      ` background-music cues UNDER the stitched cut at a low bed level so the baked-in` +
      ` dialogue and SFX stay dominant. Keep the previous versions for A/B.`,
  ].join("\n");
}

// Build the chat turn that trims a single take to an in/out range. Routed through
// the agent (trim-video skill → trim_video → ffmpeg on the server) so the trim is
// saved as a NEW version alongside the original and shows up as an extra card in
// the bundle's carousel. `sourceName` is only for a human-readable summary.
export function trimMessage(bundleId, sourceFile, from, to, sourceName) {
  const s = (n) => Number(n).toFixed(2);
  const label = sourceName ? `${sourceName} (${sourceFile})` : sourceFile;
  return [
    `Trim the ${label} take of bundle ${bundleId} to ${s(from)}s → ${s(to)}s now.`,
    `Load the trim-video skill and call trim_video with bundle="${bundleId}",` +
      ` sourceFile="${sourceFile}", from=${s(from)}, to=${s(to)}. This runs ffmpeg` +
      ` to cut that sub-range and saves it as a NEW "trim" version next to the` +
      ` original (the original stays in history). It appears as an extra selectable` +
      ` card in this bundle's carousel with a TRIM VERSION badge. It's a local cut,` +
      ` not a Higgsfield render, so no confirmation is needed — just do it and tell` +
      ` me when the trim is ready.`,
  ].join("\n");
}

// Combined turn for "render every pending version in the studio".
export function renderAllPendingMessage(tracks) {
  const pending = [];
  for (const t of tracks) {
    for (const v of t.versions) {
      if (v.status !== "ready") {
        pending.push(`- ${t.id} v${v.v}${v.name ? ` (${v.name})` : ""} — ${t.name || t.id}`);
      }
    }
  }
  return [
    `Render all pending sound versions now, one at a time:`,
    ...pending,
    "",
    `For each: load the seed-audio skill, generate from that version's saved prompt` +
      ` and params, then attach_sound so it flips to "ready". Confirm each Higgsfield` +
      ` submit with me before generating, as usual.`,
  ].join("\n");
}
