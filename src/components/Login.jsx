// App login gate — the branded StorySeam homepage with "Sign in with
// Google" (Better Auth social provider). Gated on the Better Auth session; the
// signed-in user owns their own projects. Higgsfield is no longer the front
// door: it's a CONNECTOR linked to the session afterwards (Settings ›
// Connectors, lib/higgsfieldAccount.js).
//
// COPY RULES — this page is what Google Safe Browsing scores, and in Aug 2026 it
// scored it as a deceptive page and put a "Dangerous site" interstitial on the
// whole domain. A signed-out page whose only action is a Google sign-in button
// is already a phishing-shaped thing; these three rules keep it from reading
// like one, so don't undo them without a reason:
//   1. The name here MUST match <title> and the domain (StorySeam / storyseam.app).
//      Claiming an unrelated brand on an unknown host is the strongest signal.
//   2. Don't claim affiliation with a third party ("powered by X"). Higgsfield,
//      fal.ai and Atlas Cloud are render accounts the USER connects; say that.
//   3. Say plainly what the site is, and what signing in does, above the fold.
//
// After the session exists a SECOND gate may block on the selected render
// provider's credential: Higgsfield selected but not yet linked shows the
// connect screen; a BYOK provider (fal.ai / Atlas Cloud) without its key asks
// for one. BYOK keys live only in this browser's localStorage (lib/falKey.js /
// lib/atlasKey.js) and ride per-request to the workers — never stored
// server-side. Keys, connectors and provider toggles stay editable in Settings.
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import {
  Bot, PenLine, Workflow, Film, ListVideo, AudioLines, Loader2, ArrowRight,
  KeyRound, ExternalLink, LogOut, Cable, LayoutGrid, ImagePlus, Video, Radio,
  Images, Music, Scissors, Users,
} from "lucide-react";
import { useSession, authClient, signOut } from "@/lib/auth-client";
import { useHiggsfieldLinked, connectHiggsfield } from "@/lib/higgsfieldAccount";
import { desktop, isDesktop } from "@/lib/desktop";
import { useFalKey, setFalKey } from "@/lib/falKey";
import { useAtlasKey, setAtlasKey } from "@/lib/atlasKey";
import { useProviderPrefs, setActiveProvider, useSetupSkipped, setSetupSkipped } from "@/lib/providers";
import { captureInviteFromLocation } from "@/lib/pendingInvite";
import { useT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

// In pipeline order, which is also the order the marquee shows them in: an
// author reading left to right sees the episode get made. `note` is the line on
// the card; `blurb` is what the dialog says when the card is clicked. Adding one
// here is all that's needed — the carousel derives its loop length from
// FEATURES.length and holds its scroll SPEED constant as the list grows.
const FEATURES = [
  {
    icon: Bot,
    label: "Chat agent",
    note: "Drives the whole pipeline",
    blurb:
      "A chat agent with a typed tool for every step: it drafts the script, fills the shot list, fires renders and stitches the cut. It can also see the tab you are on, so \u201cmake this shot wider\u201d resolves without you explaining which shot.",
  },
  {
    icon: PenLine,
    label: "Script writing",
    note: "Draft & revise the episode",
    blurb:
      "A screenplay editor with full revision history. Write it yourself, or hand a pass to the writers\u2019 room and review the diff before anything lands in the draft.",
  },
  {
    icon: LayoutGrid,
    label: "Moodboard",
    note: "Pin references, set the look",
    blurb:
      "A free canvas for references, palettes and frames \u2014 the place to decide what the episode should feel like before a single shot is written.",
  },
  {
    icon: ListVideo,
    label: "Shotlist",
    note: "Seedance shot-by-shot",
    blurb:
      "Break the script into numbered shots, each with its own prompt, camera note and duration. Shot ids are stable on purpose, so the media generated against a shot is never orphaned by a later edit.",
  },
  {
    icon: Workflow,
    label: "Visual nodes",
    note: "Wire the shot graph",
    blurb:
      "The shot graph as a node canvas: see how scenes, shots and their generated media connect, and rewire them by dragging.",
  },
  {
    icon: ImagePlus,
    label: "Image generation",
    note: "Storyboard stills, shot by shot",
    blurb:
      "Generate a still per shot and keep every take, so you can compare instead of regenerating. Character and location sheets hold faces and places steady across the whole episode.",
  },
  {
    icon: Video,
    label: "Video generation",
    note: "Bring each shot to life",
    blurb:
      "Turn a chosen still into a moving shot. Takes are kept side by side, and swapping the one on the timeline never means starting over.",
  },
  {
    icon: Radio,
    label: "Radio",
    note: "Hear the episode before you see it",
    blurb:
      "The audio-only pass: the whole episode as dialogue and sound, before a single frame is rendered. The cheapest possible place to discover a scene does not work.",
  },
  {
    icon: Images,
    label: "Animatic",
    note: "Stills and dialogue on a timeline",
    blurb:
      "Storyboard stills cut against the radio pass. Shots with no art yet appear as labelled slates, so the episode is watchable end to end from the very first version.",
  },
  {
    icon: AudioLines,
    label: "Sound studio",
    note: "Seed Audio design",
    blurb:
      "Text to cinematic audio \u2014 dialogue, room tone, foley and music rendered together as one mixed clip, which is the part plain text-to-speech cannot do.",
  },
  {
    icon: Music,
    label: "Musical",
    note: "Turn a song into an audio shot bible",
    blurb:
      "Feed in a song with its stems and get a shot-by-shot breakdown back, cut to the track rather than to dialogue.",
  },
  {
    icon: Scissors,
    label: "Editor",
    note: "Trim, split and arrange the cut",
    blurb:
      "A real timeline: trim, split, reorder and gap. Stills and video sit on one picture lane as peers, so a placeholder still upgrades to its finished shot in place.",
  },
  {
    icon: Film,
    label: "Episodes",
    note: "Plan & stitch the cut",
    blurb:
      "Plan the episode, stitch the cuts and render the deliverable. A series keeps one shared world and a bible per episode.",
  },
  {
    icon: Cable,
    label: "Switch provider",
    note: "Higgsfield, fal.ai or Atlas Cloud",
    blurb:
      "Bring your own rendering account and switch between them whenever you like. Keys you paste stay in this browser only, and generation bills to you, not to us.",
  },
  {
    icon: Users,
    label: "Team collaboration",
    note: "Invite the crew to a project",
    blurb:
      "Invite people to the whole organization or to a single project. Everyone works in the same studio, while the tab each person is looking at stays their own.",
  },
];

// Card geometry, shared with the CSS animation. `marquee-left` slides the track
// by exactly one copy of the list — (card + gap) × count — so the numbers here
// and the `--marquee-*` vars below must stay the same numbers. COPIES is how
// many times the list is repeated: enough that the tail of one copy is still
// filling the band when the transform resets.
const CARD_W = 280; // px — matches --marquee-item
const CARD_GAP = 16; // px — Tailwind gap-4, matches --marquee-gap
const COPIES = 3;
const SECONDS_PER_CARD = 5.5; // ≈54px/s — slow enough to read a card as it passes

// The feature strip: an endlessly scrolling row of cards that PAUSES while the
// pointer is over it, and opens a detail dialog when one is clicked.
//
// It sits in a band 70% of the VIEWPORT wide — wider than the parent's
// max-w-2xl text column (too narrow to read as a carousel) but not full-bleed
// (cards then run off both screen edges with nothing to fade against, which
// reads as a layout bug). No break-out trick is needed: the column is already
// centred on the screen and its `items-center` centres this on the column, so a
// `w-[70vw]` child overflows it symmetrically and lands centred on the viewport.
// The max-width is a ceiling, not the size: past ~2200px of screen the strip
// stops widening, because a card row that keeps growing just puts more cards
// further from where the eye already is.
function FeatureMarquee() {
  const t = useT();
  const [open, setOpen] = useState(null); // the feature whose dialog is showing

  // "Next feature" walks the real list, not the repeated track, so it wraps
  // after the last one instead of running into a duplicate.
  const next = () => {
    const i = FEATURES.findIndex((f) => f.label === open?.label);
    if (i >= 0) setOpen(FEATURES[(i + 1) % FEATURES.length]);
  };

  return (
    <>
      <div className="relative mt-10 w-[70vw] max-w-[96rem] marquee-viewport">
        <div
          className="flex w-max gap-4 py-2 marquee-track hover:[animation-play-state:paused]"
          style={{
            "--marquee-item": `${CARD_W}px`,
            "--marquee-gap": `${CARD_GAP}px`,
            "--marquee-count": FEATURES.length,
            // Seconds PER CARD rather than a fixed total, so adding a feature
            // makes the loop longer instead of making every card whip past.
            "--marquee-duration": `${FEATURES.length * SECONDS_PER_CARD}s`,
          }}
        >
          {Array.from({ length: COPIES }).flatMap((_, copy) =>
            FEATURES.map((f) => (
              <button
                key={`${copy}-${f.label}`}
                type="button"
                onClick={() => setOpen(f)}
                // Only the first copy is real content; the rest are visual
                // padding, and announcing the same fifteen features three times
                // is just noise in a screen reader.
                aria-hidden={copy > 0 || undefined}
                tabIndex={copy > 0 ? -1 : undefined}
                className="group/card flex h-[168px] w-[280px] shrink-0 flex-col items-start gap-3 rounded-2xl border bg-card/60 p-5 text-left transition-all hover:-translate-y-1 hover:border-primary/40 hover:bg-card hover:shadow-xl hover:shadow-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-transform group-hover/card:scale-110">
                  <f.icon size={18} />
                </span>
                <div className="min-w-0 leading-snug">
                  <div className="text-[15px] font-medium group-hover/card:text-primary">
                    {t(f.label)}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{t(f.note)}</div>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Edge fades, so cards enter and leave instead of being chopped off at
            the band's edges. Pointer-events off or they'd eat the hover that
            pauses the track. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-background via-background/50 to-transparent"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-background via-background/50 to-transparent"
        />
      </div>

      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="sm:max-w-md">
          {open && (
            <>
              <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <open.icon size={22} />
              </div>
              <DialogTitle className="text-xl">{t(open.label)}</DialogTitle>
              <DialogDescription className="text-sm leading-relaxed">
                {t(open.blurb)}
              </DialogDescription>
              <Button variant="secondary" className="mt-2 w-full gap-2" onClick={next}>
                {t("Next feature")}
                <ArrowRight size={16} />
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Homepage() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const t = useT();

  const signIn = async () => {
    setBusy(true);
    setErr(null);
    // If we're gating an invite landing (LoginGate renders this page in place of
    // /accept-invite/:id, so the URL is still the invite), return the user THERE
    // after OAuth instead of the app root — otherwise the invite id + token are
    // lost across the redirect and a brand-new user lands on an empty project.
    // Same-origin path only, so there's nothing to open-redirect to.
    const callbackURL = window.location.pathname.startsWith("/accept-invite/")
      ? window.location.pathname + window.location.search
      : "/";
    try {
      if (isDesktop) {
        // Desktop (TOO-21): ask Better Auth for the authorize URL without
        // navigating, hand it to the main process, which runs the flow in a
        // child window sharing the app's session — the callback lands on the
        // Worker's existing redirect URI and the session cookie is set into
        // the Electron cookie jar. Then reload to pick the session up.
        const { data, error } = await authClient.signIn.social({
          provider: "google",
          callbackURL,
          disableRedirect: true,
        });
        if (error) throw new Error(error.message || "Sign-in failed");
        if (!data?.url) throw new Error("No authorize URL returned");
        const res = await desktop.oauth.start(data.url);
        if (!res?.ok) {
          throw new Error(res?.reason === "closed" ? "Sign-in window closed" : "Sign-in timed out");
        }
        window.location.reload();
        return;
      }
      // Web: redirects to Google and back to /api/auth/callback/google;
      // Better Auth creates the session, then returns to callbackURL ("/").
      await authClient.signIn.social({ provider: "google", callbackURL });
    } catch (e) {
      setErr(String(e?.message || e));
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-6 py-12">
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 size-[46rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />

      <div className="relative w-full max-w-2xl">
        <div className="flex flex-col items-center text-center">
          <div className="flex items-center gap-3">
            {/* The app mark, as a full-bleed rounded tile. Two files rather than
                one: the artwork's glow/paper background is baked in, so the
                neon-on-black cut is the DARK one and the pastel-on-white cut is
                the light one — swapping tints on a single image would kill the
                glow. `dark:` picks between them so the mark stays right if the
                light theme is ever re-enabled. */}
            <div className="size-[95px] overflow-hidden rounded-[19px] shadow-lg shadow-primary/20">
              <img
                src="/logo-mark-dark.png"
                alt=""
                width={95}
                height={95}
                className="hidden size-full object-cover dark:block"
              />
              <img
                src="/logo-mark-light.png"
                alt=""
                width={95}
                height={95}
                className="size-full object-cover dark:hidden"
              />
            </div>
            <div className="text-left leading-tight">
              <div className="text-3xl font-semibold tracking-tight">StorySeam</div>
            </div>
          </div>

          <h1 className="mt-8 max-w-xl text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            {t("Write, storyboard, render and cut an")} <span className="text-primary">{t("episode")}</span> {t("in one place")}
          </h1>
          <p className="mt-3 max-w-lg text-sm text-muted-foreground">
            {t("StorySeam is a workspace for making short animated episodes. Draft the script, build the shot list, generate the images, video and sound, then assemble the cut on a timeline — with a chat agent that can drive any step for you.")}
          </p>

          <FeatureMarquee />

          <div className="mt-9 flex w-full flex-col items-center gap-3">
            <Button size="lg" className="w-full max-w-xs gap-2 font-medium" disabled={busy} onClick={signIn}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : null}
              {t("Sign in with Google")}
              {!busy ? <ArrowRight size={16} /> : null}
            </Button>
            {/* State the scope plainly. These are exactly the scopes the
                authorize URL asks for (email + profile + openid) — if that ever
                changes, change this sentence with it. */}
            <p className="max-w-sm text-xs text-muted-foreground">
              {t("Google sign-in is only used to create your StorySeam account — it shares your name, email address and profile picture. StorySeam never posts on your behalf and reads nothing else from your Google account.")}
            </p>
            {err ? <p className="max-w-sm text-center text-xs text-destructive">{err}</p> : null}
          </div>

          <p className="mt-6 max-w-lg border-t pt-6 text-xs leading-relaxed text-muted-foreground">
            {t("Generation runs on a rendering account you connect yourself — Higgsfield, fal.ai or Atlas Cloud — so images, video and audio bill to you. StorySeam is not affiliated with those services. API keys you paste are kept in this browser only and are never stored on our servers.")}
          </p>

          {/* Reachable WITHOUT signing in — /privacy and /terms are routed as
              siblings of RootLayout so this link works for a signed-out
              visitor. See router.jsx. */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <Link to="/privacy" className="underline-offset-4 hover:text-foreground hover:underline">
              {t("Privacy")}
            </Link>
            <Link to="/terms" className="underline-offset-4 hover:text-foreground hover:underline">
              {t("Terms")}
            </Link>
            <a
              href="mailto:privacy@storyseam.app"
              className="underline-offset-4 hover:text-foreground hover:underline"
            >
              {t("Contact")}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

// Mandatory render-key step (after login, before the app shell). One key from
// EITHER BYOK provider (fal.ai or Atlas Cloud) unlocks the app; generations
// bill the USER'S account, and the key never leaves this browser except as a
// per-request header to our workers.
const KEY_PROVIDERS = [
  { id: "fal", label: "fal.ai", save: setFalKey, keysUrl: "https://fal.ai/dashboard/keys", placeholder: "key_id:key_secret" },
  { id: "atlas", label: "Atlas Cloud", save: setAtlasKey, keysUrl: "https://www.atlascloud.ai/console/api-keys", placeholder: "Atlas API key" },
];

function ProviderKeyScreen({ userEmail }) {
  const [pick, setPick] = useState(KEY_PROVIDERS[0]);
  const [draft, setDraft] = useState("");
  const plausible = /^[\w:.-]{10,200}$/.test(draft.trim());
  const t = useT();

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-6 py-12">
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 size-[46rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />
      <div className="relative w-full max-w-md">
        <div className="flex flex-col items-center text-center">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
            <KeyRound size={22} />
          </span>
          <h1 className="mt-6 text-balance text-2xl font-semibold tracking-tight">
            {t("Connect a")} <span className="text-primary">{t("render key")}</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("StorySeam renders images and video with your own account — paste a fal.ai or Atlas Cloud API key to continue. It is stored")} <b>{t("only in this browser")}</b>{t(", never on our servers, and you can add the other provider later in Settings.")}
          </p>

          <div className="mt-6 flex gap-1 rounded-lg border bg-card/60 p-1" role="tablist" aria-label={t("Key provider")}>
            {KEY_PROVIDERS.map((p) => (
              <Button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={pick.id === p.id}
                size="sm"
                variant={pick.id === p.id ? "secondary" : "ghost"}
                onClick={() => { setPick(p); setDraft(""); }}
              >
                {p.label}
              </Button>
            ))}
          </div>

          <form
            className="mt-4 w-full space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!plausible) return;
              // Saving a key also SELECTS that provider — this screen only
              // shows when the selected BYOK provider has no key, so pasting
              // the other provider's key must switch the selection to unlock.
              pick.save(draft);
              setActiveProvider(pick.id);
            }}
          >
            <Input
              type="password"
              autoComplete="off"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t(pick.placeholder)}
              className="h-10 font-mono text-sm"
              aria-label={`${pick.label} API key`}
            />
            <Button type="submit" size="lg" className="w-full gap-2 font-medium" disabled={!plausible}>
              {t("Save & continue")}
              <ArrowRight size={16} />
            </Button>
          </form>

          <a
            href={pick.keysUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {t("Create a key on")} {pick.label} <ExternalLink size={12} />
          </a>

          {/* This screen only shows when the selected BYOK provider has no key —
              offer the way over to Higgsfield (the gate asks to connect it if
              the account isn't linked yet). */}
          <button
            type="button"
            onClick={() => setActiveProvider("higgsfield")}
            className="mt-3 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {t("Or render with a Higgsfield account instead")}
          </button>

          <SkipForNow />

          <SignedInFooter userEmail={userEmail} />
        </div>
      </div>
    </div>
  );
}

// Dismiss the render-provider step and drop into the app. The app still nudges
// to connect one at the point of generation (components/ProviderGate.jsx), and
// it stays editable in Settings, so skipping is safe and reversible.
function SkipForNow() {
  const t = useT();
  return (
    <div className="mt-6 w-full border-t pt-5">
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground"
        onClick={() => setSetupSkipped(true)}
      >
        {t("Skip for now — I'll connect a provider later")}
        <ArrowRight size={14} />
      </Button>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {t("You can write the script and use the chat agent right away; connect a provider in Settings when you're ready to generate.")}
      </p>
    </div>
  );
}

function SignedInFooter({ userEmail }) {
  const t = useT();
  return (
    <div className="mt-8 flex items-center gap-2 text-xs text-muted-foreground">
      {userEmail ? <span>{t("Signed in as")} {userEmail}</span> : null}
      <button
        type="button"
        onClick={() => signOut()}
        className="inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline"
      >
        <LogOut size={12} /> {t("Sign out")}
      </button>
    </div>
  );
}

// Shown when Higgsfield is the selected render provider but the signed-in user
// hasn't linked a Higgsfield account yet (sign-in is Google now, so the link is
// a separate one-tap OAuth flow). Connecting stores the per-user Higgsfield
// token server-side; the alternative is switching to a BYOK provider, which
// swaps this screen for the key one.
function HiggsfieldConnectScreen({ userEmail }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const t = useT();

  const connect = async () => {
    setBusy(true);
    setErr(null);
    try {
      await connectHiggsfield("/");
      // Web navigates away to Higgsfield; desktop resolves in-place once the
      // child window finishes, and the refreshed account list unblocks the gate.
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-6 py-12">
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 size-[46rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />
      <div className="relative w-full max-w-md">
        <div className="flex flex-col items-center text-center">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
            <Cable size={22} />
          </span>
          <h1 className="mt-6 text-balance text-2xl font-semibold tracking-tight">
            {t("Connect")} <span className="text-primary">Higgsfield</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("StorySeam is set to render with Higgsfield, but this account isn't linked yet. Connect your Higgsfield account once and every image, video & audio generation bills it — you can manage the connection later in Settings.")}
          </p>

          <Button size="lg" className="mt-6 w-full max-w-xs gap-2 font-medium" disabled={busy} onClick={connect}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : null}
            {t("Connect Higgsfield")}
            {!busy ? <ArrowRight size={16} /> : null}
          </Button>
          {err ? <p className="mt-2 max-w-sm text-center text-xs text-destructive">{err}</p> : null}

          <button
            type="button"
            onClick={() => setActiveProvider("fal")}
            className="mt-4 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {t("Or render with your own fal.ai / Atlas Cloud key instead")}
          </button>

          <SkipForNow />

          <SignedInFooter userEmail={userEmail} />
        </div>
      </div>
    </div>
  );
}

export default function LoginGate({ children }) {
  const { data: session, isPending } = useSession();
  const location = useLocation();
  // Stash any invite link the moment we arrive on it — BEFORE the sign-in
  // redirect or the provider-connect gate can navigate away and lose the id +
  // token. PendingInviteModal replays it once the user is inside the app. Runs
  // for both a signed-out visitor (homepage renders in place of the invite
  // route) and a signed-in one still stuck behind the provider gate.
  useEffect(() => { captureInviteFromLocation(); }, [location.pathname, location.search]);
  const falKey = useFalKey();
  const atlasKey = useAtlasKey();
  const prefs = useProviderPrefs();
  const hfLinked = useHiggsfieldLinked();
  const skipped = useSetupSkipped();
  if (isPending) return <Splash />;
  if (!session) return <Homepage />;
  // Connecting a render provider is now a soft onboarding step, not a wall: a
  // user who taps "I'll do this later" (setSetupSkipped) drops straight into the
  // app to chat, write the script and plan. The nudge to connect one then moves
  // to the point of use — a modal when they try to generate (components/
  // ProviderGate.jsx) and a settings card the agent draws (whistlewood.ts). The
  // provider stays fully editable in Settings.
  if (skipped) return children;
  // Exactly one provider is in use at a time, and the gate prompts for the
  // SELECTED provider's credential: Higgsfield needs its account linked (null =
  // the account list is still loading — hold the splash rather than flashing
  // the connect screen at someone who is connected; "error" = couldn't fetch
  // the list — let the app through and let renders surface their own 401
  // instead of deadlocking here), a BYOK provider its key.
  if (prefs.active === "higgsfield") {
    if (hfLinked === null) return <Splash />;
    if (hfLinked === false) return <HiggsfieldConnectScreen userEmail={session.user?.email} />;
  }
  const needKey =
    (prefs.active === "fal" && !falKey) || (prefs.active === "atlas" && !atlasKey);
  if (needKey) return <ProviderKeyScreen userEmail={session.user?.email} />;
  return children;
}
