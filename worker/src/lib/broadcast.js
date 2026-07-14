// Fan a live-sync payload out to a project's open SSE clients via its
// ProjectEvents Durable Object. Shared by index.js (the generic /api/* firehose)
// and the route modules that write (script/timeline).
//
// The DO round-trip is kept OFF the request's critical path: writers must not
// wait on it, or a slow/cold DO stalls the write itself (seen in the wild as
// UND_ERR_HEADERS_TIMEOUT on the agent's PUT /api/script). Pass the request's
// `executionCtx` so the fan-out runs under `waitUntil` after the response is
// sent. The generous timeout + one retry exist because a cold DO start can
// exceed a couple of seconds — a silently dropped broadcast means open tabs
// show stale data until the next edit or a manual Refresh.
import { normalizeProjectId } from "./docs.js";

const BROADCAST_TIMEOUT_MS = 10000;
const RETRIES = 1;

async function fanOut(env, projectId, channel, payload) {
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const stub = env.PROJECT_EVENTS.get(env.PROJECT_EVENTS.idFromName(projectId));
      const res = await stub.fetch(`https://do/broadcast?channel=${channel}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(BROADCAST_TIMEOUT_MS),
      });
      if (res.ok) return;
    } catch {
      /* retry once, then give up — clients also resync on SSE reconnect */
    }
  }
}

// Fire-and-forget when `ctx.waitUntil` is available (the normal request path);
// otherwise returns the promise so callers without a context can still await it.
export function broadcast(env, projectId, channel, payload, ctx) {
  // Key the DO exactly like the doc stores key storage: a request whose
  // projectId resolved to null still WRITES into `p_default` (docKey fallback),
  // so its event must go to the `p_default` DO too — never be skipped.
  const key = normalizeProjectId(projectId);
  const p = fanOut(env, key, channel, payload);
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(p);
    return Promise.resolve();
  }
  return p;
}
