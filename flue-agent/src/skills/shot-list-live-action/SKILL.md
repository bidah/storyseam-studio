---
name: shot-list-live-action
description: >-
  Turn the signed screenplay into the granular Shot list when the project's shot
  director has promptForm "blocks" — every ~2-4s shot with its camera, action,
  dialogue and a render prompt sent as `promptBlocks` (SCENE CONTEXT, ACTIVE
  REFERENCES, OPTICS, LIGHTING, POSITIVE LOCKS …). Route on promptForm ONLY, not
  on the director's name: several directors are called "Seedance", and the ones
  with promptForm "paragraph" (including the Seedance 2.0 Pro Director) belong to
  the shot-list skill instead. Call get_shot_director FIRST and write to the brief
  it returns — that text is the author's, edited on the Settings page, and it
  overrides this file. Works two ways: the WHOLE script at once, or
  ONE ~15s chunk per run ("generate the next 15 seconds") resuming from the
  `progress` marker on get_shotlist — always record `progress` after writing
  shots. Use ONLY when the user explicitly asks. Do NOT render video (that's
  generate-multishot).
---

# shot-list-live-action (script → shot list, block prompts)

Break the **pinned, signed** screenplay into an ordered list of shots and save it
with `save_shotlist`, writing each shot's render prompt as `promptBlocks`. The app
then **auto-packs** consecutive same-location shots into ≤15s multishot bundles
(you do NOT pack here) and later scaffolds the Episode tab from those packs. No
media is generated in this skill.

This is the block twin of the `shot-list` skill. Everything about the PIPELINE is
the same; everything about the PROMPT is different. A block prompt is not a longer
paragraph — it is a structured document that blocks, lights and paces the shot
like a film.

## The prompt system lives in the shot director, not in this file

`get_shot_director` returns the **canonical** brief for the prompt: what each
block contains, the FOV table, the locks, the checklist. The author edits it on
the Settings page and can save their own versions, so it is the live version of
the rules and it **overrides anything below**. Read it before you write the first
shot, on every run.

What is true regardless of how the author edits it — the contract with the app:

- Send **`promptBlocks`**, not `prompt`. The server composes `prompt` from the
  blocks in order and warns when a "blocks" director receives paragraphs.
- Use only the blocks the shot needs; omit the rest. An empty block is dropped,
  and a heading with nothing under it reads to the model as an instruction to
  invent something.
- The block keys, in order: `sceneContext`, `activeReferences`, `locationMap`,
  `firstFrame`, `formatMode`, `optics`, `camera`, `action`, `performance`,
  `physics`, `lighting`, `colorGrade`, `wardrobe`, `audio`, `style`,
  `outputSettings`, `positiveLocks`.
- **No style header at the top.** Style is distributed into the block that governs
  it, and the Episode tab's style preset (if any) is appended by the app *after*
  your blocks.
- **Each shot is a sealed document.** The generation has no memory of the shot
  before it: no scene numbers, no "as above / continues", no props or people
  carried in from a shot that isn't this one.
- **Positive phrasing only**, speeds in km/h, atmosphere in %/metres, FOV in
  degrees from the director's anchor table, left/right from the camera, no
  director or equipment names.

If `get_shot_director` fails, say so and use those invariants — but do not
invent a different block set, and do not fall back to a paragraph.

## Preconditions

- **`get_shot_director` reports `promptForm: "blocks"`.** Check the FIELD, not
  the name — a director called "Seedance 2.0 Pro Director" has promptForm
  `paragraph` and belongs to the other skill. If it reports `"paragraph"`, stop
  and use the **shot-list** skill instead: that director's whole prompt goes in
  the single `prompt` field, and blocks would be the wrong document. If the
  author says this should be a block/Seedance-director project but the setting
  disagrees, point them at Settings › Shot list director (or offer to switch it
  with `save_shot_director`).
- **The author asked for the shot list, in their own words, in this
  conversation.** Not "the script is done so shots are next" — that's the
  pipeline order, not permission.
- The script draft must be **signed** (the Script tab gates this).
- Read the current shot list with `get_shotlist` first. If it already has shots,
  do NOT silently overwrite — confirm with the user. The exception is a CHUNKED
  build (below): there, more shots are expected and you **append**.

## Two ways to build it — read the request

- **All at once** (default for "generate the shot list"): walk the whole script,
  saving one beat per call, until the screenplay is covered.
