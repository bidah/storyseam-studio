---
name: render-clips
description: >-
  Render the shot list into video, ONE block at a time, chaining the last frame of each
  clip into the first frame of the next. Use for "/render", "render the blocks", "generate
  the video", "render the next block". Provider-neutral: the block is built here, submitted
  through the provider adapter named in config.json, and verified here. Always 480p. Always
  no music. Never parallel. Resumable from .storyseam/state.json. This is the only skill
  that spends real money — it re-audits before every call.
---

# /render — one block at a time, chained

This is the expensive skill. A 30-second block costs `config.costs.block_30s` credits
(shorter blocks cost proportionally). Everything here is arranged so that no credit is
spent on a call that was going to fail.

## What this skill knows, and what it delegates

This skill owns the **order of operations** and the **state**. Two other skills own the
detail, and you load both before the first paid call:

- **The director for `config.video.model`** (`seedance_2_5` → `seedance-2-5-director`)
  owns the prompt contract: how the anchor frame is declared, how references are numbered
  in the prompt, the audio line, what never goes in a prompt. The shot list was written
  through it; you pass what it wrote and do not edit the prompt here.
- **The provider adapter for `config.providers.video.id`** (`provider-higgsfield`,
  `provider-atlas`, `provider-fal`) owns the mechanics: how a reference reaches the
  provider, the exact call, the job flow, the download, the billing unit, and that
  provider's failure modes. Install it with `bin/registry-add.py provider-<id>` if it is
  not in `.claude/skills/`.

If either is missing, **stop and install it**. Rendering from memory of either is how a
film gets rendered against a role the model ignores.

## The invariants

1. **Video is Seedance 2.5 at 480p. Always 480p.** If someone asks for higher, quote the
   multiplier from the adapter and leave it at 480p.
2. **Every video prompt ends with an audio line that says no music.** The clip should come
   back with dialogue, room tone and Foley — and nothing else.
3. **One clip at a time, chained.** Never a batch, never two blocks in flight. Block N+1
   needs a frame that does not exist until block N has finished.
4. **Resume, never restart.** `.storyseam/state.json` records what is done. A re-run
   picks up at the first block whose status is not `done`.

## Step 0 — pre-flight (free, and not optional)

Before the first paid call:

1. `bin/story-check.py` and `bin/asset-audit.sh` must both pass. They check the shot list
   against its schema, every block's references on disk and registered with the provider,
   and — for a chained block — that the previous block's anchor frame exists.
2. Read `config.json`, `shotlist/shotlist.json`, `.storyseam/state.json` and
   `prompts/video_style_prompt.txt`.
3. Verify provider access the way the `providers` skill says: `bin/provider-check.py`,
   then the adapter's own probe. Unsatisfied access means stop, not switch.
4. Print the plan: blocks remaining, cost each from `config.costs`, the total, and the run
   budget. Say the cost is a floor — a block that comes back wrong is re-rendered at full
   price. Then start.

## Step 1 — build block N (provider-neutral)

A block is exactly these things, and nothing provider-specific:

| Field | From |
| --- | --- |
| `prompt` | `block.prompt` + `"\n\n"` + `prompts/video_style_prompt.txt`. Never edited here. |
| `references` | the block's ordered reference list — see below |
| `duration` | `block.dur` (4–30) |
| `resolution` | `config.video.resolution` — `480p` |
| `aspect_ratio` | `config.aspect_ratio` |
| `generate_audio` | `true` |

**The reference list is ordered, and the order is the director's.** The director says how
references are numbered in the prompt; the shot list records that order in the block's
`references` array (anchor frame first on a chained block, then character sheets, then
the location plate, then prop plates, then voice references). You pass them to the
adapter **in that order** — the adapter maps positions to its own roles or arrays, and
`@Image 1` in the prompt must be the first image you pass or the anchor is silently
wasted. `bin/story-check.py` verifies the prompt's `@Image N` mentions agree with the
array. If a block has no `references` array (an older shot list), build the list in the
director's order from `characters`, `location`, `props` and `voices`, anchor first.

On a chained block the first reference is `renders/frames/block_<N-1>_last.jpg`, and it
must already be registered with the provider (Step 4 of the previous block).

