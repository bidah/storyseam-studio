---
name: generate-multishot
description: Generate ONE multi-shot Seedance 2.0 video (several scripted shots in a single <15s clip) via the Higgsfield MCP, driven by a DIALOG-ONLY audio stem plus character voice references, character-sheet images, and a location image. Use when the user wants a "multishot" / "multi-shot" Seedance generation, to combine shots 1–N into one clip, or to render a scene beat from character + location references with lip-synced dialogue. Enforces the -dialog/-vfx audio naming check so only the clean dialogue stem (never the SFX/VFX stem) is fed to the video.
---

# generate-multishot (Higgsfield Seedance 2.0 — via the Higgsfield MCP)

Render a single **multi-shot** clip: several scripted shots (wide → MS → CU …) described as beats inside ONE `seedance_2_0` generation, under the 15s cap, lip-synced to a **dialogue-only** audio stem. Built on the **Higgsfield MCP** (`mcp__higgsfield__*`).

> **Always use the Higgsfield MCP, never the `higgsfield` CLI.** Multiple reference images require the role `image_references`, which the CLI cannot send (its `--image` collapses to the single `start_image`). The MCP `generate_video` `medias[]` array is the only way to pass character + location references together.

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

One prompt describing the shots as ordered beats, under 15s total. Per shot give: camera, action, and the spoken line (or "no dialogue"). Open with a one-line style + a "Match the attached reference images for the location and the characters … Lip-sync all dialogue to the attached audio track, and embed that dialogue as the video's audio." Keep total runtime ≤ the dialogue stem length and ≤ 15s.

## Step 4 — Preflight, then submit (MCP `generate_video`)

Preflight cost (`get_cost:true`) if useful, then:

```jsonc
mcp__higgsfield__generate_video {
  "params": {
    "model": "seedance_2_0",
    "prompt": "MULTISHOT_PROMPT",
    "duration": <ceil(dialogue length), 4–15>,
    "resolution": "720p",
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
- Never feed a `*-vfx.*` stem (or an unverified flat mix) to the video.
- Be concise; no raw IDs/JSON in chat. Use the MCP, never the CLI.
- See also: `video-from-audio-vfx` (produces the two stems), `seed-audio` (Seed Audio params + the `-dialog`/`-vfx` naming), `continue-video` (continue-from-last-frame variant).
