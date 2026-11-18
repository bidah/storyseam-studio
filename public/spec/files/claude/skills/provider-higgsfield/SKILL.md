---
name: provider-higgsfield
description: >-
  Provider adapter for Higgsfield — access by MCP. Use when config.json names
  `providers.*.id = "higgsfield"`. The complete playbook for the default provider: the
  access probe, the upload/confirm media flow and the media.json cache, the exact
  generate_video and generate_image calls, the media roles the ordered reference list maps
  to, the preset gate, polling, download, billing, and every failure mode that has cost a
  turn. Auth is the MCP connection itself; Storyseam never handles a key for this provider.
---

# Provider: Higgsfield (access `mcp`)

Higgsfield is the default provider and the one every hard-won fact below was learned on.
The pipeline skills (`/cast`, `/render`) say *what* must be true after each step; this
skill says *how* on Higgsfield. Nothing here belongs in a pipeline skill or a shot list.

## Access check — before anything else

Higgsfield is reached through MCP tools prefixed `mcp__claude_ai_higgsfield__`. There is no
API key: **the MCP connection is the auth.** Never the `higgsfield` CLI — it can pass one
reference image, which breaks every character-anchored shot.

Probe with `mcp__claude_ai_higgsfield__balance`. If the tools are absent:

> The Higgsfield MCP server is not connected. **Storyseam cannot install or connect it for
> you** — the user connects it in their client, then re-runs.

Say that and stop. Do not fall back to another provider silently: the shot list and the
render budget were written for the configured one.

## Registering a reference: upload → confirm → `media_id`

This is the part that differs most from the API-key providers, and the part that fails
silently. A render cites a reference **only** by `media_id`. **Every `medias[].value` must
be a `media_id`.** Never an `https://` URL, never a prior `job_id` — a URL is rejected and
a `job_id` does not error; it hangs.

Local file:
1. `media_upload { files: [{ filename, content_type }] }` → `upload_url` + `media_id`
2. `curl -X PUT -H "Content-Type: <the signed type>" --data-binary @<file> '<upload_url>'`
   — **the header must match the signed type** or the PUT appears to succeed and the
   render 404s an hour later.
3. `media_confirm { type: "image"|"video"|"audio", media_ids: [...] }`

Already on the web: `media_import_url` → `media_id`. Much cheaper than re-uploading bytes
when the file is already hosted (a previous generation's `result_url`, for example).

**`.mov` is rejected.** Re-encode to `.mp4` (`libx264` + `aac`) before uploading.

### The cache: `.storyseam/media.json`

Record every mapping so `/render` never blocks on an upload (shape:
`schema/media.schema.json`):

```json
{ "assets/images/characters/noah.png":
    { "media_id": "…", "confirmed": true, "type": "image",
      "mtime": 1756830000, "sha256": "…" } }
```

`mtime` is the file's modification time (`stat -f %m <file>` on macOS, `stat -c %Y` on
Linux) and `sha256` its content hash at upload time. `bin/asset-audit.sh` reports
**STALE** when the file on disk is newer than its entry — re-upload it and refresh the
entry. A cache miss in `/render` means an upload at the worst possible moment; a stale
entry means a render against the wrong file at full price. The anchor frame each block
produces is registered the same way and cached under its `renders/frames/` path.

This cache is a Higgsfield concept. URL-based providers do not have it.

## The voice reference form

A character's voice reaches a render as a **black-frame `.mp4` passed in
`video_references`**, not through `audio_references` — that path is narrower and rejects
`mode: "fast"` outright. `bin/voice-to-blackmp4.sh <slug>` writes
`assets/audio/voices/blackframe/<slug>.mp4` from the take. Upload and confirm it as
`type: "video"`. The director's voice-reference sentence in the prompt tells the model to
ignore the black frames.

## Submitting a video block

The pipeline hands you a built block: prompt, an **ordered** reference list, duration,
resolution, aspect ratio, `generate_audio`. Map it to the call:

```
generate_video {
  model: "seedance_2_5",
  mode: "omni_reference",            // the Storyseam default: any block with references
  duration: <block.dur>,             // 4–30
  resolution: "480p",                // never higher
  aspect_ratio: <config.aspect_ratio>,
  generate_audio: true,
  prompt: <prompt + "\n\n" + video_style_prompt.txt>,
  medias: [ ...in the block's reference order... ]
}
```

**`medias[]` follows the block's `references` order exactly**, because the director
numbered `@Image 1..K` in that order in the prompt. Each image-kind reference (anchor,
character, location, prop) becomes `{ role: "image_references", value: <media_id> }`; each
voice or video reference becomes `{ role: "video_references", value: <media_id> }`.

**Never use the `start_image` role for `seedance_2_5`.** The API declares it (the schema
is shared with 2.0), accepts it, and records `"role":"start_image"` on the job — and the
model ignores it. A whole film was rendered that way and not one block opened on its
anchor. On 2.5 the anchor is the first `image_references` entry and the prompt makes it
the first frame; that is the director's contract, not this adapter's. (On `seedance_2_0`
the role is real, and that model's director uses it.)

Preflight an unfamiliar call with `get_cost: true` — but see Billing below.

### The preset gate

`generate_video` may return a `preset_recommendation` instead of a job. **No credit is
spent and nothing was submitted** — it is a free round trip, not a failure.

Resend the **identical** call with `declined_preset_id: "<id>"` so the prompt renders
literally. Three things about this that cost a turn each to learn:

- **`declined_preset_id` declines exactly one preset, by id.** A different block — or the
  same block re-sent — can come back recommending a *different* preset, and the id from
  last time will not suppress it. Read the id out of *this* response.
- One of the presets on offer is literally called **DROWN IN MUSIC**, which breaks the
  no-music rule outright. Never accept a preset — it overrides the block's blocking.
- **Never ask the author which preset they want.** The block prompt is the shot list's
  considered output; a preset is a style bundle that overrides it. Decline and move on.

### Polling and download

Poll `job_status` (or `jobs_wait`) and respect `poll_after_seconds`. A 30-second 480p block
has taken anywhere from a few minutes to half an hour depending on load; do not treat a
long wait as a failure. Download `result_url` to `renders/clips/block_<NN>.mp4`.

`generate_video_batch` exists for independent jobs, but **story blocks are never batched**
— the last-frame chain is sequential by construction.

## Submitting a still

```
generate_image {
  model: "gpt_image_2",
  resolution: "2k", quality: "high",
  aspect_ratio: <as the image director says: portrait for sheets, config for plates>,
  prompt: <prompt + "\n\n" + image_style_prompt.txt>
}
```

Images take 10–20 seconds. Download the result to the conventional path under
`assets/images/`, then register it (upload → confirm → cache) so `/render` can cite it.
`gpt_image_2` is offered here and not on Atlas or fal.

## Billing

`balance` returns credits. `config.costs` holds the engine's planning figures
(`block_30s`, `voice`, `still`); record **what a job actually billed** in `state.json`,
because the preflight lies low: a bare `t2v` 30s/480p preflights at 75 while a real
`omni_reference` block with references has billed **75 and 105** for the same duration and
resolution. Quote `config.costs` as a floor and read actuals from `balance` before and
after each job.

## Failure modes, in the order they usually happen

- **Rejected: a URL or a `job_id` in `medias[].value`** — register the file and pass the
  `media_id`. Free to fix.
- **Rejected: unconfirmed `media_id`** — `media_confirm` was skipped or failed. Free.
- **Rejected: wrong `mode`** — a block with references is `omni_reference`; `video_extension`
  needs `extension_mode`, and only there. Free.
- **Render 404s or renders the wrong picture** — the PUT's `Content-Type` did not match the
  signed type, or the cache entry is stale. Re-upload.
- **Block opens on the wrong framing** — the anchor was passed as `start_image`, or
  `medias[]` order differs from the prompt's numbering. Fix the order; never the role.
- **Music in the clip** — a preset was accepted, or the audio line was weak. Decline the
  preset, strengthen the line through the director, re-render. It cannot be un-mixed.
