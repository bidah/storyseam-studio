---
name: upscale-video
description: >-
  Upscale a finished video — a kept Stage sitting, its scored version, or an
  Editor Deliver render — to 720p/1080p/1440p/4K on fal with SeedVR2, ByteDance
  or Topaz. Use when the author asks to upscale, enhance, sharpen or "make it
  4K/1080p", or asks whether an upscale is done. ALWAYS read list_upscales first
  and use a `source` id exactly as it names it. It spends the author's fal
  credits: unless they already named the video, the model AND the resolution,
  draw ONE render_ui card offering the choices before calling upscale_video.
  upscale_video only STARTS the job — poll get_upscale until `done` or `error`,
  and never claim the file exists before it says `done`. The original is never
  overwritten; say so if the author worries about losing it. Needs the Upscale
  plugin (plugin-gate).
---

# Upscale a finished film

Everything this studio finishes is 720p by construction — the Stage streams at
720p, the Editor renders its 1280×720 timeline. Upscaling is the last step
before a film leaves the building.

## The flow

1. **`list_upscales`** — `sources` (newest first), `models` (each with the
   `resolutions` it offers) and past `jobs`.
   - `sitting:<id>` — a kept Stage sitting, as recorded.
   - `scored:<id>` — the same sitting with the Musicalized score under it.
     When a sitting has both, the scored one is usually the one the author
     means by "the film".
   - `render:<file>` — an Editor Deliver render.
   If there is nothing to upscale, say where videos come from (keep a sitting
   on the Stage, or Deliver from the Editor) and stop.
2. **Confirm** the video, model and resolution unless the author named all
   three. One `render_ui` card with the sources as an `OptionList` (or the
   models/resolutions, whichever is still open). Suggested default:
   **SeedVR2 at 1080p** — the sharpest on generated footage and the cheapest
   pass that still reads as HD. 4K is a much longer, costlier pass; only offer
   it as the default if they asked for 4K.
3. **`upscale_video`** with `source`, `model`, `resolution` (and
   `sourceHeight` if you know it — only Topaz uses it).
4. **`get_upscale`** with the returned `job.id`. `running` → tell the author
   it is on fal and will take a few minutes; poll again later rather than in a
   tight loop. `done` → the upscaled file's `url` is in the job. `error` → pass
   on the reason; a `no_fal_key` error means they must add their fal key in
   Settings.

## Models

| id | good for | resolutions |
| --- | --- | --- |
| `seedvr` | generated footage, most detail | 720p–2160p |
| `bytedance` | fast and clean, AIGC preset | 1080p–2160p |
| `topaz` | conservative, invents the least | 1080p–2160p |

A model that does not offer the requested resolution is refused by the route —
pick from its `resolutions` list.
