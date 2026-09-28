// Translate the mobile route tree into the `view` vocabulary the agent knows,
// in both directions.
//
// The web app's tabs and this app's tabs are not the same shape — web has one
// tab per pipeline stage, mobile folds World/Script/Shots into Story and
// Library/Import/Sounds into Assets — but the AGENT must see one vocabulary, or
// `view_screen` needs a per-platform branch on the server and `navigate` can
// only steer one of them. So the mapping lives here, on the client that knows
// its own routes, and the wire format stays the web's view names (which are also
// what worker/src/routes/appstate.js hydrates and routes/navigate.js validates).
//
// Deliberately NOT a generated mapping: mobile's sub-surfaces are segmented
// state inside one screen (`?segment=script`), not routes, so only this file can
// know that Story-with-segment-script is the agent's "script".

import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { reportNavigation, useReportNavigation } from './app-state';

// --- outbound: which pipeline view is on screen ------------------------------

export interface ScreenNav {
  view: string;
  path: string;
  [key: string]: unknown;
}

// `/(tabs)/story` + `?segment=shots` → `{ view: "shotlist" }`.
// Unknown routes report their path with no view: the agent then knows the author
// is in the app but not on a pipeline surface, which is more honest than
// guessing a view and having it hydrate the wrong records.
export function navForRoute(
  pathname: string,
  params: Record<string, unknown>,
): ScreenNav {
  const p = pathname.replace(/^\/\(tabs\)/, '') || '/';
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const nav: ScreenNav = { view: '', path: pathname };

  if (p.startsWith('/story/shot')) {
    nav.view = 'shotlist';
    // The route param is the shot's ordinal (`n`), which is what the Shot screen
    // routes on. `view_screen` resolves a shot by ID, so send both and let the
    // server prefer whichever it can match.
    const n = str(params.n);
    if (n) nav.shotN = Number(n);
  } else if (p.startsWith('/story/drafts')) {
    nav.view = 'script';
    nav.pane = 'drafts';
  } else if (p.startsWith('/story')) {
    // One screen, three segments — the segment IS the view here.
    const segment = str(params.segment) || 'world';
    nav.view = segment === 'shots' ? 'shotlist' : segment === 'script' ? 'script' : 'world';
  } else if (p.startsWith('/image')) {
    // Visual world, as a ROOT modal presented over whatever tab is underneath
    // (src/app/image/). The agent's vocabulary has no separate view for it — on
    // the web it's World's visual pane — so it reports as that, which is also
    // what `navigate` back to it resolves through (routeForView below).
    nav.view = 'world';
    nav.pane = 'visual';
  } else if (p.startsWith('/studio/episode')) {
    nav.view = 'episode';
    const bundleId = str(params.bundleId);
    if (bundleId) nav.bundleId = bundleId;
  } else if (p.startsWith('/studio/radio')) {
    nav.view = 'radio';
  } else if (p.startsWith('/studio/cuts')) {
    nav.view = 'cuts';
  } else if (p.startsWith('/studio/plugins')) {
    nav.view = 'plugins';
  } else if (p.startsWith('/studio/')) {
    // A plugin surface: its route segment IS the plugin id (director, stage,
    // shotsheet, musicalized, upscale) — the same string the web reports.
    nav.view = p.split('/')[2] || '';
    const seriesId = str(params.seriesId);
    if (seriesId) nav.seriesId = seriesId;
  } else if (p.startsWith('/create')) {
    // The prompt box / a Film's steps. Not a studio view.
    const filmId = str(params.filmId);
    if (filmId) nav.filmId = filmId;
  } else if (p.startsWith('/assets')) {
    // Assets folds Library and the Sound studio into one tab. Without the
    // sub-surface we'd hydrate the library while the author is looking at
    // sounds, so callers pass `seg` through the params bag.
    nav.view = str(params.seg) === 'sounds' ? 'sounds' : 'library';
    const folder = str(params.folder);
    if (folder) nav.folder = folder;
  } else if (p.startsWith('/editor')) {
    nav.view = 'editor';
  } else if (p.startsWith('/chat')) {
    // The chat IS the agent. Reporting a pipeline view here would be a lie, but
    // "they're in the chat" is still worth knowing.
    nav.view = 'chat';
  }

  return nav;
}

