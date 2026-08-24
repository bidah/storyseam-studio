// Skill playbooks for the remote MCP server (src/mcp-agent.js), exposed as MCP
// PROMPTS. A prompt is the flue skill's how-to re-pointed at an external client:
// the client's model loads one ("script-writing", "generate-storyboard", …) and
// then drives the same MCP tools flue's skill drives. Kept concise and faithful
// to the flue skills (flue-agent/src/skills/*/SKILL.md); the tool names below are
// the ones ShotStudioMCP registers.
//
// These are authored inline rather than generated from the SKILL.md files to
// avoid a cross-package build coupling. If they start to drift from the flue
// skills, add a sync step (like genui:sync) that regenerates this file.

import { z } from "zod";

const p = (o) => o;

export const SKILL_PROMPTS = [
  p({
    name: "orient",
    title: "Orient in a project",
    description: "Get your bearings before doing anything: pick a project and read where the pipeline stands.",
    render: () =>
      [
        "Help me work on a StorySeam project. First orient yourself:",
        "1. Call list_projects. If I haven't said which project, show me the list and ask.",
        "2. Once a project is chosen, call use_project with its id.",
        "3. Call get_status and summarise where the pipeline stands (world → script → visual → shots → board → voice → render → cut) and what the single next step is.",
        "Then ask me what I want to do.",
      ].join("\n"),
  }),
  p({
    name: "script-writing",
    title: "Write or revise the screenplay",
    description: "Draft or revise the episode's script and save it back to the live pinned draft.",
    argsSchema: { instruction: z.string().optional().describe("What to write or change") },
    render: ({ instruction }) =>
      [
        "Write/revise the StorySeam script.",
        "1. Call use_project first if a project isn't selected yet.",
        "2. Call get_script to read the current pinned draft (a TipTap/ProseMirror JSON `doc`) and get_world for the characters and story so the script stays consistent.",
        "3. Make the change" + (instruction ? `: ${instruction}` : " I ask for") + ", editing the `doc` structure in place — keep it valid ProseMirror JSON.",
        "4. Save with save_script, passing back the whole store object get_script returned (with your edited `doc`). It lands on the live pinned draft and is versioned.",
        "5. Tell me what changed. If I want to compare options, use new_draft / pin_draft. Never overwrite silently — if I lost content, check list_doc_history('script') and offer restore_version instead of rewriting from memory.",
      ].join("\n"),
  }),
  p({
    name: "world-creation",
    title: "Build the World bible",
    description: "Establish the series world: the shaping questions, story depth, characters and locations.",
    render: () =>
      [
        "Build/extend the StorySeam World bible.",
        "1. use_project, then get_world to see what already exists.",
        "2. Fill the `map` (world, protagonist, antagonist, stakes, theme) and `depth` (premise, wantVsNeed, conflict, obstacles, structure) by talking it through with me.",
        "3. Add characters with add_world_character and locations with add_world_location — one call each, name required. Don't duplicate existing roster entries.",
        "4. Summarise the world and what's still thin.",
      ].join("\n"),
  }),
  p({
    name: "shot-list",
    title: "Build the shot list",
    description: "Turn the script into a granular per-shot list that packs into ≤15s multishot bundles.",
    render: () =>
      [
        "Build the StorySeam shot list from the script.",
        "1. use_project, then get_script and get_world for the content, and get_shotlist to see any existing shots.",
        "2. Break the script into ~2-3s shots. Each shot: beat, beatTitle, dur, location, characters, camera, action, dialogue, and a Seedance `prompt`. Group consecutive same-location shots so bundles never cross a beat/location or exceed 15s.",
        "3. Save beat by beat: save_shotlist(mode:'replace') for the FIRST beat, then save_shotlist(mode:'append') for each next beat — not one giant call.",
        "4. CARRY EXISTING shot `id`s through unchanged (they key generated media); only omit `id` for genuinely new shots.",
        "5. Report the pack preview and any new speakers not yet in the World roster.",
      ].join("\n"),
  }),
  p({
    name: "generate-storyboard",
    title: "Generate storyboard stills",
    description: "Generate the storyboard still(s) for shots. SPENDS render credits on the connected account.",
    argsSchema: { shots: z.string().optional().describe("Which shots, e.g. 'MS-01' or 'all missing'") },
    render: ({ shots }) =>
      [
        "Generate storyboard stills" + (shots ? ` for ${shots}` : "") + ". This spends render credits, so confirm scope with me first.",
        "1. use_project, then get_status / get_shotlist to see which shots are missing a still.",
        "2. For each target shot call generate_storyboard with its id/n and prompt (pull the prompt from the shot). Attach any reference the shot needs.",
        "3. It returns a job — poll get_job until it finishes, then report the result. Do a few, then check in rather than firing the whole list blind.",
      ].join("\n"),
  }),
  p({
    name: "generate-multishot",
    title: "Render a multishot video",
    description: "Render a ≤15s multishot bundle as video. SPENDS render credits on the connected account.",
    argsSchema: { bundle: z.string().optional().describe("Which bundle, e.g. 'MS-01'") },
    render: ({ bundle }) =>
      [
        "Render a multishot video" + (bundle ? ` for ${bundle}` : "") + ". This spends render credits — confirm with me first.",
        "1. use_project, then get_episode to see the bundles, their prompts, first frames and what references are still missing.",
        "2. Make sure the bundle's needs are met (first frame chosen, prompt set — save_episode_prompt / set_episode_style if not).",
        "3. Call render_video for the bundle, then poll get_job. When it lands, select_take if I want it as the chosen take.",
      ].join("\n"),
  }),
  p({
    name: "complete-cut",
    title: "Stitch the complete cut",
    description: "Assemble every bundle's selected take, in order, into one cut (optionally over music).",
    render: () =>
      [
        "Stitch the complete cut.",
        "1. use_project, then get_cuts to see the ordered plan — the selected take of each bundle and the music layout.",
        "2. If a bundle has no selected take, fix that first (get_episode → select_take).",
        "3. Call stitch_cut. Poll get_job if it returns one, then report the finished cut and where it landed.",
      ].join("\n"),
  }),
  p({
    name: "recover-lost-content",
    title: "Recover overwritten content",
    description: "Something looks lost or was overwritten — find it in history and restore it.",
    argsSchema: { doc: z.string().optional().describe("Which document, e.g. 'script' or 'world'") },
    render: ({ doc }) =>
      [
        "Something " + (doc ? `in ${doc} ` : "") + "looks lost or wrong. Recover it, don't rewrite it.",
        "1. use_project, then list_doc_history" + (doc ? `('${doc}')` : "(the affected document)") + " — a sudden drop in `size` is the fingerprint of a bad partial save.",
        "2. Identify the last good version by its `ts` and `source`.",
        "3. restore_version(name, ts). It saves the current version first, so it's reversible. Tell me exactly which version (ts + source) you restored.",
      ].join("\n"),
  }),
];
