---
name: edit-video
description: >-
  Edit the video editor timeline — the editable, per-clip version of a cut shown
  in the Editor tab (Remotion <Player>). Use when the user wants to "edit the
  video", "open/edit the cut in the editor", "start a new project in the
  editor", "start an edit from scratch", "build a cut clip by clip", "reorder
  the clips", "move/trim a clip on the timeline", "make the music
  quieter/louder", "drop a shot from the edit", "split/cut a clip in two", or
  otherwise change the editor timeline by chatting. There are TWO ways in: load
  a complete cut, or call new_editor_project for an EMPTY timeline you fill from
  the media pool with `insert` ops. Never load a cut when the user asked to
  start fresh, and never start a new project when they asked to edit what's
  open — it replaces their timeline. Then apply non-destructive edits (insert,
  move, trim/resize, split, reorder, remove, volume/mute) that show up live in
  the Editor tab.
---

# Edit video (Remotion editor timeline)

The **Editor** tab holds one editable timeline and previews it live with a
Remotion `<Player>`. The timeline is per-clip JSON — one **video** track of
ordered clips and one **music** track of background cues — measured in **frames**
at the timeline `fps` (24). You and the user edit the *same* timeline: your ops
persist server-side and the Editor tab re-renders when your turn ends. This edits
the editable timeline only; it does not re-render or overwrite the baked
complete-cut mp4s (that's the complete-cut / stitch skill).

**Two ways to fill that timeline**, and picking the wrong one throws away work:

- **From a cut** — `load_cut_into_editor` lays out a stitched cut's clips and
  music exactly as it was assembled. The normal path when the pipeline has
  already produced a cut, a radio version or an animatic.
- **From nothing** — `new_editor_project` gives an EMPTY timeline (a video lane
  and a music lane, no clips) and you build the edit yourself from the media
  pool. Use it when the user says "new project", "start from scratch", "empty
  the timeline", or wants an assembly that no cut describes.

Both REPLACE the timeline that's open. Only start a new project when the user
asked to start fresh — if they just want changes to what they're looking at, go
straight to `edit_timeline`. (The replaced timeline is kept in the document
history, so `restore_version` can bring it back if you get it wrong.)

## Tools

| Tool | What it does |
| --- | --- |
| `get_timeline` | Read the current timeline + the list of cuts you can load. Call FIRST. |
| `load_cut_into_editor` | Load a complete cut's clips + music into the timeline (`v` = version, omit for latest). |
| `new_editor_project` | Start an EMPTY timeline — no cut, no clips. Takes a `name`, plus optional `fps`/`width`/`height` (default 24fps 1280×720; 1080×1920 for vertical). |
| `list_media_pool` | List the source clips an edit can be built from — every rendered video generation + every sound track's latest audio. |
| `edit_timeline` | Apply a list of edit ops to the loaded timeline. |

## Steps

1. **Read the state.** Call `get_timeline`. It returns `{ timeline, cuts }`.
   - If `timeline` is null (nothing loaded), or the user asked to start fresh,
     pick one of the two entry points above: `load_cut_into_editor` — with `v` if
     they named a version, else omit for the latest cut, then confirm which cut
     you loaded (`cuts` lists the versions, their clip/music counts, and whether
     they have music) — or `new_editor_project`, then build it out per step 1b.
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
1b. **Building a NEW project** (only after `new_editor_project`). The empty
   timeline has the lanes but nothing on them, so every clip arrives as an
   `insert` op:
   - **Name it.** Pass `name` to `new_editor_project`. If the user didn't say
     what to call it, ask before creating — a one-line `render_ui` text prompt —
     rather than defaulting to "Untitled project". Renaming later is
     `{ op:'rename', name }`.
   - Call `list_media_pool` to see what exists — `video` (rendered generations,
     each with a `bundle` like `MS-05`) and `audio` (each sound track's latest
     render). An item's `src` is what the inserted clip carries.
   - Decide each clip's LENGTH before inserting. The pool carries no durations;
     take the shot's intended length from the Shot list (`get_shotlist` /
     `list_shots` → `dur` seconds) and convert: `durationInFrames =
     round(dur * fps)`. If a shot has no `dur` and the user hasn't said, ask
     rather than inventing a length for the whole edit.
   - Lay the picture out end to end on the `video` track — the first clip at
     `from: 0`, each next one at the previous `from + durationInFrames` — so
     there are no gaps and no overlaps. Two items overlapping on ONE track is
     invalid; a second simultaneous layer needs `addTrack` first.
   - Insert audio on the `music` track the same way, at the frames it should
     start. Music beds sit low (`volume: 0.08`); dialogue and SFX play at 1.
   - Send the inserts as ONE `edit_timeline` call where you can — it's a single
     write, and the Editor tab picks up the whole assembly at once.
   - Then tell the user what you assembled (how many clips, total length in
     seconds) and that the Editor tab now shows it.

2. **Translate the request into ops**, then call `edit_timeline` with the `ops`
   array. Times are **frames** — convert seconds with `frames = round(seconds * fps)`
   (fps is in the timeline, usually 24, so 2s = 48 frames).
   - Add a clip → `{ op:'insert', trackId:'video', item:{ id, src, name, from,
     durationInFrames } }`. `id` must be new; `src` comes from `list_media_pool`.
     This is the only way to put media on the timeline — `move` and `replace`
     work on clips that are already there.
   - Reorder clips → `{ op:'reorder', track:'video', order:[id, id, …] }` (pass the
     full new order; it repacks the video track gapless automatically).
   - Move a clip to a new start → `{ op:'move', id, from }`. Add `track` to
     also re-home it onto another track of the same media type (the editor is
     multi-track — e.g. lift a sound onto a second audio lane so two items can
     overlap; items on ONE track must never overlap).
   - Add an empty track → `{ op:'addTrack', type:'audio'|'video', id?, name? }`
     (append a lane first, then `move` items onto it).
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
   - Rename the project → `{ op:'rename', name }`. That's the TIMELINE's label
     (the Editor header), not a clip's — a clip's label is `replace`'s `name`.
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
- **A new project starts empty, not blank-ish.** `new_editor_project` is the
  editor's equivalent of File → New: no clips, no music, nothing inherited from
  a cut. It is the wrong tool for "clear the music" or "remove the last shot" —
  those are `remove` ops on the timeline that's already open.
- **Order = playback order for video.** The video track plays its clips by their
  `from`; `reorder`/`repack` lay them back-to-back from frame 0. Music cues keep
  their own start frames so they stay aligned to the beats they underscore — don't
  repack the music track unless the user explicitly wants it re-timed.
- **No Higgsfield / no confirm gate.** These are local timeline edits, not renders
  — they cost no credits, so just apply them (no "confirm the submit" step).
- If the user wants the edited timeline turned back into a single mp4, that's a
  separate step (re-stitch / render) — say so; this skill only edits the timeline.
