---
name: sheet-generation
description: >-
  Generate a CHARACTER SHEET (contact sheet / model sheet / turnaround) or a
  LOCATION SHEET (location design sheet) with the project's dedicated sheet
  prompts, via Nano Banana Pro on the Higgsfield MCP. Use for "generate a
  character/location sheet", "contact / model sheet", "turnaround", "reference
  sheet" — and for ANY location image generation: "create the locations",
  "generate <place name>", "make images for the places". Location art is
  ALWAYS a sheet (style preset + location sheet prompt + a mandatory reference
  image), never a free-form prompt, and the user ALWAYS picks the reference:
  ask_question with candidate thumbnails (or a paperclip attachment) and STOP
  before generating — never auto-pick. You layer the sheet prompt
  (get_visual_world sheetPrompts) between the style preset and the subject,
  attach with attach_visual_generation (sheetType set), and offer to link it
  as the roster's sheetImage.
---

# Character & location sheet generation

A **sheet** is the canonical reference art for one character or one place:

- **Character sheet** — a contact sheet (full-body front, full-body rear, and a
  shoulders-up close-up of the SAME character) used to lock identity across every
  future generation.
- **Location sheet** — ONE single full-frame establishing image of a place: a
  clean background plate (never a collage, grid, or multi-panel contact sheet)
  that locks its architecture, palette and mood, used as the background
  reference for every shot filmed at that location.

Sheets are generated on the **World › Visual** tab like any concept image, but
with the project's **sheet prompt** layered in, and tagged with
`sheetType: "character" | "location"` so the tab badges them and the roster can
link them. The prompts are user-editable on the **Settings** page — always read
them fresh, never improvise your own sheet instructions.

> Mechanics (model resolution, references, polling, attach) are identical to the
> `visual-world` skill — this skill only changes the prompt assembly, the
> `sheetType` tag, and the roster-linking finish. Read that skill for the MCP
> details; the differences are below.

## Step 1 — Gather the brief

- `get_world` — the subject: a character's `appearance` (and name/traits) or a
  location's `description`. If the subject has an existing `sheetImage` or prior
  liked generations, note their `refUrl`s — passing one as a reference keeps the
  design consistent instead of inventing a new one.
- **Locations also need the shot list.** A location sheet exists to serve the
  shots filmed there (it's auto-fed as the background reference for every shot
  at that location), so also call `get_shotlist` and read every shot whose
  `location` slug matches this place: their action/description and Seedance
  prompts tell you what the backdrop must support — the angles, props,
  set-pieces, time of day, and staging space those shots need. Fold those
  requirements into the subject line (e.g. shots need a stoop conversation and
  a chase past parked cars → the sheet must show the stoop and the car-lined
  curb). If the shots at this location disagree (day vs night), surface that
  and ask rather than averaging them.
- `get_visual_world` — take BOTH:
  - the style preset from `prompts[]` (the 2D house style `image` block), and
  - **`sheetPrompts.character` or `sheetPrompts.location`** — the project's sheet
    prompt for this sheet type.

If the user names a character/place that isn't on the roster, ask whether to add
it first (`add_world_character` / `add_world_location`) or just generate.

## Step 2 — Resolve the model (fresh, honoring the project default)

The project's **configured default model** is `settings.model` from
`get_visual_world` (Settings page › Generation defaults; empty string means
Nano Banana Pro). Resolve as in `visual-world`: `models_explore` fresh, then
pick the configured model if set — otherwise the current **Nano Banana Pro**
image model — and read its allowed media role (`image`) if referencing. If the
configured id no longer exists in the catalog, fall back to Nano Banana Pro and
mention it. Never reuse a remembered/recorded model id.

## Step 3 — Assemble the prompt (three layers)

```
<preset.image>            ← house style, from prompts[]

<sheetPrompts.character>  ← or sheetPrompts.location — verbatim, do not rewrite

<one-line subject>        ← who/what: name + appearance/description essentials
```

