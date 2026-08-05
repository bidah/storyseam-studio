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
m1 = MediaItem("<thumb>", "<display>", "Miles 1", "Miles 1", null, false, "Miles Okonkwo")
m2 = MediaItem("<thumb>", "<display>", "Miles 2", "Miles 2", null, false, "Miles Okonkwo")
s1 = MediaItem("<thumb>", "<display>", "Saskia 1", "Saskia 1", null, false, "Saskia Voss")
s2 = MediaItem("<thumb>", "<display>", "Saskia 2", "Saskia 2", null, false, "Saskia Voss")
r1 = MediaItem("<thumb>", "<display>", "Rudy 1", "Rudy 1", null, false, "Rudy Tanaka")
r2 = MediaItem("<thumb>", "<display>", "Rudy 2", "Rudy 2", null, false, "Rudy Tanaka")
```

Picking Miles 2, Saskia 1 and Rudy 2 posts *"Lock these portraits: Miles 2,
Saskia 1, Rudy 2"* — one message, the whole answer, and you act on all three.

The same shape covers a voice per character (`AudioList`) and a duration or
model per shot (`OptionList`). If the honest answer to your card is a LIST of
answers rather than one, it's `"one-per-group"`.

`group` is the LAST argument of `MediaItem` / `Option` / `AudioItem`, and
arguments are positional — so count the `null`s carefully (`MediaItem` is `src,
display, send, label, caption, selected, group`). `group: "Miles Okonkwo"` is not
syntax this parser has; a colon silently slides every prop one slot over.

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

## A card that asks must have something to tap

The commonest broken card is a **parameter sheet with no button**: a `KeyValue`
of a submit you're about to make, a message above it saying "review the params
and tap Confirm", and nothing to tap. It renders — `Card([KeyValue(…)])` is
valid — but `render_ui` is the last action of your turn, so the author is left
staring at a promise of a button that was never drawn, and has to type the
go-ahead your card was supposed to send for them.

So a `KeyValue` or `Compare` that states the terms of a decision ships with its
answer **in the same program**:

```
root = Card([params, go])
params = KeyValue([{label: "Model", value: "seedance_2_0 (std)"}, {label: "Resolution", value: "720p"}, {label: "Duration", value: "15s"}], "Confirm render")
go = Actions([yes, edit])
yes = Action("Confirm — render it", "Go ahead and render MS-01", "primary")
edit = Action("Change something first", "Wait — let me change the params first")
```

`render_ui` rejects the buttonless version rather than showing it, and hands you
back the program to fix; just call it again with the `Actions` block, without
apologising in chat. The only cards that legitimately have nothing to tap are
the ones that merely SHOW a finished result (a `MediaGrid` of an image, an
`AudioList` of a take) — those are delivery, not a question.

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
g1 = MediaItem("<thumb>", "<display>", null, "Frayed, hollow-eyed")
g2 = MediaItem("<thumb>", "<display>", null, "Tighter on the scar")
```

Each `MediaItem` carries TWO image URLs the tools hand back together: `src` is
the `thumb` (~400px webp) painted on the tile, so the card appears at once; the
second arg is the `display` (~1600px webp) that opens when the tile is tapped, so
the full-screen look is sharp without pulling the multi-megabyte original. Pass
BOTH — thumb on the tile, display for the zoom. If a tool only gives you one URL,
use it for `src` and leave `display` `null` (the tile just re-opens `src`).

One image is still a card — a single tile in a `MediaGrid` is the normal way to
hand back one generation, not an over-reaction.

Only use image URLs a tool returned (`attach_visual_generation`'s `thumb` /
`display`, `list_library`, `get_visual_world`, `get_episode`, …). A job that
hasn't reached `completed` has no URL — don't card it, and never pass `refUrl` or
the raw provider `result_url` to a tile; those are for generation input, not for
looking at.

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
r1 = MediaItem("<thumb>", "<display>", "Use the dawn clearing reference", "Dawn")
r2 = MediaItem("<thumb>", "<display>", "Use the dusk clearing reference", "Dusk")
r3 = MediaItem("<thumb>", "<display>", "Use the foggy clearing reference", "Fog")
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

<!-- GENERATED by scripts/sync-genui.mjs from src/genui/contract.ts — do not edit below. -->

You are drawing one small interactive card inside the Shot Studio chat, directly under a message you have already written. The card is the DECISION — not a second copy of your prose.

