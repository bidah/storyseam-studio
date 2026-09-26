// PUBLIC landing page (/) — a sibling of RootLayout, like /privacy and /terms,
// so it renders with no session, no project scope and no header.
//
// This is the marketing page for the REALTIME model, not the studio's front
// door: it deliberately carries NO sign-in button and no account UI of any
// kind. Signing in lives at /login, which is where LoginGate sends anyone who
// asks for an app route without a session. A visitor who already has an account
// simply goes to /world (post-OAuth lands there too — see Login.jsx).
//
// Keep it that way. The moment a signed-out page's only call to action is a
// Google button it starts to read like a phishing page, which is exactly what
// Safe Browsing flagged this domain for in Aug 2026 (see the copy rules at the
// top of components/Login.jsx). A page that explains the product and links its
// legal pages is the opposite shape.
//
// ENGLISH ONLY, deliberately: no `useT`, no `t(...)`, no entry in
// `lib/locales`. The studio is translated because an author works in it for
// hours; this page is a product claim about an experimental model, and a
// machine-ish translation of a marketing line reads worse than the English.
// The rest of the app is unaffected — adding `t()` back here is what would
// make it follow the browser's language again.
//
// ── Design: Battle Royale (`design.md` at the repo root) ────────────────────
// A competitive-shooter HUD: near-black ground, one orange accent, flat. The
// system is applied HERE and nowhere else — the studio keeps its own zinc +
// emerald shadcn theme, so the palette lives as CSS variables on this page's
// root element (`HUD` below) rather than in `src/index.css`, and the classes
// read them through arbitrary values. Nothing global changes.
//
// The four rules from the design's own Do's and Don'ts, and where they land:
//   • ONE accent per screen. `--br-tertiary` drives exactly one thing: the
//     play control on the reel. Not the icons, not the links, not the rules.
//   • Neutral carries the composition — the negative space is the layout.
//   • No gradients. The blurred primary-coloured glow this page used to open
//     with is gone; so is every `bg-gradient-*`.
//   • No second accent. Everything non-text is `--br-secondary` at low alpha.
//   • Nothing is rounded. `rounded` is 0 at every step, so there is not a
//     single `rounded-*` class or `borderRadius` on this page.
import { Link } from "react-router";
import {
  AudioLines, Music, Mic, Sparkles, Radio, Film, Play, Cpu, Waves,
} from "lucide-react";
import { HudHeader, Label } from "@/components/HudHeader";
import { HUD, DISPLAY, BODY } from "@/lib/hudTheme";

// The palette and type ramp now live in `lib/hudTheme.js`, because the
// StorySeam homepage at `/` is drawn from the same system — one copy of the
// tokens, two public pages.

// The demo reel: Mecha Launch, a scored Stage sitting upscaled to 1080p with the
// ByteDance upscaler (the `upscales` doc of p_b2dafd94). An empty `src` renders
// the "coming" placeholder instead of a broken <video>. Keep BOTH fields: a
// video with no poster shows a black rectangle for as long as the first frame
// takes.
//   src:    an mp4 (or HLS) URL — R2 or any CDN
//   poster: a still from the clip, same aspect ratio
const LANDING_VIDEO = {
  src: "/files/media/p_b2dafd94/upscaled/c67cd49e-a8ba-4436-ab39-3efa93f5310f_1080p.mp4",
  poster: "/director-harness-poster.jpg",
};

// The claims, in the order they matter to someone deciding whether this is real:
// what writes it, what you hear, whose voice it is, how it looks, how fast it
// arrives, what you keep afterwards. Numbered in the HUD, because a squad list
// is numbered — and the engine is 01 because nothing else on this list happens
// until there is a story for it to happen to.
const HIGHLIGHTS = [
  {
    icon: Cpu,
    label: "Story engine",
    note:
      "Stories are created on the fly with a special engine that writes a 2-minute story in less than 2 seconds.",
  },
  {
    icon: Waves,
    label: "Audio world engine",
    note:
      "The story gets a sound pass to create the pacing, foley, sound effects, acting, and music scoring.",
  },
  {
    icon: AudioLines,
    label: "Audio effects",
    note: "Foley, room tone and impacts rendered with the picture, making a compelling sound experience.",
  },
  {
    icon: Music,
    label: "Background music",
    note: "Scores that match the genre of the request, matching the scene and moving with it.",
  },
  {
    icon: Mic,
    label: "Character voice consistency",
    note:
      "All characters keep the same voice from their first line to their last, with intonation and emotion linked to the video generation.",
  },
  {
    icon: Sparkles,
    label: "Highest image quality",
    note:
      "Each frame carries the highest quality of image, which translates to the maximum video quality transfer.",
  },
  {
    icon: Radio,
    label: "Streams in realtime",
    note:
      "One 30-second load, then the story keeps arriving for the time it was written into. 2, 5, 10, 30 minutes or as long as the script was configured to.",
  },
  {
    icon: Film,
    label: "Stored in 4K after the stream",
    note:
      "What you watched live has 480, 720 and 1080 options, with the final recording kept upscaled to full resolution with 2K and 4K options.",
  },
];

