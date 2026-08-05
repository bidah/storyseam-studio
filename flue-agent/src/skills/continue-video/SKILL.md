---
name: continue-video
description: Continue a video with Higgsfield Seedance 2.0 via the Higgsfield MCP. Takes a reference video, extracts its LAST frame to use as the start frame, collects per-character sound files (with a confirm selector to match each sound to a character tag), character sheets, and a prompt that supports @ image references which are sent to Higgsfield as subject/reference images. Use when the user wants to extend/continue a clip, generate the "next shot" from where a video left off, or recreate a Seedance video starting from a video's final frame. Model and resolution come from the project's Video defaults (get_visual_world → settings.videoModel / settings.videoResolution), NOT from a hardcoded value; when the render carries audio_references, mode "fast" is rejected, so a Seedance 2.0 Fast default is overridden to seedance_2_0 mode "std" and the override is stated to the user.
---

# Continue Video (Higgsfield Seedance 2.0 — via the Higgsfield MCP)

Generate the next shot of a video by starting from the **last frame** of a reference clip, with per-character voice references, character sheets, and an `@`-reference-aware prompt. Built on the **Higgsfield MCP** (`mcp__higgsfield__*`), model `seedance_2_0`.

> **Always use the Higgsfield MCP, never the `higgsfield` CLI.** The CLI cannot pass multiple reference images to Seedance — its `--image` flag maps to the single `start_image` slot, so 2+ references fail with `'medias' can contain at most one start_image`. The MCP `generate_video` tool takes a proper `medias[]` array with a `role` per item, which is how Seedance does character/location referencing. (`ffmpeg` for local frame extraction / re-encode is still fine.)

## The MCP tools are already available

The Higgsfield MCP tools (`mcp__higgsfield__generate_video`,
`mcp__higgsfield__job_status`, `mcp__higgsfield__media_upload`,
`mcp__higgsfield__media_confirm`, `mcp__higgsfield__media_import_url`,
`mcp__higgsfield__models_explore`, `mcp__higgsfield__balance`) are registered on
the agent — call them directly, no loading step needed.

## Flags

- `--confirm` — **preview-and-confirm gate.** When present in the skill args, do NOT submit immediately. After building everything (Step 5), show the user the exact `generate_video` call (model + every param + each media role/value) and the media summary, then draw a `render_ui` card pairing a `KeyValue` of the params with an `Actions` go/no-go (**Submit as-is** / **Edit before sending**) and STOP. Apply corrections, re-show, and only submit once they tap. See "Confirmation gate".

## Seedance media roles (the important part)

`seedance_2_0` accepts `medias[]` with these roles (verify anytime with `models_explore action:"get" model_id:"seedance_2_0"`):

