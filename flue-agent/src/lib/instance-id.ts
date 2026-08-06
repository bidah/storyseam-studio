// The agent-instance id is the ONLY per-conversation channel flue gives us:
// `defineAgent(({ id }) => ...)` receives it, but a tool's `run({ input, signal })`
// gets no user/project context. So we encode everything a conversation needs into
// the id and decode it in the agent initializer to build project-scoped tools +
// per-user credentials via closure (flue's `createTicketTools(id)` pattern).
//
//   id = `${userId}~${projectId}~${chatId}`                (feature / default episode)
//   id = `${userId}~${projectId}~${chatId}~${episodeId}`   (a non-default series episode)
//
// The worker (shot-studio-uploads) constructs this id from the Better Auth user
// (authenticated) + the `x-project-id` header + the chat id, and appends the
// active `x-episode-id` ONLY when it isn't the default episode. That carve-out is
// deliberate: a feature film / the first episode keeps the original 3-part id, so
// every pre-series conversation addresses the SAME durable object it always did —
// appending "~ep1" to all of them would have orphaned every existing transcript.
// A chat is thus bound to the episode it was started on; switching episode
// addresses a different (episode-scoped) conversation. app.ts middleware
// re-verifies that the HMAC-authenticated principal matches `userId` before any
// request reaches the agent, so a client cannot forge another user's id.

const SEP = "~";

export interface InstanceId {
  userId: string;
  projectId: string | null;
  chatId: string;
  episodeId: string | null;
}

export function encodeInstanceId(parts: InstanceId): string {
  const projectId = parts.projectId ?? "";
  const base = [parts.userId, projectId, parts.chatId];
  // Only the non-default episode is encoded, matching the worker's proxy.
  if (parts.episodeId) base.push(parts.episodeId);
  return base.join(SEP);
}

export function decodeInstanceId(
  id: string | null | undefined,
): InstanceId | null {
  if (!id) return null;
  const bits = id.split(SEP);
  // 3 parts = feature / default episode (episodeId null → the worker's unsuffixed
  // baseline); 4 parts = a specific series episode.
  if (bits.length !== 3 && bits.length !== 4) return null;
  const [userId, projectId, chatId, episodeId] = bits;
  if (!userId || !chatId) return null;
  return { userId, projectId: projectId || null, chatId, episodeId: episodeId || null };
}
