// The agent moving the UI — the return leg of context awareness.
//
// `/api/appstate` and `view_screen` let the agent see what the author is looking
// at. This is the other direction: the agent asks the app to go somewhere. It is
// the difference between an agent that reports ("I've added 12 shots") and one
// that drives ("…and here they are"), and it costs almost nothing because the
// live-sync plumbing already exists — a `nav` channel on the same ProjectEvents
// Durable Object the data/script/timeline channels ride.
//
// A navigate is a COMMAND, not state: it fires once, is not stored, and a client
// that wasn't connected simply never sees it. That is the right semantics —
// replaying a stale "go to the Radio tab" when a tab reconnects ten minutes
// later would yank the author out of whatever they moved on to.
//
// The `token` is what keeps a reconnect from re-acting on a frame it already
// handled; the client ignores a token it has seen.

import { broadcast } from "../lib/broadcast.js";
import { CORE_IDS, PLUGIN_IDS } from "../lib/plugins.ts";

// The tabs the SPA actually has (src/router.jsx). An unknown view would leave
// the client on a 404-ish route it can't recover from, so reject it here where
// the caller still gets a useful error, rather than shipping a dead navigation.
//
// DERIVED from the plugin catalog rather than listed by hand: the catalog is
// what the header, the route guard and the agent's own gate already agree on,
// and a hand-kept copy here is exactly how "take me to the Image generation
// tab" comes back as `Unknown view "images"` a week after the surface shipped.
// Only the handful of screens the catalog doesn't describe are spelled out.
const VIEWS = new Set([
  ...CORE_IDS,
  ...PLUGIN_IDS,
  // Not plugins: chrome and the two hidden sample-code surfaces. `plugins` is
  // here on purpose — "go install it" is a navigation the agent should be able
  // to make.
  "plugins", "settings", "members", "shots", "multishot",
]);

// A navigate may still name an UNINSTALLED plugin. That is deliberately not an
// error: the client renders that surface's install gate, which is precisely
// where the author wants to land when the agent says "this needs Radio".

// Sub-routes that exist under a tab. The World tab used to own three of them
// (`/world/visual`, `/world/agents`, `/world/nodes`); they are top-level
// surfaces now, so nothing has a sub-view any more. Kept as an empty map rather
// than deleted because the request shape still accepts `sub` and old agent
// plans still send it — see the fallback below.
const SUBVIEWS = {};

// The old `/world/<sub>` paths, folded to where they live now. An agent plan
// minted before the split still says `{ view: "world", sub: "visual" }`, and
// answering that with a 400 would make the tool look broken for a request that
// is perfectly clear.
const LEGACY_SUBVIEWS = {
  world: { visual: "images", agents: "agents", nodes: "nodes" },
};

export function registerNavigate(app) {
  app.post("/api/navigate", async (c) => {
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const view = String(body?.view || "").trim().toLowerCase();
    const sub = body?.sub ? String(body.sub).trim().toLowerCase() : "";
    // An anchor to scroll to once the tab mounts — `ep-<id>`, `snd-<track>`,
    // `locations`. RootLayout already knows how to chase one of these through a
    // tab that is still settling, so this reuses that behaviour rather than
    // adding a second scroll mechanism.
    const hash = body?.hash ? String(body.hash).replace(/^#/, "").trim() : "";
    const reason = body?.reason ? String(body.reason).slice(0, 200) : "";

    // Fold a pre-split `{ view: "world", sub: "visual" }` onto its new home
    // BEFORE validating, so the legacy shape resolves instead of 400-ing.
    const folded = LEGACY_SUBVIEWS[view]?.[sub];
    const target = folded || view;
    const targetSub = folded ? "" : sub;

    if (!VIEWS.has(target)) {
      return c.json(
        { error: `Unknown view "${view}". Expected one of: ${[...VIEWS].join(", ")}.` },
        400,
      );
    }
    if (targetSub && !SUBVIEWS[target]?.has(targetSub)) {
      return c.json(
        { error: `"${target}" has no sub-view "${targetSub}".` },
        400,
      );
    }

    const path = `/${target}${targetSub ? `/${targetSub}` : ""}${hash ? `#${hash}` : ""}`;
    const token = crypto.randomUUID();
    await broadcast(
      c.env,
      c.get("projectId"),
      "nav",
      { token, path, view: target, sub: targetSub || null, hash: hash || null, reason, at: Date.now() },
      c.executionCtx,
    );
    // The response says what was ASKED FOR, not what happened. There may be no
    // tab open, or several; the agent shouldn't narrate a navigation as though
    // it watched the author's screen change.
    return c.json({ ok: true, path, requested: true });
  });
}
