---
name: seed-audio
description: >-
  Generate cinematic text-to-audio (SFX, ambience, multi-voice dialogue, full
  sound-design scenes) with ByteDance Seed Audio 1.0 via the Higgsfield MCP.
  Use when the user wants to "make a sound effect", "generate ambience", "create
  a sound-design scene", "render an audio scene with dialogue and SFX", a
  "soundscape", "foley", multi-character dialogue, or any mixed audio that TTS
  alone cannot produce — including voice-consistent scenes via an uploaded voice
  reference. Unlike text-to-speech, Seed Audio renders engines, crashes, rain,
  gunshots, rooms, music beds, and spoken lines together in one mixed clip. NOT
  for plain narration of long text (use a text2speech_v2_* model for that).
  Higgsfield-ONLY for scenes: neither fal nor Atlas Cloud has a Seed Audio
  equivalent even as the active provider — fal's fal_generate_audio makes single
  ElevenLabs SFX, so use it only when the user explicitly asks for fal. Attached
  audio is handed back PLAYABLE — a render_ui AudioList card, never a bare link.
---

# Seed Audio 1.0 (Higgsfield)

**Model ID:** `seed_audio` · **Provider:** ByteDance · **Output:** audio
**Accessed via:** Higgsfield MCP → `mcp__higgsfield__generate_audio`

