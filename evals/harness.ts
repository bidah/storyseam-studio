// A thin vitest-evals harness over the deployed whistlewood agent, built on the
// real @flue/sdk client. Each eval case gets a FRESH agent instance (unique chat
// id) so conversations never bleed together, prompts the agent, waits for the
// terminal result, then reads the conversation history back to see which tools
// the agent actually called. Scoring in the .eval.ts files asserts on the
// returned text + the set of tool names.
import { createFlueClient, type AgentPromptImage } from "@flue/sdk";

export const FLUE_BASE_URL = process.env.FLUE_BASE_URL ?? "";
export const HAS_AGENT = FLUE_BASE_URL.length > 0;

// The agent to prompt (matches flue-agent/src/agents/whistlewood.ts).
const AGENT_NAME = process.env.FLUE_AGENT_NAME ?? "whistlewood";

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

let _client: ReturnType<typeof createFlueClient> | null = null;
function client() {
  if (!_client) {
    _client = createFlueClient({ baseUrl: FLUE_BASE_URL, headers: authHeaders() });
  }
  return _client;
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
  model: { provider: string; id: string };
  /** True if the agent called `toolName` at any point in the turn. */
  usedTool(toolName: string): boolean;
  /** True if any called tool name matches `re`. */
  usedToolMatching(re: RegExp): boolean;
}

// Prompt the agent once on a fresh instance and return its text + tools.
export async function runAgent(
  message: string,
  images?: AgentPromptImage[],
): Promise<AgentRun> {
  const chatId = `eval-${Date.now()}-${chatSeq++}`;
  const id = `${EVAL_USER}~${EVAL_PROJECT}~${chatId}`;
  const c = client();

  const res = await c.agents.prompt(AGENT_NAME, id, { message, images });
  const snapshot = await c.agents.history(AGENT_NAME, id).catch(() => null);
  const tools = [...collectToolNames(snapshot)];

  return {
    text: res.result.text ?? "",
    tools,
    model: res.result.model,
    usedTool: (name) => tools.includes(name),
    usedToolMatching: (re) => tools.some((t) => re.test(t)),
  };
}
