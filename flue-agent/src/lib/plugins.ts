// VENDORED from src/lib/plugins.ts — DO NOT EDIT HERE.
// Edit the canonical file, then run `npm run plugins:sync`
// (scripts/sync-plugins.mjs).

// THE plugin catalog — which surfaces the app has, and which of them are
// optional. One definition, every consumer.
//
// Shot Studio grew a header with fourteen tabs, which is the shape of a tool
// that does everything and the feel of a tool you can't learn. So the shell is
// now THREE always-present surfaces — the Bible, the Script and the Editor —
// plus a marketplace ("Explore plugins") where every other
// capability is installed on purpose. A project that is a radio play never
// grows a Musical tab; a project that never renders never grows a Cuts tab.
//
// Three plugins ship PRE-INSTALLED (`defaultInstalled`): Images, Videos and
// Episodes (which was core until it became removable). They are ordinary plugins — they sit in the marketplace and they can be removed —
// but a brand-new project has them on, because a studio with no way to make a
// picture is not a smaller studio, it is a broken one.
//
// This file is deliberately IMPORT-FREE and pure data so it can be vendored
// verbatim into the packages that can't reach across the repo root:
//
//   · worker/src/lib/plugins.ts      — validates PUT /api/plugins, seeds the
//                                      default set, and reports enablement on
//                                      /api/status
//   · flue-agent/src/lib/plugins.ts  — the agent's `list_plugins` / `set_plugin`
//                                      tools and the plugin-gate safeguard
//
// Edit THIS file, then run `npm run plugins:sync`. `npm run guards` fails when a
// copy drifts.
//
// ── Why the ids are the URL segments ─────────────────────────────────────────
// A plugin's `id` is also its route segment, its `TabsTrigger` value, and the
// `view` the client reports to `PUT /api/appstate`. Keeping them one string
// means the header, the route guard, the agent's `navigate` target and the
// gate check can never disagree about what "the Radio plugin" refers to.

export type PluginCategory = "Story" | "Visuals" | "Audio" | "Post";

export interface Surface {
  /** Stable id — also the URL segment and the tab value. Never rename one. */
  id: string;
  /** Header tab label. */
  label: string;
  /** Marketplace card title (usually the label, spelled out). */
  name: string;
  /** One line under the title on the card. */
  tagline: string;
}

export interface PluginSpec extends Surface {
  category: PluginCategory;
  /** The paragraph in the detail modal — what this actually gives you. */
  blurb: string;
  /** Up to four short "what you get" bullets in the modal. */
  highlights: string[];
  /**
   * Phrasings that IMPLY this plugin. The agent matches a request against these
   * before starting work, so "voice the dialogue" on a project without Radio
   * draws the install card instead of failing halfway through the pipeline.
   * Lowercase, matched as substrings.
   */
  triggers: string[];
  /**
   * The flue tools this plugin owns. A tool listed here must not run while the
   * plugin is uninstalled — that is the whole safeguard.
   */
  tools: string[];
  /** The flue skills gated on this plugin. */
  skills: string[];
  /**
   * Installed on a BRAND NEW project, without anyone choosing it. Reserve this
   * for a capability whose absence would read as a broken studio rather than a
   * smaller one — you cannot make anything without a way to make a picture. It
   * is still an ordinary plugin: it sits in the marketplace and it can be
   * removed. "Pre-installed", not "core".
   */
  defaultInstalled?: boolean;

  /**
   * Does this plugin get seeded for a project that predates the marketplace?
   * When true, `GET /api/status`'s `usage[<id>]` counter decides — see
   * seedEnabled() below. Set false for a surface that has no content of its own.
   */
  seedable: boolean;
}