> 🏷 **Stem naming (check net):** when a scene is split into a speech pass and an
> effects pass, save the outputs as `<base>-dialog.<ext>` (voices only, no
> SFX/ambience) and `<base>-vfx.<ext>` (SFX/ambience/music only, no voices). The
> `generate-multishot` skill feeds ONLY the `-dialog` stem to Seedance as
> `audio_references` and never the `-vfx` stem, so the tag prevents passing an
> SFX-laden track to a lip-synced video. A single combined/mixed clip should NOT
> be tagged `-dialog` (it isn't dialogue-only).

`seed_audio` is ByteDance's **text-to-audio** model. From one text prompt it
renders a complete audio scene — multi-character dialogue, sound effects, room
tone, ambience, and background music — together in a single mixed clip. It can
also take **reference voice clips** so a character keeps the same voice across
generations. This is fundamentally different from the `text2speech_v2_*` models,
which only read text aloud and cannot produce SFX, music, or environmental audio.

## When to use this skill

Use it when the request is for **audio that is more than plain speech**:
- Sound effects / foley (door slam, sword unsheathing, footsteps on gravel)
- Ambience / soundscapes (rainforest, busy café, spaceship bridge hum)
- Multi-character dialogue scenes mixing SFX + ambience + voices
- Cinematic beats, trailer hits, game stingers, podcast/voiceover with sound design
- Voice-consistent scenes (reuse a character's voice via an uploaded reference)

Do **not** use it for plain narration / audiobook / voiceover of long text —
route those to a `text2speech_v2_*` model (e.g. `text2speech_v2_seed_speech`
for narration, `text2speech_v2_elevenlabs` for general VO).

## Modes

- **T2A** (text → audio): full scene from text alone. The default.
- **TA2A** (text + audio → audio): pass one or more reference voice clips so
  named characters keep their voice/timbre. See "Voice references" below.
- **TTS-style**: dialogue with little/no sound bed (just describe clean voices,
  "no music, no sound effects").

> **Languages:** English and Chinese only (as of mid-2026). Don't expect other
> languages to render reliably.

---

## Workflow

### 1. The MCP tools are already available

The Higgsfield MCP tools (`mcp__higgsfield__generate_audio`,
`mcp__higgsfield__job_status`, `mcp__higgsfield__balance`,
`mcp__higgsfield__media_upload`, `mcp__higgsfield__media_confirm`) are registered
on the agent — call them directly, no loading step needed.

### 2. Validate the prompt length BEFORE submitting (MANDATORY)

**Hard cap: the `prompt` MUST be ≤ 2,048 characters.** This is a strict upper
bound — never submit a prompt over 2048 chars. Overlong prompts are rejected or
silently truncated, wasting credits. Run this validator on EVERY prompt (it
exits non-zero and refuses when the limit is exceeded):

```bash
# Prompt-length validator — hard fails at 2048 chars.
validate_seed_audio_prompt() {
  local prompt="$1" max=2048
  local n; n=$(printf '%s' "$prompt" | wc -m | tr -d ' ')
  if [ "$n" -gt "$max" ]; then
    echo "❌ INVALID: prompt is $n chars (max $max). Trim by $((n-max)) or split into segments. DO NOT submit." >&2
    return 1
  fi
  echo "✅ OK: $n / $max chars"
}
validate_seed_audio_prompt "$PROMPT" || exit 1
```

| Characters | Action |
|------------|--------|
| ≤ 1800 | ✅ Submit as-is. |
| 1801–2048 | ⚠️ Valid but near the cap — trim if you can; leave headroom. |
| > 2048 | ⛔ **INVALID — do not submit.** Trim, or split into segments and generate sequentially (see "Long scenes" below). |

> The same 2048 cap applies to editing prompts (inpaint/extend/edit) — the
> appended target dialogue counts toward it. Validate those too.

### 3. Submit the generation

Call `mcp__higgsfield__generate_audio` with `model: "seed_audio"`.
`prompt` is the only required field.

```jsonc
{
  "params": {
    "model": "seed_audio",
    "prompt": "<the audio scene description>",
    "format": "wav",        // wav is the API default + true lossless; mp3 also fine
    "sample_rate": 48000,    // optional; 24000 is the API default
    "loudness_rate": 0,      // optional
    "speech_rate": 0,        // optional
    "pitch_rate": 0          // optional
  }
}
```

To preflight credits without spending, add `"get_cost": true` (flaky — if it
errors, just submit the real job).

### 4. Poll for the result

```
mcp__higgsfield__job_status  { "jobId": "<id>", "sync": true }
```

`sync: true` waits up to ~25s server-side and returns on a terminal state.
Plain T2A finishes in seconds–a minute. **Reference-guided (TA2A) jobs take
longer** but do complete (see gotchas). Poll again if still `in_progress`.

### 5. Download to disk + verify container

```bash
curl -sS -o "<name>.dl" "<rawUrl>"
file "<name>.dl"     # WAV→"RIFF...WAVE"; MP3→"MPEG ADTS, layer III"
mv "<name>.dl" "<name>.<real-ext>"
```

The `rawUrl` extension can be `.wav` regardless of requested `format`; trust
`file`, not the URL. To deliver both lossless + portable, request `format: wav`
and transcode: `ffmpeg -y -i in.wav -c:a libmp3lame -b:a 192k out.mp3`.

### Flow at a glance

```text
1. (optional) balance        -> confirm credits
2. wc -m on the prompt       -> gate on 2048-char limit
3. generate_audio            -> { model:"seed_audio", prompt, ...params }  → job id
4. job_status (sync:true)    -> poll until status:"completed"
5. curl rawUrl + file        -> save, verify container, rename
6. attach_sound              -> version flips ready, returns /sound-media url
7. render_ui AudioList       -> hand the audio back PLAYABLE in the chat (root
                                agent only — a subagent returns the url instead)
```

> 🔊 **The author hears the result in chat.** Once the render is attached
> (`attach_sound` → `/sound-media/...` url), the ROOT agent's closing move is a
> `render_ui` **AudioList** card with that url — see the `generative-ui` skill.
> Never deliver finished audio as a bare markdown link; the card is the player.

---

## Voice references (TA2A) — keep a character's voice consistent

This is the reliable way to keep Sara/Helena/etc. sounding the same across
multiple generations. **Verified working** with both WAV and MP3 references.

### Reference clip requirements (from the model docs)

- **≤ 30 seconds** each, consistent emotion/timbre.
- **Single speaker per clip** for voice cloning, clean steady level.
- **No music, no background voices, minimal ambience** (for voice-clone refs).
- Natural pacing (~70–85 words is plenty).

> ✅ **UP TO 3 `audio_references` per generation (re-verified 2026-06-30).**
> The live `seedance_2_0` model spec enforces `size(audio_references) <= 3`, and a
> live test with **2 separate single-voice clips succeeded** — so you CAN pass one
> clean clip per character (one per speaker, max 3). The earlier "only one works"
> note was wrong about the cause: the real trap is **`mode: fast`**
> (`seedance_2_0_fast`), which fails any job carrying `audio_references` (1 or 2+).
> **Use `mode: std` whenever audio refs are attached.** Two more backend rules:
> audio refs require at least one visual ref (image/video/start/end image) in the
> same job, and total refs (images+videos+audios+start/end) must be ≤ 12.
> Combined single-clip multi-voice still works, but per-character clips are now preferred.

### How to attach a reference via the Higgsfield MCP

1. Have the reference file locally (record it, or generate a clean clip with
   `seed_audio` itself). When the clip is a **character casting sample** for this
   project, use the radio skill's canonical fixed dialogue (see `radio` →
   "Casting a voice"), never ad-hoc or script-sourced text — its deliberate
   calm → excited → questioning arc is the one sanctioned exception to the
   "consistent emotion" guideline above, giving the clone delivery coverage
   while staying one clean voice.
2. `media_upload` with `files:[{filename, content_type}]` → returns presigned
   `upload_url` + `media_id` per file. `content_type`: `audio/wav` or `audio/mpeg`.
3. `curl -X PUT -H "Content-Type: <signed type>" --data-binary @file '<upload_url>'`
   (the Content-Type header MUST match the signed type, or the PUT fails).
4. `media_confirm { type:"audio", media_ids:[...] }`.
5. Pass the confirmed id(s) into `generate_audio`:
   ```jsonc
   "medias": [{ "value": "<media_id>", "role": "audio_references" }]
   ```
6. In the prompt, tell it to **match the reference voice(s)**. The underlying
   model also supports `@Audio1`, `@Audio2`, `@Audio3` notation to bind a named
   speaker to a specific clip, e.g.
   `Sara (bright, playful, voiced by @Audio1) says: "..."` — useful when you
   pass multiple single-speaker references and need to map each to a character.

> A confirmed reference shows up in the job payload as
> `medias[].data.type:"audio_input"` — that's the good path.

---

## Audio editing (inpaint / extend / edit / stitch) — prompt-driven

Seed Audio can **repair and reshape existing audio**, not just synthesize new.
There is NO special mode flag or mask param — editing is invoked **entirely
through the prompt**: upload the clip(s) as `audio_references`, refer to them in
the prompt as `@Audio1` (and `@Audio2`), and describe the operation. Same
upload→confirm→`audio_references` path as voice references. These are TA2A jobs
(slower than plain T2A, but they complete). Output cap ~2 min.

**Golden rule:** the model blends TTS + T2A, so it is *less* successful if it
has to guess the words. **Append the exact target/changed dialogue to the END of
the prompt.**

### 1. Single-audio inpainting (fill a gap / fix cuts) — ONE reference
Use when a recording has a silent hole, an abrupt cut, or a join that "feels
chopped." Reproduces the full clip with the missing/rough part filled, preserving
voice, tone, room sound, and pacing.
```
@Audio1 This recording has a silent pause / abrupt cut where a part is missing.
Reproduce the full recording with the missing part filled in naturally, in the
same voice(s), so it flows continuously. <append the exact words that belong there>
```

### 2. Audio extending (continue a clip) — ONE reference
```
@Audio1 Continue this exact speech seamlessly in the same voice and topic, as if
it never stopped, for about {N} more seconds. The character adds: "<new lines>"
```

### 3. Audio editing (rewrite a line, keep the voice) — ONE reference
```
@Audio1 Keep this exact voice, tone, pacing, and room sound, but change the
spoken line to: "<new line>"
```

### 4. Audio stitching (merge two clips) — TWO references ⚠️
```
generate a 10 second piano medley combining @Audio1 with @Audio2
```
⚠️ Stitching needs **two** references — which the Higgsfield MCP currently
**rejects** (see the one-reference limit above). Until that changes, do
stitching/joins locally with ffmpeg (`acrossfade`) instead, or inpaint a single
pre-concatenated file (mode 1) to smooth the seams.

> **Reference length for editing:** voice-clone refs are ≤30s, but an *editing*
> reference is the recording you're repairing — if it's long (e.g. a 50s scene),
> it may exceed practical limits; if a long edit job fails, fall back to ffmpeg
> crossfades or regenerate the scene in one ≤2-min pass to avoid joins entirely.

---

## Parameters

`prompt` is the only required field. Everything else is optional with a default.
Note: the base ByteDance model infers prosody from your **descriptive language**;
the rate params below are Higgsfield-exposed controls layered on top — use words
*and* params together for best control.

| Parameter | Type | Required | Default | Range / Options | What it does |
|-----------|------|----------|---------|-----------------|--------------|
| `prompt` | string | **yes** | — | 1–2048 chars | The audio scene description. Structure it (see below). |
| `format` | string | no | `wav` | `wav`, `mp3`, `pcm`, `ogg_opus` | Output container/codec. `wav` = lossless. |
| `sample_rate` | number | no | `24000` | `8000`,`16000`,`24000`,`32000`,`44100`,`48000` (Hz) | Output sample rate. Higher = more detail + bigger files. |
| `speech_rate` | number | no | `0` | `-50` … `100` | Speaking speed. `0`=default; +faster, −slower. |
| `loudness_rate` | number | no | `0` | `-50` … `100` | Overall loudness/gain. + louder (push mix/sub-bass), − quieter. |
| `pitch_rate` | number | no | `0` | `-12` … `12` | Pitch shift. − deeper voices, + higher/younger. |
| `speaker` | string \| null | no | `null` | preset speaker id | Optional Seed Audio preset speaker. |
| `medias` | media ref | no | — | role `audio_references` (also `image_references`) | Up to 3 reference voice clips (see above). |
| `get_cost` | boolean | no | `false` | — | Preflight credit cost without submitting. |

> **No `duration` parameter.** State the target length in the prompt
> ("Create a 40-second ..."). **Max output ~2 minutes per pass** — anything up
> to ~120s is a single render, so do NOT pre-split cues under 2 min or reach for
> the extend/stitch flow (that's only for clips that must exceed ~2 min). A ~60s
> music cue = one pass.

### Tuning cheatsheet

- **Deeper, menacing voice** → `pitch_rate: -3` to `-6`
- **Higher / younger / panicked / kid voice** → `pitch_rate: +2` to `+6`
- **Bass-heavy, "louder" cinematic mix** → `loudness_rate: +15` to `+30`
- **Calmer, slower delivery** → `speech_rate: -15` to `-30`
- **Urgent, rapid-fire delivery** → `speech_rate: +20` to `+40`
- **Highest fidelity** → `sample_rate: 48000`, `format: wav`
- **Smallest file / web** → `format: mp3`, `sample_rate: 24000`

> Combine sparingly; nudge one axis at a time. Big simultaneous shifts sound
> unnatural.

### Format / sample-rate quick guide

| `format` | Use it for | | `sample_rate` | Typical use |
|----------|------------|-|---------------|-------------|
| `wav` | editing/mastering (lossless) | | `8000`/`16000` | phone/voice-only, tiny |
| `mp3` | sharing / web / previews | | `24000` | balanced speech default |
| `pcm` | raw stream into a DAW | | `32000`/`44100` | music/SFX fidelity |
| `ogg_opus` | low-bitrate streaming | | `48000` | film/video standard |

---

## Prompt structure

Seed Audio responds best to a **mini audio script**, not a flat sentence.

### Six-part cinematic framework
1. **Genre / environment / mood** — style, location, emotional tone.
2. **Continuous sound bed** — name the ONE main persistent sound.
3. **Speaker + dialogue** — voice attributes + emotion + pace + delivery verb.
4. **Sound effect / transition** — one specific effect for the story moment.
5. **Speaker + dialogue** — continue/escalate.
6. **Closing** — silence, a cue, a music fade, resolution.

> One strong sound bed + a few precise cues beats many scattered effects.

### Speaker / dialogue notation
```
Name (age, timbre, accent, emotion, pace) delivery_verb: "Dialogue."
```
- Delivery verbs guide performance: says, asks, replies, shouts, whispers, sobs, blurts.
- Be explicit about voice traits per character (vague → inconsistent).
- Vary emotion/pace across lines to avoid monotone multi-speaker scenes.

### Tag vocabulary (works well as an execution timeline joined with `->`)
| Tag | Meaning |
|-----|---------|
| `[EVENT]` | A discrete sound (engine roar, gunshot, door slam). |
| `[MOVE]` | Motion / spatial change (car swerves, rain intensifies). |
| `[AMBI]` | Background ambience / room tone. |
| `[TRANS]` | A transition or hit (crash, cut to silence, whoosh). |
| `[DIAL]` | A spoken line, with speaker + delivery in parentheses. |
| `[EAR]` | Listener-perspective cue (muffled, "wakes up inside the wreck", POV). |

### Worked example (≈40s cinematic scene)
```text
Create a 40-second high-octane action climax. A high-speed chase ending in a
violent wreck and a desperate vocal standoff. Cinematic, immersive, bass-heavy.

[AESTHETIC]
- Texture: Hyper-real, ultra-wide dynamic range, heavy sub-bass LFE.
- Environment: Wet asphalt, rain-slicked industrial shipyard, metallic echoes.
- Voice (Commander): Gravelly baritone, weathered by smoke; slow, rhythmic.
- Voice (Rookie): High-pitched tension, frantic, sharp inhalations, cracking.
- Palette: Screeching metal, high-revving V8 engines, distant sirens, rain.

[EXECUTION]
[EVENT] V8 engine roaring at 7000 RPM, gear shifts clanking -> [MOVE] Car
swerves, tires screaming on wet pavement -> [AMBI] Rain lashing the windshield.
[EVENT] Screech of brakes -> [TRANS] Violent metallic crunch, glass shattering
-> [AMBI] Engine dies; high-pitched tinnitus ringing fades in.
[EAR] Listener "wakes up" inside the wreck, muffled rain -> [DIAL] Commander
(gravelly, calm) says: "You were never fast enough, kid. Just stay down."
[EVENT] Handgun hammer cocks -> [DIAL] Rookie (sobbing) blurts: "I'm not... I'm
not letting you take it!" -> [MOVE] Rain intensifies, thunder rumbles.
[DIAL] Commander says: "Then we do this the hard way." -> [TRANS] 1 second of
silence -> [EVENT] Single loud gunshot, reverb tail echoing.
```
Matching params: `format:"wav"`, `sample_rate:48000`, `loudness_rate:20`.

---

## Long scenes (> 2048 chars or > 2 min)

Split the script into story-beat segments, each within the char limit, and
generate sequentially. To keep voices consistent across segments:
1. Generate (or record) a clean **single-speaker reference clip per character**.
2. Upload + confirm each (see "Voice references").
3. Pass the reference(s) as `audio_references` on every segment.
4. Concatenate the segment WAVs locally:
   `ffmpeg -f concat -safe 0 -i list.txt -c copy full.wav` (same codec/rate),
   then transcode an MP3 if needed. Add crossfades if you want seamless joins.

The model can also **extend / inpaint / stitch** existing audio (continue a
clip, fill a gap, swap a line while preserving voice) — when inpainting, state
the new words explicitly at the end of the prompt or it reverts to a weaker
TTS+T2A blend.

---

## Effects vs. backgrounds (for multi-shot editing)

When generating sound design that will be **cut together across multiple shots**,
separate two kinds of non-speech audio — do not mix them in one per-shot pass:

- **Effects (per shot):** discrete, shot-specific events — footsteps, door creak,
  bell, whoosh, slap, sparkle. Generate these per shot, **over silence**, with
  **no continuous background**. Prompt: "discrete sound effects only … no
  background ambience, over silence."
- **Backgrounds (per scene, not per shot):** continuous ambience / room tone /
  birdsong / wind / traffic. Generate **once per scene** and lay that single bed
  under **all** shots in the edit. If you instead bake ambience into each shot,
  the background **timbre/level jumps at every cut** because each generation
  differs. (How the scene-level bed is produced and aligned is handled by the
  editing step / the `video-from-audio-vfx` skill — backgrounds can come later.)

Rule of thumb: **per-shot = speech + effects; per-scene = one background bed.**

## Known quirks (verified)

- **`rawUrl` extension lies.** Asked-for `mp3` can return a `.wav` URL that
  actually holds MP3 data (or vice versa). Always `file` the download and rename.
- **Job `type` reports `image`.** Payload mislabels seed_audio jobs as
  `type:"image"` with a `.png` resource link — ignore it; `results.rawUrl` is audio.
- **References: upload a FILE, don't pass a job_id.** Passing a prior
  generation's job_id as `audio_references` *hangs indefinitely* (shows up as
  `data.type:"text2speech_job"`). Uploading an actual file via
  `media_upload`→`media_confirm` works (`data.type:"audio_input"`); both WAV and
  MP3 references succeed.
- **`media_import_url` has been flaky** — prefer `media_upload`.
- **TA2A is slower than T2A** but completes; if a reference job stalls for many
  minutes, regenerate (descriptions + matching `pitch_rate` still keep voices close).
- **First submit may fail transiently** — a verbatim retry usually succeeds.
- **`get_cost` can error** — just submit the job.
- **Occasional transient `failed` status** on submit; retry once before changing anything.
