// A thin vitest-evals harness over the deployed whistlewood agent, built on the
// real @flue/sdk client. Each eval case gets a FRESH agent instance (unique chat
// id) so conversations never bleed together, prompts the agent, waits for the
// terminal result, then reads the conversation history back to see which tools
// the agent actually called. Scoring in the .eval.ts files asserts on the
// returned text + the set of tool names.
import { createFlueClient, type DeliveredAttachment } from "@flue/sdk";

// The agent's MOUNT, not a deployment base: a flue 2 client addresses exactly
// one conversation URL, so the base and the agent name are one value now.
// e.g. FLUE_BASE_URL=https://…/eve  →  https://…/eve/agents/whistlewood
export const FLUE_BASE_URL = process.env.FLUE_BASE_URL ?? "";
export const HAS_AGENT = FLUE_BASE_URL.length > 0;

// The agent to prompt (matches flue-agent/src/agents/whistlewood.ts).
const AGENT_NAME = process.env.FLUE_AGENT_NAME ?? "whistlewood";
const AGENT_MOUNT = `${FLUE_BASE_URL.replace(/\/$/, "")}/agents/${AGENT_NAME}`;

// The instance id the worker builds is `${userId}~${projectId}~${chatId}`
// (flue-agent/src/lib/instance-id.ts). For evals we hold userId + projectId
// fixed from env and vary the chatId per case.
const EVAL_USER = process.env.FLUE_EVAL_USER ?? "eval-user";
const EVAL_PROJECT = process.env.FLUE_EVAL_PROJECT ?? "p_eval";

// Optional auth for a protected target, e.g. FLUE_AUTH_HEADER="authorization: Bearer …".
function authHeaders(): Record<string, string> {
  const raw = process.env.FLUE_AUTH_HEADER;
  if (!raw) return {};
  const i = raw.indexOf(":");
  return i > 0 ? { [raw.slice(0, i).trim()]: raw.slice(i + 1).trim() } : {};
}

// One client per conversation, so it is built per case rather than cached.
function client(id: string) {
  return createFlueClient({ url: `${AGENT_MOUNT}/${id}`, headers: authHeaders() });
}

// Recursively collect every `toolName` string in a history snapshot — tolerant
// of the exact snapshot shape (dynamic-tool parts carry `toolName`, mirroring
// the web client's countCompletedToolCalls in src/lib/swr.js).
function collectToolNames(node: unknown, out: Set<string> = new Set()): Set<string> {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const v of node) collectToolNames(v, out);
    return out;
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === "toolName" && typeof v === "string") out.add(v);
    else if (v && typeof v === "object") collectToolNames(v, out);
  }
  return out;
}

let chatSeq = 0;

export interface AgentRun {
  text: string;
  tools: string[];
  /**
   * Terminal outcome of this run's submission. Flue 2 no longer reports the
   * model it ran on to clients (message metadata is entirely agent-authored;
   * the runtime stamps nothing), so this is what "the turn really ran" asserts
   * against now — read it from Workers Logs if you need the model itself.
   */
  outcome: string | undefined;
  /** True if the agent called `toolName` at any point in the turn. */
  usedTool(toolName: string): boolean;
  /** True if any called tool name matches `re`. */
  usedToolMatching(re: RegExp): boolean;
}

// Every text part of the last assistant message, joined.
function lastAssistantText(snapshot: unknown): string {
  const messages = (snapshot as { messages?: Array<Record<string, unknown>> })?.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "assistant") continue;
    const parts = (m.parts as Array<Record<string, unknown>>) ?? [];
    return parts
      .filter((p) => p?.type === "text" && typeof p.text === "string")
      .map((p) => p.text as string)
      .join("");
  }
  return "";
}

// Prompt the agent once on a fresh instance and return its text + tools.
//
// Sends are fire-and-forget in flue 2 — `send()` returns at durable admission,
// so the reply is read from the conversation afterwards rather than off the
// send's own result. `wait()` is what blocks until the submission settles, and
// it REJECTS on a failed or aborted turn, which is the behaviour an eval wants.
export async function runAgent(
  message: string,
  images?: DeliveredAttachment[],
): Promise<AgentRun> {
  const chatId = `eval-${Date.now()}-${chatSeq++}`;
  const id = `${EVAL_USER}~${EVAL_PROJECT}~${chatId}`;
  const c = client(id);

  const admission = await c.send({
    message: { kind: "user", body: message, ...(images?.length ? { attachments: images } : {}) },
  });
  await c.wait(admission);
  const snapshot = await c.history().catch(() => null);
  const tools = [...collectToolNames(snapshot)];

  const settlement = (
    snapshot as { settlements?: Array<{ submissionId?: string; outcome?: string }> } | null
  )?.settlements?.find((s) => s.submissionId === admission.submissionId);

  return {
    text: lastAssistantText(snapshot),
    tools,
    outcome: settlement?.outcome,
    usedTool: (name) => tools.includes(name),
    usedToolMatching: (re) => tools.some((t) => re.test(t)),
  };
}
