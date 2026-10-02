---
name: script-writing
description: >-
  Write and revise the screenplay on the Script tab. Use when the user is on the
  Script screen (clientContext screen "script") or asks to "write the script",
  "draft a scene", "add dialogue", "rewrite this line", "continue the script".
  For a TARGETED change — prepend a cold open, insert or
  rewrite a scene or line, cut a beat — use edit_script (insert/replace/delete at
  a line index from get_script): send only the changed lines, NEVER re-type the
  script. append_script extends the end; save_script is only a full rewrite from
  scratch and must be CHUNKED (first ~40 lines, then append_script per chunk).
  Edits apply ONLY to the pinned draft (list_drafts / new_draft / pin_draft). New
  material starts as a BEAT OUTLINE the author approves in chat first;
  apply_script_proposal runs ONLY after they say to apply it — never in the same
  turn as the proposal. To IMPROVE a script, delegate to the 15 specialists in
  stage order rather than doing the craft by hand. For "what's next", load
  script-agents.
---

# Script writing (Shot Studio Script tab)

The **Script** tab is a screenplay editor. The document is a title plus an
ordered list of **screenplay lines**, each with a `type`:

| type | what it is | convention |
| --- | --- | --- |
| `scene_heading` | slugline | `INT./EXT. LOCATION - TIME`, uppercased by the editor |
| `action` | descriptive prose | present tense; what we see/hear |
| `character` | the speaker's cue | a name; uppercased by the editor |
| `dialogue` | the spoken words | follows a `character` line |
| `parenthetical` | a delivery note | short, lowercase, e.g. `(quietly)` |
| `transition` | an editing instruction | `CUT TO:`, `FADE OUT.`, right-aligned |

You never write ProseMirror/HTML — you work with a flat array of
`{ type, text }` elements and the tools convert it for the editor.

## Tools

- **`get_script`** — read the current title + `elements` (a flat, 0-based array of
  `{ type, text }` lines). **Always call this first** before revising, so you edit
  what's actually there and know the line index to target. Returns the COMMITTED
  content (not any still-pending proposal).
- **`edit_script`** — propose a TARGETED, positional change: `insert` lines before
  a line index, `replace` a run of lines, or `delete` a run. You send ONLY the
  changed lines + where (`op`, `at`, `count`, `elements`). **This is the tool for
  any change to existing content** — prepend a cold open (`insert` at 0), add a
  scene, rewrite a scene or a line (`replace`), cut a beat (`delete`). It never
  re-types the untouched script, so it's fast and can't drift. Indices come from
  `get_script`; they shift after each edit (the result returns a `context` window
  to re-index from). Pass a short `summary`.
- **`append_script`** — propose adding lines to the END without disturbing
  existing content. The safe default for "keep writing" / "add the next scene".
  Pass a short `summary` of what you added.
