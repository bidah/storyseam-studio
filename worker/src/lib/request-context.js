// Who is making the current request, available anywhere below the middleware
// without threading a parameter through every call.
//
// The problem this solves: `doc_history` records what each write REPLACED, but
// its only provenance was a free-text `source` field copied out of the document
// ("agent", "app"). With two people on a project you could not answer "who
// clobbered the world bible, and in which conversation?" — which is most of what
// you want to know when you open the history dialog at all.
//
// The obvious fix — pass an actor into `writeDoc`/`updateDoc` — means touching
// every one of the ~40 call sites, and any site that forgets silently records
// nothing. So the actor rides in an AsyncLocalStorage store instead: the request
// middleware opens it once, and `lib/history.js` reads it at the moment it parks
// a snapshot. Call sites are unchanged and cannot opt out by accident.
//
// AsyncLocalStorage is real on Workers under `nodejs_compat` (already enabled in
// wrangler.jsonc for the Daytona SDK). It is per-request by construction, so
// unlike stashing state on `env` there is no cross-request bleed — `env` is the
// same object for every request on an isolate, which is exactly the bug this
// avoids.

import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage();

/**
 * Run `fn` with the request's identity attached.
 *
 * `context` is `{ userId, caller, chatId, episodeId }`:
 *   userId    the authenticated user (session cookie, or the agent's signed header)
 *   caller    "app" | "agent" — which credential answered
 *   chatId    the agent conversation a tool call belongs to, when there is one
 *   episodeId the active series episode; `lib/docs.js` reads it to scope the
 *             per-episode document rows (a missing/default episode is unscoped —
 *             the same back-compat key existing single-episode projects use).
 */
export function runWithContext(context, fn) {
  return storage.run(context, fn);
}

// The current request's identity, or an empty object outside a request (a
// scheduled handler, a test). Never throws: attribution is metadata, and a
// missing actor must never fail the write it was describing.
export function requestContext() {
  return storage.getStore() || {};
}
