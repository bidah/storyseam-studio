// Fan a live-sync payload out to a project's open SSE clients via its
// ProjectEvents Durable Object. Shared by index.js (the generic /api/* firehose)
// and the route modules that write (script/timeline).
//
// The DO round-trip is kept OFF the request's critical path: writers must not
// wait on it, or a slow/cold DO stalls the write itself (seen in the wild as
// UND_ERR_HEADERS_TIMEOUT on the agent's PUT /api/script). Pass the request's
// `executionCtx` so the fan-out runs under `waitUntil` after the response is
// sent; a 2s guard means even a wedged DO can never hold the isolate open.
const BROADCAST_TIMEOUT_MS = 2000;

async function fanOut(env, projectId, channel, payload) {
  try {
    const stub = env.PROJECT_EVENTS.get(env.PROJECT_EVENTS.idFromName(projectId));
    await stub.fetch(`https://do/broadcast?channel=${channel}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(BROADCAST_TIMEOUT_MS),
    });
  } catch {
    /* best effort — a dropped broadcast just means clients refresh on next edit */
  }
}

// Fire-and-forget when `ctx.waitUntil` is available (the normal request path);
// otherwise returns the promise so callers without a context can still await it.
export function broadcast(env, projectId, channel, payload, ctx) {
  if (!projectId) return Promise.resolve();
  const p = fanOut(env, projectId, channel, payload);
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(p);
    return Promise.resolve();
  }
  return p;
}
