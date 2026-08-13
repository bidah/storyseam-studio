---
name: shot-list
description: >-
  Turn the signed screenplay into the granular Shot list when the project's shot
  director writes into the SINGLE `prompt` field (promptForm "paragraph") — every
  ~2-3s shot with its camera, action, dialogue and its Seedance prompt, written
  exactly as the director's instructions say (one vivid paragraph, or the
  labelled single-shot document the Seedance 2.0 Pro director specifies). Call
  get_shot_director FIRST and obey it; if promptForm is "blocks", use
  shot-list-live-action instead. Middle stage of the pipeline (Script → SHOT LIST
  → auto-packed <=15s multishots → Episode render). Works two ways: the WHOLE
  script at once, or ONE ~15s chunk per run ("generate the next 15 seconds")
  resuming from the `progress` marker on get_shotlist — always record `progress`
  after writing shots. Use ONLY when the user explicitly asks. Never run it off
  the back of writing the script in the same turn. Do NOT render video (that's
  generate-multishot).
---

# shot-list (script → granular shot list, single-`prompt` directors)

Break the **pinned, signed** screenplay into an ordered list of individual shots and
save it with `save_shotlist`. The app then **auto-packs** consecutive same-location
shots into ≤15s multishot bundles (you do NOT pack here) and later scaffolds the
Episode tab from those packs. No media is generated in this skill.

## Preconditions

- **`get_shot_director` reports `promptForm: "paragraph"`** — the whole render
  prompt goes in the shot's single `prompt` field. What that text looks like is
  the DIRECTOR's business, not this skill's: the 2D/3D directors ask for one
  vivid paragraph, the Seedance 2.0 Pro director asks for a labelled single-shot
  document (Spatial blocking / anchors / Action / Camera / … / Final frame). Read
  it and write what it asks for. If it reports `"blocks"`, STOP and use the
  **shot-list-live-action** skill instead: that director's prompt is sent as
  `promptBlocks` and `save_shotlist` will warn that the wrong form was saved.
- **The author asked for the shot list, in their own words, in this conversation.** Not
  "the script is done so shots are next" — that's the pipeline order, not permission.
  When you've just written or applied a script, the turn ends by *offering* the shot list;
  they run it when they're happy with the screenplay.
- The script draft must be **signed** (the Script tab gates this). If the user asks to
  generate before signing, tell them to Sign the script first.
- Read the current shot list with `get_shotlist` first. If it already has shots, do NOT
  silently overwrite — confirm with the user (regenerating replaces every shot). The
  exception is a CHUNKED build (below): there, more shots are expected and you
  **append**, never replace.

## Two ways to build it — read the request

- **All at once** (default for "generate the shot list"): walk the whole script,
  saving one beat per call, until the screenplay is covered.
