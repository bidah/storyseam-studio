import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, ExternalLink, Clapperboard, Sun, Moon, LogOut, User } from "lucide-react";
import { Glowing } from "glowing";
import { cn } from "@/lib/utils";
import { CLIENT_ID } from "@/lib/clientId";
import AgentChat from "@/components/AgentChat";
import LoginGate from "@/components/Login";
import ProjectProvider from "@/components/ProjectProvider";
import ProjectSwitcher from "@/components/ProjectSwitcher";
import { onProjectChange } from "@/lib/projectFetch";
import { clearTabCache } from "@/lib/tabCache";
import { signOut as authSignOut } from "@/lib/auth-client";
import ScriptEditor from "@/components/ScriptEditor";
import Editor from "@/components/Editor";
import { AgentProvider } from "@/components/AgentProvider";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MultiShot } from "@/routes/multishot";
import { Episode } from "@/routes/episode";
import { ShotList } from "@/routes/shotlist";
import { CompleteCuts } from "@/routes/cuts";
import { Library } from "@/routes/library";
import { SoundStudio } from "@/routes/sounds";
import { Shots } from "@/routes/shots";
import { ImageModal } from "@/components/shared";

/* ---------------------------------------------------------------- *
 * App shell                                                        *
 * ---------------------------------------------------------------- */

const TABS = [
  { value: "script", label: "Script" },
  { value: "shotlist", label: "Shot list" },
  // Sample-code tabs — kept wired up (routes/content still work) but hidden from
  // the top menu. Drop `hidden` to surface them again.
  { value: "shots", label: "Shots", hidden: true },
  { value: "multishot", label: "Multi-shot", hidden: true },
  { value: "episode", label: "Episode (48)" },
  { value: "cuts", label: "Complete cuts" },
  { value: "editor", label: "Editor" },
  { value: "library", label: "Library" },
  { value: "sounds", label: "Sound studio" },
];

// Brand-lime glow (matches the Higgsfield primary) for the "route being edited"
// cue on the Script tab. `colors` alternates the glow hue with black so the
// glowing library's gradient reads as a lime shimmer.
const GLOW_OPTS = {
  colors: ["#cbf74e", "#000000", "#a3e635", "#000000", "#cbf74e"],
  colors2: ["#ffffff", "#000000", "#000000", "#ffffff"],
  width: 3,
  rotationDuration: 2200,
  glowingBlurRatio: 1.4,
};

// Glow the element matching `selector` (a DOM query, since radix TabsTrigger
// doesn't forward refs) while `active` is true — created on activation, removed
// on deactivation / unmount.
function useGlow(selector, active, options) {
  useEffect(() => {
    if (!active) return;
    const el = document.querySelector(selector);
    if (!el) return;
    const glow = new Glowing(el, options);
    return () => glow.remove();
  }, [selector, active, options]);
}

// Subscribe to the Script live-update stream. Returns a counter that bumps on
// every edit made ELSEWHERE (the chat agent) — not this tab's own saves — so the
// Script editor can reload and the tab can glow.
function useScriptLiveEdits() {
  const [edits, setEdits] = useState(0);
  useEffect(() => {
    const es = new EventSource("/api/script/events");
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.clientId !== CLIENT_ID) setEdits((n) => n + 1);
      } catch {
        /* ignore malformed frames / heartbeats */
      }
    };
    return () => es.close();
  }, []);
  return edits;
}

// Subscribe to the generic live-sync firehose (every /api mutation except script
// & timeline, which have their own streams). Returns a counter that bumps on each
// change made ELSEWHERE (the chat agent) — not this tab's own writes — so the
// whole app can refetch and reflect the agent's edits without a manual Refresh.
function useDataLiveEdits() {
  const [edits, setEdits] = useState(0);
  useEffect(() => {
    const es = new EventSource("/api/data/events");
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.clientId !== CLIENT_ID) setEdits((n) => n + 1);
      } catch {
        /* ignore malformed frames / heartbeats */
      }
    };
    return () => es.close();
  }, []);
  return edits;
}

function ThemeToggle() {
  const [dark, setDark] = useState(() =>
    typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : true
  );
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label="Toggle theme">
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{dark ? "Light mode" : "Dark mode"}</TooltipContent>
    </Tooltip>
  );
}

