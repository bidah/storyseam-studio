import { useCallback, useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate, useRevalidator } from "react-router";
import { RefreshCw, ExternalLink, Clapperboard, Sun, Moon, LogOut, User } from "lucide-react";
import { Glowing } from "glowing";
import { cn } from "@/lib/utils";
import { CLIENT_ID } from "@/lib/clientId";
import AgentChat from "@/components/AgentChat";
import LoginGate from "@/components/Login";
import ProjectProvider from "@/components/ProjectProvider";
import ProjectSwitcher from "@/components/ProjectSwitcher";
import { onProjectChange } from "@/lib/projectFetch";
import { clearTabCache, invalidateTabCache } from "@/lib/tabCache";
import { signOut as authSignOut } from "@/lib/auth-client";
import { AgentProvider } from "@/components/AgentProvider";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ImageModal } from "@/components/shared";
import { ShellContext } from "@/lib/shellContext";

/* ---------------------------------------------------------------- *
 * App shell                                                        *
 * ---------------------------------------------------------------- */

const TABS = [
  { value: "world", label: "World" },
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

// The routed app shell — providers, header, and the <Outlet/> for the active
// tab. Replaces the old <App> tab-switcher; the URL is now the source of truth
// for which tab renders (see src/router.jsx). Per-tab data still flows via the
// ShellContext shim (reloadKey etc.); Phase 3 swaps that for loader revalidation.
export default function RootLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const view = location.pathname.slice(1).split("/")[0] || "script";
  const onScript = view === "script";

  const revalidator = useRevalidator();
  const [shots, setShots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // `reloadKey` is the media cache-bust nonce (?v=<n> on video/audio/img src) and
  // still drives the not-yet-loaderized tabs (Phase 3 converts them one by one).
  // Data freshness now flows through React Router loader revalidation; the two run
  // side by side until every tab is on a loader.
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
    revalidator.revalidate(); // re-run the active route's loader with the new project
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // Live agent edits on any other tab (shot list, episode, cuts, library, sound
  // studio) → refetch so every tab reflects the change with no manual Refresh.
  // Script/timeline have their own targeted live streams.
  const dataEdits = useDataLiveEdits();
  useEffect(() => {
    if (dataEdits === 0) return; // ignore the initial value
    setReloadKey((k) => k + 1);
    invalidateTabCache(); // drop all cached payloads so the loader fetches fresh
    revalidator.revalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataEdits]);

  // Live Script edits (from the chat agent) → reload the editor + glow the tab.
  const scriptEdits = useScriptLiveEdits();
  const [scriptGlow, setScriptGlow] = useState(false);
  useEffect(() => {
    if (scriptEdits === 0) return; // ignore the initial value
    if (onScript) {
      // Already looking at it (it live-updates) — just a brief pulse.
      setScriptGlow(true);
      const t = setTimeout(() => setScriptGlow(false), 1800);
      return () => clearTimeout(t);
    }
    // Editing happened on another tab — glow until the user opens the Script tab.
    setScriptGlow(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mirror old viewRef behavior: fire only on new edits
  }, [scriptEdits]);
  useEffect(() => {
    if (onScript) setScriptGlow(false);
  }, [onScript]);
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

  // Header Refresh button: refetch the shots count AND force the active tab's
  // loader to fetch fresh (invalidate + revalidate is the canonical pair).
  const refresh = useCallback(() => {
    invalidateTabCache();
    revalidator.revalidate();
    load();
  }, [load, revalidator]);

  // Cross-tab jump: the Complete-cut overlay navigates to `/episode#ep-<id>` or
  // `/sounds#snd-<track>`. The target tab mounts and loads async, so we retry
  // finding the hash target for a few seconds, then scroll + flash it. Re-runs on
  // every navigation (location.key) so re-clicking the same marker re-flashes.
  useEffect(() => {
    const anchor = location.hash ? location.hash.slice(1) : "";
    if (!anchor) return;
    let tries = 0;
    let timer;
    const tryScroll = () => {
      const el = document.getElementById(anchor);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.remove("nav-flash");
        void el.offsetWidth; // restart the animation if already applied
        el.classList.add("nav-flash");
        setTimeout(() => el.classList.remove("nav-flash"), 1600);
        return;
      }
      if (tries++ < 40) timer = setTimeout(tryScroll, 100); // wait out async load
    };
    tryScroll();
    return () => clearTimeout(timer);
  }, [location.hash, location.key]);

  const shell = useMemo(
    () => ({ reloadKey, scriptEdits, setModalImage, shots, error }),
    [reloadKey, scriptEdits, shots, error],
  );

  return (
    <TooltipProvider delayDuration={200}>
      <AgentProvider>
      <LoginGate>
      <ProjectProvider>
      <ShellContext.Provider value={shell}>
      <div className="flex h-dvh overflow-hidden">
      <div className="min-w-0 flex-1 overflow-y-auto">
      <Tabs value={view} onValueChange={(v) => navigate("/" + v)}>
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
              <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
                <RefreshCw size={13} className={cn(loading && "animate-spin")} /> Refresh
              </Button>
              <ThemeToggle />
              <UserMenu />
            </div>
          </div>
        </header>

        <main key={projectKey} className="mx-auto w-full max-w-[1500px] px-4 py-6 md:px-6">
          <Outlet />
        </main>
      </Tabs>
      </div>
      <AgentChat />
      </div>

      <ImageModal image={modalImage} onClose={() => setModalImage(null)} />
      </ShellContext.Provider>
      </ProjectProvider>
      </LoginGate>
      </AgentProvider>
    </TooltipProvider>
  );
}