| role | use | count |
|---|---|---|
| `start_image` | first-frame anchor (here: the reference clip's last frame) | ≤ 1 |
| `end_image` | last-frame transition target | ≤ 1 |
| `image_references` | **subject/character/location reference images** | **many** |
| `video_references` | a reference video clip (also the black-frame-mp4 voice trick) | — |
| `audio_references` | voice / lipsync / dialogue track | 1 |

Params: `duration` 4–15s (default 5; bump to 10–11 if dialogue gets cut), `resolution` `480p|720p|1080p|4k` (4k/1080p need `mode:"std"`), `aspect_ratio` default `16:9`, `generate_audio` (see Step 2).

## Model + resolution come from the project defaults

Before submitting, call **`get_visual_world`** and take the render params from
`settings.videoModel` + `settings.videoResolution`, resolved through the
`videoModels` catalog in the same response. Send that entry's `model` and `mode`
(omit `mode` when null) — never the catalog `id`. Use them unless the user names
something else in chat; if the resolved resolution isn't in the chosen model's
`resolutions`, use `720p`.

> ⚠️ **`mode: "fast"` rejects `audio_references`.** This skill usually attaches a
> dialogue track, so when the project default is **Seedance 2.0 Fast**
> (`audioRefs: false`) and the job carries audio, render with
> `model: "seedance_2_0"`, `mode: "std"` instead and say so in one line. Only a
> silent render (no `audio_references` at all) may stay on Fast.
> Note **Mini and Fast cap at 720p** — 1080p needs `seedance_2_0` with `mode:"std"`.

## ⭐ ALWAYS set `generate_audio: true`

**Every `generate_video` call in this skill MUST pass `generate_audio: true`.** `generate_audio:false` returns a **silent** video (the audio reference is used only to time the mouths), which is almost never what we want — it forces a post mux step and leaves the delivered clip mute. Default to `true` so the rendered mp4 has an embedded audio track. Only deviate if the user explicitly asks for a silent render to mux an exact take themselves.

## Hard-won gotchas (do not relearn these)

1. **Multiple reference images → role `image_references` (repeatable).** Character sheets, location plates, and every resolved `@` reference are `image_references`. Only the last-frame anchor is `start_image`. Never put references in `start_image`.
2. **Voice / lipsync via `audio_references` (an audio file: mp3/wav) + `generate_audio: true`.** Pass the dialogue/voice track as `audio_references` AND set `generate_audio: true` so the model lip-syncs to it **and embeds an audio track** in the output. Do NOT put a video file in `audio_references` (rejected: `404 Audio input not found`). To steer what the baked-in audio contains, say so in the prompt (e.g. "output ONLY the spoken dialogue — NO music, NO SFX" for a clean voice-only track).
   - **Voiced-output via a voice clip:** to make Seedance *speak* a line in a reference voice, encode the voice clip as a black-frame mp4, pass it as `video_references`, keep `generate_audio: true`, and in the prompt say "use the attached voice; ignore the black frames; output ONLY the spoken line — NO music, NO SFX." (See the `video-from-audio-vfx` skill.)
3. **Pass an uploaded FILE id (media_id), never a prior job_id, as a reference** — a job_id reference can hang.
4. **Preset notice:** if `generate_video` returns a `preset_recommendation`, resend the same call with `declined_preset_id:"<id>"` to generate the prompt literally.
5. **`.mov` not accepted** — re-encode to `.mp4` (`libx264`+`aac`) for a reference video; for a voice track export `.mp3`/`.wav`.
6. **Last-frame extraction:** `ffmpeg -sseof -1 -i IN -update 1 -q:v 2 OUT.jpg` (seeks to last 1s, writes final frame).
7. **`/tmp` is volatile** — write extracted frames / converted audio into the working folder (or a non-`assets` subfolder the user names), not `/tmp`.

## Uploading a local file to a media_id (do this for every local input)

`start_image`, `image_references`, `audio_references`, `video_references` values must be Higgsfield **media_ids**, not paths or URLs.

- **Local file:**
  1. `media_upload { files:[{ filename, content_type }] }` → presigned `upload_url` + `media_id` per file (`content_type` e.g. `image/png`, `image/jpeg`, `audio/mpeg`, `audio/wav`, `video/mp4`).
  2. `curl -X PUT -H "Content-Type: <signed type>" --data-binary @file '<upload_url>'` (header MUST match the signed type or the PUT fails).
  3. `media_confirm { type:"image"|"audio"|"video", media_ids:[...] }`.
- **Web URL:** `media_import_url` → use the returned `media_id` (never pass an `https://` URL into `medias[].value`).
- **Apps UI / local picker available:** prefer `media_upload_widget` so the user attaches the file directly.

## Step 0 — MCP ready

Confirm the Higgsfield MCP tools are loaded (above) and optionally check `balance`. No CLI auth step.

## Step 1 — Reference video → last frame

Ask for the **reference video** path (the clip to continue). Extract its last frame into the working folder, then upload it:

```bash
ffmpeg -y -sseof -1 -i "REF_VIDEO" -update 1 -q:v 2 "<basename>_last_frame.jpg"
```

Upload (see above) → media_id. This becomes the `start_image`.

## Step 2 — Character sound files (with confirm selector)

Ask the user for one sound file per character (voice reference). For **each**:

1. Export to a clean audio file (no video wrapper needed for `audio_references`):
   ```bash
   ffmpeg -y -i "SOUND_SRC" -c:a libmp3lame -q:a 2 "<char>_sound.mp3"
   ```
   (For a multi-speaker shot, build ONE combined, properly-timed `dialogue.mp3` — that single track is the `audio_references`.)
2. **Confirm the sound↔character match with a card** — ONE `render_ui`
   `OptionList` with `select: "one-per-group"`, a group per sound file and the
   character tags gathered so far as its options (plus a "name a new one" way
   out). One card, not one per file: the first tap ends the turn, so a card per
   sound strands every sound after the first. Record `tag → sound.mp3`.
3. Upload the chosen track → media_id for `audio_references`.

| Character tag | Sound file |
|---|---|
| captain | captain_sound.mp3 |

> Seedance takes a single `audio_references` per job. Multiple speakers → one combined dialogue track. Use the other tags only in the prompt for identity. Don't silently drop sounds — tell the user which track became the voice/lipsync source.

## Step 3 — Character sheets

Ask for **character sheet** image(s) that lock each character's appearance. Upload each → media_id, and add each as an `image_references` entry. Keep them tied to their character tag so the prompt can name them.

## Step 4 — Prompt with `@` image references

Ask for the **prompt**. The user may embed `@/path/to/image.png` (or `@filename`) tokens to attach **subject reference images** inline. For every `@token`:

- Strip the `@`, resolve to an absolute path (search the working folder / Downloads; ask if unresolved — don't guess). Upload it → media_id, add as an `image_references` entry.
- **Rewrite the sentence yourself — never blind find/replace.** `The captain @captain.png leans in` → "The captain (reference image attached) leans in". Never leave raw `@paths` in the submitted prompt.

So character sheets (Step 3) + `@` references (Step 4) all become `image_references` entries.

**Dedupe before submitting.** A character sheet and an `@` reference can be the same file — resolve to absolute paths, upload once, and emit one `image_references` entry per unique media_id.

## Confirmation gate (when `--confirm` is set)

Between building the call (end of Step 4) and submitting (Step 5):

1. **Show the exact `generate_video` call** — model, prompt (resolved), all params, and each `medias[]` entry as `role → file (media_id)`, plus a one-line media summary (start frame, voice track, image refs, resolution, duration).
2. **Ask for the go-ahead with `render_ui`** — a `KeyValue` of the params **and
   an `Actions` block in the SAME program**. The buttons ARE the gate: flue
   cannot suspend a turn, so a params card with nothing to tap strands the
   author, and `render_ui` rejects it.

   ```
   root = Card([params, go])
   params = KeyValue([{label: "Model", value: "seedance_2_0 (std)"}, {label: "Start frame", value: "last frame of shot 12"}, {label: "Voice track", value: "captain_sound.mp3"}, {label: "Resolution", value: "720p"}, {label: "Duration", value: "10s"}], "Confirm render")
   go = Actions([yes, edit])
   yes = Action("Confirm — send it", "Submit it as-is", "primary")
   edit = Action("Edit before sending", "Wait — let me change the params first")
   ```

3. **STOP after the card** — it is the final action of the turn. Their tap
   arrives as the next user message; submit (or apply corrections, re-show, and
   loop) from there.

Without `--confirm`, submit directly. Load the **generative-ui** skill for the
openui-lang syntax before writing the program.

## Step 5 — Submit (MCP `generate_video`)

Preflight cost if useful (`get_cost:true`), then submit:

```jsonc
mcp__higgsfield__generate_video {
  "params": {
    "model": "<from the project defaults — seedance_2_0 whenever audio rides along>",
    "mode": "std",                      // required with audio_references; omit for Mini
    "prompt": "RESOLVED_PROMPT",
    "duration": 5,
    "resolution": "<from the project defaults, e.g. 720p>",
    "generate_audio": true,             // ⭐ ALWAYS true — embed audio; lip-syncs to audio_references
    "medias": [
      { "role": "start_image",      "value": "<last_frame media_id>" },
      { "role": "audio_references", "value": "<dialogue media_id>" },
      { "role": "image_references", "value": "<char_sheet_1 media_id>" },
      { "role": "image_references", "value": "<subject_ref media_id>" }
    ]
  }
}
```

- One `start_image` (the last frame). Every character sheet / `@` reference is its own `image_references` entry (repeatable).
- If the response is a `preset_recommendation`, resend with `declined_preset_id:"<id>"`.
- The call returns a job id with `status:"pending"`.

## Step 5b — Poll

```jsonc
mcp__higgsfield__job_status { "jobId": "<id>", "sync": true }
```

Repeat until `status:"completed"`; read `result_url` (use `raw_data:true` for the raw payload). Video renders typically 60–180s.

## Step 6 — Deliver (one folder per generation)

**Every generation gets its own folder** in the working directory with the downloaded video + a `prompt.txt`.

```bash
GEN_DIR="gen_$(date +%Y%m%d_%H%M%S)_<slug>"
mkdir -p "$GEN_DIR"
curl -fsSL -o "$GEN_DIR/video.mp4" "RESULT_URL"
cat > "$GEN_DIR/prompt.txt" <<'EOF'
Model: <the model actually sent>
Mode: <std|fast, or omitted>
Submitted via: Higgsfield MCP generate_video
Job ID: <id>
Resolution: <the resolution actually sent>
Duration: <n>
Result URL: RESULT_URL

--- PROMPT (exact text sent) ---
<the full resolved prompt>

--- MEDIA INPUTS (medias[] roles) ---
start_image:      <last-frame file>  (media_id, from <reference video>)
audio_references: <dialogue/voice .mp3>  (media_id)  [voice: <tag(s)>]
image_references: <char sheets + resolved @ references, deduped, with media_ids>
EOF
```

Fill in real values (no placeholders). Print the result URL + a one-line summary (model, resolution, duration, voice) and the folder path.

## Interaction rules

- Be concise. No raw IDs or JSON in chat. One question per phase — don't batch-ask video + sounds + sheets + prompt at once.
- Always ask with a `render_ui` card, never prose: one `one-per-group` `OptionList` for the sound↔character match (Step 2), `KeyValue` + `Actions` for the submit gate. A card that asks for something always carries something to tap.
- Save persistent artifacts (frames, converted audio, downloads) to the working folder, never `/tmp`, and never an `assets` folder unless asked.
- Confirm which track was used as the voice/lipsync source when multiple characters exist.
- Every generation lands in its own `gen_<timestamp>_<slug>/` folder with `video.mp4` + `prompt.txt` (Step 6).
