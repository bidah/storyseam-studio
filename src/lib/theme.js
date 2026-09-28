// The app's colour theme: LIGHT by default (the fal-like palette in
// src/index.css `:root`), DARK on request (the Battle Royale palette under
// `.dark`). The choice is per browser, in localStorage under `theme`, and the
// pre-paint script in index.html applies it before first paint so a dark-mode
// reader never sees a white flash. This module is the runtime side of the same
// key: read it, flip it, and let components re-render when it changes.
import { useSyncExternalStore } from "react";

const KEY = "theme";
const listeners = new Set();

/** "light" | "dark" — whatever <html> currently carries. */
export function getTheme() {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function setTheme(theme) {
  const dark = theme === "dark";
  document.documentElement.classList.toggle("dark", dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0B0C0F" : "#FFFFFF");
  try {
    if (dark) localStorage.setItem(KEY, "dark");
    else localStorage.removeItem(KEY); // light is the default; nothing to remember
  } catch {
    // private mode / blocked storage: the switch still holds for this page
  }
  listeners.forEach((fn) => fn());
}

export function toggleTheme() {
  setTheme(getTheme() === "dark" ? "light" : "dark");
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The current theme, re-rendering when it flips. */
export function useTheme() {
  return useSyncExternalStore(subscribe, getTheme, () => "light");
}
