---
name: provider-fal
description: >-
  Provider adapter for fal.ai — access by API key (FAL_KEY). Use when config.json names
  `providers.*.id = "fal"`. Per-endpoint queue API: submit to the model's own path, then poll
  status and fetch the result. Reference media are plain public URLs. Storyseam never reads,
  stores or prints the key — it only checks that the env var is set.
---

# Provider: fal.ai (access `api_key`)

## Access check — before anything else

```
Queue base  https://queue.fal.run
Header      Authorization: Key $FAL_KEY
Env var     FAL_KEY
```

Check with `bin/provider-check.py fal`. It tests only whether the variable is **set and
non-empty**; it never prints, logs or stores the value.

If it is missing, tell the user and **stop**:

> fal.ai needs an API key. Get one at https://fal.ai/dashboard/keys, then:
> `export FAL_KEY=...` in the shell you run Storyseam from.

**Never ask the user to paste the key into the chat, and never write it into any file in the
story folder.** `config.json` names the *variable*, not the value.

## The shape: a queue per endpoint

Unlike Atlas's single prediction API, on fal **the model IS the path**.

```
POST https://queue.fal.run/{endpoint_id}                      { ...input }
  -> { "request_id": "..." }

GET  https://queue.fal.run/{base}/requests/{request_id}/status
  -> { "status": "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED", "queue_position": n }

GET  https://queue.fal.run/{base}/requests/{request_id}
  -> the model output — video.url / images[].url / audio.url on fal.media
```

`{base}` is the endpoint id with any trailing path segments trimmed to the app root. Keep the
`(endpoint, request_id)` pair together — polling needs both, and a request id alone is not
enough to find the job.

Poll roughly every 5s for images and 15s for video.

## Model routes

| Storyseam id | shape | endpoint id |
| --- | --- | --- |
| `seedance_2_5` | text→video | `bytedance/seedance-2.5/text-to-video` |
| `seedance_2_5` | start frame | `bytedance/seedance-2.5/image-to-video` |
| `seedance_2_5` | references | `bytedance/seedance-2.5/reference-to-video` |
| `seedance_2_0` | text→video | `bytedance/seedance-2.0/text-to-video` |

Pick the route the same way as on Atlas: references → `reference-to-video`, else a start
frame → `image-to-video`, else `text-to-video`.

**fal caps Seedance 2.5 at 720p**, where Higgsfield offers 1080p. Storyseam renders 480p
regardless, so this changes nothing for the engine — but do not promise the author a tier
this provider does not have.

## Registering a reference: publish it to a public URL

Reference arrays take absolute, publicly fetchable URLs. No upload, no confirm, no media id.
"Registering" a reference in `/cast` means **publishing the file** somewhere fal can fetch
it and recording the URL against the local path in `.storyseam/media.json` as
`{ "url": "…", "mtime": … }`, so the audit can still flag a stale file. The anchor frame
each block produces is published the same way before the next block cites it.

## Submitting a video block

The pipeline hands you a built block: prompt, an **ordered** reference list, duration,
resolution, aspect ratio, `generate_audio`. Submit to the `reference-to-video` endpoint
with the block's image references in `reference_images` **in the block's `references`
order** (anchor first on a chained block — the director numbered `@Image 1..K` in that
order), voices in `reference_audios` as the `.mp3` takes, then poll status and fetch the
result; download `video.url` to `renders/clips/block_<NN>.mp4`. There is no preset gate
on fal.

**Voice reference form:** the `.mp3` take itself. The black-frame `.mp4` is a Higgsfield
workaround and is not needed here; skip `bin/voice-to-blackmp4.sh`.

## Billing

Token-based rather than credit-based: around **$0.22 per second of 480p** output and
**$0.47 per second at 720p** for Seedance 2.5. A 30-second 480p block is therefore roughly
**$6.60**, and a four-block film about **$26**.

That is a different unit from Higgsfield credits, so **`config.costs` and the `producer`
skill's credit arithmetic do not transfer**. When fal is the video provider, price in
dollars, say so, and record each job's dollar cost in `state.json` under `credits` with a
note of the unit — reporting "300 credits" for a fal render is meaningless to the author.

## Capability gaps against the Higgsfield default

- **`gpt_image_2` is not offered.** A story switching to fal must change `image.model`, and
  the `gpt-image-2-director` skill no longer applies.
- **No Seed Audio equivalent.** fal has single sound-effect endpoints, not multi-voice
  dialogue scenes. Storyseam does not depend on this today, but a story that starts to will
  need Atlas or Higgsfield for audio.
