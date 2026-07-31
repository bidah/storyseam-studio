---
name: video-from-audio-vfx
description: >-
  Produce a talking-character shot/scene as a clean two-stem pipeline: a SPEECH
  audio stem (voice-locked dialogue) and a separate VFX audio stem (SFX, foley,
  ambience, music) generated independently with Seed Audio, then a Seedance video
  lip-synced to the SPEECH stem only, and finally a "with-VFX" video produced by
  mixing the VFX stem on top with ffmpeg. Yields TWO video versions per shot
  (clean lipsync + with-VFX) and versioned, timestamped takes. Use whenever
  generating lip-synced character video where you also want sound design (footsteps,
  ambience, crashes, music) — because a single voice-locked Seed Audio pass renders
  mostly the speech and DROPS the SFX/ambience. Triggers: "lipsync video with sound
  effects", "separate speech and vfx", "add vfx on top of the video", "two-stem
  audio for video", "video-from-audio-vfx". Model/resolution come from the
  project Video defaults (get_visual_world); audio refs force mode "std".
---

# video-from-audio-vfx

A pipeline skill that combines **seed-audio** (ByteDance Seed Audio 1.0) and
**seedance_2_0** (Higgsfield) via the Higgsfield MCP. Read the **seed-audio**
skill for Seed Audio params/format and the upload→confirm→`audio_references`
mechanics; this skill orchestrates them.

> ⭐ **Default `generate_audio: true` on every Seedance `generate_video` call.**
> `generate_audio:false` returns a **silent** video, so the delivered clip has no
> audio unless you mux one on. Prefer `true` (voiced output with embedded audio).
> Only use the `generate_audio:false` + ffmpeg-mux path (Run D / Run E) when the
> user explicitly needs the **exact** seed-audio take preserved byte-for-byte in
> the file; otherwise keep audio baked in with `true`.

## Model + resolution come from the project defaults

Call **`get_visual_world`** and take the video params from `settings.videoModel` +
`settings.videoResolution`, resolved through the `videoModels` catalog in the same
response. Send that entry's `model` and `mode` (omit `mode` when null) — never the
catalog `id`. Wherever this skill writes `seedance_2_0` below, it means "the model
resolved this way". If the resolved resolution isn't in the chosen model's
`resolutions`, use `720p`.

> ⚠️ **`mode: "fast"` rejects `audio_references`.** Every run here attaches an audio
> or black-MP4 voice reference, so when the project default is **Seedance 2.0 Fast**
> (`audioRefs: false`), render with `model: "seedance_2_0"`, `mode: "std"` instead
> and say so in one line. **Mini and Fast cap at 720p** — 1080p needs `seedance_2_0`
> with `mode:"std"`.

> 🏷 **Name the two scene stems `<base>-dialog.<ext>` and `<base>-vfx.<ext>`.**
> The SPEECH stem (voices only, NO SFX/ambience) → `*-dialog.*`; the VFX stem
> (SFX/foley/ambience/music only, NO voices) → `*-vfx.*`. This tag is the **check
> net** the `generate-multishot` skill uses to pick the right audio: it feeds ONLY
> the `-dialog` stem to Seedance as `audio_references` and never the `-vfx` stem.
> (Per-shot take files may still use the older `_speech_take`/`_vfx_take` tags the
> shot-studio dashboard parses; the scene-level stems should carry `-dialog`/`-vfx`.)

## Why two stems (the whole point)

A voice-locked Seed Audio pass (TA2A, with an `audio_references` voice clip)
biases hard toward reproducing the **voice** and tends to **drop the ambient
SFX** described in the prompt. Example seen in practice: a shot prompt said
"soft footsteps and forest ambience under the line," but the voice-locked output
contained only the spoken line — no footsteps. So we DON'T ask one pass to do
both. We generate **speech** and **VFX** separately and combine them.

Bonus: lip-sync is cleaner when Seedance receives a **speech-only** track (no
SFX confusing the mouth timing), and we keep a clean dialogue stem for mixing.

## Outputs per shot (what you end up with)

```
shotNN/
  takes/
    shotNN_speech_takeNN_<ts>.wav|mp3     # stem A: DIALOGUE only (voice-locked, no SFX)
    shotNN_vfx_takeNN_<ts>.wav|mp3        # stem B: SFX/ambience/music only, NO voices
    shotNN_lipsync_takeNN_<ts>.mp4        # video v1: silent seedance + SPEECH muxed
    shotNN_withvfx_takeNN_<ts>.mp4        # video v2: same video + (speech+VFX) muxed
  shotNN_*  (latest convenience copies, optional)
```
`<ts>` = a timestamp like `YYYYMMDD-HHMMSS`; `takeNN` increments per regeneration
so **previous versions are always preserved**.

