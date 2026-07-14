import type { AgentMessage, InputRequest, MessagePart } from './types';

// Ports of the web AgentChat.jsx derivations — same semantics, typed.

// Does this part render anything visible in the transcript?
function isVisible(p: MessagePart | undefined): boolean {
  if (!p) return false;
  return (
    (p.type === 'text' && !!p.text?.trim()) ||
    (p.type === 'reasoning' && !!p.text?.trim()) ||
    p.type === 'dynamic-tool' ||
    p.type === 'authorization'
  );
}

// The latest HITL request still awaiting an answer — a tool part carrying an
// inputRequest with no matching inputResponse yet. Drives the composer
// placeholder and lets a typed answer be routed back to the right requestId.
export function pendingRequest(messages: AgentMessage[]): InputRequest | null {
  let found: InputRequest | null = null;
  for (const m of messages) {
    for (const part of m.parts || []) {
      const eve = part?.toolMetadata?.eve;
      if (eve?.inputRequest && !eve.inputResponse) found = eve.inputRequest;
    }
  }
  return found;
}

// The agent is "thinking" while a turn is in flight and the current assistant
// message hasn't produced any renderable content yet.
export function isThinking(messages: AgentMessage[], busy: boolean): boolean {
  if (!busy) return false;
  const last = messages[messages.length - 1];
  if (!last || last.role === 'user') return true;
  return !(last.parts || []).some(isVisible);
}

// The agent is "working" while a turn is in flight and the current assistant
// message's most recent visible content is a tool call with no text after it.
// Suppressed while a HITL request is pending (there the user must answer).
// Returns the trailing tool's name, or null.
export function workingTool(
  messages: AgentMessage[],
  busy: boolean,
  pending: boolean,
): string | null {
  if (!busy || pending) return null;
  const last = messages[messages.length - 1];
  if (!last || last.role === 'user') return null;
  let trailing: MessagePart | null = null;
  for (const p of last.parts || []) {
    if (isVisible(p)) trailing = p;
  }
  return trailing?.type === 'dynamic-tool' ? trailing.toolName || 'tool' : null;
}

// Compact "2m" / "3h" / "5d" relative time for the conversations list.
export function relTime(ts: number | undefined): string {
  if (!ts) return '';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

// Plain text of a user message (its text parts joined).
export function userText(message: AgentMessage): string {
  return (message.parts || [])
    .filter((p) => p.type === 'text')
    .map((p) => p.text || '')
    .join('');
}
