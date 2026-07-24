// Persist window size/position across launches (TOO-23). Plain JSON in
// userData — no dependency needed for one rectangle.
import { app, screen } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const FILE = () => path.join(app.getPath("userData"), "window-state.json");
const DEFAULTS = { width: 1440, height: 900 };

export function loadWindowState() {
  try {
    const saved = JSON.parse(readFileSync(FILE(), "utf8"));
    if (!saved || typeof saved.width !== "number" || typeof saved.height !== "number") {
      return { ...DEFAULTS };
    }
    // If the saved position is on a display that no longer exists (monitor
    // unplugged), drop x/y and let the OS center the window.
    if (typeof saved.x === "number" && typeof saved.y === "number") {
      const onScreen = screen
        .getAllDisplays()
        .some(({ workArea: a }) =>
          saved.x < a.x + a.width && saved.x + saved.width > a.x &&
          saved.y < a.y + a.height && saved.y + saved.height > a.y);
      if (!onScreen) {
        delete saved.x;
        delete saved.y;
      }
    }
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

// Save on move/resize (debounced) and once more on close.
export function trackWindowState(win) {
  let timer;
  const save = () => {
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    try {
      writeFileSync(FILE(), JSON.stringify(win.getNormalBounds()));
    } catch { /* best-effort */ }
  };
  const debounced = () => {
    clearTimeout(timer);
    timer = setTimeout(save, 400);
  };
  win.on("resize", debounced);
  win.on("move", debounced);
  win.on("close", save);
}
