import { createBrowserRouter, redirect } from "react-router";
import RootLayout from "@/components/RootLayout";
import { RouteError } from "@/components/shared";
import * as script from "@/routes/script";
import * as shotlist from "@/routes/shotlist";
import * as shots from "@/routes/shots";
import * as multishot from "@/routes/multishot";
import * as episode from "@/routes/episode";
import * as cuts from "@/routes/cuts";
import * as editor from "@/routes/editor";
import * as library from "@/routes/library";
import * as sounds from "@/routes/sounds";

// React Router v7 in DATA mode (createBrowserRouter + RouterProvider). The app is
// plain-Vite-built and served as static assets by the Cloudflare Worker with SPA
// fallback — we deliberately do NOT use framework mode (see docs/react-router-
// migration-plan.md §Part A).
//
// Phase 2: routes only. Each route module exports a `Component` that reads the
// shell context and renders the existing tab (still effect-fetching via reloadKey).
// Phase 3 adds `loader`s; Phase 4 swaps `Component:` for `lazy: () => import(...)`.
export const router = createBrowserRouter([
  {
    path: "/",
    Component: RootLayout,
    id: "root",
    children: [
      { index: true, loader: () => redirect("/script") },
      { path: "script", Component: script.Component },
      { path: "shotlist", Component: shotlist.Component },
      { path: "shots", Component: shots.Component },
      { path: "multishot", Component: multishot.Component },
      { path: "episode", Component: episode.Component },
      { path: "cuts", Component: cuts.Component },
      { path: "editor", Component: editor.Component },
      { path: "library", Component: library.Component, loader: library.loader, ErrorBoundary: RouteError },
      { path: "sounds", Component: sounds.Component },
      // Unknown paths fall back to the Script tab.
      { path: "*", loader: () => redirect("/script") },
    ],
  },
]);
