---
name: sheet-generation
description: >-
  Generate a CHARACTER SHEET (contact sheet / model sheet / turnaround) or a
  LOCATION SHEET (location design sheet) with the project's dedicated sheet
  prompts, via Nano Banana Pro on the Higgsfield MCP. Use when the user asks to
  "generate a character sheet", "make a contact sheet / model sheet /
  turnaround", "character reference sheet", "generate a location sheet",
  "location reference / design sheet", or to "make a sheet" for a named
  character or place. You layer the project's
  sheet prompt (from get_visual_world's sheetPrompts) between the style preset
  and the subject, generate, attach with attach_visual_generation
  (sheetType set), and offer to link the result as the roster's sheetImage.
---

# Character & location sheet generation

A **sheet** is the canonical reference art for one character or one place:

- **Character sheet** — a contact sheet (full-body front, full-body rear, and a
  shoulders-up close-up of the SAME character) used to lock identity across every
  future generation.
- **Location sheet** — a location design sheet (establishing wide shot + key-angle
  shots) that locks a place's architecture, palette and mood.

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
- `get_visual_world` — take BOTH:
  - the style preset from `prompts[]` (the 2D house style `image` block), and
  - **`sheetPrompts.character` or `sheetPrompts.location`** — the project's sheet
    prompt for this sheet type.

If the user names a character/place that isn't on the roster, ask whether to add
it first (`add_world_character` / `add_world_location`) or just generate.

## Step 2 — Resolve the model (fresh)

Exactly as in `visual-world`: `models_explore` fresh, pick the current **Nano
Banana Pro** image model, read its allowed media role (`image`) if referencing.
Never reuse a remembered/recorded model id.

## Step 3 — Assemble the prompt (three layers)

```
<preset.image>            ← house style, from prompts[]

<sheetPrompts.character>  ← or sheetPrompts.location — verbatim, do not rewrite

<one-line subject>        ← who/what: name + appearance/description essentials
```

Join the three blocks with blank lines. The subject line stays short — the sheet
prompt already dictates the layout (views, neutral background, no text); repeat
none of that. Aspect ratio: `16:9` unless the user asks otherwise.

## Step 4 — Reference when identity exists

If the character/place already has a `sheetImage` or a liked generation, import
its `refUrl` with `media_import_url` and pass it in `medias[]` (role from Step 2)
— the sheet then formalizes the EXISTING design instead of re-rolling it. Skip
references only for brand-new subjects.

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

1. The image must be in the asset library first — the tab's **Save to library**,
   or ask and use the save-to-library flow; you need the library `rel`.
2. Link it: `attach_character_sheet { characterId, rel }` or
   `attach_location_sheet { locationId, rel }`.

A linked location sheet is auto-supplied as an image reference to every shot at
that location; a linked character sheet is the character's canonical portrait.
Offer this step — don't silently overwrite an existing `sheetImage` without
asking.

## Interaction rules

- Same as `visual-world`: confirm the first submit (subject + refs + model),
  keep chat short, let the images do the talking, no raw IDs/JSON in chat.
- One subject per sheet. "Sheets for all my characters" = loop this skill per
  character, confirming the batch once.
