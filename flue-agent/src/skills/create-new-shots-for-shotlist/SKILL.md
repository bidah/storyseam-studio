---
name: create-new-shots-for-shotlist
description: >-
  Add ONE (or a few) NEW shots INTO an existing Shot list without rebuilding it —
  the "insert a shot between two existing ones" flow, from the Shot list tab's "+"
  node or a chat request ("add a shot after MS-03", "insert a beat between shot 5
  and 6"). Use ONLY when a shot list already exists; the initial Script → Shot
  list build is the shot-list / shot-list-live-action skills. Author the shot the
  SAME way those do: get_shot_director for the prompt brief and its promptForm
  ("paragraph" → a `prompt` paragraph, "blocks" → `promptBlocks`), get_world for
  the roster, matching the neighbours' beat/location. Hard rules, true without the
  body: DRAFT the shot, show it as ONE `render_ui` confirm card (a KeyValue + an
  Approve/Reject Actions block), then STOP — write nothing yet. Only on approval,
  call `save_shotlist` with `mode:"insert"` and `anchorId` = the id of the shot it
  goes AFTER (omit to insert at the start). On reject, drop it — never re-ask,
  never renumber the neighbours.
---

# create-new-shots-for-shotlist (add a shot into an existing list)

The author wants a new shot dropped **into** the Shot list — between two existing
shots, before the first, or after the last — without regenerating the whole list.
The "+" node between two shot cards on the Shot list tab sends exactly this
request (naming the shot above and below it), and a plain chat message ("add a
close-up after MS-04 of her hand on the latch") lands here too.

This is the surgical counterpart of the **shot-list** / **shot-list-live-action**
skills: those turn a whole script into a fresh list; this adds a shot to a list
that already exists. You author a new shot to the **same standard** they do, then
splice it in with `save_shotlist mode:"insert"` — which preserves every existing
shot's id and its generated media (stills, animatic picture) and only mints ids
for the new shots.

## Preconditions

- **A shot list already exists.** Call `get_shotlist` first. If it's empty, this
  is the initial build — use the shot-list (2d / 3d-pixar) or
  shot-list-live-action skill instead, and say so.
- **You know where it goes.** The request names the neighbours (the "+" node
  passes the shot above and below; a chat request names an anchor like "after
  MS-04"). The anchor is the shot the new one goes **immediately after**
  (`anchorId`); inserting at the very top means **no** anchorId.

## Steps

1. **`get_shotlist`** — read the current shots (ids, beats, locations, cameras,
   durations) so you can place the new shot and copy the neighbours' style. Note
   the exact `id` of the shot the new one goes AFTER — that's your `anchorId`.
2. **`get_shot_director`** — the project's prompt system, edited by the author on
   the Settings page. Its `instructions` are the brief for this shot's render
   prompt and override the generic guidance here; its `promptForm` decides the
   form (step 3).
3. **`get_world`** — read the character roster. Roster `name` values are the
   canonical identity: copy any on-screen character's name **verbatim** (never a
   short form), exactly as the shot-list skills require, so casting doesn't
   duplicate them. A genuine one-off background role can use a plain label
   ("Store Owner").
4. **Author the new shot** the same way the matching shot-list skill would:
   - Inherit `beat`/`beatTitle` and `location` from the neighbours unless the
     request is clearly starting a new beat/place. Consecutive same-location
     shots must share a beat so they still pack together.
   - Fill `dur` (realistic seconds), `camera` (framing + move), `action`,
     `dialogue` (or `(no dialogue)`), `audioSync`.
   - **Render prompt by the director's `promptForm`** — the same fork as the
     shot-list skills: `"paragraph"` gets a single vivid, **style-free**, diegetic
     `prompt` paragraph; `"blocks"` gets `promptBlocks` (load
     **shot-list-live-action** for the block contract) and no `prompt`. Never
     both, and write either one to the director's `instructions`.
   - **Omit `id`** — the shot is new, so the server mints a fresh non-colliding
     one. (Passing an existing shot's id would collide; passing a made-up one is
     unnecessary.)
5. **Confirm before writing — draw the card, then STOP.** Say one short line
   naming what you'll insert and where, then call **`render_ui`** ONCE (load
   **generative-ui** for the syntax): a `Card` holding a `KeyValue` of the drafted
   shot's key fields (location, camera, action, dialogue, dur — and the prompt or
   a one-line prompt gist) and an `Actions` block with an **Approve** action
   (`tone:"primary"`) and a **Reject** action, each `send` written in the
   author's voice. Then **end your turn** — do NOT call `save_shotlist` yet. The
   author's tap is the only thing that authorises the write.
6. **On approval, insert it.** Call `save_shotlist` with `mode:"insert"`, the
   drafted `shots`, and `anchorId` set to the shot it goes after (omit anchorId to
   insert at the very start). The response returns `insertedIds` (the minted ids),
   the new `count`, and the fresh `packs`. Tell the author the new shot's id, that
   it landed between which shots, and how the ≤15s packs changed — and that they
   can edit any field on the Shot list tab.
7. **Reconcile speakers.** If the insert response includes `newSpeakers` (a
   speaking character with no World record), handle it exactly as the shot-list
   skill does: offer to promote a recurring one with `add_world_character`
   (verbatim name + a role note citing the shot), leave one-off bit-parts off.

## The confirm card (shape)

```
root = Card([intro, params, go])
intro = Text("A new shot to slot in after MS-04, in the kitchen.", "body")
params = KeyValue([
  {label: "Goes after", value: "MS-04 (kitchen)"},
  {label: "Location", value: "apartment-kitchen"},
  {label: "Camera", value: "Medium close-up, slow push-in"},
  {label: "Action", value: "Gwen's hand hovers over the latch, hesitating."},
  {label: "Dialogue", value: "(no dialogue)"},
  {label: "Length", value: "3s"}
], "New shot")
go = Actions([yes, no])
yes = Action("Add this shot", "Yes, add that shot after MS-04", "primary")
no = Action("Not this one", "No, don't add it")
```

Use ONLY details you actually drafted — invent no id (there is none yet; the
server mints it on approval) and no count you didn't read from `get_shotlist`.

## Do NOT

- Do NOT renumber, rewrite, or re-`replace` the surrounding shots — `mode:"insert"`
  leaves every existing shot and its media untouched; a `replace` to "add one
  shot" would risk the shrink-gate and orphan stills. Insert is the whole point.
- Do NOT write the shot before the author approves the card, and do NOT re-ask
  with a friendlier card if they decline — drop it and offer an alternative.
- Do NOT render any media here (no storyboard still, no video). This only writes
  the text shot; the author generates media later from the Episode / Animatic tab.
- Do NOT bake an art-style clause into the prompt — style is the Episode tab's
  project-level choice, same as the shot-list skills.