**The two audio stems are kept SEPARATE — do NOT pre-mix them into a combined
audio file.** Both are shown side-by-side in the UI (speech player + vfx player)
so each can be auditioned independently. The only place speech+VFX get combined
is when muxing the **with-VFX video** (v2) — that's an ffmpeg step at the video
stage, never a stored audio deliverable. Seedance lip-syncs to the **speech**
stem alone.

---

## The flow

### Run A — SPEECH stem (voice-locked dialogue)
`generate_audio` model `seed_audio`, `pitch_rate` as needed, with the character
voice reference as the single `audio_references` (one ref only — the MCP rejects
2+). Prompt = the dialogue with delivery notes; keep ambience minimal here.
```jsonc
{ model:"seed_audio", format:"wav", sample_rate:48000, pitch_rate:2,
  medias:[{value:"<voice_ref_media_id>", role:"audio_references"}],
  prompt:"Match <char>'s voice to the reference. <Char> (delivery): \"<line>\"" }
```

### Run B — VFX stem = DISCRETE EFFECTS ONLY (no background) — pure T2A
`generate_audio` model `seed_audio`, **no reference** (pure T2A so the sound
design actually renders). Seed Audio is **not** TTS — a T2A pass renders real
SFX (footsteps, door, bell, whoosh, slap), so the effects must be audible.

⚠️ **EFFECTS ONLY — exclude continuous background/ambience.** Generate just the
shot-specific discrete effects (footsteps, door creak, bell, high-five slap,
sparkle). Do **NOT** bake in a continuous ambience bed (room tone, birdsong,
wind, traffic): each shot's ambience would render slightly differently, so when
shots are cut together the background would **jump at every edit**. Prompt with
"NO voices, no speech, no music, **no background ambience** — only the discrete
sound effects, over silence." Keep the tail clean/quiet.

**Backgrounds are a separate, scene-level stem (handled later).** The continuous
ambience/room tone for a scene should be ONE bed generated once and laid under
ALL shots in the edit so it stays consistent across cuts — not per shot. Treat it
as a third stem type, e.g. `sceneNN_bg_takeNN_<ts>` at the scene level (solution
TBD). For now, per-shot stems = **speech** + **effects** only.

⚠️ **LOUDNESS LESSON (learned the hard way):** a hedged prompt full of
"gentle / soft / light / faint" renders **near-silent** (seen: mean −66 dB, i.e.
nothing). Write the SFX **assertively** and **boost loudness**:
```jsonc
{ model:"seed_audio", format:"wav", sample_rate:48000, loudness_rate:35,
  prompt:"3 seconds of DISCRETE SOUND EFFECTS only, full, loud, clearly audible,
  over SILENCE. No voices, no speech, no music, NO background ambience and NO
  birdsong. Just steady rhythmic FOOTSTEPS crunching on leaves — crunch, crunch,
  crunch — close, present, crisp and detailed, then quiet." }
```
**ALWAYS verify the bed isn't silent before using it:**
```bash
ffmpeg -hide_banner -nostats -i vfx.wav -af volumedetect -f null - 2>&1 | grep volume
```
If `mean_volume` is below ~−50 dB it failed — regenerate louder/more assertive, or
boost in post (`-af volume=10dB`). Target the standalone bed around −30 dB mean.

### (No audio-stage join.)
Keep speech and VFX as separate stems. They are combined ONLY at the video stage
(Run E, v2). Reason: the Higgsfield MCP accepts only ONE `audio_references`, so a
two-input Seed Audio "stitch" isn't reachable today anyway — and keeping stems
apart is what lets Seedance lip-sync to clean speech and lets you audition each.

### ⭐ PREFERRED Run D — Seedance native audio via a black-screen MP4 voice reference
This is the best path: Seedance **embeds the lip-synced dialogue audio itself** (no
ffmpeg mux), in the character's voice, by feeding the voice clip as a **black-screen
MP4** through the `video_references` role.

Why this exact shape (all verified):
- A raw audio file in `audio_references` makes Seedance **silent** unless
  `generate_audio:true`, and even then it generates a **new** voice — not ours.
- Passing the audio as a **video** (black frames + the audio) via `video_references`
  + `generate_audio:true` makes Seedance speak the line in the **reference voice**
  and embed it. Confirmed: output had Sara correctly rendered (black frames ignored)
  + native AAC audio, speech filling the line.
- ⚠️ A video file in the `audio_references` role is **rejected**: `404 Audio input
  not found`. Must use `video_references`.

Steps:
1. Convert the character's VOICE reference clip (the seed-audio voice sample — NOT the
   scene's exact dialogue line) to a black-screen MP4:
   ```bash
   ffmpeg -y -i voice.mp3 -f lavfi -i "color=c=black:s=1280x720:r=24" \
     -map 1:v:0 -map 0:a:0 -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k voice.mp4
   ```
