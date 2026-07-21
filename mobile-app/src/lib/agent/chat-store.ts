import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

// Persistent chat history for the studio agent (port of web src/lib/chat-store.js).
//
// flue owns the conversation transcript server-side (a Durable Object keyed by
// the instance id `${projectId}~${chatId}`), so the client no longer persists
// event/session snapshots — `useFlueAgent` reconstructs `messages` from durable
// history on its own. This store's remaining job is just to remember WHICH
// conversations exist per project (their ids + titles) so the user can start
// new chats and switch back into old ones, plus the client-only image
// attachment record the composer re-renders thumbnails from.
//
// Chats are SCOPED PER PROJECT: every chat carries the `projectId` it belongs
// to, the history list is filtered to the current project, and the last-active
// chat is remembered per project (`activeByProject`) so switching projects
// reopens the conversation we were on there — or a fresh one if that project
// has none yet.

const KEY = 'shotStudio.chats.v2';
const LEGACY_KEY = 'shotStudio.chats.v1';
const MAX_CHATS = 50;

export type Chat = {
  id: string;
  projectId: string | null;
  title: string;
  createdAt: number;
  updatedAt: number;
  // Client-only, ordinal-aligned image attachments (flue's `file` parts don't
  // serve historical bytes, so the composer re-renders thumbnails from this
  // record).
  attachments: any[];
};

export type ChatStore = {
  // Last-active chat id per project id ("" for a null/unknown project).
  activeByProject: Record<string, string>;
  order: string[];
  chats: Record<string, Chat>;
};

function pidKey(pid: string | null): string {
  return pid || '';
}

export function makeChat(projectId: string | null = null, title = 'New chat'): Chat {
  const now = Date.now();
  return {
    id: Crypto.randomUUID(),
    projectId: projectId ?? null,
    title,
    createdAt: now,
    updatedAt: now,
    attachments: [],
  };
}

// The chats belonging to one project, in `order` (most-recent-first).
export function chatsForProject(store: ChatStore, pid: string | null): Chat[] {
  const want = pid ?? null;
  return store.order.map((id) => store.chats[id]).filter((c) => c && c.projectId === want);
}

// The active chat id for a project, or null if it has none / a stale pointer.
export function activeChatId(store: ChatStore, pid: string | null): string | null {
  const want = pid ?? null;
  const id = store.activeByProject[pidKey(pid)];
  if (id && store.chats[id] && store.chats[id].projectId === want) return id;
  return chatsForProject(store, pid)[0]?.id ?? null;
}

// Guarantee a project has a valid active chat: keep the current pointer if it's
// still valid, otherwise adopt that project's most-recent chat, otherwise mint a
// fresh blank one. Returns the same store reference when nothing changed.
export function withActiveForProject(store: ChatStore, pid: string | null): ChatStore {
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

// Cap total stored chats, but never drop one that some project still points at.
export function trimStore(store: ChatStore): ChatStore {
  if (store.order.length <= MAX_CHATS) return store;
  const actives = new Set(Object.values(store.activeByProject));
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const id of store.order) {
    if (kept.length < MAX_CHATS || actives.has(id)) kept.push(id);
    else dropped.push(id);
  }
  if (dropped.length === 0) return store;
  const chats = { ...store.chats };
  for (const id of dropped) delete chats[id];
  return { ...store, order: kept, chats };
}

function normalize(parsed: any): ChatStore {
  const rawChats = parsed?.chats && typeof parsed.chats === 'object' ? parsed.chats : {};
  const order: string[] = (Array.isArray(parsed?.order) ? parsed.order : []).filter(
    (id: string) => rawChats[id],
  );
  const chats: Record<string, Chat> = {};
  for (const id of order) {
    const c = rawChats[id];
    chats[id] = c.projectId === undefined ? { ...c, projectId: null } : c;
  }
  const activeByProject: Record<string, string> = {};
  const src =
    parsed?.activeByProject && typeof parsed.activeByProject === 'object' ? parsed.activeByProject : {};
  for (const k of Object.keys(src)) {
    if (chats[src[k]]) activeByProject[k] = src[k];
  }
  return { activeByProject, order, chats };
}

// Migrate a v1 store (one global list, single `activeId`, no projectId) into the
// v2 per-project shape by stamping every existing chat with the CURRENT project —
// we can't know which project each really belonged to, so they all land under
// the project active at migration time.
function migrateV1(parsed: any, pid: string | null): ChatStore {
  const want = pid ?? null;
  const oldChats = parsed?.chats && typeof parsed.chats === 'object' ? parsed.chats : {};
  const order: string[] = (Array.isArray(parsed?.order) ? parsed.order : []).filter(
    (id: string) => oldChats[id],
  );
  const chats: Record<string, Chat> = {};
  for (const id of order) chats[id] = { ...oldChats[id], projectId: want };
  const activeByProject: Record<string, string> = {};
  if (order.length) {
    activeByProject[pidKey(pid)] = chats[parsed.activeId] ? parsed.activeId : order[0];
  }
  return { activeByProject, order, chats };
}

async function readRaw(key: string): Promise<any> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // corrupted / unavailable storage
  }
}

// Load and normalize the store (migrating a legacy v1 store if that's all there
// is), then guarantee the current project has a live active chat. `pid` is the
// project active at load time — passed in so migration/scoping uses the right
// project (the caller reads it after project hydration).
export async function loadStore(pid: string | null): Promise<ChatStore> {
  const parsed = await readRaw(KEY);
  let store: ChatStore;
  if (parsed && parsed.chats && parsed.activeByProject && Array.isArray(parsed.order)) {
    store = normalize(parsed);
  } else {
    const legacy = await readRaw(LEGACY_KEY);
    store = legacy && legacy.chats ? migrateV1(legacy, pid) : { activeByProject: {}, order: [], chats: {} };
  }
  return withActiveForProject(store, pid);
}

let persistTimer: ReturnType<typeof setTimeout> | undefined;
export function persistStore(store: ChatStore) {
  // Debounced — turns can finish in bursts and AsyncStorage writes are async.
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    AsyncStorage.setItem(KEY, JSON.stringify(store)).catch(() => {});
  }, 150);
}

// First non-empty user line, trimmed to a menu-friendly length.
export function deriveTitle(messages: any[] | undefined): string | null {
  for (const m of messages || []) {
    if (m.role !== 'user') continue;
    const text = (m.parts || [])
      .filter((p: any) => p.type === 'text')
      .map((p: any) => p.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) return text.length > 48 ? `${text.slice(0, 47).trimEnd()}…` : text;
  }
  return null;
}

export const CHATS_LIMIT = MAX_CHATS;