## Step 2 — submit through the provider adapter

Hand the built block to the adapter and follow its section on submitting a video job. The
adapter owns: how each reference is passed (a media id, a public URL), the call shape, any
recommendation or preset gate, polling, and the download. **Do not improvise any of that
from another provider's habits** — a value that is right on one provider hangs on another.

What must be true when the adapter is done, whatever the provider:

- `renders/clips/block_<NN>.mp4` exists and plays.
- You know the provider's job id and what it actually billed.

## Step 3 — verify before chaining

Watch the clip. Check: right characters, right location, right number of beats, dialogue
audible, real duration within a second of `block.dur` (`ffprobe`), **no music**. A block
with music in it is a failed block — re-prompt with a harder audio line rather than
carrying it forward, because it cannot be un-mixed later. A clamped duration means the
call dropped or capped `duration`; that block is re-rendered, not concatenated.

## Step 4 — extract and register the anchor frame (the chain)

```bash
bin/last-frame.sh renders/clips/block_NN.mp4      # -> renders/frames/block_NN_last.jpg
```

Register that frame with the provider the way the adapter registers any reference, so it
is ready to be block N+1's first reference. Record where it went in `state.json`
(`last_frame`, and the provider's handle if it has one).

**When to break the chain instead.** The chain is the default, not a law. Skip the anchor
(and the director's first-frame declaration with it) when:

- the next block is a **new location** — chaining across a cut drags the old room into
  the new one;
- the last frame came back **blurred, dark, mid-motion or empty** — a bad anchor poisons
  the next block worse than no anchor. Re-render the block if the beat needs it,
  otherwise start the next block clean from its references;
- identity has visibly **drifted** — the sheets re-anchor identity on every block, so
  dropping the chain for one block is the cheapest available correction.

Say out loud when you break the chain and why. A silent break looks like a bug in the
finished film.

## Step 5 — record state after every block

Write `.storyseam/state.json` **after each block completes**, before starting the next
(shape: `schema/state.schema.json`). An interrupted run must never re-render a block that
is already on disk:

```json
{
  "blocks": {
    "block_01": { "status": "done", "job_id": "…", "clip": "renders/clips/block_01.mp4",
                  "last_frame": "renders/frames/block_01_last.jpg",
                  "last_frame_media_id": "…", "duration": 30.04,
                  "credits": 75, "chained_from": null },
    "block_02": { "status": "pending" }
  },
  "credits_spent": 75,
  "runs_used": 1
}
```

`duration` is the clip's real length from `ffprobe`, not the requested one — `/assemble`
compares it to the block's `dur`. `credits` is **what the job actually billed**, which can
differ from `config.costs.block_30s` (the adapter says how to read the real figure); a
re-render bills again and is added, never overwritten. On a provider that bills in
another unit, record that unit and say so.

## The run budget

Video runs are counted, not just credits. Read `runs_used` and any budget the author set,
and **stop when it is reached** — report what is done and what remains rather than
quietly spending the next one. A retry is a run. Voice casting in `/cast` is a run.
Announce the count as you go: "block 2 of 4 done, 2 runs used of 10."

## Failure handling

- **Rejected call** — read the error before retrying, then read the adapter's failure
  list. Nearly every rejection is a reference passed in the wrong form for this provider,
  and all of those are free to fix.
- **Bad render** (wrong blocking, drifted character, clipped dialogue) — fix the *prompt*
  through the director, not the seed. Tighten the anchor, cut a beat, shorten the
  dialogue. A re-roll of the same prompt usually reproduces the same failure at the same
  price.
- **Music in the output** — strengthen the audio line and re-render. Never carry it
  forward.
- Never retry the same failing call more than twice. Stop, report, and let the author
  decide — three identical failures are a prompt problem, not luck.

## Do NOT

- Do not render blocks in parallel or in a batch.
- Do not raise the resolution.
- Do not add music, or accept a clip that has it.
- Do not proceed past a failed block into the next one. The chain is ordered; a hole in
  the middle means every later block is anchored to the wrong frame.
- Do not write provider mechanics into this skill or into the shot list. They belong in
  the adapter, where a bad render can correct them once for every story.