// Account menu — the shadcn avatar in the header opens a dropdown with a link
// to higgsfield.ai and a sign-out that drops the Higgsfield credential and
// re-gates the app (reload → LoginGate re-checks → homepage).
function UserMenu() {
  const signOut = async () => {
    try {
      await authSignOut();
    } catch {
      /* reload re-gates regardless of the request outcome */
    }
    window.location.reload();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary/10 text-primary">
              <User size={16} />
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Higgsfield account</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href="https://higgsfield.ai" target="_blank" rel="noopener noreferrer">
            <ExternalLink size={14} /> Visit higgsfield.ai
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={signOut}>
          <LogOut size={14} /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function App() {
  const [view, setView] = useState("script");
  const [shots, setShots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [projectKey, setProjectKey] = useState(0);
  const [modalImage, setModalImage] = useState(null);

  // Switching projects (from the header ProjectSwitcher) changes the id in the
  // fetch shim; re-fetch every tab and remount the body so no stale project
  // data lingers.
  useEffect(() => onProjectChange(() => {
    clearTabCache(); // per-tab caches hold the OLD project's payloads — drop them
    setReloadKey((k) => k + 1);
    setProjectKey((k) => k + 1);
  }), []);

  // Cross-tab jump: the Complete-cut overlay calls navigateTo({ view, anchor })
  // to switch tabs and scroll to a bundle / sound card. The target tab remounts
  // and loads async, so we retry finding the anchor for a few seconds, then
  // flash it. { view, anchor, nonce } — nonce lets the same target re-trigger.
  const [navTarget, setNavTarget] = useState(null);
  const navNonce = useRef(0);
  const navigateTo = useCallback(({ view: v, anchor }) => {
    navNonce.current += 1;
    setNavTarget({ view: v, anchor, nonce: navNonce.current });
    setView(v);
  }, []);
  useEffect(() => {
    if (!navTarget || view !== navTarget.view) return;
    let tries = 0;
    let timer;
    const tryScroll = () => {
      const el = document.getElementById(navTarget.anchor);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.remove("nav-flash");
        void el.offsetWidth; // restart the animation if already applied
        el.classList.add("nav-flash");
        setTimeout(() => el.classList.remove("nav-flash"), 1600);
        setNavTarget(null);
        return;
      }
      if (tries++ < 40) timer = setTimeout(tryScroll, 100); // wait out async load
    };
    tryScroll();
    return () => clearTimeout(timer);
  }, [navTarget, view]);

  // Live agent edits on any other tab (shot list, episode, cuts, library, sound
  // studio) → bump reloadKey so every tab refetches and reflects the change with
  // no manual Refresh. Script/timeline have their own targeted live streams.
  const dataEdits = useDataLiveEdits();
  useEffect(() => {
    if (dataEdits === 0) return; // ignore the initial value
    setReloadKey((k) => k + 1);
  }, [dataEdits]);

  // Live Script edits (from the chat agent) → reload the editor + glow the tab.
  const scriptEdits = useScriptLiveEdits();
  const [scriptGlow, setScriptGlow] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    if (scriptEdits === 0) return; // ignore the initial value
    if (viewRef.current === "script") {
      // Already looking at it (it live-updates) — just a brief pulse.
      setScriptGlow(true);
      const t = setTimeout(() => setScriptGlow(false), 1800);
      return () => clearTimeout(t);
    }
    // Editing happened on another tab — glow until the user opens the Script tab.
    setScriptGlow(true);
  }, [scriptEdits]);
  useEffect(() => {
    if (view === "script") setScriptGlow(false);
  }, [view]);
  useGlow('[data-script-tab="true"]', scriptGlow, GLOW_OPTS);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/shots");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setShots(data.shots);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <TooltipProvider delayDuration={200}>
      <AgentProvider view={view}>
      <LoginGate>
      <ProjectProvider>
      <div className="flex h-dvh overflow-hidden">
      <div className="min-w-0 flex-1 overflow-y-auto">
      <Tabs value={view} onValueChange={setView}>
        <header className="sticky top-0 z-30 border-b bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60">
          <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 md:px-6">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <Clapperboard size={18} />
            </div>

            <ProjectSwitcher />

            <TabsList className="h-9">
              {TABS.filter((t) => !t.hidden).map((t) => (
                <TabsTrigger
                  key={t.value}
                  value={t.value}
                  className="text-xs"
                  {...(t.value === "script" ? { "data-script-tab": "true" } : {})}
                >
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>

            <div className="ml-auto flex items-center gap-2">
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {loading ? "loading…" : `${shots.length} shots`}
              </span>
              <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                <RefreshCw size={13} className={cn(loading && "animate-spin")} /> Refresh
              </Button>
              <ThemeToggle />
              <UserMenu />
            </div>
          </div>
        </header>

        <main key={projectKey} className="mx-auto w-full max-w-[1500px] px-4 py-6 md:px-6">
          {view === "script" ? (
            <ScriptEditor reloadKey={reloadKey} liveKey={scriptEdits} />
          ) : view === "shotlist" ? (
            <ShotList reloadKey={reloadKey} />
          ) : view === "sounds" ? (
            <SoundStudio reloadKey={reloadKey} />
          ) : view === "library" ? (
            <Library reloadKey={reloadKey} onView={setModalImage} />
          ) : view === "cuts" ? (
            <CompleteCuts reloadKey={reloadKey} navigateTo={navigateTo} />
          ) : view === "editor" ? (
            <Editor reloadKey={reloadKey} />
          ) : view === "episode" ? (
            <Episode reloadKey={reloadKey} onView={setModalImage} />
          ) : view === "multishot" ? (
            <MultiShot reloadKey={reloadKey} />
          ) : (
            <Shots shots={shots} error={error} reloadKey={reloadKey} />
          )}
        </main>
      </Tabs>
      </div>
      <AgentChat />
      </div>

      <ImageModal image={modalImage} onClose={() => setModalImage(null)} />
      </ProjectProvider>
      </LoginGate>
      </AgentProvider>
    </TooltipProvider>
  );
}
