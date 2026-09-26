---
name: score-film
description: >-
  Write one continuous cue under a kept Director sitting — a composition plan in
  chunks that turn where the PICTURE turns, rendered as a single piece as long
  as the film, then laid under it by score_sitting with the film's own audio
  untouched and the picture copied, not re-encoded. Use when the author asks to score a sitting, add music under a
  film, make a musicalized version, or when a kept sitting has no scored version
  yet. The rule that decides whether the score works: measure the chunks from
  the FILM, never from the cue sheet — the Director's chunks run long, so a plan
  built from beat offsets is early by two to seven seconds and gets worse as the
  piece goes on. Do NOT use for the Musical tab (a song cut into shots) or for
  scoring a stitched episode (that is score_cut on the Cuts tab).
---

# Scoring a sitting

A musicalized version is a kept sitting with a score laid under it: the film's
own audio untouched, one continuous cue faded in beneath it, ducked under the
dialogue, the sum limited.

## The rule the whole thing turns on

**Measure the film. Never the cue sheet.**

The Director's chunks run long. A composition plan built from `directions[]` is
early by two to seven seconds — and that is not a rounding error. It is the
score arriving before the cut it was written for, every time, accumulating as
the piece goes on, so the end is further out than the beginning.

The measured length comes off the finished file. `get_musicalized` reports each
sitting's own seconds. If you catch yourself deriving chunk boundaries from beat
offsets, stop: you are writing a score for a film that was never made.

## Chunks turn where the picture turns

A chunk is a movement of the film, not a beat of the cue sheet. Its `text` is
the section name in square brackets and nothing else — `[Cold open]`, `[The
bay, quiet]`, `[It turns]` — named for what that stretch of the picture IS,
because the picture is what it has to turn with.

- `positive_styles` — what ARRIVES here: instruments, texture, motion. At
  least one.
- `negative_styles` — what LEAVES, or must not appear. As load-bearing as the
  positives: **a cue that never drops anything never turns.**
- `context_adherence` — `high` (the default) keeps one continuous piece; `low`
  lets a chunk break away where the picture cuts hard.

The **first chunk's** styles set the genre for the whole piece, so the Series'
standing music brief (`musicStyle`) belongs in it, split into tags.

## Silences — the score does not play all the time

A score that never stops has nothing to say when it matters. Mark stretches
where the story wants breath as **silence** chunks: a heavy exchange of
dialogue, a held moment right before a big action, a reveal. Name them for the
moment (`[Held breath]`, `[Silence]`), ask for `near silence`, `room tone
only`, `single sustained very soft note fading to nothing`, and block drums,
percussion, melody and pads in `negative_styles`. ElevenLabs cannot render true
silence — the chunk keeps the music around it honest (it is written knowing it
stops there); the MIX makes the silence real: pass each silence chunk's
`{ from, to }` seconds to `score_sitting` as `silences`, and the bed fades out
to nothing over it (1.5 s ramps out and back in).

Rules of thumb: a 2–5 minute film has 2–4 silences, each 4–15 s, never in the
first 3 s or the last 6 s. The music after a silence re-enters CHANGED — a
silence is a hinge, not a pause — and every big story turn is marked by a change
in the music.

## How the Auto Film scores (for reference)

The Auto Film job does not write one plan after the fact. Its Shot list stage
writes **music cues** with the shots — one fixed vocabulary (suspense, dread,
adventure, action, party, wonder, whimsy, tender, triumph, sad, silence), each
starting at a shot, with an energy 1–5. The Score stage lays them on the
MEASURED film (scaled, then snapped to the nearest real cut) and renders
**pieces**, not one song: consecutive cues of one family are one render (one
chunk per cue); a change of family starts a new piece, crossfaded over a
second; a `silence` cue is a gap nobody renders (and is still muted in the
mix). 1–4 pieces per Film. A Film with no cues is scored the old way — one cue,
written from the story moments. When the author asks why a Film's music turns
where it does, the cue layer is the answer (the score step's `cues` and
`pieces`).

## The brief is the Series', not the cue's

`prompts.musicStyle` is the standing prompt every cue of a Series is made by —
the band, the key, the tempo, the room. When the author describes the music they
want ("psychedelic funk, E minor, 106 BPM"), save it with `update_series`
`prompts` (send the whole `prompts` object back with `musicStyle` changed —
`prompts` is replaced whole) BEFORE writing the plan, so the next take and the
Musicalized tab start from it too.

The chunks must add up to the film's measured length. Audio is never stretched
or trimmed to fit afterwards — a plan that is short is fixed in the plan.

## The order

1. **`get_musicalized`** — which sittings can be scored, which already are, and
   the Series' standing music brief. An empty brief is a real answer, not a
   missing one: a piece can be carried entirely by its sound design, and
   offering to score one that was meant to be dry is a way of not listening.
2. **Write the plan** against the measured length. If the Series already has a
   cue (`series[id].cues[]`), start from its plan — its `prompt` is the body it
   was sent with — and keep its `seed` when the author wants the same piece
   changed rather than a new one.
3. **`plan_score`** — free. It checks the chunks, checks they add up, and says
   what the render will cost in dollars. Tell the author the figure.
4. **`render_cue`** — costs money. Poll it with the same tool.
5. **`score_sitting`** — the cue is not the scored film. When the poll says
   `done`, pass its `url` with the sitting's id (and the plan's `silences`):
   the Worker lays the cue under the picture and files the scored film beside
   the sitting. Then tell the
   author it is ready (the Musicalized tab shows the two together).

## How the mix is made

The picture's packets are **copied**, never re-encoded — so the film that gets
scored is bit-for-bit the film that was kept. `score_sitting` measures where
the film's own audio is loud (ffmpeg, in a sandbox — the same mix the Auto
Film job runs), ducks the cue under those windows rather than under where the
cue sheet said they would be, and writes the new file beside the sitting. The
Musicalized tab can do the same by hand in the browser, with every level
adjustable.

The ducks are measured for the same reason the plan's length is: a sitting is
not deterministic, so where a line actually lands is a property of the take.
A hand-typed window list is right for one film and wrong for every one after it.

The bed sits at a low base level throughout. The mix model also carries
per-stretch level `spans` — −21 dB reads as under-the-dialogue in an interior
and vanishes entirely in a vacuum. The silences are spans too: −80 dB with a
`rampSec`, so the level travels linearly out of the bed and back rather than
switching.

## Keep the plan

The finished cue is filed on the Series with the plan **verbatim** as its
prompt, and the seed beside it. That is what makes "the same but quieter" a
small edit rather than a new piece — and a render whose prompt was lost cannot
be made again in the same hand.
