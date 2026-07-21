// Daytona sandbox wiring. eve used a Vercel Sandbox (defaultBackend); on flue we
// own the Daytona lifecycle: create a sandbox and hand it to the generated
// `daytona(sandbox)` adapter. The agent initializer re-runs on each harness init,
// so we cache one sandbox per instance id (within this DO isolate) to avoid
// re-creating on every turn. Gated on DAYTONA_API_KEY: without it we return
// undefined and flue falls back to its lightweight in-memory sandbox (fine for
// tool-only turns; bash/skill execution needs Daytona).

import { Daytona } from "@daytona/sdk";
import type { Sandbox as DaytonaSandbox } from "@daytona/sdk";
import type { SandboxFactory } from "@flue/runtime";
import { daytona } from "../sandboxes/daytona.js";

const cache = new Map<string, Promise<DaytonaSandbox>>();

function sandboxFor(id: string, apiKey: string): Promise<DaytonaSandbox> {
  let existing = cache.get(id);
  if (!existing) {
    const client = new Daytona({ apiKey });
    // Self-stopping so orphaned sandboxes don't accumulate; the app remains the
    // lifecycle owner (Daytona auto-stops idle sandboxes after the interval).
    existing = client.create({ autoStopInterval: 15 });
    cache.set(id, existing);
  }
  return existing;
}

export async function createSandbox(
  id: string,
): Promise<SandboxFactory | undefined> {
  const apiKey = process.env.DAYTONA_API_KEY;
  if (!apiKey) return undefined;
  const sandbox = await sandboxFor(id, apiKey);
  return daytona(sandbox);
}
