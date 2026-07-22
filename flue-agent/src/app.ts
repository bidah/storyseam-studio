import { registerProvider } from "@flue/runtime";
import { flue } from "@flue/runtime/routing";
import { Hono, type MiddlewareHandler } from "hono";
import { verifyProxyUser, proxySecret, PROXY_HEADER } from "./lib/proxy-auth.js";
import { decodeInstanceId } from "./lib/instance-id.js";
import { isAllowedModel } from "./lib/models.js";

// The per-turn model chosen by the web picker rides on this header (set by the
// projectFetch shim on the SPA side and forwarded verbatim by the /eve proxy).
const MODEL_HEADER = "x-flue-model";

// Generated Durable Object binding for each agent: `whistlewood.ts` ->
// class FlueWhistlewoodAgent -> env.FLUE_WHISTLEWOOD_AGENT.
const AGENT_BINDINGS: Record<string, string> = {
  whistlewood: "FLUE_WHISTLEWOOD_AGENT",
};

type ModelStub = { setModel(model: string): Promise<void> };
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
  if (c.req.method === "POST" && isAllowedModel(requested)) {
    const name = c.req.param("name") ?? "";
    const bindingName = AGENT_BINDINGS[name];
    const ns = bindingName
      ? (c.env as unknown as Env)[bindingName]
      : undefined;
    const id = c.req.param("id");
    if (ns && id) {
      try {
        const stub = ns.get(ns.idFromName(id)) as unknown as ModelStub;
        await stub.setModel(requested);
      } catch {
        /* keep the stored / default model */
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
