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
  append_script tools.
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
  first** before revising, so you edit what's actually there.
- **`append_script`** — add lines to the END without disturbing existing content.
  The safe default for "keep writing" / "add the next scene".
- **`save_script`** — replace the WHOLE document (optional new `title` + full
  `elements`). Use only for a full rewrite or a restructure; when in doubt read
  first and re-send the complete, corrected list.

All three autosave server-side. Remind the user the editor shows the change on
its next load / **Refresh** (it does not live-push into an open editor).

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
5. Report what you changed in one or two lines (e.g. "added scene 3: 6 lines,
   Sara + Helena on the bridge").

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

## Style

- Stay consistent with the episode's voices (Sara: bright, playful; Helena: dry,
  deadpan) and the *Whistlewood* tone when writing new material.
- Be interactive about creative choices (which character speaks, tone, how a
  scene ends) — ask rather than invent when it materially shapes the story.
- Don't overwrite the user's existing lines unless they asked for a rewrite;
  reach for `append_script` and targeted `save_script` re-sends instead.
