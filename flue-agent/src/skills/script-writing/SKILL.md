---
name: script-writing
description: >-
  Read, write, and revise the screenplay on the Script tab of Shot Studio. Use
  when the user is on the Script screen (clientContext screen = "script") or asks
  to "write the script", "draft a scene", "add dialogue", "rewrite this line",
  "fix the screenplay", "continue the script", or anything about the screenplay /
  teleplay for the episode. The Script tab is a screenplay editor whose elements
  are scene headings, action, character cues, dialogue, parentheticals, and
  transitions — this skill drives it through the get_script / save_script /
  append_script tools. The script is version-controlled into drafts and every
  edit applies ONLY to the pinned (active) draft; list_drafts / new_draft /
  pin_draft manage the versions. To improve a script, delegate to the specialists
  (story-architect / plot-doctor / motivation-doctor / dialogue-doctor) instead of
  reviewing by hand, and pick one get_script's `reviews` block calls `pending`
  over one it calls `fresh` — a fresh doctor already cleared this exact revision.
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

- **`get_script`** — read the current title + `elements`. **Always call this
  first** before revising, so you edit what's actually there. This returns the
  COMMITTED content (not any still-pending proposal).
- **`append_script`** — propose adding lines to the END without disturbing
  existing content. The safe default for "keep writing" / "add the next scene".
  Pass a short `summary` of what you added.
- **`save_script`** — propose replacing the WHOLE document (optional new `title` +
  full `elements`). Use only for a full rewrite or a restructure; when in doubt
  read first and re-send the complete, corrected list. Pass a short `summary`.
- **`apply_script_proposal`** — commit the pending proposal in full (the same as
  the user hitting **Accept all** on the diff). Call it ONLY after the user has
  explicitly confirmed in chat that they want the change applied.

**Your edits are PROPOSALS, not silent saves — and the flow is: propose → confirm
→ apply.** `append_script` and `save_script` stage a change that shows on the
Script tab as a before→after diff. Nothing is committed to the pinned draft until
it's accepted. There are two ways it gets accepted, and you drive both:

1. **You apply it after confirming.** After proposing, tell the user what you
   changed and **ask whether they want it applied** (a plain question, or
   `ask_question` for a clear yes/no). If they say yes ("ok apply", "do it",
   "go ahead"), call **`apply_script_proposal`** to commit it for them — then
   confirm it's live. Don't tell the user you *can't* apply it; you can.
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

## How to write

1. If the user is revising or continuing, **`get_script`** first and reason from
   the returned `elements`.
2. Compose in proper screenplay order — a spoken beat is a `character` line
   immediately followed by its `dialogue` (and an optional `parenthetical`
   between them). A scene starts with a `scene_heading`, then `action`.
3. Keep text **plain** — do not add `INT.`/uppercase yourself where the editor
   already styles it, but DO write sluglines and transitions in their standard
   form (`INT. SCHOOLHOUSE - DAY`, `CUT TO:`) since that's the text content.
4. Prefer **`append_script`** to extend; use **`save_script`** for a rewrite.
5. Report what you PROPOSED in one or two lines and **ask if they want it applied**
   (e.g. "proposed scene 3: 6 lines, Sara + Helena on the bridge — want me to
   apply it, or review the diff on the Script tab first?"). If they confirm, call
   `apply_script_proposal` and confirm it's committed.

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

## Specialists — delegate the hard scriptwriting

You have a team of focused script subagents. Don't do their jobs by hand. Each
one reads the script itself with `get_script` — so **don't paste the script into
the delegation prompt** (long pastes get truncated and the doctor sees only the
opening). Delegate with a short prompt naming the task and any scenes to focus on,
then apply what they return (offer `new_draft` before a big change):

- **`story-architect`** (the "arc agent") — for building or restructuring a story.
  It asks which arc to build (Hero's Journey, Story Circle, Three-Act, Save the
  Cat, Kishōtenketsu, …) and returns a beat outline you then write out.
- **`plot-doctor`** — audit for plot holes / continuity and get coherence fixes.
- **`motivation-doctor`** ("the whys") — checks every beat is *caused* by
  character (want / wound / trauma / fear), not authorial convenience; a different
  lane from `plot-doctor`'s logical coherence.
- **`dialogue-doctor`** — voice consistency, subtext, and punch-up on the lines.

### Which doctors have already run

`get_script` (and `get_status`) return a **`reviews`** block bucketing all four
specialists against the pinned draft's current revision:

- **`pending`** — never run on this script. Offer these first.
- **`stale`** — they ran, but the script has been edited since (or on another
  draft), so their findings are against text that no longer exists. Worth a
  re-run after a big change.
- **`fresh`** — they read this exact revision; `latest[<id>]` carries the pass's
  `summary`, `findings` count and time. **Don't re-run a fresh one** unless the
  user asks — say what it already found instead.

Read that before suggesting a review, so "let's make the script better" reaches
for the doctor that hasn't looked yet rather than the one that just cleared it.
Each specialist logs its own pass (`record_script_review`) as its last act — you
never call that tool yourself; you just read the result.

## Style

- Stay consistent with the episode's voices (Sara: bright, playful; Helena: dry,
  deadpan) and the *Whistlewood* tone when writing new material.
- Be interactive about creative choices (which character speaks, tone, how a
  scene ends) — ask rather than invent when it materially shapes the story.
- Don't overwrite the user's existing lines unless they asked for a rewrite;
  reach for `append_script` and targeted `save_script` re-sends instead.
