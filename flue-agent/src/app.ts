import { observe, setProvider } from "@flue/runtime";
import { createAgentRouter } from "@flue/runtime/routing";
import { createProvider } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { cerebrasProvider } from "@earendil-works/pi-ai/providers/cerebras";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { Hono, type MiddlewareHandler } from "hono";
import { Whistlewood } from "./agents/whistlewood.js";
import { verifyProxyUser, proxySecret, PROXY_HEADER } from "./lib/proxy-auth.js";
import { decodeInstanceId } from "./lib/instance-id.js";
import { createApi } from "./lib/api.js";
import { isAllowedModel } from "./lib/models.js";
import { isPlausibleFalKey } from "./lib/fal-key.js";
import { isPlausibleAtlasKey } from "./lib/atlas-key.js";
import { parseRenderPrefs, type RenderPrefs } from "./lib/render-prefs.js";
import { isPlausibleSearchKey } from "./lib/search-prefs.js";
import { installWorkersAiOutputCap } from "./lib/output-cap.js";

// Give every Workers AI completion an explicit output-token budget — without
// it the endpoint's tiny default cap silently clips long responses (a
// subagent's outline, a long draft) with finish_reason "length". A plain
// top-level call: an app.ts setProvider() beats the generated entry's own
// registration whatever the module order. See lib/output-cap.ts.
installWorkersAiOutputCap();

// --- Observability -----------------------------------------------------------
// Surface agent failures to Cloudflare Workers Logs (wrangler.jsonc enables
// `observability`, so these land in the dashboard's Logs tab and `wrangler
// tail`). Without this, a failed run ("agent error" in the chat panel) left no
// trace on this worker — the flue runtime emits the failure via observe() but
// nothing consumed it. We log every error-ish event with enough correlation
// (instanceId → userId~projectId~chatId, submissionId, operationKind) to find
// the run.
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

// --- Suggestion cards: retire the ones whose work just landed -----------------
// The Home deck's cards ("Continue building your story") are derived from the
// pipeline, so one disappears the moment its gap closes — and the author, who
// tapped it twenty minutes ago and came back to look, is shown nothing at all
// where the thing they started used to be. The worker keeps a ledger so a
// started card retires VISIBLY instead, badged Completed
// (worker/src/routes/suggestions.js).
//
// This is the trigger: EVERY SUBMISSION THAT SETTLES COMPLETED, off the
// runtime's own lifecycle event rather than a tool the model has to remember to
// call. (`run_end` used to carry this; run-scoped events went away with
// workflows, and `submission_settled` is the documented replacement — it is the
// terminal outcome of every submission, which is exactly what the sweep wants.)
// The sweep itself makes no judgement — the worker re-derives the digest and
// flips the started cards whose gaps are now closed — so a run that CLAIMS to
// have boarded the episode can't mark that card done, and a run that quietly
// finished something gets the credit anyway.
//
// Fire-and-forget: observe() callbacks are not awaited (flue's own guidance is
// to keep them light), and this is a DO isolate that may be cut off before an
// unawaited fetch lands. That's tolerable BECAUSE it isn't the only caller —
// the landing screen sweeps too, on the same route, when it loads the deck. The
// hook is what makes the flip land within a second of the run, over SSE, while
// the author is still looking; the client call is what guarantees it eventually.
async function sweepSuggestions(instanceId: string | undefined): Promise<void> {
  const decoded = decodeInstanceId(instanceId);
  if (!decoded?.projectId) return;
  const api = createApi(decoded.projectId, decoded.userId, decoded.chatId, decoded.episodeId);
  const { completed } = await api.post<{ completed?: string[] }>(
    "/api/suggestions/reconcile",
  );
  if (completed?.length) {
    console.log("[flue] suggestions completed", { instanceId, cards: completed });
  }
}

