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

// The `input` shape of an `ask_question` tool part (flue's non-blocking HITL —
// see message.tsx `QuestionCard`). Kept loose: `input` is typed `unknown` off
// the wire, so cast defensively where it's read.
export type QuestionOption = { id?: string; label?: string; style?: string };
export type AskQuestionInput = { question?: string; options?: QuestionOption[] };

// Resolved answer state of every `ask_question` card in a thread: which card is
// still pending (its buttons stay live) and, for answered ones, the text the
// user replied with (keyed by toolCallId). Derived by `deriveQA`.
export type QuestionState = { pendingId: string | null; answered: Map<string, string> };

// One image the user sent with a turn (re-rendered from the persisted,
// ordinal-aligned attachments record — flue's `file` parts don't serve
// historical bytes).
export type SentAttachment = {
  url: string;
  name?: string;
  contentType?: string;
};
