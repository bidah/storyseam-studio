---
name: seedance-voice-casting
description: >-
  Cast a reusable character voice for Seedance. Generates a short take of the character
  speaking, keeps only the audio, and muxes it against black video — the form Seedance
  actually accepts as a voice reference. Use for "cast the voices", "make the voice
  reference", "this character sounds different in every block". Compatible with Seedance 2.0
  and 2.5; 2.0 in fast mode is the cheap default because a voice is a fixture, not a shot.
---

# Seedance Voice Casting

A voice is an **asset on disk**, cast once and reused by every block that character speaks
in. Without one, each block samples a new voice and the same character sounds like three
different children across a two-minute film.

## The form that actually works

Seedance takes a voice as a **black-frame `.mp4` passed in `video_references`.**

Not `audio_references` — that path is narrower, and on 2.0 it is outright rejected by
`mode: "fast"`. The black-frame video route works on both models and both modes.

```
assets/audio/voices/<slug>.mp3              the take (source of truth)
assets/audio/voices/blackframe/<slug>.mp4   what goes into a render
```

`<slug>` is the character's slug from `world/characters.md`. **A slug mismatch means the
wrong character speaks, and nothing errors** — you find out by watching.

## Step 1 — generate the take

Use the cheap model. A voice is a fixture cost, not a shot:

```
generate_video {
  model: "seedance_2_0", mode: "fast", duration: 10, resolution: "480p",
  aspect_ratio: <config.aspect_ratio>, generate_audio: true,
  medias: [ { role: "image_references", value: <character sheet media_id> } ],
  prompt: "<Character> speaks directly to camera, medium close-up, locked-off camera,
           neutral room. They say: \"<a short paragraph, ~25 words>\".
           Audio: clean spoken dialogue only, quiet room tone. No music."
}
```

Two things decide whether the voice is usable:

- **Cite the character sheet** as `image_references`, so the voice matches the face rather
  than an invented one.
- **Write the paragraph in the character's actual voice**, from `world/characters.md`. This
  is the whole job. An eight-year-old handed a corporate sentence gives you a corporate
  eight-year-old for the rest of the film — the take is not just a sample of a timbre, it is
  a sample of a *delivery*, and the delivery is what carries.

~25 words fits comfortably in 10 seconds. Longer and it gabbles.

## Step 2 — keep the audio, throw away the picture

```bash
ffmpeg -y -i take.mp4 -vn -c:a libmp3lame -q:a 2 assets/audio/voices/<slug>.mp3
bin/voice-to-blackmp4.sh <slug>
```

The picture from the casting take is never used. Its only job was to make the model speak.

## Step 3 — cite it in the render

Pass the black-frame mp4 as `video_references`, and **tell the model what it is**, or it will
try to read the black frames as imagery:

> `Use the attached voice reference for <Character>; ignore the black frames. Output only the
> spoken dialogue and the scene's diegetic sound. No music.`

## Cost discipline

Each cast is a paid video run. So:

- Cast only characters who **actually speak** — the `voices` list of a block, not
  `characters`.
- Cast each character **exactly once** and reuse.
- A character with a single line still costs a full cast. Ask whether that line can move to
  someone already cast before spending it.

## When to re-cast

- The delivery is wrong for the character (too old, too flat, wrong energy) — that is a
  paragraph problem, so rewrite the paragraph, not the settings.
- The take is clipped or rushed — shorten the paragraph.
- The script's characterisation changed enough that the old delivery no longer fits.

Do **not** re-cast to chase a marginally nicer timbre. Consistency across the film is worth
more than the best single take, and every re-cast is a run.
