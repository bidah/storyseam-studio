---
name: assemble
description: >-
  Concatenate the rendered blocks into the finished film at renders/final/. Use for
  "/assemble", "stitch the clips", "make the final video", "put it together". Pure
  ffmpeg, no generation, no cost. Verifies block order, count and total runtime, and
  leaves the music track to the human.
---

# /assemble — clips → film

No model runs here. This is ffmpeg and arithmetic.

## Step 1 — verify before you concat

Read `shotlist/shotlist.json` and `.storyseam/state.json`, then check the clips on
disk:

- **Every** block has a clip. A missing block is a hole in the story, not a shorter
  film — stop and name it.
- Clips are in block order. `block_01.mp4` … `block_NN.mp4` sorts correctly as long
  as the numbers are zero-padded; they are.
- Each clip's real duration matches its block's `dur` within a second or so
  (`ffprobe -v error -show_entries format=duration -of csv=p=0 <clip>`). A clip that
  came back at 5s when the block asked for 30 means the call was clamped or the
  duration was dropped — that block needs re-rendering, not concatenating.
- Total runtime is within ~10% of `config.target_seconds`. Report the real number.

## Step 2 — concat

All the clips come from one model at one resolution and one aspect ratio, so the
stream copy path works and is lossless:

```bash
cd <story root>
printf "file '%s'\n" "$PWD"/renders/clips/block_*.mp4 > .storyseam/concat.txt
ffmpeg -y -f concat -safe 0 -i .storyseam/concat.txt -c copy renders/final/film.mp4
```

> **Write ABSOLUTE paths into `concat.txt`.** ffmpeg's concat demuxer resolves each
> `file` entry **relative to the directory the concat list lives in**, not to your
> working directory. `concat.txt` sits in `.storyseam/`, so a relative
> `renders/clips/block_01.mp4` is looked up at `.storyseam/renders/clips/block_01.mp4`
> and fails with `Impossible to open`. The `"$PWD"/` prefix above is the whole fix.
> (`-safe 0` is what allows absolute paths at all.)

If stream copy produces a broken or stuttering file — different codec parameters
between blocks, which happens when one block was re-rendered under different settings
— re-encode instead:

```bash
ffmpeg -y -f concat -safe 0 -i .storyseam/concat.txt \
  -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p \
  -c:a aac -b:a 192k renders/final/film.mp4
```

Say which path you used. A re-encode is a quality loss and the author should know it
happened.

## Step 3 — verify the film

`ffprobe` the result: duration, resolution (854×480 at 16:9), audio stream present.
Report all three. Then watch it end to end and say plainly whether the cuts land —
particularly at the chained seams, where a mismatched last frame shows as a jump.

Record the result under `final` in `.storyseam/state.json` (path, duration, resolution,
`"music": "none"`), so the story's stage reads as done from the folder alone.

## Step 4 — hand over

Report:

- the path, the runtime, the resolution;
- total credits spent and runs used, read from `.storyseam/state.json` (the sum of what
  each job actually billed, in the provider's unit — never recomputed from `config.costs`);
- **that there is no music, by design**, and that
  `assets/audio/music/` is where the human drops the score. Muxing it is a one-liner
  they run when they have it:

```bash
ffmpeg -y -i renders/final/film.mp4 -i assets/audio/music/<track>.mp3 \
  -filter_complex "[1:a]volume=0.25[m];[0:a][m]amix=inputs=2:duration=first" \
  -c:v copy renders/final/film_scored.mp4
```

Never run that yourself against a track you generated. There is no track you
generated.

## Do NOT

- Do not upscale. 480p is what was rendered; upscaling is a separate, paid, human
  decision.
- Do not trim, reorder or "improve" the cut without being asked. The shot list is the
  cut.
- Do not add music, transitions, titles or a fade-out unless the author asks.
