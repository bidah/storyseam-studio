import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { newChatPrefix } from './chat-engine';

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
  // True once an AI-generated title has been locked in (web does the titling;
  // it rides in via the server registry) — a derived first-line title must not
  // overwrite it.
  titled?: boolean;
  // True once this chat is known to the server registry (/api/chats), which is
  // what lets a merge distinguish "deleted on another device" from "never
  // pushed".
  synced?: boolean;
  createdAt: number;
  updatedAt: number;
  // Client-only, ordinal-aligned image attachments (flue's `file` parts don't
  // serve historical bytes, so the composer re-renders thumbnails from this
  // record).
  attachments: any[];
};

export type ServerChat = {
  id: string;
  title: string;
  titled?: boolean;
  createdAt: number | null;
  updatedAt: number | null;
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
    // The id carries which agent engine this conversation lives on, for life —
    // the /eve proxy routes on the prefix and never looks anything up. See
    // chat-engine.ts.
    id: `${newChatPrefix()}${Crypto.randomUUID()}`,
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

// Boot handoff. `loadStore` is a disk read, and <AgentProvider> renders NOTHING
// until it lands — so on a cold start the tab bar came up over an empty body
// while AsyncStorage was still being parsed. The cold-start path (lib/boot.ts)
// does that read behind the splash instead and parks the result here; the
// provider takes it on its first render and publishes without waiting.
//
// Taken exactly ONCE, only for the project it was read for, and never after a
// write: this is a hand-off, not a cache. The write rule is the one that matters
// — boot's read can lose the race with its own deadline, leaving a parked store
// nobody collected, and handing THAT to a later mount would resurrect the chat
// list from before whatever has been persisted since. `persistStore` drops it.
let handoff: { pid: string | null; store: ChatStore } | null = null;

export async function preloadStore(pid: string | null): Promise<ChatStore> {
  const store = await loadStore(pid);
  handoff = { pid, store };
  return store;
}

export function takePreloadedStore(pid: string | null): ChatStore | null {
  const hit = handoff && handoff.pid === pid ? handoff.store : null;
  handoff = null;
  return hit;
}

// Merge the server registry (GET /api/chats — this user's chats in `pid`, see
// worker/src/routes/chats.js) into the local store — port of the web's
// mergeServerChats (src/lib/chat-store.js). The server is how a chat started
// on ANOTHER device (the web app, another phone) becomes visible here: the
// transcript already lives in flue's Durable Object, so the id + title is all
// it takes to reopen it.
//
// Rules:
// - A server chat we don't have locally is adopted (attachments start empty —
//   they're client-only by design).
// - For a chat both sides know, newer `updatedAt` wins, except that an
//   AI-locked title (`titled`) is never overwritten by a derived one.
// - A LOCAL chat of this project that has synced before (`synced`) but is
//   missing from the server was deleted on another device — drop it, unless it
//   changed locally in the last minute (its push may still be in flight).
// - Chats never pushed (blank "New chat" placeholders, offline-only history)
//   are left alone.
//
// Returns the same store reference when nothing changed.
export function mergeServerChats(
  store: ChatStore,
  pid: string | null,
  serverChats: ServerChat[],
): ChatStore {
  const want = pid ?? null;
  const now = Date.now();
  let changed = false;
  const chats = { ...store.chats };
  const seen = new Set<string>();

  for (const s of Array.isArray(serverChats) ? serverChats : []) {
    if (!s?.id || !s.title) continue;
    seen.add(s.id);
    const local = chats[s.id];
    if (!local) {
      chats[s.id] = {
        id: s.id,
        projectId: want,
        title: s.title,
        titled: !!s.titled,
        createdAt: s.createdAt || now,
        updatedAt: s.updatedAt || now,
        attachments: [],
        synced: true,
      };
      changed = true;
      continue;
    }
    const next: Chat = { ...local, synced: true };
    const serverNewer = (s.updatedAt || 0) > (local.updatedAt || 0);
    const keepLocalTitle = local.titled && !s.titled;
    if (!keepLocalTitle && ((s.titled && !local.titled) || serverNewer)) {
      next.title = s.title;
      next.titled = !!s.titled || !!local.titled;
    }
    if (serverNewer) next.updatedAt = s.updatedAt!;
    if (
      next.title !== local.title ||
      !!next.titled !== !!local.titled ||
      next.updatedAt !== local.updatedAt ||
      !local.synced
    ) {
      chats[s.id] = next;
      changed = true;
    }
  }

  for (const [id, c] of Object.entries(chats)) {
    if (c.projectId !== want || seen.has(id) || !c.synced) continue;
    if (now - (c.updatedAt || 0) < 60_000) continue;
    delete chats[id];
    changed = true;
  }

  if (!changed) return store;
  // Recency IS the order everywhere this list renders, so rebuild it from
  // `updatedAt` — this also slots adopted chats into their right place.
  const order = Object.values(chats)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map((c) => c.id);
  const activeByProject = { ...store.activeByProject };
  for (const k of Object.keys(activeByProject)) {
    if (!chats[activeByProject[k]]) delete activeByProject[k];
  }
  return withActiveForProject(trimStore({ activeByProject, order, chats }), pid);
}

let persistTimer: ReturnType<typeof setTimeout> | undefined;
export function persistStore(store: ChatStore) {
  // Whatever boot parked is now behind the live store — see the hand-off above.
  handoff = null;
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
    // 90 chars is THREE lines of the Home tab's recap card (a 240pt card fits ~28
    // at its 15pt semibold), which is what that card shows. It used to be 48 — one
    // line and a bit — and the cards looked like they were truncating when they
    // were simply out of text. Everywhere else this string is rendered on one line
    // and truncates on render (the history rows, the chat modal's nav bar), so a
    // longer cap costs them nothing. Chats titled under the old cap keep their
    // short title until their transcript is next loaded and re-derived.
    if (text) return text.length > 90 ? `${text.slice(0, 89).trimEnd()}…` : text;
  }
  return null;
}

export const CHATS_LIMIT = MAX_CHATS;
