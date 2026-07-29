---
name: destructive-approval
description: >-
  The two-phase confirm flow for the destructive tools — `save_shotlist` in
  shrinking "replace" mode, `stitch_cuts`, `restore_version`,
  `delete_sound_version`. Load this the moment a tool result comes back with
  `approved: false` and an `approvalToken`. Hard rules that hold even without
  reading the body: that result means NOTHING HAPPENED — never report it as
  done; draw ONE `render_ui` confirm card built only from the `summary` and
  `facts` in the result, inventing no count, name or id of your own; then END
  YOUR TURN and wait — do NOT call the tool again in the same turn, and do NOT
  call any other tool that would achieve the same effect; only re-call the tool
  with `approval_token` once the author's actual confirmation has arrived as a
  user message; a decline means STOP and offer an alternative, never retry, and
  never re-ask the same question with a friendlier card.
---

# Getting the author's go-ahead before you destroy something

A few tools do things the author cannot take back — or can only take back with
work. Those tools refuse to act on the first call. They park what you asked for,
hand you a token, and leave the decision with the author.

This exists because you cannot pause. There is no "wait for a human" inside a
tool call; the only place the author can speak is in the next user message. So
the confirmation IS a round-trip through the transcript, exactly like `render_ui`
questions — and the token is what makes it real rather than a promise you made
in prose.

## What gets gated

| Tool | When |
| --- | --- |
| `save_shotlist` | ONLY a `mode: "replace"` that would leave FEWER shots than the list already has |
| `stitch_cuts` | always |
| `restore_version` | always |
| `delete_sound_version` | always |

Everything else saves immediately, including the ordinary way a shot list gets
built: the first `replace`, every `append`, and a `replace` that keeps or grows
the count. **Do not invent gates.** If a tool did not hand you an
`approvalToken`, it already ran — asking "shall I?" about work that is done is
noise, and it teaches the author to tap past the cards that matter.

## The flow

**1. You call the tool normally.** No `approval_token` — you have not asked
anyone anything yet.

**2. It comes back gated.** The result carries `approved: false`,
`performed: false`, an `approvalToken`, a `summary`, and a `facts` object:

```json
{
  "approved": false,
  "performed": false,
  "approvalToken": "9f2c41ab77de",
  "op": "delete_sound_version",
  "summary": "Delete version 3 of \"Forest ambience\", leaving 2 version(s). The audio file is deleted and cannot be restored.",
  "facts": { "Track": "Forest ambience", "Version to delete": "3", "Versions after": "2" }
}
```

Nothing was written. Do not say "done", "deleted", "restored" or "stitched".

**3. Draw the card.** One short line of prose saying what will happen, then a
single `render_ui` call: a `KeyValue` of the `facts` exactly as given, and an
`Actions` block with the go-ahead as `tone: "danger"` plus a way out.

```
root = Card([warn, params, go])
warn = Callout("danger", "This deletes the audio file", "There is no way back to those bytes.")
params = KeyValue([{label: "Track", value: "Forest ambience"}, {label: "Version to delete", value: "3"}, {label: "Versions after", value: "2"}], "About to delete")
go = Actions([yes, no])
yes = Action("Delete it", "Yes, delete version 3 of Forest ambience", "primary", "danger")
no = Action("Keep it", "No, leave that version alone")
```

Then **stop**. Do not call another tool. Do not guess which way they will go.

**4. They answer, and the turn continues.** If their message confirms, call the
SAME tool again with `approval_token: "<the token>"`. The arguments you sent
first time are replayed from the approval, so you do not repeat them — for
`save_shotlist` that means sending the token and no `shots` at all.

## The rules that actually matter

**A gated result is not a result.** `performed: false` means the shot list still
has its old shots, the version is still there, the cut was never stitched. Every
sentence you write after it must be in the future tense.

**Every number on the card comes from `facts`.** Never a count you remember from
earlier in the conversation, never a name you reconstructed, never a "roughly".
An approval is only meaningful if the consequence shown was the true one — a card
that says "12 shots" when it is 40 has collected consent for something that never
existed. If a fact you want is not in the result, leave it off the card.

**One card, then silence.** Calling the tool again inside the same turn defeats
the entire mechanism: the token would be minted and spent without a human ever
seeing it. Wait for a real user message.

**A decline ends it.** If the author says no, hesitates, asks a question, or
answers something adjacent — the action does not happen. Say what you will do
instead (restore a different version, keep the longer shot list and edit the two
shots that were actually wrong, stitch after they have reviewed the picks). Do
NOT re-call the tool, do NOT re-ask with a softer card, and do NOT reach for a
different tool that gets to the same place.

**Tokens are single-use and short-lived.** A token is burned the moment it is
redeemed and expires after about half an hour. If a redemption fails, the action
did not happen: start over with a fresh gated call and a new card. Never invent a
token, never reuse one from earlier in the transcript.

**Ambiguity is a no.** "Sure, whatever you think" on a delete is not a decision
the author made — ask once, plainly, in prose. The gate is there precisely
because this is the class of action they will want to have been asked about.

## Where this sits next to the other confirmations

`render_ui` cards that confirm a *render* (credits, minutes) are courtesy — you
choose when to draw them, and the render tool will happily run without one.
These four are different: the tool itself will not act. Same card vocabulary,
different enforcement. Load **generative-ui** if you need the syntax.
