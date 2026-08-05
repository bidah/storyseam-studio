---
name: generate-multishot
description: >-
  Generate ONE multi-shot Seedance 2.0 video (several shots in one <15s clip)
  via the Higgsfield MCP, driven by a DIALOG-ONLY audio stem plus character
  sheets and a location image. Use when the user wants a "multishot" /
  "multi-shot" Seedance generation, asks to generate/render an Episode bundle or
  shot by id ("generate MS-01"), to combine shots 1–N into one clip, or to
  render a scene beat from character + location refs. Only the clean -dialog
  stem, never the -vfx stem, feeds the video. Higgsfield-ONLY — never substitute
  fal_generate_video or atlas_generate_video: their Seedance takes one start
  image and no audio stem, so it can't do this lip-synced multi-reference flow,
  even when fal or Atlas is active. Model/resolution come from the project Video
  defaults (get_visual_world); audio_references force mode "std", so a Fast
  default falls back to seedance_2_0. Credits burn on submit, so the params go
  to the author FIRST as a render_ui KeyValue + Actions card — never params
  alone, which leaves nothing to tap.
---

# generate-multishot (Higgsfield Seedance 2.0 — via the Higgsfield MCP)

Render a single **multi-shot** clip: several scripted shots (wide → MS → CU …) described as beats inside ONE `seedance_2_0` generation, under the 15s cap, lip-synced to a **dialogue-only** audio stem. Built on the **Higgsfield MCP** (`mcp__higgsfield__*`).

> **Always use the Higgsfield MCP, never the `higgsfield` CLI.** Multiple reference images require the role `image_references`, which the CLI cannot send (its `--image` collapses to the single `start_image`). The MCP `generate_video` `medias[]` array is the only way to pass character + location references together.

## Step 0 — read the project's video defaults

Call **`get_visual_world`** and take the render params from `settings.videoModel` +
`settings.videoResolution`, resolved through the `videoModels` catalog in the same
response. Send that entry's `model` and `mode` (omit `mode` when it is null) — never
the catalog `id`. These are the defaults the author set on the Settings page; use
them unless the user names something else in chat.

> ⚠️ **One override, always.** This skill ALWAYS attaches `audio_references` (the
> dialogue stem), and `mode: "fast"` fails any job that carries them. So if the
> project default is **Seedance 2.0 Fast** (`audioRefs: false`), render with
> `model: "seedance_2_0"`, `mode: "std"` instead and **tell the user you did**,
> in one line. Mini and standard 2.0 both take audio refs — leave those alone.
> If the resolved resolution isn't in the chosen model's `resolutions`, use `720p`.

## Inputs

| Input | Role in the job | Notes |
|---|---|---|
| **Dialogue stem** (`*-dialog.*`) | `audio_references` (the ONE audio Seedance lip-syncs to) | MUST be dialogue-only — see the check net below. |
| **Character voice refs** | (upstream) used to voice-lock the dialogue stem in the Seed Audio pass; also named in the prompt for identity | one clean clip per character |
| **Character sheets** | `image_references` (one per character) | locks each character's look |
| **Location image** | `image_references` | locks the setting |

Seedance accepts **one** `audio_references` and **many** `image_references`. The dialogue stem is the audio; every character sheet + the location are `image_references`.

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

## The MCP tools are already available

The Higgsfield MCP tools (`mcp__higgsfield__generate_video`,
`mcp__higgsfield__job_status`, `mcp__higgsfield__media_upload`,
`mcp__higgsfield__media_confirm`, `mcp__higgsfield__media_import_url`,
`mcp__higgsfield__models_explore`, `mcp__higgsfield__balance`) are registered on
the agent — call them directly, no loading step needed.

## Step 1 — Gather & validate inputs

- **Dialogue stem** — run the check net (must be `*-dialog.*`). If a dialogue-only stem doesn't exist yet, generate one first with the `seed-audio` / `video-from-audio-vfx` flow (voice-locked with the character voice refs), saved as `<scene>-dialog.<ext>`, and a sibling `<scene>-vfx.<ext>` for the effects.
- **Character sheets** — one reference image per character (locks appearance).
- **Location image** — one reference image for the setting.
- **Character voice refs** — the clips used to voice-lock the dialogue stem; keep them associated with each character tag and name each character in the prompt.

## Step 2 — Upload every local input to a media_id

`medias[].value` must be a Higgsfield **media_id**, not a path/URL.

1. `media_upload { files:[{ filename, content_type }] }` → presigned `upload_url` + `media_id` (`content_type` e.g. `image/png`, `audio/mpeg`, `audio/wav`).
2. `curl -X PUT -H "Content-Type: <signed type>" --data-binary @file '<upload_url>'` (header MUST match the signed type).
3. `media_confirm { type:"image"|"audio", media_ids:[...] }`.

(Web URL → `media_import_url`; Apps UI local picker → `media_upload_widget`.)

## Step 3 — Write the multishot prompt

One prompt describing the shots as ordered beats, under 15s total. Per shot give: camera, action, and the spoken line (or "no dialogue"). When a composed bundle prompt is handed to you, its `STYLE:` line (or absence of one) reflects the project's Episode style selection — keep it verbatim, never invent your own style clause; with no STYLE line, the reference images alone define the look. Then "Match the attached reference images for the location and the characters … Lip-sync all dialogue to the attached audio track, and embed that dialogue as the video's audio." Keep total runtime ≤ the dialogue stem length and ≤ 15s.

## Step 3½ — Confirm the submit with a CARD, not a paragraph (`render_ui`)

A Seedance render costs real credits, so the author sees the exact params before
it goes. Draw them with **`render_ui`**: a `KeyValue` of the terms **and an
`Actions` block in the SAME program**. There is no other confirm channel — flue
cannot suspend a turn, so the buttons ARE the gate.

```
root = Card([params, go])
params = KeyValue([{label: "Bundle", value: "MS-01 — Teaser — The Collapse"}, {label: "Model", value: "seedance_2_0 (std)"}, {label: "Resolution", value: "720p"}, {label: "Duration", value: "15s"}, {label: "Dialogue stem", value: "ms-01-dialog.mp3"}, {label: "Image refs", value: "Noah Chen sheet, Mrs. Kim sheet, Alley location"}], "Confirm render")
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
- One `audio_references` (the dialogue stem). Every character sheet + the location are their own `image_references` entries (repeatable). Never put a *reference* (a character sheet or location) in `start_image` — references are semantic, not the literal opening frame.

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

**Use the `refUrl`, never `thumb` or `display`.** Storyboard stills and library images now come back in three forms: `refUrl` (the absolute, FULL-RESOLUTION original), `display` (~1600px webp) and `thumb` (~400px webp). The tiers exist so the app and the chat can show a picture cheaply — feeding one to `media_import_url` would open your clip on a downscaled frame, and the loss is invisible until the render is done. The same rule covers every `image_references` and `audio_references` entry: always the `refUrl`.

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

## Interaction rules

- Always run the check net and **state the exact dialogue file** used as `audio_references`.
- Confirm the submit with a `render_ui` card (Step 3½) — `KeyValue` **plus** `Actions`, never the params alone — and stop the turn there.
- Never feed a `*-vfx.*` stem (or an unverified flat mix) to the video.
- Be concise; no raw IDs/JSON in chat. Use the MCP, never the CLI.
- See also: `video-from-audio-vfx` (produces the two stems), `seed-audio` (Seed Audio params + the `-dialog`/`-vfx` naming), `continue-video` (continue-from-last-frame variant).
