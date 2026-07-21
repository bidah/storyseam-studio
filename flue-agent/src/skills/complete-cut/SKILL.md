---
name: complete-cut
description: Assemble and score the full episode "complete cut" — stitch the selected take of every bundle into one video, then overlay the Sound Studio background-music cues underneath at a low bed level so dialogue leads. Use when the user asks to "run/build/render the complete cut", "make the full cut", "stitch the episode", "add background music to the cut", "score the episode", or wants a new scored version of the cut. Runs entirely through Shot Studio server tools (get_cuts, stitch_cuts, score_cut) — no Higgsfield render, so no credit spend and no confirm-before-submit gate.
---

# complete-cut (assemble + score the full episode cut)

Build the episode's **complete cut** and, on request, a **scored version** with background
music mixed underneath. This is pure server-side ffmpeg via three tools — it does **not** call
Higgsfield, spends no credits, and needs no confirm-before-submit gate. Just do it and report.

## The three tools

| Tool | What it does |
|---|---|
| `get_cuts` | Read the stitch plan: every bundle's selected take in order, per-segment timecodes, the current stitched output, the **music cue layout**, and any existing **scored versions**. Always call this first to see current state. |
| `stitch_cuts` | Concatenate the selected takes (MS-01 → last) into one `complete_cut.mp4`. Fast stream-copy. |
| `score_cut` | Overlay the Sound Studio music cues UNDER the stitched cut at a low bed (~-22 dB), minting a **new scored version**. Optional `gainDb` sets the bed level (e.g. `-26` quieter, `-18` louder). Kept versions stack for A/B; newest is on top. |

## Flow

1. **`get_cuts`** — inspect. Note:
   - `output` — is the plain cut already stitched? (`output.url`, `stitchedAt`)
   - `music` — the cue layout (each cue's `label`, `start` timecode, `duration`). If empty, no
     background-music cues are rendered yet — tell the user to render them in Sound Studio first.
   - `output.scoredVersions` — existing scored versions (newest first, each with `v`, `gainDb`).
   - `segments[].fallback` / `segments[].missing` — surface these; the cut uses the first take
     when none is explicitly selected, and skips bundles with no rendered take.
2. **Stitch if needed.** If the user wants the base cut, or there's no `output` yet (or takes
   changed since `stitchedAt`), call **`stitch_cuts`**.
3. **Score on request.** When the user wants background music / a scored version, call
   **`score_cut`** (after the cut is stitched). Pass `gainDb` if they asked for a specific level
   or "quieter / louder". Each call makes a NEW version — never overwrites — so "make another,
   quieter" just means `score_cut({ gainDb: -26 })` again.

## What to report back

After stitching: the output URL, total duration, scene count, and any fallback/missing scenes.

After scoring: the new **version number**, the **dB bed level**, the **cue count**, and that the
newest version shows on top of the Scored versions list in the **Complete cuts** tab. If prior
versions exist, mention they're kept for comparison. The music sits under the baked-in
dialogue/SFX — quieter `gainDb` = more dialogue focus.

## Notes

- **Cue placement is fixed by beat**: each cue is pinned to the first bundle of its beat (Cue 2 →
  MS-04, Cue 3 → MS-09, …). Re-scoring only changes the **level**, not the placement.
- The **opening** (MS-01–03) has no bed unless an opening cue exists as a ready music track.
- The UI refreshes on its own poll — after any change, tell the user what changed and to check
  the **Complete cuts** tab.
- If `score_cut` errors with "Stitch the cut first", run `stitch_cuts` then retry. If it errors
  with "No rendered music cues", the background-music tracks aren't rendered yet.
