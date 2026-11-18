---
name: provider-atlas
description: >-
  Provider adapter for Atlas Cloud — access by API key (ATLAS_KEY). Use when config.json
  names `providers.*.id = "atlas"`. One prediction API for image, video and audio; reference
  media are plain public URLs with no upload step. Storyseam never reads, stores or prints
  the key — it only checks that the env var is set.
---

# Provider: Atlas Cloud (access `api_key`)

## Access check — before anything else

```
Base URL   https://api.atlascloud.ai/api/v1
Header     Authorization: Bearer $ATLAS_KEY
Env var    ATLAS_KEY
```

Check with `bin/provider-check.py atlas`. It tests only whether the variable is **set and
non-empty**; it never prints, logs or stores the value.

If it is missing, tell the user how to set it and **stop**:

> Atlas Cloud needs an API key. Get one at https://www.atlascloud.ai, then:
> `export ATLAS_KEY=...` in the shell you run Storyseam from.

**Never ask the user to paste the key into the chat, and never write it into `config.json`,
`storyseam.md`, or any file in the story folder.** `config.json` names the *variable*, not the
value. The key lives in the environment, and Storyseam only ever reads `os.environ`.

## The shape: one prediction API

Unlike fal's per-endpoint queue, Atlas is a single prediction API. The **model is a body
field**, not part of the path.

```
POST /model/generateImage   { "model": "...", ...input }
POST /model/generateVideo   { "model": "...", ...input }
POST /model/generateAudio   { "model": "...", ...input }
   -> { "id": "<prediction_id>", "status": "processing" }        (may be wrapped in "data")

GET  /model/prediction/<id>
   -> { "status": "completed", "outputs": ["https://..."] }
```

Poll until `status` leaves `processing`. `outputs[0]` is the result media URL. Fast image
models sometimes complete synchronously — pass `outputs` through when the submit response
already carries them.

**Responses may wrap the prediction under `data` or return it bare.** Unwrap defensively.

## Model routes

The canonical model id in `config.json` maps to a **route per job shape**:

| Storyseam id | shape | native route |
| --- | --- | --- |
| `seedance_2_5` | text→video | `bytedance/seedance-2.5/text-to-video` |
| `seedance_2_5` | start frame | `bytedance/seedance-2.5/image-to-video` |
| `seedance_2_5` | references | `bytedance/seedance-2.5/reference-to-video` |
| `seedance_2_0` | same three | `bytedance/seedance-2.0/…` |
| `nano_banana_2` | text→image | `google/nano-banana-2/text-to-image` |
| `nano_banana_2` | with refs | `google/nano-banana-2/edit` |
| `seed_audio_1_0` | audio scene | `bytedance/seed-audio-1.0` |

Pick the route from what the job carries: any reference array → `reference-to-video`; else a
start frame → `image-to-video`; else `text-to-video`. Images with `images[]` → `edit`.

## Registering a reference: publish it to a public URL

This is the big operational difference from Higgsfield. There is no upload step and no
media id: reference arrays take **absolute, publicly fetchable URLs directly**. So
"registering" a reference in `/cast` means **publishing the file** somewhere Atlas can
fetch it (an R2 or S3 bucket, any static host) and recording the URL against the local
path — put it in `.storyseam/media.json` as `{ "url": "…", "mtime": … }` so the audit can
still tell a stale file from a current one. The anchor frame each block produces is
published the same way before the next block cites it.

## Submitting a video block

The pipeline hands you a built block: prompt, an **ordered** reference list, duration,
resolution, aspect ratio, `generate_audio`. Map it to the reference route:

```json
{ "model": "bytedance/seedance-2.5/reference-to-video",
  "prompt": "...", "ratio": "adaptive", "duration": 10,
  "resolution": "480p", "generate_audio": true,
  "reference_images": ["https://.../noah.png", "https://.../noah-living-room.png"],
  "reference_videos": ["https://..."],
  "reference_audios": ["https://.../noah.mp3"] }
```

No `media_upload`, no `media_confirm`, no `media_id` cache. The stills must be reachable by
Atlas — publish them (the project's R2 bucket works) rather than pointing at local paths.

`reference_images` follows the block's `references` order exactly (anchor first on a
chained block), because the director numbered `@Image 1..K` in that order in the prompt.

Limits: **≤9 reference images, ≤3 reference videos, ≤3 reference audios.** That is much
tighter than Seedance's own 30/10/10 ceiling, so prune to the references that carry
identity — and say so in the shot list, because dropping the fifth prop plate silently
changes what the prompt's `@Image 5` points at.

Poll `GET /model/prediction/<id>` until `status` leaves `processing`, then download
`outputs[0]` to `renders/clips/block_<NN>.mp4`. There is no preset gate on Atlas.

Note `ratio` (not `aspect_ratio`) and `adaptive`, which matches the first reference or frame.

## Voice: no black-frame trick needed

Atlas exposes `reference_audios` on the reference route, and Seedance lip-syncs to it
natively. Pass the character's `.mp3` **directly** and keep `generate_audio: true`.

The black-frame `.mp4` workaround is a Higgsfield constraint, not a Seedance one. On Atlas,
skip it — and skip `bin/voice-to-blackmp4.sh` with it. Refer to the stem positionally in the
prompt ("lip-sync exactly to audio 1").

## Billing

Credits, read from the account, but not the same credits as Higgsfield: `config.costs` was
written for the default provider, so on a story that renders here, check one block's
actual charge against it and correct `config.costs` before quoting a total. Record what
each job actually billed in `state.json`.

## Capability gaps against the Higgsfield default

- **`gpt_image_2` is not offered.** Storyseam's default image model is Higgsfield-only. On
  Atlas the image model is `nano_banana_2`, so a story switching providers must change
  `image.model` too — and the `gpt-image-2-director` skill no longer applies.
- Audio is *better* here: `seed_audio_1_0` renders full mixed scenes, not just single SFX.
