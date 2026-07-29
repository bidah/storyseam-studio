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

// The tabs the SPA actually has (src/router.jsx). An unknown view would leave
// the client on a 404-ish route it can't recover from, so reject it here where
// the caller still gets a useful error, rather than shipping a dead navigation.
const VIEWS = new Set([
  "world", "script", "shotlist", "radio", "animatic", "shots", "multishot",
  "episode", "cuts", "editor", "library", "sounds", "settings",
]);

// Sub-routes that exist under a tab (`/world/visual`, `/world/nodes`).
const SUBVIEWS = { world: new Set(["visual", "nodes"]) };

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

    if (!VIEWS.has(view)) {
      return c.json(
        { error: `Unknown view "${view}". Expected one of: ${[...VIEWS].join(", ")}.` },
        400,
      );
    }
    if (sub && !SUBVIEWS[view]?.has(sub)) {
      return c.json(
        { error: `"${view}" has no sub-view "${sub}".` },
        400,
      );
    }

    const path = `/${view}${sub ? `/${sub}` : ""}${hash ? `#${hash}` : ""}`;
    const token = crypto.randomUUID();
    await broadcast(
      c.env,
      c.get("projectId"),
      "nav",
      { token, path, view, sub: sub || null, hash: hash || null, reason, at: Date.now() },
      c.executionCtx,
    );
    // The response says what was ASKED FOR, not what happened. There may be no
    // tab open, or several; the agent shouldn't narrate a navigation as though
    // it watched the author's screen change.
    return c.json({ ok: true, path, requested: true });
  });
}
