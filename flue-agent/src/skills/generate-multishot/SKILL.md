---
name: generate-multishot
description: >-
  Generate ONE multi-shot Seedance 2.0 video (several shots in one <15s clip) —
  on Higgsfield (MCP) OR Atlas Cloud (atlas_generate_video reference-to-video),
  whichever is the active provider — driven by a DIALOG-ONLY audio stem (Flow A)
  or per-character VOICE references (Flow B), plus character sheets and a
  location image. Use when the user wants a "multishot" / "multi-shot" Seedance
  generation, asks to generate/render an Episode bundle or shot by id ("generate
  MS-01"), to combine shots 1–N into one clip, or to render a scene beat from
  character + location refs. Only the clean -dialog stem, never the -vfx stem,
  feeds the video. fal CANNOT run this (its Seedance takes one start image and no
  audio stem). Model/resolution come from the project Video defaults
  (get_visual_world); on Higgsfield audio references force mode "std", so a Fast
  default falls back to seedance_2_0. Credits burn on submit, so show the params
  FIRST as a render_ui KeyValue + Actions card, never alone.
---

# generate-multishot (Seedance 2.0 — Higgsfield or Atlas Cloud)

Render a single **multi-shot** clip: several scripted shots (wide → MS → CU …) described as beats inside ONE Seedance 2.0 generation, under the 15s cap, lip-synced to a **dialogue-only** audio stem (Flow A) or to per-character voice refs (Flow B).

> 🔀 **Pick the backend from the active render provider** (the "Render provider"
> note in your instructions). **Higgsfield** → the `mcp__higgsfield__*` flow
> written out below (`seedance_2_0`, `medias[]` roles, black-MP4 voice trick).
> **Atlas Cloud** → the much simpler **"Atlas Cloud path"** section near the end:
> `atlas_generate_video` reference-to-video takes the character/location stills
> and the `-dialog` stem as plain URLs (`reference_image_urls` /
> `reference_audio_urls`) — **no `media_upload`/`media_confirm`, no black-MP4
> conversion**. Everything conceptual here (the `-dialog`/`-vfx` check net, the
> confirm card, "≤15s", `generate_audio` on) applies to BOTH; only the tool call
> and the reference plumbing differ.

> **Always use the Higgsfield MCP, never the `higgsfield` CLI.** Multiple reference images require the role `image_references`, which the CLI cannot send (its `--image` collapses to the single `start_image`). The MCP `generate_video` `medias[]` array is the only way to pass character + location references together.

## Step 0 — read the project's video defaults

Call **`get_visual_world`** and take the render params from `settings.videoModel` +
`settings.videoResolution`, resolved through the `videoModels` catalog in the same
response. Send that entry's `model` and `mode` (omit `mode` when it is null) — never
the catalog `id`. These are the defaults the author set on the Settings page; use
them unless the user names something else in chat.

> ⚠️ **One override, always.** This skill ALWAYS attaches audio references (a
> `-dialog` stem as `audio_references` in Flow A, or black-MP4 voice refs as
> `video_references` in Flow B), and `mode: "fast"` fails any job that carries
> them. So if the project default is **Seedance 2.0 Fast** (`audioRefs: false`),
> render with `model: "seedance_2_0"`, `mode: "std"` instead and **tell the user
> you did**, in one line. Mini and standard 2.0 both take audio refs — leave
> those alone. If the resolved resolution isn't in the chosen model's
> `resolutions`, use `720p`.

## Inputs

| Input | Role in the job | Notes |
|---|---|---|
| **Dialogue stem** (`*-dialog.*`) | `audio_references` (the ONE audio Seedance lip-syncs to) | Flow A — only when a rendered dialogue stem exists (see the check net below). |
| **Voice-identity refs** (`VOICE / SOUND REFERENCES` block) | black-screen MP4 → `video_references` (one per character) | Flow B — what the Episode tab hands you instead of a stem: each is a character's VOICE clip, not a rendered line. |
| **Character voice refs** | (upstream) used to voice-lock the dialogue stem in the Seed Audio pass; also named in the prompt for identity | one clean clip per character |
| **Character sheets** | `image_references` (one per character) | locks each character's look |
| **Location image** | `image_references` | locks the setting |

Seedance accepts **one** `audio_references` and **many** `image_references`. In Flow A the dialogue stem is the audio; in Flow B the voices ride as `video_references` and the dialogue comes from the `SHOT` lines in the prompt.

## ⭐ Always `generate_audio: true`

Every `generate_video` call here passes **`generate_audio: true`** so the rendered mp4 has an embedded audio track (lip-synced to `audio_references`). `generate_audio:false` returns a **silent** video. Only use `false` if the user explicitly wants to mux an exact take themselves. (Standing preference — see the project memory.)

## 🕸 The check net: `-dialog` vs `-vfx` (DO NOT skip)

Seed Audio runs produce TWO stems per scene (see the `video-from-audio-vfx` and `seed-audio` skills), and they MUST be named with a tag in the filename:

- **`<base>-dialog.<ext>`** — speech ONLY, no SFX/ambience/music. ← this is the `audio_references`.
- **`<base>-vfx.<ext>`** — SFX / foley / ambience / music ONLY, no voices. ← layered onto the video LATER, **never** sent to this generation.

Before submitting, run the check net:

1. **Select by name.** The `audio_references` candidate MUST match `*-dialog.*` (case-insensitive). 
2. **Hard-reject the wrong stem.** If a chosen file matches `*-vfx.*`, STOP — that's the effects stem; never feed it to the video.
3. **Refuse the ambiguous.** If the audio is a flat mix or untagged (no `-dialog`/`-vfx`), do NOT assume it is clean. Warn the user that it may contain SFX, and either (a) point them to / generate a proper `-dialog` stem, or (b) ask for explicit confirmation to proceed with the mixed track.
4. **State what was used.** Always tell the user the exact dialogue file fed as `audio_references`.

```bash
# quick guard — resolve the dialogue stem, reject the vfx stem
case "$AUDIO" in
  *-vfx.*)    echo "REFUSE: '$AUDIO' is the VFX stem, not dialogue"; exit 1 ;;
  *-dialog.*) echo "OK: dialogue stem -> $AUDIO" ;;
  *)          echo "WARN: '$AUDIO' is not tagged -dialog/-vfx; may contain SFX. Confirm before use." ;;
esac
```

## Two audio paths — which one is in play

The Episode tab and render turns hand you ONE of two audio inputs. Decide which
BEFORE Step 2 — they ship in different shapes and different media roles:

- **Flow A — a rendered `-dialog` stem.** The turn names a `*-dialog.*` file
  (e.g. `ms-01-dialog.mp3`). That stem IS the dialogue; pass it as the single
  `audio_references` and lipsync to it (the check net above applies).
- **Flow B — voice-identity clips (the `VOICE / SOUND REFERENCES` block).** The
  composed prompt carries a `VOICE / SOUND REFERENCES (pass as the audio
  reference — voice identity, NOT dialogue)` block listing per-character voice
  clips (e.g. `Noah Chen — voice: https://…/sound-media/trk_6_v1.wav`). Each is
  the character's VOICE identity, NOT a rendered line — the dialogue the clip
  must be SPOKEN in lives in the `SHOT` blocks below. The Episode flow uses this.

### Flow B — the black-screen-MP4 voice path (⭐ the Episode flow's path)

Seedance embeds lip-synced dialogue audio itself, in the character's voice, when
you feed the voice clip as a **black-screen MP4** through `video_references`
with `generate_audio: true`. (Verified — see `video-from-audio-vfx` Run D.)

Why this exact shape:
- A raw audio file in `audio_references` makes Seedance **silent** unless
  `generate_audio: true`, and even then it invents a **NEW voice** — not the
  character's. Never pass the `.wav`/`.mp3` directly.
- A video file in the `audio_references` role is **rejected** (`404 Audio input
  not found`) — the black-MP4 must go as `video_references`.

Per voice ref in the block:

1. Convert the voice clip to a black-screen MP4:
   ```bash
   ffmpeg -y -i voice.wav -f lavfi -i "color=c=black:s=1280x720:r=24" \
     -map 1:v:0 -map 0:a:0 -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k voice.mp4
   ```
2. `media_upload` it as `video/mp4` → `media_confirm` type **video** → pass it as
   **`video_references`** (never `audio_references`).
3. Keep `generate_audio: true`.
4. The block maps voices to characters and order — `— voices appear in this
   order: 1=Noah Chen, 2=Mrs. Kim` — so number each ref in that order and state
   it in the prompt. For each, add exactly this convention:
   > "Reference audio 1: attached Noah Chen voice — use as the exact voice, tone
   > and dialogue for Noah Chen. Ignore the black video frames; use only its
   > audio. In that exact voice, Noah Chen says: \"<line>\". Lip-sync precisely."
5. ALWAYS end the prompt with **"Output ONLY spoken dialogue — NO MUSIC, NO
   SOUND EFFECTS, NO ambient/background sound"** (without it, Seedance adds its
   own music/SFX bed that fights the separately-generated VFX stem).
