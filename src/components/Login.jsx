// App login gate — the branded Shot Studio homepage with "Sign in with
// Higgsfield". One Higgsfield OAuth flow (Better Auth genericOAuth) creates an
// internal user + links the Higgsfield account/token. Gated on the Better Auth
// session; the signed-in user owns their own projects.
//
// After the session exists a SECOND mandatory gate asks for the user's fal.ai
// API key (BYOK): it lives only in this browser's localStorage (lib/falKey.js)
// and rides per-request to the workers — never stored server-side. The app
// shell doesn't render until both gates pass; the key stays editable on the
// Settings page.
import { useState } from "react";
import {
  Clapperboard, Bot, PenLine, Workflow, Film, ListVideo, AudioLines, Loader2, ArrowRight,
  KeyRound, ExternalLink, LogOut,
} from "lucide-react";
import { useSession, authClient, signOut } from "@/lib/auth-client";
import { useFalKey, setFalKey } from "@/lib/falKey";
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

  const signIn = async () => {
    setBusy(true);
    setErr(null);
    try {
      // Redirects to Higgsfield and back to /api/auth/oauth2/callback/higgsfield;
      // Better Auth creates the session, then returns to callbackURL ("/").
      await authClient.signIn.oauth2({ providerId: "higgsfield", callbackURL: "/" });
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
              <div className="text-xl font-semibold tracking-tight">Shot Studio</div>
              <div className="text-xs text-muted-foreground">
                powered by <span className="font-medium text-foreground">Higgsfield</span>
              </div>
            </div>
          </div>

          <h1 className="mt-8 max-w-xl text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            The missing <span className="text-primary">agent-driven UI</span> to create visual masterpieces
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Chat agent, script writing, nodes, episodes, shotlist and sound studio — all in one.
          </p>

          <div className="mt-8 grid w-full grid-cols-2 gap-2.5 sm:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.label} className="flex items-start gap-2.5 rounded-xl border bg-card/60 p-3 text-left">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <f.icon size={16} />
                </span>
                <div className="min-w-0 leading-tight">
                  <div className="text-sm font-medium">{f.label}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{f.note}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-9 flex w-full flex-col items-center gap-3">
            <Button size="lg" className="w-full max-w-xs gap-2 font-medium" disabled={busy} onClick={signIn}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : null}
              Sign in with Higgsfield
              {!busy ? <ArrowRight size={16} /> : null}
            </Button>
            <p className="text-xs text-muted-foreground">
              Sign in with your Higgsfield account to unlock image, video &amp; audio generation.
            </p>
            {err ? <p className="max-w-sm text-center text-xs text-destructive">{err}</p> : null}
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

// Mandatory fal.ai key step (after login, before the app shell). The key is the
// user's own — generations bill THEIR fal account — and it never leaves this
// browser except as a per-request header to our workers.
function FalKeyScreen({ userEmail }) {
  const [draft, setDraft] = useState("");
  const plausible = /^[\w:.-]{10,200}$/.test(draft.trim());

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-6 py-12">
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 size-[46rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />
      <div className="relative w-full max-w-md">
        <div className="flex flex-col items-center text-center">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
            <KeyRound size={22} />
          </span>
          <h1 className="mt-6 text-balance text-2xl font-semibold tracking-tight">
            Connect your <span className="text-primary">fal.ai</span> key
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Shot Studio renders images and video with your own fal.ai account. Paste an
            API key to continue — it is stored <b>only in this browser</b>, never on our
            servers, and you can change it later in Settings.
          </p>

          <form
            className="mt-7 w-full space-y-3"
            onSubmit={(e) => { e.preventDefault(); if (plausible) setFalKey(draft); }}
          >
            <Input
              type="password"
              autoComplete="off"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="key_id:key_secret"
              className="h-10 font-mono text-sm"
              aria-label="fal.ai API key"
            />
            <Button type="submit" size="lg" className="w-full gap-2 font-medium" disabled={!plausible}>
              Save &amp; continue
              <ArrowRight size={16} />
            </Button>
          </form>

          <a
            href="https://fal.ai/dashboard/keys"
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Create a key on fal.ai <ExternalLink size={12} />
          </a>

          <div className="mt-8 flex items-center gap-2 text-xs text-muted-foreground">
            {userEmail ? <span>Signed in as {userEmail}</span> : null}
            <button
              type="button"
              onClick={() => signOut()}
              className="inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline"
            >
              <LogOut size={12} /> Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginGate({ children }) {
  const { data: session, isPending } = useSession();
  const falKey = useFalKey();
  if (isPending) return <Splash />;
  if (!session) return <Homepage />;
  if (!falKey) return <FalKeyScreen userEmail={session.user?.email} />;
  return children;
}
