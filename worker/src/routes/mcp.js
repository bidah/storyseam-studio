// POST /api/mcp — shot-studio's pipeline exposed as an MCP (Model Context
// Protocol) server, so Claude Desktop / Claude Code / Cursor can read and drive
// an episode from wherever the author already is.
//
// WHY a fourth surface. CLAUDE.md's parity rule says a capability ships as a
// worker route, a GUI surface, and a flue tool. This is none of those: it is
// those same capabilities re-pointed at an EXTERNAL client that brings its own
// model and its own conversation. The flue agent is the in-app assistant — it
// owns the skills, the render pipeline, and the project context. MCP is for the
// author who is already in an editor, wants the shot list in THAT conversation,
// and would otherwise be tab-switching. It deliberately exposes a small, mostly
// read-only slice; anything that spends money or runs ffmpeg stays behind flue,
// where the skill playbooks that make those flows safe actually live.
//
// WHY it calls the route helpers instead of fetching its own worker. A tool's
// `run` gets `c`, so `app.fetch("/api/world")` would work — and would be wrong:
// it re-enters the middleware stack (project resolution, ownership, the
// post-mutation firehose) from inside a request that already ran it, doubling
// the broadcast and re-resolving the project against a session this caller does
// not have. Each `run` instead calls the SAME exported helper the GUI route
// calls (`buildStatus`, `buildWorldView`, `saveShotlist`, …). That is why those
// helpers were extracted: a second copy of, say, the shot-list save would skip
// `preserveIds` and silently orphan every storyboard still keyed to a shot id.
// If you add a tool here and find the logic inlined in a route handler, export
// it from that route file — do not paste it.
//
// WHY it does its own auth, and does not trust `c.get("projectId")`.
// The /api middleware is built for a browser carrying a Better Auth cookie: an
// anonymous caller is tolerated (reads fall through, writes 400), and the
// project id falls back to whatever "active project" row it can find. Both are
// fine behind a login page and both are holes on an endpoint reachable from the
// public internet. So this route:
//   1. requires `Authorization: Bearer <MCP_TOKEN>` (constant-time), and
//   2. requires an EXPLICIT project — read straight off the request rather than
//      from `c.get("projectId")`, because that getter can hand back an
//      anonymous "active project" fallback, and `normalizeProjectId(null)`
//      resolves to `p_default`, which is a REAL project (Whistlewood). An
//      unscoped write there is not a no-op; it lands in somebody's episode.
// The project is also checked against the `projects` table, so a typo'd id
// fails loudly instead of quietly minting doc rows in an empty namespace.
//
// WIRE PROTOCOL. MCP "Streamable HTTP", JSON only: one JSON-RPC 2.0 message per
// POST, one JSON response back. No SSE — nothing here streams, and a client that
// asks for `text/event-stream` is happy with a plain JSON response. No JSON-RPC
// batching either: the 2025-06-18 revision removed it, so an array body is an
// invalid request rather than something to loop over. A NOTIFICATION (a message
// with no `id`) must produce no response body at all — HTTP 202 with an empty
// body is the correct answer, and returning a JSON-RPC result to one is the
// classic way to make a strict client hang up.
//
// FAILURE-MODE NOTE. A tool that throws is NOT a protocol error: it comes back
// as a normal result with `isError: true` so the model can read the message and
// correct itself, exactly like flue's tool errors. Protocol errors (-32601 and
// friends) are reserved for messages the server could not dispatch at all.
//
// WIRING (two lines in worker/src/index.js, besides `registerMcp(app)`), both
// because EVERY MCP message is a POST — reads included — and the middleware
// stack there reasons about POSTs as mutations:
//
//   1. Exempt `/api/mcp` from the "no active project" write guard, the way
//      `/api/extract` already is. Otherwise a client that hasn't been given a
//      project yet gets a bare 400 on `initialize` and never completes the
//      handshake — so it can never surface the message telling the user to add
//      `?projectId=`. Scoping is enforced here instead, per tool call, and more
//      strictly (no fallback, and the project must exist).
//   2. Skip `/api/mcp` in the post-mutation live-sync firehose, alongside
//      `/api/chat-title`. Left in, every `get_status` from an editor would
//      announce a data change and churn every open tab. The write tools
//      announce for themselves (`announce()` below), so nothing is lost.
import { buildStatus } from "./status.js";
import { buildWorldView } from "./world.js";
import { buildScriptView } from "./script.js";
import { buildShotlistView, saveShotlist } from "./shotlist.js";
import { toJsonSchema } from "../lib/validate.js";
import shotlistSchema from "../schemas/shotlist.json";
import { buildEpisodeView } from "./episode.js";
import { buildCutsView } from "./cuts.js";
import { listDocHistory, restoreDocVersion } from "./history.js";
import { broadcast } from "../lib/broadcast.js";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "shot-studio", version: "1" };

