---
name: sheet-generation
description: >-
  Generate a CHARACTER, LOCATION, or PROP SHEET (contact sheet/turnaround)
  with the project's sheet prompts via the Higgsfield MCP. Use for any
  sheet/turnaround/reference-sheet request — and ANY location image
  generation ("create the locations"). Location and prop art is ALWAYS a
  sheet (style preset + sheet prompt + a mandatory reference image), and the
  user ALWAYS picks the reference: an image ATTACHED to the requesting
  message IS that pick — use it, don't re-ask; otherwise render_ui a
  MediaGrid of candidates and STOP — never auto-pick. Honor Settings ›
  Generation defaults (settings.model, empty = Nano Banana Pro;
  settings.resolution 1k/2k/4k); confirm EVERY submit with a render_ui
  one-per-group OptionList picking model + resolution; model options ALWAYS
  include Seedream and GPT Image alongside the default and a Soul model.
  Layer the sheet prompt (get_visual_world sheetPrompts) between style preset
  and subject, attach with attach_visual_generation (sheetType set), and show
  the sheet as a render_ui MediaGrid.
---

# Character, location & prop sheet generation

A **sheet** is the canonical reference art for one character, one place, or one
prop:

- **Character sheet** — a contact sheet (full-body front, full-body rear, and a
  shoulders-up close-up of the SAME character) used to lock identity across every
  future generation.
- **Location sheet** — ONE single full-frame establishing image of a place: a
  clean background plate (never a collage, grid, or multi-panel contact sheet)
  that locks its architecture, palette and mood, used as the background
  reference for every shot filmed at that location.
- **Prop sheet** — multi-view reference art of ONE object a character carries or
  handles (front, three-quarter, and side/back views plus a detail close-up),
  shown on its own with no characters or hands, used as the identity reference
  the video models lock onto whenever that prop appears in a shot.

Sheets are generated on the **World › Visual** tab like any concept image, but
with the project's **sheet prompt** layered in, and tagged with
`sheetType: "character" | "location" | "prop"` so the tab badges them and the
roster can link them. The prompts are user-editable on the **Settings** page —
always read them fresh, never improvise your own sheet instructions.

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
- **Props have no roster.** The subject comes from the user's request plus the
  shot list: `get_shotlist` and read the shots that feature the object (how it
  is held, used, and lit) so the sheet shows the exact object those shots need.
- `get_visual_world` — take BOTH:
  - the style preset from `prompts[]` (the 2D house style `image` block), and
  - **`sheetPrompts.character`, `sheetPrompts.location`, or `sheetPrompts.prop`**
    — the project's sheet prompt for this sheet type.

If the user names a character/place that isn't on the roster, ask whether to add
it first (`add_world_character` / `add_world_location`) or just generate.

## Step 2 — Resolve the model AND resolution (fresh, honoring the project defaults)

The project's **configured defaults** come from `get_visual_world` `settings`
(Settings page › Generation defaults): `settings.model` (empty string means
Nano Banana Pro) and `settings.resolution` (`1k` / `2k` / `4k`). Resolve as in
`visual-world`: `models_explore` fresh, then pick the configured model if set —
otherwise the current **Nano Banana Pro** image model — and read its allowed
media role (`image`) if referencing. If the configured id no longer exists in
the catalog, fall back to Nano Banana Pro and mention it. Never reuse a
remembered/recorded model id.