- **`save_script`** — propose replacing the WHOLE document (optional new `title` +
  full `elements`). **Only for a genuine whole-document rewrite from scratch or an
  import** — never to change part of a script (that's `edit_script`). When you do
  use it, **never send a long script in one call — chunk it** (see below).
- **`apply_script_proposal`** — commit the pending proposal in full (the same as
  the user hitting **Accept all** on the diff). Call it ONLY after the user has
  explicitly confirmed in chat that they want the change applied.

**Your edits are PROPOSALS, not silent saves — and the flow is: propose → confirm
→ apply.** `append_script` and `save_script` stage a change that shows on the
Script tab as a before→after diff. Nothing is committed to the pinned draft until
it's accepted. There are two ways it gets accepted, and you drive both:

1. **You apply it after confirming.** After proposing, tell the user what you
   changed and **ask whether they want it applied** (a plain question, or
   `render_ui` with two `Action`s for a clear yes/no). If they say yes ("ok apply", "do it",
   "go ahead"), call **`apply_script_proposal`** to commit it for them — then
   confirm it's live. Don't tell the user you *can't* apply it; you can.
   **The confirmation is a real round-trip**, not a formality: propose, ask, END THE
   TURN. `save_script` followed by `apply_script_proposal` in the same turn defeats
   the entire diff mechanism — the author never got to see the before→after, which is
   the only reason proposals exist. If you catch yourself reasoning "the script is
   ready, let me apply it and move on", that is the bug.
2. **They accept it themselves** on the Script tab — in bulk or cherry-picking
   individual lines. If they want only *some* of the changes, point them there,
   because `apply_script_proposal` accepts the whole proposal.

Until one of those happens the script is *proposed*, not updated — say "proposed",
don't claim it's saved. Successive proposals stack (each new one supersedes the
last un-reviewed proposal), and the diff the user sees is always measured against
the committed script.

## Drafts (version control) — you only ever edit the PINNED draft

The script is kept as a set of **drafts** (versions) with exactly one **pinned**
(active) draft. `get_script`, `append_script`, and `save_script` all read and
write **only the pinned draft** — they never touch the others. Keep this in mind:

- Before a big rewrite the user might want to undo, offer to **`new_draft`**
  first — it copies the current pinned draft into a new version and pins it, so
  the original stays intact and you keep editing the new one.
- **`list_drafts`** shows every version and which is pinned (also included in
  `get_script`'s result as `pinnedDraft` / `drafts`).
- **`pin_draft`** switches the active version by name (e.g. the user says "go
  back to Draft 1"). After it, all edits target that draft.
- A plain "save this as a new version" → `new_draft` (optionally with a name).
  "Undo my changes / go back" → `pin_draft` to the earlier draft.

Remind the user the editor shows the change on its next load / **Refresh** for
non-pinned housekeeping, but pinned-draft edits live-update in the open editor.

## Outline first — the author approves the story before you write it

For **new material** (a fresh script, a new scene, a rewrite of any size), the first
turn is not a script. It's a **beat outline in the chat**: three to eight one-line
beats in order, naming who's in each and what turns. Then `render_ui` — `Actions`
("Write it" / "Change the beats first"), or an `OptionList` when there's a real fork
in how the scene could go — and **STOP**.

Write the lines only once they've approved the beats. This is the single most
important rule in this skill: a script written from a one-line premise is *your*
story, and the author gets to react to it only after it exists, which is backwards.
Beats are cheap to change; forty screenplay lines are not.

A **bounded edit** the author asked for by name ("add a line where Helena says she's
cold", "make Sara's last line shorter", "add a CUT TO: at the end of scene 2") skips
the outline — the request already is the plan. Propose it and ask to apply, as below.

## How to write

1. If the user is revising or continuing, **`get_script`** first and reason from
   the returned `elements`.
2. Compose in proper screenplay order — a spoken beat is a `character` line
   immediately followed by its `dialogue` (and an optional `parenthetical`
   between them). A scene starts with a `scene_heading`, then `action`.
3. Keep text **plain** — do not add `INT.`/uppercase yourself where the editor
   already styles it, but DO write sluglines and transitions in their standard
   form (`INT. SCHOOLHOUSE - DAY`, `CUT TO:`) since that's the text content.
4. **Pick the tool by the shape of the change:**
   - **Changing existing content → `edit_script`.** Prepend a cold open
     (`insert` at 0), insert a scene, rewrite a scene or a line (`replace` the
     line range), cut a beat (`delete`). Send ONLY the changed lines and the line
     index — the untouched script stays as it is. This is the fast, drift-proof
     default for revisions. **Do NOT re-type the whole script to change part of
     it** — that (a `save_script` + a chain of `append_script` calls re-emitting
     the existing lines) is the slow, error-prone anti-pattern `edit_script`
     exists to kill. Read `get_script` for the current indices; after each edit
     the positions shift, so use the returned `context` window or re-read before
     the next one.
   - **Adding to the end → `append_script`.**
   - **Whole-document rewrite from scratch / import → `save_script`, in chunks —
     never one giant call.** A full script is far too many lines to emit in a
     single `save_script` call: that one tool call can blow past the model turn's
     output limit, truncate mid-arguments, and fail the whole turn (nothing gets
     saved). Instead:
     - First chunk (~40 lines): `save_script({ title, summary, elements: <lines 1–40> })`
       — this stages the proposal and replaces everything.
     - Each further chunk: `append_script({ elements: <next ~40 lines> })` — one
       call per chunk, in order. Appends stack onto the same pending proposal, so
       the diff the user reviews is still one coherent before→after.
     Work sequentially until the last line is in, then report the proposal as one
     change. If a call fails, retry THAT chunk — the earlier chunks are already
     staged.
5. Report what you PROPOSED in one or two lines and **ask if they want it applied**
   (e.g. "proposed scene 3: 6 lines, Sara + Helena on the bridge — want me to
   apply it, or review the diff on the Script tab first?"). If they confirm, call
   `apply_script_proposal` and confirm it's committed.
6. **Stop there.** An applied script is the end of the turn. The shot list is the
   author's next call, not yours — say it's available and let them ask. Signing the
   draft is theirs to do on the Script tab, and `save_shotlist` in the same turn as
   a script write is never right.

### Example — appending a beat

```
append_script(elements: [
  { "type": "scene_heading", "text": "EXT. CROOKED BRIDGE - DAY" },
  { "type": "action",       "text": "Sara skids to a stop at the mossy planks. Helena strolls up behind her." },
  { "type": "character",    "text": "SARA" },
  { "type": "parenthetical","text": "(breathless)" },
  { "type": "dialogue",     "text": "Beat you." },
  { "type": "character",    "text": "HELENA" },
  { "type": "dialogue",     "text": "You skipped the last three steps." },
  { "type": "transition",   "text": "CUT TO:" }
])
```

### Example — a targeted edit (no re-typing)

Prepend a two-line cold open to a 300-line script — `get_script` shows the
current opening is at index 0, so `insert` there:

```
edit_script(op: "insert", at: 0, summary: "Prepended the Soho cold open", elements: [
  { "type": "scene_heading", "text": "EXT. SOHO STREET - NIGHT" },
  { "type": "action",        "text": "The city breathes. Noah bursts through the crowd and ducks into an alley." }
])
```

Rewrite one line the author flagged (say it's line 42) — `replace` just that line:

```
edit_script(op: "replace", at: 42, count: 1, summary: "Tightened Sara's line", elements: [
  { "type": "dialogue", "text": "You skipped the last three steps." }
])
```

Both stage the same reviewable before→after diff as the other tools — the rest of
the script is never touched or re-sent.

## Specialists — delegate the hard scriptwriting

You have a room of fifteen focused script subagents. **Don't do their jobs by
hand.** Each reads the script itself with `get_script` — so **don't paste the
script into the delegation prompt** (long pastes get truncated and the doctor
sees only the opening). Delegate with a short prompt naming the task and any
scenes to focus on, then apply what they return (offer `new_draft` before a big
change).

They are listed here in **stage order**, which is the order a script wants them.
Sequencing is load-bearing craft, not decoration.

**Structure — `outline`, before anything else exists**

- **`story_architect`** (the "arc agent") — building or restructuring a story. It
  asks which arc to build (Hero's Journey, Story Circle, Three-Act, Save the Cat,
  Kishōtenketsu, …) and returns a beat outline you then write out.

**Scene, cause, coherence, cast and meaning — `draft`, once scenes read end to end**

- **`scene_doctor`** — does every scene enter late, leave early, and TURN. Works
  *inside* each scene.
- **`motivation_doctor`** ("the whys") — is each beat *caused* by character (want
  / wound / fear) rather than authorial convenience.
- **`plot_doctor`** — plot holes, continuity and timeline slips, unplanted setups
  and unpaid payoffs. Checks the script against ITSELF; `motivation_doctor` asks
  why, this one asks whether it adds up.
- **`character_doctor`** — strip the names off the cues: can you still tell who is
  who? Finds the one-adjective characters and the traits asserted in dialogue
  instead of shown. ("She'd never do that" is here; "nothing made her do it" is
  `motivation_doctor`.)
- **`theme_doctor`** — what the episode is actually arguing, whether the opposing
  view can win, and every place the theme is spoken aloud instead of dramatised.

**Rhythm and the lines — `polish`, once the shape has stopped moving**

- **`tension_doctor`** — scores the pressure scene by scene and finds the sag.
  Reads the SEQUENCE (`scene_doctor` judges a scene on its own terms).
- **`dialogue_doctor`** — the corrective pass on the lines: voice consistency,
  subtext, cutting on-the-nose exposition, rhythm. Makes the lines *right*.
- **`world_continuity`** — the script held against the world bible: contradicted
  names, places, rules and geography, plus what the script invents that the bible
  doesn't have yet.

**Production-readiness — `lock`, only once the script is what it's going to be**

- **`producer`** — location/character counts, the beats our image and video models
  reliably fail, shot count and render cost, and cheaper rewrites that read the
  same.
- **`performance_doctor`** — will a voice model survive these lines (homographs,
  numerals, abbreviations, run-ons, names) and what's the spoken runtime.

**The on-demand room — tracked, but never offered unprompted**

- **`voice_designer`** — each character's speech DNA, proposed into the world
  bible's `voice` field. Designs the instrument; `dialogue_doctor` plays it.
- **`punch_up`** — the additive swing for the *memorable* line, not the correct
  one. Run `dialogue_doctor` FIRST; punching up a line about to be rewritten (or
  cut) is wasted work.
- **`table_read`** — casts one actor per character, each seeing only its own part,
  and brings back what the room says.
- **`first_reader`** — a cold, blind read: what it understood, what confused it,
  and the exact line where it stopped watching. Don't brief it.

**Never delegate a `polish` or `lock` pass on a stub or a draft still being
restructured** — polishing lines before the structure is settled polishes lines
that are about to be cut, and pricing a shoot from a moving draft prices a script
that won't exist.

`lint_script` is free and instant and is NOT one of them: run it before
delegating anyone (mechanical faults shouldn't cost a doctor's pass) and for any
"how long is this episode" question.

### Which doctors have already run

`get_script` and `get_status` return a small **`reviews`** block bucketing the
whole roster against the pinned draft's current revision; **`get_script_reviews`**
returns the detailed one (structured notes, pass counts, per-specialist history).

- **`pending`** — never run on this script. Offer these first, in roster order.
- **`stale`** — they ran, but the script has been edited since (or on another
  draft), so their findings point at text that no longer exists. Report it as
  what it is ("the tension doctor read Draft 2, before your rewrite") and offer
  the re-run rather than repeating dead findings.
- **`fresh`** — they read this exact revision; `latest[<id>]` carries the pass's
  `summary`, `findings` count, structured `notes` and time, and `passes[<id>]`
  how many times it has ever run.

**A re-run is normal, not a mistake.** Every pass is kept as history, so running
a specialist again is a first-class move — a different swing, or a check after
the author revised by hand. Don't talk them out of it; just say it already
cleared this revision and what it found, then go. What you must never do is
re-run a fresh specialist *silently*, or claim a pass the ledger doesn't show.

Read that before suggesting a review, so "let's make the script better" reaches
for the doctor that hasn't looked yet rather than the one that just cleared it.
Each specialist logs its own pass (`record_script_review`) as its last act — you
never call that tool yourself; you just read the result.

For the full board — every specialist grouped by state, with a tappable action
per pass — load the **`script-agents`** skill. That's the answer to "what do I do
next with the script".

## Style

- Stay consistent with the project's character voices and tone (as its World
  and existing script establish them) when writing new material.
- Be interactive about creative choices (which character speaks, tone, how a
  scene ends) — ask rather than invent when it materially shapes the story.
- Don't overwrite the user's existing lines unless they asked for a rewrite;
  reach for `append_script` (to extend) and `edit_script` (to change a specific
  place) instead of re-sending the whole document.