// ── The three that are always there ───────────────────────────────────────────
// Not installable, not removable: without them there is no app. The order is
// the header order.
export const CORE: Surface[] = [
  {
    id: "world",
    label: "Bible",
    name: "Bible",
    tagline: "The world, the cast, the places — the document everything downstream reads.",
  },
  {
    id: "script",
    label: "Script",
    name: "Script",
    tagline: "Drafts, revisions and the screenplay itself.",
  },
  {
    id: "editor",
    label: "Editor",
    name: "Editor",
    tagline: "The timeline — assemble picture and sound into a cut.",
  },
];

export const CORE_IDS: string[] = CORE.map((s) => s.id);

// ── The marketplace ──────────────────────────────────────────────────────────
// Order here is the order of the Explore grid AND the order installed tabs
// appear in the header, so it runs down the pipeline: story, visuals, audio,
// post.
export const PLUGINS: PluginSpec[] = [
  {
    id: "images",
    label: "Images",
    name: "Image generation",
    category: "Visuals",
    tagline: "Generate stills — concept art, character sheets, location sheets, props.",
    blurb:
      "The picture side of the studio. Describe a character or a place, pick an image model from your connected provider, attach references, and generate. Everything you make lands here as a card you can save to the library, tag as a design sheet, or push onto the node canvas. The composer only ever shows IMAGE models — the video plugin has its own.",
    highlights: [
      "Your provider's live image-model catalog",
      "Reference images, style presets and sheet prompts",
      "Save a result straight into the project library",
      "The agent generates into the same board",
    ],
    triggers: [
      "generate an image", "make a picture", "concept art", "character sheet",
      "location sheet", "prop sheet", "image generation", "draw", "illustrate",
      "visual world", "how does it look",
    ],
    tools: ["get_visual_world", "attach_visual_generation", "save_visual_prompt", "save_generation_to_library"],
    skills: ["visual-world", "sheet-generation"],
    seedable: true,
    defaultInstalled: true,
  },
  {
    id: "videos",
    label: "Videos",
    name: "Video generation",
    category: "Visuals",
    tagline: "Generate motion — clips from a prompt, or from a still you already made.",
    blurb:
      "The motion side of the studio, deliberately its own surface. Same composer, but the model list is your provider's VIDEO catalog, the controls are the ones that model actually takes — MiniMax H3's 2K, Kling's mode, Veo's variant — and the results land in their own gallery instead of being mixed in with stills. Point it at an image you generated and it becomes that shot's first frame.",
    highlights: [
      "Your provider's live video-model catalog",
      "Controls generated from the model's own parameters",
      "Image-to-video from any still on the project",
      "Clips land in their own gallery, not the image board",
    ],
    triggers: [
      "generate a video", "make a clip", "animate", "image to video", "video generation",
      "bring it to life", "motion", "render a clip",
    ],
    tools: ["get_visual_world", "attach_visual_generation"],
    skills: ["continue-video", "video-from-audio-vfx"],
    seedable: true,
    defaultInstalled: true,
  },
  {
    id: "agents",
    label: "Script agents",
    name: "Script agents",
    category: "Story",
    tagline: "A writers' room of specialists who read your draft and report back.",
    blurb:
      "Fifteen script doctors — a story architect, a plot doctor, a dialogue polisher, a motivation doctor and more — each read the pinned draft with their own eyes and file a pass in the review ledger. The board shows who has read THIS revision, whose notes went stale when you rewrote, and who has never looked. Nothing they find is applied behind your back: they hand you findings and you decide.",
    highlights: [
      "A board of who has read the current draft",
      "Per-specialist findings, filed as a review pass",
      "Stale-vs-fresh tracking as the script moves",
      "Ask one doctor, or run the room",
    ],
    triggers: [
      "script agents", "writers room", "writers' room", "script doctor", "specialist",
      "review my script", "notes on my script", "story architect", "plot doctor",
      "dialogue polish", "critique the script",
    ],
    tools: ["get_script_reviews", "record_script_review"],
    skills: ["script-agents"],
    seedable: true,
  },
  {
    id: "moodboard",
    label: "Moodboard",
    name: "Moodboard",
    category: "Story",
    tagline: "An infinite reference wall — images, clips, links and sticky notes.",
    blurb:
      "A freeform canvas for the look of the thing before it has a shape: drag in references, pin links, scribble post-its, and group them however the story wants. It live-syncs, so a collaborator's card lands on your board as they drop it, and the agent can read the wall to ground its own suggestions.",
    highlights: [
      "Drag-and-drop images, video and links",
      "Sticky notes with rich text",
      "Live multiplayer sync",
      "The agent can read and add to it",
    ],
    triggers: [
      "moodboard", "mood board", "reference wall", "pin a reference", "inspiration board",
      "sticky note", "post-it",
    ],
    tools: ["get_moodboard", "add_moodboard_card", "remove_moodboard_card"],
    skills: ["moodboard"],
    seedable: true,
  },
  {
    id: "shotlist",
    label: "Shot list",
    name: "Shot list",
    category: "Story",
    tagline: "The script broken into numbered shots, each with camera, action and dialogue.",
    blurb:
      "The bridge between the screenplay and everything that renders. Each shot carries its beat, duration, location, cast, camera language, action and dialogue — and its id is the key the storyboard, the animatic, the radio pass and the episode all hang media off. Written by the project's shot director, editable by hand, and versioned like every other document.",
    highlights: [
      "Generated from the script by your shot director",
      "Per-shot camera, action, dialogue and duration",
      "Stable shot ids that key every downstream render",
      "Full version history with restore",
    ],
    triggers: [
      "shot list", "shotlist", "break down the script", "break the script into shots",
      "storyboard the script", "how many shots", "add a shot", "shot breakdown",
    ],
    tools: ["get_shotlist", "save_shotlist", "list_shots", "get_shot_director", "save_shot_director"],
    skills: ["shot-list", "shot-list-live-action", "create-new-shots-for-shotlist"],
    seedable: true,
  },
  {
    id: "nodes",
    label: "Visual nodes",
    name: "Visual nodes",
    category: "Visuals",
    tagline: "A node canvas that wires prompts, stills and clips into one pipeline.",
    blurb:
      "Reference lineage as a graph. Chain a text node into an image node into a video node, run the whole downstream closure with one click, and see exactly which still fed which clip. It is the same generation store as the Images and Videos tabs — the canvas is a different way to drive it, not a second copy.",
    highlights: [
      "Text → image → video chains you can re-run",
      "Run one node or everything downstream of it",
      "The lineage of every generation, visible",
      "Shares the generation store with Images and Videos",
    ],
    triggers: [
      "visual nodes", "node canvas", "node graph", "wire the pipeline", "lineage",
      "chain the generations",
    ],
    tools: ["get_visual_world"],
    skills: [],
    seedable: true,
  },
  {
    id: "animatic",
    label: "Animatic",
    name: "Animatic",
    category: "Visuals",
    tagline: "Storyboard stills on a picture track, cut against the radio pass.",
    blurb:
      "The episode before it exists: every shot's still held on screen for its duration, laid against the voiced dialogue, with a labelled slate standing in for any shot whose art you haven't made yet. It is the cheapest possible look at whether the thing works — pacing, order and coverage — before a single frame is rendered.",
    highlights: [
      "Stills and slates on one picture lane",
      "Cut against the radio pass automatically",
      "Location and coverage gaps flagged inline",
      "Upgrades in place as real clips arrive",
    ],
    triggers: [
      "animatic", "storyboard reel", "preview the episode", "slate", "rough cut of the stills",
    ],
    tools: ["attach_still", "get_timeline"],
    skills: ["generate-storyboard"],
    seedable: true,
  },
  {
    id: "radio",
    label: "Radio",
    name: "Radio",
    category: "Audio",
    tagline: "The audio-only pass — cast every character and voice every line.",
    blurb:
      "Hear the episode before you can see it. Cast a voice per character, generate a take for every line of dialogue in the shot list, audition alternates, and commit the pacing that the animatic and the final cut both inherit. A radio play is a real deliverable on its own — and it is also the fastest way to find out that a scene is two minutes too long.",
    highlights: [
      "One voice cast per character, auditioned",
      "A take for every dialogue line in the shot list",
      "Pacing you commit once and everything downstream reads",
      "Works as a finished audio-only cut",
    ],
    triggers: [
      "radio", "voice the dialogue", "cast the voices", "voice over", "read the lines",
      "audio pass", "audio only", "hear the script", "table read",
    ],
    tools: ["get_radio", "cast_radio_voice", "attach_radio_take", "casting_sample_prompt", "commit_pacing"],
    skills: ["radio", "radio-pacing"],
    seedable: true,
  },
  {
    id: "sounds",
    label: "Sound studio",
    name: "Sound studio",
    category: "Audio",
    tagline: "Effects, ambience, music beds and voice — every audio track in one place.",
    blurb:
      "The project's sound library, with versions. Generate an effect or a whole sound-design scene, keep several takes of each, like the one that works, and reference it from the timeline. Character voices live here too — a liked take is what `attach_character_voice` points the Bible at.",
    highlights: [
      "Generate SFX, ambience, music and dialogue",
      "Multiple versions per track, with a liked pick",
      "Character voice references for the Bible",
      "Every track addressable from the Editor",
    ],
    triggers: [
      "sound effect", "sfx", "ambience", "foley", "sound design", "music bed",
      "sound studio", "generate audio", "soundscape",
    ],
    tools: ["list_sounds", "create_sound", "add_sound_version", "edit_sound_version", "like_sound_version", "rename_sound", "delete_sound_version", "attach_sound", "save_audio_prompt"],
    skills: ["seed-audio"],
    seedable: true,
  },
  {
    id: "musical",
    label: "Musical",
    name: "Musical",
    category: "Audio",
    tagline: "Turn a song into a shot bible — split the track, write a prompt per segment.",
    blurb:
      "For work that is driven by a song rather than a script. Upload the mix and the vocal stem, let it split into timed segments, and author a lyric and a generation prompt per segment. The result is an audio shot bible the render pipeline reads exactly like a shot list.",
    highlights: [
      "Upload a mix plus a vocal stem",
      "Automatic segmentation on the vocal",
      "A lyric and a prompt per segment",
      "Feeds the same render pipeline as the shot list",
    ],
    triggers: [
      "musical", "music video", "split the song", "lyric video", "song segments",
      "make it to the music",
    ],
    tools: ["get_musical", "split_song", "save_musical_segments"],
    skills: ["musical"],
    seedable: true,
  },
  {
    id: "director",
    label: "Director",
    name: "Director Series",
    category: "Story",
    tagline: "A cue sheet the Director plans the whole arc from, before it draws a frame.",
    blurb:
      "The other way to make a film here. Instead of rendering shots one at a time and cutting them together, you write ONE recipe — an opening prompt, a first frame, and a cue sheet of timed beats — and a live Director generates the piece continuously against it. A beat is a second on the film's own clock plus what happens there: a prompt that directs from then on, the exact frame to land on, or the audio to shoot against. The whole sheet travels with the session, so the Director plans the arc rather than drifting into it.",
    highlights: [
      "A cue sheet derived from your shot list, or written by hand",
      "Beats that pin an exact frame, a prompt, or a bed of audio",
      "Model sheets from the Bible and Library keep a design still",
      "Every ceiling the endpoint enforces, checked while you type",
    ],
    triggers: [
      "director series", "cue sheet", "cuesheet", "director setup", "beats",
      "recipe", "direct the film", "one continuous take", "live director",
      "pin a frame", "end image",
    ],
    tools: [
      "get_director", "open_series", "create_series", "update_series", "save_cue_sheet",
      "derive_cue_sheet", "attach_model_sheet", "set_target_audio", "pin_beat_frame",
    ],
    skills: ["director-series", "cue-sheet", "model-sheets"],
    // NOT seedable, and the four Director surfaces are the first plugins that
    // are not. Seeding exists for a project that predates the marketplace and
    // would otherwise open with its own work missing from the header. No
    // project predates THESE: a Series cannot exist before the plugin that
    // writes one does. A usage counter for them would be an integer that is
    // always zero, bought with a document read on every /api/status.
    seedable: false,
  },
  {
    id: "stage",
    label: "Stage",
    name: "The Stage",
    category: "Visuals",
    tagline: "Play a Series live, and keep the sitting it produces.",
    blurb:
      "Where a Series becomes a film. Press play and a Director session opens: one continuous generation, shaped beat by beat by the cue sheet, arriving as it is made. Two sittings of the same Series are different films — the endpoint is not deterministic — so a sitting is recorded AS IT PLAYS or it cannot be recovered. Kept sittings land in the project like any other render, ready for the Editor, the Cuts tab, or a score.",
    highlights: [
      "One live session at a time — it bills from its first second",
      "A preflight that catches a refusal before you pay for it",
      "Sittings recorded as they play and kept in the project",
      "Reels cut automatically when a sheet outgrows one script",
    ],
    triggers: [
      "the stage", "play the series", "run a sitting", "sitting", "live session",
      "generate the film", "watch it", "director session",
    ],
    tools: ["get_stage", "preflight_sitting", "list_sittings", "forget_sitting"],
    skills: ["director-sitting"],
    // NOT seedable, and the four Director surfaces are the first plugins that
    // are not. Seeding exists for a project that predates the marketplace and
    // would otherwise open with its own work missing from the header. No
    // project predates THESE: a Series cannot exist before the plugin that
    // writes one does. A usage counter for them would be an integer that is
    // always zero, bought with a document read on every /api/status.
    seedable: false,
  },
  {
    id: "shotsheet",
    label: "Shot sheet",
    name: "Shot sheet",
    category: "Visuals",
    tagline: "Draw every pinned frame as ONE short film, then cut them back out.",
    blurb:
      "A pinned frame is the exact picture the Director continues from, so the cheapest way for a pin to hold a style is for a VIDEO model to have drawn it — frames made in an image model are frames the Director has to translate. This renders the whole cue sheet's pins as one clip: one finished frame per pin, each held under a second, hard cut to the next. One pass, so one lighting, one palette and one design across every pin. Then it cuts the clip back into frames and pins them to their beats.",
    highlights: [
      "Every pin drawn in one pass, in one hand",
      "Your model sheets ride along as references",
      "Frames cut back out and pinned to the right beat",
      "The house clause is standing — the sheet's lines are not",
    ],
    triggers: [
      "shot sheet", "shotsheet", "draw the pins", "pin the frames",
      "generate the end images", "frames for the cue sheet", "contact sheet",
    ],
    tools: ["get_shot_sheet", "preview_shot_sheet", "render_shot_sheet"],
    skills: ["shot-sheet"],
    // NOT seedable, and the four Director surfaces are the first plugins that
    // are not. Seeding exists for a project that predates the marketplace and
    // would otherwise open with its own work missing from the header. No
    // project predates THESE: a Series cannot exist before the plugin that
    // writes one does. A usage counter for them would be an integer that is
    // always zero, bought with a document read on every /api/status.
    seedable: false,
  },
  {
    id: "episode",
    label: "Episodes",
    name: "Episodes",
    category: "Post",
    tagline: "The packed episode: shot bundles, prompts and renders.",
    blurb:
      "Where the shot list turns into renders. Every shot is packed into a bundle with its prompt, its character and location references and its voice refs; you review and sign each bundle, render it, and pick the take that goes into the cut. A project that never renders shot by shot — a radio play, a Director piece — can remove it; nothing it wrote is deleted.",
    highlights: [
      "One bundle per shot: prompt, references and voice refs together",
      "Auto-assign references from the Bible's roster",
      "Sign a bundle before it renders",
      "Pick the take that goes into the cut",
    ],
    triggers: [
      "episode tab", "shot bundles", "bundle", "sign the bundle", "assign references",
      "auto-assign refs", "render the shots", "episode prompt",
    ],
    // Only the writes nothing but this tab performs. get_episode, select_reference,
    // select_video, set_episode_style and auto_assign_refs stay ungated: the shot
    // list, moodboard and trim flows lean on them too, and gating them would break
    // those whenever Episodes is off.
    tools: ["rebuild_episode_plan", "save_episode_prompt", "sign_bundle", "link_reference", "select_audio_ref", "attach_episode_video"],
    skills: ["assign-refs"],
    seedable: true,
    // It was core until it became removable, so every project has always had it:
    // pre-installing keeps a new project's header the same as it always was.
    defaultInstalled: true,
  },
  {
    id: "cuts",
    label: "Complete cuts",
    name: "Complete cuts",
    category: "Post",
    tagline: "Stitch the episode into one file, score it, and keep every version.",
    blurb:
      "Where an episode becomes a deliverable. Stitch the selected takes into a single cut, score it against the script, and keep the history — every cut you have ever made stays addressable, loadable back into the Editor, and comparable against the one before it.",
    highlights: [
      "One-click stitch of the selected takes",
      "Every cut kept and versioned",
      "Load any cut back into the Editor timeline",
      "Automatic scoring against the script",
    ],
    triggers: [
      "complete cut", "stitch", "final cut", "export the episode", "render the episode",
      "put it together", "assemble the cut",
    ],
    tools: ["get_cuts", "stitch_cuts", "score_cut", "load_cut_into_editor"],
    skills: ["complete-cut"],
    seedable: true,
  },
  {
    id: "musicalized",
    label: "Musicalized",
    name: "Musicalized version",
    category: "Post",
    tagline: "One continuous cue written to the film you actually got, laid under it.",
    blurb:
      "Scoring a kept sitting. The cue is composed in chunks that turn where the PICTURE turns — measured off the finished film, never off the cue sheet, because the Director's chunks run long and a plan built from the beats is early by seconds. The film's own audio is untouched: the cue fades in beneath it at a low bed level, drops further under the loud windows measured off this take rather than under windows somebody typed, and the sum is limited. The picture's packets are copied rather than re-encoded, so the film you scored is the film you kept.",
    highlights: [
      "A composition plan measured from the film, not the sheet",
      "One continuous cue as long as the piece",
      "Ducked under dialogue the tool actually found",
      "Picture copied, never re-encoded",
    ],
    triggers: [
      "musicalized", "score the film", "score the sitting", "music under it",
      "lay a score", "compose a cue", "scored version",
    ],
    tools: ["get_musicalized", "plan_score", "render_cue", "score_sitting"],
    skills: ["score-film"],
    // NOT seedable, and the four Director surfaces are the first plugins that
    // are not. Seeding exists for a project that predates the marketplace and
    // would otherwise open with its own work missing from the header. No
    // project predates THESE: a Series cannot exist before the plugin that
    // writes one does. A usage counter for them would be an integer that is
    // always zero, bought with a document read on every /api/status.
    seedable: false,
  },
  {
    id: "upscale",
    label: "Upscale",
    name: "Upscale",
    category: "Post",
    tagline: "Take a finished sitting or Deliver render to 1080p, 1440p or 4K.",
    blurb:
      "The last step before a film leaves the studio. The Stage streams at 720p and the Editor renders its 1280×720 timeline, so everything this studio finishes is small by construction. Pick a kept sitting, its scored version or a Deliver render, choose an upscaler and a target resolution, and the pass runs on fal against your own key. The upscaled file lands beside the original as a new file — the source is never touched, so nothing that already uses it changes.",
    highlights: [
      "Stage sittings and Editor renders in one list",
      "SeedVR2, ByteDance and Topaz upscalers",
      "720p up to 4K, billed to your own fal key",
      "The original is never overwritten",
    ],
    triggers: [
      "upscale", "upscaling", "higher resolution", "4k", "1080p", "enhance the video",
      "sharpen the film", "increase resolution",
    ],
    tools: ["list_upscales", "upscale_video", "get_upscale"],
    skills: ["upscale-video"],
    // Nothing predates it — an upscale job cannot exist before the plugin that
    // starts one does.
    seedable: false,
  },
  {
    id: "library",
    label: "Library",
    name: "Library",
    category: "Post",
    tagline: "Every asset the project owns, in folders you control.",
    blurb:
      "The project's asset shelf: uploads, saved generations, imports from your connected provider, organised into folders and marked for final selection. It is where a character sheet lives once you have decided it is THE character sheet, and what `attach_character_sheet` picks from.",
    highlights: [
      "Folders, renaming and final-selection marking",
      "Import past generations from your provider",
      "The source for character and location sheets",
      "Addressable by the agent as `rel` paths",
    ],
    triggers: [
      "library", "assets", "my uploads", "saved images", "import from higgsfield",
      "asset shelf",
    ],
    tools: ["list_library", "toggle_library", "attach_character_sheet", "attach_location_sheet", "attach_character_miniature"],
    skills: ["assign-refs"],
    seedable: true,
  },
];

