---
name: start-story
description: >-
  Scaffold a new Storyseam story in the current folder — the convention every other
  skill reads. Use for "/start-story", "start a new story", "set up a story here",
  "make me a film project", "scaffold a story". Interviews for the premise FIRST
  (one card, not a questionnaire), then writes the folder tree, config.json,
  storyseam.md, the two style prompt files and the story's own CLAUDE.md/AGENTS.md.
  Never generates media. Never overwrites an existing story without saying so.
---

# /start-story — lay down the convention

You are creating the folder that every other Storyseam skill will read. Get the
shape right once and nothing downstream needs configuration.

## Step 0 — is there already a story here?

`ls -a` the target folder. If `storyseam.md` **and** `config.json` already exist, this
folder is a story. Do NOT re-scaffold. Say what is already there (title, whether a
script exists, how many shots, how many clips are rendered) and ask whether they
want a *new* story in a subfolder instead. Re-running the scaffold over live work
destroys drafts.

If the folder has files but no `storyseam.md`, scaffold into it — the convention is
additive and never deletes.

## Step 1 — the interview (ONE round trip)

You need five things before you can write anything real. Ask for them in a single
message, as a short numbered list with your own best guess already filled in, so the
author corrects rather than composes:

1. **Title** — a working title is fine.
2. **Premise** — one or two sentences. Who wants what, and what is in the way.
3. **Length** — a target runtime in minutes. This drives the block count:
   `blocks = ceil(seconds / 30)`, and every block is one paid Seedance run.
