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
  pin_draft manage the versions.
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

**Your edits are PROPOSALS, not silent saves.** `append_script` and `save_script`
stage a change that the user reviews on the Script tab as a before→after diff and
accepts (in bulk or per line) or rejects — nothing is committed to the pinned
draft until they accept. Successive proposals stack (each new one supersedes the
last un-reviewed proposal), and the diff the user sees is always measured against
the committed script. So: tell the user you've *proposed* a change and to review
it on the Script tab; don't claim the script is updated. A direct edit by the user
(or accepting the proposal) is what commits it.

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
5. Report what you PROPOSED in one or two lines and point the user to the Script
   tab to accept or reject it (e.g. "proposed scene 3: 6 lines, Sara + Helena on
   the bridge — review it on the Script tab").

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

You have a team of focused script subagents. Don't do their jobs by hand — read
the script first (`get_script`), delegate with the script in the message, then
apply what they return (offer `new_draft` before a big change):

- **`story-architect`** (the "arc agent") — for building or restructuring a story.
  It asks which arc to build (Hero's Journey, Story Circle, Three-Act, Save the
  Cat, Kishōtenketsu, …) and returns a beat outline you then write out.
- **`plot-doctor`** — audit for plot holes / continuity and get coherence fixes.
- **`motivation-doctor`** ("the whys") — checks every beat is *caused* by
  character (want / wound / trauma / fear), not authorial convenience; a different
  lane from `plot-doctor`'s logical coherence.
- **`dialogue-doctor`** — voice consistency, subtext, and punch-up on the lines.

## Style

- Stay consistent with the episode's voices (Sara: bright, playful; Helena: dry,
  deadpan) and the *Whistlewood* tone when writing new material.
- Be interactive about creative choices (which character speaks, tone, how a
  scene ends) — ask rather than invent when it materially shapes the story.
- Don't overwrite the user's existing lines unless they asked for a rewrite;
  reach for `append_script` and targeted `save_script` re-sends instead.
