// App login gate — the branded Shot Studio homepage with "Sign in with
// Higgsfield". One Higgsfield OAuth flow (Better Auth genericOAuth) creates an
// internal user + links the Higgsfield account/token. Gated on the Better Auth
// session; the signed-in user owns their own projects.
//
// After the session exists a SECOND gate may ask for a render API key (BYOK) —
// the user's own fal.ai OR Atlas Cloud key: it lives only in this browser's
// localStorage (lib/falKey.js / lib/atlasKey.js) and rides per-request to the
// workers — never stored server-side. The Higgsfield sign-in itself is a full
// render credential, so this gate only blocks when Higgsfield is toggled OFF
// in the provider prefs AND no BYOK key exists; keys and provider toggles stay
// editable on the Settings page (Providers panel).
import { useState } from "react";
import {
  Clapperboard, Bot, PenLine, Workflow, Film, ListVideo, AudioLines, Loader2, ArrowRight,
  KeyRound, ExternalLink, LogOut,
} from "lucide-react";
import { useSession, authClient, signOut } from "@/lib/auth-client";
import { desktop, isDesktop } from "@/lib/desktop";
import { useFalKey, setFalKey } from "@/lib/falKey";
import { useAtlasKey, setAtlasKey } from "@/lib/atlasKey";
import { useProviderPrefs, setActiveProvider } from "@/lib/providers";
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
      if (isDesktop) {
        // Desktop (TOO-21): ask Better Auth for the authorize URL without
        // navigating, hand it to the main process, which runs the flow in a
        // child window sharing the app's session — the callback lands on the
        // Worker's existing redirect URI and the session cookie is set into
        // the Electron cookie jar. Then reload to pick the session up.
        const { data, error } = await authClient.signIn.oauth2({
          providerId: "higgsfield",
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
      // Web: redirects to Higgsfield and back to /api/auth/oauth2/callback/
      // higgsfield; Better Auth creates the session, then returns to
      // callbackURL ("/").
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

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-6 py-12">
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 size-[46rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />
      <div className="relative w-full max-w-md">
        <div className="flex flex-col items-center text-center">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
            <KeyRound size={22} />
          </span>
          <h1 className="mt-6 text-balance text-2xl font-semibold tracking-tight">
            Connect a <span className="text-primary">render key</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Shot Studio renders images and video with your own account — paste a fal.ai
            or Atlas Cloud API key to continue. It is stored <b>only in this browser</b>,
            never on our servers, and you can add the other provider later in Settings.
          </p>

          <div className="mt-6 flex gap-1 rounded-lg border bg-card/60 p-1" role="tablist" aria-label="Key provider">
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
              placeholder={pick.placeholder}
              className="h-10 font-mono text-sm"
              aria-label={`${pick.label} API key`}
            />
            <Button type="submit" size="lg" className="w-full gap-2 font-medium" disabled={!plausible}>
              Save &amp; continue
              <ArrowRight size={16} />
            </Button>
          </form>

          <a
            href={pick.keysUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Create a key on {pick.label} <ExternalLink size={12} />
          </a>

          {/* This screen only shows when the selected BYOK provider has no key —
              offer the way back (Higgsfield's credential is the sign-in itself). */}
          <button
            type="button"
            onClick={() => setActiveProvider("higgsfield")}
            className="mt-3 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Or switch to Higgsfield and render with your sign-in
          </button>

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
  const atlasKey = useAtlasKey();
  const prefs = useProviderPrefs();
  if (isPending) return <Splash />;
  if (!session) return <Homepage />;
  // Exactly one provider is in use at a time. The Higgsfield sign-in is its
  // own credential; a selected BYOK provider needs its key before the app can
  // render — so gate only when the SELECTED provider's key is missing.
  const needKey =
    (prefs.active === "fal" && !falKey) || (prefs.active === "atlas" && !atlasKey);
  if (needKey) return <ProviderKeyScreen userEmail={session.user?.email} />;
  return children;
}
