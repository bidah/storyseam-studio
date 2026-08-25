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
import { decodeBase64Image, fetchImage, EXT_FOR_TYPE } from "./lib/image-import.js";

const SERVER_INFO = { name: "storyseam", version: "1" };

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
  async authHeaders() {
    const headers = new Headers();
    const secret = proxySecret(this.env);
    if (!secret) throw new Error("Server is missing FLUE_PROXY_SECRET — the MCP bridge can't authenticate.");
    headers.set(AGENT_HEADER, await mintToken(this.userId, secret, AGENT_ISSUER));
    if (this.state.projectId) headers.set("x-project-id", this.state.projectId);
    if (this.state.episodeId) headers.set("x-episode-id", this.state.episodeId);
    return headers;
  }

  // Dispatch a prepared request the way every tool reaches the app: in-process
  // through SELF, falling back to a public fetch in local dev.
  async send(req, label) {
    const res = this.env.SELF ? await this.env.SELF.fetch(req) : await fetch(req);
    const raw = await res.text();
    let data;
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
    if (!res.ok) {
      const msg = data?.error || `${res.status} ${res.statusText}`;
      throw new Error(`${label} → ${msg}`);
    }
    return data;
  }

  async api(method, path, body) {
    const base = this.env.WORKER_PUBLIC_URL || "https://storyseam.app";
    const headers = await this.authHeaders();
    if (body !== undefined) headers.set("content-type", "application/json");
    return this.send(
      new Request(new URL(path, base), {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
      `${method} ${path}`,
    );
  }

  get(path) { return this.api("GET", path); }
  post(path, body) { return this.api("POST", path, body ?? {}); }
  put(path, body) { return this.api("PUT", path, body ?? {}); }

  // --- images from outside the app ----------------------------------------
  //
  // The app's own image pickers all start from something already inside the
  // project (a library rel, a generation id). A remote MCP client starts from
  // neither — it holds a URL its model just produced, or bytes off the user's
  // disk. `importImage` is the bridge, and it walks the SAME two steps the
  // browser's MediaPicker does on its Upload tab: POST the bytes to /api/upload
  // (durable R2 object under chat-uploads/), then POST /api/library/import to
  // copy it into the project asset library and get back the `rel` that every
  // attach surface — character sheet, location sheet, scene reference — speaks.
  //
  // Doing it in two steps rather than one new route is deliberate: it is the
  // route pair the GUI already uses, so there is no third code path to keep in
  // sync, and the upload half is what makes the image fetchable by an external
  // image model afterwards.
  async importImage({ url, data, filename, folder, name }) {
    if (!url && !data) throw new Error("Pass `url` (a public https image URL) or `data` (base64 image bytes).");
    const src = data ? decodeBase64Image(data) : await fetchImage(url);
    const ext = EXT_FOR_TYPE[src.contentType] || "png";
    const stem = String(filename || src.name || "").replace(/\.[^.]*$/, "") || "mcp-image";
    const upload = await this.uploadBytes(src.bytes, src.contentType, `${stem}.${ext}`);
    return this.post("/api/library/import", {
      key: upload.key,
      folder: folder || "uploads",
      ...(name ? { name } : {}),
    });
  }

  // Raw bytes to /api/upload — the JSON `api()` helper can't carry a binary
  // body, and the route takes the bytes as the request body (no multipart).
  async uploadBytes(bytes, contentType, filename) {
    const base = this.env.WORKER_PUBLIC_URL || "https://storyseam.app";
    const headers = await this.authHeaders();
    headers.set("content-type", contentType);
    headers.set("x-filename", filename);
    return this.send(
      new Request(new URL("/api/upload", base), { method: "POST", headers, body: bytes }),
      "POST /api/upload",
    );
  }

  // Resolve a library `rel` to the full { rel, url, thumb, name } the World tab
  // renders without a second lookup — and fail loudly when the image isn't
  // actually in the library, rather than storing a reference to nothing.
  // Tolerant about what it's handed (a url, a refUrl, a bare filename), because
  // a model that just read list_library will paste whichever field caught its
  // eye.
  async libraryImage(raw) {
    const want = String(raw || "").trim();
    const lib = await this.get("/api/library");
    const images = (lib?.folders || []).flatMap((f) => f.images || []);
    const base = (v) => String(v || "").split("/").pop();
    const byName = images.filter((im) => base(im.rel) === base(want));
    const hit =
      images.find((im) => im.rel === want) ||
      images.find((im) => im.url === want || im.refUrl === want || im.thumb === want) ||
      // A bare filename resolves only when it is UNAMBIGUOUS — two folders
      // holding "sheet.png" must not silently pick one.
      (byName.length === 1 ? byName[0] : null);
    if (!hit) {
      throw new Error(
        `No library image "${want}" in this project. Call list_library for the valid \`rel\` paths, ` +
        "or upload_image to bring a new image in first.",
      );
    }
    return hit;
  }

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
    T.registerTool(
      "update_world_character",
      {
        description:
          "Edit an EXISTING World character in place. Pass the character `id` (from get_world) and only the fields you are changing — everything else is preserved. This is how you correct or fill in a character; add_world_character would create a SECOND entry with the same name and blank fields. To link images use attach_character_sheet / attach_character_miniature instead of writing the image fields by hand.",
        inputSchema: {
          id: z.string().describe("Character id from get_world, e.g. char-abc123-0"),
          patch: z.record(z.any()).describe("Only the fields to change (name, archetype, role, want, need, traits, arc, voice, appearance, anchor)"),
        },
      },
      async ({ id, patch }) =>
        textResult(await this.put(`/api/world/character/${encodeURIComponent(id)}`, patch)),
    );
    T.registerTool(
      "update_world_location",
      {
        description:
          "Edit an EXISTING World location in place. Pass the location `id` (from get_world) and only the fields you are changing. Use attach_location_sheet to link its reference art rather than writing the image field by hand.",
        inputSchema: {
          id: z.string().describe("Location id from get_world, e.g. loc-abc123-0"),
          patch: z.record(z.any()).describe("Only the fields to change (name, slug, description)"),
        },
      },
      async ({ id, patch }) =>
        textResult(await this.put(`/api/world/location/${encodeURIComponent(id)}`, patch)),
    );

    // ---- images: getting one IN, then pinning it to something --------------
    //
    // Everything below shares one input shape (IMAGE_SOURCE): name an image
    // ALREADY in the project by `rel`, or bring a new one in by `url` / `data`
    // in the same call. Making every attach surface accept both is the point —
    // an external client's model typically holds a URL, not a library rel, and
    // an attach tool that only speaks `rel` sends it looking for an upload tool
    // that (before this) did not exist.
    T.registerTool(
      "upload_image",
      {
        description:
          "Bring an image INTO the project from outside and return its library `rel` — the id every attach/reference tool here speaks (attach_character_sheet, attach_location_sheet, select_reference, set_first_frame). It is the entry point for any image not already in the project — the app's own pickers all start from something that is, so without this there is no way in. Pass EITHER `url` (a direct, public https image URL — the raw image, not the page it sits on) OR `data` (base64 image bytes, e.g. a file the user pointed you at; a data: URI works too). png/jpeg/webp/gif, 20MB max. Returns { rel, url, thumb, refUrl } — `refUrl` is the absolute, ungated, full-resolution URL to feed an external image model as a reference.",
        inputSchema: {
          url: z.string().optional().describe("Direct https URL of the image to import"),
          data: z.string().optional().describe("Base64-encoded image bytes (or a data: URI)"),
          filename: z.string().optional().describe("Original filename, e.g. luzy-sheet.png — used to name the library file"),
          folder: z.string().optional().describe('Library folder to land in, e.g. "characters". Defaults to "uploads".'),
          name: z.string().optional().describe("Base filename to store it as (no extension)"),
        },
      },
      async (input) => textResult(await this.importImage(input)),
    );

    // One implementation for the three sheet slots — they differ only in which
    // record they patch and which field on it they write.
    const attachSheet = async (path, field, { rel, url, data, filename, folder, clear }) => {
      if (clear) return textResult(await this.put(path, { [field]: null }));
      let im;
      if (rel) im = await this.libraryImage(rel);
      else if (url || data) im = await this.importImage({ url, data, filename, folder });
      else throw new Error("Pass `rel` (from list_library), or `url`/`data` to import a new image, or `clear: true` to unlink.");
      return textResult(
        await this.put(path, { [field]: { rel: im.rel, url: im.url, thumb: im.thumb, name: im.name } }),
      );
    };
    const IMAGE_SOURCE = {
      rel: z.string().optional().describe("Library rel of an image already in the project (from list_library / upload_image)"),
      url: z.string().optional().describe("Direct https URL of a new image to import and link in one call"),
      data: z.string().optional().describe("Base64 image bytes of a new image to import and link in one call"),
      filename: z.string().optional().describe("Original filename for an imported image, e.g. luzy-sheet.png"),
      folder: z.string().optional().describe('Library folder for an imported image, e.g. "characters"'),
      clear: z.boolean().optional().describe("Set true to unlink the current image"),
    };

    T.registerTool(
      "attach_character_sheet",
      {
        description:
          "Pin an image to a World character as their CHARACTER SHEET — the portrait on the World tab, and the reference that rides into every storyboard and video render the character appears in. Name an image already in the project with `rel`, or hand it a new one directly with `url` / `data` (imported for you). `clear: true` unlinks. Prefer this over writing the image field through update_world_character: it resolves the library image to the full record the World tab renders, and it fails loudly if the image isn't really there.",
        inputSchema: { id: z.string().describe("Character id from get_world"), ...IMAGE_SOURCE },
      },
      async ({ id, ...src }) =>
        attachSheet(`/api/world/character/${encodeURIComponent(id)}`, "sheetImage", src),
    );
    T.registerTool(
      "attach_character_miniature",
      {
        description:
          "Pin an image to a World character as their WIDE-SHOT MINIATURE — a full-figure reference used on wide / establishing shots, where the portrait-heavy character sheet is too tight to read. A SEPARATE slot from attach_character_sheet; attaching one never touches the other. Name an image already in the project with `rel`, or hand it a new one with `url` / `data`. `clear: true` unlinks.",
        inputSchema: { id: z.string().describe("Character id from get_world"), ...IMAGE_SOURCE },
      },
      async ({ id, ...src }) =>
        attachSheet(`/api/world/character/${encodeURIComponent(id)}`, "miniatureImage", src),
    );
    T.registerTool(
      "attach_location_sheet",
      {
        description:
          "Pin an image to a World location as its LOCATION SHEET — the reference art on the World tab, auto-supplied to every shot set at that location. Name an image already in the project with `rel`, or hand it a new one with `url` / `data`. `clear: true` unlinks.",
        inputSchema: { id: z.string().describe("Location id from get_world"), ...IMAGE_SOURCE },
      },
      async ({ id, ...src }) =>
        attachSheet(`/api/world/location/${encodeURIComponent(id)}`, "sheetImage", src),
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
    this.read(
      "list_library",
      "List the project's IMAGE library, grouped by folder. Each image carries the `rel` that every attach/reference tool here speaks (attach_character_sheet, attach_location_sheet, select_reference, set_first_frame via stills, toggle_library), plus `refUrl` — the absolute, ungated, FULL-RESOLUTION URL to hand an external image model as a reference. Never pass `url`/`thumb` to an outside fetcher: the first is a project-scoped relative path, the second a downscaled copy. To put a NEW image in the library, use upload_image.",
      "/api/library",
    );
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

    // ---- storyboard stills -------------------------------------------------
    this.read(
      "get_storyboard",
      "Every storyboard still in the project, grouped bundle → shot → takes (newest last). Each take has its `file` (the id set_first_frame and select_still take), `name`, whether it is `selected`, how it was made (prompt/model/refs), and `url` / `thumb` / `display` / `refUrl`. `refUrl` is the absolute full-resolution URL to hand an external image model as a reference.",
      "/api/storyboard",
    );
    T.registerTool(
      "attach_still",
      {
        description:
          "Put a storyboard STILL on one shot of a bundle — the picture that stands in for that shot until its video exists, and what the animatic shows. APPENDS a take (prior takes are kept), downloading the bytes so it renders immediately. Pass the image as `url` (a direct https image URL — e.g. the result_url of a still you just generated) or `data` (base64 bytes). ALWAYS pass `prompt`, `model` and `refs` when you generated it: they record how the image was made and prefill the app's regenerate flow. Returns the take's `file` plus `url` / `thumb` / `display` / `refUrl`.",
        inputSchema: {
          bundle: z.string().describe("Bundle id the shot belongs to, e.g. MS-01"),
          shot: z.string().describe("Shot id within the bundle, e.g. MS-012"),
          url: z.string().optional().describe("Direct https URL of the still image"),
          data: z.string().optional().describe("Base64 image bytes, when you have the file rather than a URL"),
          filename: z.string().optional().describe("Original filename, when passing `data`"),
          angle: z.string().optional().describe("Short note on the camera angle / variation, e.g. 'low angle CU'"),
          jobId: z.string().optional().describe("Generation job id, for reference"),
          prompt: z.string().optional().describe("The EXACT prompt you sent the image model"),
          model: z.string().optional().describe("The image model id you used, e.g. 'nano_banana_pro'"),
          refs: z.array(z.record(z.any())).optional().describe("The reference images you passed, each { key, role, url }"),
        },
      },
      async ({ bundle, shot, url, data, filename, ...rest }) => {
        // The route downloads from a URL itself, so a plain `url` goes straight
        // through. Bytes have to become a URL first — park them in the library,
        // which also leaves the still reusable as a reference later.
        let src = url;
        if (!src) {
          if (!data) throw new Error("Pass `url` (a direct image URL) or `data` (base64 image bytes).");
          const im = await this.importImage({ data, filename, folder: "stills" });
          src = im.refUrl;
          if (!src) throw new Error("Imported the image but the deployment has no public URL to fetch it back from (WORKER_PUBLIC_URL unset).");
        }
        return textResult(await this.post("/api/storyboard/image", { bundle, shot, url: src, ...rest }));
      },
    );
    T.registerTool(
      "select_still",
      {
        description:
          "Choose which take of a shot's storyboard stills is THE still for that shot (what the animatic shows and what a first-frame render would open on). Single-selection: picking one clears the others. Get `file` from get_storyboard.",
        inputSchema: {
          bundle: z.string().describe("Bundle id, e.g. MS-01"),
          shot: z.string().describe("Shot id, e.g. MS-012"),
          file: z.string().describe("The take's `file` from get_storyboard"),
          selected: z.boolean().optional().describe("true to select (default), false to deselect"),
        },
      },
      async ({ bundle, shot, file, selected }) =>
        textResult(await this.post("/api/storyboard/select", {
          bundle, shot, file, selected: selected !== false,
        })),
    );

    // ---- the asset library + the Visual tab --------------------------------
    T.registerTool(
      "toggle_library",
      {
        description:
          "Select or deselect a library image for the project's final-selection pool (the shortlist the Episode tab picks scene references from). `rel` from list_library.",
        inputSchema: {
          rel: z.string().describe("Library rel from list_library"),
          selected: z.boolean().optional().describe("Omit to flip it; the route toggles"),
        },
      },
      async ({ rel }) => textResult(await this.post("/api/library/toggle", { rel })),
    );
    this.read(
      "get_visual_world",
      "Read the World › Visual tab: the style presets, the prompt library, the board, and every concept-art GENERATION with its id, prompt, model and stored image (url / thumb / display / refUrl). Generation ids are what save_generation_to_library promotes into the asset library.",
      "/api/visual-world",
    );
    T.registerTool(
      "attach_visual_generation",
      {
        description:
          "Put a generated concept image on the World › Visual tab. Appends a generation and downloads the image so it shows live. Pass the image's `url` (the raw result URL from the image model — it must be an https Higgsfield/CloudFront, fal.media or atlascloud.ai URL, the hosts the route will fetch from) plus `prompt` and `model` so the tab records how it was made. For an image from anywhere else, use upload_image (it lands in the asset library instead).",
        inputSchema: {
          url: z.string().describe("Raw https result URL of the generated image"),
          prompt: z.string().optional().describe("The EXACT scene prompt you sent the model"),
          model: z.string().optional().describe("The image model id you used"),
          aspectRatio: z.string().optional().describe("Aspect ratio generated at, e.g. '16:9'"),
          sheetType: z.enum(["character", "location", "prop"]).optional().describe("Set when this image is a design sheet — badges it on the tab"),
          refs: z.array(z.record(z.any())).optional().describe("The references you passed, each { kind, rel, genId, url }"),
        },
      },
      async (input) => textResult(await this.post("/api/visual-world/image", input)),
    );
    T.registerTool(
      "save_generation_to_library",
      {
        description:
          "Promote a Visual-tab generation into the project asset library and return its `rel`. This is the bridge between a generated sheet and the World roster: attach_character_sheet / attach_location_sheet speak library rels, and Visual-tab generations are NOT in the library until saved. Pass the generation `id` from get_visual_world.",
        inputSchema: {
          id: z.string().describe("Generation id, e.g. gen-abc123-0f00aa"),
          folder: z.string().optional().describe('Library folder to save into, e.g. "locations"'),
          name: z.string().optional().describe("Base filename (no extension)"),
        },
      },
      async (input) => textResult(await this.post("/api/visual-world/save-to-library", input)),
    );
    T.registerTool(
      "add_moodboard_card",
      {
        description:
          "Add a card to the project moodboard — a reference image or video (fetched and stored server-side, so the card survives the source link dying), a link with a preview, or a post-it note. The board places it for you.",
        inputSchema: {
          type: z.enum(["image", "video", "link", "note"]).describe("What kind of card"),
          url: z.string().optional().describe("Image/video/link URL — required for those three types"),
          content: z.string().optional().describe("Text, for a note"),
          color: z.string().optional().describe("Post-it colour, e.g. '#fde047'"),
        },
      },
      async (input) => textResult(await this.post("/api/moodboard/cards", input)),
    );

    // ---- scene references (what a bundle's render is given) ----------------
    T.registerTool(
      "select_reference",
      {
        description:
          "Add or remove one image as a chosen REFERENCE for an episode bundle — the pictures that bundle's video render is conditioned on (characters, locations, props). `rel` from list_library or upload_image. Most references come from the World roster automatically (auto_assign_refs); use this for the ones it can't source.",
        inputSchema: {
          bundle: z.string().describe("Bundle id, e.g. MS-01"),
          rel: z.string().describe("Library rel of the image"),
          selected: z.boolean().optional().describe("true to add (default), false to remove"),
        },
      },
      async ({ bundle, rel, selected }) =>
        textResult(await this.post("/api/episode/select", { bundle, rel, selected: selected !== false })),
    );
    T.registerTool(
      "link_reference",
      {
        description:
          "Tell a bundle WHICH scene need one of its chosen references covers, for the needs a roster match can't resolve. `need` is a need id from get_episode's `needs` — an image need (\"character:Kid\", \"location:ext-nyc-street\") or a speaker's voice (\"voice:Trini\"). `rel` must already be selected for that bundle (select_reference); pass null to unlink. A character with a World sheet image needs no link — that match is automatic.",
        inputSchema: {
          bundle: z.string().describe("Bundle id, e.g. MS-01"),
          need: z.string().describe('Need id from get_episode, e.g. "character:Kid"'),
          rel: z.string().nullish().describe("Rel of the reference covering the need, or null to unlink"),
        },
      },
      async ({ bundle, need, rel }) =>
        textResult(await this.post("/api/episode/link", { bundle, need, rel: rel ?? null })),
    );
    T.registerTool(
      "auto_assign_refs",
      {
        description:
          "Source every bundle's image and voice references from the World roster: each on-screen character contributes their sheet image (and, for speakers, their cast voice), each location its location sheet. VALIDATES FIRST — if a needed character has no linked sheet it assigns NOTHING and returns a report of what's missing, which is your cue to attach_character_sheet for those characters and run it again. Optional `beat` scopes the run to one beat's bundles.",
        inputSchema: { beat: z.string().optional().describe('Beat id to scope the run to, e.g. "B1". Omit to do every bundle.') },
      },
      async ({ beat }) => textResult(await this.post("/api/episode/auto-assign", beat ? { beat } : {})),
    );
    T.registerTool(
      "set_first_frame",
      {
        description:
          "Choose the storyboard still a bundle's video render should OPEN on (its first frame), or clear it. `file` is a still's `file` from get_storyboard; omit `file` to clear the bundle's first frame.",
        inputSchema: {
          bundle: z.string().describe("Bundle id, e.g. MS-01"),
          shot: z.string().optional().describe("Shot id the still belongs to, e.g. MS-012"),
          file: z.string().optional().describe("The still's `file` from get_storyboard. Omit to clear."),
        },
      },
      async ({ bundle, shot, file }) =>
        textResult(await this.post("/api/episode/first-frame", { bundle, shot: shot || null, file: file || null })),
    );
    T.registerTool(
      "set_video_reference",
      {
        description:
          "Set (or clear) the STYLE-REFERENCE VIDEO whose look every render should continue — episode-wide by default, or for one bundle when `bundle` is given. Pass `url`: a direct, publicly fetchable https video URL (a rendered take's refUrl, or a clip you have online). Omit `url` to clear; pass `disabled: true` with a `bundle` to render that one scene with no reference at all.",
        inputSchema: {
          url: z.string().optional().describe("Direct https URL of the reference video. Omit to clear."),
          name: z.string().optional().describe("Display name for the reference"),
          bundle: z.string().optional().describe("Scope to one bundle, e.g. MS-01. Omit for the episode-wide default."),
          disabled: z.boolean().optional().describe("With a `bundle`: render that scene with no video reference"),
        },
      },
      async ({ url, name, bundle, disabled }) =>
        textResult(
          bundle
            ? await this.post("/api/episode/ref-video", { bundle, url, name, disabled })
            : await this.post("/api/episode/video-ref", { url, name }),
        ),
    );
    T.registerTool(
      "attach_episode_video",
      {
        description:
          "Attach a rendered clip to an episode bundle by URL. Appends a take (prior takes are kept) and downloads the video into the bundle's generations, so it plays in the app and can be selected for the cut. Use after rendering a bundle with an external model.",
        inputSchema: {
          bundle: z.string().describe("Bundle id, e.g. MS-01"),
          url: z.string().describe("Direct https URL of the rendered mp4"),
          jobId: z.string().optional().describe("Generation job id, for reference"),
        },
      },
      async (input) => textResult(await this.post("/api/episode/video", input)),
    );

    // ---- exports / long-running jobs ---------------------------------------
    T.registerTool(
      "render_timeline_video",
      {
        description:
          "SPENDS COMPUTE. Export the video EDITOR's timeline to an mp4 through the Remotion renderer (the Editor tab's Render). This is the final export of an assembled edit — it does NOT generate any AI video; for that, render the shot with an image/video model and bring the result back with attach_episode_video. Returns a job id — poll get_job.",
        inputSchema: { request: z.record(z.any()).optional().describe("Render options — { timeline?, codec, crf, scale, out }. Omit to render the editor's current timeline.") },
      },
      async ({ request }) => textResult(await this.post("/api/render", request || {})),
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
        description: "Poll a long-running job (render_timeline_video, stitch_cut, score_cut) and return its status and, when finished, its output.",
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
