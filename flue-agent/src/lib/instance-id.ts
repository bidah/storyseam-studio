// The agent-instance id is the ONLY per-conversation channel flue gives us:
// `defineAgent(({ id }) => ...)` receives it, but a tool's `run({ input, signal })`
// gets no user/project context. So we encode everything a conversation needs into
// the id and decode it in the agent initializer to build project-scoped tools +
// per-user credentials via closure (flue's `createTicketTools(id)` pattern).
//
//   id = `${userId}~${projectId}~${chatId}`
//
// The worker (shot-studio-uploads) constructs this id from the Better Auth user
// (authenticated) + the `x-project-id` header + the chat id. app.ts middleware
// re-verifies that the HMAC-authenticated principal matches `userId` before any
// request reaches the agent, so a client cannot forge another user's id.

const SEP = "~";

export interface InstanceId {
  userId: string;
  projectId: string | null;
  chatId: string;
}

export function encodeInstanceId(parts: InstanceId): string {
  const projectId = parts.projectId ?? "";
  return [parts.userId, projectId, parts.chatId].join(SEP);
}

export function decodeInstanceId(
  id: string | null | undefined,
): InstanceId | null {
  if (!id) return null;
  const bits = id.split(SEP);
  if (bits.length !== 3) return null;
  const [userId, projectId, chatId] = bits;
  if (!userId || !chatId) return null;
  return { userId, projectId: projectId || null, chatId };
}
