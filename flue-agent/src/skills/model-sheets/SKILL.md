---
name: model-sheets
description: >-
  Make the reference art a Director Series is drawn against — character, mecha,
  vehicle and location turnarounds in one house style, with the negatives that
  actually keep two similar characters apart and the trick that makes a
  turnaround state SIZE. Use when a Series has no model sheets, when new
  characters or machines enter a cut, when a design drifts between beats, or
  before generating any pinned frame that needs something to be consistent with.
  The negatives that work name the CONFUSABLE SIBLING, not the abstract mistake —
  generic negatives on a Series' opening prompt do not bite. Do NOT use for the
  Bible's character sheets, which are a different surface with a different job.
---

# The art everything else is drawn against

A model sheet is the one thing on a Series that is **never sent anywhere**. No
session carries them. They exist because a piece generated over many beats
drifts, and a sheet is what the drift is checked against — and because every
pinned frame references them, so identity comes from one place instead of from
whatever was made last.

They are also what the Shot sheet hands the video model as references, named in
its prompt as *Image 1, Image 2*.

`kind` is `character`, `location` or `style`. A mecha, a ship and an alien war
machine are all `character`: the kind is about whether the thing is a FIGURE
held still across a piece, not about whether it is alive.

## The form

**One subject per sheet.** Four consistent full-body views evenly spaced in a
row — **front, 3/4, side profile, back** — plus **one detail close-up at the far
right**, on a plain neutral pale grey background. For a character the detail is
head-and-shoulders with an expression; for a machine it is whatever identifies
it (the chest canopy, the forearm cannon, the glowing core).

A **location** sheet is three views instead: a wide establishing view, a mid
view from inside it, and a detail of one piece of architecture.

Say *"the same machine, the same markings, the same proportions in every view"*
explicitly. It does work.

**Neutral pose, neutral light:** an A-pose, arms relaxed, both feet flat, even
flat model-sheet lighting and soft ambient shading. A sheet lit dramatically is
a picture, not a reference.

## Hold the render clause identical

Every sheet in a Series carries the **same** style sentence, varied only by
palette. Retyping it from memory is how one house style becomes three — keep it
in one place and format the palette in.

## Negatives are where identity is actually won

Generic negatives on the Series' opening prompt do not bite. The ones that work
are on the sheet and name the **confusable sibling**:

- A second woman drifts toward the first. Mika gets *"no white command uniform,
  no bob haircut, no gold shoulder cords"* — Ren's exact features, refused.
- A squadmate's machine drifts toward the hero's. Each gets *"no orange
  markings, no yellow markings"* — every colour but its own.
- A boy of 17 drifts toward a boy of 12. He gets *"no dark brown hair"*.

Alongside the standing set: no text, no watermark, no logos, no frame borders,
no background scenery, no other characters, no modern 3D gloss, no
photorealism.

**One colour per machine** is the identity rule that makes this possible: state
in the Series' opening prompt that a given mecha is *the only* one with its
marking, and give every other machine plain grey. A cast told apart by
silhouette alone will not hold across thirty beats.

## To state SIZE, draw the scale

A turnaround on a plain background has no scale. Prose does not fix this — *"as
large as a mecha"* gets ignored, and the thing comes back reading as a fighter.

What works: **put a flat grey silhouette of a known object beside the side
profile, at true relative scale**, and say what the relationship is.

> beside the side profile stands a plain flat grey silhouette of a standard
> humanoid mecha at true relative scale, reaching only to this machine's chest

Then drop any negative that would forbid the silhouette ("no other mechas").

## How to actually make one here

The Director does not generate pictures. It points at ones this project made.

1. `get_director` with `art: true` — the settings come off the Series, not out
   of memory. A Series that changed shape changed them.
2. Generate on the **Images** tab (`attach_visual_generation`), at
   `art.sheets.aspectRatio`, tagged `sheetType: "character"` or `"location"`.
3. `attach_model_sheet` — the picture, its prompt **verbatim**, and the model
   that drew it.

Keep the prompt. A sheet kept without the prompt that made it is a look that
cannot be extended, and a sheet made by feeding a model two other pictures
cannot be remade from the prompt alone either — put those in `refs`.

## Why sheets are 16:9 and 2k when a pinned frame is neither

`art.sheets` says 16:9 whatever shape the Series is, and a higher resolution
than a still gets. Both are the same reason: a turnaround spends its width on
four or five views. The same pixels in 9:16, or at a still's resolution, leave
each view around 200px — too small to reference, which is the only thing a
sheet is for.

A pinned frame is the opposite case: it is the exact frame the Director
continues from, so it is the Series' own shape, always, and there is nothing to
gain above what the film renders at.
