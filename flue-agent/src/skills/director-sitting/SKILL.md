---
name: director-sitting
description: >-
  Run — and more often, refuse to run — a Director sitting on the Stage. Covers
  what a sitting costs, why it cannot be recovered if it was not recorded as it
  played, why two sittings of one Series are different films, and the preflight
  that catches a refusal before the author pays for it. Use when the author asks
  to play a Series, asks how long a film will run, asks what a sitting will cost,
  or comes back from one saying it failed, was cut short, or looked nothing like
  the sheet. ALWAYS run preflight_sitting before saying a Series is ready: a
  session bills from its first second and a configure the endpoint throws out
  bills its sixty-second minimum anyway. Do NOT promise to run a sitting
  yourself — it is a peer connection in the author's browser, and only the
  browser can hold one.
---

# A sitting

One run of a Director session, from play to ending: the thing the author
watched. It is a WebRTC connection between **their browser** and the endpoint,
and the film arrives as it is generated.

## Three facts that decide everything else on this tab

**It bills from its first second**, with a sixty-second minimum. A session that
dies at `configure` — because a cue sheet broke a ceiling — bills that minimum
for nothing at all.

**Two sittings of one Series are different films.** The endpoint is not
deterministic. Re-running the recipe does not reproduce a sitting, it produces
another one. So "let me try that again" is not a retry, it is a second purchase.

**A sitting that was not recorded while it played cannot be recovered.** The
endpoint keeps nothing — there is no file to fetch afterwards. The film exists
because the browser was decoding and writing it as it arrived.

Together those mean the useful work is all **before** play.

## What you can and cannot do

You cannot run a sitting. There is no request to make and no job to poll; only
the browser can hold the connection. Do not say you will "start the render" or
"kick it off" — say the Series is ready and the author presses play on the Stage
tab.

What you can do is the part that saves money:

- `preflight_sitting` — every reason the endpoint would refuse this Series, plus
  the things that are not refusals but are almost always mistakes.
- `get_stage` — the exact `configure` message, the reels after it, how many
  seconds of film it comes to, and the session cap.
- `list_sittings` — what has already been kept.

## Preflight, every time

Run it before you tell anyone a Series is ready. Report both halves:

**Refusals** kill the session at the door. Fix them before play, always.

**Warnings** do not. A Series with no model sheets will play; it will just
drift, and the author will find that out by watching four minutes of it. Say
what each one will look like rather than naming the missing field — "nothing is
holding the cast still, so designs will change shot to shot" tells them
something; "no model sheets" does not.

## Reading a sitting that went wrong

| What the author says | Where to look |
|---|---|
| "It died immediately, nothing rendered" | A ceiling. `preflight_sitting` — the endpoint refuses the whole script and names no beat |
| "It stopped partway" | The session cap (`get_stage` → `maxSessionSeconds`), or the film is longer than the cap allows. Cut it into reels |
| "The end never filmed" | Same. The last beats are past the cap |
| "It drifted / kept changing shots" | The cue sheet, not the sitting. See the `cue-sheet` skill |
| "The sound was off" | The render is the truth, not the prompt. Move the beats, do not rewrite them |
| "I lost it" | If it was not kept, it is gone. Say so plainly and do not offer to regenerate it as though that were the same film |

## Reels

A sheet too long for one script is legal cut into reels — `update_series` with
`reelChanges`. The cut is visible, like a projectionist's: the reel change lands
on a chunk boundary after the previous reel's last beat is represented. It costs
exactly one frame, because the beat that opens an appended reel gives up its
pin. For a 33-pin sheet that is one frame instead of seventeen.
