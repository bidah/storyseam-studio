import type { LocalAttachment } from '@/components/chat/composer';

// The first message typed on the chat LANDING screen, handed off to the
// conversation screen it opens.
//
// The landing screen can't send it itself: `useAgent()` is a SINGLE shared flue
// session pointed at the active chat, and the chat the composer is starting has
// no runner yet (the provider remounts `AgentSessionRunner` on the new id a
// render later, and only then publishes an agent bound to it). Sending from the
// landing screen would therefore post the first line into whatever chat happened
// to be active before.
//
// So the landing screen mints the chat, parks the draft here, and navigates; the
// conversation screen picks it up once its own runner is live
// (`agent.chatId === id`) and does the upload + send itself.
//
// A module-level map rather than a route param because a draft carries picked
// images — local file URIs with metadata, not something to serialize through a
// URL.

export type PendingDraft = { text: string; attachments: LocalAttachment[] };

const drafts = new Map<string, PendingDraft>();

export function setPendingDraft(chatId: string, draft: PendingDraft) {
  drafts.set(chatId, draft);
}

// Read-and-clear: a draft is sent exactly once, however many times the screen
// remounts (an agent resync, a project switch, a back-and-forward).
export function takePendingDraft(chatId: string): PendingDraft | null {
  const draft = drafts.get(chatId);
  if (draft) drafts.delete(chatId);
  return draft ?? null;
}
