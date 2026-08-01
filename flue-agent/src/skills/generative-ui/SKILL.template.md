---
name: generative-ui
description: >-
  Write the openui-lang program for a `render_ui` call — the interactive card
  that asks the author to choose, pick an image, confirm a submit, or approve a
  plan. Load this WHENEVER you are about to call `render_ui`. Hard rules, true
  without reading the body: every `send` string is posted VERBATIM as the
  author's next chat message, so write it in their voice; media URLs come from a
  tool result and are never invented; a card that asks about SEVERAL subjects is
  ONE list with select 'one-per-group', never a single-select list per subject
  (the first tap ends the turn and strands the rest); a finished IMAGE is handed
  back as a MediaGrid card as soon as it is attached, so the author SEES it in
  the chat rather than being told which tab it is on; finished AUDIO comes back
  as an AudioList so they can PLAY it there, never as a bare /sound-media link;
  `render_ui` is the FINAL action of the turn and you STOP after it; and it is
  root-agent only — a subagent cannot pause, so it hands its question to you.
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

`OptionList`, `MediaGrid` and `AudioList` all take a `select` argument, and
getting it right is the difference between a card that works and one the author
has to fight.

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

- **`"one-per-group"`** — you are asking the SAME question about several
  subjects at once: a portrait per character, a take per line, a look per
  location. Give every item a `group` (the subject it belongs to); items sharing
  a group are drawn together under it and take exactly ONE pick between them, and
  the confirm button stays locked until every group has an answer. The message
  composes exactly like `"many"`, in group order, so item `send`s are noun
  phrases here too.

## Never ask two questions with two cards

This is the mistake `"one-per-group"` exists to prevent, and it is easy to walk
into: you render six portraits as **three separate `select: "one"` grids**, one
per character. The author picks Miles' portrait — that tap posts a message, your
turn resumes, and every other grid on that card is now inert. They answered one
third of the question and the card died.

**Two single-select lists must never appear on the same card.** One list, one
`group` per subject, one confirm:

```
root = Card([intro, casting])
intro = Text("Six portraits up — pick your favorite for each and I'll lock them in.", "body")
casting = MediaGrid([m1, m2, s1, s2, r1, r2], null, 2, "one-per-group", "Lock these portraits", "Lock them in")
m1 = MediaItem("<url>", "Miles 1", "Miles 1", null, false, "Miles Okonkwo")
m2 = MediaItem("<url>", "Miles 2", "Miles 2", null, false, "Miles Okonkwo")
s1 = MediaItem("<url>", "Saskia 1", "Saskia 1", null, false, "Saskia Voss")
s2 = MediaItem("<url>", "Saskia 2", "Saskia 2", null, false, "Saskia Voss")
r1 = MediaItem("<url>", "Rudy 1", "Rudy 1", null, false, "Rudy Tanaka")
r2 = MediaItem("<url>", "Rudy 2", "Rudy 2", null, false, "Rudy Tanaka")
```

Picking Miles 2, Saskia 1 and Rudy 2 posts *"Lock these portraits: Miles 2,
Saskia 1, Rudy 2"* — one message, the whole answer, and you act on all three.

The same shape covers a voice per character (`AudioList`) and a duration or
model per shot (`OptionList`). If the honest answer to your card is a LIST of
answers rather than one, it's `"one-per-group"`.

`group` is the LAST argument of `MediaItem` / `Option` / `AudioItem`, and
arguments are positional — so count the `null`s carefully (`MediaItem` is `src,
send, label, caption, selected, group`). `group: "Miles Okonkwo"` is not syntax
this parser has; a colon silently slides every prop one slot over.

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

The commonest miss is the **"What's next?" menu** you write after finishing a
step. Numbered next moves are a choice list like any other — and if the honest
answer is "do all three", that is `select: "many"`, not permission to leave it
as prose.

(The app does try to rescue an `A)`/`1.` list into a real card, but it is a
safety net with deliberately conservative heuristics — it will miss lists
mid-message, lists of more than six, lists followed by anything longer than a
one-line closing question, and anything it can't confidently tell apart from a
recap. Draw the card yourself.)

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
| choose one FOR EACH of several subjects | one list, `select: "one-per-group"` |
| SEE an image that just rendered | `MediaGrid` of `MediaItem`, no `send` |
| pick an image (reference, still, take, sheet) | `MediaGrid` of `MediaItem` |
| pick a portrait/look for EACH of several characters | `MediaGrid`, `select: "one-per-group"` |
| hear audio that just rendered (and maybe keep a take) | `AudioList` of `AudioItem` |
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

## Pictures come back visible

When an image finishes generating — a concept image you just attached with
`attach_visual_generation`, a character or location sheet, a storyboard still —
show it as a `MediaGrid` in your closing message. The author asked you to make a
picture; the picture is the answer, and it belongs next to the words.

Three ways of ending an image turn are wrong, and all three are easy to fall
into:

- **"It's on the Visual board now."** The author is in the chat, often on a
  phone. Naming the tab where the result lives is not delivery — it's homework.
- **A markdown `![](…)` link.** Renders as a bare thumbnail with none of the
  full-screen behavior, and the mobile client has to rescue it.
- **Nothing at all**, because the attach tool returned `ok:true` and that felt
  like completion. It isn't; the author still hasn't seen anything.

A card that just delivers the render is tiles with **no `send`** — tapping one
opens it full-screen (a native swipeable gallery on the phone, a lightbox on the
web) and nothing is posted. Add a `send` only when a real decision rides on the
picture ("Use this as Noah's sheet", "Iterate on this one"):

```
root = Card([intro, shots])
intro = Text("Noah Chen — first pass, Analog Glitch.", "body")
shots = MediaGrid([g1, g2], "Noah Chen")
g1 = MediaItem("<url from attach_visual_generation>", null, "Frayed, hollow-eyed")
g2 = MediaItem("<url from attach_visual_generation>", null, "Tighter on the scar")
```

One image is still a card — a single tile in a `MediaGrid` is the normal way to
hand back one generation, not an over-reaction.

Only use image URLs a tool returned (`attach_visual_generation`'s
`generation.url`, `list_library`, `get_visual_world`, `get_episode`, …). A job
that hasn't reached `completed` has no URL — don't card it, and don't card the
raw provider `result_url` when the attached `/visual-media/…` path exists.

## Sound comes back playable

When audio finishes rendering — a Seed Audio scene you just attached, radio
takes, a sound version flipping `ready` — show it as an `AudioList` so the
author can listen right there in the chat. A `/sound-media/...` URL pasted as a
markdown link is a dead end; the card is the player. Tapping a row plays or
pauses it inline and never sends anything.

Give a row a `send` only when there is a real decision riding on it ("Keep take
2", "Attach this to shot 12"); a card that just delivers the render is rows
with no `send` at all:

```
root = Card([intro, takes])
intro = Text("Both takes are in — the second leans harder into the rain.", "body")
takes = AudioList([t1, t2], "Rain on the stone bridge")
t1 = AudioItem("<url from attach_sound/list_sounds>", "Take 1 — steady drizzle", "Keep take 1", "v1 of the ambience bed", "12s")
t2 = AudioItem("<url from attach_sound/list_sounds>", "Take 2 — heavier rain", "Keep take 2", "v2, more low end", "12s")
```

Only use audio URLs a tool returned (`attach_sound`'s response, `list_sounds`,
`get_radio`, …). A version still `pending` has no URL — don't card it.

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
