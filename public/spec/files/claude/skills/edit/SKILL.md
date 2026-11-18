---
name: edit
description: >-
  The editing stage: rendered blocks into the finished film, in the editing program
  config.json names (`editor.id`). Use for "/edit", "edit the film", "cut it together",
  "open it in Resolve", "make the final video". `none` = the agent edits it alone with
  ffmpeg (the `assemble` skill). Any program = edit IN that program: MCP for the precise
  operations AND computer use to look at the screen and verify, together, never MCP
  alone. Reads `editor.mcp` / `editor.computer_use` and asks before taking over the screen.
  Never generates media, never adds music.
---

# /edit — clips → film, in the program the story names

The film is cut where the author will keep working on it. `config.json` says where:

```json
"editor": { "id": "davinci_resolve", "mcp": true, "computer_use": true }
```

| Key | Meaning |
| --- | --- |
| `id` | `none` — you edit alone with ffmpeg. Or the program: `davinci_resolve`, `premiere_pro`, `final_cut_pro`, `capcut`, or any other name the author gives. |
| `mcp` | `true` when that program's MCP server is installed and connected in your client. |
| `computer_use` | `true` when you may drive the screen (Claude's computer use, or your tool's equivalent). |
| `notes` | Optional free text: the program's version, edition, project location. |

No `editor` key is the same as `{ "id": "none" }`.

## Step 0 — verify the clips (every path)

Do Step 1 of the `assemble` skill first, whatever the editor: every block has a clip, in
order, at its real duration. An edit built on a missing block is a film with a hole.

## Path A — `editor.id: "none"`: you are the editor

Follow the `assemble` skill. The output is `renders/final/film.mp4`. That is the whole stage.

## Path B — a program: edit in it

### B1. Check what you can reach, then say it

Before touching anything, confirm what `config.json` claims:

- **MCP:** call a read-only tool on the program's server (for DaVinci Resolve, the project
  or timeline listing). If it fails, print that server's install line from `config.json`
  `mcp_servers` (`npx storyseam mcp --agent <yours>`; for Resolve, `npx davinci-resolve-mcp
  setup`) and wait. Set `editor.mcp` to `false` only after the author confirms the server
  is not meant to be there. Never install it yourself.
- **Computer use:** take one screenshot and confirm the program is open, or can be opened.

Then tell the author in one line which mode you will work in, and **ask before taking over
the screen**: computer use moves their mouse and keyboard.

### B2. Work MCP and computer use TOGETHER

Neither is enough alone, and the best results come from using both on every step:

- **MCP does the precise, repeatable work:** create the project and timeline at the
  story's resolution and frame rate, import `renders/clips/block_NN.mp4` in block order,
  place each on V1/A1 back to back, add markers per block from `shotlist/shotlist.json`,
  set render settings, and start the render. Exact values and no misclicks.
- **Computer use is your eyes, and your hands where the API stops:** screenshot after each
  MCP step to confirm it did what it reported, scrub every seam in the viewer and look at
  the frames either side, check the audio meters, and handle anything the MCP does not
  expose (a dialog, a panel, a drag, a setting with no API).
- **Never trust an MCP success message you have not looked at.** A clip imported at the
  wrong frame rate, a timeline at the wrong resolution, or an empty render queue all report
  success.

When only one is available:

| `mcp` | `computer_use` | How you work |
| --- | --- | --- |
| true | true | Both, as above. The default and the best. |
| true | false | MCP only. Say the edit is unverified by eye and ask the author to scrub the seams themselves. |
| false | true | Computer use only. It is slower, so tell the author, and keep steps small with a screenshot after each. |
| false | false | You cannot drive the program. Write `renders/edit/timeline.edl` (CMX 3600, one event per block in order, from `shotlist.json` and the clips' real durations), tell the author how to import it, and also produce `renders/final/film.mp4` via the `assemble` skill so there is a film either way. |

### B3. The edit

1. A project named after `storyseam.md`'s `title`, at the clips' real resolution and frame
   rate (`ffprobe` one clip; do not assume).
2. One timeline. Blocks on V1 and their audio on A1, in order, with no gaps and no overlaps.
3. A marker per block, named with its block id and first shot.
4. Leave an empty music track (A2) for the author. **Never add music.** The score is the
   author's, into `assets/audio/music/`.
5. Render to `renders/final/film.mp4` (H.264, AAC, the timeline's resolution), and save the
   program's own project file where the program keeps it. Record that path in
   `editor.notes`.

### B4. Program notes

- **DaVinci Resolve.** Its MCP server drives Resolve's scripting API. External scripting is
  Studio-only; on the free edition the in-app bridge (Workspace › Scripts) is the way in, and
  on free 21.1+ Python scripting is gone, so expect to lean on computer use there. Use the
  Edit page for the timeline and the Deliver page to render; confirm the render queue in a
  screenshot before you start it.
- **Any other program.** Look for its MCP server first. If there is none, it is the
  `mcp: false` row above. Do not install software, plugins or MCP servers yourself; tell the
  author what would help and let them do it.

## Step last — report

The path to the film, its real runtime and resolution, the program's project file, which
mode you worked in (MCP + computer use, one of them, or EDL), anything you could not verify
by eye, and that there is no music by design.
