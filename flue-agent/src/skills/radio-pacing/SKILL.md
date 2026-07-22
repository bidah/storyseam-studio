---
name: radio-pacing
description: >-
  Editorial pacing pass over the radio-version timeline in the Editor. "Send to
  editor" lays the voiced lines back-to-back — gapless, no sense of time. This
  skill re-times that first pass using the Shot list: beat changes get air,
  quick exchanges stay tight, and silent shots between spoken lines become real
  pauses, so the audio-only cut plays like a story instead of a read-through.
  Use when the user presses "Agent pacing" on the Radio tab, or asks to "pace
  the radio version", "add space between the lines", "make the radio cut
  breathe", or "re-time the dialogue".
---

# radio-pacing (re-time the radio timeline so the story breathes)

The radio first pass is deliberately dumb: every rendered line laid gapless in
order on the **Dialogue** track. Your job is the second pass — an *editorial*
one. You do not render, trim, or reorder anything. You only decide **how much
silence sits between each pair of lines**, and move the takes accordingly.

## Tools

| Tool | What for |
| --- | --- |
| `get_timeline` | The loaded radio timeline. Dialogue items are `rl_sh<n>` — `n` is the shot number. |
| `get_shotlist` | The pacing source: each shot's `dur` (planned seconds), `action`, `dialogue`, `beat`, `beatTitle`, `audioSync`. |
| `edit_timeline` | Apply the re-timing as `move` ops (frames at the timeline `fps`, usually 24). `addTrack` + `move` with `track` when a line needs its own lane. |

## Steps

1. **Read the timeline** (`get_timeline`). Expect `source.kind: "radio"` with a
   `dialogue` track of items `rl_sh<n>` (each has `from` and
   `durationInFrames`). If the timeline is missing or has no dialogue items,
   stop and tell the user to press "Send to editor" on the Radio tab first —
   never build the timeline yourself.
   - If `source.kind` is `"animatic"` instead, the dialogue items are LINKED to
     picture items (`linkId`) and a `move` ripples the picture with it. This
     skill is written for the radio (audio-only) timeline; on an animatic, warn
     the user that pacing will re-time the pictures too and confirm before
     proceeding.
2. **Read the shot list** (`get_shotlist`) and index shots by `n`. For each
   dialogue item `rl_sh<n>`, note its shot and everything between it and the
   next voiced shot: silent shots (no dialogue), a `beat` change, `action`
   text, `audioSync` cues.
3. **Decide each gap.** Walk the dialogue items in order, keeping a frame
   cursor. Each item's new `from` = previous item's new end + the gap you
   choose. Judgment beats formula, but these are the anchors:
   - **Quick exchange** (adjacent shots, same beat, characters answering each
     other): tight — **0.3–0.6s**. Snappy banter can touch 0.2s.
   - **Same speaker continuing** across shots: **0.2–0.4s**.
   - **Silent shots in between**: something happens that the listener can't
     see — give it real silence sized from those shots' planned `dur`, but
     REDUCED for radio: without pictures, silence reads about twice as long,
     so a 3s visual beat is roughly **1–2s** of air. Cap a run of silent shots
     at **~3s** unless the `action` clearly earns more (a door creaks open, a
     long walk, a reveal).
   - **Beat / scene change**: a breath the listener can feel — **1–2s**, on
     top of nothing else (don't stack it with the silent-shot pause; take the
     larger of the two).
   - **Planned `dur` vs. take length**: when a shot was planned longer than
     its line runs (say a 5s shot with 2.5s of speech), the surplus is air the
     writer intended around that line — lean on it.
   - **`audioSync`** sometimes carries explicit cues ("beat", "pause",
     "overlapping") — honor them when present.
   - A small **lead-in** before the first line (~0.5s) is fine; don't leave
     the cut starting mid-breath at frame 0.
   - **Overlaps live on their own lane.** The Editor is multi-track: when two
     lines should genuinely overlap — an interruption (`audioSync` or the
     dialogue text says so, e.g. a line cut off with "—"), a shouted reaction
     over someone talking, background walla under a foreground line — items on
     ONE track can never overlap, so add a second dialogue lane once
     (`{ op:'addTrack', type:'audio', id:'dialogue-2', name:'Dialogue 2' }`)
     and move the overlapping take onto it
     (`{ op:'move', id, from, track:'dialogue-2' }`). Use this sparingly:
     overlap is a deliberate dramatic beat, not the default; most cuts need no
     second lane at all.
4. **Apply in ONE `edit_timeline` call**: a `move` op per item that changes
   position, `from` in **frames** (`round(seconds * fps)`). Rules that are not
   negotiable:
   - **Only `move`** (plus `addTrack` for a deliberate overlap lane). Never
     `resize`, `split`, `remove`, `reorder`, or `repack` the dialogue — the
     takes and their story order are the user's.
   - **Never overlap on one track**: within each track, every item's `from` ≥
     the previous item's `from + durationInFrames`. `move` has no overlap
     guard — you are the guard. Takes that should play over each other belong
     on separate lanes (see the overlap rule above).
   - Leave the empty `video` track alone.
5. **Report the edit like an editor would.** Total runtime before → after, and
   the pacing story in plain words — e.g. "tightened the market banter to
   ~0.3s gaps, gave the walk to the well 2.5s of silence, and put a 1.5s
   breath on the scene change into the night beat". The Editor tab preview
   updates when your turn ends.

## Notes

- **Local edit, no credits.** This is timeline math — no Higgsfield, no
  confirm gate. Just do it.
- **Re-runnable.** The user can press "Send to editor" again to get a fresh
  gapless pass and re-pace from scratch; pacing on top of an already-paced
  timeline is also fine (recompute every gap, don't add on top).
- If a line's take is oddly long/short for its text, mention it — but pacing
  is not the place to fix takes (that's re-rendering on the Radio tab).
