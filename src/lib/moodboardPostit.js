// Post-it ("sticky") geometry. A note is a 160×160 square by default, but once
// it holds more text than comfortably fits a square, it morphs into a taller
// "notepad" rectangle — roughly two stacked stickies' worth of height and a
// touch wider. Drop back below the threshold and it returns to a square.
//
// The shape is a *pure function of the note's text length*, so every client (and
// the grid-snapping / bounding-box math) derives the same footprint with no
// extra state to sync, no resize op, and nothing to undo.
//
// Browser-only (it measures via a detached element), which is why it lives here
// and not in the vendored reducer the Worker also runs.

export const POSTIT_W = 160;
export const POSTIT_H = 160;

// "Two sticky notes tall": two 160px cells plus the 20px gap that would sit
// between them on the grid, so a notepad reads as occupying two stacked cells.
// A touch wider than a square per the design.
export const NOTEPAD_W = 200;
export const NOTEPAD_H = 340;

// Plain-text length past which a square becomes a notepad. Tuned so a square
// holds a comfortably-readable amount of text (it auto-shrinks its font to fit)
// before handing off to the fixed-size notepad.
export const NOTEPAD_TEXT_THRESHOLD = 200;

/** Plain-text length of a post-it's HTML body (tags stripped). */
export function postItTextLength(html) {
  const el = document.createElement("div");
  el.innerHTML = html || "";
  return (el.textContent ?? "").trim().length;
}

/** Plain-text preview of a post-it's HTML body — used for labels and pickers. */
export function stripHtml(html) {
  const el = document.createElement("div");
  el.innerHTML = html || "";
  return (el.textContent ?? "").trim();
}

export function postItIsNotepad(html) {
  return postItTextLength(html) > NOTEPAD_TEXT_THRESHOLD;
}

export function postItSize(html) {
  return postItIsNotepad(html)
    ? { width: NOTEPAD_W, height: NOTEPAD_H }
    : { width: POSTIT_W, height: POSTIT_H };
}