Join the three blocks with blank lines. **All three layers are mandatory — a
sheet prompt NEVER goes out without the style preset text as its first block**
(paraphrasing the style or relying on the reference image to carry it is not
enough; paste `preset.image` verbatim). If `prompts[]` has no style preset,
stop and ask instead of generating unstyled. The subject line stays short — the
sheet prompt already dictates the layout (views, neutral background, no text);
repeat none of that. Aspect ratio: **the project default `settings.aspectRatio`**
(from `get_visual_world`, normally `16:9`) unless the user asks otherwise. If
the backend rejects that ratio or delivers a different shape, do NOT quietly
keep the wrong-shaped image — say what happened and `ask_question` whether to
keep it, reframe/outpaint it, or regenerate.

## Step 4 — References: optional for characters, REQUIRED for locations

If the character/place already has a `sheetImage` or a liked generation, import
its `refUrl` with `media_import_url` and pass it in `medias[]` (role from Step 2)
— the sheet then formalizes the EXISTING design instead of re-rolling it.

- **Character sheet** — a reference is strongly preferred when any exists; skip
  it only for a brand-new character with no art yet.
- **Location sheet** — a reference image is **MANDATORY, and the USER picks it**:
  a location sheet is always style prompt + sheet prompt + a reference image, so
  the sheet locks an existing look instead of inventing a new place (the Worker's
  own generate route rejects untagged-reference location sheets for the same
  reason). **NEVER auto-pick a reference — not even when exactly one candidate
  looks obvious.** In particular, never silently reuse ANOTHER location's sheet
  as a "style-lock": the style preset already carries the style; the reference's
  job is to ground THIS place. The flow is always ask-first:

  1. Look for candidates **of this place**: the location's `sheetImage`
     (`get_world`), prior generations of this place (`get_visual_world`), or a
     library image (`list_library`).
  2. Show every candidate's thumbnail as markdown (`![](thumb-url)`) and
     `ask_question` which to use — always include an option like
     `{ id:"upload", label:"I'll attach a different reference image" }` —
     then STOP and wait, even if there is only one candidate.
  3. If NONE exist, `ask_question` with options like
     `{ id:"upload", label:"I'll attach a reference image", style:"primary" }`
     and `{ id:"pick-gen", label:"Generate a concept first, then the sheet" }` —
     mention they can attach the image directly in chat (the paperclip). Then
     STOP. When their reply arrives (an attached image comes as an absolute URL
     block in the message), treat it like any `refUrl`: `media_import_url` it
     and generate.

## Step 5 — Generate, poll, attach

`generate_image` → `job_status { sync:true }` → `result_url`, then:

```jsonc
attach_visual_generation {
  "url": "<result_url>",
  "prompt": "<the one-line subject>",
  "assembledPrompt": "<all three layers as sent>",
  "model": "<resolved model id>",
  "aspectRatio": "16:9",
  "presetId": "<style preset id>",
  "sheetType": "character",              // or "location" — REQUIRED for sheets
  "refs": [ { "kind":"generation", "genId":"<source>" } ]   // when referenced
}
```

`sheetType` is what makes it a sheet on the tab (badge + metadata) — never omit
it here, and never set it on ordinary concept images.

## Step 6 — Offer to link it to the roster

When the author approves a sheet, finish the job:

1. `save_generation_to_library { id: "<generation id>", folder: "locations" }`
   (or `"characters"`) — the Worker copies the bytes into the asset library and
   returns the `rel`. This is the ONLY way to get a Visual-tab generation into
   the library — NEVER try to download/re-upload the image yourself (bash has
   no network access; you will just waste turns).
2. Link it: `attach_character_sheet { characterId, rel }` or
   `attach_location_sheet { locationId, rel }`.

A linked location sheet is auto-supplied as an image reference to every shot at
that location; a linked character sheet is the character's canonical portrait.
Offer this step — don't silently overwrite an existing `sheetImage` without
asking.

## Interaction rules

- **Confirm before the submit, every time.** Before `generate_image`, show the
  full three-layer assembled prompt, the chosen reference (as a thumbnail), and
  the model, then wait for an explicit go-ahead. A standing instruction like
  "generate the locations" or "go one at a time" authorizes the TASK, not a
  specific prompt + reference — the user still confirms each first submit.
- Otherwise same as `visual-world`: keep chat short, let the images do the
  talking, no raw IDs/JSON in chat.
- One subject per sheet. "Sheets for all my characters" = loop this skill per
  character, confirming the batch once.
