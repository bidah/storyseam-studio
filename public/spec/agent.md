# Set up a Storyseam story

You are setting up a film project in the Storyseam convention: a folder that describes a
story to coding agents. The folder is the whole format; there is no server and no app.
The filesystem is the state. Follow these steps in order, and do not generate any media
while you do it.

## 1. Read the spec

Fetch and read `https://storyseam.app/spec/storyseam.md`. It defines `storyseam.md`, the
file at the root of every story: YAML front matter for the tokens (`storyseam`, `title`,
`logline`, `look`, `arc`, `language`, `audience`), then prose sections for the rationale
(`## Premise`, `## Shape`, `## Decisions`, `## Budget`, `## Status`, `## Notes`). It also
says which values live in which file. That ownership table is the rule you will be held to.

## 2. Install the engine and every skill

Run this in the parent directory of the new story:

```bash
npx -y https://storyseam.app/spec/storyseam-0.2.0.tgz init <folder> --title "<working title>" --agent <claude|codex|cursor> --yes
```

That one tarball is the whole engine. It installs the pipeline skills, the 21 script
specialists, the slash commands, the JSON schemas, the decision records, the spec, and the
director and provider skills `config.json` asks for. Everything lands inside `<folder>`,
so the story is self-contained afterwards. Pick `--agent` for the tool you are running in:

| You are | `--agent` | Skills land in | Entry file |
| --- | --- | --- | --- |
| Claude Code | `claude` | `.claude/skills/`, `.claude/agents/`, `.claude/commands/` | `CLAUDE.md` |
| Codex, or any agent that reads `AGENTS.md` | `codex` | `.storyseam/skills/`, `.storyseam/agents/` | `AGENTS.md` |
| Cursor | `cursor` | `.storyseam/skills/`, `.storyseam/agents/` | `AGENTS.md` + `.cursor/rules/storyseam.mdc` |

Optional flags: `--seconds 120` (runtime; each 30s block is one paid video run),
`--aspect 16:9|9:16`, `--provider higgsfield|atlas|fal`, and `--video <id,id>` to offer
the author more than one video model (`--video seedance_2_5,seedance_2_0`).
`npx -y https://storyseam.app/spec/storyseam-0.2.0.tgz list` shows the models the registry knows.

If you cannot run `npx`, the same files are listed one by one at
`https://storyseam.app/spec/skills.json`. Each entry has a raw URL and the path it belongs
at, so you can write the tree by hand.

## 3. Write `storyseam.md`

`init` deliberately does not write `storyseam.md`: its absence is how the engine knows the
story has not been started. Ask the author for these in ONE message, with your best guesses
filled in so they correct rather than compose:

1. Title
2. Premise (who wants what, and what is in the way)
3. Runtime in minutes
4. Look (the visual world in a phrase)
5. Shape (`16:9` cinematic or `9:16` vertical)

**If `config.json` has `video.models` with more than one entry and no `video.model`, add a
sixth question to the same message: which video model to use.** Name each candidate with one
line from its director skill on what it is good at. The skill is the id with `_` turned
into `-`, plus `-director` (`seedance_2_5` → `skills/seedance-2-5-director/SKILL.md`). Write the answer to `video.model`, and record
it with the reason under `## Decisions`. Never pick for the author, and never ask again once
`video.model` is set.

Then write `<folder>/storyseam.md` from `docs/storyseam.template.md`, following
`docs/spec.md`. Write the two style prompts in `prompts/` from the look. If runtime or aspect
changed from what `init` was given, update `config.json`, never `storyseam.md`. In Claude
Code, `/start-story` does this whole step for you.

## 4. Check, then hand over

```bash
cd <folder> && npx -y https://storyseam.app/spec/storyseam-0.2.0.tgz check
```

Report the tree, the config values (call out loud that video is 480p and stills are 2k),
and the one next command: `/write-script`. The pipeline after that is:

```
/write-script → /shotlist → /cast → /render → /assemble → renders/final/film.mp4
```

## Rules you may not break

1. **Never generate music.** Every video prompt ends with
   `Audio: diegetic only — dialogue, room tone and Foley. No music.`
2. **Video is Seedance 2.5 at 480p**, because resolution is the cost lever.
3. **Images are GPT Image 2 at 2k, high quality**, because a soft reference poisons every
   block that cites it.
4. **The backend is configuration.** `config.json` names one provider per capability.
   Never handle an API key's value, and never write one into a file.
5. **One block at a time, chained.** The last frame of block N is the first reference of
   block N+1.

Spend nothing during setup. The first credit is spent in `/cast`, after a script exists and
the author has read it.
