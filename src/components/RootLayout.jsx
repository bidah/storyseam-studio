import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate, useNavigation, useParams, useRevalidator } from "react-router";
import { RefreshCw, ExternalLink, Clapperboard, LogOut, User, Users, Settings, Blocks, Plug } from "lucide-react";
import { Glowing } from "glowing";
import { cn } from "@/lib/utils";
import { useProjectEvents } from "@/lib/useProjectEvents";
import AgentChat from "@/components/AgentChat";
import LoginGate from "@/components/Login";
import ProjectProvider from "@/components/ProjectProvider";
import { ProviderGateProvider } from "@/components/ProviderGate";
import ProjectSwitcher from "@/components/ProjectSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import PendingInviteModal from "@/components/PendingInviteModal";
import EpisodeProvider from "@/components/EpisodeProvider";
import EpisodeSwitcher from "@/components/EpisodeSwitcher";
import { onProjectChange, onEpisodeChange } from "@/lib/projectFetch";
import { useReportNavigation } from "@/lib/appState";
import { clearTabCache, invalidateTabCache } from "@/lib/tabCache";
import { signOut as authSignOut } from "@/lib/auth-client";
import { AgentProvider } from "@/components/AgentProvider";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Toaster } from "@/components/ui/sonner";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ImageModal } from "@/components/shared";
import { RouteSkeleton } from "@/components/skeletons";
import { ShellContext } from "@/lib/shellContext";
import { useT } from "@/lib/i18n";
import { PluginsProvider, usePlugins } from "@/components/PluginsProvider";
import PluginGate from "@/components/PluginGate";
import { UseMcpDialog } from "@/components/UseMcpModal";
import { headerTabs, blockingPlugin } from "@/lib/plugins";
import { parseStudioPath, studioPath } from "@/lib/home";
import { toStudio, useStudioPath } from "@/lib/studioNav";
import { providerEnabled } from "@/lib/providers";

/* ---------------------------------------------------------------- *
 * App shell                                                        *
 * ---------------------------------------------------------------- */

