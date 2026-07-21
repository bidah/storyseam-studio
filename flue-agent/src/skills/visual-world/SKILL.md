---
name: visual-world
description: >-
  Explore the VISUAL world of the series on the World › Visual tab — generate
  concept images to discover how the characters and places look, with Nano Banana
  Pro via the Higgsfield MCP. Use when the user is on the World › Visual screen
  (clientContext screen = "world/visual" or "visual"), presses "Let the agent
  explore", or asks to "explore the look", "how do the characters look", "visualize
  the world", "generate character concepts / designs", "concept art", "find the
  look", "mood / style exploration", or to iterate an image "with this one as a
  reference". You generate images with generate_image, then attach each with
  attach_visual_generation so it lands live on the Visual tab.
---

# Visual world exploration (World › Visual tab)

The **Visual** sub-tab of the World tab is a concept-art playground: the *written*
world (story map, characters) already exists — here you help the author **find the
look**. Generate concept images for characters and places, iterate on the ones
they like (passing a chosen image back as a reference), and build up a board they
can arrange on the **Visual nodes** canvas. Built on the **Higgsfield MCP**
(`mcp__higgsfield__*`), using **Nano Banana Pro** by default.

> **The images do the talking.** Keep chat short. Generate, attach, and let the
> author react on the tab — don't narrate long descriptions of what you'll draw.

## How it fits together

- Written world → `get_world` (characters' `appearance`, the world/theme). This is
  your brief for what to draw.
- Visual world so far → `get_visual_world` (the prompt library + existing
  generations you can reuse as references).
- You generate with the Higgsfield MCP, then **`attach_visual_generation`** with
  the result URL — the Worker downloads it and it appears on the Visual tab live.

## The MCP tools are already available

`mcp__higgsfield__generate_image`, `mcp__higgsfield__job_status`,
`mcp__higgsfield__models_explore`, `mcp__higgsfield__media_upload`,
`mcp__higgsfield__media_confirm`, `mcp__higgsfield__media_import_url`,
`mcp__higgsfield__balance` — call them directly, no loading step.

## Step 1 — Resolve the Nano Banana Pro model id

Do NOT hardcode a model id. Call `models_explore` (list image models, or
`action:'recommend'` with the goal "flat 2D storybook character concept art") and
pick the **Nano Banana Pro** image model it returns. Reuse that id for the batch.

## Step 2 — Write the prompt with the house style

Call `get_visual_world` and take the prompt library's **2D preset** (`prompts[]`,
the one whose `image` block describes the flat 2D Scandinavian-storybook style).
Build each prompt as: **`<preset.image>` + a one-line scene** (which character/
place, pose/expression, setting, framing). Keep the house style identical across a
batch so the characters read as one world. Draw only what the author's brief
supports — don't invent a design they haven't described; offer options instead.

## Step 3 — References (optional but powerful)

Two ways to lock identity as the exploration converges:

- **From the library / a prior generation** — to keep a character consistent, pass
  a chosen image as an `image_references` media. Convert its URL to a media_id with
  `media_import_url { url }` (or upload a local file via `media_upload` +
  `media_confirm`), then add `{ role:"image_references", value:"<media_id>" }` to
  the `generate_image` `medias[]`. **This is how "redo it but with this one as a
  reference" works** — the user picks an image, you feed it back.
- Nano Banana Pro accepts **many** `image_references`.

## Step 4 — Generate (batch when asked)

If the user asked for several options, loop `generate_image` N times (same prompt
or small variations). Preflight cost (`get_cost:true`) if useful, then:

```jsonc
mcp__higgsfield__generate_image {
  "params": {
    "model": "<NANO_BANANA_PRO id from models_explore>",
    "prompt": "<preset.image>\n\n<one-line scene>",
    "aspect_ratio": "16:9",
    "medias": [ { "role":"image_references", "value":"<media_id>" } ]   // only when referencing
  }
}
```

If the response is a `preset_recommendation`, resend with
`declined_preset_id:"<id>"` to generate the prompt literally.

## Step 5 — Poll

```jsonc
mcp__higgsfield__job_status { "jobId": "<id>", "sync": true }
```
Repeat until `status:"completed"`; read `result_url`.

## Step 6 — Attach so it lands on the tab

For each finished image:

```jsonc
attach_visual_generation {
  "url": "<result_url>",
  "prompt": "<the one-line scene you wrote>",
  "assembledPrompt": "<the full prompt incl. the style preset>",
  "model": "<the model id you resolved>",
  "aspectRatio": "16:9",
  "presetId": "<preset id from get_visual_world, if used>",
  "refs": [ { "kind":"generation", "genId":"<source gen id>" } ]   // when you referenced one
}
```

The image appears on the **World › Visual** tab immediately (and can be dropped
onto the **Visual nodes** canvas, where the author draws reference-lineage links).

## Step 7 — Iterate

Show the author what landed (briefly), ask which direction they like, then either
refine the prompt or **pass their pick back as a reference** and generate the next
round. When a look is locked, they can **Save to library** on the tab and link it
as a character sheet on the written World tab — or you can offer to.

## Saving a style (optional)

If the user refines the house style and wants it reusable, call `get_visual_world`,
edit/add the preset, and `save_visual_prompt` with the FULL prompt list (keep the
presets you're not changing).

## Interaction rules

- Confirm the first Higgsfield submit (prompt + refs + model) with the author, then
  proceed through the batch.
- State which references you used. No raw IDs/JSON in chat. Use the MCP, never a CLI.
- See also: `generate-storyboard` (per-shot stills for the Episode tab) — the same
  MCP mechanics; this skill is the free-form character/world exploration counterpart.
