import { useCallback, useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate, useNavigation, useRevalidator } from "react-router";
import { RefreshCw, ExternalLink, Clapperboard, Sun, Moon, LogOut, User } from "lucide-react";
import { Glowing } from "glowing";
import { cn } from "@/lib/utils";
import { useProjectEvents } from "@/lib/useProjectEvents";
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
import { TooltipProvider } from "@/components/ui/tooltip";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ImageModal } from "@/components/shared";
import { RouteSkeleton } from "@/components/skeletons";
import { ShellContext } from "@/lib/shellContext";

/* ---------------------------------------------------------------- *
 * App shell                                                        *
 * ---------------------------------------------------------------- */

const TABS = [
  { value: "world", label: "World" },
  { value: "script", label: "Script" },
  { value: "shotlist", label: "Shot list" },
  { value: "radio", label: "Radio" },
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

// True only once `on` has held for `ms`. Guards the route skeleton against
// flashing on a WARM cache: `swr()` is async, so React Router still passes
// through `navigation.state === "loading"` on a cache hit and the skeleton
// would strobe over a tab switch that used to be instant. Turns OFF immediately
// (no trailing skeleton once the payload lands).
function useSettled(on, ms = 150) {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!on) {
      setSettled(false);
      return;
    }
    const t = setTimeout(() => setSettled(true), ms);
    return () => clearTimeout(t);
  }, [on, ms]);
  return on && settled;
}

