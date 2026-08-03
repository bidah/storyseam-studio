// Higgsfield generation MCP — the backend the render skills drive to make
// image/video/audio. We talk to it with a hand-rolled, Workers-safe MCP client:
// raw streamable-HTTP JSON-RPC (initialize → notifications/initialized →
// tools/list | tools/call), mirroring the proven worker/src/lib/higgsfield.js.
//
// Why not flue's connectMcpServer? That path builds tools through the official
// MCP SDK, which compiles every outputSchema with Ajv (`new Function`). Cloudflare
// Workers forbid runtime code generation, so the compile throws at init and kills
// the ENTIRE Higgsfield tool set. Parsing tools/list ourselves — zero Ajv, zero
// `new Function` — is the fix. See plans/flue-higgsfield-mcp-workers-fix.md.
//
// Auth: the signed-in user's live Higgsfield bearer, bridged from the worker
// (which refreshes it). The rich interactive-OAuth fallback eve had (an in-chat
// sign-in card) has no flue equivalent yet; the token bridge is the primary path
// (web login is Google, but a Higgsfield account linked via Settings ›
// Connectors — or the mobile Higgsfield sign-in — puts the token on the same
// account row the bridge reads). If none is available we return [] and the
// generation tools are simply absent.
//
// Tool names stay `mcp__higgsfield__<tool>` so nothing else needs to change.

import { defineTool } from "@flue/runtime";
import type { ToolDefinition } from "@flue/runtime";
import * as v from "valibot";
import { workerHiggsfieldToken } from "./worker-token.js";

const MCP_URL = () => process.env.HIGGSFIELD_MCP_URL;
const PROTOCOL_VERSION = "2025-03-26";

// --- raw streamable-HTTP JSON-RPC (mirrors worker/src/lib/higgsfield.js) ---

async function rpcPost(
  url: string,
  token: string,
  sessionId: string | null,
  body: unknown,
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
}

// Parse a JSON-RPC reply from either a plain-JSON or SSE (text/event-stream) body.
async function parseRpc(res: Response): Promise<any | null> {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/event-stream")) {
    const text = await res.text();
    let msg: any = null;
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        const j = JSON.parse(line.slice(5).trim());
        if (j && (j.result !== undefined || j.error)) msg = j;
      } catch {
        /* keep-alives / partial lines */
      }
    }
    return msg;
  }
  if (res.status === 202) return null; // accepted notification, no body
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// Fresh, stateless initialize handshake → returns the mcp-session-id (may be null).
async function handshake(url: string, token: string): Promise<string | null> {
  const init = await rpcPost(url, token, null, {
    jsonrpc: "2.0",
    id: 0,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "shot-studio-flue", version: "1.0.0" },
    },
  });
  if (!init.ok)
    throw new Error(`Higgsfield MCP initialize failed (${init.status})`);
  const sessionId = init.headers.get("mcp-session-id");
  await parseRpc(init); // drain the initialize result
  try {
    await rpcPost(url, token, sessionId, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
  } catch {
    /* optional */
  }
  return sessionId;
}

// tools/list (paginated) — parsed by us, NO schema compilation.
async function listTools(url: string, token: string): Promise<any[]> {
  const sessionId = await handshake(url, token);
  const out: any[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const res = await rpcPost(url, token, sessionId, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: cursor ? { cursor } : {},
    });
    if (!res.ok)
      throw new Error(`Higgsfield MCP tools/list failed (${res.status})`);
    const msg = await parseRpc(res);
    if (msg?.error) throw new Error(msg.error.message || "tools/list error");
    const r = msg?.result || {};
    out.push(...(r.tools || []));
    cursor = r.nextCursor;
    if (cursor && seen.has(cursor)) break;
    if (cursor) seen.add(cursor);
  } while (cursor);
  return out;
}

