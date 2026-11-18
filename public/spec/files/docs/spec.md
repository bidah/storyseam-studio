---
spec: storyseam.md
version: 0.1.0
status: alpha
---
# The `storyseam.md` specification

`storyseam.md` is a plain Markdown file at the root of a story folder. It is the first
thing an agent reads when it opens a story, and the one file a person reads to know what
the story is, what has been decided, and where it stands.

It does for a film what `design.md` does for a design system: **tokens a machine can
read, in YAML front matter, and the rationale behind them, in prose.** Tokens without
rationale produce a film that is internally consistent and lifeless. Rationale without
tokens produces one that cannot be rendered twice the same way.

A folder is a Storyseam story when it has `storyseam.md` **and** `config.json` at its
root. Nothing else is required to start; the rest of the tree is filled in by the
pipeline, and what is missing tells the agent what to do next.

```
my-film/
  storyseam.md      ← this spec: what the story is, why, and where it stands
  config.json       render settings — models, resolution, aspect, providers, costs
  CLAUDE.md         how an agent works in THIS folder (AGENTS.md is the same file)
  script/  world/  prompts/  shotlist/  assets/  renders/  .storyseam/
```

## 1. Front matter

The file opens with a YAML block. Every key is optional except `storyseam` and `title`.

```yaml
---
storyseam: 0.1                 # the spec version this file follows
title: Nothing To Do           # working title
logline: >-                    # one or two sentences, present tense
  Milo comes over to play. For one long second, neither boy can think of a
  single thing to do — and then Theo looks at the blanket.
look: Pixar-style 3D animation, warm late-afternoon light, rounded stylised characters
arc: kishotenketsu             # story-architect's pick; see §4
language: en                   # the language characters speak (BCP 47)
audience: all ages             # free text; the producer reads it for tone and limits
---
```

| Key | Type | Meaning |
| --- | --- | --- |
| `storyseam` | number | Spec version. Readers refuse a major version they do not know. |
| `title` | string | The working title. `config.json` carries a copy for tools; this one wins. |
| `logline` | string | Who wants what, and what is in the way. The pitch, not the plot. |
| `look` | string | The visual world in a phrase. Expanded into `prompts/*_style_prompt.txt`. |
| `arc` | string | The structure chosen for the story (`three-act`, `heros-journey`, `story-circle`, `save-the-cat`, `kishotenketsu`, or free text). |
| `language` | string | Spoken language of the dialogue. |
| `audience` | string | Who it is for. Constrains content, never pacing. |

### What the front matter does NOT hold

**One truth per rule.** A value lives in exactly one file, and `storyseam.md` points at
the others instead of copying them:

| The value | Lives in | Why not here |
| --- | --- | --- |
| models, resolution, aspect ratio, runtime, block length, providers, prices | `config.json` | Tools read it on every call and it has a schema. |
| character, location and prop names and slugs | `world/*.md` | Names are canonical there and used verbatim everywhere. |
| the script | `script/script.md` | The pinned draft is the one true script. |
| the shot list | `shotlist/shotlist.json` | It is the seam `/cast` and `/render` read. |
| render progress, job ids, credits spent | `.storyseam/state.json` | It changes every run. |
| the stage the story is in | **the tree itself** | Derived, never stored — see §3. |

When a value appears in both, the owning file wins and the copy is a bug.

## 2. Body

The body is Markdown with these level-2 sections, in this order. A section with nothing
in it yet is left out rather than left empty.

### `## Premise`

One paragraph. The situation, the want, the obstacle. Written once at `/start-story`
and revised only when the story itself changes.

### `## Shape`

The arc that was chosen, how the runtime splits into it, and **why this arc and not the
others** — what choosing a different one would wreck. A table of movements against
blocks is the usual form.

### `## Decisions`

A list. Each entry is one decision that shapes the film, written so a later agent can
tell whether it may undo it:

```markdown
- **One physical location** for all four blocks. A location change forces a block
  boundary, and the point is that the *same* room becomes extraordinary.
```

