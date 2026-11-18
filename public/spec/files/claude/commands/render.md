---
description: Render the blocks one at a time, chaining each last frame into the next block
argument-hint: [all | next | block_NN]
---
Load the `render-clips` skill and follow it. Load the director for `config.video.model`
and the provider adapter for `config.providers.video.id` before the first paid call.

Scope: $ARGUMENTS  (empty means: render every block that is not yet done)

Pre-flight first — `bin/story-check.py`, `bin/asset-audit.sh`, provider access — and print
the plan (blocks remaining, cost each from `config.costs`, total as a floor, run budget).
Then render sequentially at 480p with `generate_audio: true`, passing each block's
references in the shot list's order. No music. Never `start_image` on 2.5.

Write `.storyseam/state.json` after every block with what it actually billed. Announce
credits and runs as you go, and stop at the run budget.

If `config.json` lists several `video.models` and `video.model` is unset, stop and ask the
author which to use before anything else (`docs/spec.md` §7). Never pick one yourself.
