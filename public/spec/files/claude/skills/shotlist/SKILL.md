---
name: shotlist
description: >-
  Turn the finished script into an ordered shot list packed into <=30s blocks, each with
  its prompt (written through the director for config.video.model) and its ordered
  reference list. Use for "/shotlist", "make the shot list", "break the script into
  shots", "generate the next block". Writes shotlist/shotlist.json (canonical, see
  schema/shotlist.schema.json) and shotlist/shotlist.md. Generates NO media — that is
  /cast and /render. Run ONLY when the author asks; never off the back of writing the
  script in the same turn.
---

# /shotlist — script → 30-second blocks

The shot list is the contract between the script and the renders. It is the last place a
mistake is cheap: a wrong reference here is a text edit, the same mistake in `/render` is
a full block's price.

## What this skill knows, and what it delegates

This skill owns **how the script is cut into blocks** and **what each block cites**. The
prompt itself — every word of it — is written through **the director for
`config.video.model`** (`seedance_2_5` → `seedance-2-5-director`), or of the block's own
`model` when it has one. The director owns the
prompt contract: the section structure, how the anchor frame is declared, how references
are numbered, the audio line, what never goes in a prompt. Load it and follow it; if it is
not installed, `bin/registry-add.py <model>` first. Do not write prompts from memory of
this file.

## Preconditions

- `script/script.md` exists and the author has said they are happy with it. "The script
  is done, so shots are next" is the pipeline order, not permission.
- Read `config.json` (`aspect_ratio`, `target_seconds`, `block_seconds`, `costs`) and
  `world/characters.md`, `world/locations.md`, `world/props.md`.
- If `shotlist/shotlist.json` already has blocks, do **not** silently overwrite. Say how
  many blocks exist and confirm — regenerating replaces every prompt, and any block
  already rendered would need re-rendering to match.

## The unit is the block, not the shot

A block renders in **one call, up to `block_seconds`** (30). A block is:

- **One location.** A location change is always a block boundary. No exceptions — this is
  what makes the last-frame chain coherent.
- **One set of character sheets**, cited once and binding for the whole block.
- **2–4 timed shots** inside it, each with its own framing and one clear action.
- **≤ 30 seconds, and it ENDS ON A BEAT.** A block covers whole beats of
  `script/outline.md`, and its last second is the last second of a beat, even when the
  model could run longer. A block is as long as its beats, not as long as the model
  allows: a 22s beat is a 22s block, never a 30s block padded with half of the next beat.
  Several short consecutive beats may share a block when they share a location. A beat
  longer than the model's maximum splits into consecutive blocks that carry only that
  beat (`beat_part`), each cut on a moment inside it. See `docs/spec.md` §12.
- **Record it:** `beats` lists the outline beat numbers the block covers (`[2]`, or
  `[2, 3]`), and a split beat's blocks carry `"beat_part": { "n": 1, "of": 2 }`.

The block count follows from the beats, not from `ceil(target_seconds / block_seconds)`;
that is only the floor. **Say the block count and the credit cost out loud before you
write the first prompt** (`config.costs.block_30s` per 30s, pro rata for a shorter block):
the author is entitled to know what they are about to spend.

## Steps

1. **Read the script.** Split on `## SCENE n — SLUGLINE`. Note every character who
   speaks, every location, every prop that has to stay consistent.
2. **Map beats onto blocks.** Walk the outline's numbered beats in order and time each
   from the script (~145 words per minute of dialogue and acted action). Close the block
   at the END of a beat: when the next beat would push it past the model's maximum, when
   the location changes, or when the beat is a turn that deserves its own cut. A beat
   longer than the maximum splits into consecutive blocks of that beat alone. Never close
   a block in the middle of a beat to fill it to 30 seconds.
3. **Plan the internal shots.** Inside each block, cut 2–4 shots the way a storyboard
   would — wide to establish, mediums for the exchange, a close-up on the turn. Give each
   a start and end second.
4. **Collect what each block cites.** For every block list:
   - `characters` — exact names from `world/characters.md`. Verbatim. No short forms.
   - `location` — a stable slug reused across blocks (`noah-living-room`).
   - `props` — slugs for objects that must stay consistent.
   - `voices` — which characters speak in this block (a subset of `characters`).
   - `video_refs` — only if a real motion or camera reference exists.
   - `start_from_previous_last_frame` — `false` on `block_01` and on any block that
     opens a **new location** where a hard cut is wanted; `true` everywhere else.
     Continuity is the default; a cut is a decision.
5. **Write the ordered `references` list** — the contract between the prompt and the
   render. The director says in what order references are numbered in the prompt; write
   the block's reference files in exactly that order (on a chained block the anchor frame
   `renders/frames/block_<N-1>_last.jpg` first, then character sheets, the location
   plate, prop plates, then voice references). `/render` passes them in this order, and
   `bin/story-check.py` verifies the prompt's `@Image N` mentions agree with it.
