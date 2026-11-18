---
name: script-agents
description: >-
  The script agents board — what to do NEXT with the script. Use for
  "/script-agents", "what's next for the script", "which doctors have read it",
  "who hasn't looked yet", "how do I make the script better", "review my script".
  Reads script/reviews.json plus the current word count, then shows the whole roster
  grouped by state: never run, stale (the script changed since their pass), fresh
  (with what they found). Sequence is load-bearing. Never claim a pass the ledger
  does not show.
---

# The script agents board

A room of specialists can read `script/script.md`. This skill answers the only
question an author actually asks about them — **"what now?"**

## 1. Read the ledger first

`script/reviews.json` is the record: `{ "passes": [ … ] }`, each entry
`{ specialist, draft, words, when, findings, verdict, summary }`, written by the root from
the specialist's envelope (`docs/specialist-contract.md`). Run `wc -w script/script.md` and
`ls script/drafts/` once, then compare every entry against those two values:

- **`pending`** — no entry. Never run on this script.
- **`stale`** — an entry exists, but its `words` differs from the current count or its
  `draft` is not the newest snapshot. Their findings point at text that may no longer
  exist.
- **`fresh`** — `words` matches and `draft` is the newest snapshot.

The board shows `findings` and `verdict` as recorded; `summary` is the "what it found"
column. Do not re-derive any of them from memory of the pass.

If `script/reviews.json` does not exist, everything is `pending`. Say that, do not
guess.

## 2. Sequence is the advice

Each specialist has an earliest stage at which its pass is worth spending:

1. **outline** — `story-architect`. Shape, before anything else.
2. **draft** — `scene-doctor`, `motivation-doctor`, `plot-doctor`,
   `character-doctor`, `theme-doctor`. Scenes, cause, coherence, cast, meaning.
3. **polish** — `tension-doctor`, `dialogue-doctor`, `world-continuity`. Rhythm and
   the lines, once the shape has stopped moving.
4. **lock** — `producer`, `performance-doctor`. Can we afford to render it; can a
   voice model say it.

**Never offer a punch-up, a producer pass or a performance pass on a stub or on a
draft still being restructured.** Polishing lines before the structure settles
polishes lines that are about to be cut, and pricing a shoot from a moving draft
prices a film that will not exist. When an author reaches for one early, say that
plainly and offer the structural pass that unblocks it instead.

`voice-designer`, `punch-up` and `first-reader` are **listed but never pushed**.
They are opt-in by design — they belong on the board so the accounting is complete,
at the bottom, without a recommendation attached.

## 3. Draw the board

A short paragraph, then one table. State goes in a badge column so the whole
accounting is legible at a glance.

| Specialist | State | What it does / what it found |
| --- | --- | --- |
| `scene-doctor` | Never run | Checks each scene enters late, leaves early, and turns |
| `dialogue-doctor` | Stale (v2, 6 found) | Last pass: 6 flat exchanges, all rewritten |
| `plot-doctor` | Fresh (2 passes) | Cleared this draft; 1 open timeline slip in scene 4 |

Order: never-run core in stage order first, then stale, then fresh, then the
on-demand three last. Cap it at eight or nine rows and name anything you leave off in
one line of prose ("the producer and the performance doctor are waiting on a settled
draft").

Close with **one** recommendation and the exact phrase that runs it — "Run the scene
doctor over the current draft" — not "shall I review it?"

## 4. Storyseam's own gate

`producer` is not optional here, and the board should say so once the draft is
settled. It is the only pass that converts a script into a **block count and a credit
cost** before `/shotlist` does it for real. A film that turns out to be 8 blocks
instead of 4 is a 300-credit surprise, and it is visible in the script.

## 5. The accounting rule

**Never claim a pass the ledger does not show.** Not "the plot doctor has probably
looked at this", not "we reviewed the structure" because something structural
happened three turns ago. If there is no entry, it never ran — say so.

The reverse holds too: a stale pass is not a pass on the current text. Report it as
what it is — "the tension doctor read v2, before the rewrite" — and offer the re-run
rather than repeating findings that point at deleted lines.

A **re-run is a first-class move**, not a mistake. Running the same doctor twice is
legitimate: a different swing, or a check after the author revised by hand. Say it
already cleared this draft and what it found, then go if they want it.
