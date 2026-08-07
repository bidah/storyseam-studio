---
name: musical
description: >-
  Turn a song into an audio "shot bible" on the Musical tab: the song is cut into
  shot-length segments (each ≤ a generation cap, default 15s) on real breath gaps
  in the vocal stem so a lip-synced AI clip never breaks mid-word, and you author
  each shot's exact sung lyric plus a Seedance/Kling director prompt (mouth
  matches Audio 1) under one global continuity lock. Use when the author is on the
  Musical tab, taps "Split into shots" or "Author prompts with agent", or asks to
  "split this song into shots", "make a music-video shot list", "cut the audio for
  each Seedance/Kling clip", "segment the vocals by phrase", or "build the audio
  shot bible". The cut itself is done FOR you by split_song (ffmpeg on Daytona,
  needs an uploaded vocal stem AND full mix); you write the lyric + prompt per
  segment and save with save_musical_segments. Also use to REFINE a split — pass
  explicit boundaries to split_song when a held note or pickup word landed in the
  wrong shot.
---

# musical (song → audio shot bible)

Turn a song into shot-length audio cuts for AI video generation (Seedance 2.0,
Kling 3.0, Higgsfield), with cuts landing on real vocal phrase boundaries — then
pair each cut with a director prompt whose mouth movements match the exact sung
lyric. The DSP (gap detection + cutting) runs server-side on Daytona; your job is
the split's boundaries when they need refining, and the creative authoring.

## The core idea

AI video generators lip-sync a character to an audio reference. Cut the audio
mid-word and the generated mouth breaks at the seam — so **cuts must land in the
silence between sung phrases** (breath gaps in the isolated vocal), and the sung
lyric must be written into each prompt so the model knows the mouth shapes.

`split_song` finds those gaps in the **vocal stem** and cuts BOTH versions
(vocal-only + full-mix) at the same timestamps, so they stay frame-aligned. You
never run ffmpeg yourself.

## Preconditions

- The author must have uploaded **both** a **vocal stem** and a **full mix** on
  the Musical tab. Check with `get_musical`: `song.voxFile` and `song.mixFile`
  must both be set. If either is missing, tell the author to upload it (the stem
  is what gap detection reads; the mix is the second version of each cut) and
  stop — don't try to cut.
- Lyrics help a lot. `song.lyrics` carries whatever the author pasted. If it's
  empty, ask them for the lyrics (with section labels if they have them), or
  offer to transcribe them from the audio — you can't author accurate per-shot
  lyrics without them.

## Workflow

### 1 — Read the state
Call **`get_musical`**. Note the song length, the pasted lyrics, and whether
segments already exist (each with a `label`, `t0`/`t1`, and any authored
`lyric`/`prompt`).

### 2 — Cut the song (if not already cut)
If there are no segments yet, call **`split_song`** with just a `capSec` (confirm
the cap with the author — Seedance and Kling differ; default 15). It runs the cut
on Daytona and returns the segments with their timecodes and playable URLs. The
FIRST cut of a conversation is slow (~1 min, the sandbox image builds); if it
returns `status:"running"`, call `split_song` again with the returned `jobId`
(and no other args) to keep polling. Never call it fresh to re-poll — that starts
a second cut.

### 3 — Map the lyrics onto the segments
Line up the pasted lyrics against the segment timecodes. Each shot holds a
coherent lyrical unit (a line, a couplet, a chorus). Judgment calls:
- **Pickup words** ("here I *go!*") belong to the NEXT section musically.
- **Held notes** ("Braaave!") extend past the spoken duration.
- **Spoken outros** want their own shot (different mouth energy).
- If a phrase clearly sits in the wrong shot, **refine the split**: call
  `split_song` again with explicit ascending `boundaries` (seconds) at the
  corrected breaths. Re-splitting RELABELS the shots, so re-author afterward.

### 4 — Author each shot, then save
Write one global **continuity lock** and, for each segment, the **exact sung
lyric** and a **director prompt**. Save with **`save_musical_segments`** (matched
by `label` — copy labels verbatim, never invent them), passing `continuity` once.
You can save in batches and re-save to revise; it only writes text and never
disturbs the audio cuts.

## Prompt conventions (per shot)

The prompt is a Seedance/Kling directing prompt. Non-negotiable elements:

1. **Duration + format line**: `Duration: N seconds. Aspect ratio: 16:9. One
   continuous shot. Use Image 1 as identity reference. Use Audio 1 for lip sync
   and rhythm.` Round N to the tool's allowed values; note any trim.
2. **The sung lyric + sync instruction** — the single most important element:
   > She sings: "[exact lyric for this shot]" Her mouth movements match these
   > exact words in Audio 1.
   Strip parenthetical stage directions from the *quoted* text ("(Loud and
   proud!)" → `Loud and proud!`). Call out sung vs. spoken explicitly when a shot
   has both, so the model shifts mouth energy.
3. **Framing** — shot size + angle.
4. **Action beats tied to specific lyrics** — "on 'loud and proud' she throws her
   left arm up". State which body parts move so feet stay on their marks.
5. **Camera blocking** — locked-off (safest for dancing) vs. a slow push-in.
6. **Aesthetics** — style, palette, lighting.
7. **Final frame** — describe the last pose, so consecutive shots hand off: match
   shot N's final frame to shot N+1's opening pose for a seamless cut.

## The continuity lock (one block, every shot)

> The [character] from Image 1 keeps the same face, [fur/skin] color, hairstyle,
> outfit, body proportions, and silhouette in every shot. [She] holds the
> microphone in [her] right hand throughout. The [set], [backdrop], and lighting
> remain consistent. Lip movement syncs to Audio 1, matching the sung lyric
> written in each prompt.

Pull the character, wardrobe, and set from the World bible (`get_world`) /
Episode style when the project has them, so the lock matches the rest of the
production; otherwise ask the author.

## Finishing

After saving, the Musical tab shows each shot's lyric + prompt with its two
players. Draw a short **`render_ui`** summary (an `AudioList` of the segments is
ideal — playable cuts, never bare links) so the author can hear the split and
read the prompts inline. If any shot ran `over cap`, say which and offer to
refine the split there.
