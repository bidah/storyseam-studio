# shot-studio

A small local dashboard for the per-shot animation pipeline that lives in
`../shot-by-shot/`. One row per shot (`shot01`, `shot02`, …) with four columns:

1. **Seedance shot** — editable text of that shot's `SHOT: NN` block from
   `whistlewood_s1_15s_seedance_shotlist.txt`.
2. **Audio shot (seed-audio)** — editable text of the seed-audio block for that
   shot from `whistlewood_1x01_scene1_FULL_seedaudio_prompt.txt`.
3. **Audio generation** — HTML5 `<audio>` player for `shotNN_audio.mp3`
   (or "not generated yet").
4. **Video generation** — HTML5 `<video>` player for `shotNN_FINAL.mp4`
   (or "not generated yet").

Editing a text cell and clicking **Save** writes the edited block back into the
correct `.txt` file on disk, replacing **only** that block and preserving the
rest of the file.

## Architecture

- **Express API** (`server/index.js`, port **5174**) parses both `.txt` files,
  scans `../shot-by-shot/shots/`, serves the media files statically under
  `/media`, and handles the read/write endpoints.
- **Vite + React front-end** (`src/`, port **5173**) renders the grid and proxies
  `/api` and `/media` to the API (see `vite.config.js`).

The list of rows comes from the `shotNN` folders on disk. The seed-audio file is
organized by `SEGMENT` (Segment 1 = shots 01–07, etc.), so each shot maps to the
segment whose shot range contains it; the segment number is shown as a tag on the
audio cell.

## Running it

From this `shot-studio/` directory:

```bash
npm install        # already done
npm start          # runs BOTH the API (5174) and the front-end (5173)
```

Then open http://localhost:5173

`npm start` uses `concurrently` to run both processes. If you prefer two
terminals:

```bash
npm run server     # terminal 1 -> API on http://localhost:5174
npm run dev        # terminal 2 -> front-end on http://localhost:5173
```

### Production / single-server option

```bash
npm run build      # outputs dist/
npm run server     # Express also serves dist/ -> open http://localhost:5174
```

## API

- `GET  /api/shots` → `{ shots: [{ id, seedanceText, audioText, audioUrl?,
  videoUrl?, audioSegment, seedanceFound, audioFound }] }`
- `PUT  /api/shots/:id/seedance` body `{ "text": "..." }` → rewrites that shot's
  `SHOT: NN` block.
- `PUT  /api/shots/:id/audio` body `{ "text": "..." }` → rewrites the seed-audio
  segment block that contains that shot.
- `GET  /media/shotNN/<file>` → static media (mp3 / wav / mp4).

## Refresh

When new `shotNN_audio.mp3` / `shotNN_FINAL.mp4` files appear, click **↻ Refresh**
in the header to re-scan the folders and reload the players (cache-busted).

## Caveats

- The seed-audio file has **no per-shot blocks** — it's segmented. Multiple shots
  in the same segment share (and edit) the same audio block. With the current
  data, shots 01–05 all map to Segment 1, so editing any of their audio cells
  edits Segment 1.
- The API resolves the data folder relative to itself (`../shot-by-shot`). Keep
  `shot-studio/` as a sibling of `shot-by-shot/`.
- No file watching; use the Refresh button.
- Saving overwrites the block in place. There's no undo, so keep the files under
  version control if you want history.