6. The dialogue WORDS come from the `SHOT` blocks — the MP4 supplies the voice
   identity only.

Multiple voices = one `video_references` entry per character, numbered in the
block's order. Verify a 2nd `video_references` is accepted (`models_explore`
`model_id: seedance_2_0`) before promising a two-voice bundle; if it's rejected,
tell the author and offer to split the dialogue by character.

## The MCP tools are already available

The Higgsfield MCP tools (`mcp__higgsfield__generate_video`,
`mcp__higgsfield__job_status`, `mcp__higgsfield__media_upload`,
`mcp__higgsfield__media_confirm`, `mcp__higgsfield__media_import_url`,
`mcp__higgsfield__models_explore`, `mcp__higgsfield__balance`) are registered on
the agent — call them directly, no loading step needed.

## Step 1 — Gather & validate inputs

- **Dialogue stem (Flow A only)** — run the check net (must be `*-dialog.*`). If
  the turn instead carries a `VOICE / SOUND REFERENCES` block, that IS the audio
  input — use **Flow B** (black-MP4 `video_references`) and do NOT go render a
  seed-audio stem unless the author explicitly asked for the exact-take mux
  fallback (the `video-from-audio-vfx` pipeline).
- **Character sheets** — one reference image per character (locks appearance).
- **Location image** — one reference image for the setting.
- **Character voice refs** — the clips used to voice-lock the dialogue stem
  (Flow A) or the `VOICE / SOUND REFERENCES` block itself (Flow B); keep them
  associated with each character tag and name each character in the prompt.