// The header used to be a hardcoded list of fourteen tabs. It is now the four
// core surfaces plus whatever this project has installed — `src/lib/plugins.ts`
// owns the labels AND the order, so there is nothing to keep in sync here.
// (The two sample-code surfaces, /shots and /multishot, are still routed and
// still reachable by URL; they were already hidden from the menu and stay so.)
function HeaderTabs() {
  const t = useT();
  const { enabled } = usePlugins();
  return (
    // `min-w-0` + `overflow-x-auto` keeps the header ONE row: a project with a
    // dozen plugins installed scrolls its tab strip instead of wrapping the
    // buttons beside it onto a second line.
    <TabsList className="h-9 min-w-0 max-w-full overflow-x-auto">
      {headerTabs(enabled).map((tab) => (
        <TabsTrigger
          key={tab.id}
          value={tab.id}
          className="text-xs"
          // The Script tab's live-edit glow finds its element by this attribute
          // (radix triggers don't forward refs) — see useGlow below.
          {...(tab.id === "script" ? { "data-script-tab": "true" } : {})}
        >
          {t(tab.label)}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}

// Live-sync for the one piece of state that isn't behind a route loader.
//
// The header's tab list comes from `usePlugins()`, not from a `loader`, so
// RootLayout's "data changed → invalidate + revalidate" pair can't reach it.
// Without this, a director who installs Radio leaves the editor sitting next to
// them looking at a header that doesn't have it until they reload.
//
// Narrow on purpose: the `data` firehose fires on EVERY mutation anywhere in
// the project, and re-reading the plugin set after each one would be a request
// per keystroke-ish edit. So only a frame whose `resource` is "plugins" — plus
// a reconnect, where frames were missed and we can't know — triggers a refresh.
function PluginsLiveSync({ frame, resyncs }) {
  const { refresh } = usePlugins();
  const isPluginFrame = frame?.resource === "plugins";
  useEffect(() => {
    if (isPluginFrame) refresh();
    // Keyed on the frame identity so two consecutive plugin edits both land.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, isPluginFrame]);
  useEffect(() => {
    if (resyncs > 0) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resyncs]);
  return null;
}

// The route guard. `blockingPlugin` owns the policy — core surfaces, the
// ungated views (settings, members, the marketplace itself…) and any path that
// isn't a plugin at all come back null — so this only decides WHEN to ask.
//
// Never while the set is still loading: flashing "not installed" over a tab the
// author does own is worse than a beat of nothing, and the answer arrives in
// one request anyway.
function GatedOutlet({ view, pendingView }) {
  const { enabled, loading } = usePlugins();
  if (pendingView) return <RouteSkeleton tab={pendingView} />;
  const blocked = loading ? null : blockingPlugin(view, enabled);
  return blocked ? <PluginGate plugin={blocked} /> : <Outlet />;
}

// The "route being edited" cue on the Script tab. Accent-orange, not the old
// brand lime: design.md carries ONE accent and calls that rule load-bearing, so
// a second hue here would read as a different kind of signal. `colors`
// alternates it with the page ground so the sweep reads as a pulse.
const GLOW_OPTS = {
  colors: ["#FF5A1F", "#0B0C0F", "#FF5A1F", "#0B0C0F", "#FF5A1F"],
  colors2: ["#F2F2F0", "#0B0C0F", "#0B0C0F", "#F2F2F0"],
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

// Account menu — the shadcn avatar in the header opens a dropdown with links to
// Settings and the team, a link to higgsfield.ai, and a sign-out that drops the
// Higgsfield credential and re-gates the app (reload → LoginGate re-checks →
// homepage). The light/dark toggle that used to live here is gone: the app is
// dark-only now (see index.html), so the control had nothing to switch to.
function UserMenu() {
  const t = useT();
  const studio = useStudioPath();
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
          aria-label={t("Account menu")}
          // The lone survivor of design.md's square rule: the focus ring traces
          // the Avatar, and a square ring around a circular portrait reads as a
          // misalignment rather than as a decision.
          className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary/10 text-primary">
              <User size={16} />
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="header-menu w-52">
        <DropdownMenuLabel>{t("Account")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to={studio("/settings")}>
            <Settings size={14} /> {t("Settings")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to={studio("/members")}>
            <Users size={14} /> {t("Team & access")}
          </Link>
        </DropdownMenuItem>
        {providerEnabled("higgsfield") ? (
          <DropdownMenuItem asChild>
            <a href="https://higgsfield.ai" target="_blank" rel="noopener noreferrer">
              <ExternalLink size={14} /> {t("Visit higgsfield.ai")}
            </a>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={signOut}>
          <LogOut size={14} /> {t("Sign out")}
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
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  // The studio is mounted at /p/:projectId (router.jsx); the tab is the first
  // segment AFTER that. `barePath` is the view's path without the project —
  // the shape the agent's `view_screen` and every bare link already speak.
  const { projectId } = useParams();
  const viewOf = (pathname) => (parseStudioPath(pathname)?.rest || "/").slice(1).split("/")[0];
  const barePath = (parseStudioPath(location.pathname)?.rest || "/") + location.hash;
  const view = viewOf(location.pathname) || "world";
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
  const pendingTab = navigation.location ? viewOf(navigation.location.pathname) : null;
  const navPending = navigation.state === "loading" && !!pendingTab && pendingTab !== view;
  // The skeleton waits out the delay; the TAB HIGHLIGHT must not — it tracks the
  // click immediately so the header stays responsive on warm (instant) loads.
  const activeTab = navPending ? pendingTab : view;
  const pendingView = useSettled(navPending) ? pendingTab : null;

  // Tell the backend which tab is open, so the chat agent's `view_screen` can
  // resolve "this shot" instead of asking. Pointer only — the id and the path;
  // the agent re-reads the live records itself (src/lib/appState.js).
  useReportNavigation({ view, path: barePath });

  const revalidator = useRevalidator();
  const [loading, setLoading] = useState(true);
  // `reloadKey` is the media cache-bust nonce (?v=<n> on video/audio/img src) and
  // still drives the not-yet-loaderized tabs (Phase 3 converts them one by one).
  // Data freshness now flows through React Router loader revalidation; the two run
  // side by side until every tab is on a loader.
  const [reloadKey, setReloadKey] = useState(0);
  const [projectKey, setProjectKey] = useState(0);
  const [episodeKey, setEpisodeKey] = useState(0);
  const [modalImage, setModalImage] = useState(null);
  // "Use MCP" — how to point your own agent/harness at this project.
  const [mcpOpen, setMcpOpen] = useState(false);

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
  //
  // The URL carries the project (/p/:projectId), so it follows the switch too:
  // a project picked in the switcher (or corrected by ProjectProvider when the
  // URL named one the user can't open) rewrites the address, same tab.
  const urlRef = useRef({ projectId, view });
  urlRef.current = { projectId, view };
  useEffect(() => onProjectChange((id) => {
    clearTabCache(); // per-tab caches hold the OLD project's payloads — drop them
    setReloadKey((k) => k + 1); // bust media even if the header refetch fails
    setProjectKey((k) => k + 1);
    revalidator.revalidate(); // re-run the active route's loader with the new project
    load(); // header shot count belongs to the new project too
    if (id && id !== urlRef.current.projectId) navigate(studioPath(id, urlRef.current.view), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // Switching EPISODE (series only) re-points every downstream tab at the new
  // episode's docs — same treatment as a project switch: drop the per-tab caches,
  // bust media, remount the body, and refetch the active route + header count.
  useEffect(() => onEpisodeChange(() => {
    clearTabCache();
    setReloadKey((k) => k + 1);
    setEpisodeKey((k) => k + 1);
    revalidator.revalidate();
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // The agent asking the UI to move (POST /api/navigate → the `nav` channel).
  // The return leg of context awareness: the agent can already see which tab is
  // open, and this is how it takes you to the thing it just made.
  //
  // Deliberately NOT a stored piece of state. A navigate is a one-shot command,
  // so a tab that was closed when it fired simply misses it — replaying "go to
  // Radio" on reconnect would yank the author out of whatever they moved on to.
  // `token` guards the only case that survives a reconnect: the same frame
  // arriving twice.
  const navEvents = useProjectEvents("/api/nav/events", { data: true });
  const lastNavToken = useRef(null);
  useEffect(() => {
    const cmd = navEvents.last;
    if (!cmd?.path || cmd.token === lastNavToken.current) return;
    lastNavToken.current = cmd.token;
    // The agent speaks bare paths (`/radio`); land inside THIS project's studio.
    navigate(toStudio(projectId, cmd.path));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navEvents.last]);

  // Live agent edits on any other tab (shot list, episode, cuts, library, sound
  // studio) → refetch so every tab reflects the change with no manual Refresh.
  // Script/timeline have their own targeted live streams. `resyncs` counts too:
  // after an SSE reconnect, events may have been missed, so refetch as well.
  // `{ data: true }` because one consumer needs the frame BODY, not just the
  // counter: the installed-plugin set lives outside the loader graph, so a
  // collaborator installing Radio has to be told which resource changed (see
  // <PluginsLiveSync/>). Everything else still reacts to the counter alone.
  const dataEvents = useProjectEvents("/api/data/events", { data: true });
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
  // `/sounds#snd-<track>`, and the Animatic's "Add in World" to `/world#locations`.
  // The target tab mounts and loads async, so we retry finding the hash target for
  // a few seconds, then scroll + flash it. Re-runs on every navigation
  // (location.key) so re-clicking the same marker re-flashes.
  //
  // Two things make this fussier than a one-shot scrollIntoView:
  //   - The tab keeps SETTLING after mount (its on-mount loader revalidation
  //     landing, auto-growing fields measuring), which shifts the anchor down —
  //     so we re-assert the scroll whenever its offset moves, and only stop once
  //     it's held steady, so the final scroll lands at the settled position.
  //   - `behavior:"smooth"` is a NO-OP in some environments (reduced-motion,
  //     headless/automation), which would silently strand a long jump like
  //     `#locations` at the bottom of the World bible. So once the layout has
  //     settled we verify the anchor is actually on screen and, if not, snap it
  //     into view instantly.
  useEffect(() => {
    const anchor = location.hash ? location.hash.slice(1) : "";
    if (!anchor) return;
    let tries = 0; // caps the total watch window (~4s)
    let stable = 0; // consecutive ticks the anchor hasn't moved
    let lastTop = null;
    let flashed = false;
    let timer;
    // Roughly where block:"center" lands it — top in the upper half of the viewport.
    const onScreen = (el) => {
      const top = el.getBoundingClientRect().top;
      return top >= 0 && top <= window.innerHeight * 0.6;
    };
    const flash = (el) => {
      flashed = true;
      el.classList.remove("nav-flash");
      void el.offsetWidth; // restart the animation if already applied
      el.classList.add("nav-flash");
      setTimeout(() => el.classList.remove("nav-flash"), 1600);
    };
    const tick = () => {
      const el = document.getElementById(anchor);
      // Not mounted yet — the target tab's lazy chunk / loader is still resolving.
      if (!el) {
        if (tries++ < 40) timer = setTimeout(tick, 100); // wait out async load
        return;
      }
      if (el.offsetTop !== lastTop) {
        // Position still moving as the tab settles — (re)assert the scroll.
        lastTop = el.offsetTop;
        stable = 0;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        stable++;
        // Settled but smooth may have no-op'd — snap it in if it isn't on screen.
        if (stable === 3 && !onScreen(el)) el.scrollIntoView({ block: "center" });
      }
      if (!flashed && onScreen(el)) flash(el);
      // Stop once the position has held steady for ~0.6s (or the ~4s cap).
      if (stable < 6 && tries++ < 40) timer = setTimeout(tick, 100);
    };
    tick();
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
      <EpisodeProvider>
      <ProviderGateProvider>
      {/* Inside ProjectProvider (the installed set is per project) and outside
          the header, which reads it to build the tabs. */}
      <PluginsProvider>
      <PluginsLiveSync frame={dataEvents.last} resyncs={dataEvents.resyncs} />
      <ShellContext.Provider value={shell}>
      {/* Highlight the PENDING tab, not the committed one — otherwise a click
          leaves the old tab lit for the whole load. */}
      <Tabs value={activeTab} onValueChange={(v) => navigate(studioPath(projectId, v))}>
      <div className="flex h-dvh flex-col overflow-hidden">
        {/* One unified header, full width across both the GUI and the chat.
            Opaque rather than a blur over the page: the strip is a flat HUD
            ground (design.md), and a translucent header tints whatever
            scrolls under the tab row. */}
        <header className="shrink-0 border-b bg-card">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-3 px-4 py-3 md:px-6">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Clapperboard size={18} />
            </div>

            <ProjectSwitcher />
            <EpisodeSwitcher />

            <HeaderTabs />

            {/* The doorway to the marketplace, sitting immediately after the
                tabs rather than over in the account cluster: it is a peer of
                the tabs — the place the NEXT tab comes from — not an app-wide
                action. On it, it takes the SAME primary fill the TabsList
                indicator draws, so it highlights exactly the way a tab does. */}
            <Button
              variant={view === "plugins" ? "default" : "outline"}
              size="sm"
              onClick={() => navigate(studioPath(projectId, "plugins"))}
            >
              <Blocks size={13} /> {t("Explore plugins")}
            </Button>

            <div className="ml-auto flex items-center gap-2">
              {/* Deliberately a first-class button, not a menu item: driving
                  this project from your own agent is a headline capability,
                  and nobody discovers it inside a dropdown. */}
              <Button variant="secondary" size="sm" onClick={() => setMcpOpen(true)}>
                <Plug size={13} /> {t("Use MCP")}
              </Button>
              <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
                <RefreshCw size={13} className={cn(loading && "animate-spin")} /> {t("Refresh")}
              </Button>
              <ThemeToggle />
              <UserMenu />
            </div>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="min-w-0 flex-1 overflow-y-auto">
            {/* The Moodboard is a canvas: it wants the whole pane, so it drops
                the reading-width cap AND becomes a fixed-height flex column so
                the board can fill the remaining space instead of guessing a vh.
                Every other tab is a document and keeps the measure. */}
            <main
              key={`${projectKey}:${episodeKey}`}
              className={cn(
                "mx-auto w-full px-4 py-6 md:px-6",
                activeTab === "moodboard"
                  ? "flex h-full max-w-none flex-col"
                  : "max-w-[1500px]",
              )}
            >
              <GatedOutlet view={view} pendingView={pendingView} />
            </main>
          </div>
          <AgentChat />
        </div>
      </div>
      </Tabs>

      <ImageModal image={modalImage} onClose={() => setModalImage(null)} />
      {/* Connect StorySeam to your own agent/harness over MCP (POST /api/mcp). */}
      <UseMcpDialog open={mcpOpen} onOpenChange={setMcpOpen} />
      {/* Replays a pending invite (stashed pre-login in localStorage) once the
          user is inside the app — the fallback for when the /accept-invite route
          couldn't render across the sign-in / provider-connect redirects. */}
      <PendingInviteModal />
      {/* App-wide toasts (desktop update-ready affordance lives here too). */}
      <Toaster position="bottom-right" />
      </ShellContext.Provider>
      </PluginsProvider>
      </ProviderGateProvider>
      </EpisodeProvider>
      </ProjectProvider>
      </LoginGate>
      </AgentProvider>
    </TooltipProvider>
  );
}
