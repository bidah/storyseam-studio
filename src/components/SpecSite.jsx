// The open-source half of storyseam.app: the frame `/` (routes/home.jsx) and
// `/spec` (routes/spec.jsx) share — a header that goes to the SITE root rather
// than the Studio, the copy-able code block, and the footer.
//
// ENGLISH ONLY, like routes/landing.jsx: these pages document a file format
// whose keys are English, and a machine translation of a spec is a second spec.
//
// Design: the public pages' HUD tokens (lib/hudTheme.js), flat, nothing
// rounded, ONE accent per screen — the copy button on the agent prompt.
import { useState } from "react";
import { Link } from "react-router";
import { ArrowRight, Check, Copy } from "lucide-react";
import GithubMono from "@lobehub/icons/es/Github/components/Mono";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GITHUB_URL, Label } from "@/components/HudHeader";
import { DISPLAY, DISPLAY_TRACKING, MONO, hudPage } from "@/lib/hudTheme";
import { HOME_PATH } from "@/lib/home";
import { cn } from "@/lib/utils";

export const SITE = "https://storyseam.app";
export const SPEC_URL = `${SITE}/spec/storyseam.md`;
export const AGENT_URL = `${SITE}/spec/agent.md`;
export const SKILLS_URL = `${SITE}/spec/skills.json`;
export const TARBALL_URL = `${SITE}/spec/storyseam.tgz`;
export const INSTALL = `npx -y ${TARBALL_URL} init my-film`;
export const AGENT_ONE_LINER = `Read ${AGENT_URL} and set up a Storyseam story in ./my-film.`;

const SQUARE =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 border border-border px-2 text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground";

export function SpecPage({ children }) {
  return (
    <div className="min-h-dvh bg-[var(--br-neutral)] text-[var(--br-primary)]" style={hudPage}>
      <div className="mx-auto max-w-4xl px-4 sm:px-8">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--br-secondary)]/25 py-4">
          <Link
            to="/"
            className="text-[1.35rem] leading-none"
            style={{ fontFamily: DISPLAY, fontWeight: 600, letterSpacing: DISPLAY_TRACKING }}
          >
            STORY<span style={{ fontWeight: 800 }}>SEAM</span>
          </Link>
          <nav className="ml-auto flex items-center gap-2">
            <Link to="/spec" className={SQUARE} style={{ fontFamily: MONO, letterSpacing: "0.08em" }}>
              <span className="text-[0.72rem] uppercase">Spec</span>
            </Link>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Storyseam on GitHub"
              className={SQUARE}
            >
              <GithubMono size={15} />
              <span className="hidden text-[0.72rem] uppercase sm:inline" style={{ fontFamily: MONO, letterSpacing: "0.08em" }}>
                GitHub
              </span>
            </a>
            <ThemeToggle />
            <Link
              to={HOME_PATH}
              className={cn(SQUARE, "border-foreground/40 text-foreground")}
              style={{ fontFamily: MONO, letterSpacing: "0.08em" }}
            >
              <span className="text-[0.72rem] uppercase">Studio</span>
              <ArrowRight size={12} aria-hidden />
            </Link>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="mt-16 flex flex-wrap items-baseline justify-between gap-3 border-t border-[var(--br-secondary)]/25 py-8 text-sm text-[var(--br-secondary)]">
          <span>Storyseam is open source, MIT licensed.</span>
          <span className="flex gap-4">
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">GitHub</a>
            <Link to="/privacy" className="hover:text-foreground">Privacy</Link>
            <Link to="/terms" className="hover:text-foreground">Terms</Link>
          </span>
        </footer>
      </div>
    </div>
  );
}

/** A numbered plate: the drawing-sheet section of the old site, in HUD type. */
export function Plate({ fig, title, children, id }) {
  return (
    <section id={id} className="border-t border-[var(--br-secondary)]/25 py-10">
      <h2 className="mb-5 flex flex-col gap-2">
        {fig ? <Label>{fig}</Label> : null}
        <span className="text-2xl sm:text-3xl" style={{ fontFamily: DISPLAY, fontWeight: 600, letterSpacing: DISPLAY_TRACKING }}>
          {title}
        </span>
      </h2>
      {children}
    </section>
  );
}

/**
 * Code with a copy button. `accent` makes the button the page's one accent;
 * every other copy button is a plain square.
 */
export function CodeBlock({ code, accent = false, label, wrap = false, className }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard blocked (insecure origin, an embed): the text is selectable.
    }
  };
  const button = (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Copied" : "Copy to clipboard"}
      className={cn(
        "flex shrink-0 items-center gap-1.5 text-[0.72rem] uppercase transition-colors",
        label ? "ml-auto px-1" : "self-stretch px-4",
        accent
          ? "bg-[var(--br-tertiary)] text-[var(--br-on-primary)] hover:opacity-90"
          : cn("text-[var(--br-secondary)] hover:text-foreground", !label && "border-l border-[var(--br-secondary)]/25"),
      )}
      style={{ fontFamily: MONO, letterSpacing: "0.08em" }}
    >
      {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
      <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
  return (
    <div className={cn("relative min-w-0 border border-[var(--br-secondary)]/30 bg-[var(--br-surface)]", className)}>
      {label ? (
        <div className="flex items-center border-b border-[var(--br-secondary)]/25 px-4 py-2">
          <Label>{label}</Label>
          {button}
        </div>
      ) : null}
      <div className="flex items-stretch">
        <pre
          className={cn(
            "min-w-0 flex-1 overflow-x-auto px-4 py-3 text-[0.78rem] leading-relaxed",
            wrap && "whitespace-pre-wrap break-words",
          )}
          style={{ fontFamily: MONO }}
        >
          {code}
        </pre>
        {label ? null : button}
      </div>
    </div>
  );
}

/** Mono inline text. */
export function Mono({ children }) {
  return (
    <span className="text-[0.86em]" style={{ fontFamily: MONO }}>
      {children}
    </span>
  );
}
