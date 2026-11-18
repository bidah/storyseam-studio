---
description: Break the script into <=30s blocks with prompts and ordered references
argument-hint: [all | next block]
---
Load the `shotlist` skill and follow it. Every prompt is written through the director
skill for `config.video.model`; if it is not installed, `bin/registry-add.py <model>`
first. Do not write prompts from memory.

Scope: $ARGUMENTS  (empty means the whole script)

State the block count and the credit cost (`config.costs.block_30s` per block, as a floor)
before writing the first prompt. Write both `shotlist/shotlist.json` and
`shotlist/shotlist.md`, run `bin/story-check.py`, and generate no media.
