// ShotStudioMCP — the whole app exposed as a REMOTE MCP server, per user.
//
// This is the second MCP surface. The first (routes/mcp.js, POST /api/mcp) is a
// deliberately small, single-project, shared-bearer slice for a power user who
// wires one project into Claude Code / Cursor. THIS one is the "connector" a user
// turns on in Settings: OAuth per user, scoped to their WHOLE account — every
// project they own or can reach, every doc store (script, drafts, shot list,
// episodes, world, sounds, radio, cuts, library, history), plus the pipeline's
// generation steps and the flue skill playbooks as MCP prompts. An external
// agent (Claude Desktop, Claude Code, …) drives the pipeline with its own model.
//
// HOW IT REACHES DATA. It does NOT re-implement any capability. Every tool is a
// thin call to the app's own JSON API (worker/src/routes/*), dispatched through
// the SELF service binding (in-process worker→worker, wrangler.jsonc) with a
// freshly-minted `x-flue-agent-user` assertion for the OAuth'd user — exactly the
// shape flue-agent/src/lib/api.ts uses. That single detail buys everything:
//   • the app's fail-closed ownership middleware (index.js) scopes the caller to
//     their own projects, cross-project, with zero new access-control code;
//   • writes are attributed (actor=agent, caller carries through to doc_history)
//     and episode-scoped;
//   • the tool surface can never drift from the GUI, because it IS the GUI's API.
// The trade-off vs. routes/mcp.js (which calls route helpers directly) is one
// in-process hop; in return we get the middleware for free, which is the whole
// point of a per-user surface.
//
// WRITES ARE PERMISSIVELY TYPED ON PURPOSE. The MCP input schemas for write tools
// are loose (an object / array of the fields the route already validates). The
// contract that matters lives server-side (worker/src/lib/validate.js against the
// shared schemas); duplicating it here in zod is the exact drift the shared
// schemas exist to prevent. A malformed body comes back as the route's own 4xx,
// which the model reads and corrects — same failure model as a flue tool.
//
// APPROVAL / SPEND. Tools that spend render credits are labelled in their
// descriptions. We rely on the MCP CLIENT's native per-tool-call approval (every
// MCP client prompts the user before running a tool) rather than re-implementing
// the in-app two-phase approval, which needs a chat transcript round-trip that a
// remote client has no equivalent of. See docs/mcp.md.

import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mintToken, proxySecret, AGENT_HEADER, AGENT_ISSUER } from "./lib/proxy-token.js";
import { SKILL_PROMPTS } from "./mcp-prompts.js";

const SERVER_INFO = { name: "storyseam", version: "1" };

// A single JSON text block — the shape every MCP client renders. Objects are
// pretty-printed so the model (and a human reading the transcript) can scan them.
function textResult(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}

export class ShotStudioMCP extends McpAgent {
  server = new McpServer(SERVER_INFO);

  // Per-session working context. The client picks a project once (use_project)
  // and every subsequent tool operates on it; absent, the app resolves the
  // user's active project the same way the GUI does. episodeId scopes a series.
  initialState = { projectId: null, episodeId: null };

  get userId() {
    const id = this.props?.userId;
    if (!id) throw new Error("Not authenticated — reconnect the MCP connector.");
    return id;
  }

