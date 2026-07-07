import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Clapperboard,
  Bot,
  PenLine,
  Workflow,
  Film,
  ListVideo,
  AudioLines,
  ExternalLink,
  Loader2,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAgent, agentIsBusy } from "@/components/AgentProvider";

// ---------------------------------------------------------------------------
// App login gate. Shot Studio is gated behind a Higgsfield sign-in — the same
// OAuth (authorization-code + PKCE) the render skills use. We ask the server
// whether a Higgsfield credential exists (`/api/auth/status`); if not, we show
// the branded homepage, kick the agent to establish the Higgsfield connection
// (which surfaces the sign-in URL), and poll until the credential lands.
// ---------------------------------------------------------------------------

const FEATURES = [
  { icon: Bot, label: "Chat agent", note: "Drives the whole pipeline" },
  { icon: PenLine, label: "Script writing", note: "Draft & revise the episode" },
  { icon: Workflow, label: "Nodes", note: "Wire the shot graph" },
  { icon: Film, label: "Episodes", note: "Plan & stitch the cut" },
  { icon: ListVideo, label: "Shotlist", note: "Seedance shot-by-shot" },
  { icon: AudioLines, label: "Sound studio", note: "Seed Audio design" },
];

// The Higgsfield sign-in URL, if the agent has surfaced an authorization
// challenge in the current conversation.
function findHiggsfieldAuthUrl(messages) {
  for (const m of messages || []) {
    for (const p of m.parts || []) {
      if (
        p.type === "authorization" &&
        p.state === "required" &&
        /higgsfield/i.test(p.displayName || p.name || "") &&
        p.authorization?.url
      ) {
        return p.authorization.url;
      }
    }
  }
  return null;
}

function Homepage({ onSignedIn, recheck }) {
  const agent = useAgent();
  const [starting, setStarting] = useState(false);
  const openedRef = useRef(false);

  const messages = agent.data?.messages ?? [];
  const authUrl = useMemo(() => findHiggsfieldAuthUrl(messages), [messages]);

  // Once the sign-in URL appears, open it once automatically (best effort — a
  // blocked popup just falls back to the visible button).
  useEffect(() => {
    if (authUrl && !openedRef.current) {
      openedRef.current = true;
      window.open(authUrl, "_blank", "noopener,noreferrer");
    }
  }, [authUrl]);

  // While a sign-in is in flight, poll the server until the credential lands.
  useEffect(() => {
    if (!starting) return;
    const id = setInterval(async () => {
      if (await recheck()) {
        clearInterval(id);
        onSignedIn();
      }
    }, 2500);
    return () => clearInterval(id);
  }, [starting, recheck, onSignedIn]);

  const signIn = async () => {
    setStarting(true);
    openedRef.current = false;
    try {
      if (!agentIsBusy(agent)) {
        await agent.send({
          message:
            "Connect my Higgsfield account so I can sign in to Shot Studio. Call a lightweight " +
            "Higgsfield tool (like checking my balance) to surface the sign-in prompt — do not " +
            "generate any media.",
        });
      }
    } catch {
      /* the challenge / error still renders in the agent state */
    }
  };

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-6 py-12">
      {/* soft lime glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 size-[46rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl"
      />

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
            The missing <span className="text-primary">agent-driven UI</span> to create visual
            masterpieces
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Chat agent, script writing, nodes, episodes, shotlist and sound studio — all in one.
          </p>

          {/* feature grid */}
          <div className="mt-8 grid w-full grid-cols-2 gap-2.5 sm:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.label}
                className="flex items-start gap-2.5 rounded-xl border bg-card/60 p-3 text-left"
              >
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

          {/* sign-in */}
          <div className="mt-9 flex w-full flex-col items-center gap-3">
            {!starting ? (
              <Button size="lg" className="w-full max-w-xs gap-2 font-medium" onClick={signIn}>
                Sign in with Higgsfield
                <ArrowRight size={16} />
              </Button>
            ) : authUrl ? (
              <>
                <Button asChild size="lg" className="w-full max-w-xs gap-2 font-medium">
                  <a href={authUrl} target="_blank" rel="noopener noreferrer">
                    Continue to Higgsfield sign-in
                    <ExternalLink size={16} />
                  </a>
                </Button>
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 size={13} className="animate-spin" />
                  Waiting for you to finish signing in…
                </p>
              </>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 size={15} className="animate-spin" />
                Opening the Higgsfield sign-in…
              </p>
            )}

            {starting ? (
              <button
                type="button"
                onClick={recheck}
                className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                I&apos;ve signed in — continue
              </button>
            ) : (
              <p className="text-xs text-muted-foreground">
                Sign in with your Higgsfield account to unlock image, video &amp; audio generation.
              </p>
            )}

            {agent.error && starting ? (
              <p className="max-w-sm text-center text-xs text-destructive">
                {agent.error.message}
              </p>
            ) : null}
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
  const [status, setStatus] = useState("checking"); // checking | out | in

  const check = useCallback(async () => {
    try {
      const r = await fetch("/api/auth/status");
      const d = await r.json();
      setStatus(d.loggedIn ? "in" : "out");
      return Boolean(d.loggedIn);
    } catch {
      setStatus("out");
      return false;
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  if (status === "checking") return <Splash />;
  if (status === "in") return children;
  return <Homepage onSignedIn={() => setStatus("in")} recheck={check} />;
}
