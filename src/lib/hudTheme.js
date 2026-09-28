// The public pages' tokens — the StorySeam homepage at `/`, /login, a Film's
// page and the model page at `/director-harness`.
//
// They are NOT a palette of their own any more: each `--br-*` name points at
// the app's shadcn token (src/index.css), so the public pages follow the same
// theme as the studio — the fal-like light palette by default, design.md's
// Battle Royale on `.dark`. The names survive because every public page's
// classes read them through arbitrary values (`bg-[var(--br-neutral)]`), and
// renaming them all would be churn for nothing.
export const HUD = {
  "--br-primary": "var(--foreground)",
  "--br-secondary": "var(--muted-foreground)",
  "--br-tertiary": "var(--primary)",
  "--br-neutral": "var(--background)",
  "--br-surface": "var(--card)",
  "--br-on-primary": "var(--primary-foreground)",
};

// The type ramp, also theme-following. DISPLAY is the theme's heading face
// (Inter Tight on light, Teko on dark); Teko is condensed and sets far tighter
// than Inter Tight, so a one-line headline sized for it multiplies its size by
// DISPLAY_FIT and tracks with DISPLAY_TRACKING.
export const DISPLAY = "var(--font-display)";
export const DISPLAY_FIT = "var(--display-fit)";
export const DISPLAY_TRACKING = "var(--display-tracking)";
export const BODY = "var(--font-sans)";
export const MONO = "var(--font-mono)";

// The page-root style object every public page spreads onto its outermost
// element: palette + the body role.
export const hudPage = { ...HUD, fontFamily: BODY, fontSize: "0.92rem", lineHeight: 1.5 };