// Documents that carry version history, mirroring flue's list_history picklist.
// A closed list because these are the names an author would ever ask to roll
// back; `/api/history` (unlisted here) is the discovery endpoint if that stops
// being true.
const HISTORY_DOCS = [
  "world", "shotlist", "sounds", "selections", "episode-manifest",
  "visual-world", "radio", "stills", "script",
];

// --- auth -------------------------------------------------------------------

// Constant-time secret comparison. Both sides are hashed to a fixed 32 bytes
// FIRST, so the loop below can't leak the token's length the way a bare
// `a === b` (or a length check) does — with the digests equal-length, comparing
// every byte and OR-ing the differences takes the same time whether the first
// byte differs or the last one does.
async function secretsMatch(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function authorized(c) {
  // An unset MCP_TOKEN closes the endpoint rather than opening it. The opposite
  // default — "no token configured, so skip the check" — turns every deploy that
  // forgets the secret into an unauthenticated write API.
  const expected = c.env.MCP_TOKEN;
  if (!expected) return false;
  const header = c.req.header("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return false;
  return await secretsMatch(m[1], expected);
}

// --- project scoping --------------------------------------------------------

// The explicitly-named project, verified to exist. Never falls back: see the
// header note about `p_default` being a real project.
async function resolveProject(c) {
  const named = (c.req.header("x-project-id") || c.req.query("projectId") || "").trim();
  if (!named) {
    return {
      error:
        "No project selected. Pass the project id as ?projectId=<id> on the MCP endpoint URL, or as an x-project-id header. There is no default — see /api/projects for the list.",
    };
  }
  const row = await c.env.DB.prepare(
    "SELECT id FROM projects WHERE id = ? AND archived = 0",
  ).bind(named).first();
  if (!row) return { error: `No such project "${named}". List them with GET /api/projects.` };
  return { pid: row.id };
}

// --- tool catalog -----------------------------------------------------------
//
// One entry per tool: `{ name, description, inputSchema, run(c, args) }`.
// `inputSchema` is JSON Schema (what MCP puts on the wire — no zod/valibot
// here), and `run` returns any JSON-serializable value; the dispatcher wraps it.
// Descriptions are lifted from the equivalent flue tools on purpose: they are
// the prose that has already been tuned against a model, and two different
// descriptions for the same capability is how the two surfaces drift apart.

const NO_INPUT = { type: "object", properties: {}, additionalProperties: false };


const TOOLS = [
  {
    name: "get_status",
    description:
      "Where the episode stands right now — one compact digest of the WHOLE pipeline, counts and flags only (no content). Call this first for 'what's the status', 'where are we', 'what should I do next', or before proposing a next step, instead of fetching every section. Returns { stage, world, script, visualWorld, shotlist, storyboard, radio, sounds, episode, cuts }: `stage` is the single word for what's blocking progress (\"world\" | \"script\" | \"visual\" | \"shots\" | \"board\" | \"voice\" | \"render\" | \"cut\" | \"done\"); `world` has map/depth filled-vs-total plus which fields are `missing` and which characters/locations are `missingSheet`/`missingVoice`; `script` has lines, drafts, signed, hasProposal and `reviews` — which specialists have read this revision, bucketed { pending, stale, fresh }; `storyboard` has withStill vs shots and the `missing` shot numbers; `radio` has voiced vs lines. It is a summary — use get_world / get_script / get_shotlist when you need the actual content.",
    inputSchema: NO_INPUT,
    run: (c) => buildStatus(c.env, c.get("mcpProjectId")),
  },
  {
    name: "get_world",
    description:
      "Read the World bible from the World tab — the series' foundational world. Returns { title, logline, map, depth, characters, locations }. `map` is the 5 shaping questions { world, protagonist, antagonist, stakes, theme }; `depth` is the core story elements { premise, wantVsNeed, conflict, obstacles, structure }; `characters` is the roster, each { id, name, archetype, role, want, need, traits, arc, voice, appearance, sheetImage, voiceRef }. `sheetImage` is the linked character-sheet image ({ rel, url, thumb, name, refUrl } or null — `refUrl` is an absolute https URL any fetcher can pull; `url` is a project-scoped relative path that needs the project header) and `voiceRef` is the attached voice ({ trackId, v, name, url } or null).",
    inputSchema: NO_INPUT,
    run: (c) => buildWorldView(c.env, c.get("mcpProjectId")),
  },
  {
    name: "get_script",
    description:
      "Read the current screenplay from the Script tab. Reads the PINNED draft — the single active version the editor and all script edits operate on. Returns the title, the TipTap document, the pinned draft name, the list of drafts, whether the draft is signed off, whether an agent edit proposal is pending, and which script specialists have reviewed this revision. Use before discussing edits so you know what is already written.",
    inputSchema: NO_INPUT,
    run: (c) => buildScriptView(c.env, c.get("mcpProjectId")),
  },
  {
    name: "get_shotlist",
    description:
      "Read the granular per-shot Shot list (the flat list of every ~2-3s shot, before packing into <=15s multishots). Each shot has { n, id, beat, beatTitle, dur, location, characters, camera, action, dialogue, audioSync, prompt } where `prompt` is the Seedance prompt. Also returns `packs`: the live <=15s multishot grouping (how the shots compound into MS-01, MS-02 …). ALWAYS call this before save_shotlist so you don't clobber existing shots or invent new ids for them.",
    inputSchema: NO_INPUT,
    run: (c) => buildShotlistView(c.env, c.get("mcpProjectId")),
  },
  {
    name: "get_episode",
    description:
      "Get the episode plan: the multishot bundles (MS-01 …) packed from the shot list, their rendered video generations, per-bundle prompt overrides, sign-off state, chosen first frames and style-reference videos, the per-bundle scene-needs checklist (which image and voice references are still missing before a bundle can render), and the voice/sound reference pool plus each bundle's attached voice picks (with agent-fetchable refUrls). Returns { episode: null } when no plan has been built yet. This is the full plan, so it is a large payload — use get_status first if you only need to know how far along the renders are.",
    inputSchema: NO_INPUT,
    run: (c) => buildEpisodeView(c.env, c.get("mcpProjectId")),
  },
  {
    name: "get_cuts",
    description:
      "Get the ordered stitch plan: the selected take of each bundle in order, with per-segment durations and timecodes, the background-music layout, the current complete-cut output (if any), and the full version history of stitched and scored cuts. Use it to see what a stitch would assemble, and to find the newest rendered cut.",
    inputSchema: NO_INPUT,
    run: (c) => buildCutsView(c.env, c.get("mcpProjectId")),
  },
  {
    name: "save_shotlist",
    description:
      'Write the Shot list (the granular per-shot breakdown that auto-packs into <=15s multishot bundles). Two modes via `mode`: "replace" (default) OVERWRITES all shots; "append" adds `shots` to the END of the current list. For a full episode, DO NOT emit the whole list in one "replace" call — build it beat by beat: call once with mode "replace" carrying only the FIRST beat, then again with mode "append" for each subsequent beat. Each call is bounded and the list is durably saved after every batch. ALWAYS carry each existing shot\'s `id` through unchanged: shot ids key generated media that lives elsewhere (storyboard stills, the animatic\'s picture track), so inventing new ids for existing shots orphans that media. Only omit `id` for a genuinely NEW shot. Each shot\'s `beat`/`beatTitle` and `location` drive the packing (a bundle never crosses a beat or location and never exceeds 15s), so keep consecutive same-location shots grouped and give a realistic `dur`. Returns the shot count (running total), the write mode, how many ids were preserved vs auto-numbered, any warnings, `newSpeakers` (speaking characters with no World roster record yet), and the resulting <=15s pack preview.',
    // Derived from the SHARED contract (shared/schemas/shotlist.json, vendored
    // into src/schemas/) — the same file POST /api/shotlist validates against and
    // the flue tool builds its valibot input from. Hand-writing a third copy of
    // this shape in JSON Schema is exactly the drift the contract exists to stop:
    // it would go stale the first time a shot field changed, and the only symptom
    // would be an MCP client sending something the route rejects.
    inputSchema: toJsonSchema(shotlistSchema.input),
    run: async (c, args) => {
      const pid = c.get("mcpProjectId");
      const res = await saveShotlist(c.env, pid, {
        shots: args.shots,
        source: args.source || "mcp",
        mode: args.mode || "replace",
      });
      if (res.error) throw new Error(res.error);
      announce(c, pid, "shotlist");
      return res;
    },
  },
  {
    name: "list_history",
    description:
      'List the saved earlier versions of a project document (the World bible, shot list, sounds, …). Every save parks the version it replaced, so this is the way back when something was overwritten or blanked. Returns { name, snapshots: [{ ts, at, size, source, generatedAt }] }, newest first — `ts` is the id you pass to restore_version, `source` says who wrote that version ("agent", "app", "mcp", …), and a sudden drop in `size` is the fingerprint of a bad partial save. Use this whenever the author says content went missing, was lost, disappeared, or looks wrong — check here BEFORE offering to rewrite it from scratch.',
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          enum: HISTORY_DOCS,
          description:
            'Which document\'s history to read — e.g. "world" for the World bible, "shotlist" for the shot list.',
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
    run: async (c, args) => {
      const res = await listDocHistory(c.env, c.get("mcpProjectId"), args.name);
      if (res.error) throw new Error(res.error);
      return res;
    },
  },
  {
    name: "restore_version",
    description:
      "Put a saved earlier version of a project document back (get `ts` from list_history). This is safe and reversible: restoring saves the CURRENT version to history first, so you can always restore back to it. Use it to undo a bad overwrite rather than retyping content from memory — a restore returns the author's real words, a rewrite only approximates them. ALWAYS tell the author which version (its timestamp and source) you restored, and never restore without saying so first.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", enum: HISTORY_DOCS, description: "Which document to restore." },
        ts: {
          type: "string",
          description: 'The version id from list_history, e.g. "2026-07-22T21-56-31-995Z".',
        },
      },
      required: ["name", "ts"],
      additionalProperties: false,
    },
    run: async (c, args) => {
      const pid = c.get("mcpProjectId");
      const res = await restoreDocVersion(c.env, pid, args.name, args.ts);
      if (res.error) throw new Error(res.error);
      announce(c, pid, args.name);
      return res;
    },
  },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// Tell open tabs a write landed, so the Shot list / World / Episode surfaces