- **One chunk at a time** ("generate the next 15 seconds", "the next chunk of
  shots", the Shot list tab's *Generate next ~15s* button): write **ONE bundle's
  worth** — a single beat/location, roughly 4–6 shots whose `dur` sums to **≤15s**
  — `append` it, record `progress`, say where the list now stands, and **STOP**.
  Do not roll on into the next location. A block prompt is expensive to write;
  the chunk exists so the author sees shots quickly and steers before the rest is
  written.

## Steps

1. **`get_shot_director`** — the prompt system (above). Confirm `promptForm` is
   `blocks` and keep its `instructions` in front of you while writing.
2. **`get_world`** — the character roster. The `name` values are the **canonical
   character names** and the single source of truth for identity (casting matches
   a shot's character to a voice by this exact name). Copy each name **verbatim**
   — do NOT abbreviate ("Kai Morales" → "Kai"), expand, reorder, or re-spell it,
   or the character gets cast twice. A character with no World record (a one-off
   background role) can use a plain descriptive label ("Store Owner", "Teacher").
3. **`get_script`** — read the pinned draft (title + `elements[]`: scene_heading /
   action / character / dialogue / parenthetical / transition; a line's **0-based
   array index** is what `progress.throughIndex` records). On a CHUNKED run also
   read `get_shotlist`'s `progress` marker: start at `progress.throughIndex + 1`,
   use `progress.note` for where the story stands, and check
   `progress.throughLine` still matches that line (if the script was edited under
   you, re-find the line by its text rather than trusting the number).
4. **Read as a director** before cutting anything. Find the dramatic shape of each
   scene: where it turns, where it lands, where it breathes. Then define the
   continuity anchors — who is in frame, how they look, what they carry across
   cuts.
5. Walk the screenplay **in order** and cut it into shots. Each `scene_heading`
   starts a new **beat/location**; break a long action beat into several short
   shots the way a shooting script would (wides → mediums → close-ups → inserts).
   Aim for **~2–4s per shot**. Let the pace follow the drama: confession scene →
   air, held shots, beats of silence; action → compression, short cuts; a reveal
   lands on one held close-up.
6. For every shot fill the summary columns — these are the same in every
   production type and are what the app packs, casts and storyboards from:
   - **beat / beatTitle** — the scene's beat code (e.g. `B1`) and title.
     Consecutive shots in the same location MUST share a beat so they pack.
   - **location** — a stable slug (e.g. `motel-parking-lot`). Reuse the same slug
     for the same place so packing + references stay consistent.
   - **dur** — realistic seconds (drives the ≤15s packing).
   - **characters** — who is on screen, using the **exact** `name` from the World
     roster for every character that has one.
   - **camera** — the short framing + move label for the Shot list tab (e.g.
     "MCU, slow push-in"). The full camera direction goes in the `camera` BLOCK.
   - **action** — plainly what happens, one line. The full staging goes in the
     `action` BLOCK.
   - **dialogue** — the spoken line(s), or `(no dialogue)`.
   - **audioSync** — the line or SFX this shot lands on (timing note).
7. Then write the shot's **`promptBlocks`** to the director's brief.
8. **Save the list one beat at a time — never in a single giant call.** A block
   shot carries a whole document, so a full episode in one call will blow the
   model's output limit and fail the turn — even more surely than in the
   paragraph skill. So:
   - First beat: `save_shotlist({ shots: <beat-1 shots>, mode: "replace", source: "agent" })`
   - Each later beat: `save_shotlist({ shots: <that beat's shots>, mode: "append" })`

   One call per beat, in screenplay order. Each call is bounded and the list is
   durably saved after every batch, so an interruption leaves resumable partial
   progress. The `count` in each response is the running total, and `director`
   confirms which form the server expected.

   On a CHUNKED run there is exactly ONE call: `mode: "append"` with that chunk's
   shots (`"replace"` only when the list is empty and this is the first chunk).
9. **Record where you stopped — `progress`, on the LAST `save_shotlist` call of
   the run.** It is the only record the next chunk has, and it is written in the
   same call as the shots so the two can't disagree:
   ```
   progress: {
     throughIndex: <0-based index of the last get_script element you covered>,
     throughLine:  "<short verbatim quote of that line>",
     note:         "<1-2 sentences for a writer with no memory of this turn: where
                    the story stands, what happens next>",
     complete:     <true only when the list now reaches the script's last line>,
     draft:        "<get_script pinnedDraft>"
   }
   ```
   Send it on a full build too — a run that covered everything ends with
   `complete: true`, which is how the Shot list tab knows there is nothing left to
   generate.
10. Tell the user where the list stands: the shot count, how many ≤15s multishots
    they pack into (from the last response's `packs`), and — after a chunk — what
    the next chunk will cover. They can edit any block of any shot on the Shot
    list tab.
11. **Reconcile speakers with the World roster.** The last `save_shotlist` response
    may include `newSpeakers` — speaking characters with no World character yet,
    each with its `lines` count and the `shots`/`beats` it appears in. Split them
    by weight: a **recurring** speaker (several lines across more than one beat) is
    very likely a real character; a **one-off** is usually a bit-part. Use
    judgement — a single pivotal line can still be a real character — and let the
    user decide. `render_ui` an `OptionList` of the likely-real ones; for each they
    confirm, call `add_world_character` with the **exact** shot-list name and a
    one-line `role` citing where they appear. Leave the genuine bit-parts off the
    roster and say they stay castable from the Radio Casting rail.

## Do NOT

- Do not send a one-paragraph `prompt` for a block-director shot — send
  `promptBlocks`. The server composes `prompt` from them and warns when the wrong
  form arrives.
- Do not write the blocks from memory of this file when `get_shot_director`
  returned instructions — the author edits that brief precisely so the next shots
  change, and ignoring it silently undoes their edit.
- Do not write a style prefix or an art-style clause. The Episode tab's style
  preset is appended by the app after your blocks.
- Do not render video or call any Higgsfield tool here — that's
  `generate-multishot`, run later per bundle from the Episode tab.
- Do not pack shots into bundles yourself — the app packs automatically (≤15s,
  never crossing a beat/location). On a chunked run you SIZE the chunk to one
  bundle; the packing itself is still the app's.
- On a chunked run, do not `replace` a non-empty list, and do not carry on past
  the chunk you were asked for.
- Do not touch the existing Episode manifest or its renders.
