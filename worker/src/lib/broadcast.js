// Fan a live-sync payload out to a project's open SSE clients via its
// ProjectEvents Durable Object. Shared by index.js (SSE routes) and the route
// modules that write (script/timeline), so neither has to import the other.
export async function broadcast(env, projectId, channel, payload) {
  try {
    const stub = env.PROJECT_EVENTS.get(env.PROJECT_EVENTS.idFromName(projectId));
    await stub.fetch(`https://do/broadcast?channel=${channel}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    /* best effort — a dropped broadcast just means clients refresh on next edit */
  }
}