export const PLUGIN_IDS: string[] = PLUGINS.map((p) => p.id);

// ── Lookups ──────────────────────────────────────────────────────────────────

const BY_ID: Record<string, PluginSpec> = {};
for (const p of PLUGINS) BY_ID[p.id] = p;

export function pluginById(id: string): PluginSpec | null {
  return BY_ID[String(id || "")] || null;
}

export function isCore(id: string): boolean {
  return CORE_IDS.indexOf(String(id || "")) >= 0;
}

export function isPlugin(id: string): boolean {
  return !!BY_ID[String(id || "")];
}

/**
 * Views that are neither core nor a plugin — Settings, Members, the invite
 * landing, and the two hidden sample-code tabs. They are never gated: a surface
 * the marketplace doesn't list can't be installed, so gating it would strand it.
 */
export const UNGATED_VIEWS: string[] = [
  "settings", "members", "accept-invite", "plugins", "shots", "multishot",
];

export function isUngated(view: string): boolean {
  return UNGATED_VIEWS.indexOf(String(view || "")) >= 0;
}

/** Drop unknown ids and duplicates, and never store a core id as a plugin. */
export function normalizeEnabled(ids: unknown): string[] {
  const seen: Record<string, boolean> = {};
  const out: string[] = [];
  const list = Array.isArray(ids) ? ids : [];
  for (const raw of list) {
    const id = String(raw || "");
    if (!BY_ID[id] || seen[id]) continue;
    seen[id] = true;
    out.push(id);
  }
  // Catalog order, not call order, so the header is stable however it was written.
  return PLUGIN_IDS.filter((id) => seen[id]);
}