4. **Look** — the visual world in a phrase ("Pixar-style 3D animation, warm
   afternoon light"). This becomes `prompts/image_style_prompt.txt` and
   `prompts/video_style_prompt.txt`.
5. **Shape** — cinematic `16:9` or vertical `9:16`.
6. **Backend** — `higgsfield` (MCP, the default), `atlas` or `fal` (each needs an API key
   the user exports themselves). Only ask if they have not already said; otherwise default
   to `higgsfield` and state it.

Tell them the cost implication in one line before they answer — "a 2-minute film is
4 Seedance blocks, about 300 credits at 480p" — because runtime is the only choice
here that spends money.

7. **Video model** — ONLY when `config.json` has `video.models` with more than one entry
   and no `video.model` (`init --video a,b` leaves it unset on purpose). List each
   candidate with one line from its director skill on what it is for. Write the answer to
   `video.model` and the reason under `## Decisions` in `storyseam.md`. With one entry, or
   `video.model` already set, do not ask; it is decided.

8. **Editing** — where the film is finished: `none` (the agent cuts it with ffmpeg), DaVinci
   Resolve, or another program, and whether that program's MCP server is installed. Skip it
   when `config.json` already has an `editor` other than the scaffold's `none` default.
   Write it to `config.json` `editor` (`docs/spec.md` §8).

**Do not ask a ninth question.** Arc structure, character names, act breaks and
shot style are `/write-script`'s business, and asking about them now is asking the
author to design a film before they have a premise. If they volunteer any of it,
write it into `storyseam.md` under `## Notes` and move on.

If the delegation or the user's message already answers all five, skip the interview
entirely, state the five values you inferred in one line, and scaffold.

## Step 2 — write the tree

Create exactly this. Empty directories get a `.gitkeep` so the shape survives git.

```
storyseam.md                 the premise, the status, the decisions
CLAUDE.md                    how an agent works in THIS story (written from the template)
AGENTS.md                    the same file under the cross-tool name (symlink, or a copy)
config.json                  models, resolution, aspect, block length
script/
  outline.md                 beat outline, approved before any pages are written
  script.md                  the pinned draft — the one true script
  drafts/                    script.v1.md, script.v2.md, ... immutable snapshots
  reviews.json               the specialist ledger (who read which draft, what they found)
world/
  characters.md              roster: name, want, look, voice DNA
  locations.md               every place, with a stable slug
  props.md                   every object that has to stay consistent
prompts/
  image_style_prompt.txt     appended to EVERY image generation
  video_style_prompt.txt     appended to EVERY video generation
shotlist/
  shotlist.json              canonical, machine-read by /cast and /render
  shotlist.md                the same list, readable
assets/
  images/characters/         one sheet per character, named <slug>.png
  images/locations/          one plate per location, named <slug>.png
  images/props/              one plate per prop, named <slug>.png
  audio/voices/              per-character voice reference, <slug>.mp3
  audio/voices/blackframe/   <slug>.mp4 — the black-frame encode Seedance actually takes
  audio/music/               HUMAN-FILLED, at the end. Storyseam never writes here.
  video_refs/                motion / camera reference clips, if any
renders/
  clips/                     block_01.mp4, block_02.mp4, ... one per Seedance run
  frames/                    block_01_last.jpg — the continuity chain
  final/                     the assembled film
.storyseam/
  state.json                 render progress, job ids, what is done
  media.json                 local path → higgsfield media_id cache
```

`bin/storyseam-init.sh --title "<title>" <folder>` in the engine repo creates this tree
in one call and writes `CLAUDE.md` + `AGENTS.md` from the template — run it rather than
issuing thirty `mkdir`s. It never overwrites, so it is safe on a folder that already has
files.

## Step 3 — config.json

Write it with the invariants already baked in. The author can change `aspect_ratio`
and `target_seconds`; the model and resolution fields are the engine's rules, not
preferences.

```json
{
  "title": "<title>",
  "providers": {
    "video": { "id": "higgsfield", "access": "mcp" },
    "image": { "id": "higgsfield", "access": "mcp" }
  },
  "aspect_ratio": "16:9",
  "target_seconds": 120,
  "block_seconds": 30,
  "image": { "model": "gpt_image_2", "resolution": "2k", "quality": "high" },
  "video": { "models": ["seedance_2_5"], "model": "seedance_2_5", "resolution": "480p", "generate_audio": true },
  "audio": { "music": "never_generated", "voice_ref_format": "blackframe_mp4" },
  "continuity": { "chain_last_frame": true },
  "costs": { "block_30s": 75, "voice": 15, "still": 2.5 }
}
```

`costs` is the one place the credit arithmetic lives: `bin/asset-audit.sh`, the producer
and every "this will cost" sentence read it from here. Update it here when a provider's
pricing changes, nowhere else.

**`resolution` is load-bearing and is not a preference.** Video is `480p` because
Seedance 2.5 bills by resolution and 480p is the only tier this engine renders.
Images are `2k` because a still is cheap and it is the reference every frame is
anchored to — a soft character sheet poisons every block that cites it. If an author
asks for 720p or 1080p video, tell them the rule and what it would cost, and leave
the config at 480p unless they overrule it in writing.

## Step 3b — storyseam.md

Write `storyseam.md` from `docs/storyseam.template.md`, following `docs/spec.md`: front
matter with `storyseam`, `title`, `logline`, `look` (and `arc`, `language`, `audience`
when known), then `## Premise` and `## Status`. Volunteered detail goes under `## Notes`.
**Never copy a `config.json` value into it** — runtime, aspect, models and providers live
in the config, and a copy is a value that will drift.

## Step 4 — the two style prompts

`prompts/image_style_prompt.txt` and `prompts/video_style_prompt.txt` are the reason
a Storyseam film looks like one film. **Every** image call appends the first; **every**
video call appends the second. Write them from the author's "look" answer:

- Concrete and physical. `soft warm key light, shallow depth of field, rounded
  stylised character design, saturated but natural palette` — not `beautiful`,
  `cinematic`, `masterpiece`.
- No subject matter. A style prompt that mentions a character or a place stops being
  a style and starts fighting the shot.
- The video one adds motion and grade language and **ends with the audio rule**:
  `Audio: diegetic only — dialogue, room tone and Foley. No music.`
- Never leave them empty. An empty style file means every shot drifts.

## Step 4b — install the adapters and directors, then verify access

Right after `config.json` exists:

```bash
bin/registry-add.py provider-<config.providers.video.id>   # the backend adapter
bin/registry-add.py <each id in config.video.models>       # e.g. seedance_2_5
bin/registry-add.py <config.image.model>                   # e.g. gpt_image_2
bin/provider-check.py                                      # is access satisfied?
```

If a provider needs an API key the user has not exported, **say which variable and where to
get it, and stop** — do not ask them to paste it into the chat, and never write it into
`config.json`. See the `providers` skill.

This is what makes the story folder self-contained: `/shotlist` and `/cast` both write their
prompts through these, and the craft they carry is model-specific. See the
`model-directors` skill.

## Step 5 — the story's own CLAUDE.md

`bin/storyseam-init.sh --title` already wrote `CLAUDE.md` (and the `AGENTS.md` symlink)
from `templates/story-CLAUDE.md`; check it is there, carries the title, and records the
engine's absolute path as `STORYSEAM_HOME`. It tells any
agent that opens this folder — Claude Code, Codex, anything — where the script is,
what the invariants are, and which command comes next. That file is why a story
folder is portable.

## Step 6 — report and stop

Print the tree you made, the config values (call the resolutions out loud), and the
one next command: `/write-script`.

**Generate nothing.** No images, no video, not "just a quick character sheet to get
started". `/start-story` is free and must stay free — the first credit is spent in
`/cast`, after a script exists and the author has read it.
