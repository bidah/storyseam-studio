import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useEveAgent } from "eve/react";
import {
  CHATS_LIMIT,
  deriveTitle,
  loadStore,
  makeChat,
  persistStore,
} from "@/lib/chat-store";

// ---------------------------------------------------------------------------
// A single shared eve agent session for the whole app, backed by persistent,
// switchable chat history.
//
// `useEveAgent` owns one conversation per hook instance, so the chat panel and
// any "drive the agent from the UI" affordances (e.g. the sound-studio Render
// buttons) must read from the SAME instance. Its session config is read once
// when the store is created, so pointing at a different conversation means
// recreating the store — which we do by keying `AgentSessionRunner` on the
// active chat id.
//
// To switch conversations WITHOUT remounting the whole app, the runner renders
// nothing: it just runs the hook and publishes the live agent snapshot up to
// `AgentProvider`, which hands it down through a stable `AgentContext`. Only the
// runner remounts on a chat switch; every consumer merely re-renders with the
// new session. `ConversationsContext` (the history manager) never remounts.
// ---------------------------------------------------------------------------

const AgentContext = createContext(null);
const ConversationsContext = createContext(null);

// Owns the persisted set of conversations and the active selection. Stable
// across the app's lifetime — mutations flow through `update`, which persists.
function useConversationManager() {
  const [store, setStore] = useState(loadStore);
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

  const newChat = useCallback(() => {
    update((prev) => {
      const c = makeChat();
      const order = [c.id, ...prev.order].slice(0, CHATS_LIMIT);
      const chats = { [c.id]: c };
      for (const id of order) if (prev.chats[id]) chats[id] = prev.chats[id];
      return { activeId: c.id, order, chats };
    });
  }, [update]);

  const switchChat = useCallback(
    (id) => update((prev) => (prev.chats[id] && id !== prev.activeId ? { ...prev, activeId: id } : prev)),
    [update],
  );

  const deleteChat = useCallback(
    (id) =>
      update((prev) => {
        if (!prev.chats[id]) return prev;
        const order = prev.order.filter((x) => x !== id);
        const chats = { ...prev.chats };
        delete chats[id];
        if (order.length === 0) {
          const c = makeChat();
          return { activeId: c.id, order: [c.id], chats: { [c.id]: c } };
        }
        const activeId = id === prev.activeId ? order[0] : prev.activeId;
        return { activeId, order, chats };
      }),
    [update],
  );

  // Persist a completed turn's events + cursor for one chat, refreshing its
  // title from the first user line and floating it to the top of the list.
  const saveTurn = useCallback(
    (id, snapshot) =>
      update((prev) => {
        const chat = prev.chats[id];
        if (!chat) return prev;
        const next = {
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
    (id, session) =>
      update((prev) => {
        const chat = prev.chats[id];
        if (!chat) return prev;
        return { ...prev, chats: { ...prev.chats, [id]: { ...chat, session } } };
      }),
    [update],
  );

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

  // Seed values for (re)creating an eve store for a given chat. Reads the ref so
  // a runner keyed on a just-created chat still sees it.
  const getInitial = useCallback((id) => {
    const chat = storeRef.current.chats[id];
    return {
      events: chat?.events ?? [],
      session: chat?.session ?? { streamIndex: 0 },
      attachments: chat?.attachments ?? [],
    };
  }, []);

  const list = useMemo(
    () => store.order.map((id) => store.chats[id]).filter(Boolean),
    [store],
  );

  return useMemo(
    () => ({
      activeId: store.activeId,
      list,
      newChat,
      switchChat,
      deleteChat,
      saveTurn,
      saveSession,
      saveAttachments,
      getInitial,
    }),
    [store.activeId, list, newChat, switchChat, deleteChat, saveTurn, saveSession, saveAttachments, getInitial],
  );
}

// Runs the eve session for the active chat and publishes it upward. Rendered
// with `key={activeId}` so a chat switch remounts it (rebuilding the store from
// that chat's persisted events/cursor); renders nothing so no consumer remounts.
function AgentSessionRunner({ activeId, view, conv, publish }) {
  const viewRef = useRef(view);
  viewRef.current = view;

  // Read the chat's persisted seed exactly once, at mount for this key.
  const initialRef = useRef(null);
  if (initialRef.current === null) initialRef.current = conv.getInitial(activeId);

  const agent = useEveAgent({
    initialEvents: initialRef.current.events,
    initialSession: initialRef.current.session,
    // Tell the agent which screen the user is on, every turn.
    prepareSend: (input) => ({ ...input, clientContext: { screen: viewRef.current } }),
    onFinish: (snapshot) => conv.saveTurn(activeId, snapshot),
    onSessionChange: (session) => conv.saveSession(activeId, session),
  });

  // Publish before paint so switching chats never flashes stale content.
  useLayoutEffect(() => {
    publish(agent);
  }, [agent, publish]);

  return null;
}

export function AgentProvider({ view, children }) {
  const conv = useConversationManager();
  const [agent, setAgent] = useState(null);

  return (
    <ConversationsContext.Provider value={conv}>
      <AgentSessionRunner
        key={conv.activeId}
        activeId={conv.activeId}
        view={view}
        conv={conv}
        publish={setAgent}
      />
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

// Build the chat turn that drives the render → attach loop for one episode
// bundle, once its revision has been fully signed off. Mirrors the agent's own
// instructions (load generate-multishot → render via Higgsfield → attach_episode_video)
// and hands it the fully-composed prompt (refs + audio refs + body) so it doesn't
// have to reassemble it.
export function renderEpisodeMessage(bundle, prompt) {
  const label = `${bundle.id}${bundle.beatTitle ? ` — ${bundle.beatTitle}` : ""}`;
  return [
    `Render episode bundle ${label} now — its revision is signed off.`,
    `Load the generate-multishot skill, render this bundle's multi-shot Seedance` +
      ` video from the exact prompt below (image + audio references included), then` +
      ` call attach_episode_video for ${bundle.id} with the resulting mp4 URL so the` +
      ` take shows up in the UI. Confirm the Higgsfield submit with me first, as usual.`,
    "",
    bundle.duration ? `Target duration: ~${bundle.duration}s` : null,
    "",
    "Prompt:",
    prompt,
  ]
    .filter((l) => l !== null)
    .join("\n");
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
