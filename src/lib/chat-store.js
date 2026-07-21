// ---------------------------------------------------------------------------
// Persistent chat history for the studio agent.
//
// flue owns the conversation transcript server-side (a Durable Object keyed by
// the instance id), so the client no longer persists event/session snapshots —
// `useFlueAgent` reconstructs `messages` from durable history on its own. This
// store's remaining job is just to remember WHICH conversations exist per
// project (their ids + titles) so the user can start new chats and switch back
// into old ones; the instance id (`${projectId}~${chatId}`) is all flue needs
// to reopen a chat's history.
//
// The store keeps many conversations keyed by id, plus which one is active, so
// the chat header can offer "new chat" and "jump into a previous chat". Image
// attachments are client-only (flue's `file` parts don't serve historical
// bytes), so each chat also carries the ordinal-aligned attachment record the
// composer needs to re-render thumbnails.
//
// Chats are SCOPED PER PROJECT: every chat carries the `projectId` it belongs
// to, the history list is filtered to the current project, and the last-active
// chat is remembered per project (`activeByProject`) so switching projects
// reopens the conversation we were on there — or a fresh one if that project has
// none yet. The current project id comes from the projectFetch shim (a plain
// module value, readable without React), so this store can scope itself without
// depending on the ProjectProvider that lives below the AgentProvider.
// ---------------------------------------------------------------------------

import { getProjectId } from "@/lib/projectFetch";

const KEY = "shotStudio.chats.v2";
const LEGACY_KEY = "shotStudio.chats.v1";
const MAX_CHATS = 50;

function uid() {
  return globalThis.crypto?.randomUUID?.() ?? `chat_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
}

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// `activeByProject` is keyed by project id; a null/unknown project (e.g. before
// the project list has loaded) maps to "" so there's always a stable key.
function pidKey(pid) {
  return pid || "";
}

// A blank conversation, tagged to a project. flue owns the transcript, so a
// chat is just its id + title + the client-only attachment record.
export function makeChat(projectId = null, title = "New chat") {
  const now = Date.now();
  return {
    id: uid(),
    projectId: projectId ?? null,
    title,
    createdAt: now,
    updatedAt: now,
    attachments: [],
  };
}

// The chats belonging to one project, in `order` (most-recent-first).
export function chatsForProject(store, pid) {
  const want = pid ?? null;
  return store.order.map((id) => store.chats[id]).filter((c) => c && c.projectId === want);
}

// The active chat id for a project, or null if it has none / a stale pointer.
export function activeChatId(store, pid) {
  const want = pid ?? null;
  const id = store.activeByProject[pidKey(pid)];
  if (id && store.chats[id] && store.chats[id].projectId === want) return id;
  return chatsForProject(store, pid)[0]?.id ?? null;
}

// Guarantee a project has a valid active chat: keep the current pointer if it's
// still valid, otherwise adopt that project's most-recent chat, otherwise mint a
// fresh blank one. Returns the same store reference when nothing changed.
export function withActiveForProject(store, pid) {
  const key = pidKey(pid);
  const cur = store.activeByProject[key];
  if (cur && store.chats[cur] && store.chats[cur].projectId === (pid ?? null)) return store;
  const existing = chatsForProject(store, pid)[0];
  if (existing) {
    return { ...store, activeByProject: { ...store.activeByProject, [key]: existing.id } };
  }
  const c = makeChat(pid ?? null);
  return {
    activeByProject: { ...store.activeByProject, [key]: c.id },
    order: [c.id, ...store.order],
    chats: { ...store.chats, [c.id]: c },
  };
}

// Cap the total number of stored chats, but never drop a chat that some project
// still points at as its active conversation.
export function trimStore(store) {
  if (store.order.length <= MAX_CHATS) return store;
  const actives = new Set(Object.values(store.activeByProject));
  const kept = [];
  const dropped = [];
  for (const id of store.order) {
    if (kept.length < MAX_CHATS || actives.has(id)) kept.push(id);
    else dropped.push(id);
  }
  if (dropped.length === 0) return store;
  const chats = { ...store.chats };
  for (const id of dropped) delete chats[id];
  return { ...store, order: kept, chats };
}

// Drop order entries with no chat, default missing projectIds, and prune
// activeByProject pointers that no longer resolve.
function normalize(parsed) {
  const chats = parsed?.chats && typeof parsed.chats === "object" ? parsed.chats : {};
  const order = (Array.isArray(parsed?.order) ? parsed.order : []).filter((id) => chats[id]);
  const cleanChats = {};
  for (const id of order) {
    const c = chats[id];
    cleanChats[id] = c.projectId === undefined ? { ...c, projectId: null } : c;
  }
  const activeByProject = {};
  const src = parsed?.activeByProject && typeof parsed.activeByProject === "object" ? parsed.activeByProject : {};
  for (const [k, id] of Object.entries(src)) {
    if (cleanChats[id]) activeByProject[k] = id;
  }
  return { activeByProject, order, chats: cleanChats };
}

// Migrate a v1 store (one global list, single `activeId`, no projectId) into the
// v2 per-project shape by stamping every existing chat with the CURRENT project
// — we can't know which project each really belonged to, so they all land under
// the project that's active at migration time.
function migrateV1(parsed, pid) {
  const want = pid ?? null;
  const oldChats = parsed?.chats && typeof parsed.chats === "object" ? parsed.chats : {};
  const order = (Array.isArray(parsed?.order) ? parsed.order : []).filter((id) => oldChats[id]);
  const chats = {};
  for (const id of order) chats[id] = { ...oldChats[id], projectId: want };
  const activeByProject = {};
  if (order.length) {
    activeByProject[pidKey(pid)] = chats[parsed.activeId] ? parsed.activeId : order[0];
  }
  return { activeByProject, order, chats };
}

function readRaw(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // private mode / disabled storage
  }
}

// Normalize whatever is in localStorage into a valid store (migrating a legacy
// v1 store if that's all there is), then guarantee the current project has a
// live active chat so the session runner always has something to run.
export function loadStore() {
  const pid = getProjectId();
  const parsed = safeParse(readRaw(KEY));
  let store;
  if (parsed && parsed.chats && parsed.activeByProject && Array.isArray(parsed.order)) {
    store = normalize(parsed);
  } else {
    const legacy = safeParse(readRaw(LEGACY_KEY));
    store = legacy && legacy.chats ? migrateV1(legacy, pid) : { activeByProject: {}, order: [], chats: {} };
  }
  return withActiveForProject(store, pid);
}

export function persistStore(store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* quota / disabled storage — history just won't persist */
  }
}

// First non-empty user line, trimmed to a menu-friendly length.
export function deriveTitle(messages) {
  for (const m of messages || []) {
    if (m.role !== "user") continue;
    const text = (m.parts || [])
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) return text.length > 48 ? `${text.slice(0, 47).trimEnd()}…` : text;
  }
  return null;
}

export const CHATS_LIMIT = MAX_CHATS;