2. media_upload it as `video/mp4` → media_confirm type **video**.
3. generate_video model seedance_2_0, `generate_audio: true`, with:
   - character + location **image_references**
   - the black-MP4 as **video_references**
   - prompt = the visual description, the **dialogue line**, and this exact convention:
     > "Reference audio 1: attached female voice audio - use as the exact voice, tone
     > and dialogue for the [female character / character on the right]. In that exact
     > voice, [Char] says: \"<line>\". Lip-sync precisely. Ignore the black video
     > frames; use only its audio. Output ONLY her spoken dialogue — NO MUSIC, NO
     > SOUND EFFECTS, NO ambient/background sound."
   - ⚠️ ALWAYS include **"NO MUSIC, NO SOUND EFFECTS, NO ambience — dialogue/voice
     only"** in any `generate_audio:true` call. Otherwise Seedance adds its own
     music/SFX bed, which fights the separately-generated VFX (effects) stem and the
     scene-level background bed. We want the model to produce the clean voice ONLY;
     all effects and ambience are layered later from their own stems.
4. Poll; the returned mp4 already has the synced audio. No mux needed.
5. Save as a timestamped video take. (Optionally trim trailing silence to match pace.)

> The voice MP4 is reusable per character (one per Sara/Helena). The dialogue comes
> from the PROMPT; the MP4 supplies the voice identity.
>
> Note: this gives the character's **voice** (model-spoken), which may not be the
> byte-identical seed-audio take. If you need the EXACT seed-audio take in the file,
> use the fallback below instead.

### Fallback Run D — lipsync to SPEECH only (then mux, exact take)
`generate_video` model `seedance_2_0`, `generate_audio:false`, character + location
image refs, and **the SPEECH stem as the only `audio_references`**. Duration =
`max(4, round(speech_len))` (Seedance floor is 4s). Decline the preset notice and
generate literally. The returned video is **silent** (it used the audio only to
drive mouth timing).

### Run E — Post (two video versions, ffmpeg)
Let `L` = speech stem length. Trim video to `L` and produce both:
```bash
# v1 — clean lipsync (speech only)
ffmpeg -y -i seedance_silent.mp4 -i speech.wav -map 0:v:0 -map 1:a:0 -t L \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k shotNN_lipsync_take.mp4
# v2 — with VFX (combined mix on top)
ffmpeg -y -i seedance_silent.mp4 -i mix.wav   -map 0:v:0 -map 1:a:0 -t L \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k shotNN_withvfx_take.mp4
```

---

## Versioning (always keep previous takes)

- Never overwrite a prior take. Compute `<ts>` from the shell (`date +%Y%m%d-%H%M%S`)
  — note Seed Audio / Seedance jobs are async; stamp at save time.
- Determine the next `takeNN` by scanning `takes/` for the highest existing number
  per kind (`speech`/`vfx`/`mix`/`lipsync`/`withvfx`) and add 1.
- Optionally also refresh flat "latest" copies (`shotNN_audio.*`, `shotNN_FINAL.mp4`)
  pointing at the newest take for simple players/back-compat.

## Length & sync rules

- Shot length follows the **SPEECH stem** length (that's what carries dialogue/lipsync).
- Generate the VFX stem at ~the same target length; ffmpeg `amix duration=first`
  clamps it to the speech length anyway.
- Seedance duration is integer 4–15s; render at `max(4, round(L))` then trim to `L`.

## Gotchas (carried from seed-audio / seedance)

- **One `audio_references` per MCP call.** 2+ fails instantly. (This is why the
  join can't be a Seed Audio two-input pass today — use ffmpeg.)
- **Pass an uploaded FILE as the reference, never a prior job_id** (job_id hangs).
- **`rawUrl` extension can lie** — `file` the download, rename to the real container.
- **Seedance `generate_audio:false` ⇒ silent video** — you must mux audio in post
  (that's the design here: it lets us make both v1 and v2).
- **Seedance preset notice:** if `generate_video` returns a `preset_recommendation`,
  resend with `declined_preset_id:"<id>"` to generate the prompt literally.
- TA2A (reference-guided) audio and Seedance video are **slow** (minutes) — poll
  `job_status` with `sync:true`.

## Quick checklist
1. Upload character voice ref + character/location image refs (once).
2. A: speech stem (voice-locked).  B: vfx stem (T2A, no voices).
3. C: mix = ffmpeg amix(speech, vfx@~0.5).
4. D: seedance video, audio_references = SPEECH only, generate_audio false.
5. E: v1 = video+speech;  v2 = video+mix.  Save both as timestamped takes.