// refetch instead of sitting stale until someone hits Refresh.
//
// Done by hand rather than relying on index.js's post-mutation firehose,
// because that middleware fires on the HTTP method — and EVERY MCP call is a
// POST, reads included. Left to itself it would churn every open tab on each
// `get_status`. The fix on the index.js side is to skip `/api/mcp` in that
// middleware the same way `/api/chat-title` is skipped; until then the two
// simply broadcast twice for a write, which costs a duplicate revalidate and
// nothing else.
function announce(c, pid, resource) {
  broadcast(
    c.env,
    pid,
    "data",
    { path: "/api/mcp", resource, clientId: null, at: Date.now() },
    c.executionCtx,
  );
}

// --- JSON-RPC ---------------------------------------------------------------

const result = (id, value) => ({ jsonrpc: "2.0", id, result: value });
const failure = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

// A tool's payload as MCP wants it. Content is a single JSON text block: every
// client renders text, whereas `structuredContent` is only meaningful next to a
// declared `outputSchema` and strict clients validate it against one.
const toolResult = (value) => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});
const toolFailure = (message) => ({ content: [{ type: "text", text: message }], isError: true });

async function dispatch(c, msg) {
  const { id, method, params } = msg;

  switch (method) {
    case "initialize":
      // We answer with the version we implement rather than echoing the
      // client's: echoing an unsupported version is how a client ends up
      // expecting a feature (batching, elicitation) this server doesn't have.
      return result(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });

    // Base-protocol liveness check. Cheap, and clients that use it treat a
    // -32601 here as a dead server.
    case "ping":
      return result(id, {});

    case "tools/list":
      return result(id, {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });

    case "tools/call": {
      const tool = BY_NAME.get(params?.name);
      // An unknown TOOL is a tool-level error, not a protocol one: the model
      // picked a bad name and can recover by reading the message and listing
      // again. -32601 would abort the turn instead.
      if (!tool) {
        return result(
          id,
          toolFailure(`Unknown tool "${params?.name}". Available: ${TOOLS.map((t) => t.name).join(", ")}.`),
        );
      }
      try {
        return result(id, toolResult(await tool.run(c, params?.arguments || {})));
      } catch (e) {
        return result(id, toolFailure(String(e?.message || e)));
      }
    }

    default:
      return failure(id, -32601, `Method not found: ${method}`);
  }
}

