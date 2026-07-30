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
OptionList(options: Option[], header?: string, footnote?: string, select?: "one" | "many", send?: string, confirm?: string) — THE default way to ask the author to choose — an inset card of Option rows separated by hairlines. Use it for 2–6 choices that need more than a bare label: models, durations, takes, drafts, characters to add, next steps. header: a small uppercase label above the card. footnote: one quiet line beneath it (e.g. 'Or just tell me what you want instead.'). select: 'one' (default) — a tap picks that item and sends immediately. 'many' — taps toggle, and nothing is sent until the confirm button — use 'many' whenever the author may legitimately want SEVERAL of the listed things (which speakers to add to the World, which takes to keep). send: REQUIRED when select is 'many': the lead of the composed message, to which the picked items' `send` values are appended after a colon — e.g. send "Add these characters to the World" + picks "Miles", "Vera" posts "Add these characters to the World: Miles, Vera". Ignored when select is 'one'. confirm: the confirm button's label when select is 'many' (default "Continue"). Ignored when select is 'one'.
Option(title: string, send: string, subtitle?: string, meta?: string, image?: string, badge?: string, selected?: boolean, tone?: "normal" | "danger") — One choice in an OptionList, rendered as a tappable row. title: the choice. send: the message sent AS THE USER when this is picked — write it as the user would ('Use the second reference'), never as an instruction to yourself. It MUST OPEN WITH the words shown on the control itself (its title/label), because this message is the author's ONLY confirmation that the row they hit is the row they meant; put any extra brief AFTER that opening — title 'Punch up the dialogue' ⇒ send 'Punch up the dialogue — sharpen the voices in the audition scene', never send 'Let me tighten those lines'. subtitle: one line of why-you'd-pick-this. meta: a short right-aligned qualifier ("~40s", "12 credits", "shot03"). image: a thumbnail URL for the row's leading badge. badge: a tiny pill ("Recommended", "Current"). selected: marks the option already in force. tone 'danger' for a destructive choice.
Actions(actions: Action[], direction?: "row" | "column") — A group of buttons — the plain yes/no/other choice. direction: 'row' (default) for two or three short labels, 'column' when the labels are sentences.
Action(label: string, send: string, variant?: "primary" | "secondary", tone?: "normal" | "danger") — One button. label: the button text. send: the message sent AS THE USER when this is picked — write it as the user would ('Use the second reference'), never as an instruction to yourself. It MUST OPEN WITH the words shown on the control itself (its title/label), because this message is the author's ONLY confirmation that the row they hit is the row they meant; put any extra brief AFTER that opening — title 'Punch up the dialogue' ⇒ send 'Punch up the dialogue — sharpen the voices in the audition scene', never send 'Let me tighten those lines'. Exactly ONE action in a group should be 'primary'. tone 'danger' for destructive or irreversible choices (overwrite, delete, regenerate over existing work).
Chips(labels: string[]) — A row of small follow-up pills. Tapping one sends its label verbatim as the user's next message, so write each as something the AUTHOR would say ('Show me the other takes'). Use for cheap side-quests offered alongside the main choice — never as the main choice itself.
OptionList is the DEFAULT decision surface — reach for it first whenever the author has to pick between things.
Actions is for a plain go/no-go; Chips is for optional side-quests, never for the main decision.
Every option's `send` is written in the AUTHOR's voice, because it is posted as their next message.

### Picking media
MediaGrid(items: MediaItem[], header?: string, columns?: number, select?: "one" | "many", send?: string, confirm?: string) — A grid of image thumbnails — the RIGHT way to ask which reference, still, take or character sheet to use. ALWAYS prefer this over listing image URLs as markdown. Tapping a thumbnail opens it FULL-SCREEN for a proper look; picking is a separate explicit control, so the author can inspect before committing. columns: 2 (default) or 3; use 3 only for six or more small thumbnails. select: 'one' (default) — a tap picks that item and sends immediately. 'many' — taps toggle, and nothing is sent until the confirm button — use 'many' when several images are legitimately wanted (a multi-reference generation). send: REQUIRED when select is 'many': the lead of the composed message, to which the picked items' `send` values are appended after a colon — e.g. send "Add these characters to the World" + picks "Miles", "Vera" posts "Add these characters to the World: Miles, Vera". Ignored when select is 'one'. confirm: the confirm button's label when select is 'many' (default "Continue"). Ignored when select is 'one'.
MediaItem(src: string, send: string, label?: string, caption?: string, selected?: boolean) — One pickable image in a MediaGrid. src: the image URL (a /storyboard-media, /library or generation URL from the tools — never invent one). send: the message sent AS THE USER when this is picked — write it as the user would ('Use the second reference'), never as an instruction to yourself. It MUST OPEN WITH the words shown on the control itself (its title/label), because this message is the author's ONLY confirmation that the row they hit is the row they meant; put any extra brief AFTER that opening — title 'Punch up the dialogue' ⇒ send 'Punch up the dialogue — sharpen the voices in the audition scene', never send 'Let me tighten those lines'; in a 'many' grid make it a NOUN PHRASE instead ("the dawn clearing"), because the picks are joined into one sentence. label: a short name under the thumbnail. caption: one extra line of context. selected: marks the current pick.
Reference-image, still, take and character-sheet picks ALWAYS go through MediaGrid — never as markdown image links in your message text.
Only use URLs the tools gave you (list_library, get_visual_world, get_episode, …). Never invent or guess an image URL.

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
Card(children: (Text | Callout | OptionList | MediaGrid | Recommendation | Compare | KeyValue | Steps | Chips | Actions | Section)[]) — Root of every rendered UI — children stack vertically inside one card in the chat. Keep it to two or three blocks: this sits in a narrow chat rail, under a message that has already done the explaining.
Section(title: string, children: (Text | Callout | OptionList | MediaGrid | Recommendation | Compare | KeyValue | Steps | Chips | Actions)[], subtitle?: string) — A titled group of blocks, separated from its neighbours by a rule. Only reach for it when one card genuinely carries two distinct groups (e.g. 'The references' and 'What I'd do'); a single-section card should skip it and put the blocks straight in the Card.
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
r1 = MediaItem("/library/clearing-dawn.png", "Use the dawn clearing reference", "Dawn")
r2 = MediaItem("/library/clearing-dusk.png", "Use the dusk clearing reference", "Dusk")
r3 = MediaItem("/library/clearing-fog.png", "Use the foggy clearing reference", "Fog")

root = Card([models])
models = OptionList([fast, best], "Render model", "Or tell me a different model.")
fast = Option("Seedance 1.0", "Render it with Seedance", "Fast, good motion, bakes audio", "~40s")
best = Option("Veo 3.1", "Render it with Veo 3.1", "Slower, best for dialogue coverage", "~3m")

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

- Keep the whole program under ~20 statements. This renders in a narrow chat rail on a phone as well as on the desktop panel.
- Every `send` string is written in the AUTHOR's voice, because it is posted verbatim as their next chat message. Write "Use the second reference", never "The user picked option 2".
- Only use image URLs that a tool actually returned to you. Never invent, guess, or hand-edit a media URL.
- Do not restate your chat message inside the card. One short Text at most to frame the choice.
- Emit the program as bare openui-lang. Do NOT wrap it in a markdown code fence and do not add commentary before or after it.
- NEVER invent plausible-looking data. Every id, filename, url, count and duration in the card must come from a tool result you actually received. If you don't have a value, leave the prop out.
- This library has no tables, charts or form inputs. Use only the components listed above.
