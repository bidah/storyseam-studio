// Loose (defensive) shapes for what the flue agent streams back. flue's
// `FlueConversationPart` is a discriminated union (`text` / `reasoning` /
// `dynamic-tool` / `file`); we keep every field optional here so the renderers
// can null-check without narrowing on the union.

export type MessagePart = {
  type?: string;
  // `text` / `reasoning` parts
  text?: string;
  state?: string;
  // `dynamic-tool` parts
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  // `file` parts (durably-recorded attachment, or a local optimistic echo)
  mediaType?: string;
  filename?: string;
  url?: string;
  size?: number;
};

export type AgentMessage = {
  id?: string;
  role?: string;
  parts?: MessagePart[];
};

// One image the user sent with a turn (re-rendered from the persisted,
// ordinal-aligned attachments record — flue's `file` parts don't serve
// historical bytes).
export type SentAttachment = {
  url: string;
  name?: string;
  contentType?: string;
};
