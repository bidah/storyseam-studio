// ---------------------------------------------------------------------------
// Persistent chat history for the studio agent.
//
// eve's client reduces `snapshot.events` (the authoritative server stream) back
// into `data.messages` at store construction, and `snapshot.session` is a
// serializable cursor that resumes the same server-side conversation. So a chat
// survives a reload if we persist both to localStorage and feed them back as
// `initialEvents` / `initialSession` when the eve store is (re)created.
//
// The store keeps many conversations keyed by id, plus which one is active, so
// the chat header can offer "new chat" and "jump into a previous chat". Image
// attachments are client-only (eve's projection drops image parts), so each
// chat also carries the ordinal-aligned attachment record the composer needs to
// re-render thumbnails.
// ---------------------------------------------------------------------------

const KEY = "shotStudio.chats.v1";
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

// A blank conversation with an empty eve cursor.
export function makeChat(title = "New chat") {
  const now = Date.now();
  return {
    id: uid(),
    title,
    createdAt: now,
    updatedAt: now,
    events: [],
    session: { streamIndex: 0 },
    attachments: [],
  };
}

// Normalize whatever is in localStorage into a valid store, or seed a fresh one.
export function loadStore() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    /* private mode / disabled storage */
  }
  const parsed = raw ? safeParse(raw) : null;
  const chats = parsed?.chats && typeof parsed.chats === "object" ? parsed.chats : null;
  const order = Array.isArray(parsed?.order) ? parsed.order.filter((id) => chats?.[id]) : [];
  if (!chats || order.length === 0) {
    const c = makeChat();
    return { activeId: c.id, order: [c.id], chats: { [c.id]: c } };
  }
  const activeId = chats[parsed.activeId] ? parsed.activeId : order[0];
  // Keep only chats referenced by `order`, in that order.
  const kept = {};
  for (const id of order) kept[id] = chats[id];
  return { activeId, order, chats: kept };
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