6. **Write the prompt — through the director.** Give the director the block's shots,
   its `references` and its `final_frame`, and take back the prompt it produces. Two
   things this skill checks on what comes back, because they are breakable here:
   - it ends with an audio line that says **no music**;
   - it contains **no art-style clauses** — the style comes from
     `prompts/video_style_prompt.txt`, appended at render time. A style baked into the
     block prompt fights the style file and the film stops matching itself.
7. **Write both files.** `shotlist/shotlist.json` is canonical (`schema/shotlist.schema.json`)
   and is what `/cast` and `/render` read. `shotlist/shotlist.md` is the same content for
   a human. Run `bin/story-check.py` before reporting.

## shotlist.json shape

```json
{
  "title": "<title from config.json>",
  "aspect_ratio": "16:9",
  "block_seconds": 30,
  "blocks": [
    {
      "id": "block_02",
      "scene": 1,
      "location": "noah-living-room",
      "dur": 30,
      "characters": ["Noah", "Maya"],
      "props": ["board-game-pile"],
      "voices": ["Noah", "Maya"],
      "video_refs": [],
      "start_from_previous_last_frame": true,
      "references": [
        { "kind": "anchor",    "path": "renders/frames/block_01_last.jpg" },
        { "kind": "character", "path": "assets/images/characters/noah.png", "label": "Noah" },
        { "kind": "character", "path": "assets/images/characters/maya.png", "label": "Maya" },
        { "kind": "location",  "path": "assets/images/locations/noah-living-room.png" },
        { "kind": "prop",      "path": "assets/images/props/board-game-pile.png" },
        { "kind": "voice",     "path": "assets/audio/voices/blackframe/noah.mp4", "label": "Noah" },
        { "kind": "voice",     "path": "assets/audio/voices/blackframe/maya.mp4", "label": "Maya" }
      ],
      "shots": [
        { "t": "0-10", "camera": "Wide, locked off", "action": "...", "dialogue": "..." },
        { "t": "10-22", "camera": "Medium two-shot, slow push-in", "action": "...", "dialogue": "..." },
        { "t": "22-30", "camera": "Close-up on Noah", "action": "...", "dialogue": "(none)" }
      ],
      "prompt": "<what the director wrote — numbers @Image 1..5 and the voices in the order above>",
      "final_frame": "Noah centre frame, eyes lifting toward Maya, both hands still on the rug."
    }
  ]
}
```

Image-kind references (`anchor`, `character`, `location`, `prop`) are numbered `@Image 1..K`
in list order; `voice` and `video` references follow, numbered by the director's convention.
A voice reference path is the form the video provider accepts — the adapter names it.

## Chunked runs

"Generate the next block" writes **one** block, appends it, and stops. Record where you
stopped in `shotlist/shotlist.json` under `progress`:

```json
"progress": { "through_scene": 2, "through_block": "block_02",
              "note": "Maya has just had the idea; next block is the transformation.",
              "complete": false }
```

The whole point of a chunked run is that it comes back fast and the author reads it
before asking for more. Do not roll on into the next block.

## Do NOT

- Do not generate any image or video here. `/cast` makes references, `/render` makes
  clips.
- Do not end a block mid-beat to fill it out. A short block that lands on its beat is
  right; a full one that cuts a beat in half is wrong, and the next block opens on the
  wrong moment.
- Do not pack a block over `block_seconds`. Seedance caps at 30 and a 31-second block is
  silently clamped, which truncates the beat you wrote for the end.
- Do not cross a location inside a block.
- Do not write the prompt yourself, and do not edit what the director wrote to "tidy" it.
  Resolution, media roles and reference numbering are the director's; a prompt that
  drifts from the director's contract renders against the wrong image.
- Do not invent a character who is not in `world/characters.md`. If the script has one,
  add them to the world file first and say you did — an uncast character has no sheet
  and no voice, and `/cast` will stop.

## Before you hand over — recommend a model per block

Run `npx storyseam recommend` over the finished shot list (`docs/spec.md` §9).
A block no candidate accepts is too long or carries too many references: split it or cut
references now, while it is free. When a block's recommendation differs from
`config.video.model`, show the author the line with its reason and, only on a yes, set that
block's `model`. Never mix models silently. One model across the film keeps the look.

## Then — the asset sheet and the reference pass

Run `npx storyseam assets`. It writes `shotlist/assets.json`: every character sheet, location
plate and prop plate the blocks cite, which blocks need each, and how each will be made
(`docs/spec.md` §11). Then ask the author ONE question that covers every still with
`source: "ask"`, grouped by kind, with the number of blocks each is in:

> These stills need making before anything renders. Do you have reference images for any of
> them (a photo of the person, the real place, the actual object)? Drop them in the folder
> shown, or attach them here. Anything without references I'll generate from the World.

Save attached images into that asset's `refs_dir`, then run `npx storyseam assets` again.
Set `source` to `"generate"` for the ones the author wants generated. Do not ask again about
an asset that already has an answer, and generate nothing here: making the stills is `/cast`.