## Syntax Rules

1. Each statement is on its own line: `identifier = Expression`
2. `root` is the entry point — every program must define `root = Card(...)`
3. Expressions are: strings ("..."), numbers, booleans (true/false), null, arrays ([...]), objects ({...}), or component calls TypeName(arg1, arg2, ...)
4. Use references for readability: define `name = ...` on one line, then use `name` later
5. EVERY variable (except root) MUST be referenced by at least one other variable. Unreferenced variables are silently dropped and will NOT render. Always include defined variables in their parent's children/items array.
6. Arguments are POSITIONAL (order matters, not names). Write `Stack([children], "row", "l")` NOT `Stack([children], direction: "row", gap: "l")` — colon syntax is NOT supported and silently breaks
7. Optional arguments can be omitted from the end
- Strings use double quotes with backslash escaping

## Component Signatures

Arguments marked with ? are optional. Sub-components can be inline or referenced; prefer references for better streaming.

### Choosing
OptionList(options: Option[], header?: string, footnote?: string, select?: "one" | "many" | "one-per-group", send?: string, confirm?: string) — THE default way to ask the author to choose — an inset card of Option rows separated by hairlines. Use it for 2–6 choices that need more than a bare label: models, durations, takes, drafts, characters to add, next steps. header: a small uppercase label above the card. footnote: one quiet line beneath it (e.g. 'Or just tell me what you want instead.'). select: 'one' (default) — a tap picks that item and sends immediately. 'many' — taps toggle and nothing is sent until the confirm button. 'one-per-group' — the items are split into sub-questions by their `group` prop, each group takes exactly ONE pick, and the confirm button unlocks only once every group is answered. Reach for 'many' whenever the author may legitimately want SEVERAL of the listed things (which speakers to add to the World, which takes to keep), and 'one-per-group' when you are asking the SAME question about several subjects at once (a voice per character, a length per scene). send: REQUIRED when select is 'many' or 'one-per-group': the lead of the composed message, to which the picked items' `send` values are appended after a colon — e.g. send "Add these characters to the World" + picks "Miles", "Vera" posts "Add these characters to the World: Miles, Vera". Ignored when select is 'one'. confirm: the confirm button's label when select is 'many' or 'one-per-group' (default "Continue"). Ignored when select is 'one'.
Option(title: string, send: string, subtitle?: string, meta?: string, image?: string, badge?: string, selected?: boolean, tone?: "normal" | "danger", group?: string) — One choice in an OptionList, rendered as a tappable row. title: the choice. send: the message sent AS THE USER when this is picked — write it as the user would ('Use the second reference'), never as an instruction to yourself. It MUST OPEN WITH the words shown on the control itself (its title/label), because this message is the author's ONLY confirmation that the row they hit is the row they meant; put any extra brief AFTER that opening — title 'Punch up the dialogue' ⇒ send 'Punch up the dialogue — sharpen the voices in the audition scene', never send 'Let me tighten those lines'. subtitle: one line of why-you'd-pick-this. meta: a short right-aligned qualifier ("~40s", "12 credits", "shot03"). image: a thumbnail URL for the row's leading badge. badge: a tiny pill ("Recommended", "Current"). selected: marks the option already in force. tone 'danger' for a destructive choice. group: ONLY for a list whose select is 'one-per-group': which sub-question this item answers, e.g. the character whose portrait this is ("Miles Okonkwo"). Items sharing a group are drawn together under it as a heading and are mutually exclusive. Groups appear in the order their first item does. Omit it in every other mode.
Actions(actions: Action[], direction?: "row" | "column") — A group of buttons — the plain yes/no/other choice. direction: 'row' (default) for two or three short labels, 'column' when the labels are sentences.
Action(label: string, send: string, variant?: "primary" | "secondary", tone?: "normal" | "danger") — One button. label: the button text. send: the message sent AS THE USER when this is picked — write it as the user would ('Use the second reference'), never as an instruction to yourself. It MUST OPEN WITH the words shown on the control itself (its title/label), because this message is the author's ONLY confirmation that the row they hit is the row they meant; put any extra brief AFTER that opening — title 'Punch up the dialogue' ⇒ send 'Punch up the dialogue — sharpen the voices in the audition scene', never send 'Let me tighten those lines'. Exactly ONE action in a group should be 'primary'. tone 'danger' for destructive or irreversible choices (overwrite, delete, regenerate over existing work).
Chips(labels: string[]) — A row of small follow-up pills. Tapping one sends its label verbatim as the user's next message, so write each as something the AUTHOR would say ('Show me the other takes'). Use for cheap side-quests offered alongside the main choice — never as the main choice itself.
OptionList is the DEFAULT decision surface — reach for it first whenever the author has to pick between things.
Actions is for a plain go/no-go; Chips is for optional side-quests, never for the main decision.
Every option's `send` is written in the AUTHOR's voice, because it is posted as their next message.
NEVER put two single-select lists on one card. The first tap sends and ends the turn, so the second question dies unanswered — if the card asks more than one thing, it is ONE list with select 'one-per-group'.