/**
 * The header, left to right. ONE ordered list of every surface, core and plugin
 * interleaved — because the header reads as a pipeline, not as "the built-ins,
 * then the extras". Images and Videos sit right after the Bible because that is
 * the order the work happens in: read the bible, then find out what it looks
 * like. Putting every plugin after the Editor would bury them behind the end of
 * the pipeline.
 *
 * Anything missing from this list still appears, at the end — a new plugin whose
 * position nobody chose is better in the wrong place than absent.
 */
export const HEADER_ORDER: string[] = [
  "world", "images", "videos", "script", "moodboard", "agents", "shotlist",
  "nodes", "animatic", "radio", "sounds", "musical", "director", "stage",
  "shotsheet", "episode", "cuts", "musicalized", "editor", "upscale", "library",
];

export function headerTabs(enabled: string[]): Surface[] {
  const on = normalizeEnabled(enabled);
  const present: Record<string, Surface> = {};
  for (const c of CORE) present[c.id] = c;
  for (const id of on) present[id] = BY_ID[id] as Surface;

  const out: Surface[] = [];
  const placed: Record<string, boolean> = {};
  for (const id of HEADER_ORDER) {
    if (present[id]) {
      out.push(present[id]);
      placed[id] = true;
    }
  }
  // The safety net for a surface added to the catalog but not to HEADER_ORDER.
  for (const id of Object.keys(present)) if (!placed[id]) out.push(present[id]);
  return out;
}

