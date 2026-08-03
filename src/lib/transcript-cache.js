// ---------------------------------------------------------------------------
// Instant-paint cache for flue chat transcripts.
//
// flue owns the transcript server-side and reloads it in ONE unpaginated
// history fetch per chat switch (browser → uploads worker → flue worker → DO),
// so reopening a long conversation means seconds of spinner while the full
// snapshot downloads. This cache keeps the last-rendered messages of recent
// chats on the client so a switch paints the transcript immediately —
// stale-while-revalidate, same pattern the tab loaders use — and the durable
// history simply replaces it when it lands. The cache is never the source of
// truth: nothing is ever written back to flue from here.
//
// localStorage, one key per chat plus an LRU index. Entries are trimmed to the
// most recent messages and size-capped so a media-heavy transcript can't blow
// the storage quota; on QuotaExceededError we evict oldest-first and retry.
// ---------------------------------------------------------------------------

const PREFIX = "shotStudio.transcript.v1.";
const INDEX_KEY = "shotStudio.transcript.v1.index";
const MAX_CHATS = 10; // LRU depth — how many chats keep an instant transcript
const MAX_MESSAGES = 40; // newest messages kept per chat (a few screens' worth)
const MAX_BYTES = 400_000; // per-chat serialized cap (~0.4MB of a ~5MB quota)

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readIndex() {
  const idx = safeParse(localStorage.getItem(INDEX_KEY));
  return Array.isArray(idx) ? idx.filter((id) => typeof id === "string") : [];
}

function writeIndex(idx) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(idx));
}

function evict(id) {
  try {
    localStorage.removeItem(PREFIX + id);
  } catch {
    /* ignore */
  }
}

// The cached transcript for a chat, or [] if none. Synchronous — called during
// render setup, so it must not await anything.
export function loadTranscript(chatId) {
  if (!chatId) return [];
  try {
    const entry = safeParse(localStorage.getItem(PREFIX + chatId));
    return Array.isArray(entry?.messages) ? entry.messages : [];
  } catch {
    return [];
  }
}

// Store the newest slice of a chat's settled transcript, trimmed to the size
// cap. Best-effort: any storage failure just means the next open shows the
// spinner again.
export function saveTranscript(chatId, messages) {
  if (!chatId || !Array.isArray(messages) || messages.length === 0) return;
  try {
    let slice = messages.slice(-MAX_MESSAGES);
    let payload = JSON.stringify({ at: Date.now(), messages: slice });
    // Shrink oldest-first until the entry fits its byte budget. A single
    // oversized message ends the loop with slice.length === 1; give up then.
    while (payload.length > MAX_BYTES && slice.length > 1) {
      slice = slice.slice(Math.ceil(slice.length / 2));
      payload = JSON.stringify({ at: Date.now(), messages: slice });
    }
    if (payload.length > MAX_BYTES) return;

    const idx = readIndex().filter((id) => id !== chatId);
    idx.unshift(chatId);
    for (const stale of idx.splice(MAX_CHATS)) evict(stale);

    try {
      localStorage.setItem(PREFIX + chatId, payload);
    } catch {
      // Quota pressure from the rest of the app: evict our own oldest entries
      // and retry once.
      for (const stale of idx.splice(1)) evict(stale);
      localStorage.setItem(PREFIX + chatId, payload);
    }
    writeIndex(idx);
  } catch {
    /* best-effort */
  }
}

// Forget a deleted chat's cached transcript.
export function dropTranscript(chatId) {
  if (!chatId) return;
  evict(chatId);
  try {
    writeIndex(readIndex().filter((id) => id !== chatId));
  } catch {
    /* best-effort */
  }
}
