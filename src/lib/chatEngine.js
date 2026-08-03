// Which agent engine a chat runs on.
//
// Two flue workers are deployed at once — `shot-studio-flue` (flue 1) and
// `shot-studio-flue-v2` (flue 2). Flue 2's persisted schema is a hard break: it
// rejects a flue-1 database before any application code runs, so a conversation
// can never move between them. Rather than migrate transcripts, each chat is
// PINNED to its engine for life, and the pin is the chat id's own prefix — the
// /eve proxy reads it and picks the origin without a lookup (worker/src/index.js).
//
// THIS build of the client speaks only the flue 2 protocol (@flue/sdk), so a
// new chat is ALWAYS minted with the v2 prefix — unconditionally and
// synchronously. An earlier version asked /eve/health first and minted
// unprefixed (v1) ids until the probe resolved; that race shipped: the chat
// store creates the active chat on startup, before any fetch settles, so every
// first-load chat landed on flue 1 — whose worker answers this client's sends
// with 400 "Request is malformed". There is nothing to ask: an unprefixed id is
// unusable from here regardless of what the flag says. Rolling flue 2 back is
// therefore a REDEPLOY of the old SPA + worker pair, not just the
// FLUE_V2_NEW_CHATS flag — the flag now only steers clients old enough to
// still probe for it.
const V2_PREFIX = "f2-";

// The prefix to put in front of a freshly minted chat id.
export function newChatPrefix() {
  return V2_PREFIX;
}

// Which engine an EXISTING chat id runs on. A pre-migration (unprefixed) chat
// lives on flue 1, which this client can no longer talk to — such chats are
// read-only relics (cached transcript only) and sends into them are blocked in
// AgentProvider with a "start a new chat" nudge.
export function engineForChatId(chatId) {
  return String(chatId ?? "").startsWith(V2_PREFIX) ? "flue2" : "flue1";
}