- **One chunk at a time** ("generate the next 15 seconds", "the next chunk of
  shots", the Shot list tab's *Generate next ~15s* button): write **ONE bundle's
  worth** — a single beat/location, roughly 4–6 shots whose `dur` sums to **≤15s**
  — `append` it, record `progress`, tell the author where the list now stands, and
  **STOP**. Do not roll on into the next location: the whole point of the chunk is
  that it comes back fast, and the author reads it before asking for more.

Either way, `progress` (step 5) is what makes the NEXT run continue instead of
re-cutting the same scene.

## Steps

0. **`get_shot_director`** — the author's prompt system for this project, edited
   on the Settings page. Its `instructions` are the brief for every `prompt` you
   write below and they **override** this skill's generic prompt guidance
   wherever the two differ; its `promptForm` must be `paragraph` (see
   Preconditions). Read it before writing the first shot, every run — it changes
   between runs, that's what it is for.
1. `get_script` — read the pinned draft (title + `elements[]`: scene_heading / action /
   character / dialogue / parenthetical / transition; a line's **0-based array
   index** is what `progress.throughIndex` records). On a CHUNKED run also
   `get_shotlist` and read its `progress` marker: start at
   `progress.throughIndex + 1`, use `progress.note` for where the story stands,
   and check `progress.throughLine` still matches that line (if the script was
   edited under you, re-find the line by its text rather than trusting the
   number). Then `get_world` — read the
   character roster. Its `name` values are the **canonical character names** and the
   single source of truth for identity (casting matches a shot's character to a voice by
   this exact name). Copy each name **verbatim** into the shots below — do NOT abbreviate
   ("Kai Morales" → "Kai"), expand, reorder, or re-spell it, or the character gets cast
   twice. A character with no World record (a one-off background role) can use a plain
   descriptive label ("Store Owner", "Teacher").
2. Walk the screenplay **in order** and cut it into shots. Each `scene_heading` starts a
   new **beat/location**; break a long action beat into several short shots (wides →
   mediums → close-ups → inserts) the way a storyboard would. Aim for **~2–4s per shot**.
3. For every shot fill all fields (the canonical columns
   `SHOT | TIME | CAMERA | ACTION | SEEDANCE-PROMPT | AUDIO-SYNC`):
   - **beat / beatTitle** — the scene's beat code (e.g. `B1`) and title. Consecutive
     shots in the same location MUST share a beat so they pack together.
   - **location** — a stable slug (e.g. `school-clearing`, `kings-house-tea-nook`). Reuse
     the same slug for the same place so packing + references stay consistent.
   - **dur** — realistic seconds (drives the ≤15s packing).
   - **characters** — who is on screen, using the **exact** `name` from the World roster
     (`get_world`) for every character that has one. Never a short form or variant of a
     roster name — "Kai Morales", never "Kai". Only genuinely off-roster background roles
     get an ad-hoc label.
   - **camera** — framing + move (e.g. "Medium close-up, slow push-in").
   - **action** — plainly what happens.
   - **dialogue** — the spoken line(s), or `(no dialogue)`.
   - **audioSync** — the line or SFX this shot lands on (timing note).
   - **prompt** — the **Seedance prompt**, written to the brief `get_shot_director`
     returned and in the structure it asks for (one paragraph, or its labelled
     sections). That brief is canonical; what the 2D/3D directors ship with is to
     fold any 2D-directing intent (multiplane depth, on-2s/on-1s motion accents,
     smears, overlap/follow-through) straight into the prose — Seedance won't literally
     animate "on 2s" but the cues steer motion — and to keep the prompt **style-free**
     (no art-style clauses) and diegetic (no music bed / transition VFX), because the
     render style is chosen on the Episode tab (`set_episode_style`) and prepended to
     each bundle's prompt at render time.
4. **Save the list one beat at a time — never in a single giant call.** A full episode
   is far too many shots (each with a long Seedance prompt) to emit in one
   `save_shotlist` call: that single tool call can blow past the model's output limit and
   fail the whole turn. So build it incrementally:
   - First beat: `save_shotlist({ shots: <beat-1 shots>, mode: "replace", source: "agent" })`
     — this starts a fresh list.
   - Each subsequent beat: `save_shotlist({ shots: <that beat's shots>, mode: "append" })`
     — one call per beat, in screenplay order.

   Work through the beats **sequentially**, one `save_shotlist` call per beat. Each call is
   bounded and the list is durably saved after every batch, so if anything interrupts you
   mid-generation the beats already written survive and you (or the user) can resume by
   appending the rest. The `count` in each response is the running total.

   On a CHUNKED run there is exactly ONE call: `mode: "append"` with that chunk's
   shots (`"replace"` only when the list is empty and this is the first chunk).
5. **Record where you stopped — `progress`, on the LAST `save_shotlist` call of the
   run.** It is the only record the next chunk has, and it is written in the same
   call as the shots so the two can't disagree:
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
6. Tell the user where the list stands: the shot count (running total), how many ≤15s
   multishots they pack into (from the last response's `packs`), and — after a chunk —
   what the next chunk will cover, so they can press the button again or ask for the
   rest. They can edit any shot on the Shot list tab.
7. **Reconcile speakers with the World roster.** The last `save_shotlist` response may
   include `newSpeakers` — speaking characters in the shot list that have **no World
   character** yet (each with its `lines` count and the `shots`/`beats` it appears in).
   These are the casting gap: without a World record they can only be voiced from the
   Radio rail's override, not shared with the World tab. So surface them and offer to fix it:
   - Split them yourself by weight — a **recurring** speaker (several lines across more
     than one beat) is very likely a real character; a **one-off** (a single line) is
     usually a background bit-part. Don't hard-code the line count as the rule — a single
     pivotal line can still be a real character, so use judgement and let the user decide.
   - `render_ui`: an `OptionList` of the likely-real ones, asking which to add to the World. For each
     the user confirms, call `add_world_character` with the **exact** shot-list name and a
     one-line `role` that cites where they appear (e.g. "Shopkeeper Miles buys the burner
     from — shots 44–46"). Leave want/need/arc empty for the user to flesh out later.
   - Leave the genuine bit-parts OFF the roster — tell the user they stay castable from
     the Radio Casting rail (the app can voice them there without a World entry).

## Render style — do NOT bake one into the prompts

Per-shot Seedance prompts carry **no art-style clauses**. The render style is a
project-level choice: the Episode tab's style selector (or the `set_episode_style`
tool) picks a visual-world style preset — or none at all, which is the default and
correct when the image references alone carry a realistic look — and the app
prepends it to each bundle's composed prompt at render time. Baking a style into
the shot prompts would fight that selector.

## Do NOT

- Do not render video or call any Higgsfield tool here — that's `generate-multishot`, run
  later per bundle from the Episode tab.
- Do not pack shots into bundles yourself — the app packs automatically (≤15s, never
  crossing a beat/location). On a chunked run you SIZE the chunk to one bundle
  (~≤15s of shots in one location); the packing itself is still the app's.
- Do not touch the existing Episode manifest or its renders.
- Do not write shot prompts from memory of this file when `get_shot_director`
  returned instructions — the author edits that brief precisely so the next shots
  change, and ignoring it silently undoes their edit.
- On a chunked run, do not `replace` a non-empty list, and do not "helpfully"
  carry on past the chunk you were asked for.
