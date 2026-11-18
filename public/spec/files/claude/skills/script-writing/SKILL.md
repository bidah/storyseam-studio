---
name: script-writing
description: >-
  Write and revise the screenplay at script/script.md. Use for "/write-script",
  "write the script", "draft the scene", "add dialogue", "rewrite this line",
  "continue the script". New material starts as a BEAT OUTLINE the author approves
  before any pages exist. Snapshot to script/drafts/ before any large rewrite.
  To IMPROVE a script, delegate to the specialist room in stage order rather than
  doing the craft by hand. For "what's next", load script-agents.
---

# Script writing (Storyseam)

The script is a plain Markdown file: `script/script.md`. There is no editor, no
proposal queue, no accept button. You edit the file. That means the *only* thing
standing between the author and a script they did not ask for is you asking first.

## The document

Fountain-flavoured Markdown. Keep it mechanical so `/shotlist` can parse it:

```
# Title

## SCENE 1 — INT. NOAH'S LIVING ROOM - AFTERNOON

Sunlight cuts across a rug buried in unopened board games. NOAH, 8, sits
dead centre, chin on fists.

NOAH
Nothing. There is nothing to do.

MAYA
(dropping her backpack)
That's not a fact. That's a mood.

CUT TO:
```

- `## SCENE n — INT./EXT. LOCATION - TIME` starts every scene. The em dash and the
  slugline form are load-bearing; `/shotlist` splits on them.
- Action is prose, present tense, what we see and hear.
- A speaking beat is `CHARACTER` on its own line (all caps), an optional
  `(parenthetical)`, then the dialogue.
- Character names must match `world/characters.md` **verbatim**. "Maya", never "M."
  or "Maya Chen" if the roster says "Maya". Name drift casts a character twice.

## Outline first — always

For **new material** — a fresh script, a new scene, a rewrite of any size — your
first turn is not a script. It is a **beat outline**: three to eight one-line beats
in order, naming who is in each and what turns. Write it to `script/outline.md`,
show it in chat, and **stop**.

Write pages only once the beats are approved. This is the most important rule here:
a script written straight from a one-line premise is *your* story, and the author
only gets to react to it after it exists, which is backwards. Beats are cheap to
change; forty lines of screenplay are not.

