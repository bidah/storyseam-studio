# shot-studio

Vite + React front-end (`src/`) with an Express API (`server/index.js`) for reviewing
Whistlewood episode shots, references, and Seedance renders.

## UI conventions

- **Always use [lucide-react](https://lucide.dev) icons — never emojis or Unicode glyphs**
  (no 🔊 ✕ ✓ ＋ ▾ ★ ↺ ⧉, etc.) in JSX. Import the named icon from `lucide-react` and
  render it as a component, e.g. `import { Volume2 } from "lucide-react"` →
  `<Volume2 size={14} />`. Size icons in px to match the surrounding text, and give
  icon-only buttons an `aria-label`.
- Typographic characters that are punctuation, not icons (e.g. `→`, `·`, `–` inside
  text like "MS-01 → MS-22"), are fine to keep as text.
