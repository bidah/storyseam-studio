---
name: shot-sheet
description: >-
  Draw a whole cue sheet's pinned frames as ONE short video — N finished frames,
  hard cut, with the Series' model sheets as references — then cut them back out
  and pin them. Use when a Series' beats have no pinned frames and there is more
  than a couple to draw, when pins made in an image model drift or read as a
  style the Director has to translate, or when re-styling an existing cut
  wholesale. The rule that is expensive to get wrong: a beat's CLOSING frame is
  the pin on the NEXT beat's offset, so a slot's brief is the sentence the beat
  ABOVE it ends on. Do NOT claim the frames are pinned after a render — cutting
  them out happens in the browser.
---

# The cue sheet as one short film

A pinned frame is the exact picture the Director starts a chunk from. The
cheapest way for a pin to HOLD a style is for the **video model** to have drawn
it: frames made in an image model are frames the Director has to translate, and
seventeen separately generated pictures are also seventeen lightings, seventeen
palettes and seventeen readings of the same set.

So ask for the whole cue sheet as one short video that is nothing but its
pinned frames — one finished frame per pin, each held under a second, HARD CUT
— and split it back into them. One pass, one design, one render.

## The one rule that is expensive to get wrong

> **A beat's closing frame is the pin on the NEXT beat's offset.**

Text at an offset STARTS there; an end image at an offset is the exact final
frame AT it. So a slot's brief is the sentence the beat **above** it ends on,
and the opening frame belongs to no beat at all — the film starts on it, and
beat 0 runs forward from it.

`get_shot_sheet` has already done this arithmetic. Read its slots rather than
working the offsets out again; a sheet whose briefs are off by one beat looks
like a model that cannot follow a prompt.

## The order

1. **`get_shot_sheet`** — every slot the cue sheet needs, the brief each one
   suggests, which are already drawn, and which are **refused**. A refused slot
   cannot legally be pinned (too early in a reel, or too close to the pin before
   it); drawing one spends a render on a frame that cannot be used.
2. **Reword the briefs** that need it. Each is ONE finished frame, described —
   a thing that could be printed as a still, not an action.
3. **`preview_shot_sheet`** — free. Read the assembled prompt back. This is how
   you confirm the model is being asked for the frames you think it is.
4. **`render_shot_sheet`** — costs money. Show the author the prompt first.
5. **Poll** with the same tool and the `takeId`.
6. **Stop.** Tell the author the take is ready and to open the Shot sheet tab.

## More frames than one reel: the run plans the reels

A reel holds 16 pins. When the chosen frames need more, the run plans the
**reels** first and draws **one clip per reel** — a clip never crosses a seam.
Rendering writes the plan's seams onto the Series as `reelChanges` (re-planned
from scratch every time). A seam costs frames: the beat a later reel opens on
has no pin, and no pin may sit under 5s after it, so those chosen frames are
**not drawn** — `preview_shot_sheet` lists them in `plan.skipped`; say so to the
author before rendering. More than 4 reel changes is refused before anything is
paid for.

## The sheet is assembled, never typed

The prompt's numbered shot list and the times the frames are grabbed at come out
of the **same array**. A prompt with sixteen shots in it and seventeen grabs
taken out of it is a film whose every pin is one beat wrong — and nothing about
that result looks like a bug. It looks like the model drifting.

So: edit a shot's TEXT. Never hand-write the shot list, the count or the spans.

## What rides along

Up to nine **model sheets** go as reference images, style first, then
characters, then locations — and the prompt names them *Image 1, Image 2*. A
Series with more sheets than that has to choose, and choosing the style plus the
cast is the choice that keeps a film looking like itself.

The clip is rendered in the **Series' own shape**, never a choice: a 16:9 grab
on a vertical Series is a different opening image, not a crop.

## Why you do not cut the frames

The browser already has the clip decoded on screen, so grabbing a frame there
costs nothing, where doing it server-side would mean a video sandbox per sheet.
The author cuts them on the Shot sheet tab and pins them from there.

If they have already cut frames and want them placed, `pin_beat_frame` — one per
frame, by the offset each one is the FINAL FRAME OF. The whole cue sheet is
re-validated on each, so a pin that breaks the spacing comes back as an issue
rather than being saved.

## The house clause

The part of the prompt that is the same every time — how to shoot it and what
must never appear — is standing, kept on the Series as `prompts.shotSheet`. The
shot LINES change every sheet; this does not. Edit it with `update_series`, and
only when a whole run of sheets came back with the same problem.
