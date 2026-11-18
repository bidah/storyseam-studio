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
| which sheets and plates the film needs, and how each is made | `shotlist/assets.json` | Derived from the shot list; see §11. |
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
| all clips, no `renders/final/` | rendered | `/edit` |
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

## 8. The editing program

`config.json` says where the film is cut, so the agent knows whether to edit it alone or in
the author's program:

```json
"editor": { "id": "davinci_resolve", "mcp": true, "computer_use": true, "notes": "Resolve Studio 20" }
```

| Key | Meaning |
| --- | --- |
| `id` | `none`: the agent edits the film itself with ffmpeg. Or the program: `davinci_resolve`, `premiere_pro`, `final_cut_pro`, `capcut`, or any other name. |
| `mcp` | Whether that program's MCP server is installed and connected in the agent's client. |
| `computer_use` | Whether the agent may drive the screen while it edits. |
| `notes` | Optional: version, edition, where the project file lives. |

A config with no `editor` is `{ "id": "none" }`. With a program named, `mcp` and
`computer_use` are required, and `storyseam check` reports one that is missing.

The `/edit` skill reads this. With `none`, it runs `/assemble`. With a program, it edits
**in** that program, and it uses the program's MCP and computer use **together**: MCP for the
exact operations (project, timeline, imports in block order, markers, render settings), and
computer use to look at what those operations did and to reach whatever the MCP does not
expose. An MCP call that reports success has not been verified until someone has looked at
the screen. With neither available, the agent writes an EDL for the author to import and
still produces `renders/final/film.mp4` with ffmpeg.

## 9. Recommending a model for each block

Models differ in what they will accept, and a request outside a model's limits is refused
whole (and may still be billed). Each block in `shotlist/shotlist.json` needs two numbers
checked against each candidate before anything renders:

- **Length**: the block's `dur`, against the model's `duration_seconds`.
- **References**: the images it cites (the chain anchor, character sheets, the location
  plate, prop plates), the videos (black-frame voices, motion references) and any audio,
  each against the model's `reference_ceiling`.

The limits come from the registry, never from memory:

| Model | Clip length | Images | Videos | Audio | Seam |
| --- | --- | --- | --- | --- | --- |
| `seedance_2_5` | 4–30s | 30 | 10 | 10 | first frame declared in prose (`@Image 1`) |
| `seedance_2_0` | 4–15s | 9 | 3 | 3 | a real `start_image`, so the seam is frame-exact |

The recommendation, in order:

1. Keep only the candidates (`video.models`) that accept the block's length and every
   reference count. When none does, the block is too long or too heavy: split it or drop
   references in `/shotlist`. Never let the provider find out.
2. A short, chained block prefers a model with a real `start_image` role, because the seam is
   then exact rather than declared in prose.
3. Otherwise, keep the story's `video.model`.
4. Otherwise, take the candidate with the most headroom.

So a long scene, or one that carries many references, goes to Seedance 2.5. A short scene
with few references can go to Seedance 2.0 for an exact seam.

`npx storyseam recommend` runs this rule over the shot list and prints a model per block,
with the reason and what each other candidate would refuse (`--all` compares every video
model in the registry, which is how an author finds out that adding a model to
`video.models` would help). It recommends and never writes. When a block's recommendation
differs from `video.model`, the agent shows the author and, on a yes, sets that block's
`model`. `/render` then uses that block's model and its director. One model for the whole
film keeps the look consistent, so the agent proposes a mix only where a block does not fit.

## 10. The MCP servers a story uses

A story records every MCP server it relies on, so it can be opened on another machine or in
another agent and set up the same way. They live in `config.json` under `mcp_servers`, keyed
by server name:

```json
"mcp_servers": {
  "higgsfield": {
    "used_for": ["video", "image"],
    "required": true,
    "transport": "http",
    "url": "https://mcp.higgsfield.ai/mcp",
    "auth": "oauth",
    "install": {
      "claude": "claude mcp add --transport http higgsfield https://mcp.higgsfield.ai/mcp",
      "codex": "codex mcp add higgsfield --url https://mcp.higgsfield.ai/mcp",
      "cursor": "add {\"mcpServers\":{\"higgsfield\":{\"url\":\"https://mcp.higgsfield.ai/mcp\"}}} to .cursor/mcp.json"
    }
  },
  "fal": {
    "used_for": ["video"],
    "required": false,
    "transport": "http",
    "url": "https://mcp.fal.ai/mcp-relay",
    "install": { "claude": "claude mcp add --transport http fal https://mcp.fal.ai/mcp-relay" }
  },
  "davinci-resolve": {
    "used_for": ["editor"],
    "required": true,
    "transport": "stdio",
    "install": { "any": "npx davinci-resolve-mcp setup" }
  }
}
```

