---
name: director-series
description: >-
  Author a Director Series — the recipe a live Director generates a whole film
  from in one continuous take, instead of rendering shots and cutting them
  together. Covers what a Series is made of, the order to build one in, which
  other tabs each part comes from, and the ceilings the endpoint refuses a
  session for. Use when the author asks to "make a Series", "use the Director",
  "generate the film in one take", "set up the Director tab", asks what a cue
  sheet is, or wants a film made from the shot list rather than shot by shot.
  ALWAYS run preflight_sitting before telling anyone to press play: the endpoint
  refuses a bad cue sheet as a WHOLE SESSION, at the door, and bills its
  sixty-second minimum for the privilege. Do NOT use this for ordinary shot-by-
  shot rendering — that is the Episodes tab.
---

# The Director Series

Everywhere else in this studio you render a shot, then the next shot, then cut
them together. A Series is the other way: one recipe, and a live Director that
generates the piece **continuously** against it. Nothing is stitched. What comes
back is one take.

That changes what authoring means. There is no shot to re-roll — there is a
recipe to get right before you spend a sitting, and a sitting that is wrong is
wrong all the way through.

## What a Series is made of

| Part | What it is | Where it comes from |
|---|---|---|
| **Opening prompt** | The standing brief: style, film stock, identity locks. True for the WHOLE film, not the first shot. | Written here |
| **First frame** | The EXACT image the film starts on. Every frame after it is generated from this one. | Images tab, Library, Bible sheets |
| **Cue sheet** | Beats on the film's own clock — what happens when | `derive_cue_sheet` from the Shot list, or written here |
| **Model sheets** | Reference art the whole piece is drawn against | Images tab / Library → `attach_model_sheet` |
| **Target audio** | Audio the Director generates AGAINST | Sound Studio / Radio → `set_target_audio` |

## The order to build one in

1. **`create_series`** — title, opening prompt, shape. It is a draft with
   nothing on it.
2. **Model sheets first, not last.** They are what every frame is drawn against,
   so a still generated before them is a still that has nothing to be consistent
   with. Generate them on the Images tab, then `attach_model_sheet`. See the
   `model-sheets` skill for the form and the negatives that actually bite.
3. **The first frame.** `update_series` with `imageUrl`. A Series cannot be
   published without one, and a Series that plays without one has the Director
   invent the opening image — after which the whole film is generated from
   something nobody chose.
4. **The cue sheet.** If this project has a shot list, `derive_cue_sheet` turns
   it into beats in one call and pins any storyboard stills it finds. Otherwise
   `save_cue_sheet`. See the `cue-sheet` skill.
5. **Target audio**, if the piece has any. `set_target_audio`.
6. **`preflight_sitting`.** Then, and only then, tell the author to press play.

## The one thing to understand about failure here

The Director does not refuse a bad beat. It refuses the **whole session**, at
`configure`, before a single frame exists — and it bills its sixty-second
minimum anyway. The refusal names no beat.

So every write tool here returns an `issues` map, and an empty one is the ONLY
signal that a sitting is worth paying for. A call that "succeeded" with issues
on it has saved a cue sheet that cannot be played. Read it. Say so.

## The ceilings, and the thing everyone gets wrong about them

**They are per REEL, not per Series.** The endpoint applies them to one script
message, and a Series sends one script per reel — so a 17-pin sheet is refused
whole and legal cut in two.

| Rule | Value |
|---|---|
| Beats in one reel | ≤ 64 |
| Beats pinning a frame | ≤ 16 |
| Beats carrying audio | ≤ 8 |
| Two pinned frames no closer than | 3s |
| A reel's FIRST pin, no earlier than | 5s |

A reel change costs exactly one frame: the beat that opens an appended reel
gives up its pin, because no chunk ends at second zero and there is nothing
before it to be the final frame of. One frame, to make a sheet legal that was
refused whole — set it with `update_series` → `reelChanges`.

## What connects to what

A Series is not a second app inside this one. It reads the studio:

- **Shot list → cue sheet.** `derive_cue_sheet`. Each shot's duration becomes
  the beat's offset, its camera becomes the `style` section, its action and
  dialogue the `scene`, its audio-sync note the `score`.
- **Bible / Images / Library → model sheets.** The Director never generates a
  reference; it points at one this project made.
- **Sound Studio / Radio → target audio.** Same rule. There is no audio
  renderer on this tab, deliberately: a second place to render a mix is a
  second place for it to go stale.
- **Sitting → Editor, Cuts, Musicalized.** What the Stage keeps is an ordinary
  file in the project.

## When the author wants a LONGER cut

Do not extend a sheet in place until it breaks the ceilings. Make a new Series
that inherits the world — same opening prompt, same model sheets, same first
frame — and write the longer sheet there. Two reasons: the short cut still
works and is still worth watching, and a sheet being rewritten beat by beat
past sixty beats is a sheet nobody can reason about.

Then, in order: tighten the dead time first (a beat that holds four seconds
longer than it needs is four seconds the film sags), fill the missing middle
shots, and only then add to the ends. A cut that jumps from one wide to another
wide is missing its middle, not its ending.

## Do not

- **Do not read a saved copy of a Series.** Read the live row with
  `get_director`. A Series that was fetched an hour ago has been edited since.
- **Do not put the art settings in your head.** `get_director` with `art: true`
  says what to generate this Series' sheets and stills at. A Series that changed
  shape changed them.
- **Do not describe the first shot in the opening prompt.** It governs every
  beat under it. What belongs there is what is true for the whole film.
- **Do not tell the author a sitting is ready** without running
  `preflight_sitting`.
