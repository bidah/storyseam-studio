// Daytona sandbox wiring. eve used a Vercel Sandbox (defaultBackend); on flue we
// own the Daytona lifecycle: resolve a sandbox and hand it to the generated
// `daytona(sandbox)` adapter. Gated on DAYTONA_API_KEY: without it we return
// undefined and flue falls back to its in-memory `just-bash` sandbox, which is
// rebuilt EMPTY on every harness init (i.e. every turn) — fine for tool-only
// turns, useless for anything that writes a file and reads it back later.
//
// The sandbox id lives in this conversation's Durable Object storage, NOT in a
// module-level Map. The agent initializer re-runs on each harness init, and a DO
// isolate is evicted whenever the conversation goes idle — an in-memory cache
// therefore misses constantly and `create()`s a fresh empty sandbox, which is
// exactly the "the sandbox keeps resetting between calls" the agent reported.
// DO storage survives eviction, so the same sandbox (and its files) comes back.
//
// Cost/lifecycle: the sandbox auto-stops when idle (disk survives a stop; we
// start it again on the next turn) and auto-deletes a week after stopping so
// abandoned conversations don't accumulate. A deleted sandbox is self-healing —
// the lookup fails, we create a replacement and re-persist its id.

import { Daytona } from "@daytona/sdk";
import type { Sandbox as DaytonaSandbox } from "@daytona/sdk";
import type { SandboxFactory } from "@flue/runtime";
import { getCloudflareContext } from "@flue/runtime/cloudflare";
import { daytona } from "../sandboxes/daytona.js";

// Minimal SQL surface shared with models.ts / fal-key.ts (same DO key-value table).
interface SqlLike {
  exec(
    query: string,
    ...bindings: unknown[]
  ): { toArray(): Array<Record<string, unknown>> };
}

const TABLE = "app_settings";
const SANDBOX_ID_KEY = "daytonaSandboxId";
const DDL = `CREATE TABLE IF NOT EXISTS ${TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`;

// Minutes of inactivity before Daytona stops the sandbox. Stopping preserves the
// filesystem; `ensureRunning` starts it back up on the next turn.
const AUTO_STOP_MINUTES = 15;
// Minutes after stopping before Daytona deletes it (a week). Bounds the disk a
// long-abandoned conversation can hold without cutting an active one short.
const AUTO_DELETE_MINUTES = 7 * 24 * 60;
// Seconds to wait for a stopped/archived sandbox to come back up. Restoring an
// archived sandbox pulls its disk back from cold storage, so allow generously.
const START_TIMEOUT_SECONDS = 180;

function sql(): SqlLike {
  return getCloudflareContext().storage.sql as SqlLike;
}

function readSandboxId(): string {
  try {
    const db = sql();
    db.exec(DDL);
    const value = db
      .exec(`SELECT value FROM ${TABLE} WHERE key = ?`, SANDBOX_ID_KEY)
      .toArray()[0]?.value;
    return typeof value === "string" ? value : "";
  } catch (error) {
    // Loud on purpose: silently returning "" here means every turn creates a
    // brand-new sandbox, which is the exact failure this module exists to fix.
    console.error("[sandbox] could not read stored sandbox id", error);
    return "";
  }
}