// Account menu — the shadcn avatar in the header opens a dropdown with the
// light/dark theme toggle, a link to higgsfield.ai, and a sign-out that drops
// the Higgsfield credential and re-gates the app (reload → LoginGate re-checks
// → homepage).
function UserMenu() {
  const [dark, setDark] = useState(() =>
    typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : true
  );
  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      /* ignore storage failures — the class toggle still applies for this session */
    }
  };

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
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); toggleTheme(); }}>
          {dark ? <Sun size={14} /> : <Moon size={14} />} {dark ? "Light mode" : "Dark mode"}
        </DropdownMenuItem>
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

  // Cold tab-to-tab navigation: `swr()` only paints instantly on a WARM cache;
  // on a miss the loader awaits the fetch and React Router keeps the OLD tab
  // rendered the whole time, so switching tabs looks frozen. Swap in that tab's
  // skeleton while its loader (and lazy chunk) resolve.
  //
  // Deliberately narrow, so the skeleton never flashes over content that is
  // already on screen:
  //   - `navigation.state` covers real navigations ONLY. Revalidation has its
  //     own `revalidator.state`, so the SSE firehose / Refresh / agent-idle
  //     refetches keep the current tab painted (their whole point).
  //   - Same-tab navigations (the `/episode#ep-<id>` cross-tab jump re-entering
  //     a tab it's already on, hash-only changes) are excluded by the tab
  //     comparison below.
  const navigation = useNavigation();
  const pendingTab = navigation.location
    ? navigation.location.pathname.slice(1).split("/")[0]
    : null;
  const navPending = navigation.state === "loading" && !!pendingTab && pendingTab !== view;
  // The skeleton waits out the delay; the TAB HIGHLIGHT must not — it tracks the
  // click immediately so the header stays responsive on warm (instant) loads.
  const activeTab = navPending ? pendingTab : view;
  const pendingView = useSettled(navPending) ? pendingTab : null;

  const revalidator = useRevalidator();
  const [loading, setLoading] = useState(true);
  // `reloadKey` is the media cache-bust nonce (?v=<n> on video/audio/img src) and
  // still drives the not-yet-loaderized tabs (Phase 3 converts them one by one).
  // Data freshness now flows through React Router loader revalidation; the two run
  // side by side until every tab is on a loader.
  const [reloadKey, setReloadKey] = useState(0);
  const [projectKey, setProjectKey] = useState(0);
  const [modalImage, setModalImage] = useState(null);

  // A lightweight readiness ping that bumps `reloadKey` (the media cache-bust
  // nonce) once the backend has settled, and drives the Refresh button's spinner.
  // The shots ROUTE is loaderized (swr key "shots") and reports its own errors.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/shots");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setReloadKey((k) => k + 1);
    } catch {
      /* media cache-bust only — the shots route reports its own load errors */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Switching projects (from the header ProjectSwitcher) changes the id in the
  // fetch shim; re-fetch every tab and remount the body so no stale project
  // data lingers.
  useEffect(() => onProjectChange(() => {
    clearTabCache(); // per-tab caches hold the OLD project's payloads — drop them
    setReloadKey((k) => k + 1); // bust media even if the header refetch fails
    setProjectKey((k) => k + 1);
    revalidator.revalidate(); // re-run the active route's loader with the new project
    load(); // header shot count belongs to the new project too
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // Live agent edits on any other tab (shot list, episode, cuts, library, sound
  // studio) → refetch so every tab reflects the change with no manual Refresh.
  // Script/timeline have their own targeted live streams. `resyncs` counts too:
  // after an SSE reconnect, events may have been missed, so refetch as well.
  const dataEvents = useProjectEvents("/api/data/events");
  const dataEdits = dataEvents.edits + dataEvents.resyncs;
  useEffect(() => {
    if (dataEdits === 0) return; // ignore the initial value
    setReloadKey((k) => k + 1);
    invalidateTabCache(); // drop all cached payloads so the loader fetches fresh
    revalidator.revalidate();
    load(); // keep the header shot count live too
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataEdits]);

  // Live Script edits (from the chat agent) → reload the editor + glow the tab.
  // The glow keys on real edits only; the editor reload (scriptEdits via
  // ShellContext) also keys on resyncs so a reconnect refetches the document.
  const scriptEvents = useProjectEvents("/api/script/events");
  const scriptEdits = scriptEvents.edits + scriptEvents.resyncs;
  const [scriptGlow, setScriptGlow] = useState(false);
  useEffect(() => {
    if (scriptEvents.edits === 0) return; // ignore the initial value
    if (onScript) {
      // Already looking at it (it live-updates) — just a brief pulse.
      setScriptGlow(true);
      const t = setTimeout(() => setScriptGlow(false), 1800);
      return () => clearTimeout(t);
    }
    // Editing happened on another tab — glow until the user opens the Script tab.
    setScriptGlow(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mirror old viewRef behavior: fire only on new edits
  }, [scriptEvents.edits]);
  useEffect(() => {
    if (onScript) setScriptGlow(false);
  }, [onScript]);
  useGlow('[data-script-tab="true"]', scriptGlow, GLOW_OPTS);

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

  // `shots`/`error` left the shell when the shots route was loaderized — the
  // local state above only feeds the header count now.
  const shell = useMemo(
    () => ({ reloadKey, scriptEdits, setModalImage }),
    [reloadKey, scriptEdits],
  );

  return (
    <TooltipProvider delayDuration={200}>
      <AgentProvider>
      <LoginGate>
      <ProjectProvider>
      <ShellContext.Provider value={shell}>
      {/* Highlight the PENDING tab, not the committed one — otherwise a click
          leaves the old tab lit for the whole load. */}
      <Tabs value={activeTab} onValueChange={(v) => navigate("/" + v)}>
      <div className="flex h-dvh flex-col overflow-hidden">
        {/* One unified header, full width across both the GUI and the chat. */}
        <header className="shrink-0 border-b bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-3 px-4 py-3 md:px-6">
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
              <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
                <RefreshCw size={13} className={cn(loading && "animate-spin")} /> Refresh
              </Button>
              <UserMenu />
            </div>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="min-w-0 flex-1 overflow-y-auto">
            <main key={projectKey} className="mx-auto w-full max-w-[1500px] px-4 py-6 md:px-6">
              {pendingView ? <RouteSkeleton tab={pendingView} /> : <Outlet />}
            </main>
          </div>
          <AgentChat />
        </div>
      </div>
      </Tabs>

      <ImageModal image={modalImage} onClose={() => setModalImage(null)} />
      </ShellContext.Provider>
      </ProjectProvider>
      </LoginGate>
      </AgentProvider>
    </TooltipProvider>
  );
}