observe((event) => {
  // Correlation fields ride on every decoded event (optional per variant).
  // Run-scoped events went away with workflows: `runId` is now `instanceId`
  // (the conversation) plus `submissionId` (one submission, dispatched or
  // direct), and `run_start`/`run_end` are `agent_start`/`agent_end`.
  const scope = {
    instanceId: event.instanceId,
    submissionId: event.submissionId,
    agent: event.agentName,
  };
  switch (event.type) {
    case "submission_settled":
      if (event.outcome !== "completed") {
        console.error("[flue] submission " + event.outcome, {
          ...scope,
          error: event.error?.message,
          type: event.error?.type,
          details: event.error?.details,
        });
        // A failed submission finished nothing, and the sweep would only re-read
        // the same open gaps. Skip it.
        break;
      }
      // Errors are swallowed rather than thrown: a sweep that fails must not
      // turn a run that SUCCEEDED into a rejected observer promise in the logs.
      void sweepSuggestions(event.instanceId).catch((err) => {
        console.warn("[flue] suggestion sweep failed", {
          ...scope,
          error: errText(err),
        });
      });
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
// The user's own fal.ai / Atlas Cloud keys ride the same way (localStorage-only
// BYOK — see src/lib/falKey.js / atlasKey.js in the SPA). Persisted per
// conversation via setFalKey / setAtlasKey so the fal_* / atlas_* render tools
// can use them mid-run; never stored in a database.
const FAL_KEY_HEADER = "x-flue-fal-key";
const ATLAS_KEY_HEADER = "x-flue-atlas-key";
// The Settings provider toggles: the ACTIVE render provider and the disabled
// list (CSV, sent even when empty so re-enabling overwrites the stored list).
// Persisted via setRenderPrefs; whistlewood.ts drops disabled providers' tools
// and steers the agent toward the active one.
const PROVIDER_HEADER = "x-flue-render-provider";
const DISABLED_HEADER = "x-flue-disabled-providers";
// Whether the selected provider actually has its credential (the browser knows;
// see src/lib/providerReady.js). "1" ready, "0" not — an absent header is
// treated as ready. Persisted with the render prefs; whistlewood.ts uses it to
// draw a "connect a provider" card instead of a failed render.
const RENDER_READY_HEADER = "x-flue-render-ready";
// Settings › Web search: the DEFAULT search backend plus the user's BYOK keys
// for each (same localStorage-only model as the render keys). Persisted via
// setSearchPrefs; whistlewood.ts loads exactly one backend's web_search /
// fetch_url tools from them.
const SEARCH_PROVIDER_HEADER = "x-flue-search-provider";
const EXA_KEY_HEADER = "x-flue-exa-key";
const FIRECRAWL_KEY_HEADER = "x-flue-firecrawl-key";
// Settings › Sandbox: "memory" (default) or "daytona". Persisted via
// setSandboxMode; whistlewood.ts only spins up a real container for a
// conversation that asked for one — see lib/sandbox-prefs.ts.
const SANDBOX_HEADER = "x-flue-sandbox";

// Generated Durable Object binding for the agent. Derived from its identity:
// `Whistlewood.agentName = "whistlewood"` -> class FlueWhistlewoodAgent ->
// env.FLUE_WHISTLEWOOD_AGENT (also the name wrangler.jsonc's migration declares).
const WHISTLEWOOD_BINDING = "FLUE_WHISTLEWOOD_AGENT";

type ModelStub = {
  setModel(model: string): Promise<void>;
  setFalKey(key: string): Promise<void>;
  setAtlasKey(key: string): Promise<void>;
  setRenderPrefs(prefs: RenderPrefs): Promise<void>;
  setSearchPrefs(prefs: {
    provider?: string;
    exaKey?: string;
    firecrawlKey?: string;
  }): Promise<void>;
  setSandboxMode(mode: string): Promise<void>;
};
type Env = Record<string, DurableObjectNamespace | undefined>;

// --- provider overrides ------------------------------------------------------
//
// flue 2 has no provider-registration schema of its own: a provider is a Pi
// object, registered with setProvider() and keyed by its id, and a registration
// here always wins over the generated entry's built-in one. So "patch a built-in
// with a different baseUrl" becomes "register a provider under the built-in's id
// that reuses its catalog and auth, with the models re-pointed at the gateway".
function gatewayOverride(
  base: ReturnType<typeof anthropicProvider> | ReturnType<typeof cerebrasProvider>,
  baseUrl: string,
  api: Parameters<typeof createProvider>[0]["api"],
): void {
  setProvider(
    createProvider({
      id: base.id,
      name: base.name,
      // The built-in's own credential resolution, unchanged — which is what
      // reading the provider's API key from the environment always was.
      auth: base.auth,
      models: base.getModels().map((model) => ({ ...model, baseUrl })),
      api,
    }),
  );
}

// Route the built-in `anthropic/*` provider through Cloudflare AI Gateway
// (caching / logging / rate limiting) when a gateway URL is configured, while
// keeping clean `anthropic/claude-sonnet-5` specifiers everywhere. Falls back to
// calling Anthropic directly when ANTHROPIC_GATEWAY_URL is unset.
if (process.env.ANTHROPIC_GATEWAY_URL) {
  gatewayOverride(
    anthropicProvider(),
    process.env.ANTHROPIC_GATEWAY_URL,
    anthropicMessagesApi(),
  );
}

// Route the built-in `cerebras/*` provider (a pi-ai catalog provider,
// openai-completions wire) through Cloudflare AI Gateway when CEREBRAS_GATEWAY_URL
// is configured — same override pattern as anthropic above, and it keeps clean
// `cerebras/gemma-4-31b` specifiers everywhere. CEREBRAS_GATEWAY_URL is the CF AI
// Gateway Cerebras endpoint, e.g.
//   https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway_id>/cerebras
// The catalog default baseUrl (https://api.cerebras.ai/v1) is used when unset, so
// setting only CEREBRAS_API_KEY still works (direct, no gateway). The key is
// required for any cerebras/* turn; without it that turn errors.
//
// Registered UNCONDITIONALLY (like openrouter below), because it also PINS a
// model the catalog doesn't ship: `qwen-3.8-27b`, the studio's default Film
// writer (worker AUTO_WRITER=cerebras), which a Deep Film's writers' room reads
// on when the author left the writer on the default (lib/models.ts ROOM_MODELS).
// It is cloned from the catalog's gemma-4-31b entry (same wire, same limits).
{
  const base = cerebrasProvider();
  const baseUrl = process.env.CEREBRAS_GATEWAY_URL || "https://api.cerebras.ai/v1";
  const models = base.getModels().map((model) => ({ ...model, baseUrl }));
  const template = models.find((m) => m.id === "gemma-4-31b") ?? models[0];
  if (template && !models.some((m) => m.id === "qwen-3.8-27b")) {
    models.push({ ...template, id: "qwen-3.8-27b", name: "Qwen 3.8 27B" });
  }
  setProvider(
    createProvider({ id: base.id, name: base.name, auth: base.auth, models, api: openAICompletionsApi() }),
  );
}

// Route the built-in `openrouter/*` provider (OpenAI-compatible wire) through
// Cloudflare AI Gateway when OPENROUTER_GATEWAY_URL is set — same override
// pattern as cerebras/anthropic above, keeping clean `openrouter/…` specifiers.
// OPENROUTER_GATEWAY_URL is the CF AI Gateway OpenRouter endpoint, e.g.
//   https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway_id>/openrouter
// The gateway forwards OPENROUTER_API_KEY (the provider's own env auth) to
// OpenRouter as the Bearer token. With the gateway URL unset the catalog default
// (https://openrouter.ai/api/v1) is used — direct, no gateway — so setting only
// OPENROUTER_API_KEY still works. The key is required for any openrouter/* turn;
// without it that turn errors — it does NOT wedge, because the specifier still
// resolves (a missing key is a normal terminal error, an UNRESOLVABLE specifier
// is what wedges a conversation forever; see lib/models.ts).
//
// Registered UNCONDITIONALLY (unlike the cerebras/anthropic blocks, which only
// override an already-registered built-in) so the selectable specifier always
// resolves in the catalog. We also PIN the exact snapshot the picker offers: the
// pi-ai catalog ships the rolling `deepseek/deepseek-v4-pro`, and OpenRouter also
// serves the dated `deepseek-v4-pro-0813` build — we add that as its own model
// (cloned from the rolling entry) so `openrouter/deepseek/deepseek-v4-pro-0813`
// resolves regardless of what the pinned catalog version happens to carry.
{
  const base = openrouterProvider();
  const baseUrl =
    process.env.OPENROUTER_GATEWAY_URL || base.baseUrl || "https://openrouter.ai/api/v1";
  const models = base.getModels().map((model) => ({ ...model, baseUrl }));
  const rolling = models.find((m) => m.id === "deepseek/deepseek-v4-pro");
  if (rolling) {
    models.push({
      ...rolling,
      id: "deepseek/deepseek-v4-pro-0813",
      name: "DeepSeek: DeepSeek V4 Pro (0813)",
    });
  }
  setProvider(
    createProvider({
      id: base.id,
      name: base.name,
      // The built-in's own credential resolution (OPENROUTER_API_KEY), unchanged.
      auth: base.auth,
      models,
      api: openAICompletionsApi(),
    }),
  );
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
// before `next()` hands off to flue's admission, guarantees the agent render
// reads the fresh model for this turn. Best-effort: a set failure must never
// block the send (it just keeps the previously stored / default model). The
// model is whitelisted so a client can't select an arbitrary one.
const applyModelSelection: MiddlewareHandler = async (c, next) => {
  const requested = c.req.header(MODEL_HEADER);
  const falKey = c.req.header(FAL_KEY_HEADER);
  const atlasKey = c.req.header(ATLAS_KEY_HEADER);
  const provider = c.req.header(PROVIDER_HEADER);
  const disabledCsv = c.req.header(DISABLED_HEADER);
  const renderReady = c.req.header(RENDER_READY_HEADER);
  const searchProvider = c.req.header(SEARCH_PROVIDER_HEADER);
  const exaKey = c.req.header(EXA_KEY_HEADER);
  const firecrawlKey = c.req.header(FIRECRAWL_KEY_HEADER);
  const sandboxMode = c.req.header(SANDBOX_HEADER);
  const wantModel = isAllowedModel(requested);
  const wantFalKey = isPlausibleFalKey(falKey);
  const wantAtlasKey = isPlausibleAtlasKey(atlasKey);
  const wantPrefs =
    provider !== undefined || disabledCsv !== undefined || renderReady !== undefined;
  // Any of the three search headers being present is enough — the DO merges
  // them over what's stored, so a partial set never clobbers the rest.
  const wantSearch =
    searchProvider !== undefined || exaKey !== undefined || firecrawlKey !== undefined;
  // Absent header leaves the stored mode alone, so an older client (or the
  // mobile app before it ships the toggle) never silently flips a conversation.
  const wantSandbox = sandboxMode !== undefined;
  if (
    c.req.method === "POST" &&
    (wantModel || wantFalKey || wantAtlasKey || wantPrefs || wantSearch || wantSandbox)
  ) {
    // The mount is per-agent now, so there is no `:name` param to read — this
    // middleware only ever ran on the one binding it names here.
    const ns = (c.env as unknown as Env)[WHISTLEWOOD_BINDING];
    const id = c.req.param("id");
    if (ns && id) {
      try {
        const stub = ns.get(ns.idFromName(id)) as unknown as ModelStub;
        if (wantModel) await stub.setModel(requested as string);
        // Refresh the conversation's BYOK keys each send (absent header
        // leaves the stored key alone, so other clients keep working).
        if (wantFalKey) await stub.setFalKey(falKey as string);
        if (wantAtlasKey) await stub.setAtlasKey(atlasKey as string);
        // Provider prefs are validated in parseRenderPrefs (unknown ids drop).
        if (wantPrefs) await stub.setRenderPrefs(parseRenderPrefs(provider, disabledCsv, renderReady));
        // Search prefs: only forward fields that were actually sent, and only
        // key values that look like keys — an empty/garbage header is a CLEAR
        // (Settings' Remove button), while an absent one leaves the stored key
        // untouched. The provider id is whitelisted DO-side.
        if (wantSearch) {
          await stub.setSearchPrefs({
            ...(searchProvider !== undefined ? { provider: searchProvider } : {}),
            ...(exaKey !== undefined
              ? { exaKey: isPlausibleSearchKey(exaKey) ? exaKey : "" }
              : {}),
            ...(firecrawlKey !== undefined
              ? { firecrawlKey: isPlausibleSearchKey(firecrawlKey) ? firecrawlKey : "" }
              : {}),
          });
        }
        // Unknown values fall back to "memory" DO-side, so a client can never
        // push a conversation onto an unexpected (paid) backend.
        if (wantSandbox) await stub.setSandboxMode(sandboxMode as string);
      } catch {
        /* keep the stored / default model + keys */
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
    providers: {
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      cerebras: Boolean(process.env.CEREBRAS_API_KEY),
      openrouter: Boolean(process.env.OPENROUTER_API_KEY),
    },
    // Operator-side search keys. Reported (as booleans — never the key) so
    // Settings can tell the user a backend already works without their own key.
    search: {
      exa: Boolean(process.env.EXA_API_KEY),
      firecrawl: Boolean(process.env.FIRECRAWL_API_KEY),
    },
  }),
);
// The auto-router is gone: every route is mounted explicitly, so the middleware
// paths lose their `:name` param and name the one agent instead. The URL shape
// is UNCHANGED — createAgentRouter serves `POST /:id`, `GET|HEAD /:id`,
// `POST /:id/abort` and `GET /:id/attachments/:attachmentId` relative to the
// mount, which is the same four surfaces at the same paths the clients and the
// /eve proxy already address.
app.use("/agents/whistlewood/:id", requireProxyUser);
app.use("/agents/whistlewood/:id/*", requireProxyUser);
app.use("/agents/whistlewood/:id", applyModelSelection);

app.route("/agents/whistlewood", createAgentRouter(Whistlewood));

// --- The Deep Film's writers' room -------------------------------------------
// The main worker's Film job starts the room here and asks after it; the work
// itself is WritersRoomWorkflow (cloudflare.ts). Same credential as a chat: the
// worker-minted `x-flue-proxy-user` token, whose user must be the Film's owner
// named in the body — the workflow then acts as that user on /api.
type WorkflowBinding = {
  create(opts: { id: string; params: unknown }): Promise<{ id: string; status(): Promise<unknown> }>;
  get(id: string): Promise<{ id: string; status(): Promise<unknown> }>;
};
const ROOM_BINDING = "WRITERS_ROOM";
const ROOM_ID = /^room-[A-Za-z0-9_-]{1,90}$/;

const requireRoomUser: MiddlewareHandler = async (c, next) => {
  const secret = proxySecret();
  if (!secret) return c.json({ error: "server misconfigured" }, 500);
  const claims = await verifyProxyUser(c.req.header(PROXY_HEADER), secret);
  if (!claims) return c.json({ error: "Unauthorized" }, 401);
  if (!ROOM_ID.test(c.req.param("id") || "")) return c.json({ error: "Bad room id" }, 400);
  c.set("roomUser" as never, claims.sub as never);
  await next();
};
const roomBinding = (c: { env: unknown }) =>
  (c.env as Record<string, WorkflowBinding | undefined>)[ROOM_BINDING];

app.use("/rooms/:id", requireRoomUser);

app.post("/rooms/:id", async (c) => {
  const wf = roomBinding(c);
  if (!wf) return c.json({ error: "The writers' room workflow is not bound on this worker." }, 500);
  const body = (await c.req.json().catch(() => null)) as
    | { filmId?: string; projectId?: string; userId?: string; rounds?: unknown[]; brief?: string; episodeId?: string | null }
    | null;
  if (!body?.filmId || !body.projectId || !Array.isArray(body.rounds) || !body.rounds.length) {
    return c.json({ error: "A room needs filmId, projectId and rounds." }, 400);
  }
  if (body.userId !== c.get("roomUser" as never)) return c.json({ error: "Forbidden" }, 403);
  const id = c.req.param("id");
  try {
    const instance = await wf.create({ id, params: { ...body, brief: String(body.brief || "") } });
    return c.json({ instanceId: instance.id, status: await instance.status() }, 201);
  } catch (err) {
    // Already started (a Film step re-run after an eviction): attach to it.
    const existing = await wf.get(id).catch(() => null);
    if (existing) return c.json({ instanceId: existing.id, status: await existing.status(), existing: true });
    return c.json({ error: String((err as Error)?.message || err) }, 500);
  }
});

app.get("/rooms/:id", async (c) => {
  const wf = roomBinding(c);
  if (!wf) return c.json({ error: "The writers' room workflow is not bound on this worker." }, 500);
  try {
    const instance = await wf.get(c.req.param("id"));
    const status = (await instance.status()) as Record<string, unknown>;
    return c.json({ instanceId: instance.id, ...status });
  } catch (err) {
    return c.json({ error: String((err as Error)?.message || err) }, 404);
  }
});

// --- Every Film's Script flow -------------------------------------------------
// Same shape and credential as the room: the Film's Script stage starts
// FilmScriptWorkflow (cloudflare.ts) here and asks after it.
const SCRIPT_BINDING = "FILM_SCRIPT";
const SCRIPT_ID = /^script-[A-Za-z0-9_-]{1,90}$/;
const scriptBinding = (c: { env: unknown }) =>
  (c.env as Record<string, WorkflowBinding | undefined>)[SCRIPT_BINDING];

app.use("/scripts/:id", async (c, next) => {
  const secret = proxySecret();
  if (!secret) return c.json({ error: "server misconfigured" }, 500);
  const claims = await verifyProxyUser(c.req.header(PROXY_HEADER), secret);
  if (!claims) return c.json({ error: "Unauthorized" }, 401);
  if (!SCRIPT_ID.test(c.req.param("id") || "")) return c.json({ error: "Bad script id" }, 400);
  c.set("roomUser" as never, claims.sub as never);
  await next();
});

app.post("/scripts/:id", async (c) => {
  const wf = scriptBinding(c);
  if (!wf) return c.json({ error: "The script workflow is not bound on this worker." }, 500);
  const body = (await c.req.json().catch(() => null)) as
    | { filmId?: string; projectId?: string; userId?: string; episodeId?: string | null }
    | null;
  if (!body?.filmId || !body.projectId) return c.json({ error: "A script flow needs filmId and projectId." }, 400);
  if (body.userId !== c.get("roomUser" as never)) return c.json({ error: "Forbidden" }, 403);
  const id = c.req.param("id");
  try {
    const instance = await wf.create({ id, params: body });
    return c.json({ instanceId: instance.id, status: await instance.status() }, 201);
  } catch (err) {
    const existing = await wf.get(id).catch(() => null);
    if (existing) return c.json({ instanceId: existing.id, status: await existing.status(), existing: true });
    return c.json({ error: String((err as Error)?.message || err) }, 500);
  }
});

app.get("/scripts/:id", async (c) => {
  const wf = scriptBinding(c);
  if (!wf) return c.json({ error: "The script workflow is not bound on this worker." }, 500);
  try {
    const instance = await wf.get(c.req.param("id"));
    const status = (await instance.status()) as Record<string, unknown>;
    return c.json({ instanceId: instance.id, ...status });
  } catch (err) {
    return c.json({ error: String((err as Error)?.message || err) }, 404);
  }
});

export default app;
