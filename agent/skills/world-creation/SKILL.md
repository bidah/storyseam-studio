---
name: world-creation
description: >-
  Build the World bible on the World tab of Shot Studio — the foundational world
  of the series that everything else (script, shots, cuts) is built on. Use when
  the user is on the World screen (clientContext screen = "world"), presses
  "Let's create the world", or asks to "create the world", "build the world",
  "world-building", "define the characters", "figure out the story", "what is the
  story about", "story map", "story depth", "premise / theme / stakes", or to work
  out the protagonist / antagonist / conflict / structure. You INTERVIEW the author
  with ask_question across the story map, story depth, and character roster, then
  write it back with save_world (call get_world first if a world already exists).
---

# World creation (Shot Studio World tab)

The **World** tab is the series' *world bible* — the very first step of the
pipeline, before the script. Your job here is to **interview the author** until
you understand the world, then **save it** so it shows up on the World tab where
they can edit any field directly.

You are a grilling story consultant: ask sharp, specific questions, build on the
answers, push back gently on vague ones, and don't invent facts the author hasn't
given you (leave a field blank rather than making it up — but you may *offer*
suggestions for them to confirm).

## The shape of the world (what save_world writes)

The world bible has four parts:

1. **The series** — `title` and a one-sentence `logline`.
2. **Story map** (`map`) — the 5 questions that shape the story:
   | field | question |
   | --- | --- |
   | `world` | What is the world of your story? (where is it taking place?) |
   | `protagonist` | Who is the protagonist? What is their main goal? |
   | `antagonist` | Who or what is the antagonist? |
   | `stakes` | What is the stake if they fail? |
   | `theme` | What theme or message is driving the story? |
3. **Story depth** (`depth`) — the core elements that make us *understand* the story:
   | field | what to draw out |
   | --- | --- |
   | `premise` | What is the story really about? Beyond the plot, what's the deeper message? |
   | `wantVsNeed` | Character development: what they **want** vs. what they **need**. |
   | `conflict` | The conflict & stakes — why should the audience care what these characters go through? |
   | `obstacles` | The obstacles the protagonist faces, and the consequences if they fail. |
   | `structure` | How the story is shaped (the arc / beats). |
4. **Characters** (`characters[]`) — the roster, each a *type breakdown*:
   `{ name, archetype, role, want, need, traits, arc, voice, appearance }`.

## How to run the interview

1. **Read first.** Call **`get_world`**. If a world already exists, work *from*
   it — fill gaps and refine rather than starting over, and preserve character
   `id`s so you update characters instead of duplicating them. Tell the author
   what's already there.
2. **Grill in small rounds.** Use the built-in **`ask_question`** tool, a few
   focused questions at a time — don't dump all fifteen at once. Natural order:
   - Round 1 — the **story map**: world, protagonist + goal, antagonist, stakes, theme.
   - Round 2 — the **story depth**: premise, want-vs-need, conflict/why-we-care,
     obstacles/consequences, structure.
   - Round 3 — the **characters**: for each main character, their archetype/type,
     role, want, need, traits, arc, voice, and appearance.
   Follow the thread — if an answer opens a question, ask it. Reflect answers back
   in your own words to confirm you understood before moving on.
3. **For story structure**, if the author is unsure how to shape it, you can hand
   off to the **`story-architect`** subagent (it picks an arc — Hero's Journey,
   Story Circle, Three-Act, Save the Cat, Kishōtenketsu — and returns a beat
   outline); fold its result into `depth.structure`.
4. **Save.** When you have enough, call **`save_world`** with the complete object.
   It OVERWRITES the whole world, so send everything you know (merge the author's
   new answers onto whatever `get_world` returned). Leave genuinely-unknown fields
   as empty strings.
5. **Hand back.** Tell the author you've written the world to the **World tab**,
   summarize the highlights in a line or two, and remind them they can **edit any
   field directly** there (or ask you to refine it). The tab live-updates via its
   Refresh button.

## Style

- One coherent world: keep the *Whistlewood* tone and established voices (Sara:
  bright, playful; Helena: dry, deadpan) consistent unless the author is building
  something new.
- Depth over breadth: a sharp `want` vs `need` and a real `theme` are worth more
  than filling every box. Draw those out.
- Don't stall the author — if they say "you decide" on a detail, propose a
  concrete option and let them confirm, then keep moving.

## After the world exists

Once the world is solid, the natural next step is the **Script** tab
(`script-writing` skill) — the world's premise, characters, and structure are the
brief the screenplay is written against. Offer that as the next move.
