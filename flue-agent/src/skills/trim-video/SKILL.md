---
name: trim-video
description: >-
  Trim a rendered episode take down to a sub-range (in/out seconds) with ffmpeg,
  saving the cut as a NEW "trim" version next to the original. Use when the user
  wants to "trim this take", "cut the clip from X to Y", "make a shorter version",
  or clicks the Trim button on a bundle's video in the Episode tab. The original
  is never overwritten — it stays in history and stays selectable; the trim shows
  up as an extra card in the bundle's carousel with a TRIM VERSION badge.
---

# Trim video (episode take → trimmed version)

Trims one rendered take of an episode bundle to an in/out range and stores the
result as a **new, selectable version** — object versioning, not a destructive
edit. The source take is kept, so the user can flip between the full "complete
version" and any "trim version" in the Episode-tab carousel and pick either one
for the complete-cut stitch.

## When this runs

The **Trim** button on a bundle's video carousel (Episode tab) sends a chat turn
naming the bundle, the source take's `file`, and the `from`/`to` seconds the user
set with the in/out handles. You do not need to invent the range — it is in the
message. You can also be asked in free text ("trim MS-04's selected take to
2s–7s").

## Steps

1. **Identify the source take.** You already have the bundle id and the source
   `file` from the Trim message. If the user asked in free text and only named a
   bundle, call `get_cuts` (or rely on the episode video list) to find the
   bundle's takes and pick the selected one as the source unless told otherwise.
2. **Call `trim_video`** with:
   - `bundle` — e.g. `MS-04`
   - `sourceFile` — the take's `file`, e.g. `MS-04_gen2.mp4`
   - `from`, `to` — seconds (floats fine). `to` must be ≥ 0.1s after `from`; the
     server clamps the range to the clip length.
3. **Report the result.** The tool returns `{ url, file, name, kind:"trim", trim,
   count }`. Tell the user the trim is ready and appears as a new card
   (TRIM VERSION badge) in the bundle's carousel, and that they can select it
   there to use it in the stitched cut. The Episode tab refreshes automatically
   when your turn finishes.

## Notes

- **Non-destructive.** `trim_video` never overwrites the source; it writes a new
  file `<sourceBase>_trimN.mp4` and inserts it right after the original in the
  carousel. Re-trimming the same take mints `_trim2`, `_trim3`, … — the user can
  keep several attempts.
- **Selection is separate.** A fresh trim is NOT auto-selected. The user (or a
  follow-up `select_video` call, if asked) chooses whether the trim or the
  original feeds the stitch. Selection is single-per-bundle and keyed on `file`,
  so selecting a trim just deselects the others.
- **You can trim a trim.** Passing a trim's `file` as `sourceFile` is fine.
- **No Higgsfield / no confirm gate.** This is a local ffmpeg cut, not a render —
  it does not cost credits, so no "confirm the submit" step is needed. Just do it.
- After trimming, if the user wants it in the episode, remind them to select the
  trim card, then re-stitch (see the complete-cut skill).