/**
 * Can this view render? Core and ungated views always can; a plugin view only
 * once it is installed. Returns the plugin that is BLOCKING, or null for "yes".
 */
export function blockingPlugin(view: string, enabled: string[]): PluginSpec | null {
  const id = String(view || "");
  if (!id || isCore(id) || isUngated(id)) return null;
  const spec = BY_ID[id];
  if (!spec) return null; // not a plugin at all — never our business to block
  return normalizeEnabled(enabled).indexOf(id) >= 0 ? null : spec;
}

/**
 * Which plugins a free-text request implies. Used by the agent's safeguard: if
 * one of these is not installed, offer to install it instead of half-running a
 * pipeline that has nowhere to land.
 */
export function pluginsForRequest(text: string): PluginSpec[] {
  const t = String(text || "").toLowerCase();
  if (!t) return [];
  return PLUGINS.filter((p) => p.triggers.some((trigger) => t.indexOf(trigger) >= 0));
}

/** Which plugin owns a given flue tool name, if any. */
export function pluginForTool(tool: string): PluginSpec | null {
  const name = String(tool || "");
  if (!name) return null;
  for (const p of PLUGINS) if (p.tools.indexOf(name) >= 0) return p;
  return null;
}

/** Which plugin owns a given flue skill name, if any. */
export function pluginForSkill(skill: string): PluginSpec | null {
  const name = String(skill || "");
  if (!name) return null;
  for (const p of PLUGINS) if (p.skills.indexOf(name) >= 0) return p;
  return null;
}

