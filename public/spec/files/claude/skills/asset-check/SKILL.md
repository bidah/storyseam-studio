---
name: asset-check
description: >-
  Audit every reference the shot list needs — character sheets, location plates, prop
  plates, voice references, video references — report what is missing, generate it, and
  register it with the configured provider. Use for "/cast", "check the assets", "do we
  have everything", "make the character sheets", "cast the voices". Stills go through the
  image director; voices through the seedance-voice-casting skill; registration through
  the provider adapter. Runs BEFORE /render and is what stops a full-price block rendering
  against a missing sheet.
---

# /cast — every reference the film needs, on disk and registered

`/render` is expensive and `/cast` is cheap. Everything that can be got wrong for a still's
price instead of a block's price gets got wrong here.

## What this skill knows, and what it delegates

This skill owns the **audit** and the **go/no-go**. The craft and the mechanics live in
skills you load first:

- **The director for `config.image.model`** (`gpt_image_2` → `gpt-image-2-director`)
  owns how a character sheet, a location plate and a prop plate are prompted, including
  their aspect ratios. Install with `bin/registry-add.py <model>` if missing.
- **`seedance-voice-casting`** owns how a voice take is generated and turned into a voice
  reference. Install by name if missing.
- **The provider adapter for each `config.providers.<capability>.id`** owns how a file on
  disk becomes something a render can cite — an upload-and-confirm on Higgsfield, a
  public URL on Atlas and fal — and in which form a voice reference is accepted. Install
  with `bin/registry-add.py provider-<id>` if missing.

Read `config.providers` first and verify access the way the `providers` skill says. If
the image and video providers differ, stills are registered with one and voices with the
other.

## Step 0 — the asset sheet

Read `shotlist/assets.json` (`docs/spec.md` §11); run `npx storyseam assets` first if it is
missing or older than `shotlist.json`. It says, for every still, whether to make it from the
author's reference images (`source: "refs"`, files in `refs`) or from the World's description
(`"generate"`). **An asset still at `"ask"` is not yours to decide:** ask the author the
reference question for all of them at once (the `shotlist` skill's wording), and make nothing
for those until they answer.

## Step 1 — the audit (free, do it first, always)

`bin/asset-audit.sh` reads `shotlist/shotlist.json` and builds the union of everything it
cites:

- every name in any block's `characters` → `assets/images/characters/<slug>.png`
- every name in any block's `voices` → that character's voice reference (the adapter
  says which file: on Higgsfield `assets/audio/voices/blackframe/<slug>.mp4`)
- every `location` → `assets/images/locations/<slug>.png`
- every slug in any block's `props` → `assets/images/props/<slug>.png`
- every entry in `video_refs` → the file in `assets/video_refs/`
- on a chained block whose predecessor is done → the anchor frame in `renders/frames/`

Run it rather than eyeballing the JSON. Report the audit as its table — **present,
missing, not registered, stale, and what each missing item will cost** from
`config.costs` — before generating anything. If the total is more than a handful of
credits, say the total first.

## Step 2 — character sheets

One image per character, at `assets/images/characters/<slug>.png`, written through the
image director. When the asset sheet says `source: "refs"`, pass its `refs` as the image
inputs and tell the director they are the identity to keep: the face, the build, the real
place or object. The style prompt still applies, so a photo becomes a sheet in the film's
look rather than a photo. With `"generate"`, work from `world/*.md` alone. Location and prop
plates follow the same rule. This single image is the identity every block cites, so the director's
rules are not optional: full figure plus a clear face, plain background, costume locked,
portrait aspect. Append `prompts/image_style_prompt.txt` verbatim — it is what makes the
characters and the locations look like the same film.

A costume change is a *second* sheet (`<slug>-2.png`), and the shot list has to say which
blocks use which.

Download the result to the conventional path. **The file on disk is the asset**; a job id
in the chat is not.

## Step 3 — location plates and prop plates

Same director, same style-prompt append, at `config.aspect_ratio` (a plate is a frame the
film will match, where a sheet is a figure the film will cite).

- **Locations** — an empty establishing view of the place, no characters in it.
  Characters in a location plate confuse the model about who is in the block.
- **Props** — only for objects that must stay consistent across blocks. A generic couch
  does not need a plate.

## Step 4 — casting voices

A voice is cast once and reused by every block that character speaks in. Follow
`seedance-voice-casting` for the take (the cheap model, the character's own delivery, the
audio kept and the picture thrown away). Then produce the form the **video provider's
adapter** accepts as a voice reference — the black-frame `.mp4` on Higgsfield, the `.mp3`
itself on Atlas — and record both paths in `world/characters.md` under that character.

**This costs a video run** at `config.costs.voice`. Voice casting comes out of the same
run budget as the film itself, so cast only characters who actually speak (`voices` in the
shot list, not `characters`), and cast each exactly once.

## Step 5 — register every reference with the provider

Every file `/render` will cite has to be something the provider can fetch. Do that here,
not in `/render`, so the expensive skill never blocks on it. Follow the adapter's section
on registering references. What must be true afterwards, whatever the provider:

- every reference the audit lists has a provider-side handle or a reachable URL;
- that mapping is recorded where the adapter says (`.storyseam/media.json` on Higgsfield,
  with the file's `mtime` so a later edit shows as **STALE** in the audit; a URL-based
  provider records the published URL instead);
- `bin/asset-audit.sh` reports every reference as present and registered.

A reference registered against an older version of the file renders the wrong picture at
full price. Re-register whenever the file on disk is newer than its record.

## Step 6 — the go/no-go

End with a single verdict:

- **Ready** — every block's references exist and are registered. Say the block count and
  the total render cost from `config.costs`, and name `/render` as next.
- **Not ready** — list exactly what is missing and why it could not be made. **Do not tell
  the author to run `/render` against a partial cast.** A block that cites a missing
  sheet does not fail — it renders something plausible and wrong, and you pay full price
  to find out.

## Do NOT

- Do not generate music or anything into `assets/audio/music/`. That folder is the
  human's.
- Do not render story blocks here. That is `/render`.
- Do not skip the style-prompt append. It is the whole reason the film is coherent.
- Do not generate a sheet for a character the shot list never names, or a plate for a
  prop no block cites. Every generation is real money.
- Do not write a provider's upload or URL mechanics into this skill. They belong in the
  adapter.
