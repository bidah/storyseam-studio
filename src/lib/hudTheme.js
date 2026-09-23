// The Battle Royale design system (`design.md` at the repo root), as tokens.
//
// It is applied to the PUBLIC pages only — the StorySeam homepage at `/` and
// the model page at `/director-harness`. The studio behind the login keeps its
// own zinc + emerald shadcn theme, so the palette rides as CSS variables on
// each public page's root element rather than in `src/index.css`, and the
// classes read them through arbitrary values (`bg-[var(--br-neutral)]`).
// Nothing global changes, and a page that doesn't spread `HUD` is unaffected.
//
// Kept verbatim from design.md (hex, not re-derived) so a change to that file
// is a change to these lines and nothing else.
export const HUD = {
  "--br-primary": "#F2F2F0",
  "--br-secondary": "#7A7E85",
  "--br-tertiary": "#FF5A1F",
  "--br-neutral": "#0B0C0F",
  "--br-surface": "#141619",
  "--br-on-primary": "#0B0C0F",
};

// The type ramp, also from design.md. Teko is a condensed display face — it
// sets far tighter than the UI stack, which is why display sizes here look
// large next to the studio's.
export const DISPLAY = '"Teko", "Oswald", "Haettenschweiler", sans-serif';
export const BODY = '"Inter", ui-sans-serif, system-ui, sans-serif';
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

// The page-root style object every public page spreads onto its outermost
// element: palette + the body role from design.md's typography block.
export const hudPage = { ...HUD, fontFamily: BODY, fontSize: "0.92rem", lineHeight: 1.5 };