## Step 2 — Upload every local input to a media_id

`medias[].value` must be a Higgsfield **media_id**, not a path/URL.

1. `media_upload { files:[{ filename, content_type }] }` → presigned `upload_url` + `media_id` (`content_type` e.g. `image/png`, `audio/mpeg`, `audio/wav`).
2. `curl -X PUT -H "Content-Type: <signed type>" --data-binary @file '<upload_url>'` (header MUST match the signed type).
3. `media_confirm { type:"image"|"audio", media_ids:[...] }`.

(Web URL → `media_import_url`; Apps UI local picker → `media_upload_widget`.)

## Step 3 — Write the multishot prompt

One prompt describing the shots as ordered beats, under 15s total. Per shot give: camera, action, and the spoken line (or "no dialogue"). When a composed bundle prompt is handed to you, its `STYLE:` line (or absence of one) reflects the project's Episode style selection — keep it verbatim, never invent your own style clause; with no STYLE line, the reference images alone define the look. Then "Match the attached reference images for the location and the characters …" — and for the audio: Flow A, "Lip-sync all dialogue to the attached audio track, and embed that dialogue as the video's audio"; Flow B, there is no audio track — speak each `SHOT`'s dialogue in the attached `Reference audio N` voice(s) and embed it as the video's audio. Keep total runtime ≤ the dialogue stem length (Flow A) and ≤ 15s.

