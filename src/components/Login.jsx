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
import { useState } from "react";
import { Link } from "react-router";
import {
  Clapperboard, Bot, PenLine, Workflow, Film, ListVideo, AudioLines, Loader2, ArrowRight,
  KeyRound, ExternalLink, LogOut, Cable,
} from "lucide-react";
import { useSession, authClient, signOut } from "@/lib/auth-client";
import { useHiggsfieldLinked, connectHiggsfield } from "@/lib/higgsfieldAccount";
import { desktop, isDesktop } from "@/lib/desktop";
import { useFalKey, setFalKey } from "@/lib/falKey";
import { useAtlasKey, setAtlasKey } from "@/lib/atlasKey";
import { useProviderPrefs, setActiveProvider } from "@/lib/providers";
import { useT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const FEATURES = [
  { icon: Bot, label: "Chat agent", note: "Drives the whole pipeline" },
  { icon: PenLine, label: "Script writing", note: "Draft & revise the episode" },
  { icon: Workflow, label: "Nodes", note: "Wire the shot graph" },
  { icon: Film, label: "Episodes", note: "Plan & stitch the cut" },
  { icon: ListVideo, label: "Shotlist", note: "Seedance shot-by-shot" },
  { icon: AudioLines, label: "Sound studio", note: "Seed Audio design" },
];

function Homepage() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const t = useT();

  const signIn = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (isDesktop) {
        // Desktop (TOO-21): ask Better Auth for the authorize URL without
        // navigating, hand it to the main process, which runs the flow in a
        // child window sharing the app's session — the callback lands on the
        // Worker's existing redirect URI and the session cookie is set into
        // the Electron cookie jar. Then reload to pick the session up.
        const { data, error } = await authClient.signIn.social({
          provider: "google",
          callbackURL: "/",
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
      await authClient.signIn.social({ provider: "google", callbackURL: "/" });
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
            <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
              <Clapperboard size={24} />
            </div>
            <div className="text-left leading-tight">
              <div className="text-xl font-semibold tracking-tight">StorySeam</div>
              <div className="text-xs text-muted-foreground">storyseam.app</div>
            </div>
          </div>

          <h1 className="mt-8 max-w-xl text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            {t("Write, storyboard, render and cut an")} <span className="text-primary">{t("episode")}</span> {t("in one place")}
          </h1>
          <p className="mt-3 max-w-lg text-sm text-muted-foreground">
            {t("StorySeam is a workspace for making short animated episodes. Draft the script, build the shot list, generate the images, video and sound, then assemble the cut on a timeline — with a chat agent that can drive any step for you.")}
          </p>

          <div className="mt-8 grid w-full grid-cols-2 gap-2.5 sm:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.label} className="flex items-start gap-2.5 rounded-xl border bg-card/60 p-3 text-left">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <f.icon size={16} />
                </span>
                <div className="min-w-0 leading-tight">
                  <div className="text-sm font-medium">{t(f.label)}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{t(f.note)}</div>
                </div>
              </div>
            ))}
          </div>

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

          <SignedInFooter userEmail={userEmail} />
        </div>
      </div>
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

          <SignedInFooter userEmail={userEmail} />
        </div>
      </div>
    </div>
  );
}

export default function LoginGate({ children }) {
  const { data: session, isPending } = useSession();
  const falKey = useFalKey();
  const atlasKey = useAtlasKey();
  const prefs = useProviderPrefs();
  const hfLinked = useHiggsfieldLinked();
  if (isPending) return <Splash />;
  if (!session) return <Homepage />;
  // Exactly one provider is in use at a time, and the gate blocks on the
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