export function registerMcp(app) {
  app.post("/api/mcp", async (c) => {
    if (!(await authorized(c))) {
      // 401 + WWW-Authenticate is what an MCP client needs to tell "wrong
      // token" apart from "server is broken"; the JSON-RPC envelope is there so
      // a client that only parses bodies still gets a readable reason.
      return c.json(
        failure(null, -32001, "Unauthorized — send Authorization: Bearer <MCP_TOKEN>."),
        401,
        { "www-authenticate": 'Bearer realm="shot-studio"' },
      );
    }

    let msg;
    try {
      msg = await c.req.json();
    } catch {
      return c.json(failure(null, -32700, "Parse error — body must be a JSON-RPC 2.0 message."), 400);
    }
    // JSON-RPC batching was removed in the 2025-06-18 revision, so an array is
    // simply not a message we accept.
    if (Array.isArray(msg) || !msg || typeof msg !== "object" || typeof msg.method !== "string") {
      return c.json(failure(null, -32600, "Invalid request — expected a single JSON-RPC 2.0 message object."), 400);
    }

    // A NOTIFICATION (no `id`) must get NO response body — `notifications/
    // initialized`, the handshake's last step, is the one we actually receive.
    // Answering one with a JSON-RPC result is a protocol violation that strict
    // clients drop the connection over, so bail out before anything can produce
    // a body. Nothing here reacts to a notification, so none are dispatched.
    if (msg.id === undefined || msg.id === null) return new Response(null, { status: 202 });

    // Project scoping is enforced only where it bites — on a tool call. The
    // handshake and `tools/list` stay reachable without it, so a client being
    // configured can finish initializing and actually SHOW the user the error
    // below telling them they forgot ?projectId=.
    if (msg.method === "tools/call") {
      const { pid, error } = await resolveProject(c);
      // Reported as a tool error, not a protocol error: it's the caller's
      // configuration that's wrong, and the model can surface the sentence.
      if (error) return c.json(result(msg.id, toolFailure(error)));
      // Kept under a DEDICATED key, not `projectId`: the middleware's value is
      // the one that may be an anonymous fallback, and a tool must never read
      // that by accident.
      c.set("mcpProjectId", pid);
    }

    return c.json(await dispatch(c, msg));
  });
}