The resolution rides as the `resolution` param on `generate_image` — but ONLY
when the chosen model's `models_explore` entry lists a `resolution` parameter
(Nano Banana Pro/2 do; Soul models don't — omit it there). While you have the
catalog open, note the model's `resolution` options and the alternative models
for the confirmation card (Interaction rules). The alternatives are a FIXED
roster, not your judgment call: the current **Seedream** image model (e.g.
Seedream 5.0), the current **GPT Image** model (e.g. GPT-Image 2), and one
**Soul** model (e.g. Soul Cinema) — each resolved fresh from `models_explore`
(skip a family only if the catalog no longer carries it, and say so).

## Step 3 — Assemble the prompt (three layers)

```
<preset.image>            ← house style, from prompts[]

<sheetPrompts.character>  ← or .location / .prop — verbatim, do not rewrite

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
keep the wrong-shaped image — say what happened and `render_ui` whether to
keep it, reframe/outpaint it, or regenerate.

## Step 4 — References: attached image first; REQUIRED for locations and props

**An image attached to the requesting message IS the user's reference pick.**
When the message carries an `Attached reference image(s) (absolute URLs …):`
block, use that attachment as THE reference — `media_import_url` its URL and
pass it in `medias[]` (role from Step 2) — and do **not** re-ask the reference
question; the user already picked by attaching. This applies to character,
location, and prop sheets alike. (The confirm-before-submit rule still applies:
show the attachment as the chosen reference in the confirmation.) Only when NO
image is attached does the ask-first flow below run.

If the character/place already has a `sheetImage` or a liked generation, import
its `refUrl` with `media_import_url` and pass it in `medias[]` (role from Step 2)
— the sheet then formalizes the EXISTING design instead of re-rolling it.

The `refUrl`, never the `thumb` or `display` beside it: those are downscaled webp
copies for showing the author, and referencing one would have the model match a
blurred version of the design you are trying to hold constant.

- **Character sheet** — a reference is strongly preferred when any exists; skip
  it only for a brand-new character with no art yet.
- **Prop sheet** — a reference image is **MANDATORY, and the USER picks it** —
  the same ask-first flow as locations below: candidates are prior generations
  of this prop (`get_visual_world`) or a library image (`list_library`); show
  every candidate in a `MediaGrid` (always alongside an
  `Action("Upload a reference image", "I'll attach a reference image")` — in the
  app it opens the media picker: PC upload, library, or prior generations), then STOP.
  If none exist, `render_ui` for an upload or offer to concept the prop
  first — never generate a prop sheet with no reference and no user pick.
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
  2. `render_ui` a `MediaGrid` of every candidate's thumbnail, asking which to
     use — always alongside an
     `Action("Upload a different reference image", "I'll attach a reference image")` —
     then STOP and wait, even if there is only one candidate.
  3. If NONE exist, `render_ui` `Actions` like
     `Action("Upload a reference image", "I'll attach a reference image", "primary")`
     and `Action("Generate a concept first", "Concept it first, then do the sheet")`.
     Keep the upload label CLEAN — no parenthetical about paperclips or how to
     attach; in the app that option opens the media picker (PC upload, library,
     or prior generations). Then STOP. When their reply arrives (a picked image
     comes as an absolute URL block in the message), treat it like any
     `refUrl`: `media_import_url` it and generate.

## Step 5 — Generate, poll, attach

`generate_image` → `job_status { sync:true }` → `result_url`, then:

```jsonc
attach_visual_generation {
  "url": "<result_url>",
  "prompt": "<the one-line subject>",
  "assembledPrompt": "<all three layers as sent>",
  "model": "<resolved model id>",
  "aspectRatio": "16:9",
  "resolution": "2k",                    // when the generate call carried one
  "presetId": "<style preset id>",
  "sheetType": "character",              // or "location" / "prop" — REQUIRED for sheets
  "refs": [ { "kind":"generation", "genId":"<source>" } ]   // when referenced
}
```

`sheetType` is what makes it a sheet on the tab (badge + metadata) — never omit
it here, and never set it on ordinary concept images.

## Step 6 — Offer to link it to the roster

When the author approves a sheet, finish the job:

1. `save_generation_to_library { id: "<generation id>", folder: "locations" }`
   (or `"characters"` / `"props"`) — the Worker copies the bytes into the asset
   library and returns the `rel`. This is the ONLY way to get a Visual-tab
   generation into the library — NEVER try to download/re-upload the image
   yourself (bash has no network access; you will just waste turns).
2. Link it: `attach_character_sheet { characterId, rel }` or
   `attach_location_sheet { locationId, rel }`. Props have no roster link —
   for a prop the library save above IS the finish (later generations reference
   it from the library).

A linked location sheet is auto-supplied as an image reference to every shot at
that location; a linked character sheet is the character's canonical portrait.
Offer this step — don't silently overwrite an existing `sheetImage` without
asking.

## Interaction rules

- **Confirm before the submit, every time — as a render_ui card that lets the
  user pick the model and resolution.** Before `generate_image`, draw ONE card:
  a `KeyValue` summarizing the submit (subject, style preset, aspect ratio,
  sheet type) plus the chosen reference as a `MediaGrid` thumbnail (no `send`),
  then an `OptionList` with `select: "one-per-group"` holding TWO groups —
  `group: "Model"` (the project default model plus ALL the Step 2 alternatives
  — Seedream, GPT Image, and a Soul model — noun-phrase `send`s, the default
  marked `selected` and badged "Default") and `group: "Resolution"` (the chosen model's `resolution` options,
  e.g. 1k / 2k / 4k, `settings.resolution` marked `selected`; skip this group
  when the model has no `resolution` parameter) — with
  `send: "Generate the sheet with"` and `confirm: "Generate"`. Then STOP; the
  confirm posts the picks (e.g. "Generate the sheet with: Nano Banana Pro, 2k")
  and you generate with exactly those. A standing instruction like "generate
  the locations" or "go one at a time" authorizes the TASK, not a specific
  prompt + reference — the user still confirms each first submit. If they pick
  a model whose options exclude the default resolution, use the closest option
  it does offer and say so.
- Otherwise same as `visual-world`: keep chat short, let the images do the
  talking, no raw IDs/JSON in chat.
- One subject per sheet. "Sheets for all my characters" = loop this skill per
  character, confirming the batch once.
