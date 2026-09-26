# StorySeam — domain language

The Director half of the studio (Director, Stage, Shot sheet, Musicalized).

## Language

**Cue sheet**:
A Series' ordered list of beats on the film's own clock (whole seconds from the first generated frame).
_Avoid_: script (reserved for the screenplay), timeline

**Beat**:
One entry on the cue sheet at an offset: what the Director is steered toward from that second, optionally closing on a pin.

**Pin**:
A beat's exact end frame — the picture the Director must land on at that second.
_Avoid_: keyframe, end image (wire name only)

**Sitting**:
One live Director session on Stage, playing a Series' whole cue sheet continuously — every reel of it, one after another, without stopping.
_Avoid_: run (that is a Shot sheet word), session (wire name only)

**Reel**:
A stretch of the cue sheet the Director runs as one script. Holds at most 16 pins, the first at least 5s in, each at least 3s after the last. Reels are cut by the author at beats (reel changes). A later reel is appended to the SAME sitting, not a new one; the seam lands on the Director's next chunk boundary.

**Reel change / seam**:
The beat a later reel opens on. It costs pins: the opening beat's own pin is dropped (no chunk ends at second zero of an appended reel), and no pin may sit less than 5s after it. A run that places seams does not draw those frames.

**Shot sheet**:
A video-model render whose only content is a list of finished frames, hard cut, one per pin — cut back out and pinned.

**Still**:
A frame cut out of a clip. Every still in a Film — the first frame and every pin — comes from the run; none is made in an image model.

**Reference image / model sheet**:
An image handed to the shot sheet (up to 9) so every clip draws the same characters, machines, places and style. An input to the run, never a still in the Film. In Auto the agent generates them from the prompt before the run.
_Avoid_: still (a reference is never cut or pinned)

**Clip**:
One shot sheet render: at most 18 frames in 15s (0.8s each) and at most 16 pins. Because every frame is a pin, a clip covers a stretch of cue-sheet time from its first pin to its last.

**Run**:
One press of Render: every clip needed to draw the chosen frames, in running order.
_Avoid_: batch, job

**Take**:
The stored result of one clip (its video, its sheet, its status).

**Film**:
What the author gets back from a prompt: one sitting with its score laid under it, shown on the Auto surface and kept as a project file. Everything that made it (cue sheet, clips, pins, the unscored sitting) is kept but not shown.
_Avoid_: result, output, video

Every Film is made in a project of its OWN, created when it starts ("Story — <first words>", renamed to the World's title) — never in the author's current project, whose World and shot list would otherwise bleed into it. A user makes one Film at a time.

A Film is 2:00–5:00 long in 30s steps (default 2:00; a length chosen in the input's settings gear wins; otherwise a stated length rounds up; longer is capped at 5:00), pinned about every 4s — every 5s from 4:30, where 4s would pass the Series' 64-beat ceiling. 5:00 is the ceiling because at 5s it is 60 beats, 56 pins in 4 reels (3 seams), inside the 64-beat and 5-reel limits.

**Silence**:
A stretch of a Film's score where the music stops — a heavy exchange of dialogue, a held moment before a big action, a reveal. Written as a `silence` music cue with the shot list — a gap between pieces that is never rendered — or, in a Film scored the old way, as its own section of the plan asking for near silence; either way ALSO muted in the mix, faded out and back in over a second and a half. A 2–5 minute Film typically has 2–4, each 4–15s, never in the first 3s or the last 6s. The music after a silence comes back changed.
_Avoid_: gap, pause, dropout

**Music cue**:
Where a Film's score turns, and to what: a name from one fixed vocabulary (suspense, dread, adventure, action, party, wonder, whimsy, tender, triumph, sad, silence), an energy 1–5 and a short note, starting at a shot and running until the next cue. Written by the writing model WITH the shot list (4–8 for a 2–3 minute Film, changing only where the story turns, 2–3 of them `silence`), then laid on the measured film by scaling and snapping to the nearest real picture cut. Each cue belongs to a family (tension, drive, light, warm; silence has none).
_Avoid_: mood, section (a section is a chunk of a plan), beat

**Piece**:
One render of a Film's score: consecutive music cues of one family (or drive/light a step apart in energy), one ElevenLabs chunk per cue, with its own plan and seed. A change of family starts a new piece; a silence is a gap between pieces nobody renders. A Film has 1–4; where two pieces meet, the first runs a second past the join and the mix crossfades them. A Film whose shot list has no cues is scored as ONE piece, the old way.
_Avoid_: cue (on the Series a render is filed as a cue, but a Film's score is several pieces), song, track

**Auto**:
The author's only surface: they write a prompt and get a Film back. NOT a chat — an agent-based pipeline: a job on the Worker runs every step in order and shows progress on the same surface. Writing steps (Idea, World, sheet prompts, Shot list, Cue sheet) are direct LLM calls on Groq through AI Gateway, chosen for speed; the rest (sheets, clips, cutting, the sitting, scoring) runs server-side — nothing depends on the author's tab staying open. The flue chat is not on this path. A toggle beside the prompt input, ON by default: on, nothing asks; off, the agent asks once — after the World, before anything is paid for. Auto runs on StorySeam's own fal and Daytona keys, handled internally — the author never adds or sees a key, and StorySeam pays for every Film.

**Film version**:
Each change the author asks for makes a new version of the Film; earlier versions are kept. The agent redoes only from the earliest stage the change touches (music only → rescore; a sheet → every clip it appears in, then a new sitting). Any change to the picture means a whole new sitting — a sitting cannot be patched.

**Film allowance**:
How many Films a user may make on StorySeam's keys. A number stored per user in the database, set by the creators (not the author); default 10 per calendar month, resetting on the 1st. A paid plan will set it later. A new Film counts, and so does a version that re-shoots the sitting; a music-only rescore does not, and neither does a Film that fails and stops.

**Idea**:
What the author's prompt amounts to, stated as the thing to build. The agent derives the World from it.

## Pipeline (Auto)

Prompt → Idea → World → [confirm, only if Auto is off] → character & location sheets → Shot list → Cue sheet → job: plan reels → run (one clip per reel) → cut stills → pin → sitting → score → Film on the Auto surface.

## Relationships

- A **Cue sheet** has many **Beats**; a **Beat** has at most one **Pin**
- A **Reel** holds at most 16 **Pins**
- A **Run** has one or more **Clips**; each **Clip** produces one **Take**
- A **Clip** covers a contiguous stretch of cue-sheet time, the same kind of stretch a **Reel** is — but a Clip is drawn by a separate video model only to make pictures; it never starts a **Sitting**
- A **Sitting** plays every **Reel** of a **Cue sheet** in one continuous session
- A **Film** is one **Sitting** plus one score of 1–4 **Pieces**
- A **Piece** plays one or more consecutive **Music cues** of one family; a silence cue sits between pieces
- A **Run** plans the **Reels** (and their seams) first, then draws one **Clip** per **Reel** — a Clip never crosses a seam

## Example dialogue

> **Author:** "My cue sheet has 46 pins — why were 30 of them refused?"
> **Director dev:** "The Series is one **Reel**, and a reel holds 16 **Pins**. The **Run** drew three **Clips**, each covering about a minute of the cue sheet — that's three reels' worth, but the Series only has one."

## Flagged ambiguities

- "script" is used for both the screenplay (Script tab) and a reel on the wire (`configure.script`) — in the Director context say **Reel**.
