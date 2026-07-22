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
import { useFlueAgent, useFlueClient } from "@flue/react";
import {
  activeChatId,
  chatsForProject,
  deriveTitle,
  firstUserText,
  loadStore,
  makeChat,
  persistStore,
  trimStore,
  withActiveForProject,
} from "@/lib/chat-store";
import { generateChatTitle } from "@/lib/agentTitle";
import { getProjectId, onProjectChange } from "@/lib/projectFetch";

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

// The flue agent registered in flue-agent/src/agents/whistlewood.ts.
const AGENT_NAME = "whistlewood";

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
    (id) =>
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
      }),
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
    }),
    [pid, activeId, list, newChat, switchChat, deleteChat, noteActivity, setAiTitle, isTitled, saveAttachments, getInitial],
  );
}

// Follows the flue conversation for the active chat and publishes an adapted
// snapshot upward. Rendered with `key={activeId}` so a chat switch remounts it
// (pointing `useFlueAgent` at the new instance id, whose durable history flue
// reloads on its own); renders nothing so no consumer remounts.
function AgentSessionRunner({ activeId, projectId, conv, publish }) {
  // flue's durable key. The worker prepends `${userId}~`; we own the rest.
  const id = `${projectId ?? ""}~${activeId}`;
  const flueAgent = useFlueAgent({ name: AGENT_NAME, id });
  const client = useFlueClient();

  // `stop` closes over `id`; reach it through a ref so it can stay out of the
  // `agent` memo deps (which key on the stable snapshot fields only, per below).
  const idRef = useRef(id);
  idRef.current = id;

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

  // Adapt flue's surface (`messages`, `status`, `sendMessage`) to the shape the
  // rest of the app consumes (`messages`, `status`, `send`, `stop`, `error`).
  // flue's resting status is "idle"; the app treats "ready" as idle (e.g.
  // `useRevalidateOnAgentIdle` edge-triggers on it), so map idle → "ready".
  const agent = useMemo(
    () => ({
      messages: flueAgent.messages,
      status: flueAgent.status === "idle" ? "ready" : flueAgent.status,
      error: flueAgent.error,
      historyReady: flueAgent.historyReady,
      // `send({ message, images })` — `message` is a plain string; `images` is
      // flue's optional `AgentPromptImage[]` (`{ data: base64, mimeType }`).
      send: ({ message = "", images } = {}) =>
        sendRef.current(message, images?.length ? { images } : undefined),
      // Cancel the in-flight turn. `useFlueAgent` doesn't surface a stop, but the
      // underlying client does: `agents.abort` POSTs `/agents/:name/:id/abort`,
      // which the flue worker threads as an AbortSignal through the running turn
      // (and its in-flight tool calls). The `/eve` proxy prepends `${userId}~`,
      // so `id` matches the one `useFlueAgent` observes. Swallow errors — the
      // SSE observation will settle the turn regardless.
      stop: () => {
        client.agents.abort(AGENT_NAME, idRef.current).catch(() => {});
      },
    }),
    [client, flueAgent.messages, flueAgent.status, flueAgent.error, flueAgent.historyReady],
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
// script. Routed through the agent (the shot-list skill) like the Render buttons.
export function generateShotListMessage() {
  return [
    `Generate the shot list from the script now — the pinned draft is signed.`,
    `Load the shot-list skill and follow it: call get_script, break the screenplay into an` +
      ` ordered list of short (~2-4s) shots, each with beat/location, camera, action,` +
      ` dialogue, an audio-sync note, and a Seedance prompt, then` +
      ` call save_shotlist. Do NOT render any video and do NOT pack the bundles yourself —` +
      ` the app auto-packs into <=15s multishots. When done, tell me how many shots you wrote` +
      ` and how many <=15s multishots they pack into.`,
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
