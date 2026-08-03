// Which agent engine a chat runs on. Mobile twin of src/lib/chatEngine.js in
// the web studio — same contract.
//
// Two flue workers are deployed at once — `shot-studio-flue` (flue 1) and
// `shot-studio-flue-v2` (flue 2). Flue 2's persisted schema is a hard break: it
// rejects a flue-1 database before any application code runs, so a conversation
// can never move between them. Rather than migrate transcripts, each chat is
// PINNED to its engine for life, and the pin is the chat id's own prefix — the
// /eve proxy reads it and picks the origin without a lookup.
//
// THIS build of the client speaks only the flue 2 protocol, so a new chat is
// ALWAYS minted with the v2 prefix — unconditionally and synchronously. The
// earlier /eve/health probe raced chat creation on cold start: the store minted
// the active chat before the probe settled, so first-load chats landed
// unprefixed on flue 1, whose worker answers this client's sends with
// 400 "Request is malformed". An unprefixed id is unusable from here whatever
// the server flag says, so there is nothing to ask.
const V2_PREFIX = 'f2-';

/** The prefix to put in front of a freshly minted chat id. */
export function newChatPrefix(): string {
  return V2_PREFIX;
}

/**
 * Which engine an EXISTING chat id runs on. A pre-migration (unprefixed) chat
 * lives on flue 1, which this client can no longer talk to — treat it as a
 * read-only relic and steer the author to a new chat.
 */
export function engineForChatId(chatId: string): 'flue1' | 'flue2' {
  return String(chatId ?? '').startsWith(V2_PREFIX) ? 'flue2' : 'flue1';
}
