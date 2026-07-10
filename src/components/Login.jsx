// App login gate — "Sign in with Higgsfield". One OAuth flow yields both the
// app account (Better Auth session) and the per-user Higgsfield generation
// token. Wraps the whole app: shows a branded sign-in card until there's a
// session, then the app. The signed-in user owns their own projects.
import { useState } from "react";
import { useSession, authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles } from "lucide-react";

function Splash() {
  return (
    <div className="flex h-dvh items-center justify-center bg-background">
      <Loader2 className="size-6 animate-spin text-primary" />
    </div>
  );
}

function AuthCard() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const signInHiggsfield = async () => {
    setBusy(true);
    setErr(null);
    try {
      await authClient.signIn.oauth2({ providerId: "higgsfield", callbackURL: "/" });
      // On success the browser redirects to Higgsfield and back; the gate then
      // swaps to the app. If it returns without redirecting, surface any error.
    } catch (e) {
      setErr(String(e?.message || e));
      setBusy(false);
    }
  };

  return (
    <div className="relative flex h-dvh items-center justify-center overflow-hidden bg-background px-4">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[46rem] w-[72rem] max-w-[95vw] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />
      <div className="relative w-full max-w-sm rounded-2xl border bg-card p-8 shadow-xl">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src="/logo-icon-shot-studio.png" alt="shot-studio" className="size-16 rounded-2xl object-cover shadow-lg shadow-primary/20" />
          <h1 className="mt-4 text-lg font-semibold tracking-tight">shot-studio</h1>
          <p className="text-sm text-muted-foreground">The agent-driven UI for visual storytelling</p>
        </div>

        {err && (
          <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {err}
          </div>
        )}

        <Button type="button" className="w-full gap-2" disabled={busy} onClick={signInHiggsfield}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles size={16} />} Continue with Higgsfield
        </Button>

        <p className="mt-5 text-center text-[11px] text-muted-foreground">
          Signing in connects your Higgsfield account for generation.
        </p>
      </div>
    </div>
  );
}

export default function LoginGate({ children }) {
  const { data: session, isPending } = useSession();
  if (isPending) return <Splash />;
  if (!session) return <AuthCard />;
  return children;
}