| Key | Meaning |
| --- | --- |
| `used_for` | What the story uses the server for: `video`, `image`, `audio`, `editor`, or free text. |
| `required` | `true` when a stage cannot run without it: a provider reached by MCP, or the editor's server when `editor.mcp` is `true`. |
| `transport` | `http` (a remote server, with `url`) or `stdio` (a local program). |
| `url` | The server's address, for `http`. |
| `auth` | How it signs in: `oauth` (the client opens a browser) or the name of an env var it reads. Never the secret itself. |
| `install` | A command per agent (`claude`, `codex`, `cursor`), or `any` when one installer covers every client. |
| `notes` | Anything a person needs to know to make it work: edition, settings, what it is optional beside. |

`init` writes this from the story's providers and editor, and `--mcp <names>` adds more.
`npx storyseam mcp` prints what to install (`--agent codex` for one client). `storyseam check`
reports a provider reached by MCP with no entry, an `editor.mcp: true` with no server
`used_for` `"editor"`, and an entry with no `used_for` or `install`.

Before the first stage that needs a server, the agent confirms it is connected (one
read-only call). When it is not, the agent prints that server's `install` line for the
current client and stops. **It never installs a server, and never writes a token into a
file.**

Tool names depend on the name the server was installed under. Higgsfield installed as
`higgsfield` exposes `mcp__higgsfield__*`, and the claude.ai connector exposes
`mcp__claude_ai_higgsfield__*`. A skill matches the server, not one prefix.

## 11. The asset sheet

The shot list decides which stills the film needs, and those stills are the first thing that
costs money. So the shot-list pass ends by writing them down in one file the agent works
through and the author answers: `shotlist/assets.json`.

```json
{
  "title": "Nothing To Do",
  "assets": [
    {
      "kind": "character",
      "slug": "theo",
      "name": "Theo",
      "path": "assets/images/characters/theo.png",
      "refs_dir": "assets/refs/characters/theo/",
      "needed_by": ["block_01", "block_02", "block_03", "block_04"],
      "source": "refs",
      "refs": ["assets/refs/characters/theo/photo.jpg"]
    },
    {
      "kind": "location",
      "slug": "theo-living-room",
      "path": "assets/images/locations/theo-living-room.png",
      "refs_dir": "assets/refs/locations/theo-living-room/",
      "needed_by": ["block_01", "block_02", "block_03"],
      "source": "generate",
      "refs": []
    }
  ]
}
```

There is one entry per character sheet, location plate and prop plate. `needed_by` lists the
blocks that cite it, and `path` is where `/cast` writes it. `source` says how it is made:

| `source` | Meaning |
| --- | --- |
| `ask` | The author has not answered. `/cast` will not make it. |
| `refs` | Made from the author's own reference images in `refs`: a photo of the actor, the real room, the actual prop. The style prompt still applies, so the sheet matches the film's look. |
| `generate` | Made from the World's description alone (`world/*.md`). |

**The reference pass.** After `/shotlist`, the agent runs `npx storyseam assets`, which writes
the sheet from the shot list and keeps every answer already given. It then asks the author
**once, for every still at the same time**: do you have reference images for any of these, or
should they be generated? The author drops images into an asset's `refs_dir`, or attaches them
in the chat and the agent saves them there, or says "generate". Files found in a `refs_dir` mark
that asset `refs` on the next run. The agent records every answer, and does not ask again about
an asset that has one.

`assets/refs/` is human-filled, like `assets/audio/music/`: Storyseam reads it and never writes
to it, except to save images the author attached on purpose. `storyseam check` validates the
sheet against `schema/assets.schema.json`, and reports an asset marked `refs` with no images or
a ref that is not on disk.

## 12. Blocks land on beats

A block is cut where the story turns, not where the model runs out. Every block in
`shotlist/shotlist.json` covers whole, consecutive beats of `script/outline.md`, and **its last
second is the last second of a beat**, even when the model could keep going. A 22-second beat
is a 22-second block. It is never a 30-second block that runs eight seconds into the next beat,
because then the next block opens mid-moment and the seam falls on nothing.

- **`beats`** lists the outline beat numbers a block covers: `[2]`, or `[2, 3]` when short
  beats in one location share a block.
- **A beat longer than the model's maximum** is the one case a beat spans blocks. It splits into
  consecutive blocks that carry only that beat, each cut on a moment inside it, and each marked
  `"beat_part": { "n": 1, "of": 2 }`.
- **The block count follows from the beats.** `ceil(target_seconds / block_seconds)` is only
  the floor. A shorter block bills pro rata, so landing on beats costs seams, not much money.

The outline numbers its beats (`**3. TEN — the idea.**`, or a `### 3.` heading), which is what
`beats` refers to. `storyseam check` reports a block that ends mid-beat without a declared
split, a beat no block covers, a block citing a beat the outline does not have, and a shot list
where only some blocks say which beats they cover. Shot lists written before this section, with
no `beats` at all, are still valid.

## Template

A blank file to start from is in `docs/storyseam.template.md`. A complete, rendered example is
`test/storyseam.md`.