// Report the current route on every change. Mounted once, in the tabs layout.
//
// `useGlobalSearchParams`, NOT `useLocalSearchParams`: this runs in a LAYOUT, and
// the local variant is scoped to the layout's own route — it would hand back an
// empty bag and every `?segment=` deep link would report as the tab's default.
// The global variant tracks the URL actually on screen, which is the whole job
// here. (Its documented downside — re-rendering on every navigation — costs
// nothing for a component that renders null.)
export function useReportScreen() {
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  useReportNavigation(navForRoute(pathname, params as Record<string, unknown>));
}

// Refine the current report from a screen that keeps its sub-surface in
// COMPONENT STATE rather than in the URL — the Story tab's World/Script/Shots
// switcher and the Assets tab's Library/Import/Sounds one. The layout reporter
// above can only see the route, so without this the agent is told "story" while
// the author is on Shots, and hydrates the world bible for "this shot".
//
// Safe to run alongside the layout reporter: both send a complete nav object and
// reports dedupe by value, so whichever fires last wins and neither re-fires
// until something actually changes. No ping-pong.
export function useReportSegment(nav: ScreenNav | null) {
  const key = JSON.stringify(nav ?? null);
  useEffect(() => {
    if (nav) reportNavigation(nav);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` IS `nav`, by value
  }, [key]);
}

// --- inbound: the agent asking us to move ------------------------------------

// The agent speaks the web's view names; this app's router doesn't. Views with
// no mobile home (`animatic`, `multishot`, `shots`) map to their nearest real
// screen rather than 404-ing the author into a blank stack.
const ROUTES: Record<string, string> = {
  world: '/(tabs)/story?segment=world',
  script: '/(tabs)/story?segment=script',
  shotlist: '/(tabs)/story?segment=shots',
  shots: '/(tabs)/story?segment=shots',
  multishot: '/(tabs)/studio/episode',
  episode: '/(tabs)/studio/episode',
  cuts: '/(tabs)/studio/cuts',
  radio: '/(tabs)/studio/radio',
  // No animatic surface on mobile yet; Cuts is where its output lands.
  animatic: '/(tabs)/studio/cuts',
  director: '/(tabs)/studio/director',
  stage: '/(tabs)/studio/stage',
  shotsheet: '/(tabs)/studio/shotsheet',
  musicalized: '/(tabs)/studio/musicalized',
  upscale: '/(tabs)/studio/upscale',
  plugins: '/(tabs)/studio/plugins',
  editor: '/editor',
  library: '/(tabs)/assets',
  sounds: '/(tabs)/assets',
  settings: '/settings',
};

export function routeForView(view: string, sub?: string | null): string | null {
  // World's visual pane is a modal here, not a segment — "go to visual world"
  // presents it over whichever tab the author is standing on rather than moving
  // them to Story first (src/app/image/).
  if (view === 'world' && sub === 'visual') return '/image';
  return ROUTES[view] ?? null;
}

// Subscribe to the agent's navigate commands and move the app.
//
// Same one-shot semantics as the web listener: the command is not stored, and a
// device that was backgrounded when it fired simply misses it. Replaying a
// stale "go to Radio" when the app foregrounds would yank the author out of
// whatever they moved on to — which on a phone, where there's one screen and no
// second tab to absorb it, is considerably ruder than on the desktop.
export function useAgentNavigation(command: { token?: string; view?: string; sub?: string | null } | null) {
  const router = useRouter();
  useEffect(() => {
    if (!command?.view) return;
    const route = routeForView(command.view, command.sub);
    if (!route) return;
    router.navigate(route as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- token identifies the command
  }, [command?.token]);
}
