---
name: story-engine
description: >-
  Storyseam's router and invariants. Load when the user asks what Storyseam is, what
  to do next, where they are in the pipeline, or asks for something spanning more
  than one stage ("make me a 2 minute film about X"). Holds the five hard rules, the
  folder convention, and the state-detection logic that decides which stage comes
  next. Individual stages have their own skills; this one decides which.
---

# Storyseam — the engine

```
idea ──▶ /start-story ──▶ /write-script ──▶ /shotlist ──▶ /cast ──▶ /render ──▶ /edit
```

## The five hard rules

<!-- rules: generated from CLAUDE.md, do not edit here -->
1. **Never generate music.** Every video prompt ends with the canonical audio line, and a render that comes back with music is a failed render.
2. **Video is rendered at 480p.** A story may not raise the video resolution, because resolution is the cost lever, whichever model renders it.
3. **Images are GPT Image 2 at 2k.** Every still — character sheet, location plate, prop plate — is `gpt_image_2` at `resolution: "2k"`, `quality: "high"`, because a soft reference poisons every block that cites it.
4. **The backend is configuration.** `config.json` names a provider per capability: `higgsfield` (the default, reached through `mcp__claude_ai_higgsfield__*`), `atlas` or `fal` (reached with an API key the author exports; Storyseam never handles the value).
5. **One block at a time, chained.** Blocks render sequentially, and the last frame of block N is the first `image_references` entry of block N+1, declared in the prompt as `@Image 1 is the first frame`.
<!-- /rules -->

## Where are we? — read the folder, don't ask

The filesystem is the state. Detect the stage and name the next command:

| On disk | Stage | Next |
| --- | --- | --- |
| `config.json` `video.models` has several entries and no `video.model` | model unchosen | ask the author which, write `video.model` (`docs/spec.md` §7), then carry on |
| no `storyseam.md` (a legacy `STORY.md` counts — offer `git mv STORY.md storyseam.md` + front matter, per `docs/spec.md` §5) | nothing yet | `/start-story` |
| `storyseam.md`, no `script/script.md` (or it holds only a title) | scaffolded | `/write-script` |
| a script, no `shotlist/shotlist.json` | written | `/shotlist` (once the author is happy) |
| a shot list, missing assets | shot-listed | `/cast` |
| assets complete, no clips | cast | `/render` |
| some clips, not all | rendering | `/render` (it resumes) |
| all clips, no `renders/final/` | rendered | `/edit` (in the program `config.json` `editor` names; `none` = ffmpeg) |
| a film | done | hand it over; music is the human's |

## Running the whole pipeline in one go

When the author asks for a finished film from a premise, you may run every stage —
but the two gates still hold, because they are the two places money and authorship
are decided:

- **After `/write-script`**, show the script and its runtime estimate. The script is
  the film; a bad one renders exactly as expensively as a good one.
- **Before `/render`**, state the block count, the cost, and the run budget.

Everything else can flow. Do not stop to ask which arc to use or what the character
sheets should look like — those are decisions this engine is built to make.

## Budgets are counted, not estimated

Two numbers matter and both live in `.storyseam/state.json`:

- **`credits_spent`** — priced from `config.json` → `costs` (`block_30s`, `voice`,
  `still`); never from memory. A block can bill above `block_30s`, so a tally is a floor.
- **`runs_used`** — every `generate_video` call, including voice casts and retries.

Announce them as you go. When the author sets a run budget, it is a hard stop, not a
target: report what is done and what remains rather than spending the next one.

## Per-model craft lives in the registry, not in the pipeline

Prompting is model-specific. `.claude/skills/` holds the pipeline; the **registry** holds one
installable **director skill per model**, resolved from `config.json`:

```
bin/registry-add.py --list          what the registry offers
bin/registry-add.py seedance_2_5    install the director for a model id
```

`/shotlist` writes through the director for `config.video.model`; `/cast` writes through the
director for `config.image.model`. If a configured model has no director installed, install
it — do not fall back on general knowledge. See the `model-directors` skill.

## The convention

```
storyseam.md  CLAUDE.md  config.json
script/{outline.md, script.md, drafts/, reviews.json}
world/{characters.md, locations.md, props.md}
prompts/{image_style_prompt.txt, video_style_prompt.txt}
shotlist/{shotlist.json, shotlist.md}
assets/images/{characters,locations,props}/   assets/audio/{voices,voices/blackframe,music}/
assets/video_refs/
renders/{clips,frames,final}/
.storyseam/{state.json, media.json}
```

Nothing outside this tree is state. If a stage needs a value, it is in `config.json`
or it is a decision, and decisions are the author's.

`bin/` means the engine checkout's `bin/`. A story's own `CLAUDE.md` records that path as
`STORYSEAM_HOME`; when the story is not a subfolder of the engine, run scripts as
`$STORYSEAM_HOME/bin/<script> <story-root>`.
