import { createBrowserRouter, redirect } from "react-router";
import RootLayout from "@/components/RootLayout";
import { RouteError } from "@/components/shared";

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
  {
    path: "/",
    Component: RootLayout,
    id: "root",
    children: [
      { index: true, loader: () => redirect("/world") },
      { path: "world", lazy: () => import("@/routes/world"), ErrorBoundary: RouteError },
      { path: "script", lazy: () => import("@/routes/script") },
      { path: "shotlist", lazy: () => import("@/routes/shotlist"), ErrorBoundary: RouteError },
      { path: "shots", lazy: () => import("@/routes/shots"), ErrorBoundary: RouteError },
      { path: "multishot", lazy: () => import("@/routes/multishot"), ErrorBoundary: RouteError },
      { path: "episode", lazy: () => import("@/routes/episode"), ErrorBoundary: RouteError },
      { path: "cuts", lazy: () => import("@/routes/cuts"), ErrorBoundary: RouteError },
      { path: "editor", lazy: () => import("@/routes/editor") }, // keeps Remotion out of the main chunk
      { path: "library", lazy: () => import("@/routes/library"), ErrorBoundary: RouteError },
      { path: "sounds", lazy: () => import("@/routes/sounds"), ErrorBoundary: RouteError },
      // Unknown paths fall back to the Script tab.
      { path: "*", loader: () => redirect("/script") },
    ],
  },
]);
