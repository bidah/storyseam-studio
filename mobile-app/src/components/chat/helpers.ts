import type { AgentMessage, MessagePart, QuestionState } from './types';

// Ports of the web AgentChat.jsx derivations — same semantics, typed.

// Does this part render anything visible in the transcript?
function isVisible(p: MessagePart | undefined): boolean {
  if (!p) return false;
  return (
    (p.type === 'text' && !!p.text?.trim()) ||
    (p.type === 'reasoning' && !!p.text?.trim()) ||
    p.type === 'dynamic-tool' ||
    p.type === 'file'
  );
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
// Returns the trailing tool's name, or null.
export function workingTool(messages: AgentMessage[], busy: boolean): string | null {
  if (!busy) return null;
  const last = messages[messages.length - 1];
  if (!last || last.role === 'user') return null;
  let trailing: MessagePart | null = null;
  for (const p of last.parts || []) {
    if (isVisible(p)) trailing = p;
  }
  return trailing?.type === 'dynamic-tool' ? trailing.toolName || 'tool' : null;
}

// The agent is "reasoning" while a turn is in flight and the current assistant
// message's trailing visible content is a reasoning block. The reasoning panel
// is collapsed and static (it doesn't animate like streaming text), so a
// prolonged chain-of-thought looks like the agent has stalled unless a shimmer
// marker sits below it. Distinct from `isThinking` (nothing rendered yet) and
// `workingTool` (trailing part is a tool call).
export function isReasoning(messages: AgentMessage[], busy: boolean): boolean {
  if (!busy) return false;
  const last = messages[messages.length - 1];
  if (!last || last.role === 'user') return false;
  let trailing: MessagePart | null = null;
  for (const p of last.parts || []) {
    if (isVisible(p)) trailing = p;
  }
  return trailing?.type === 'reasoning';
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

// Resolve the answer state of every `ask_question` card. flue has no server-side
// `inputResponse`, so "answered" is derived from the transcript: a question is
// answered by the first user message after it (its text is the answer); the one
// unanswered question — the last with no user message following — is `pendingId`
// (the only card whose buttons stay live). Port of the web `deriveQA`.
export function deriveQA(messages: AgentMessage[]): QuestionState {
  const answered = new Map<string, string>();
  let pendingId: string | null = null;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;
    for (const p of m.parts || []) {
      if (p.type !== 'dynamic-tool' || p.toolName !== 'ask_question' || !p.toolCallId) continue;
      let ans: string | null = null;
      for (let j = i + 1; j < messages.length; j++) {
        if (messages[j].role === 'user') {
          ans = userText(messages[j]).trim();
          break;
        }
      }
      if (ans) answered.set(p.toolCallId, ans);
      else pendingId = p.toolCallId;
    }
  }
  return { pendingId, answered };
}

// --- Web-search sources -----------------------------------------------------
// The two web tools (`web_search` / `fetch_url`) share one result shape across
// both backends — see flue-agent/src/lib/search-util.ts's `result()`:
//   { provider, query?, count, results: [{ title, url, publishedDate, author,
//     excerpts?, summary?, text? }] }
export const SOURCE_TOOLS = new Set(['web_search', 'fetch_url']);

export type Source = {
  url: string;
  title: string;
  publishedDate: string | null;
  snippet: string;
};

// Pull that payload off a finished tool part. The output arrives as the raw
// object in the normal case, but tolerate a JSON string and the
// `{ content: [{ type: "text", text }] }` envelope so a transport change
// degrades to the plain ToolChip instead of throwing mid-render.
export function parseSourcesOutput(
  part: MessagePart,
): { sources: Source[]; query: string } | null {
  if (part.state !== 'output-available') return null;
  const candidates: unknown[] = [];
  const out = part.output;
  if (out && typeof out === 'object' && !Array.isArray(out)) {
    candidates.push(out);
    const content = (out as Record<string, unknown>).content;
    if (Array.isArray(content)) {
      for (const c of content) {
        const t = (c as Record<string, unknown>)?.text;
        if (typeof t === 'string') candidates.push(t);
      }
    }
  } else if (typeof out === 'string') {
    candidates.push(out);
  }
  for (const candidate of candidates) {
    let obj: any = candidate;
    if (typeof obj === 'string') {
      try {
        obj = JSON.parse(obj);
      } catch {
        continue;
      }
    }
    const rows = obj?.results;
    if (!Array.isArray(rows)) continue;
    const sources: Source[] = rows
      .filter((r: any) => typeof r?.url === 'string' && r.url)
      .map((r: any) => ({
        url: r.url,
        title: typeof r.title === 'string' && r.title ? r.title : r.url,
        publishedDate: typeof r.publishedDate === 'string' ? r.publishedDate : null,
        snippet:
          (Array.isArray(r.excerpts) && typeof r.excerpts[0] === 'string' && r.excerpts[0]) ||
          (typeof r.summary === 'string' && r.summary) ||
          '',
      }));
    if (sources.length) {
      return { sources, query: typeof obj.query === 'string' ? obj.query : '' };
    }
  }
  return null;
}

// Hostname without the www., for the sub-card's secondary line.
export function hostOf(url: string): string {
  const m = /^[a-z]+:\/\/([^/?#]+)/i.exec(url);
  return m ? m[1].replace(/^www\./, '') : url;
}
