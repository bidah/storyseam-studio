import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AgentMessage, MessagePart } from '@/components/chat/types';

// Local mirror of the last-seen transcript, per chat.
//
// flue owns the real transcript in a Durable Object and `useFlueAgent` re-streams
// it on every cold start (`historyReady` flips once it lands). That round-trip is
// a beat or two of nothing — long enough to flash the "Ask me to build the
// episode" empty state before the history pops in. There's no way to seed flue's
// state (`UseFlueAgentOptions` is just `{name,id,live,client}`), so instead we keep
// our own copy of what was on screen last time and render THAT as the cover until
// the live transcript arrives, then swap. The chat is therefore fully drawn on the
// first frame, and the swap is a plain data change on the same list — no spinner,
// no remount, no scroll jump (the list is inverted, so it stays pinned at newest).
//
// This is a display cache, NOT a source of truth: it is never sent anywhere, never
// merged with live data, and is dropped the moment the durable history arrives.

const PREFIX = 'shotStudio.transcript.';

// Keep the tail — the cover only has to fill one screen, and the live transcript
// replaces it a moment later.
const MAX_MESSAGES = 30;
// Per-part text cap. Long tool dumps / reasoning blocks are collapsed or clipped
// on screen anyway; this keeps a single write off the multi-hundred-KB path.
const MAX_TEXT = 4000;
// Whole-payload ceiling. Over it, oldest messages are shed until it fits.
const MAX_BYTES = 192 * 1024;

function clip(text: unknown): string | undefined {
  if (typeof text !== 'string') return undefined;
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}

// Strip a part down to what the renderer actually reads (see message.tsx
// `PartView`). Tool `output` is never drawn and is the biggest thing on the wire
// (a whole script, a shot list…), so it's dropped; `input` is kept ONLY for
// `ask_question`, whose card renders the question and its options.
function slimPart(part: MessagePart): MessagePart | null {
  switch (part.type) {
    case 'text':
    case 'reasoning': {
      const text = clip(part.text);
      // `state:'streaming'` would make the cover animate a caret that never
      // advances — land every cached part in its settled state.
      return text ? { type: part.type, text } : null;
    }
    case 'dynamic-tool':
      return {
        type: 'dynamic-tool',
        toolName: part.toolName,
        toolCallId: part.toolCallId,
        // A part cached mid-run would render a chip spinning forever; show it as
        // finished unless it actually failed.
        state: part.state === 'output-error' ? 'output-error' : 'output-available',
        errorText: clip(part.errorText),
        ...(part.toolName === 'ask_question' ? { input: part.input } : null),
      };
    case 'file':
      return {
        type: 'file',
        mediaType: part.mediaType,
        filename: part.filename,
        url: part.url,
      };
    default:
      return null;
  }
}

function slim(messages: AgentMessage[]): AgentMessage[] {
  return messages.slice(-MAX_MESSAGES).map((m) => ({
    id: m.id,
    role: m.role,
    parts: (m.parts || []).map(slimPart).filter(Boolean) as MessagePart[],
  }));
}

// Serialize under the byte ceiling, shedding from the oldest end.
function encode(messages: AgentMessage[]): string | null {
  let slice = slim(messages);
  while (slice.length) {
    const json = JSON.stringify(slice);
    if (json.length <= MAX_BYTES) return json;
    slice = slice.slice(1);
  }
  return null;
}

// Covers already read off disk this launch. AsyncStorage is async, so a screen
// mounting cold would still paint one empty frame before its cover arrived —
// this makes the read a one-time cost per chat and lets the chat screen pull the
// cover synchronously on its FIRST render (`peekTranscript`). The provider warms
// the active chat's entry during boot, so the common path is already in memory.
const memory = new Map<string, AgentMessage[]>();

let timer: ReturnType<typeof setTimeout> | undefined;
let pending: { chatId: string; messages: AgentMessage[] } | null = null;

function flush() {
  clearTimeout(timer);
  const job = pending;
  pending = null;
  if (!job) return;
  // Memory first: switching back to this chat should read the newest cover even
  // if the disk write is still in flight.
  memory.set(job.chatId, slim(job.messages));
  const json = encode(job.messages);
  const key = PREFIX + job.chatId;
  const write = json ? AsyncStorage.setItem(key, json) : AsyncStorage.removeItem(key);
  write.catch(() => {});
}

// Remember this chat's transcript. Debounced — this is called on every streamed
// delta, and only the latest snapshot matters.
export function saveTranscript(chatId: string, messages: AgentMessage[]) {
  if (!chatId) return;
  // A switch to a different chat lands mid-debounce; write the outgoing one out
  // rather than dropping its newest snapshot on the floor.
  if (pending && pending.chatId !== chatId) flush();
  pending = { chatId, messages };
  clearTimeout(timer);
  timer = setTimeout(flush, 400);
}

// The cover for a chat if it's already in memory — a synchronous read, safe to
// call from render. `undefined` means "not read yet" (kick `preloadTranscript`);
// `[]` means "read, and there's nothing cached for this chat".
export function peekTranscript(chatId: string): AgentMessage[] | undefined {
  return chatId ? memory.get(chatId) : [];
}

// Read a chat's cover off disk (once) into memory.
export async function preloadTranscript(chatId: string): Promise<AgentMessage[]> {
  if (!chatId) return [];
  const hit = memory.get(chatId);
  if (hit) return hit;
  let messages: AgentMessage[] = [];
  try {
    const raw = await AsyncStorage.getItem(PREFIX + chatId);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) messages = parsed;
  } catch {
    // corrupted / unavailable storage — fall through to the skeleton
  }
  memory.set(chatId, messages);
  return messages;
}

export function dropTranscript(chatId: string) {
  if (pending?.chatId === chatId) pending = null;
  memory.delete(chatId);
  AsyncStorage.removeItem(PREFIX + chatId).catch(() => {});
}

// Drop covers for chats that no longer exist (deleted, or shed by `trimStore`).
export async function pruneTranscripts(keepIds: string[]) {
  try {
    const keep = new Set(keepIds);
    for (const id of memory.keys()) if (!keep.has(id)) memory.delete(id);
    const keys = await AsyncStorage.getAllKeys();
    const stale = keys.filter((k) => k.startsWith(PREFIX) && !keep.has(k.slice(PREFIX.length)));
    if (stale.length) await AsyncStorage.multiRemove(stale);
  } catch {
    // best-effort housekeeping
  }
}
