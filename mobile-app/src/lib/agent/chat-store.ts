import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

// Persistent chat history for the studio agent (port of web src/lib/chat-store.js).
//
// eve's client reduces `snapshot.events` (the authoritative server stream) back
// into `data.messages` at store construction, and `snapshot.session` is a
// serializable cursor that resumes the same server-side conversation — so a
// chat survives an app relaunch if we persist both and feed them back as
// `initialEvents` / `initialSession` when the eve store is (re)created.

const KEY = 'shotStudio.chats.v1';
const MAX_CHATS = 50;

export type Chat = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  events: any[];
  session: { streamIndex: number } & Record<string, any>;
  // Client-only, ordinal-aligned image attachments (eve's projection drops
  // image parts, so the composer re-renders thumbnails from this record).
  attachments: any[];
};

export type ChatStore = {
  activeId: string;
  order: string[];
  chats: Record<string, Chat>;
};

export function makeChat(title = 'New chat'): Chat {
  const now = Date.now();
  return {
    id: Crypto.randomUUID(),
    title,
    createdAt: now,
    updatedAt: now,
    events: [],
    session: { streamIndex: 0 },
    attachments: [],
  };
}

function freshStore(): ChatStore {
  const c = makeChat();
  return { activeId: c.id, order: [c.id], chats: { [c.id]: c } };
}

export async function loadStore(): Promise<ChatStore> {
  let parsed: any = null;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    /* corrupted / unavailable storage */
  }
  const chats = parsed?.chats && typeof parsed.chats === 'object' ? parsed.chats : null;
  const order: string[] = Array.isArray(parsed?.order)
    ? parsed.order.filter((id: string) => chats?.[id])
    : [];
  if (!chats || order.length === 0) return freshStore();
  const activeId = chats[parsed.activeId] ? parsed.activeId : order[0];
  const kept: Record<string, Chat> = {};
  for (const id of order) kept[id] = chats[id];
  return { activeId, order, chats: kept };
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
