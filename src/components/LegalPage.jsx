// Shared chrome for the two public legal pages (/privacy, /terms).
//
// These render OUTSIDE the app shell — they are siblings of RootLayout in
// router.jsx, not children, exactly like /share/script/:token. That is
// load-bearing, not tidiness: LoginGate wraps RootLayout's children, so a
// privacy policy mounted inside it would demand a session before showing
// itself. A privacy policy only a signed-in user can read is useless to the
// people who need it most — a visitor deciding whether to sign in at all, and
// the Safe Browsing reviewer checking the site is what it claims to be.
//
// So they carry their own minimal header rather than the app's.
import { Link } from "react-router";
import { Clapperboard, ArrowLeft } from "lucide-react";

export function LegalPage({ title, updated, children }) {
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-4">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Clapperboard size={16} />
            </span>
            <span className="text-sm font-semibold tracking-tight">StorySeam</span>
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            <ArrowLeft size={12} /> Back to StorySeam
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-xs text-muted-foreground">Last updated {updated}</p>
        <div className="mt-10 space-y-10">{children}</div>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-2 px-6 py-6 text-xs text-muted-foreground">
          <span>StorySeam</span>
          <Link to="/privacy" className="underline-offset-4 hover:text-foreground hover:underline">
            Privacy
          </Link>
          <Link to="/terms" className="underline-offset-4 hover:text-foreground hover:underline">
            Terms
          </Link>
          <a
            href="mailto:privacy@storyseam.app"
            className="underline-offset-4 hover:text-foreground hover:underline"
          >
            privacy@storyseam.app
          </a>
        </div>
      </footer>
    </div>
  );
}

export function Section({ title, children }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

// Bulleted list with the same muted prose styling as Section's paragraphs.
export function List({ children }) {
  return <ul className="list-disc space-y-2 pl-5 marker:text-muted-foreground/50">{children}</ul>;
}
