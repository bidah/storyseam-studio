import { createBrowserRouter, redirect } from "react-router";
import RootLayout from "@/components/RootLayout";
import { RouteError } from "@/components/shared";
import { RouteSkeleton } from "@/components/skeletons";

// `HydrateFallback` covers the HARD-LOAD case: on a cold `createBrowserRouter`
// start React Router runs the matched loader before the first render, so the
// route paints nothing until the fetch lands. Kept STATIC (like ErrorBoundary)
// because it has to render while the route's lazy chunk is still downloading.
// Tab-to-tab navigation is the other half and is handled by `useNavigation()`
// in RootLayout — the fallback here never fires for it.
const fallback = (tab) => () => <RouteSkeleton tab={tab} />;

// React Router v7 in DATA mode (createBrowserRouter + RouterProvider). The app is
// plain-Vite-built and served as static assets by the Cloudflare Worker with SPA
// fallback — we deliberately do NOT use framework mode (see docs/react-router-
// migration-plan.md §Part A).
//
// Each route is code-split via `lazy: () => import(...)`: the route module exports
// { Component, loader } (and loaders reuse the swr cache), so React Router pulls a
// tab's chunk on first navigation and keeps the current tab visible while it loads.
// Biggest win: /editor's Remotion deps leave the main bundle. ErrorBoundary stays
// statically set so it also catches lazy-load failures.
export const router = createBrowserRouter([
  // PUBLIC read-only script view behind a share link. A SIBLING of RootLayout,
  // not a child: the shell's LoginGate (session + provider key) and header must
  // never wrap it — a link viewer has neither. Matching here also keeps it out
  // of the catch-all redirect inside RootLayout's children.
  {
    path: "/share/script/:token",
    lazy: () => import("@/routes/share-script"),
    ErrorBoundary: RouteError,
  },
  // PUBLIC legal pages — siblings for the same reason as the share view above.
  // A privacy policy behind LoginGate could only be read by someone who had
  // already signed in, which is precisely the wrong audience: the visitor
  // deciding whether to trust the sign-in button can't reach it, and neither
  // can a Safe Browsing reviewer. Keep them out of RootLayout.
  {
    path: "/privacy",
    lazy: () => import("@/routes/privacy"),
    ErrorBoundary: RouteError,
  },
  {
    path: "/terms",
    lazy: () => import("@/routes/terms"),
    ErrorBoundary: RouteError,
  },
  {
    path: "/",
    Component: RootLayout,
    ErrorBoundary: RouteError, // catch-all so chunk-load failures on any route auto-recover
    id: "root",
    children: [
      { index: true, loader: () => redirect("/world") },
      // /world is just the bible now: the sub-tab bar is gone and its three
      // sub-surfaces became top-level plugins of their own (see below).
      { path: "world", lazy: () => import("@/routes/world/written"), ErrorBoundary: RouteError, HydrateFallback: fallback("world") },
      { path: "agents", lazy: () => import("@/routes/agents"), ErrorBoundary: RouteError, HydrateFallback: fallback("agents") },
      { path: "images", lazy: () => import("@/routes/images"), ErrorBoundary: RouteError, HydrateFallback: fallback("images") },
      { path: "videos", lazy: () => import("@/routes/videos"), ErrorBoundary: RouteError, HydrateFallback: fallback("videos") },
      // Keeps React Flow out of the main chunk.
      { path: "nodes", lazy: () => import("@/routes/nodes"), ErrorBoundary: RouteError, HydrateFallback: fallback("nodes") },
      // The marketplace. Never gated — it is where you go to un-gate things.
      { path: "plugins", lazy: () => import("@/routes/plugins"), ErrorBoundary: RouteError, HydrateFallback: fallback("plugins") },
      // The old /world/* sub-tab paths, kept alive as redirects. They are still
      // in the wild: bookmarks, links pasted into a chat, and — the one that
      // would be invisible to us — a `navigate` command the agent minted before
      // this refactor and replays from a stored plan. A 404-to-/script would
      // look like the feature vanished.
      { path: "world/agents", loader: () => redirect("/agents") },
      { path: "world/visual", loader: () => redirect("/images") },
      { path: "world/nodes", loader: () => redirect("/nodes") },
      // Keeps React Flow + TipTap out of the main chunk, like /nodes.
      { path: "moodboard", lazy: () => import("@/routes/moodboard"), ErrorBoundary: RouteError, HydrateFallback: fallback("moodboard") },
      { path: "script", lazy: () => import("@/routes/script") },
      { path: "shotlist", lazy: () => import("@/routes/shotlist"), ErrorBoundary: RouteError, HydrateFallback: fallback("shotlist") },
      { path: "radio", lazy: () => import("@/routes/radio"), ErrorBoundary: RouteError, HydrateFallback: fallback("radio") },
      { path: "animatic", lazy: () => import("@/routes/animatic"), ErrorBoundary: RouteError, HydrateFallback: fallback("animatic") },
      { path: "shots", lazy: () => import("@/routes/shots"), ErrorBoundary: RouteError, HydrateFallback: fallback("shots") },
      { path: "multishot", lazy: () => import("@/routes/multishot"), ErrorBoundary: RouteError, HydrateFallback: fallback("multishot") },
      { path: "episode", lazy: () => import("@/routes/episode"), ErrorBoundary: RouteError, HydrateFallback: fallback("episode") },
      { path: "cuts", lazy: () => import("@/routes/cuts"), ErrorBoundary: RouteError, HydrateFallback: fallback("cuts") },
      { path: "editor", lazy: () => import("@/routes/editor") }, // keeps Remotion out of the main chunk
      { path: "library", lazy: () => import("@/routes/library"), ErrorBoundary: RouteError, HydrateFallback: fallback("library") },
      { path: "sounds", lazy: () => import("@/routes/sounds"), ErrorBoundary: RouteError, HydrateFallback: fallback("sounds") },
      { path: "musical", lazy: () => import("@/routes/musical"), ErrorBoundary: RouteError, HydrateFallback: fallback("musical") },
      // Not a top tab — opened from the header avatar menu.
      { path: "settings", lazy: () => import("@/routes/settings"), ErrorBoundary: RouteError },
      // Team & access management, and the invite-acceptance landing. Both live
      // inside RootLayout so LoginGate guarantees a signed-in user (accepting an
      // invite needs an identity to attach the membership to).
      { path: "members", lazy: () => import("@/routes/members"), ErrorBoundary: RouteError },
      { path: "accept-invite/:id", lazy: () => import("@/routes/accept-invite"), ErrorBoundary: RouteError },
      // Unknown paths fall back to the Script tab.
      { path: "*", loader: () => redirect("/script") },
    ],
  },
]);