function writeSandboxId(id: string): void {
  try {
    const db = sql();
    db.exec(DDL);
    db.exec(
      `INSERT INTO ${TABLE} (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      SANDBOX_ID_KEY,
      id,
    );
  } catch (error) {
    // A conversation that can't persist the id still gets a working sandbox for
    // this turn; it just won't be the same one next turn — so say so.
    console.error(`[sandbox] could not persist sandbox id ${id}`, error);
  }
}

// Bring a resolved sandbox to `started`, or throw so the caller replaces it.
async function ensureRunning(sandbox: DaytonaSandbox): Promise<void> {
  switch (sandbox.state) {
    case "started":
      return;
    // Disk is intact in all three; starting restores it.
    case "stopped":
    case "archived":
    case "paused":
      await sandbox.start(START_TIMEOUT_SECONDS);
      return;
    // A concurrent turn (or the create call) is already bringing it up.
    case "creating":
    case "starting":
    case "restoring":
    case "resuming":
    case "pulling_snapshot":
      await sandbox.waitUntilStarted(START_TIMEOUT_SECONDS);
      return;
    // destroyed / destroying / error / build_failed / unknown — unusable.
    default:
      throw new Error(`Daytona sandbox is unusable (state: ${sandbox.state})`);
  }
}

async function createFresh(client: Daytona): Promise<DaytonaSandbox> {
  const sandbox = await client.create({
    autoStopInterval: AUTO_STOP_MINUTES,
    autoDeleteInterval: AUTO_DELETE_MINUTES,
    // No user data — just enough to spot strays in the Daytona dashboard.
    labels: { app: "shot-studio-flue" },
  });
  writeSandboxId(sandbox.id);
  return sandbox;
}

// This conversation's sandbox: the stored one if it still exists and can run,
// otherwise a new one.
async function resolveSandbox(client: Daytona): Promise<DaytonaSandbox> {
  const storedId = readSandboxId();
  console.log(
    storedId
      ? `[sandbox] reusing stored sandbox ${storedId}`
      : "[sandbox] no stored sandbox for this conversation, creating one",
  );
  if (storedId) {
    try {
      const existing = await client.get(storedId);
      await ensureRunning(existing);
      return existing;
    } catch (error) {
      console.error(
        `[sandbox] stored Daytona sandbox ${storedId} unusable, recreating`,
        error,
      );
    }
  }
  const created = await createFresh(client);
  // Cross-isolate CAS: another init may have created and stored one while our
  // `create()` was in flight (a create takes ~a minute, and flue re-inits the
  // harness on its 30s submission wake). Last writer would otherwise orphan the
  // other sandbox for a week. Whoever finds a different id already stored yields
  // and deletes its own, so a conversation converges on exactly one sandbox.
  const winner = readSandboxId();
  if (winner && winner !== created.id) {
    try {
      const shared = await client.get(winner);
      await ensureRunning(shared);
      void created.delete().catch(() => {});
      return shared;
    } catch {
      // The stored winner turned out to be unusable — keep ours and claim it.
      writeSandboxId(created.id);
    }
  }
  return created;
}

// Dedupes concurrent harness inits WITHIN this isolate. Persistence is DO
// storage's job (above); this only stops two inits racing to `create()` before
// either has an id to store. Keyed by instance id because one isolate can host
// several conversations' Durable Objects.
//
// The entry is dropped as soon as it settles — deliberately. Holding a RESOLVED
// sandbox would recreate the bug this file exists to fix from the other side:
// the object would go stale when Daytona auto-stops it, and a later turn in the
// same isolate would hand the agent a stopped sandbox. Every turn re-resolves
// (one `get`, plus a `start` if it was stopped); only overlapping inits share.
const inFlight = new Map<string, Promise<DaytonaSandbox>>();

export async function createSandbox(
  id: string,
): Promise<SandboxFactory | undefined> {
  const apiKey = process.env.DAYTONA_API_KEY;
  if (!apiKey) return undefined;
  try {
    const client = new Daytona({
      apiKey,
      // The default event path opens a socket.io connection from the SDK
      // constructor, which a Worker can't hold open. Poll instead.
      useDeprecatedPolling: true,
    });
    let pending = inFlight.get(id);
    if (!pending) {
      pending = resolveSandbox(client);
      inFlight.set(id, pending);
      void pending.catch(() => {}).finally(() => inFlight.delete(id));
    }
    return daytona(await pending);
  } catch (error) {
    // Never fail the whole turn over the sandbox: degrade to flue's in-memory
    // one (bash still works, it just won't persist) and surface it in Logs.
    console.error(
      "[sandbox] Daytona unavailable, using in-memory fallback",
      error,
    );
    return undefined;
  }
}
