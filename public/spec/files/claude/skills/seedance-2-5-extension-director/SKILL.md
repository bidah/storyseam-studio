---
name: seedance-2-5-extension-director
description: >-
  Frame-exact continuation on Seedance 2.5 using `video_extension`. Use when the seam between
  two blocks must be invisible and the prose first-frame anchor of the standard director is
  not enough — a continuous camera move across a cut, a held object that must not jump, an
  action that carries across the boundary. Not the default: an extension inherits identity
  from the previous clip instead of re-anchoring from the character sheets, so drift
  compounds. Alternative to `seedance-2-5-director` for the same model.
---

# Seedance 2.5 Extension Director

The standard 2.5 director anchors a block's opening with a reference image plus a prose
declaration. That produces a clip that **begins on that composition** — good enough for a
cut. It does not produce a **seamless splice**.

When the seam has to be invisible, use the mode built for it.

## When this is the right tool

- A camera move that continues across the boundary.
- An object in hand, mid-gesture, that must not jump.
- An action that carries across the cut — a throw, a fall, a door opening.
- Any moment where a viewer would read a mismatch as a mistake rather than as an edit.

## When it is the wrong tool

- **A location change.** Extensions continue what is there; a new room is a new block.
- **After identity has drifted.** An extension inherits identity from the previous clip, not
  from the character sheets. Extending a drifted clip locks the drift in.
- **Long chains.** Past roughly **60 seconds** of consecutive extensions, stop and re-anchor
  a fresh block from the original references. Drift compounds down the chain, and no amount
  of prompting inside an extension recovers a face the previous clip already lost.

## The call

```
generate_video {
  model: "seedance_2_5",
  mode: "video_extension",
  extension_mode: "forward",       // REQUIRED, and not allowed in any other mode
  duration: <4-30>,                // the NEW segment's length — this is what you pay for
  resolution: "480p",
  generate_audio: true,
  medias: [ { role: "video_references", value: <previous clip media_id> } ],
  prompt: "<boundary alignment first, then new content>"
}
```

- **`aspect_ratio` is ignored** — the output inherits the source video's ratio. Do not pass a
  conflicting one and expect it to win.
- **Billing is by the new segment's duration**, not the source's. (That is the opposite of
  `video_edit`, which bills by the *source's* duration and ignores `duration` entirely.)
- `extension_mode` is **required** here and **rejected** in every other mode.

## The one rule that decides success

**Align the boundary frame before describing new content.**

State where the clip picks up — what is on screen, who is where, what the camera is doing at
the moment of the join — and *only then* say what happens next. Every failure of this mode
traces back to describing the new action before establishing the boundary.

```
BOUNDARY: The segment opens exactly on the source's final frame: Noah crouched screen-left
and Maya crouched screen-right at the open door of the garden shed, both still, warm amber
afternoon light low across the floor, camera at eye level and at rest.

THEN: Noah ducks his head and steps in first, Maya follows, and the camera pushes gently
after them toward the dark doorway.
```

## The phrase that breaks it

**Never write "Then connect to the source video."**

That is the documented failure phrasing. It leaks later elements in early — content from the
end of your new segment starts appearing at the join — and it lets the image drift once it
arrives. Describe the boundary *as a frame*, not as a relationship to another clip.

## Backward extension

`extension_mode: "backward"` generates material that *leads into* the source. The boundary
rule inverts: the source's **first frame** must be stated as the new segment's explicit **end
state**. Same discipline, other end.

## Reviewing the result

Boundary frames **connect naturally, not identically**. Do not expect a byte-identical match
at the join — expect continuity of motion, light and position.

Check three things, in this order:
1. **Both sides of the seam.** Play the last second of the source and the first second of the
   extension together.
2. **The whole extended segment**, not just the join — drift shows up late.
3. **Identity against the character sheets.** This is the one the mode cannot protect for
   you, and the reason it is not the default.