A **bounded edit the author named** ("make Maya's last line shorter", "add a CUT TO:
at the end of scene 2") skips the outline. The request already is the plan.

## Length is a budget, not a vibe

Every 30 seconds of finished film is one paid Seedance block. Before you write,
read `config.json` → `target_seconds`, and write to it:

- **Roughly 1 script page ≈ 1 minute**, but animation runs shorter than live action —
  for this engine, **~145 spoken-and-acted words per minute** is the working number.
- A 2-minute film is **~290 words** of dialogue and action. That is four scenes at
  most, two or three characters, one or two locations.
- Overwriting is the single most common failure. A 4-minute script for a 2-minute
  target does not become a 2-minute film — it becomes a 2-minute film with the
  ending cut off. Count the words before you hand it over and say the estimate.

## Drafts

`script/script.md` is the pinned draft. `script/drafts/` holds immutable snapshots.

- Before any rewrite the author might want to undo, snapshot first:
  `cp script/script.md script/drafts/script.v$(N).md`. Then edit the pinned file.
- "Go back to v2" → copy the snapshot over `script/script.md`.
- Never edit a file in `drafts/`. They are history; history that changes is not
  history.

## How to write

1. If revising, read `script/script.md` first and reason from what is actually
   there — not from what you remember writing.
2. Read `world/characters.md` before any dialogue. Voice consistency is the thing
   readers notice first and the thing you drift on first.
3. Make targeted edits. Rewriting the whole file to change one line is how scripts
   silently lose scenes.
4. Report what changed in one or two lines plus the new word count and runtime
   estimate.
5. **Stop there.** A finished script is the end of the turn. The shot list is the
   author's next call, not yours — say `/shotlist` is available and let them ask.
   Running `/shotlist` off the back of writing a script, in the same turn, is never
   right: they have not read it yet.

## The specialist room — delegate the hard craft

You have a room of focused subagents in `.claude/agents/`. **Do not do their jobs by
hand.** Each reads `script/script.md` itself, so do not paste the script into the
delegation prompt — long pastes truncate and the doctor ends up reviewing the first
scene and guessing the rest. Delegate with a short prompt naming the task and the
scenes to focus on.

They are listed in **stage order**, which is the order a script wants them.
Sequencing is load-bearing craft, not decoration.

**`outline` — before anything exists**

- **`story-architect`** — builds or restructures the shape. Picks an arc (Hero's
  Journey, Story Circle, Three-Act, Save the Cat, Kishōtenketsu), consults that
  arc's expert subagent, and returns a beat outline you then write out.

**`draft` — once scenes read end to end**

- **`scene-doctor`** — does every scene enter late, leave early, and TURN.
- **`motivation-doctor`** — is each beat *caused* by character (want / wound / fear)
  rather than by authorial convenience.
- **`plot-doctor`** — holes, timeline slips, unplanted setups, unpaid payoffs.
  Checks the script against itself.
- **`character-doctor`** — strip the names off the cues: can you still tell who is
  who?
- **`theme-doctor`** — what the film is actually arguing, and every place the theme
  is spoken aloud instead of dramatised.

**`polish` — once the shape has stopped moving**

- **`tension-doctor`** — scores pressure scene by scene and finds the sag.
- **`dialogue-doctor`** — voice, subtext, cutting on-the-nose exposition, rhythm.
- **`world-continuity`** — the script held against `world/`. Contradicted names,
  places and rules, plus what the script invents that the world files lack.

**`lock` — only once the script is what it is going to be**

- **`producer`** — block count and render cost, the beats these models reliably
  fail, and cheaper rewrites that read the same. **This one is not optional in
  Storyseam**: it is what stops a script that costs 900 credits from reaching
  `/render` unnoticed.
- **`performance-doctor`** — will a voice model survive these lines (homographs,
  numerals, run-ons, names), and what is the real spoken runtime.

**On demand — tracked, never pushed**

- **`voice-designer`** — each character's speech DNA, written into
  `world/characters.md`. Designs the instrument; `dialogue-doctor` plays it.
- **`punch-up`** — the additive swing for the *memorable* line. Run
  `dialogue-doctor` first; punching up a line that is about to be rewritten is
  wasted work.
- **`first-reader`** — a cold, blind read: what it understood, what confused it,
  the exact line where it stopped watching. Do not brief it.

**Never run a `polish` or `lock` pass on a stub or on a draft still being
restructured.** Polishing lines before the structure settles polishes lines that are
about to be cut, and pricing a shoot from a moving draft prices a film that will not
exist.

## The ledger — you keep it, not them

Every specialist's final message ends with the same three-line envelope
(`docs/specialist-contract.md`):

```
VERDICT: <one line>
FINDINGS: <integer>
SUMMARY: <one sentence>
```

After a specialist returns, append one entry to the `passes` array in
`script/reviews.json` (the scaffold seeds it as `{ "passes": [] }`), copying the
envelope verbatim — never a number you estimated from the body:

```json
{ "passes": [
  { "specialist": "scene-doctor", "draft": "v2", "words": 291,
    "when": "2026-09-02T16:20:00Z", "findings": 3,
    "verdict": "Three of four scenes turn; scene 2 is inert.",
    "summary": "Scene 2 does not turn — Maya arrives already decided." }
] }
```

- `findings`, `verdict`, `summary` — the envelope's three lines, unchanged.
- `draft` — the `vN` of the newest snapshot in `script/drafts/` when the pass ran. If the
  script has never been snapshotted, snapshot it as `v1` first; a pass must name a draft
  that exists on disk.
- `words` — `wc -w script/script.md` when the pass ran. `/script-agents` re-runs the same
  command to decide fresh vs stale, so use that command and nothing else.
- `when` — ISO-8601 UTC.

A table read is **one** entry (`specialist: "table-read"`), never one per actor. A
specialist that returned a question instead of a deliverable (`story-architect` may) gets
no entry: nothing was read.

The subagents do not write this file; you do, from what they return. `/script-agents`
reads it to answer "what now". **Never record a pass that did not happen**, and never
claim a doctor read the current draft when the ledger shows it read an earlier one —
report that as what it is and offer the re-run. `bin/story-check.py` validates the file
against `schema/reviews.schema.json`.
