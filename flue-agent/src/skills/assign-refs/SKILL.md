---
name: assign-refs
description: Assign each episode bundle's reference picks (character sheet images, location sheets, and voice references) from the World roster — the same flow as the Episode tab's auto-assign button, runnable end-to-end by the agent. Use when the user asks to "assign references", "auto-assign refs", "set up the bundle references", "prepare the bundles for rendering", or when a render flow needs bundles whose image/audio picks aren't set yet. The World roster is the ONLY source of references — if auto_assign_refs returns a validation failure, STOP and relay it; never substitute images or voices from the Sound Studio, the asset library, or another project.
---

# assign-refs (World roster → per-bundle image + voice picks)

Fill every episode bundle's reference picks from the **World roster**: each
on-screen character's linked sheet image, each shot location's linked location
sheet (matched by slug), and each speaker's linked voice. This is exactly what
the Episode tab's auto-assign does — the agent can run the whole flow itself.

## The one rule

**The World roster is the single source of truth.** A character's look is its
linked `sheetImage`; its voice is its linked `voiceRef`. If a needed link is
missing, the ONLY fix is linking it on the World roster — never hunt for a
lookalike image in the library, never import a Sound Studio track as a
substitute voice, never reuse another project's reference files.

## Steps

1. **Ensure there is a plan.** `get_episode` (compact). If there is no episode
   manifest yet — or the shot list changed since it was built —
   `rebuild_episode_plan` first (needs a saved shot list). The compact view's
   per-bundle `refs`/`missing`/`speakers` show what each bundle needs and which
   needs have no sheet linked yet.
2. **Run the assignment.** `auto_assign_refs` — no args assigns EVERY bundle
   (overwrites all picks); `{ beat: "B3" }` re-assigns only that beat and leaves
   the rest untouched. Prefer the beat-scoped form when the user has hand-tuned
   other bundles.
3. **On `ok: false` (validation): STOP.** The result lists which characters are
   `notInWorld`, `missingSheet`, or `missingVoice`, plus a ready-made `message`.
   Show the user that validation message and do not assign anything by other
   means. Then offer the fixes, and only proceed on the user's go-ahead:
   - Character not in the roster → `add_world_character` (world-creation skill).
   - No sheet linked → generate/link one via the **sheet-generation** skill
     (`attach_character_sheet` / `attach_location_sheet`).
   - No voice linked → cast one via the **radio** flow
     (`list_character_voices` → `attach_character_voice`; render a sample with
     **seed-audio** + `like_sound_version` first if none exists).
   After the links are in place, re-run `auto_assign_refs`.
4. **On `ok: true`: report.** Say how many bundles got picks (`summary`) and
   surface any `warnings` (e.g. locations with no sheet linked — those bundles
   got character sheets only; link the location sheet and re-run to fill them).
5. **Fine-tune only if asked.** Individual picks: `select_reference` (images,
   by library `rel`) and `select_audio_ref` (voices — `list_audio_refs` shows
   the pool: `world-voice:<charId>` entries from the roster, each with an
   agent-fetchable `refUrl`). When the user approves a bundle, they (or you, if
   asked) sign it off with `sign_bundle`.

## Notes

- Voice validation applies to **speakers** only (radio-style dialogue
  attribution: a `NAME:` prefix wins, else the shot's first on-screen
  character). Silent background characters need a sheet but not a voice.
- Audio picks are stored as `world-voice:<charId>` — they follow the character,
  so re-linking a better voice take later updates every bundle automatically.
- Missing **location** sheets warn but don't block; missing **character** links
  always block, by design.
- After assignment the bundles are render-ready: the generate-multishot skill
  consumes these picks (sheets + location as `image_references`, the voice refs
  upstream in the Seed Audio pass).