## Step 3½ — Confirm the submit with a CARD, not a paragraph (`render_ui`)

A Seedance render costs real credits, so the author sees the exact params before
it goes. Draw them with **`render_ui`**: a `KeyValue` of the terms **and an
`Actions` block in the SAME program**. There is no other confirm channel — flue
cannot suspend a turn, so the buttons ARE the gate.

```
root = Card([params, go])
params = KeyValue([{label: "Bundle", value: "MS-01 — Teaser — The Collapse"}, {label: "Model", value: "seedance_2_0 (std)"}, {label: "Resolution", value: "720p"}, {label: "Duration", value: "15s"}, {label: "Voice refs", value: "Noah Chen, Mrs. Kim (black-MP4)"}, {label: "Image refs", value: "Noah Chen sheet, Mrs. Kim sheet, Alley location"}], "Confirm render")
go = Actions([yes, edit])
yes = Action("Confirm — render it", "Go ahead and render MS-01", "primary")
edit = Action("Change something first", "Wait — let me change the render params first")
```

- **Never draw the `KeyValue` on its own.** A params card with no button is a
  dead end: your turn ends at `render_ui`, so "tap Confirm" points at nothing and
  the author has to type the go-ahead themselves. `render_ui` now rejects such a
  program — fix it and call again rather than explaining the miss in chat.
- Write each `send` in the AUTHOR's voice; it is posted verbatim as their next
  message. Load the **generative-ui** skill for the syntax.
- `render_ui` is the LAST action of the turn. STOP after it — the actual
  `generate_video` submit happens on the NEXT turn, once their tap arrives.
- Skip the card only when the author has already said "just render it" /
  "don't ask again" for this take.

## Step 4 — Preflight, then submit (MCP `generate_video`)

Preflight cost (`get_cost:true`) if useful, then:

```jsonc
mcp__higgsfield__generate_video {
  "params": {
    "model": "<from Step 0 — seedance_2_0 whenever audio_references ride along>",
    "mode": "std",                          // required with audio_references
    "prompt": "MULTISHOT_PROMPT",
    "duration": <ceil(dialogue length), 4–15>,
    "resolution": "<from Step 0, default 720p>",
    "generate_audio": true,                 // ⭐ always true
    "medias": [
      { "role": "audio_references", "value": "<DIALOG stem media_id>" },   // the -dialog stem ONLY
      { "role": "image_references", "value": "<location media_id>" },
      { "role": "image_references", "value": "<character_1 sheet media_id>" },
      { "role": "image_references", "value": "<character_2 sheet media_id>" }
    ]
  }
}
```

- If the response is a `preset_recommendation`, resend the same call with `declined_preset_id:"<id>"` to generate the prompt literally.
- **Flow A:** one `audio_references` (the dialogue stem). Every character sheet + the location are their own `image_references` entries (repeatable). Never put a *reference* (a character sheet or location) in `start_image` — references are semantic, not the literal opening frame.
- **Flow B** (the `VOICE / SOUND REFERENCES` block): the voices go as `video_references` — one black-MP4 per character, numbered to the block's order — instead of the `audio_references` entry:

```jsonc
mcp__higgsfield__generate_video {
  "params": {
    "model": "seedance_2_0",
    "mode": "std",
    "prompt": "MULTISHOT_PROMPT + the 'Reference audio N:' conventions + 'Output ONLY spoken dialogue — NO MUSIC, NO SOUND EFFECTS, NO ambient/background sound'",
    "duration": <ceil(sum of dialogue, 4–15)>,
    "resolution": "<from Step 0, default 720p>",
    "generate_audio": true,                 // ⭐ always true
    "medias": [
      { "role": "video_references", "value": "<Noah Chen black-MP4 media_id>" },  // Reference audio 1
      { "role": "video_references", "value": "<Mrs. Kim black-MP4 media_id>" },   // Reference audio 2
      { "role": "image_references", "value": "<location media_id>" },
      { "role": "image_references", "value": "<character sheet media_id>" }
    ]
  }
}
```

### Optional first frame (start_image)

If — and ONLY if — the turn explicitly hands you a **first-frame image** (the exact frame the clip should open on, e.g. an approved storyboard still for the bundle's first shot), pass it as `start_image` **in addition to** the `image_references` above:

```jsonc
"medias": [
  { "role": "start_image", "value": "<first-frame media_id>" },   // ⭐ only when a first frame was provided
  { "role": "audio_references", "value": "<DIALOG stem media_id>" },
  { "role": "image_references", "value": "<location media_id>" },
  { "role": "image_references", "value": "<character sheet media_id>" }
]
```

Upload the provided first-frame URL to a `media_id` (`media_import_url` / `media_upload`) just like any other reference. Without an explicit first frame, omit `start_image` entirely (the default behaviour above).

**Use the `refUrl`, never `thumb` or `display`.** Storyboard stills and library images now come back in three forms: `refUrl` (the absolute, FULL-RESOLUTION original), `display` (~1600px webp) and `thumb` (~400px webp). The tiers exist so the app and the chat can show a picture cheaply — feeding one to `media_import_url` would open your clip on a downscaled frame, and the loss is invisible until the render is done. The same rule covers every `image_references`, `audio_references` and `video_references` entry (including the voice clips in a `VOICE / SOUND REFERENCES` block): always the `refUrl`.

### Optional video style continuity reference (video_references)

If — and ONLY if — the turn hands you a **video style continuity reference** (a previously-rendered clip the new generation should match in style — the prompt will carry a `VIDEO STYLE CONTINUITY REFERENCE` block and/or the turn a `VIDEO STYLE CONTINUITY:` line with its URL), pass it as `video_references` **in addition to** the `image_references` above:

```jsonc
"medias": [
  { "role": "video_references", "value": "<continuity clip media_id>" },   // ⭐ only when a style reference was provided
  { "role": "audio_references", "value": "<DIALOG stem media_id>" },
  { "role": "image_references", "value": "<location media_id>" },
  { "role": "image_references", "value": "<character sheet media_id>" }
]
```

- Import the provided clip URL to a `media_id` with `media_import_url` (it is an ungated `/files/...` URL), then `media_confirm { type:"video", media_ids:[...] }`.
- Keep the continuity sentence in the prompt (it ships inside the composed prompt's `VIDEO STYLE CONTINUITY REFERENCE` block): *"This is a video reference for you to continue — keep its video style, colors, and feeling so our new generation has continuity."* If the turn provides the URL but the prompt lacks the block, append that sentence to the prompt yourself.
- The reference video is **stylistic**, not content: never put it in `start_image`, and don't copy its shot list — the beats come from this bundle's prompt. Without an explicit style reference, omit `video_references` entirely.

## Step 5 — Poll

```jsonc
mcp__higgsfield__job_status { "jobId": "<id>", "sync": true }   // raw_data:true for result_url
```

Repeat until `status:"completed"`; read `result_url`. Video renders ~60–180s.

## Step 6 — Deliver (one folder per experiment, a generations list)

Download the video into the experiment's `gen/` folder and append an entry to its `multishot.json` `generations[]` array, recording: `id` (job id), `label`, `createdAt`, `hasAudio`, `video` (relative path), `resultUrl`, `params` (model/resolution/duration/generate_audio/mode/aspect_ratio/credits), `mediaInputs` (the resolved roles + filenames — make clear the audio was the `-dialog` stem), and the exact `prompt`. Multiple takes accumulate as separate entries (newest first) so the dashboard's slideshow shows each with its prompt + params.

```bash
GEN_DIR="<experiment>/gen"; mkdir -p "$GEN_DIR"
curl -fsSL -o "$GEN_DIR/<slug>_<res>.mp4" "RESULT_URL"
```

## Atlas Cloud path (when Atlas is the active provider)

`atlas_generate_video`'s **reference-to-video** mode is this whole flow in one
call — Seedance 2.0's omni-reference takes the identity stills AND the dialogue
audio as plain public URLs, so there is **no upload/confirm, no black-MP4
trick**. Both Flow A and Flow B collapse to the same shape.

1. **Run the check net first** (the `-dialog`/`-vfx` guard above is
   backend-agnostic) and resolve the clean dialogue stem's URL. Also collect the
   character-sheet and location image URLs — always the `refUrl` (full-res), never
   `thumb`/`display`.
2. **Submit** `atlas_generate_video`:
   ```jsonc
   atlas_generate_video {
     prompt: "MULTISHOT_PROMPT — describe the ordered shots; then: 'image 1 = <location>, image 2 = <char A> …; speak all dialogue in the voice of audio 1 and lip-sync precisely; output ONLY spoken dialogue — no music, no SFX, no ambience.'",
     reference_image_urls: ["<location refUrl>", "<char A sheet refUrl>", "<char B sheet refUrl>"],  // ≤9
     reference_audio_urls: ["<the -dialog stem URL>"],                                                // ≤3; the dialogue stem
     duration: <ceil(dialogue length), 4–15>,
     generate_audio: true,   // embeds the lip-synced voice; default true once reference_audio_urls is set
     resolution: "<project default, e.g. 720p>"
   }
   ```
   - **Flow A** (a rendered `-dialog` stem): put that stem in
     `reference_audio_urls` — Seedance lip-syncs to it and embeds it. This is the
     clean path; you do NOT need the black-MP4 voice trick.
   - **Flow B** (only per-character VOICE identity clips, no rendered line): pass
     the voice clip URL(s) in `reference_audio_urls` too and, as with Higgsfield,
     the spoken WORDS come from the `SHOT` lines in the prompt — refer to each as
     "audio 1/2" and say to speak the shot's dialogue in that voice.
   - An optional first-frame or a style-continuity clip rides in
     `reference_video_urls` (≤3).
3. **Confirm with the same `render_ui` card** (Step 3½) before submitting —
   credits burn identically. Show `Model: Seedance 2.0 (Atlas)`.
4. **Poll** `atlas_job_status { prediction_id }` until `completed`; `outputs[0]`
   is the mp4 (already carrying the embedded lip-synced audio). Deliver it into
   the experiment's `gen/` folder / `multishot.json` exactly as Step 6.

Limits (Atlas Seedance 2.0): `reference_images` ≤9, `reference_videos` ≤3,
`reference_audios` ≤3 (WAV/MP3, ≤30s each). No `mode` param — the full (non-fast)
Seedance 2.0 model already accepts audio refs, so nothing to downgrade.

## Interaction rules

- Run the check net (Flow A) and **state the exact dialogue file** used as `audio_references`; for Flow B, **state which character each `video_references` black-MP4 is** and the `Reference audio N` order you used.
- Confirm the submit with a `render_ui` card (Step 3½) — `KeyValue` **plus** `Actions`, never the params alone — and stop the turn there.
- Never feed a `*-vfx.*` stem (or an unverified flat mix) to the video; never pass a voice clip's raw audio as `audio_references`.
- Be concise; no raw IDs/JSON in chat. Use the MCP, never the CLI.
- See also: `video-from-audio-vfx` (produces the two stems AND the black-MP4 voice trick), `seed-audio` (Seed Audio params + the `-dialog`/`-vfx` naming), `continue-video` (continue-from-last-frame variant).
