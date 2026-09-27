// /watch/:token — a shared Film, PUBLIC. Anyone with the link watches it and
// can download it; no account, no project, no studio shell.
//
// A sibling of RootLayout in src/router.jsx (like /share/:token): the shell's
// login gate must never wrap it. The token is the credential — the Worker
// resolves it to the Film's project and file (lib/film-share.js) and streams
// the video through it (GET /api/share/film/:token/video, `?download=1` for the
// file). A revoked link, a fabricated one and a Film with no video all read as
// the same "no longer available".
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Download, Loader2 } from "lucide-react";
import { Page } from "@/components/DirectorStory";
import { formatLength } from "@/lib/film-plan";
import { DISPLAY, MONO } from "@/lib/hudTheme";

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
      <div className="flex h-dvh flex-col" data-watch>
        <header className="flex shrink-0 items-center gap-3 border-b border-[var(--br-secondary)]/25 px-4 py-3 sm:px-8">
          <h1
            className="min-w-0 flex-1 truncate text-lg font-bold uppercase"
            style={{ fontFamily: DISPLAY, letterSpacing: "0.04em" }}
            title={film.title || undefined}
          >
            {film.title || "A StorySeam story"}
          </h1>
          {film.seconds ? (
            <span className="shrink-0 text-[0.72rem] tabular-nums text-[var(--br-secondary)]" style={{ fontFamily: MONO, letterSpacing: "0.08em" }}>
              {formatLength(Math.round(film.seconds))}
            </span>
          ) : null}
          <a href={film.downloadUrl} download={film.fileName} className={ACTION} style={{ fontFamily: MONO, letterSpacing: "0.08em" }} data-download>
            <Download size={12} aria-hidden /> Download
          </a>
        </header>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-black px-2 py-3 sm:px-8">
          <video src={film.videoUrl} controls playsInline preload="metadata" className="h-full w-full object-contain" data-film />
        </div>
        <footer className="flex shrink-0 flex-col items-center gap-1 px-4 py-3 text-center sm:px-8">
          {film.idea ? <p className="line-clamp-2 max-w-3xl text-sm text-[var(--br-secondary)]">{film.idea}</p> : null}
          <Link to="/" className="text-xs text-[var(--br-secondary)] underline-offset-4 hover:text-[var(--br-primary)] hover:underline">
            Made with StorySeam — make your own
          </Link>
        </footer>
      </div>
    </Page>
  );
}
