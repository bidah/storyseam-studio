import { observe, registerProvider } from "@flue/runtime";
import { flue } from "@flue/runtime/routing";
import { Hono, type MiddlewareHandler } from "hono";
import { verifyProxyUser, proxySecret, PROXY_HEADER } from "./lib/proxy-auth.js";
import { decodeInstanceId } from "./lib/instance-id.js";
import { isAllowedModel } from "./lib/models.js";
import { isPlausibleFalKey } from "./lib/fal-key.js";

// --- Observability -----------------------------------------------------------
// Surface agent failures to Cloudflare Workers Logs (wrangler.jsonc enables
// `observability`, so these land in the dashboard's Logs tab and `wrangler
// tail`). Without this, a failed run ("agent error" in the chat panel) left no
// trace on this worker — the flue runtime emits the failure via observe() but
// nothing consumed it. We log every error-ish event with enough correlation
// (instanceId → userId~projectId~chatId, runId, operationKind) to find the run.
// Subscriber work must stay light: observe() callbacks are fire-and-forget and
// their promises are observed-for-rejection but never awaited, so we only emit
// synchronous console lines here — no I/O.
function errText(error: unknown): string {
  if (!error) return "";
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

observe((event) => {
  // Correlation fields ride on every decoded event (optional per variant).
  const scope = {
    instanceId: event.instanceId,
    runId: event.runId,
    agent: event.agentName,
  };
  switch (event.type) {
    case "run_end":
      if (event.isError) {
        console.error("[flue] run failed", {
          ...scope,
          durationMs: event.durationMs,
          error: errText(event.error),
        });
      }
      break;
    case "submission_settled":
      if (event.outcome !== "completed") {
        console.error("[flue] submission " + event.outcome, {
          ...scope,
          submissionId: event.submissionId,
          error: event.error?.message,
          type: event.error?.type,
          details: event.error?.details,
        });
      }
      break;
    case "operation":
      if (event.isError) {
        console.error("[flue] operation failed", {
          ...scope,
          operationId: event.operationId,
          kind: event.operationKind,
          durationMs: event.durationMs,
          error: errText(event.error),
        });
      }
      break;
    case "compaction":
      if (event.isError) {
        console.warn("[flue] compaction failed", {
          ...scope,
          error: errText(event.error),
        });
      }
      break;
    case "log":
      // Forward the agent's own structured logs (log.warn/log.error).
      if (event.level === "error") {
        console.error("[flue] " + event.message, { ...scope, ...event.attributes });
      } else if (event.level === "warn") {
        console.warn("[flue] " + event.message, { ...scope, ...event.attributes });
      }
      break;
  }
});

// The per-turn model chosen by the web picker rides on this header (set by the
// projectFetch shim on the SPA side and forwarded verbatim by the /eve proxy).
const MODEL_HEADER = "x-flue-model";
// The user's own fal.ai key rides the same way (localStorage-only BYOK — see
// src/lib/falKey.js in the SPA). Persisted per conversation via setFalKey so
// the fal_* render tools can use it mid-run; never stored in a database.
const FAL_KEY_HEADER = "x-flue-fal-key";

// Generated Durable Object binding for each agent: `whistlewood.ts` ->
// class FlueWhistlewoodAgent -> env.FLUE_WHISTLEWOOD_AGENT.
const AGENT_BINDINGS: Record<string, string> = {
  whistlewood: "FLUE_WHISTLEWOOD_AGENT",
};

type ModelStub = {
  setModel(model: string): Promise<void>;
  setFalKey(key: string): Promise<void>;
};
type Env = Record<string, DurableObjectNamespace | undefined>;

// Route the built-in `anthropic/*` provider through Cloudflare AI Gateway
// (caching / logging / rate limiting) when a gateway URL is configured, while
// keeping clean `anthropic/claude-sonnet-5` specifiers everywhere. Falls back to
// calling Anthropic directly when ANTHROPIC_GATEWAY_URL is unset. This is the
// documented built-in-provider override pattern.
if (process.env.ANTHROPIC_GATEWAY_URL) {
  registerProvider("anthropic", {
    baseUrl: process.env.ANTHROPIC_GATEWAY_URL,
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
}

// The single auth boundary. The shot-studio-uploads worker mints a short-lived
// HMAC token on `x-flue-proxy-user`; we verify it AND that the authenticated
// principal owns this conversation (its user id is the `userId~projectId~chatId`
// prefix of the instance id). Guards both POST (send) and GET (stream).
const requireProxyUser: MiddlewareHandler = async (c, next) => {
  const secret = proxySecret();
  if (!secret) return c.json({ error: "server misconfigured" }, 500);

  const claims = await verifyProxyUser(c.req.header(PROXY_HEADER), secret);
  if (!claims) return c.json({ error: "Unauthorized" }, 401);

  const decoded = decodeInstanceId(c.req.param("id"));
  if (!decoded) return c.json({ error: "Bad instance id" }, 400);
  if (decoded.userId !== claims.sub) return c.json({ error: "Forbidden" }, 403);

  await next();
};

// Apply the picker's per-turn model to this conversation just before the prompt
// is admitted. Runs AFTER requireProxyUser (so the principal owns the instance)
// and only on POST (send) — GET is the stream read. Persisting to the DO here,
// before `next()` hands off to flue's admission, guarantees the agent
// initializer reads the fresh model for this turn. Best-effort: a set failure
// must never block the send (it just keeps the previously stored / default
// model). The model is whitelisted so a client can't select an arbitrary one.
const applyModelSelection: MiddlewareHandler = async (c, next) => {
  const requested = c.req.header(MODEL_HEADER);
  const falKey = c.req.header(FAL_KEY_HEADER);
  const wantModel = isAllowedModel(requested);
  const wantFalKey = isPlausibleFalKey(falKey);
  if (c.req.method === "POST" && (wantModel || wantFalKey)) {
    const name = c.req.param("name") ?? "";
    const bindingName = AGENT_BINDINGS[name];
    const ns = bindingName
      ? (c.env as unknown as Env)[bindingName]
      : undefined;
    const id = c.req.param("id");
    if (ns && id) {
      try {
        const stub = ns.get(ns.idFromName(id)) as unknown as ModelStub;
        if (wantModel) await stub.setModel(requested as string);
        // Refresh the conversation's BYOK fal key each send (absent header
        // leaves the stored key alone, so other clients keep working).
        if (wantFalKey) await stub.setFalKey(falKey as string);
      } catch {
        /* keep the stored / default model + key */
      }
    }
  }
  await next();
};

const app = new Hono();

// Health + client capabilities. `providers` reports which KEY-GATED model
// providers this worker can actually reach, so the web picker can hide models it
// has no key for (Cloudflare Workers AI models need no key and are always on).
// Public (no proxy-user auth) so the SPA can read it before/around a send.
app.get("/health", (c) =>
  c.json({
    ok: true,
    providers: { anthropic: Boolean(process.env.ANTHROPIC_API_KEY) },
  }),
);
app.use("/agents/:name/:id", requireProxyUser);
app.use("/agents/:name/:id/*", requireProxyUser);
app.use("/agents/:name/:id", applyModelSelection);

app.route("/", flue());

export default app;
