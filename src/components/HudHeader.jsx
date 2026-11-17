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
import { Link, useNavigate } from "react-router";
import { CreditCard, LogIn, LogOut, UserRound } from "lucide-react";
// Deep imports, not the package barrel: `@lobehub/icons`'s index pulls in
// `@lobehub/ui` + `antd` (React 19 peers this app doesn't have), which fails
// the dep prebundle. The two Fal marks are self-contained SVG components.
import FalColor from "@lobehub/icons/es/Fal/components/Color";
import FalText from "@lobehub/icons/es/Fal/components/Text";
// lucide dropped its brand icons, so the GitHub mark comes from the same set.
import GithubMono from "@lobehub/icons/es/Github/components/Mono";
import { DISPLAY, DISPLAY_TRACKING, MONO } from "@/lib/hudTheme";
import { ThemeToggle } from "@/components/ThemeToggle";
import { signOut, useSession } from "@/lib/auth-client";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

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

/** The fal mark + wordmark, in the lockup's own proportions (see HudHeader). */
function FalLockup() {
  return (
    <span className="flex -translate-y-[2px] items-center gap-1">
      <FalColor size={20} />
      <FalText size={22} />
    </span>
  );
}

/**
 * "Powered by: fal" for the headers that aren't HudHeader (a Film's page,
 * /watch). Desktop only: on a phone those strips have no room beside their
 * buttons, and the credit is not worth a second row.
 */
export function PoweredByFal({ className = "" }) {
  return (
    <span className={cn("hidden items-center gap-2 sm:flex", className)} data-powered-by>
      <Label>Powered by:</Label>
      <FalLockup />
    </span>
  );
}

/**
 * @param {object} props
 * @param {string} [props.model] The model named after the partner mark. The
 *   MODEL page names it, because that page is a claim about one model; the
 *   homepage names only the partner, because the studio is not one model.
 * @param {() => void} [props.onSignIn] Opens the page's own sign-in dialog
 *   (the homepage's, the one a signed-out prompt opens). Without it the
 *   sign-in icon goes to /login.
 * @param {import("react").ReactNode} [props.trailing] Last in the strip, after
 *   the account — the studio's phone shell puts its menu button here, so a
 *   project's page carries the very same strip the homepage does.
 */
export function HudHeader({ model, onSignIn, trailing }) {
  return (
    // The rule under the strip runs the full width of the page while the strip
    // itself stays in the column: a 1px line drawn by a spread shadow, clipped
    // to its own height but not its width. A shadow never counts as overflow,
    // so this can't open a horizontal scrollbar the way a 100vw line would.
    <header className="sticky top-0 z-30 -mx-4 flex flex-wrap items-center gap-x-3 gap-y-2 bg-[var(--br-neutral)] px-4 py-4 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-[var(--hud-rule)] after:shadow-[0_0_0_100vmax_var(--hud-rule)] after:[clip-path:inset(0_-100vmax)] sm:-mx-8 sm:flex-nowrap sm:px-8"
      style={{ "--hud-rule": "color-mix(in oklab, var(--br-secondary) 25%, transparent)" }}
    >
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
        {/* A phone keeps the fal lockup and drops the words: they pushed the
            sign-in button onto a second row. */}
        <Label className="hidden sm:inline">Powered by:</Label>
        {/* The official lockup's own proportions, from the package's
            `style.js`: the wordmark sets at 1.1x the mark and the gap is 0.2x
            it, which is what `Fal.Combine` would have drawn if it were
            importable. Nudged up 2px — the mark is round and the wordmark is
            lowercase, so both read as sunk when centred on the mono caps. */}
        <FalLockup />
        {model ? <Label>{model}</Label> : null}
      </span>
      <GithubLink />
      <ThemeToggle />
      <AccountButton onSignIn={onSignIn} />
      {trailing}
    </header>
  );
}

// Same square as the ThemeToggle beside it.
const SQUARE =
  "inline-flex size-8 shrink-0 items-center justify-center border border-border text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground";

export const GITHUB_URL = "https://github.com/bidah/storyseam";

// The source, open: same square as the toggle beside it, the word on desktop.
function GithubLink() {
  return (
    <a
      href={GITHUB_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="StorySeam on GitHub"
      title="StorySeam on GitHub"
      className={cn(SQUARE, "w-auto gap-1.5 px-2")}
      data-github
    >
      <GithubMono size={15} />
      <span className="hidden text-[0.72rem] uppercase sm:inline" style={{ fontFamily: MONO, letterSpacing: "0.08em" }}>
        GitHub
      </span>
    </a>
  );
}

// An icon, no label: signed out it is the way in; signed in it is the account
// — the Google avatar when there is one, a person otherwise — with the email
// and Sign out behind it, in the same plain square as the toggle. Nothing while the session is
// still loading: a sign-in icon flashing at someone who is signed in is wrong.
function AccountButton({ onSignIn }) {
  const navigate = useNavigate();
  const { data: session, isPending } = useSession();
  if (isPending) return <span className="size-8 shrink-0" aria-hidden />;

  if (!session) {
    return (
      <button
        type="button"
        onClick={() => (onSignIn ? onSignIn() : navigate("/login"))}
        aria-label="Sign in"
        title="Sign in"
        className={SQUARE}
        data-sign-in
      >
        <LogIn size={15} />
      </button>
    );
  }

  const { email, name, image } = session.user || {};
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account: ${email || name || "signed in"}`}
          title={email || name || undefined}
          className={cn(SQUARE, "overflow-hidden text-foreground")}
          data-account
        >
          {image ? (
            <img src={image} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />
          ) : (
            <UserRound size={15} />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{email || name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate("/billing")}>
          <CreditCard size={14} /> Plan &amp; billing
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={async () => {
            try { await signOut(); } catch { /* the reload re-reads the session either way */ }
            window.location.reload();
          }}
        >
          <LogOut size={14} /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
