---
name: edit-video
description: >-
  Edit the video editor timeline — the editable, per-clip version of a complete
  cut shown in the Editor tab (Remotion <Player>). Use when the user wants to
  "edit the video", "open/edit the cut in the editor", "reorder the clips",
  "move/trim a clip on the timeline", "make the music quieter/louder", "drop a
  shot from the edit", "split/cut a clip in two", or otherwise change the editor
  timeline by chatting. Loads a complete cut into the timeline and applies
  non-destructive edits (move, trim/resize, split, reorder, remove, volume/mute)
  that show up live in the Editor tab.
---

# Edit video (Remotion editor timeline)

The **Editor** tab loads a complete cut into an editable timeline and previews it
live with a Remotion `<Player>`. The timeline is per-clip JSON — one **video**
track of ordered clips and one **music** track of background cues — measured in
**frames** at the timeline `fps` (24). You and the user edit the *same* timeline:
your ops persist server-side and the Editor tab re-renders when your turn ends.
This edits the editable timeline only; it does not re-render or overwrite the
baked complete-cut mp4s (that's the complete-cut / stitch skill).

## Tools

| Tool | What it does |
| --- | --- |
| `get_timeline` | Read the current timeline + the list of cuts you can load. Call FIRST. |
| `load_cut_into_editor` | Load a complete cut's clips + music into the timeline (`v` = version, omit for latest). |
| `edit_timeline` | Apply a list of edit ops to the loaded timeline. |

## Steps

1. **Read the state.** Call `get_timeline`. It returns `{ timeline, cuts }`.
   - If `timeline` is null (nothing loaded), and the user wants to edit, call
     `load_cut_into_editor` first — with `v` if they named a version, else omit
     for the latest cut. Confirm which cut you loaded (`cuts` lists the versions,
     their clip/music counts, and whether they have music).
   - If `timeline` already exists, use its items. Each track (`video`/`music` on
     a cut, `picture`/`dialogue` on an animatic) lists items with `id`, `name`,
     `from` (start frame), `durationInFrames`, `volume`, and optionally
     `offsetFrames` — the clip's **source in-point** (how many frames of the
     source file are skipped at its head; absent = 0. Set by splits and head
     trims — the item plays source frames
     `[offsetFrames, offsetFrames + durationInFrames)`). Note the `id`s and
     order — every edit op targets an item by `id`.
   - An item with **`kind: "image"`** is a storyboard STILL held on screen (the
     animatic's picture), and one with `kind:"image"` and **no `src` is a SLATE**
     — a shot whose still hasn't been generated yet. A still has no source
     timeline: its `offsetFrames` is always 0, it has no `sourceDurationInFrames`
     (so resizing it is uncapped — it holds for as long as you like), and
     splitting it just holds the same frame either side of the cut. Image items
     carry `shot` (which shot's picture slot this is) and `stillFile` (which take
     is showing). To fill a slate, generate with the **generate-storyboard**
     skill and use `replace` — never `move`/`remove`.
2. **Translate the request into ops**, then call `edit_timeline` with the `ops`
   array. Times are **frames** — convert seconds with `frames = round(seconds * fps)`
   (fps is in the timeline, usually 24, so 2s = 48 frames).
   - Reorder clips → `{ op:'reorder', track:'video', order:[id, id, …] }` (pass the
     full new order; it repacks the video track gapless automatically).
   - Move a clip to a new start → `{ op:'move', id, from }`.
   - Trim/extend a clip's end → `{ op:'resize', id, durationInFrames }`.
   - Trim/extend a clip's start → `{ op:'resize', id, durationInFrames, edge:'start' }`
     (the clip's end stays anchored; its source in-point slides with the start).
   - Split a clip in two at a time → `{ op:'split', id, at: round(seconds * fps) }`.
     `at` is the **absolute timeline frame** and must fall strictly inside the clip.
     The right half is a **new item** continuing seamlessly at the same source
     position — re-read the returned timeline for its id before editing it. A
     clip's linked partner (e.g. its detached audio) splits at the same frame
     automatically. Typical "cut out the middle" flow: split at both ends of the
     unwanted span, `remove` the middle piece, then `repack` to close the gap.
   - Drop a clip or music cue → `{ op:'remove', id }`.
   - Music/clip volume → `{ op:'volume', id, volume }` (1 = unity, 0.5 = half,
     0 = silent; music beds are quiet by default, ~0.08). Or `{ op:'mute', id, muted:true }`.
   - Disable/enable a clip → `{ op:'disable', id, disabled:true }` (greys it out and
     skips it in playback while keeping it on the timeline; `disabled:false` re-enables).
     Prefer this over `remove` when the user wants to "turn off", "grey out", "skip", or
     temporarily hide a clip without deleting it.
   - Close gaps after edits → `{ op:'repack', track:'video' }` (reorder already does this).
3. **Report the result.** `edit_timeline` returns `{ ok, timeline }` with the
   updated timeline. Tell the user what changed in plain terms (e.g. "moved MS-05
   before MS-04 and closed the gap", "muted the music") and that the Editor tab
   preview updates when your turn finishes.

## Notes

- **Frames, not seconds.** All positions/lengths are integer frames at the
  timeline fps. Always convert the user's seconds before calling `edit_timeline`.
- **Non-destructive.** Editing the timeline never touches the rendered clip files
  in `/gen` or the stitched cut mp4s — it only rearranges references to them. To
  load a fresh copy of a cut and discard timeline edits, call
  `load_cut_into_editor` again.
- **Order = playback order for video.** The video track plays its clips by their
  `from`; `reorder`/`repack` lay them back-to-back from frame 0. Music cues keep
  their own start frames so they stay aligned to the beats they underscore — don't
  repack the music track unless the user explicitly wants it re-timed.
- **No Higgsfield / no confirm gate.** These are local timeline edits, not renders
  — they cost no credits, so just apply them (no "confirm the submit" step).
- If the user wants the edited timeline turned back into a single mp4, that's a
  separate step (re-stitch / render) — say so; this skill only edits the timeline.
