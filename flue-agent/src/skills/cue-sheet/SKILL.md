---
name: cue-sheet
description: >-
  Write and fix the beats of a Director Series' cue sheet — the clauses that stop
  one beat inventing three shots, which frame a beat is actually pinned to, how
  beats are spaced, and what to do when a shot morphs, a design drifts, or extra
  scenes appear that nobody asked for. Use when writing beat prompts, when a
  sitting came back with drift or with scenes the sheet never contained, when a
  spoken line "does not land" on its beat, when a Series has target audio, or
  when a session was refused at configure and you need the spacing rules. The
  single most important fact here — a beat's own pinned frame is its OPENING
  frame, not its closing one — is the one that is easiest to get backwards and
  most expensive when you do. Do NOT use for the Shot list tab, which is a
  different thing entirely.
---

# Writing the beats

A beat is one second on the film's own clock plus what happens there. Its
`prompt` runs **forward** from that second until the next beat that carries a
prompt. Its offset is its identity: writing the same offset twice edits one
beat, it does not add two.

## Read this first: which frame a beat is pinned to

The endpoint's own words: *text and audio placed here **start** at this second;
an end image here is the exact final frame **at** this second.*

So `endImageUrl` on a beat pins that beat's **opening** frame. The frame a beat
must ARRIVE at is the pin on the **next** beat.

This is easy to get backwards and expensive when you do: a clause telling a beat
to "arrive at its pinned end frame" tells every beat to end on the frame it
began on. That wording was in the source repo for an hour and made drift worse,
not better.

**Never name "this beat's pinned frame" as the destination.** The beat's own
description already says what to end on. Defer to it.

## Sections, not one string

Write a beat's prompt as sections keyed by purpose:

| Key | What goes in it |
|---|---|
| `range` | The window this beat covers, written out — "Seconds 24–32 of the film." |
| `style` | How it is shot: the camera, the lens, the hold |
| `scene` | What is in frame — the place, the action, the dialogue |
| `score` | What the music does here |

The Series' `prompts.sections` list decides which are actually SENT. That is the
whole point: dropping the score cues from a finished piece is an edit to one
list, not to forty-eight beats, and the beats keep them for next time.

`range` is not decoration. A beat that does not know how long it has is a beat
that fills the time by inventing shots.

## The clauses that hold a shot together

Append these after whatever the beat describes. They are in the wording that
worked.

**When the shot keeps changing — `[FIXED SHOT]`:**

> The camera is fixed for this whole beat: one shot, one setup, one framing,
> from the first frame to the last. Do not change the shot — no cut, no new
> angle, no reverse, no push-in or pull-out to a different framing, no reframe.
> The only camera motion allowed is a slow drift that keeps this same framing.

**When extra scenes appear — `[HOLD ONE SHOT]`:**

> This beat OPENS on the frame pinned at its own offset and is one continuous
> shot from there: no second cut, no new angle, no insert, no cutaway, and
> nothing outside this frame — no other place, no other character, no other
> machine, and nothing that turns into something else. Every design is already
> established; carry it unchanged. Arrive on the closing frame described above.
> If the action finishes before the beat does, invent nothing to fill the time:
> hold this shot with only small ambient motion — drifting vapour, flickering
> lights, someone breathing, a slow camera drift — and stay on that closing
> frame until the next beat begins.

Both halves earn their place. Beats are cut to the film's events, **not to how
long an action takes**, so most beats finish early by construction. A prompt
that only says "no cuts" has described what not to do and left the model
seconds to fill with no legitimate way to fill them — so it invents a shot.

And naming the allowed motions matters in both clauses: a bare "hold" or "fixed
camera" reads as *freeze*, and a frozen frame is a worse outcome than a
drifting one.

## Keep the clause shorter than the shot

The first version of these ran to two blocks of ~1,400 characters on top of a
~600-character description, identical on every beat — about 10 KB of repeated
boilerplate inside one script. What each beat was *about* had become the
minority of its own prompt, and adherence got **worse**.

Aim for the scene description to be at least as long as the clause. If drift
persists, put the clause only on the beats that actually misbehave rather than
carpeting all of them.

## Spacing

| Rule | Value |
|---|---|
| Two beats no closer than | 3s |
| The OPENING beat gets at least | 5s |
| Two pinned frames no closer than | 3s |
| Beats in one reel | ≤ 64 |
| Beats pinning a frame | ≤ 16 |
| Beats carrying audio | ≤ 8 |

Film is generated in **chunks of 5–15 seconds**, 10 by default. A beat is not a
chunk — the Director fits its chunks around the beats it is given — so a
4-second beat is ordinary. 5–15 is the grain of the film, not the legal length
of a beat.

The last beat sets the run length: `offset + 10s` when it carries a prompt, the
offset itself when it only pins a frame.

## When a Series has target audio

The audio is what the Director generates **against**, not a layer over the film.
So the render is the truth and the cue sheet is the thing that moves.

A rendered audio track does **not** honour the offsets its prompt asked for. The
audio prompt and the cue sheet can be written with identical numbers and still
disagree by seconds. If a line "does not land", do not rewrite the beat — move
it. And move it **2–3 seconds earlier than the line**, because a beat that
starts exactly as the voice does has no lead-in, and the shot morphs around the
line trying to catch up.

## When it still drifts

| Symptom | Cause | Fix |
|---|---|---|
| A line "doesn't land"; the shot morphs around it | No lead-in — the voice starts as the beat does | Move the beat 2–3s earlier |
| Extra scenes appear mid-beat | The action ended early and nothing said holding was allowed | `[HOLD ONE SHOT]` |
| Designs drift inside one beat | The prompt lets it cut to new shots | `[HOLD ONE SHOT]` |
| The framing slides — a wide becomes a medium | The hold forbids cuts, not camera moves | `[FIXED SHOT]`, ahead of the hold |
| One specific thing keeps transforming | Generic negatives on the opening prompt do not bite | A `[LOCK]` on that beat, naming what actually happened |
| Picture lands after the sound | Offsets taken from the audio PROMPT, not the render | Re-measure the render; it is the truth |
| A beat ends on the frame it started on | A clause naming "its pinned end frame" as the destination | Delete that clause — see the top of this file |
| The session dies at `configure`, no frames | Two beats under 3s apart, a 17th pin, a 9th audio beat | `preflight_sitting` before you spend anything |
| The last beats never film | The session cap is below the film target | Shorten the script, or cut it into reels |

## Editing, not rewriting

`save_cue_sheet` with `mode: "merge"` matches by offset and leaves every other
beat alone. Use it. `replace` overwrites the whole sheet and is only right when
writing one from scratch.

A `replace` that leaves FEWER beats than the sheet already has is **gated**: the
call performs nothing and returns an `approvalToken`, and you draw the confirm
card before calling again with it (the **destructive-approval** skill). That one
shape is the real accident — the sheet gets rewritten from a partial view and
silently loses the beats nobody mentioned, along with the frames pinned to them.
Nothing else here is gated, because a gate that fires on every save is a gate
the author learns to tap through.
