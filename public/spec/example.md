---
storyseam: 0.1
title: Nothing To Do
logline: >-
  Milo comes over to play. For one long second, neither boy can think of a
  single thing to do — and then Theo looks at the blanket.
look: Pixar-style 3D animation, warm late-afternoon light, rounded stylised character design
arc: kishotenketsu
language: en
audience: all ages
---
# Nothing To Do

**Logline.** Milo comes over to play. For one long second, neither boy can think of a
single thing to do — and then Theo looks at the blanket.

## The five

| | |
| --- | --- |
| **Title** | Nothing To Do |
| **Premise** | A kid arrives at his friend's house to play. The room is full of toys and empty of ideas. One beat of nothing. Then one of them has an idea, and the room becomes somewhere else. |
| **Length** | 120 seconds → **4 blocks** |
| **Look** | Pixar-style 3D animation, warm late-afternoon light, rounded stylised character design |
| **Shape** | 16:9 |

## The shape

**Kishōtenketsu.** Four movements, turning on a twist rather than a conflict. There is
no antagonist here and inventing one would wreck it — the obstacle is a flat afternoon,
and the turn is an idea, not a victory. That is the whole reason this arc was chosen
over Three-Act.

| Block | Movement | What happens |
| --- | --- | --- |
| 1 | **Ki** — introduction | Milo arrives. Theo lets him in. A living room buried in toys. |
| 2 | **Shō** — development | They sit in it. Nothing. The long second where neither knows what to do. |
| 3 | **Ten** — the turn | Theo sees the blanket. The idea. They build. |
| 4 | **Ketsu** — resolution | Inside the fort it is deep space. Two kids, weightless, in the room they were bored in. |

## Budget

| Item | Count | Credits | Runs |
| --- | --- | --- | --- |
| 30s blocks @ 480p | 4 | 330 (actual) | 4 |
| Voice casts | 2 | 30 | 2 |
| Stills @ 2k | 5 | 12.5 | 0 |
| **Total** | | **372.5 actual** | **6 of 10** |

Estimated ~343, billed 372.5. The variance is the blocks: `omni_reference` does not
bill a flat rate — block 1 cost 105 and block 2 cost 75 at identical duration and
resolution. The `producer` price list now quotes the 105 ceiling for this reason.

**Zero retries used.** Every block landed on its first render.

## Decisions

- **One physical location** (Theo's living room) for all four blocks. A location change
  forces a block boundary, and this story does not need a second room — the point is
  that the *same* room becomes extraordinary. Cheapest choice and the better one.
- **The fort interior gets its own plate** even though it is the same room. Block 4 is a
  reveal; it needs its own reference or the model will keep rendering the living room.
- **Sparse dialogue.** ~290 words total across 2 minutes. This is a story about two kids
  looking at things, and a 30s block crammed with talk comes back gabbled.
- **No music**, by engine rule and by taste — the last block wants room tone and a held
  breath, not a swell. Score goes in `assets/audio/music/` afterwards.

## Status

- [x] scaffolded
- [x] outline
- [x] script
- [x] shot list — 4 blocks, 120s
- [x] cast — 5 stills @ 2k, 2 voices cast and black-framed
- [x] render — 4/4 blocks, chained, no retries
- [x] assemble — `renders/final/film.mp4`

## Result

**`renders/final/film.mp4` — 120.2s, 854x480, h264 + aac stereo, 16.5 MB.**

The last-frame chain held across all three seams: same room, same late-afternoon
light, same costumes, Theo screen-left and Milo screen-right for the whole film, and
the star-blanket in the same place on the couch until it is taken down in block 3.

No music, by design. Drop a track in `assets/audio/music/` and mux it with the
one-liner in the `assemble` skill.