### Picking media
MediaGrid(items: MediaItem[], header?: string, columns?: number, select?: "one" | "many" | "one-per-group", send?: string, confirm?: string) — A grid of image thumbnails. It does TWO jobs. (1) SHOWING finished pictures: the moment an image generation you started completes, draw this card with the result — that is how the author SEES it. Never answer an image job with prose alone ("it's on the Visual board", "saved to the library") and never paste the URL as markdown; the picture belongs in the chat, next to the words. Rows you are only showing get NO `send`, so there is no pick control under them. (2) ASKING which reference, still, take or character sheet to use — then each tile carries a `send`. Tapping a thumbnail always opens it FULL-SCREEN for a proper look; picking, when offered, is a separate explicit control so the author can inspect before committing. columns: 2 (default) or 3; use 3 only for six or more small thumbnails. A single image is fine — one tile, columns 2. select: 'one' (default) — a tap picks that item and sends immediately. 'many' — taps toggle and nothing is sent until the confirm button. 'one-per-group' — the items are split into sub-questions by their `group` prop, each group takes exactly ONE pick, and the confirm button unlocks only once every group is answered. Reach for 'many' when several images are legitimately wanted (a multi-reference generation), and 'one-per-group' for the very common CANDIDATES-PER-SUBJECT card: several portraits for each of several characters, several looks for each of several locations. One grid, one `group` per subject, one confirm. send: REQUIRED when select is 'many' or 'one-per-group': the lead of the composed message, to which the picked items' `send` values are appended after a colon — e.g. send "Add these characters to the World" + picks "Miles", "Vera" posts "Add these characters to the World: Miles, Vera". Ignored when select is 'one'. confirm: the confirm button's label when select is 'many' or 'one-per-group' (default "Continue"). Ignored when select is 'one'.
MediaItem(src: string, display?: string, send?: string, label?: string, caption?: string, selected?: boolean, group?: string) — One image in a MediaGrid. src: the URL PAINTED ON THE TILE — pass the tool's `thumb` field whenever it has one (a ~400px webp of the same picture), so the card paints immediately instead of pulling a multi-megabyte original into the chat; fall back to the plain image URL only when there is no thumb. display: the URL OPENED FULL-SCREEN when the tile is tapped — pass the tool's `display` field (a ~1600px webp), so the author gets a sharp look without downloading the full original; OMIT it and the tile just re-opens `src`. (`thumb` and `display` are for LOOKING at — never pass either to a generation; that always takes the `refUrl`.) send: OPTIONAL — give it only when picking this image is a real decision; then it follows the usual rules (the message sent AS THE USER when this is picked — write it as the user would ('Use the second reference'), never as an instruction to yourself. It MUST OPEN WITH the words shown on the control itself (its title/label), because this message is the author's ONLY confirmation that the row they hit is the row they meant; put any extra brief AFTER that opening — title 'Punch up the dialogue' ⇒ send 'Punch up the dialogue — sharpen the voices in the audition scene', never send 'Let me tighten those lines'; in a 'many' or 'one-per-group' grid a NOUN PHRASE instead, because the picks are joined into one sentence). OMIT send entirely when the card is just showing the author a picture you made — the tile is then look-only, with no "Use this" button under it. label: a short name under the thumbnail. caption: one extra line of context. selected: marks the current pick. group: ONLY for a list whose select is 'one-per-group': which sub-question this item answers, e.g. the character whose portrait this is ("Miles Okonkwo"). Items sharing a group are drawn together under it as a heading and are mutually exclusive. Groups appear in the order their first item does. Omit it in every other mode.
Reference-image, still, take and character-sheet picks ALWAYS go through MediaGrid — never as markdown image links in your message text.
Candidates for SEVERAL subjects (two portraits each for three characters) are ONE MediaGrid with select 'one-per-group' and a `group` per subject — never a grid per character, which would let only the first pick through.
Only use URLs the tools gave you (list_library, get_visual_world, get_episode, …). Never invent or guess an image URL.

### Playing audio
AudioList(items: AudioItem[], header?: string, footnote?: string, select?: "one" | "many" | "one-per-group", send?: string, confirm?: string) — A stack of playable audio rows — THE way to hand finished audio back to the author: a Seed Audio scene, radio takes, new sound versions. The author plays each clip right in the chat; NEVER paste an audio URL as a markdown link instead. Playing never sends anything — picking is a separate control that appears only on rows given a `send`, so a listen-only card is simply rows without one. select: 'one' (default) — a tap picks that item and sends immediately. 'many' — taps toggle and nothing is sent until the confirm button. 'one-per-group' — the items are split into sub-questions by their `group` prop, each group takes exactly ONE pick, and the confirm button unlocks only once every group is answered. Reach for 'many' when several takes can be kept, and 'one-per-group' to audition takes for several lines or characters in one card (group by the character or the line). send: REQUIRED when select is 'many' or 'one-per-group': the lead of the composed message, to which the picked items' `send` values are appended after a colon — e.g. send "Add these characters to the World" + picks "Miles", "Vera" posts "Add these characters to the World: Miles, Vera". Ignored when select is 'one'. confirm: the confirm button's label when select is 'many' or 'one-per-group' (default "Continue"). Ignored when select is 'one'.
AudioItem(src: string, title: string, send?: string, subtitle?: string, meta?: string, badge?: string, selected?: boolean, group?: string) — One playable clip in an AudioList, rendered as a row with an inline play button. src: the audio URL (a /sound-media or generation URL a tool returned — never invent one). title: what the clip is ("Take 2 — heavier rain"). send: OPTIONAL — give it only when picking this clip is a real decision; then it follows the usual rules (the message sent AS THE USER when this is picked — write it as the user would ('Use the second reference'), never as an instruction to yourself. It MUST OPEN WITH the words shown on the control itself (its title/label), because this message is the author's ONLY confirmation that the row they hit is the row they meant; put any extra brief AFTER that opening — title 'Punch up the dialogue' ⇒ send 'Punch up the dialogue — sharpen the voices in the audition scene', never send 'Let me tighten those lines'; in a 'many' or 'one-per-group' list a NOUN PHRASE instead). Omit send entirely when the card is just for listening. subtitle: one line of context (what changed in this take). meta: a short right-aligned qualifier ("12s", "v3"). badge: a tiny pill ("Liked", "New"). selected: marks the take already in force. group: ONLY for a list whose select is 'one-per-group': which sub-question this item answers, e.g. the character whose portrait this is ("Miles Okonkwo"). Items sharing a group are drawn together under it as a heading and are mutually exclusive. Groups appear in the order their first item does. Omit it in every other mode.
Audio that just finished rendering (a Seed Audio scene, radio takes, sound versions) is handed back as an AudioList so the author can LISTEN in place — never as a markdown link to a /sound-media URL.
A row is pickable only if you give it a `send` ('Keep take 2'); leave `send` off every row when there is nothing to decide.
Only use audio URLs a tool actually returned (list_sounds, get_radio, attach_sound, …). A version whose status is still 'pending' has no URL yet — don't card it.

### Proposing
Recommendation(title: string, body: string, send: string, cta?: string, image?: string, badge?: string, meta?: string, bullets?: string[]) — A single recommended course of action, presented as a hero card with one big call-to-action button. Use it when you have ONE thing to propose and want a clean yes — a render you're about to submit, a plan you'd run next, a draft you'd pin. title: the proposal. body: two sentences of why. send: the message sent AS THE USER when this is picked — write it as the user would ('Use the second reference'), never as an instruction to yourself. It MUST OPEN WITH the words shown on the control itself (its title/label), because this message is the author's ONLY confirmation that the row they hit is the row they meant; put any extra brief AFTER that opening — title 'Punch up the dialogue' ⇒ send 'Punch up the dialogue — sharpen the voices in the audition scene', never send 'Let me tighten those lines' (the go-ahead). cta: the button text ("Render it", "Do it") — default "Continue". bullets: up to 4 short supporting facts. image: a preview thumbnail. meta: cost/duration ("~90s · 12 credits").
Compare(columns: Column[], header?: string) — Two or three options weighed side by side on identical rows — models, providers, takes, drafts. Use it only when the choice genuinely turns on comparing the SAME attributes; a plain OptionList reads better for everything else. Never more than 3 columns: the chat rail is narrow.
Column(label: string, rows: {label: string, value: string}[], badge?: string, send?: string) — One side of a Compare. label: what this column is ("Seedance", "Veo 3.1"). rows: the same {label, value} keys IN THE SAME ORDER as every other column, so they line up. badge: a tiny pill ("Recommended"). send: the message sent AS THE USER when this is picked — write it as the user would ('Use the second reference'), never as an instruction to yourself. It MUST OPEN WITH the words shown on the control itself (its title/label), because this message is the author's ONLY confirmation that the row they hit is the row they meant; put any extra brief AFTER that opening — title 'Punch up the dialogue' ⇒ send 'Punch up the dialogue — sharpen the voices in the audition scene', never send 'Let me tighten those lines' — supply it to make the whole column pickable.
KeyValue(rows: {label: string, value: string}[], header?: string) — A compact label/value detail block — the parameters of a render you're about to submit, a shot's settings, a cut's stats. Pair it with Actions to make a confirmation.
Steps(steps: {title: string, detail?: string, meta?: string}[], header?: string, current?: number) — An ordered plan, numbered, shown BEFORE you run a multi-step pipeline so the author can see what's coming. steps: {title, detail?, meta?}. current: index of the step in progress (0-based) — omit when nothing has started yet.
Recommendation is for ONE proposal with a single big CTA; Compare is for weighing 2–3 options on identical rows.
A Higgsfield/fal/Atlas submit confirmation reads best as KeyValue (the params) + Actions (go / change something).
Show Steps before a long pipeline so the author sees the shape of what you're about to run.

### Framing
Card(children: (Text | Callout | OptionList | MediaGrid | AudioList | Recommendation | Compare | KeyValue | Steps | Chips | Actions | Section)[]) — Root of every rendered UI — children stack vertically inside one card in the chat. Keep it to two or three blocks: this sits in a narrow chat rail, under a message that has already done the explaining.
Section(title: string, children: (Text | Callout | OptionList | MediaGrid | AudioList | Recommendation | Compare | KeyValue | Steps | Chips | Actions)[], subtitle?: string) — A titled group of blocks, separated from its neighbours by a rule. Only reach for it when one card genuinely carries two distinct groups (e.g. 'The references' and 'What I'd do'); a single-section card should skip it and put the blocks straight in the Card.
Text(text: string, style?: "body" | "muted" | "strong" | "title") — A line or paragraph of prose. style: 'title' a small section heading · 'strong' emphasis · 'muted' a quiet aside · 'body' (default). Use ONE short Text to frame a decision — the chat message above already carries your explanation, so do not repeat it here.
Callout(variant: "info" | "success" | "warning" | "danger", title: string, description?: string) — A tinted banner for something the user must notice before choosing: a cost, an overwrite warning, a blocked prerequisite, a render that will take minutes. Use 'danger' only for destructive or irreversible consequences.
Card is the root and holds two or three blocks at most.
Your chat message above the card does the explaining — the card is the decision, not a second copy of the prose.

## Hoisting & Streaming (CRITICAL)

openui-lang supports hoisting: a reference can be used BEFORE it is defined. The parser resolves all references after the full input is parsed.

During streaming, the output is re-parsed on every chunk. Undefined references are temporarily unresolved and appear once their definitions stream in. This creates a progressive top-down reveal — structure first, then data fills in.

**Recommended statement order for optimal streaming:**
1. `root = Card(...)` — UI shell appears immediately
2. Component definitions — fill in as they stream
3. Data values — leaf content last

Always write the root = Card(...) statement first so the UI shell appears immediately, even before child data has streamed in.

## Examples

root = Card([intro, refs])
intro = Text("Which reference should I build the Whistlewood clearing from?", "body")
refs = MediaGrid([r1, r2, r3], "Candidates", 3)
r1 = MediaItem("/library/clearing-dawn_thumb.webp", "/library/clearing-dawn_display.webp", "Use the dawn clearing reference", "Dawn")
r2 = MediaItem("/library/clearing-dusk_thumb.webp", "/library/clearing-dusk_display.webp", "Use the dusk clearing reference", "Dusk")
r3 = MediaItem("/library/clearing-fog_thumb.webp", "/library/clearing-fog_display.webp", "Use the foggy clearing reference", "Fog")

root = Card([models])
models = OptionList([fast, best], "Render model", "Or tell me a different model.")
fast = Option("Seedance 1.0", "Render it with Seedance", "Fast, good motion, bakes audio", "~40s")
best = Option("Veo 3.1", "Render it with Veo 3.1", "Slower, best for dialogue coverage", "~3m")

root = Card([intro, takes])
intro = Text("Both takes are rendered — the second leans harder into the rain.", "body")
takes = AudioList([t1, t2], "Rain on the stone bridge")
t1 = AudioItem("/sound-media/trk_2-v1.mp3", "Take 1 — steady drizzle", "Keep take 1", "v1 of the ambience bed", "12s")
t2 = AudioItem("/sound-media/trk_2-v2.mp3", "Take 2 — heavier rain", "Keep take 2", "v2, more low end", "12s")

root = Card([intro, casting])
intro = Text("Six portraits up — pick your favorite for each and I'll lock them in.", "body")
casting = MediaGrid([m1, m2, s1, s2], null, 2, "one-per-group", "Lock these portraits", "Lock them in")
m1 = MediaItem("/storyboard-media/miles-1_thumb.webp", "/storyboard-media/miles-1_display.webp", "Miles 1", "Miles 1", null, false, "Miles Okonkwo")
m2 = MediaItem("/storyboard-media/miles-2_thumb.webp", "/storyboard-media/miles-2_display.webp", "Miles 2", "Miles 2", null, false, "Miles Okonkwo")
s1 = MediaItem("/storyboard-media/saskia-1_thumb.webp", "/storyboard-media/saskia-1_display.webp", "Saskia 1", "Saskia 1", null, false, "Saskia Voss")
s2 = MediaItem("/storyboard-media/saskia-2_thumb.webp", "/storyboard-media/saskia-2_display.webp", "Saskia 2", "Saskia 2", null, false, "Saskia Voss")

root = Card([params, go])
params = KeyValue([{label: "Model", value: "nano_banana_pro"}, {label: "Aspect", value: "16:9"}, {label: "References", value: "Sara sheet, clearing dawn"}], "About to submit")
go = Actions([yes, edit])
yes = Action("Generate it", "Go ahead and generate it", "primary")
edit = Action("Change the prompt", "Wait — let me adjust the prompt first")

## Important Rules
- When asked about data, generate realistic/plausible data
- Choose components that best represent the content (tables for comparisons, charts for trends, forms for input, etc.)

## Final Verification
Before finishing, walk your output and verify:
1. root = Card(...) is the FIRST line (for optimal streaming).
2. Every referenced name is defined. Every defined name (other than root) is reachable from root.

- Arguments are POSITIONAL — never pass them by name. `name = value` and `name: value` are BOTH unsupported: write `Recommendation("Save the World bible?", "…", "Save it now")`, NEVER `Recommendation(title = "…", body = "…")`. A keyword form is not parsed away — each `name =` token is counted as an extra positional argument, so the real title/body slots come out null and the whole card fails to render.
- `Recommendation` is a hero card with exactly ONE button — its `send`. It has no `actions`/`buttons` array. When a decision needs TWO or more buttons (yes/no, save-now/wait), use an `Actions` block: for a plain question `root = Card([Actions([yes, no])])`, or to keep the proposal framing `root = Card([rec, go])` where `rec` is a `Recommendation` and `go = Actions([yes, no])`.
- Keep the whole program under ~20 statements. This renders in a narrow chat rail on a phone as well as on the desktop panel.
- Every `send` string is written in the AUTHOR's voice, because it is posted verbatim as their next chat message. Write "Use the second reference", never "The user picked option 2".
- Only use image URLs that a tool actually returned to you. Never invent, guess, or hand-edit a media URL.
- Do not restate your chat message inside the card. One short Text at most to frame the choice.
- Emit the program as bare openui-lang. Do NOT wrap it in a markdown code fence and do not add commentary before or after it.
- NEVER invent plausible-looking data. Every id, filename, url, count and duration in the card must come from a tool result you actually received. If you don't have a value, leave the prop out.
- This library has no tables, charts or form inputs. Use only the components listed above.
