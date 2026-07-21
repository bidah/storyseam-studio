// Higgsfield generation MCP — the backend the render skills drive to make
// image/video/audio. flue's connectMcpServer takes static/dynamic headers, so we
// bridge the signed-in user's live Higgsfield bearer (from the worker) as the
// Authorization header. Tool names arrive prefixed `mcp__higgsfield__<tool>`.
//
// The rich interactive-OAuth fallback eve had (an in-chat sign-in card) has no
// flue equivalent yet; the token bridge is the primary path (app login already
// IS Higgsfield OAuth) so nearly every user has a token. If none is available we
// return [] and the generation tools are simply absent this turn.

import { connectMcpServer } from "@flue/runtime";
import type { ToolDefinition } from "@flue/runtime";
import { workerHiggsfieldToken } from "./worker-token.js";

export async function createHiggsfieldTools(
  userId: string,
): Promise<ToolDefinition[]> {
  const url = process.env.HIGGSFIELD_MCP_URL;
  if (!url) return [];

  // A pre-provisioned static bearer (CI/service) short-circuits the bridge.
  const staticToken = process.env.HIGGSFIELD_MCP_TOKEN;
  const bridged = staticToken
    ? { token: staticToken }
    : await workerHiggsfieldToken(userId);
  if (!bridged?.token) return [];

  try {
    const connection = await connectMcpServer("higgsfield", {
      url,
      transport: "streamable-http",
      headers: { Authorization: `Bearer ${bridged.token}` },
    });
    return connection.tools;
  } catch {
    return [];
  }
}
