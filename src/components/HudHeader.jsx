// The public pages' header strip, shared by the StorySeam homepage (`/`) and
// the model page (`/director-harness`) so the two read as one site.
//
// A HUD strip rather than a centred logo lockup: the wordmark set in the
// display face, and the partner mark as metadata at the other end. No app mark
// here — the artwork's yellow-green is a second accent, and design.md's
// single-accent rule is the one it calls load-bearing.
//
// Sticky and opaque: the strip stays legible over whatever scrolls under it.
// The negative margins bleed its ground into the page gutters so nothing shows
// through at the edges, and the top padding lives HERE rather than on the page
// shell so the stuck strip keeps its breathing room. It wraps to two rows on a
// phone (`flex-wrap`) because at 390px the partner strip alone is wider than
// the room left beside the wordmark.
import { Link } from "react-router";
// Deep imports, not the package barrel: `@lobehub/icons`'s index pulls in
// `@lobehub/ui` + `antd` (React 19 peers this app doesn't have), which fails
// the dep prebundle. The two Fal marks are self-contained SVG components.
import FalColor from "@lobehub/icons/es/Fal/components/Color";
import FalText from "@lobehub/icons/es/Fal/components/Text";
import { DISPLAY, DISPLAY_TRACKING, MONO } from "@/lib/hudTheme";
import { ThemeToggle } from "@/components/ThemeToggle";

/** A HUD label: mono, small, wide-tracked, secondary. The system's `label` role. */
export function Label({ children, className = "" }) {
  return (
    <span
      className={`text-[0.72rem] uppercase text-[var(--br-secondary)] ${className}`}
      style={{ fontFamily: MONO, letterSpacing: "0.08em" }}
    >
      {children}
    </span>
  );
}

/**
 * @param {object} props
 * @param {string} [props.model] The model named after the partner mark. The
 *   MODEL page names it, because that page is a claim about one model; the
 *   homepage names only the partner, because the studio is not one model.
 */
export function HudHeader({ model }) {
  return (
    <header className="sticky top-0 z-30 -mx-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--br-secondary)]/25 bg-[var(--br-neutral)] px-4 pb-4 pt-6 sm:-mx-8 sm:flex-nowrap sm:px-8 sm:pt-8">
      {/* The wordmark goes home, which on the model page is the way back to
          the homepage and on the homepage is a no-op the browser handles. */}
      <Link
        to="/"
        className="text-[1.35rem] leading-none"
        style={{ fontFamily: DISPLAY, fontWeight: 600, letterSpacing: DISPLAY_TRACKING }}
      >
        STORY<span style={{ fontWeight: 800 }}>SEAM</span>
      </Link>
      {/* The one mark on these pages that isn't ours: the inference partner,
          set at the right end of the strip as HUD metadata. */}
      <span className="ml-auto flex items-center gap-2">
        <Label>Powered by:</Label>
        {/* The official lockup's own proportions, from the package's
            `style.js`: the wordmark sets at 1.1x the mark and the gap is 0.2x
            it, which is what `Fal.Combine` would have drawn if it were
            importable. Nudged up 2px — the mark is round and the wordmark is
            lowercase, so both read as sunk when centred on the mono caps. */}
        <span className="flex -translate-y-[2px] items-center gap-1">
          <FalColor size={20} />
          <FalText size={22} />
        </span>
        {model ? <Label>{model}</Label> : null}
      </span>
      <ThemeToggle />
    </header>
  );
}