// ── Seeding an existing project ──────────────────────────────────────────────
// A project that predates the marketplace has a shot list, a radio pass and a
// sound library already — and would open, on the day this ships, with none of
// them in the header. That reads as data loss even though nothing was lost.
//
// So a project with NO stored plugin document doesn't default to empty: it
// defaults to "whatever it already uses", derived once from the status digest.
// The derivation is READ-ONLY and happens only while the document is absent —
// the first explicit install or removal writes the set and this never runs
// again. It is emphatically not an auto-installer: nothing new ever appears in
// the header because the project grew some content later.
//
// A genuinely blank project seeds to `[]`, which is the point: a new author
// meets three tabs, the pre-installed plugins and a marketplace.
/**
 * The usage counters `GET /api/status` reports, one per seedable plugin id.
 * Built by worker/src/routes/status.js; nothing else may write it.
 */
export interface PluginUsage {
  [pluginId: string]: number;
}

export function seedEnabled(status: unknown): string[] {
  const usage = (status && typeof status === "object"
    ? ((status as Record<string, unknown>).usage as PluginUsage | undefined)
    : undefined) || {};
  const out: string[] = [];
  for (const p of PLUGINS) {
    // Pre-installed regardless of usage — including on a blank project, which is
    // the whole point: a new author should not have to install a way to make a
    // picture before they can make one.
    if (p.defaultInstalled) {
      out.push(p.id);
      continue;
    }
    if (!p.seedable) continue;
    const n = usage[p.id];
    if (typeof n === "number" && n > 0) out.push(p.id);
  }
  return normalizeEnabled(out);
}

/** Installed on a brand-new project without anyone choosing them. */
export const DEFAULT_INSTALLED_IDS: string[] = PLUGINS.filter((p) => p.defaultInstalled).map((p) => p.id);

/** Every plugin whose usage the status digest is expected to count. */
export const SEEDABLE_IDS: string[] = PLUGINS.filter((p) => p.seedable).map((p) => p.id);
