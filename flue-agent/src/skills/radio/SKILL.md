---
name: radio
description: Voice a scene's dialogue for the Radio version — the audio-only pass of the episode. For each line in a scene, render the spoken line with Seed Audio using the character's favorited voice as a reference clip so the voice stays consistent, then link the take to the line. Use when the user presses "Render scene" on the Radio tab, or asks to "voice the dialogue", "make the radio version", "render the radio scene", or "voice-act this scene". This produces per-line voice takes only — sending the finished audio into the Editor timeline is a one-click step the user does from the Radio tab.
---

# radio (voice a scene's dialogue → per-line Seed Audio takes)

Voice every dialogue line of ONE scene with Seed Audio, cloning each character's
cast voice from its reference clip, and link each take to its line with
`attach_radio_take`. The Radio tab then shows the take under the line, and the
user sends the whole thing into the Editor themselves ("Send to editor").

This skill only produces audio. It does NOT stitch a timeline or render video.

## Preconditions

- The scene's lines each need a **cast voice** (`line.voiceRef`). If a line has
  `voiceRef: null`, its character has no voice cast. Cast one first, then render:
  render a short in-character voice sample (seed-audio), `like_sound_version`, and
  attach it — with `attach_character_voice` (by id) if the speaker is on the World
  roster, or `cast_radio_voice` (by name) if it's a **background / one-off speaker**
  with no World record (e.g. "Store Owner"). Only then voice the line. If the user
  would rather cast it themselves, tell them to use the Casting rail and skip that line.
- Voices come from the Sound Studio (`kind: "voice"` liked takes). The Radio tab
  seeds them from each World character's attached voice.

## Steps

1. `get_radio` — read the scenes. Find the scene the user asked for (by
   `beatTitle`/`beat`). Note each line's `id`, `character`, `text`, and
   `voiceRef.refUrl` (the reference clip — an **absolute, public URL** you can
   fetch directly).
2. Load the **seed-audio** skill (`load_skill("seed-audio")`) — it owns the
   Higgsfield `generate_audio` call, the 2048-char prompt gate, voice references
   (TA2A), and the poll→download flow.
3. For **each line in the scene, in order**:
   1. Download the character's reference clip to a local file straight from its
      absolute URL: `curl -sS -o ref.wav "<voiceRef.refUrl>"` (no env var or
      project header needed — `refUrl` is a public `/files/...` link). `file
      ref.wav` to confirm the container. (If an older payload only has
      `voiceRef.url`, that's a relative `/sound-media` path and needs the project
      header — prefer `refUrl`.)
   2. `media_upload` → `curl -X PUT` → `media_confirm` the ref clip (see the
      seed-audio skill's "Voice references" section), then generate the line:
      ```jsonc
      generate_audio {
        model: "seed_audio", format: "wav", sample_rate: 48000,
        prompt: "<Character> (voiced by @Audio1) says: \"<the exact line>\". Clean single voice, no music, no sound effects, no background.",
        medias: [{ value: "<media_id>", role: "audio_references" }]
      }
      ```
      Keep the take to JUST the spoken line — no SFX, no ambience, no music (the
      Radio version is dialogue only; the sound bed is added later in the Editor).
      Confirm the FIRST Higgsfield submit of the scene with the user, then proceed
      through the rest without re-confirming each one.
   3. Poll `job_status { sync: true }`, get the result `rawUrl`.
   4. `create_sound({ prompt: "<the line>", kind: "voice", name: "<Character> — <scene>" })`
      → returns a track id (e.g. `trk_7`). Its v1 is pending.
   5. `attach_sound({ id: <trackId>, v: 1, url: <rawUrl> })` — downloads the
      audio into the project and flips the version to "ready".
   6. `attach_radio_take({ lineId: <line.id>, trackId: <trackId>, v: 1 })` — links
      the take to the line so it appears on the Radio tab.
4. When the scene is done, tell the user how many lines you voiced and to press
   **"Send to editor"** on the Radio tab to lay the dialogue into a new
   "radio version" timeline in the Editor — or **"Agent pacing"** to send it
   and have you re-time the gaps from the shot list (the radio-pacing skill).

## Notes

- One take per line keeps each line independently trimmable in the Editor.
- If a reference job stalls for many minutes, the seed-audio skill's guidance
  applies (retry; matching voice descriptions keep it close).
- Never pass a prior generation's job id as a voice reference — always upload the
  reference file (see the seed-audio skill's known quirks).
- Do NOT touch the Shot list, the Episode manifest, or renders here — this is
  audio only.
