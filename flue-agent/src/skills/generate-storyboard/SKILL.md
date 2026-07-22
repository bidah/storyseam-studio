---
name: generate-storyboard
description: Generate ONE storyboard STILL image for a single shot with Nano Banana Pro via the Higgsfield MCP generate_image tool, locked to the shot's character + location reference images. Use when the user wants a "storyboard" still / keyframe for a shot on the Episode tab (Images mode), to visualize a shot's framing/angle before rendering video, or to add another camera-angle take for a shot. This is the still-image counterpart of generate-multishot (which renders the Seedance video); it produces images, not video.
---

# generate-storyboard (Nano Banana Pro — via the Higgsfield MCP)

Generate a single **storyboard still** for one shot: a framed keyframe that locks
the shot's characters, location, camera angle, and action, so the beat can be
visualized before (and later reused as a reference for) the video render. Built on
the **Higgsfield MCP** (`mcp__higgsfield__*`), using the **Nano Banana
Pro** image model.

> **One still, one shot.** Each call renders ONE image for ONE shot id inside a
> bundle. Multiple takes per shot accumulate (via repeated calls) so different
> camera angles can be compared — the Images mode UI shows them as a selectable
> carousel and one is chosen. To cover a whole bundle, loop shot-by-shot.

> **Always use the Higgsfield MCP, never a CLI.** Multiple reference images must be
> passed as `image` entries in the MCP `generate_image` `medias[]` array (one per
> character + the location). (Nano Banana Pro's ref role is `image` — that's the
> image-model role; the video models use `image_references`, so don't copy that
> role over from generate-multishot.)

## Inputs

| Input | Role in the job | Notes |
|---|---|---|
| **Character sheets** | `image` (one per character) | locks each character's look |
| **Location image** | `image` | locks the setting |
| **Shot details** | prompt text | camera, action, location, dialogue context (for expression/pose) |
| **Angle note** (optional) | prompt text | the camera angle / variation for THIS take (e.g. "low angle, close-up") |

Nano Banana Pro accepts **many** `image` references (its `models_explore` entry
shows `"roles":["image"]` with no `max`). There is no audio for a still.

## The MCP tools are already available

The Higgsfield MCP tools (`mcp__higgsfield__generate_image`,
`mcp__higgsfield__job_status`, `mcp__higgsfield__media_upload`,
`mcp__higgsfield__media_confirm`, `mcp__higgsfield__media_import_url`,
`mcp__higgsfield__models_explore`, `mcp__higgsfield__balance`) are registered on
the agent — call them directly, no loading step needed.

## Step 1 — Resolve the Nano Banana Pro model id

Do NOT hardcode a model id, and don't reuse an id off a prior still — **Higgsfield
renames these** (e.g. `nano_banana_flash` → `nano_banana_2`), so a remembered id
goes stale and `generate_image` fails with "invalid model". Call `models_explore`
fresh (list image models, or `action:'recommend'` with the goal "photoreal
storyboard still from character + location references") and pick the **Nano Banana
Pro** image model it returns (or the current Nano Banana image model if there's no
"Pro"). Use that freshly-resolved id in `generate_image` below; if a call errors on
the model, re-run `models_explore` and retry with the current id.

## Step 2 — Upload every local reference to a media_id

`medias[].value` must be a Higgsfield **media_id**, not a path/URL.

1. `media_upload { files:[{ filename, content_type }] }` → presigned `upload_url` + `media_id` (`content_type` e.g. `image/png`).
2. `curl -X PUT -H "Content-Type: <signed type>" --data-binary @file '<upload_url>'` (header MUST match the signed type).
3. `media_confirm { type:"image", media_ids:[...] }`.

(Web URL → `media_import_url`; Apps UI local picker → `media_upload_widget`.)

## Step 3 — Write the still prompt

One prompt describing a SINGLE framed moment of the shot (a storyboard keyframe),
not a sequence. Open with a one-line style + "Match the attached reference images
for the location and each character — keep their exact appearance." Then give the
camera framing, the character(s) present and their pose/expression, the action at
this instant, and the setting. If an angle note was supplied, state it explicitly
(e.g. "Camera: low-angle close-up on Sara"). Aim for a clean, single-frame
cinematic still. Do NOT describe motion over time — it's one image.

## Step 4 — Preflight, then submit (MCP `generate_image`)

Preflight cost (`get_cost:true`) if useful, then:

```jsonc
mcp__higgsfield__generate_image {
  "params": {
    "model": "<NANO_BANANA_PRO model id from models_explore>",
    "prompt": "STILL_PROMPT",
    "aspect_ratio": "16:9",
    "medias": [
      { "role": "image", "value": "<location media_id>" },
      { "role": "image", "value": "<character_1 sheet media_id>" },
      { "role": "image", "value": "<character_2 sheet media_id>" }
    ]
  }
}
```

- If the response is a `preset_recommendation`, resend the same call with `declined_preset_id:"<id>"` to generate the prompt literally.
- Every character sheet + the location are their own `image` entries (repeatable). There is no `start_image` and no audio.

## Step 5 — Poll

```jsonc
mcp__higgsfield__job_status { "jobId": "<id>", "sync": true }   // raw_data:true for result_url
```

Repeat until `status:"completed"`; read `result_url`. Stills render fast (~10–40s).

## Step 6 — Attach to the shot

Call `attach_still` with the bundle id, the shot id, the `result_url`, and — if a
specific camera angle/variation was requested — the `angle` note, so the take is
labeled in the carousel.

**Always record HOW you made it** (`prompt`, `model`, `refs`). These are what let
a human re-roll this take later without reconstructing your intent: the Editor's
"New still…" modal prefills its prompt box from `prompt`. Passing them is not
optional bookkeeping — omit them and the take is a dead end.

```jsonc
attach_still {
  "bundle": "MS-01",
  "shot": "MS-012",
  "url": "<result_url>",
  "angle": "low-angle CU",       // optional; include when this take is a specific angle/variation
  "prompt": "<the EXACT prompt text you sent to the model>",
  "model": "<the model id you resolved via models_explore>",
  "refs": [                       // the references you actually passed
    { "key": "helena", "role": "character", "url": "<ref url>" }
  ],
  "shotSnapshot": { "location": "school-clearing", "camera": "CU", "action": "Helena turns", "dur": 3 }
}
```

The Worker downloads the image into R2 and appends it as a new take for that shot;
it appears in the Episode tab's **Images mode** and can be selected as the chosen
still. Do NOT call `attach_episode_video` (that's for the Seedance video).

## Step 7 — only when asked: put it on the animatic's timeline

When the request names a timeline **item id** (it came from the Editor's
"Add scene" / "New still" flow), finish by dropping the image into that item:

```jsonc
edit_timeline { "ops": [
  { "op": "replace", "id": "<the item id from the request>",
    "src": "<the url attach_still returned>",
    "stillFile": "<the file attach_still returned>",
    "name": "MS-012 · still 2" }
]}
```

`replace` swaps the media and nothing else — the slot's position and duration are
what the user set, so never `move`/`resize`/`remove` to place a still. The Editor
reloads on its own and the picture appears in place. If no item id was given, stop
after `attach_still`.

## Interaction rules

- Confirm the Higgsfield submit (prompt + refs + model) with me first, as usual.
- One still per shot per call. For a whole bundle, repeat shot-by-shot.
- State which reference images were used and the exact shot id you attached to.
- Be concise; no raw IDs/JSON in chat. Use the MCP, never a CLI.
- See also: `generate-multishot` (the Seedance video counterpart) — a selected
  storyboard still can later be reused as a reference for the video render.
