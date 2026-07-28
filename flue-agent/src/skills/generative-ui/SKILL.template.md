---
name: generative-ui
description: >-
  Write the openui-lang program for a `render_ui` call — the interactive card
  that asks the author to choose, pick a reference image, confirm a submit, or
  approve a plan. Load this WHENEVER you are about to call `render_ui` and are
  not certain of the syntax. Hard rules that hold even without reading the body:
  every interactive element's `send` string is posted VERBATIM as the author's
  next chat message, so write it in their voice; image URLs must come from a
  tool result and are never invented; reference/still/take picks go through
  MediaGrid, never markdown image links; `render_ui` is the FINAL action of the
  turn and you STOP after it; and it is root-agent only — a subagent cannot
  pause, so it must hand its question back to you instead.
---

# Drawing an interactive card

`render_ui` renders one small card in the chat, right under the message you just
wrote. It is how you ask the author anything: which reference, which model, go
or no-go, is this plan right.

## The two rules that matter most

**1. `send` is the author's next message.** There is no separate answer channel —
tapping an option literally posts its `send` string as a user turn, and your next
turn continues from there. So write every `send` the way the AUTHOR would say it:

- ✅ `Option("Seedance 1.0", "Render it with Seedance", …)`
- ❌ `Option("Seedance 1.0", "User selected option 1", …)`
- ❌ `Option("Seedance 1.0", "Proceed with seedance_1_0 model", …)`

**2. Then STOP.** `render_ui` is the FINAL action of your turn. Do not answer on
the author's behalf, do not call another tool after it, do not narrate what
they'll probably pick. Their tap arrives as the next user message.

## One of these, or several?

`OptionList` and `MediaGrid` both take a `select` argument, and getting it right
is the difference between a card that works and one the author has to fight.

- **`"one"` (default)** — the choices are mutually exclusive. A tap picks that
  one and sends immediately. Each item's `send` is a whole sentence:
  `Option("Seedance 1.0", "Render it with Seedance")`.
- **`"many"`** — the author may legitimately want SEVERAL. Taps toggle a
  checkbox, nothing sends until they hit the confirm button, and the message is
  composed as `"<list send>: <item send>, <item send>"`. So in a `"many"` list
  each item's `send` is a NOUN PHRASE, and the list's own `send` is the lead:

```
root = Card([intro, chars])
intro = Text("These speakers look like real characters rather than bit-parts.", "body")
chars = OptionList([c1, c2, c3], "Add to the World", null, "many", "Add these characters to the World", "Add selected")
c1 = Option("Shopkeeper Miles", "Shopkeeper Miles", "Buys the burner — shots 44–46")
c2 = Option("Vera", "Vera", "Three lines across scene 2")
c3 = Option("Radio voice", "Radio voice", "One line, off-screen — probably a bit-part")
```

Picking Miles and Vera posts *"Add these characters to the World: Shopkeeper
Miles, Vera"*. Ask yourself before every list: **could the honest answer be "those
two"?** If yes, it's `"many"`.

## Images open full-screen

Tapping a `MediaItem`'s thumbnail does NOT pick it — it opens the image
full-screen (a native swipeable gallery on the phone) so the author can actually
look at it. Picking is a separate explicit control on the tile. You don't have to
do anything to get this, but do keep it in mind: a `MediaGrid` is a *viewer* as
well as a picker, so it's the right component even when there is only one image
worth showing off.

## Never enumerate choices in prose

If a reply of yours ends like this, you have failed to draw a card:

```
Which do you want?
A) Seedance 1.0 — fast, bakes audio
B) Veo 3.1 — slower, best for dialogue
```

The author cannot tap a paragraph. The moment you are about to list
alternatives — `A) B) C)`, `1. 2. 3.`, or a bulleted set of options — stop and
call `render_ui` with an `OptionList` instead. The prose above it should say
*why the choice matters*, not repeat what the options are.

(The app does try to rescue a trailing `A)`/`1.` list into a real card, but it
is a safety net with deliberately conservative heuristics — it will miss lists
mid-message, lists of more than six, and anything it can't confidently tell
apart from a recap. Draw the card yourself.)

## Say it in prose first, then draw the card

The card is the *decision*, not the explanation. Your message above it does the
talking ("The clearing shows up in three shots, so the reference locks the whole
scene — here are the candidates."), and the card holds only what they act on.
A card that repeats your paragraph reads as a stutter.

## Which component

| The author must… | Use |
| --- | --- |
| choose ONE of 2–6 things | `OptionList`, `select: "one"` |
| choose SEVERAL of a list | `OptionList`, `select: "many"` |
| pick an image (reference, still, take, sheet) | `MediaGrid` of `MediaItem` |
| say yes or no to one proposal | `Recommendation` (hero + one CTA) |
| weigh 2–3 options on the same attributes | `Compare` of `Column` |
| approve a submit before it costs credits | `KeyValue` (the params) + `Actions` |
| see a long pipeline before it runs | `Steps` |
| just answer a plain question | `Actions` of `Action` |

`OptionList` is the default — reach for it first. `Chips` is for cheap
side-quests offered *alongside* the real choice, never as the choice itself.

For a **free-text answer** (a name, a prompt rewrite, an open question), do not
call `render_ui` at all: just ask in your message and stop. The composer is
already there.

## Never invent anything

Every url, id, count and duration in a card comes from a tool result you
actually received. This library's built-in guidance tells you to generate
"realistic/plausible data" when you don't have it — **that advice does not apply
here.** A plausible-looking `/library/clearing-dawn.png` that doesn't exist
renders as a broken thumbnail and sends the author chasing a file that was never
there. If you don't have the value, omit the prop; if you don't have the
thumbnails, call `list_library` / `get_visual_world` / `get_episode` first.

## Reference picks

The location/prop/character sheet flow requires a USER-PICKED reference image
(see `sheet-generation`). That pick is a `MediaGrid` of the candidates plus one
`Option` for uploading — the app turns an option whose `send` mentions uploading
or attaching a reference into a media-picker button:

```
root = Card([intro, refs, upload])
intro = Text("Pick the reference for the clearing sheet.", "body")
refs = MediaGrid([r1, r2, r3], "From the library", 3)
r1 = MediaItem("<url from list_library>", "Use the dawn clearing reference", "Dawn")
r2 = MediaItem("<url from list_library>", "Use the dusk clearing reference", "Dusk")
r3 = MediaItem("<url from list_library>", "Use the foggy clearing reference", "Fog")
upload = Actions([pick])
pick = Action("Upload a reference image", "I'll attach a reference image")
```

An image ATTACHED to the requesting message already IS the pick — use it and
don't draw this card at all.

## Root agent only

A subagent runs to completion inside one tool call and cannot pause for a human.
Never call `render_ui` from one: have it return the question to you, and ask it
here.

## Syntax

<!-- GENERATED:COMPONENTS -->
