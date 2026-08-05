---
name: script-agents
description: >-
  The Script Agents board — what to do NEXT with the script. Use for "what's
  next for the script", "how do I continue", "what do I do now", "which agents
  have run", "which doctors have already read it", "who hasn't read it yet",
  "show me the script agents", "what's left on the script", "how do I make the
  script better", "review my script". Reads the ledger with get_script_reviews
  (plus lint_script, which is free), then draws ONE render_ui board of the whole
  15-strong roster grouped by state: never run, stale (the script changed since
  their pass), fresh (with what they found and how many passes). Every action's
  send string is the canonical phrase that runs that exact specialist. Sequence
  is load-bearing — structure, then scenes and causality, then lines;
  producibility and speakability only once the script is settled — so never
  offer punch-up or the producer on a stub. A re-run of a fresh specialist is a
  legitimate move, not a mistake. Never claim a pass the ledger does not show.
---

# The Script Agents board

Fifteen specialists can read the script. This skill answers the only question
the author actually asks about them — **"what now?"** — with a board that shows
who has read the current draft, what they found, and who hasn't looked yet.

## 1. Read the ledger first

**`get_script_reviews`** is the whole board in one call: the roster (each
specialist's `id`, `lane`, `stage`, `title`, `does`, `brief`) plus
`pending` / `stale` / `fresh`, `latest[id]` (summary, findings, structured
`notes`, when, which draft), `passes[id]` (lifetime run count) and
`history[id]`. `get_script` and `get_status` carry a smaller `reviews` block —
for the board, use this one.

Then **`lint_script`** whenever the script is more than a stub. It is free and
instant, it catches the mechanical faults (orphan dialogue, dangling character
cues, malformed sluglines, name drift) that would otherwise waste a doctor's
pass, and its `stats.estimatedRuntime` is how you answer "how long is this".
Mention a lint finding in your prose — never as a specialist row on the board;
lint is not a pass and records nothing.

## 2. Sequence is the advice

`stage` on each specialist is the earliest point its pass is worth spending:
`outline` → `draft` → `polish` → `lock`. Follow it, and say why when it matters:

1. **outline** — `story_architect`. Shape before anything else.
2. **draft** — `scene_doctor`, `motivation_doctor`, `plot_doctor`,
   `character_doctor`, `theme_doctor`. Scenes, cause, coherence, cast, meaning.
3. **polish** — `tension_doctor`, `dialogue_doctor`, `world_continuity`. Rhythm
   and the lines, once the shape has stopped moving.
4. **lock** — `producer`, `performance_doctor`. Can we render it; can a voice
   model say it.

**Never offer a punch-up, a producer pass or a performance pass on a script that
is still a stub or still being restructured.** Polishing lines before the
structure is settled polishes lines that are about to be cut, and pricing a
shoot from a draft that is about to change prices a script that will not exist.
Say that plainly when the author reaches for one early — then offer the
structural pass that unblocks it instead.

`ondemand` specialists (`voice_designer`, `punch_up`, `table_read`,
`first_reader`) are **listed but never pushed**. They are opt-in by design: they
belong on the board so the accounting is complete, at the bottom, without a
recommendation attached.

## 3. Draw the board

One `render_ui` card: a short `Text`, then **ONE `OptionList`** (`select: "one"`)
whose rows are the specialists. One list, not one per state — two single-select
lists on a card means the first tap kills the second (see `generative-ui`).
State goes in each row's `badge`, so the whole accounting is legible at a glance:

| bucket | badge | subtitle | meta |
| --- | --- | --- | --- |
| never run | `Never run` | the roster's `does` | — |
| stale | `Stale` | what it found last time, in its own words | `Draft 2 · 3 found` |
| fresh | `Fresh` | what it found on THIS revision | `2 passes` |

Order the rows: never-run `core` in roster order (cheapest structural value
first), then `stale`, then `fresh`, then never-run `ondemand` last. Cap the card
at **8–10 rows** — a fifteen-row list in a chat rail is a wall, and the program
should stay under ~20 statements. Anything you leave off, name in one line of
prose ("the producer and the performance doctor are waiting on a locked draft").

The row `title` is always **"Run the <specialist>"** (or **"Run the
<specialist> again"** for a fresh one), because a `send` must open with the
words on the control. The roster's own `title` ("Make every scene turn") reads
well as the subtitle, never as the row title.

```
root = Card([intro, board])
intro = Text("Four have read this revision. The structural passes are done — what's open is the cast and the meaning.", "body")
board = OptionList([scene, chr, theme, dlg, plot], "Script agents", "Or tell me which pass you want.")
scene = Option("Run the scene doctor", "Run the scene doctor over the pinned draft", "Checks each scene enters late, leaves early and turns", null, null, "Never run")
chr = Option("Run the character doctor", "Run the character doctor over the pinned draft", "Checks each personality reads from behaviour alone", null, null, "Never run")
theme = Option("Run the theme doctor", "Run the theme doctor over the pinned draft", "Checks the theme is argued, not stated", null, null, "Never run")
dlg = Option("Run the dialogue doctor again", "Run the dialogue doctor again over the pinned draft", "Last pass: 6 flat exchanges, all rewritten", "2 passes", null, "Stale")
plot = Option("Run the plot doctor again", "Run the plot doctor again over the pinned draft", "Cleared this revision: 1 open timeline slip in scene 4", "1 pass", null, "Fresh")
```

(`Option` is positional: `title, send, subtitle, meta, image, badge` — count the
`null`s.)

## 4. The `send` strings are canonical

A tap posts its `send` verbatim as the author's next message, and that message
has to route straight back to the right specialist. Use these, plus "again" for
a re-run:

| specialist | send |
| --- | --- |
| `story_architect` | `Run the story architect over the pinned draft` |
| `scene_doctor` | `Run the scene doctor over the pinned draft` |
| `motivation_doctor` | `Run the motivation doctor over the pinned draft` |
| `plot_doctor` | `Run the plot doctor over the pinned draft` |
| `character_doctor` | `Run the character doctor over the pinned draft` |
| `theme_doctor` | `Run the theme doctor over the pinned draft` |
| `tension_doctor` | `Run the tension doctor over the pinned draft` |
| `dialogue_doctor` | `Run the dialogue doctor over the pinned draft` |
| `world_continuity` | `Run the world continuity checker over the pinned draft` |
| `producer` | `Run the producer over the pinned draft` |
| `performance_doctor` | `Run the performance doctor over the pinned draft` |
| `voice_designer` | `Run the voice designer over the cast` |
| `punch_up` | `Take the pinned draft to the punch-up room` |
| `table_read` | `Hold a table read of the pinned draft` |
| `first_reader` | `Get a cold read of the pinned draft` |

Never write a `send` like "Option 2" or "the next review" — a vague phrase lands
back on you as an ambiguous request and you will pick the adjacent specialist.

## 5. A re-run is a first-class move

A `fresh` specialist gets a **Run again** row like everyone else. Running the
same doctor twice on the same text is legitimate — a different swing, or a check
after the author revised by hand — and every pass is kept in `history` with the
lifetime count in `passes`, so a second pass costs the ledger nothing and shows
the trend (9 findings → 4 → 1).

What you owe the author is the **fact**, not a lecture: "the plot doctor cleared
this revision an hour ago and found one open timeline slip — want it to go
again?" Then do it if they say yes. Do not talk them out of it, and do not
quietly re-run a fresh specialist without saying it already cleared this
revision and what it found.

## 6. The accounting rule

**Never claim a pass the ledger does not show.** Not "the plot doctor has looked
at this" because it feels likely, not "we've reviewed the structure" because you
delegated something structural three turns ago. If `get_script_reviews` puts it
in `pending`, it has never run — say so.

The reverse holds too: a `stale` pass is not a pass on the current text. Report
it as what it is — "the tension doctor read Draft 2 before your rewrite" — and
offer the re-run rather than repeating findings that point at deleted lines.

Each specialist logs its own pass with `record_script_review` as its last act.
You never call that tool yourself; you read what it wrote.
