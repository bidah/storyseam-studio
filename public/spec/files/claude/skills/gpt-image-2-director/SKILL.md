---
name: gpt-image-2-director
description: >-
  Reference-still director for GPT Image 2. Writes the character sheets, location plates and
  prop plates that every video block is anchored to. Use when config.json names
  `gpt_image_2` as the image model, or on "make the character sheets", "generate the
  location plate". Always 2k / high — the model's own defaults are 1k / low and are not
  good enough for an asset every frame inherits from.
---

# GPT Image 2 Director

You are writing **references**, not pictures. A still made here is cited by every video
block that contains that character, room or object, so a soft or ambiguous sheet poisons
every one of them — and you pay video prices to find out. Spend 2.5 credits again rather
than shipping a vague sheet.

## Call shape

```
generate_image {
  model: "gpt_image_2",
  resolution: "2k",           // never the 1k default
  quality: "high",            // never the low default
  aspect_ratio: <see below>,
  prompt: "<the plate>\n\n<prompts/image_style_prompt.txt verbatim>"
}
```

`medias[].role` is `image` when you are editing from an existing still. For a fresh plate,
send no medias.

## The three plate types

### Character sheet — `assets/images/characters/<slug>.png`

- **Full figure AND a readable face.** A tight portrait cannot anchor a wide shot; a
  full-body shot with a mushy face cannot anchor a close-up. Ask for a neutral standing
  pose, full body head to toe, facing camera, arms at sides, face unobstructed and well lit.
- **Plain flat neutral background, stated as empty.** Say "no props, no furniture, no
  scenery" explicitly — models like to fill a background, and a sheet with a room in it
  drags that room into every block citing the character.
- **Costume is locked by the sheet.** Whatever they wear here is what they wear in the film.
  A costume change is a *second* sheet (`<slug>-2.png`), and the shot list must say which
  blocks use which.
- **Portrait aspect (`3:4` or `2:3`) even when the film is `16:9`.** A sheet is a reference,
  not a frame; a standing figure wastes most of a landscape canvas.

### Location plate — `assets/images/locations/<slug>.png`

An **empty** establishing view. No characters in it — a person in a location plate confuses
the model about who is in the block. Use the **film's** aspect ratio here, because this one
really does describe a frame. Name the light: direction, time of day, what it falls on.

### Prop plate — `assets/images/props/<slug>.png`

Only for objects that must stay consistent across blocks. Plain background, shown so the
distinguishing details are readable — the frayed binding, the repaired corner, the exact
print. A generic couch needs no plate; the specific blanket the story turns on does.

## Style

**Append `prompts/image_style_prompt.txt` verbatim to every prompt.** That one shared block
is the entire reason the characters, rooms and props look like one film.

Keep the style file free of subject matter. A style that names a character stops being a
style and starts fighting the shot.

## Language

Concrete and physical: materials, light direction, palette, wear and age. Avoid `beautiful`,
`cinematic`, `masterpiece`, `ultra-detailed` — they buy nothing and crowd out the
instructions that do.

State what should be in frame rather than listing what should not. The one worthwhile
exception is background emptiness, which is worth stating negatively because the model will
otherwise decorate it.

## Before you hand a sheet over

1. Is the face readable at the size a close-up would need?
2. Is the full silhouette present for wide shots?
3. Is the background genuinely empty?
4. Is the costume the one the script says, in every visible detail the shot list will cite?
5. Did the style prompt actually get appended?

A "no" on any of these is cheaper to fix now than after a 30-second block cites it.
