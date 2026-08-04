---
name: moodboard
description: >-
  Build and read the MOODBOARD — the reference wall of sticky notes, images,
  clips and links that fixes the episode's look before anything is generated.
  Use when the user is on the Moodboard screen (view = "moodboard") or asks to
  "build/start a moodboard", "add this to the moodboard", "collect references",
  "pin this", "add a note to the board", or "what's the look / tone / palette".
  ALWAYS get_moodboard first and skip what's already up — add_moodboard_card
  does NOT dedupe. One card per call. Never pass x/y unless the user named a
  spot: auto-placement takes the first EMPTY spot, never covers their layout.
  Images/videos are added by URL and stored our side (a project still or
  generation goes in as its absolute /files/… URL); a web page goes in as a
  link and unfurls. Show what you added IN THE CHAT as a render_ui MediaGrid —
  never prose sending the user to the tab. Adding art here does NOT assign it
  to a shot; that is select_reference.
---

# Moodboard (the reference wall)

The **Moodboard** tab is where an episode's look gets decided — before a shot
list exists, before anything is rendered. It's an infinite canvas of four kinds
of card:

| card | what it holds | added with |
|------|---------------|-----------|
| **note** | a sticky note: tone, palette, texture, "no lens flare", a line of the brief | `add_moodboard_card` `type: "note"`, `content` |
| **image** | a reference picture, fetched and stored on our side | `type: "image"`, `url` |
| **video** | a reference clip, same fetch-and-store | `type: "video"`, `url` |
| **link** | any web page, unfurled server-side into a preview | `type: "link"`, `url` |

The user arranges these by hand — dragging, stacking, resizing. **That
arrangement is theirs.** Everything below follows from that.

## The rules

1. **Read before you write.** `get_moodboard` first, every time. It returns every
   card with its id, type, position and text/url. `add_moodboard_card` does NOT
   dedupe: without the read you will put the same reference up twice.

2. **You cannot see the pictures.** Image and video cards come back as stored
   file names, not content. Describe a reference by the note the user wrote next
   to it or by where it came from — never by guessing what's in the frame.

3. **One card per call.** `add_moodboard_card` adds exactly one. Adding six
   references is six calls; that is fine and expected.

4. **Don't pass x/y.** Placement is automatic and deliberate: a new card takes
   the first *empty* spot on the canvas, so an addition can never cover the
   user's layout. Only pass coordinates when the user asked for a specific spot
   ("put it next to the forest shot").

5. **Removing is destructive to their thinking, not just their data.** Only call
   `remove_moodboard_card` for a card the user explicitly asked to remove. A
   reference that looks off-brief to you may be up there deliberately as a
   contrast.

6. **The board is not a shot reference.** Putting art on the moodboard fixes the
   *look*; it does not bind anything to a shot. Assigning art to a shot is
   `select_reference` / `auto_assign_refs`, and a character or location sheet is
   the `sheet-generation` skill.

## Building a board from a brief

When the user says "build me a moodboard for X":

1. `get_moodboard` — see what's already there.
2. `get_world` — the written world (theme, tone, characters' `appearance`) is
   your brief. If the world is empty, ask what the episode is about first; a
   moodboard assembled from nothing is decoration.
3. **Notes before pictures.** Put up 3–6 sticky notes that name the look in
   words — palette, light, texture, camera feel, one "never do this". These are
   what make the images legible later, and they're what the user will edit.
4. Add the references. For art you generate, generate it first (the
   `visual-world` or `sheet-generation` skill), then add it with its absolute
   `/files/…` URL. For anything the user pasted at you, use their URL.
5. `render_ui` a **MediaGrid** of what you added, in the chat. The board is
   visual; a paragraph describing it is the wrong medium.

## Adding what the user just handed you

The common case is the user dropping a link or an image in chat and saying "put
this on the board":

- an image or video **attachment** → add it with `type: "image"` / `"video"` and
  the attachment's URL
- a **web page** (an article, a Pinterest board, a film still on a blog) →
  `type: "link"`; it unfurls into a preview card with the page's title and
  artwork
- a **direct file URL** ending in `.jpg` / `.mp4` / … → use `image` / `video`,
  not `link`, so it lands as a real picture on the canvas rather than a preview
  box

If the user's message says *why* the reference matters ("this is the palette",
"the fog, not the composition"), add a **note** next to it saying that. A
reference without its reason is a picture nobody can act on three weeks later.
