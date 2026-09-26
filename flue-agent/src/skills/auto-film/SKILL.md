---
name: auto-film
description: >-
  Make a whole Film from one prompt with Auto — "make me a film / a short /
  a two-minute mecha short about X". Steps: get_auto_status → make_film →
  navigate to "auto" → tell the author, then END THE TURN. Hard rules: the
  pipeline runs server-side for 20–40 minutes, so never poll get_film in a
  loop or call it twice in a turn; check back only when the author asks.
  Never say a Film is done unless get_film reports status "done". Pass the
  author's idea through as the prompt — do not write the script, shot list or
  cue sheet yourself; the job does. A refusal (allowance used up, paused,
  busy — one Film at a time) starts nothing: say why, do not retry. Stopped: offer retry_film (resumes at the failed step), only on a yes. Draw
  a render_ui confirm card ONLY when a job is "awaiting-confirm" (Auto is
  off), from its `confirm` fields, and call confirm_film / decline_film only
  on the author's actual answer. Do NOT use for a Director Series the author
  is building by hand (director-series) or for the episode pipeline.
---

# Auto — prompt to Film

Auto is the one-prompt path: the author says what they want, and a job on the
Worker makes the whole thing — Idea, World, character and location sheets,
shot list, cue sheet, the clips, the stills, the sitting, the score — and puts
the Film on the Auto surface (`/auto`). It is the SAME job the Auto prompt box
starts. You do not drive any of its stages; you start it and read it.

## 1. Can it start?

Call `get_auto_status` when you don't already know. If `available` is false,
say why (`reason`) and stop. If `allowance.remaining` is 0, say so and when it
resets (`resetsAt`) and stop — do not start the Film to "see what happens".

## 2. Start it

`make_film` with the author's idea as `prompt`, in their words. When they asked
for a length, pass it as `seconds` (three minutes → 180) — it wins over the
wording, like the length setting on the Auto input. A Film is 2:00–5:00 in 30s
steps; none stated means 2:00; a stated length rounds up; longer caps at 5:00 —
the result says `capped`, and then tell them.

The result is one of:

- `started: true` — go on to step 3. The Film is being made in a NEW project
  of its own (`projectId`, named after the story) — not in this chat's
  project, so nothing from this project's World leaks into it. Say so.
- `refused: true` — relay `message` in plain words. Nothing was made or
  counted. Do not retry, do not rephrase the prompt to get around it. `busy`
  means another of their Films is still being made (one at a time); offer to
  check on it (`get_film`) instead.

## 3. Send them to it, and stop

`navigate` to `"auto"` with a short reason, then one or two sentences: the
Film is being made on the Auto surface, it takes roughly 20–40 minutes, and
the cards there show each stage as it goes. Then END THE TURN. Nothing you do
in this turn makes it faster.

## Checking back

Only when the author asks ("how's my film?"), call `get_film` ONCE and report
from it:

- `running` — which stage it is on (the last step's `label` and `summary`).
- `done` — the Film is ready: `film.url`, its length, its title.
- `stopped` — which stage stopped and the reason; everything made so far is
  kept, and a stopped Film does not count against their allowance. Offer to
  retry it from that stage; on their yes, call `retry_film` with its id (see
  below).
- `declined` / `refused` — say so plainly.

Never describe a stage as finished that `get_film` doesn't show as `done`, and
never call a running job a finished Film.

## Auto off — the one confirm card

When the author's Auto toggle is off, the job stops once after the World,
before anything is paid for, with status `awaiting-confirm` and a `confirm`
object. Only then, draw ONE `render_ui` card from `confirm.summary` and
`confirm.plan` (length, reels, sheets, estimate) — no numbers of your own:

```
root = Card([about, go])
about = KeyValue([{label: "Length", value: "2:00"}, {label: "Estimate", value: "$12.40"}], "Before anything is paid for")
go = Actions([yes, no])
yes = Action("Make it", "Yes, make the Film", "primary")
no = Action("Not this one", "No, don't make this Film")
```

Then end the turn. On their yes, `confirm_film` with the job id; on a no,
`decline_film`. A `not-awaiting` answer means the job moved on — read
`get_film` before saying anything about it.

## Retry a stopped Film

`retry_film` re-runs a `stopped` Film from the step that stopped it — the
"Retry from <step>" button on its story page. Everything before that step is
kept and not paid for again; the Film's Series is repaired first. The Worker
finds the Film's own project from its id. Only on the author's ask. It refuses
(never queues) when another of their Films is being made, a newer one has run
in that project since, Auto is
paused or the allowance is used up — relay `message` and stop. After a retry,
say which step it resumed at (`resumedAt.label`) and END THE TURN.

`set_auto` flips the toggle, only when the author asks.
