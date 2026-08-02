// Which agent engine a NEW chat is created on.
//
// Two flue workers are deployed at once — `shot-studio-flue` (flue 1) and
// `shot-studio-flue-v2` (flue 2). Flue 2's persisted schema is a hard break: it
// rejects a flue-1 database before any application code runs, so a conversation
// can never move between them. Rather than migrate transcripts, each chat is
// PINNED to its engine for life, and the pin is the chat id's own prefix — the
// /eve proxy reads it and picks the origin without a lookup (worker/src/index.js).
//
// So this module answers exactly one question: does the NEXT chat get the v2
// prefix? The worker publishes the answer on the /eve/health probe the app
// already makes at startup, which means the cutover — and the rollback — is one
// worker var, no redeploy, and nothing existing moves either way.
//
// Until the probe resolves we mint UNPREFIXED (v1) ids. That's the conservative
// direction: a chat that lands on the old engine is an ordinary chat, whereas
// one wrongly marked v2 would open against a worker that has never seen it.

let newChats = "flue1";
let prefix = "f2-";
let probeStarted = false;

function ensureProbe() {
  if (probeStarted) return;
  probeStarted = true;
  fetch("/eve/health", { headers: { accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((data) => {
      const engine = data?.engine;
      if (!engine) return;
      if (typeof engine.v2Prefix === "string" && engine.v2Prefix) {
        prefix = engine.v2Prefix;
      }
      if (engine.newChats === "flue2") newChats = "flue2";
    });
}

// The prefix to put in front of a freshly minted chat id — "" on flue 1.
export function newChatPrefix() {
  ensureProbe();
  return newChats === "flue2" ? prefix : "";
}

// Which engine an EXISTING chat id runs on. Exported for display (a "previous
// engine" badge) and for tests; routing itself happens in the worker.
export function engineForChatId(chatId) {
  return String(chatId ?? "").startsWith(prefix) ? "flue2" : "flue1";
}