// tools/call — stateless (fresh handshake per call, like the worker). Re-fetches
// the bearer through the bridge each call so a long conversation never uses a
// stale token; force-refreshes once on an auth failure.
async function callTool(
  userId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const url = MCP_URL()!;
  const run = async (force: boolean): Promise<Response> => {
    const bridged = await workerHiggsfieldToken(userId, force);
    if (!bridged?.token) throw new Error("No Higgsfield credential for this user.");
    const sessionId = await handshake(url, bridged.token);
    return rpcPost(url, bridged.token, sessionId, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args || {} },
    });
  };
  let res = await run(false);
  if (res.status === 401 || res.status === 403) res = await run(true); // stale bearer → refresh once
  if (!res.ok) throw new Error(`Higgsfield MCP call failed (${res.status})`);
  const msg = await parseRpc(res);
  if (!msg) throw new Error("Empty Higgsfield MCP response");
  if (msg.error) throw new Error(msg.error.message || "Higgsfield MCP error");
  const r = msg.result || {};
  if (r.isError) {
    const t = (r.content || [])
      .map((p: any) => p.text || "")
      .join(" ")
      .trim();
    throw new Error(t || "Higgsfield tool error");
  }
  if (r.structuredContent !== undefined) return r.structuredContent;
  const text = (r.content || []).find((p: any) => p.type === "text")?.text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// Terminal job states — anything else means the render is still running.
const DONE = new Set([
  "completed",
  "complete",
  "succeeded",
  "success",
  "done",
  "ready",
  "failed",
  "error",
  "canceled",
  "cancelled",
  "nsfw",
]);

// A Higgsfield render is an ASYNC JOB: `generate_image` / `generate_video` /
// `generate_audio` return a queued job and the pixels land minutes later. The
// model treated that return as "done", wrote a line, and ENDED THE TURN — so the
// chat went idle (composer back to the mic, "What's next" offered) while the
// render was still running, and the author had no way to tell work was in
// flight. flue has no background-task channel: an agent turn is the only thing
// the client can see running, so a render that outlives the turn is invisible.
//
// The tool RESULT is the strongest place to say so — it is re-read on every
// step, unlike a system-prompt line the model has already scrolled past (the
// same reason `render_ui` returns its "End your turn now" note). Detected from
// the data rather than a hardcoded tool-name list, so a Higgsfield tool we
// haven't seen yet is covered the day it appears.
function withPendingJobNote(result: unknown): unknown {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const r = result as Record<string, unknown>;
  const id = r.id ?? r.job_id ?? r.jobId;
  if (!id) return result;
  const status = typeof r.status === "string" ? r.status.toLowerCase() : "";
  if (status && DONE.has(status)) return result;
  return {
    ...r,
    note: `This render is still RUNNING — what came back is a job, not the finished media. Do NOT end your turn here and do not tell the author it is done. Poll mcp__higgsfield__job_status with id "${String(id)}" until it reports a terminal state, then attach the result with the matching attach_* tool. If you stop now the chat goes idle while the render is still going and the author sees nothing happening.`,
  };
}

// flue's defineTool takes a valibot schema, not raw JSON Schema, and @flue/runtime
// doesn't export a JSON-Schema→valibot converter. So we accept a permissive record
// (Higgsfield validates args server-side) and fold the real parameter docs into the
// tool description instead, so the model still knows the shape.
function describeMcpTool(tool: any): string {
  const base = String(tool.description || tool.name || "").trim();
  const schema = tool.inputSchema || {};
  const props = schema.properties || {};
  const required: string[] = Array.isArray(schema.required) ? schema.required : [];
  const keys = Object.keys(props);
  if (!keys.length) return base;
  const lines = keys.map((k) => {
    const p = props[k] || {};
    const type = p.type ? String(p.type) : "any";
    const req = required.includes(k) ? " (required)" : "";
    const desc = p.description ? ` — ${String(p.description).trim()}` : "";
    return `- ${k}: ${type}${req}${desc}`;
  });
  return `${base}\n\nParameters:\n${lines.join("\n")}`;
}

// --- public: discover tools once, wrap each as a flue tool ---

export async function createHiggsfieldTools(
  userId: string,
): Promise<ToolDefinition[]> {
  const url = MCP_URL();
  if (!url || !userId) return [];

  const bridged = await workerHiggsfieldToken(userId);
  if (!bridged?.token) return []; // user has no Higgsfield credential — tools absent by design

  let discovered: any[];
  try {
    discovered = await listTools(url, bridged.token);
  } catch (err) {
    console.error("[flue] Higgsfield MCP discovery failed:", err); // was silently swallowed
    return [];
  }

  return discovered.map((tool) =>
    defineTool({
      name: `mcp__higgsfield__${tool.name}`,
      description: describeMcpTool(tool),
      // flue requires a top-level object schema; looseObject passes arbitrary
      // keys straight through (Higgsfield validates the real shape server-side).
      input: v.looseObject({}),
      async run({ input }) {
        const result = await callTool(
          userId,
          tool.name,
          (input ?? {}) as Record<string, unknown>,
        );
        return withPendingJobNote(result) as any;
      },
    }),
  );
}
