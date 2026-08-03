---
name: shot-list
description: >-
  Turn the signed screenplay into the granular Shot list — the flat, ordered list
  of every ~2-3s shot with its camera, action, dialogue and a Seedance prompt.
  This is the middle stage of the pipeline (Script → SHOT LIST → auto-packed <=15s
  multishots → Episode render). Use ONLY when the user explicitly asks for it —
  "generate the shot list", "break the script into shots", "make the shots from
  the script", "turn the script into shots". Never run it off the back of writing
  the script in the same turn — a finished script authorizes nothing here, the
  author asks for shots once they are happy with the screenplay. Do NOT render
  video here (that's generate-multishot) — this only writes text shots via
  save_shotlist.
---

# shot-list (script → granular shot list)

Break the **pinned, signed** screenplay into an ordered list of individual shots and
save it with `save_shotlist`. The app then **auto-packs** consecutive same-location
shots into ≤15s multishot bundles (you do NOT pack here) and later scaffolds the
Episode tab from those packs. No media is generated in this skill.

## Preconditions

- **The author asked for the shot list, in their own words, in this conversation.** Not
  "the script is done so shots are next" — that's the pipeline order, not permission.
  When you've just written or applied a script, the turn ends by *offering* the shot list;
  they run it when they're happy with the screenplay.
- The script draft must be **signed** (the Script tab gates this). If the user asks to
  generate before signing, tell them to Sign the script first.
- Read the current shot list with `get_shotlist` first. If it already has shots, do NOT
  silently overwrite — confirm with the user (regenerating replaces every shot).

## Steps

1. `get_script` — read the pinned draft (title + `elements[]`: scene_heading / action /
   character / dialogue / parenthetical / transition). Then `get_world` — read the
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
   - **prompt** — the **Seedance prompt**: one vivid paragraph. Fold any 2D-directing intent
     (multiplane depth, on-2s/on-1s motion accents, smears, overlap/follow-through) straight
     into the prose — Seedance won't literally animate "on 2s" but the cues steer motion.
     Keep the prompt **style-free** (no art-style clauses) and diegetic (no music bed /
     transition VFX) — the render style is chosen on the Episode tab (`set_episode_style`)
     and prepended to each bundle's prompt at render time.
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
5. When every beat is written, tell the user the final shot count and how many ≤15s
   multishots they packed into (from the last response's `packs`), and that they can edit
   any shot on the Shot list tab.
6. **Reconcile speakers with the World roster.** The last `save_shotlist` response may
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
  crossing a beat/location).
- Do not touch the existing Episode manifest or its renders.