// 16:9 reel. `aspect-video` rather than a fixed height so it survives the
// phone-width pass, and square corners — `rounded` is 0 at every step in
// design.md, so the soft 16px cards this page opened with are gone and nothing
// here carries a radius at all.
//
// The play control is the page's ONE use of the accent. That is the whole
// budget: design.md reserves Tertiary for a single action per screen, and on a
// page whose only action is "watch this", the reel is it.
function VideoPlayer() {
  const { src, poster } = LANDING_VIDEO;

  return (
    <div className="relative mt-8 w-full border border-[var(--br-secondary)]/25 bg-[var(--br-surface)]">
      <div className="aspect-video w-full">
        {src ? (
          <video
            className="size-full object-cover"
            src={src}
            poster={poster || undefined}
            controls
            playsInline
            preload="metadata"
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-4 bg-[var(--br-surface)]">
            <span
              className="flex size-14 items-center justify-center bg-[var(--br-tertiary)] text-[var(--br-on-primary)]"
            >
              <Play size={22} fill="currentColor" />
            </span>
            <Label>Demo reel coming shortly</Label>
          </div>
        )}
      </div>
      {/* Squad chevrons, as corner ticks on the frame. Secondary, not accent —
          the single-accent rule is load-bearing. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <span className="absolute left-0 top-0 size-3 border-l border-t border-[var(--br-secondary)]/60" />
        <span className="absolute right-0 top-0 size-3 border-r border-t border-[var(--br-secondary)]/60" />
        <span className="absolute bottom-0 left-0 size-3 border-b border-l border-[var(--br-secondary)]/60" />
        <span className="absolute bottom-0 right-0 size-3 border-b border-r border-[var(--br-secondary)]/60" />
      </div>
    </div>
  );
}

export function Component() {
  return (
    <div
      className="min-h-dvh bg-[var(--br-neutral)] px-4 pb-8 text-[var(--br-primary)] sm:px-8 sm:pb-12"
      style={{ ...HUD, fontFamily: BODY, fontSize: "0.92rem", lineHeight: 1.5 }}
    >
      {/* The page column. Wider than the studio's surfaces on purpose: this
          design puts a condensed display face across the top, and a 1024px
          column made the headline wrap to three short lines that read as a
          stack rather than as a statement. */}
      <div className="mx-auto w-full max-w-7xl">
        <HudHeader model="MiniMax H3 Director" />

        <section className="pt-8 sm:pt-12">
          {/* 80% of the column, so the headline runs long without ever
              reaching the measure where a display line stops being readable. */}
          <h1
            className="max-w-[80%] text-balance text-[2.8rem] leading-[0.95] sm:text-[4rem] lg:text-[5rem]"
            style={{ fontFamily: DISPLAY, fontWeight: 700, letterSpacing: "0.02em" }}
          >
            {/* Upper case is the HUD's own voice. */}
            {"The first AI video harness that creates long form stories in realtime".toUpperCase()}
          </h1>

          <VideoPlayer />
        </section>

        <section className="mt-16 sm:mt-24">
          <Label>Capabilities</Label>
          <h2
            className="mt-3 max-w-3xl text-balance text-[2rem] leading-[1.02] sm:text-[2.6rem]"
            style={{ fontFamily: DISPLAY, fontWeight: 600 }}
          >
            {"The video model + harness that is changing how stories are created".toUpperCase()}
          </h2>
          <p className="mt-4 max-w-2xl text-[var(--br-secondary)]">
            In realtime, after a single 30-second load, you get long stories generated — picture, voices and sound together, for as long as the story runs.
          </p>

          {/* 8 / 16 / 32 is the whole spacing scale, so the grid gap is 16 and
              the cards are padded 24 like the system's `card` component.

              `auto-rows-fr` is what makes every card the same height. Without
              it each ROW sizes to its own tallest card, so the top row sat
              shorter than the bottom one and the block read as two grids
              rather than one. With it the tallest card sets the row height for
              all of them, and the items stretch to fill. */}
          <ul className="mt-8 grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {HIGHLIGHTS.map((h, i) => (
              <li
                key={h.label}
                className="flex flex-col items-start gap-4 border border-[var(--br-secondary)]/25 bg-[var(--br-surface)] p-6"
              >
                <div className="flex w-full items-center justify-between">
                  <span className="text-[var(--br-secondary)]">
                    <h.icon size={18} />
                  </span>
                  {/* The squad number. Mono and secondary — a HUD counts things. */}
                  <Label>{String(i + 1).padStart(2, "0")}</Label>
                </div>
                <div>
                  <div
                    className="text-[1.5rem] leading-none"
                    style={{ fontFamily: DISPLAY, fontWeight: 600 }}
                  >
                    {h.label.toUpperCase()}
                  </div>
                  <p className="mt-2 text-[var(--br-secondary)]">{h.note}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <footer className="mt-16 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-[var(--br-secondary)]/25 pt-6 sm:mt-24">
          <Label>StorySeam</Label>
          <Link to="/privacy" className="underline-offset-4 hover:underline">
            <Label className="hover:text-[var(--br-primary)]">Privacy</Label>
          </Link>
          <Link to="/terms" className="underline-offset-4 hover:underline">
            <Label className="hover:text-[var(--br-primary)]">Terms</Label>
          </Link>
          <a href="mailto:privacy@storyseam.app" className="underline-offset-4 hover:underline">
            <Label className="hover:text-[var(--br-primary)]">Contact</Label>
          </a>
        </footer>
      </div>
    </div>
  );
}
