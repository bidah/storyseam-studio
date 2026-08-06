---
name: series-episodes
description: >-
  Manage a SERIES and its EPISODES. Use when the user says "make this a series",
  "this is a feature/series", "create a new episode", "start episode 2", "list the
  episodes", "which episode am I on", or "anchor <character>". Model: a project is
  a FEATURE film or a SERIES; set that with set_format. In a series everything
  downstream of the script — script, shot list, animatic, editor, cut — is PER
  EPISODE, while the world bible (title, logline, story map, locations, character
  LIBRARY) is SHARED. A new episode starts fresh but carries in every ANCHORED
  character. Tools: set_format, list_episodes, create_episode. IMPORTANT: this
  conversation is bound to ONE episode; your tools act on that episode. You can
  create episodes and set the format, but to BUILD another episode the author must
  switch to it in the header's Ep menu (that opens its own chat). Never claim you
  switched episodes yourself.
---

# Series & episodes

A project is either a **feature film** (one self-contained story) or a **series**
(a run of episodes). The `format` field on the world bible decides which; it
defaults to **feature**, so nothing here applies until you set it to **series**.

## What is shared vs per-episode

| Shared across the whole series (the world bible) | Per episode |
|---|---|
| title, logline | story **depth** (premise, want-vs-need, conflict, obstacles, structure) |
| story **map** (the 5 shaping questions) | the **script** (and its drafts) |
| **locations** | the **shot list** |
| the character **LIBRARY** (every character) | the **animatic**, **editor timeline**, and **cut** |
|  | the episode's **roster** — which library characters are in it |

Editing a character (profile, sheet, voice) updates it **everywhere** it appears —
there is one library record per character, not a copy per episode.

## Anchors and the roster

- A character can be an **anchor**. Every new episode is seeded with the anchored
  cast (e.g. recurring judges) and nothing else.
- Non-anchored characters created in one episode stay in the library; the author
  adds them to another episode from the **"Add from library"** picker on the World
  tab (or you promote a new speaker with `add_world_character`, which joins the
  current episode).

## Tools

- **set_format** — `{ format: "feature" | "series" }`. Set this first. Turning on
  a series reveals the episode switcher in the header.
- **list_episodes** — the episodes `{ id, number, title }`, the `activeId`, and the
  `format`. A feature returns the single default episode (`ep1`).
- **create_episode** — `{ title? }`. Creates the next episode with its own empty
  pipeline; anchored characters carry in. Returns the new episode.

## The binding rule (important)

A conversation is bound to the episode it was started on. Every one of your tools —
`get_shotlist`, `save_shotlist`, `get_episode`, `edit_timeline`, everything — acts
on **that** episode. Creating an episode does **not** move you into it.

So the flow for building a second episode is:

1. `set_format` → `series` (once).
2. `create_episode` → make Episode 2.
3. Tell the author: *"Episode 2 is created — switch to it in the header's Ep menu
   to start writing it."* Switching opens Episode 2's own chat, and a fresh
   conversation there is bound to Episode 2, so its script → shot list → cut all
   land on Episode 2.

Never describe yourself as having switched episodes or say "you're now on Episode
2" — you reach whatever episode this chat is bound to, and only the author's header
action moves the screen.
