// App login gate — the branded Shot Studio homepage with "Sign in with
// Higgsfield". One Higgsfield OAuth flow (Better Auth genericOAuth) creates an
// internal user + links the Higgsfield account/token. Gated on the Better Auth
// session; the signed-in user owns their own projects.
import { useState } from "react";
import {
  Clapperboard, Bot, PenLine, Workflow, Film, ListVideo, AudioLines, Loader2, ArrowRight,
} from "lucide-react";
import { useSession, authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

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

export default function LoginGate({ children }) {
  const { data: session, isPending } = useSession();
  if (isPending) return <Splash />;
  if (!session) return <Homepage />;
  return children;
}