  // Call the app's own JSON API AS the signed-in user. Prefers the in-process
  // SELF service binding; falls back to a public-URL fetch in local dev, where a
  // self service binding can't resolve.
  async api(method, path, body) {
    const base = this.env.WORKER_PUBLIC_URL || "https://storyseam.app";
    const headers = new Headers();
    const secret = proxySecret(this.env);
    if (!secret) throw new Error("Server is missing FLUE_PROXY_SECRET — the MCP bridge can't authenticate.");
    headers.set(AGENT_HEADER, await mintToken(this.userId, secret, AGENT_ISSUER));
    if (this.state.projectId) headers.set("x-project-id", this.state.projectId);
    if (this.state.episodeId) headers.set("x-episode-id", this.state.episodeId);
    if (body !== undefined) headers.set("content-type", "application/json");

    const req = new Request(new URL(path, base), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const res = this.env.SELF ? await this.env.SELF.fetch(req) : await fetch(req);
    const raw = await res.text();
    let data;
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
    if (!res.ok) {
      const msg = data?.error || `${res.status} ${res.statusText}`;
      throw new Error(`${method} ${path} → ${msg}`);
    }
    return data;
  }

  get(path) { return this.api("GET", path); }
  post(path, body) { return this.api("POST", path, body ?? {}); }
  put(path, body) { return this.api("PUT", path, body ?? {}); }

  // A read tool: name + description + a zero-arg handler.
  read(name, description, path) {
    this.server.registerTool(name, { description }, async () => textResult(await this.get(path)));
  }

  async init() {
    const T = this.server;

    // ---- context / projects ------------------------------------------------
    T.registerTool(
      "list_projects",
      {
        description:
          "List every StorySeam project the signed-in user can reach (owned + team-shared), newest first. A project holds one series/episode's world bible, script, shot list, storyboard, sounds and cuts. Call this first when the user hasn't said which project to work in, then use_project to select one.",
      },
      async () => textResult(await this.get("/api/projects")),
    );

    T.registerTool(
      "use_project",
      {
        description:
          "Select which project every following tool call operates on, for the rest of this session. Pass a project id from list_projects. Until you call this, tools use the account's active project.",
        inputSchema: { projectId: z.string().describe("Project id from list_projects") },
      },
      async ({ projectId }) => {
        // Verify the id is reachable before pinning it, so a typo fails here
        // rather than on every later call.
        const projects = await this.get("/api/projects");
        const list = Array.isArray(projects) ? projects : projects?.projects || [];
        const found = list.find((p) => p.id === projectId);
        if (!found) throw new Error(`No project "${projectId}" you can access. Call list_projects.`);
        this.setState({ ...this.state, projectId, episodeId: null });
        return textResult(`Now working in "${found.name || projectId}" (${projectId}).`);
      },
    );

    T.registerTool(
      "use_episode",
      {
        description:
          "For a SERIES project, select which episode the following tools scope to (episode-scoped docs are the shot list, episodes, sounds, radio, stills, script). Pass an episode id from list_episodes, or omit to return to the default/first episode. A feature or single-episode project never needs this.",
        inputSchema: { episodeId: z.string().nullish().describe("Episode id from list_episodes, or null for the default episode") },
      },
      async ({ episodeId }) => {
        this.setState({ ...this.state, episodeId: episodeId || null });
        return textResult(episodeId ? `Scoped to episode "${episodeId}".` : "Scoped to the default episode.");
      },
    );

    T.registerTool(
      "create_project",
      {
        description: "Create a new, empty StorySeam project and return it. Does not select it — call use_project with the returned id to start working in it.",
        inputSchema: { name: z.string().describe("Display name for the project") },
      },
      async ({ name }) => textResult(await this.post("/api/projects", { name })),
    );

    this.read(
      "get_status",
      "Where the selected project stands right now — one compact digest of the WHOLE pipeline (counts and flags only, no content): stage, world, script, visualWorld, shotlist, storyboard, radio, sounds, episode, cuts. Call this first for 'where are we' / 'what's next' instead of fetching every section.",
      "/api/status",
    );

    // ---- world -------------------------------------------------------------
    this.read(
      "get_world",
      "Read the World bible (World tab): { title, logline, map, depth, characters, locations }. `map` is the 5 shaping questions; `depth` the core story elements; `characters`/`locations` are the roster with sheet images and voice refs.",
      "/api/world",
    );
    T.registerTool(
      "add_world_character",
      {
        description:
          "Add a character to the World roster. Pass the fields the World tab collects (name required; archetype, role, want, need, traits, arc, voice, appearance are optional). Call get_world first to avoid duplicating an existing character.",
        inputSchema: { character: z.record(z.any()).describe("Character fields — name required, the rest optional") },
      },
      async ({ character }) => textResult(await this.post("/api/world/character", character)),
    );
    T.registerTool(
      "add_world_location",
      {
        description: "Add a location to the World roster. Pass the fields the World tab collects (name required, plus optional description/mood/etc.). Call get_world first.",
        inputSchema: { location: z.record(z.any()).describe("Location fields — name required, the rest optional") },
      },
      async ({ location }) => textResult(await this.post("/api/world/location", location)),
    );

    // ---- script ------------------------------------------------------------
    this.read(
      "get_script",
      "Read the current screenplay (Script tab) — the PINNED draft the editor and all edits operate on. Returns the title, the TipTap document, the pinned draft name, the draft list, sign-off state, whether an edit proposal is pending, and which specialists have reviewed this revision. Call before proposing or making edits.",
      "/api/script",
    );
    this.read("list_drafts", "List the script's drafts (Script tab), each with its id, name, and whether it is the pinned/active one.", "/api/script/drafts");
    this.read("lint_script", "Run the screenplay linter over the pinned draft and return its findings (format/consistency issues), same as the Script tab's lint.", "/api/script/lint");
    this.read("get_script_reviews", "Read the script specialists' reviews of the current revision (the writers'-room board), bucketed into pending / stale / fresh.", "/api/script/reviews");
    T.registerTool(
      "save_script",
      {
        description:
          "Overwrite the pinned script draft with a new document. WORKFLOW: call get_script, edit the returned `doc` (a TipTap/ProseMirror JSON document), then pass the whole updated store back here. This is how you 'change the script' — the edit lands on the live pinned draft and is versioned (undo via list_history/restore_version). Pass the same object shape get_script returned.",
        inputSchema: { store: z.record(z.any()).describe("The script store to save — the object shape get_script returns (doc, title, …)") },
      },
      async ({ store }) => textResult(await this.put("/api/script", store)),
    );
    T.registerTool(
      "new_draft",
      {
        description: "Create a new script draft (optionally named) and return the updated draft list. Use pin_draft to make it the active one.",
        inputSchema: { name: z.string().optional().describe("Optional name for the new draft") },
      },
      async ({ name }) => textResult(await this.post("/api/script/drafts", name ? { name } : {})),
    );
    T.registerTool(
      "pin_draft",
      {
        description: "Pin (make active) a script draft by id — the editor and all script edits then operate on it. Get ids from list_drafts.",
        inputSchema: { id: z.string().describe("Draft id from list_drafts") },
      },
      async ({ id }) => textResult(await this.post("/api/script/pin", { id })),
    );
    T.registerTool(
      "sign_script",
      { description: "Mark the current script draft as signed off (reviewed and locked for the next pipeline stage)." },
      async () => textResult(await this.post("/api/script/sign", {})),
    );

    // ---- shot list ---------------------------------------------------------
    this.read(
      "get_shotlist",
      "Read the granular per-shot Shot list (every ~2-3s shot before packing into ≤15s multishots). Each shot: { n, id, beat, beatTitle, dur, location, characters, camera, action, dialogue, audioSync, prompt }. Also returns `packs` (the live ≤15s grouping). ALWAYS call before save_shotlist so you carry existing shot ids through unchanged.",
      "/api/shotlist",
    );
    this.read("list_shots", "List the packed multishot shots (the ≤15s bundles MS-01 … derived from the shot list), each with its Seedance and audio prompts.", "/api/shots");
    T.registerTool(
      "save_shotlist",
      {
        description:
          'Write the Shot list. mode "replace" (default) overwrites all shots; "append" adds to the end. For a full episode, build beat by beat (one "replace" for the first beat, then "append" per beat) rather than one huge call. ALWAYS carry each existing shot\'s `id` through unchanged — ids key generated media (storyboard stills, the animatic picture track); a new id orphans that media. Only omit `id` for a genuinely new shot. The route validates against the shared shotlist schema and returns counts + a ≤15s pack preview.',
        inputSchema: {
          shots: z.array(z.record(z.any())).describe("The shots to write — each with n, id (carry existing ones through), beat, dur, location, characters, camera, action, dialogue, prompt"),
          mode: z.enum(["replace", "append"]).optional().describe('"replace" (default) or "append"'),
        },
      },
      async ({ shots, mode }) => textResult(await this.post("/api/shotlist", { shots, mode: mode || "replace", source: "mcp" })),
    );

    // ---- episode plan ------------------------------------------------------
    this.read(
      "get_episode",
      "The full episode plan: the multishot bundles (MS-01 …), their rendered videos, per-bundle prompt overrides, sign-off state, chosen first frames and style-reference videos, the per-bundle scene-needs checklist, and the voice/sound reference pool. Large payload — use get_status if you only need render progress. Returns { episode: null } when no plan exists yet.",
      "/api/episode",
    );
    this.read("list_episodes", "List the episodes of a series project, each with its id, title and whether it's active. Use use_episode to switch which one the episode-scoped tools target.", "/api/episodes");
    T.registerTool(
      "create_episode",
      {
        description: "Add an episode to a series project. Pass the fields the Episodes tab collects (e.g. title). Returns the updated episode list.",
        inputSchema: { episode: z.record(z.any()).describe("Episode fields, e.g. { title }") },
      },
      async ({ episode }) => textResult(await this.post("/api/episodes", episode)),
    );
    T.registerTool(
      "set_episode_style",
      {
        description: "Set the episode's base visual style / style-reference settings. Pass the fields the Episode tab's style control sends. Call get_episode first.",
        inputSchema: { style: z.record(z.any()).describe("Style fields as the Episode tab sends them") },
      },
      async ({ style }) => textResult(await this.post("/api/episode/style", style)),
    );
    T.registerTool(
      "save_episode_prompt",
      {
        description: "Override a multishot bundle's generation prompt. Pass the fields the Episode tab's per-bundle prompt editor sends (bundle id + prompt). Call get_episode first for the bundle ids.",
        inputSchema: { prompt: z.record(z.any()).describe("{ bundle/id, prompt, … } as the Episode tab sends it") },
      },
      async ({ prompt }) => textResult(await this.post("/api/episode/prompt", prompt)),
    );
    T.registerTool(
      "select_take",
      {
        description: "Choose which rendered take of a bundle is the selected one (what a stitch will use). Pass the fields the Episode tab's take picker sends. Call get_episode first.",
        inputSchema: { selection: z.record(z.any()).describe("{ bundle/id, take/videoId, … } as the Episode tab sends it") },
      },
      async ({ selection }) => textResult(await this.post("/api/episode/select", selection)),
    );

    // ---- radio / sounds ----------------------------------------------------
    this.read("get_radio", "Read the Radio tab: the audio-only dialogue plan — each line, its voice casting, and any recorded takes.", "/api/radio");
    this.read("get_sounds", "Read the Sound Studio: every sound (music / sfx / voice), its versions, likes and attachments.", "/api/sounds");

    // ---- cuts / editor -----------------------------------------------------
    this.read(
      "get_cuts",
      "The ordered stitch plan: the selected take of each bundle in order, per-segment durations and timecodes, the background-music layout, the current complete-cut output (if any), and the version history of stitched/scored cuts.",
      "/api/episode/cuts",
    );

    // ---- library / musical -------------------------------------------------
    this.read("list_library", "List the project's shared asset library (voice refs, browsable images, imported generations) with their ids and whether each is enabled.", "/api/library");
    this.read("get_musical", "Read the Musical tab: the song → audio 'shot bible' segments (lip-syncable dialogue splits).", "/api/musical");

    // ---- history -----------------------------------------------------------
    this.read(
      "list_history",
      "This project's document version history across all stores (world, shotlist, sounds, script, …), newest first. Every save parks the version it replaced, so this is the way back after an overwrite. Each entry has the id (ts) to pass to restore_version, plus size and who wrote it. Check here BEFORE offering to rewrite lost content.",
      "/api/history",
    );
    T.registerTool(
      "list_doc_history",
      {
        description: "List saved earlier versions of ONE document (e.g. 'script', 'shotlist', 'world'). Returns snapshots newest-first with their `ts` ids for restore_version.",
        inputSchema: { name: z.string().describe("Document name, e.g. 'script', 'shotlist', 'world', 'sounds', 'radio'") },
      },
      async ({ name }) => textResult(await this.get(`/api/history/${encodeURIComponent(name)}`)),
    );
    T.registerTool(
      "restore_version",
      {
        description:
          "Put a saved earlier version of a document back (get `ts` from list_history / list_doc_history). Safe and reversible: restoring first saves the CURRENT version to history. ALWAYS tell the user which version (ts + source) you restored. Use this to undo a bad overwrite instead of retyping from memory.",
        inputSchema: {
          name: z.string().describe("Document name, e.g. 'script', 'shotlist', 'world'"),
          ts: z.string().describe("Version id from history, e.g. '2026-07-22T21-56-31-995Z'"),
        },
      },
      async ({ name, ts }) => textResult(await this.post(`/api/history/${encodeURIComponent(name)}/${encodeURIComponent(ts)}/restore`, {})),
    );

    // ---- generation (SPENDS RENDER CREDITS on the user's connected account) --
    T.registerTool(
      "generate_storyboard",
      {
        description:
          "SPENDS CREDITS. Generate a storyboard still for a shot (Nano Banana Pro via the user's connected Higgsfield account). Pass the fields the Storyboard tab sends (the shot id/n and prompt). Returns a job — poll get_job until it finishes. Prefer the generate-storyboard skill prompt for the full playbook (references, retries).",
        inputSchema: { request: z.record(z.any()).describe("{ shot id/n, prompt, … } as the Storyboard tab sends it") },
      },
      async ({ request }) => textResult(await this.post("/api/storyboard/image", request)),
    );
    T.registerTool(
      "render_video",
      {
        description:
          "SPENDS CREDITS. Kick off a video render (a multishot Seedance generation) on the user's connected render account. Pass the fields the render flow sends. Returns a job id — poll get_job. Prefer the generate-multishot skill prompt for the full playbook.",
        inputSchema: { request: z.record(z.any()).describe("The render request body") },
      },
      async ({ request }) => textResult(await this.post("/api/render", request)),
    );
    T.registerTool(
      "stitch_cut",
      {
        description:
          "SPENDS COMPUTE (no render credits). Stitch every bundle's selected take, in order, into one complete cut (optionally over a music bed). Pass the fields the Cuts tab's stitch sends. Call get_cuts first to see what will be assembled. Prefer the complete-cut skill prompt.",
        inputSchema: { request: z.record(z.any()).optional().describe("Stitch options as the Cuts tab sends them") },
      },
      async ({ request }) => textResult(await this.post("/api/episode/stitch", request || {})),
    );
    T.registerTool(
      "get_job",
      {
        description: "Poll a render/generation job started by generate_storyboard / render_video and return its status and, when finished, its output.",
        inputSchema: { id: z.string().describe("Job id returned by a generation tool") },
      },
      async ({ id }) => textResult(await this.get(`/api/jobs/${encodeURIComponent(id)}`)),
    );

    // ---- skill playbooks, as MCP prompts -----------------------------------
    // The flue skills are workflows over the tools above. Exposed here as MCP
    // prompts so the client's model can load a playbook ("script-writing",
    // "generate-storyboard", …) and then drive the tools the way flue does.
    for (const p of SKILL_PROMPTS) {
      T.registerPrompt(
        p.name,
        { title: p.title, description: p.description, argsSchema: p.argsSchema || {} },
        (args) => ({
          messages: [{ role: "user", content: { type: "text", text: p.render(args || {}) } }],
        }),
      );
    }
  }
}
