// /watch/:token — a shared Film, PUBLIC. Anyone with the link watches it and
// can download it; no account, no project, no studio shell.
//
// A sibling of RootLayout in src/router.jsx (like /share/:token): the shell's
// login gate must never wrap it. The token is the credential — the Worker
// resolves it to the Film's project and file (lib/film-share.js) and streams
// the video through it (GET /api/share/film/:token/video, `?download=1` for the
// file). A revoked link, a fabricated one and a Film with no video all read as
// the same "no longer available".
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowRight, ChevronDown, Download, Loader2, LogIn } from "lucide-react";
import { Page } from "@/components/DirectorStory";
import { formatLength } from "@/lib/film-plan";
import { DISPLAY, DISPLAY_TRACKING, MONO } from "@/lib/hudTheme";
import { cn } from "@/lib/utils";

const ACTION =
  "flex items-center gap-1.5 border border-[var(--br-secondary)]/40 px-3 py-1.5 text-[0.72rem] uppercase text-[var(--br-primary)] transition-colors hover:border-[var(--br-primary)]";

export function Component() {
  const { token } = useParams();
  // undefined = loading; null = not available.
  const [film, setFilm] = useState(undefined);

  useEffect(() => {
    let live = true;
    setFilm(undefined);
    fetch(`/api/share/film/${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => live && setFilm(data))
      .catch(() => live && setFilm(null));
    return () => { live = false; };
  }, [token]);

  useEffect(() => {
    if (film?.title) document.title = `${film.title} — StorySeam`;
  }, [film?.title]);

  if (film === undefined) {
    return (
      <Page className="items-center justify-center">
        <Loader2 size={20} className="animate-spin text-[var(--br-secondary)]" aria-label="Loading" />
      </Page>
    );
  }

  if (film === null) {
    return (
      <Page className="items-center justify-center px-4">
        <main className="flex max-w-md flex-col items-center gap-5 text-center" data-not-found>
          <p className="text-base">This share link is no longer available.</p>
          <Link to="/" className={ACTION} style={{ fontFamily: MONO, letterSpacing: "0.08em" }}>
            Make your own story
          </Link>
        </main>
      </Page>
    );
  }

  return (
    <Page className="h-dvh min-h-0 overflow-hidden animate-in fade-in duration-500">
      <WatchFilm film={film} />
    </Page>
  );
}

// The layout proper. The header is the site's (the wordmark home, a way in);
// the Film's title and its Download sit under it on a row exactly as wide as
// the PICTURE, so the title starts where the video starts (the prompt card
// below takes the same width). The picture is
// `object-contain` in a box of whatever shape the window is, so its left edge
// moves with the window and the film's aspect — measured, not guessed.
function WatchFilm({ film }) {
  const [stage, setStage] = useState(null);
  const [aspect, setAspect] = useState(16 / 9);
  const [pictureWidth, setPictureWidth] = useState(null);

  useLayoutEffect(() => {
    if (!stage) return;
    const measure = () => {
      const { width, height } = stage.getBoundingClientRect();
      setPictureWidth(Math.min(width, height * aspect));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [stage, aspect]);

  return (
    <div className="flex h-dvh flex-col" data-watch>
      <header className="flex shrink-0 items-center gap-3 border-b border-[var(--br-secondary)]/25 px-4 py-3 sm:px-8">
        <Link
          to="/"
          className="text-[1.35rem] leading-none"
          style={{ fontFamily: DISPLAY, fontWeight: 600, letterSpacing: DISPLAY_TRACKING }}
        >
          STORY<span style={{ fontWeight: 800 }}>SEAM</span>
        </Link>
        <Link to="/" className={cn(ACTION, "ml-auto hidden sm:flex")} style={{ fontFamily: MONO, letterSpacing: "0.08em" }} data-make-your-own>
          Made with StorySeam — make your own <ArrowRight size={12} aria-hidden />
        </Link>
        <Link to="/login" className={cn(ACTION, "max-sm:ml-auto")} style={{ fontFamily: MONO, letterSpacing: "0.08em" }} data-login>
          <LogIn size={12} aria-hidden /> Log in
        </Link>
      </header>
      <div className="flex min-h-0 flex-1 flex-col bg-black px-2 pb-3 sm:px-8">
        <div
          className="mx-auto flex w-full items-center gap-3 py-3"
          style={pictureWidth ? { width: pictureWidth } : undefined}
        >
          <h1
            className="min-w-0 flex-1 truncate text-lg font-bold uppercase text-white"
            style={{ fontFamily: DISPLAY, letterSpacing: DISPLAY_TRACKING }}
            title={film.title || undefined}
          >
            {film.title || "A StorySeam story"}
          </h1>
          {film.seconds ? (
            <span className="shrink-0 text-[0.72rem] tabular-nums text-white/60" style={{ fontFamily: MONO, letterSpacing: "0.08em" }}>
              {formatLength(Math.round(film.seconds))}
            </span>
          ) : null}
          <a
            href={film.downloadUrl}
            download={film.fileName}
            className="flex shrink-0 items-center gap-1.5 border border-white/30 px-3 py-1.5 text-[0.72rem] uppercase text-white transition-colors hover:border-white"
            style={{ fontFamily: MONO, letterSpacing: "0.08em" }}
            data-download
          >
            <Download size={12} aria-hidden /> Download
          </a>
        </div>
        <div ref={setStage} className="flex min-h-0 flex-1 items-center justify-center">
          <video
            src={film.videoUrl}
            controls
            playsInline
            preload="metadata"
            className="h-full w-full object-contain"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight);
            }}
            data-film
          />
        </div>
      </div>
      <footer className="flex shrink-0 flex-col items-center gap-3 px-2 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-8">
        {film.idea ? <PromptCard text={film.idea} width={pictureWidth} /> : null}
      </footer>
    </div>
  );
}

// The premise, in a card like the Film page's prompt: two lines, and a chevron
// on the right that opens the whole of it in place. The chevron only shows when
// there is more to read — one that opens nothing is a broken button.
function PromptCard({ text, width }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const measure = () => setClipped(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, open]);

  return (
    <div style={width ? { width } : undefined} className="flex w-full max-w-full items-start gap-3 border border-[var(--br-secondary)]/40 bg-[var(--br-surface)] px-4 py-3" data-prompt>
      <p
        ref={ref}
        className={cn(
          "min-w-0 flex-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--br-secondary)]",
          open ? "max-h-[30dvh] overflow-y-auto" : "line-clamp-2",
        )}
      >
        {text}
      </p>
      {clipped || open ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? "Show less of the prompt" : "Show the whole prompt"}
          className="-mr-1 shrink-0 p-1 text-[var(--br-secondary)] transition-colors hover:text-[var(--br-primary)]"
          data-prompt-toggle
        >
          <ChevronDown size={16} aria-hidden className={cn("transition-transform duration-200", open && "rotate-180")} />
        </button>
      ) : null}
    </div>
  );
}