The bold lead is the decision. The sentence after is the reason, and the cost of
reversing it. A decision without a reason will be reversed by the next agent that finds
it inconvenient.

### `## Budget`

What the film is expected to cost and, once rendered, what it did cost: items, counts,
credits, runs. Prices come from `config.json` `costs`; this section records the
arithmetic and the variance.

### `## Status`

A checklist of the pipeline stages, ticked as they land. It is for people — agents derive
the stage from the tree (§3) and correct this list when it disagrees.

```markdown
- [x] scaffolded
- [x] outline
- [ ] script
- [ ] shot list
- [ ] cast
- [ ] render
- [ ] assemble
```

### `## Notes`

Anything the author said that is not yet a decision — a character idea, a shot they
love, a reference. `/start-story` parks volunteered detail here instead of asking more
questions.

### `## Result`

Written by `/assemble`: the final file, its duration, resolution and size, and what held
or broke across the seams.

## 3. The tree is the state

An agent never asks where a story stands. It reads the folder:

| On disk | Stage | Next |
| --- | --- | --- |
| no `storyseam.md` | nothing yet | `/start-story` |
| `storyseam.md`, no `script/script.md` | scaffolded | `/write-script` |
| a script, no `shotlist/shotlist.json` | written | `/shotlist` |
| a shot list, missing assets | shot-listed | `/cast` |
| assets complete, no clips | cast | `/render` |
| some clips, not all | rendering | `/render` (it resumes) |
| all clips, no `renders/final/` | rendered | `/assemble` |
| a film in `renders/final/` | done | hand it over; music is the human's |

**Absence is meaningful.** The scaffold deliberately does not create `script/script.md`,
because its absence is how the engine knows the script is unwritten.

## 4. Reading rules for agents

1. Read `storyseam.md` first, then `CLAUDE.md`, then only what the next stage needs.
2. Treat the front matter as data and the body as rationale. Do not re-derive a decision
   that `## Decisions` already records; change it only when the author asks, and say what
   the recorded reason was.
3. Write back what you decide. A choice that shapes the film and is not in
   `## Decisions` is a choice the next agent will undo.
4. Never copy a value owned by another file into `storyseam.md` (§1).
5. Keep it short. `storyseam.md` is an index and a ledger, not the screenplay.

## 5. Compatibility

Stories made before this spec carry `STORY.md` with no front matter. A reader treats
`STORY.md` as `storyseam.md` when the latter is absent, and offers to migrate:
`git mv STORY.md storyseam.md`, then add the front matter from §1.

## 6. Versioning

The spec is versioned with the engine. A minor version may add keys and sections; a
reader ignores ones it does not know. A major version may rename or remove them.

## 7. Choosing the video model

`config.json` names the video model in two keys:

```json
"video": {
  "models": ["seedance_2_5", "seedance_2_0"],
  "model": "seedance_2_5",
  "resolution": "480p",
  "generate_audio": true
}
```

- **`video.models`** is an array of the models this story may render on. Every id must be
  one the registry knows (`npx storyseam list`), and a director is installed for each.
- **`video.model`** is the one in use. It is what every skill reads.

When `video.models` has **one** entry, `video.model` is that entry. When it has **more than
one** and `video.model` is unset, the story has not chosen yet. Before anything reads the
model (`/shotlist`, `/render`, or a cost estimate), the agent asks the author which one to
use, in one question that names each candidate with what its director says it is for. It
writes the answer to `video.model` and records the choice and its reason under
`## Decisions` in `storyseam.md`. It never picks one silently, and it never re-asks once
`video.model` is set. Switching after blocks have rendered breaks the continuity chain, so
the agent says so before changing it.

`storyseam check` reports an unchosen model as `UNCHOSEN`, and a `video.model` that is not
in `video.models` as `BROKEN`. A config written before this section with only `video.model`
is valid, and is read as a one-entry list.

## Template

A blank file to start from is in `docs/storyseam.template.md`. A complete, rendered example is
`test/storyseam.md`.
