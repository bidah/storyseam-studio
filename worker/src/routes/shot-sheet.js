// The Shot Sheet — a Series' pinned frames drawn as ONE short film, so they can
// be cut back out of it.
//
// A pinned frame is the exact picture the Director starts a chunk from, and the
// cheapest way for a pin to hold a style is for the VIDEO MODEL to have drawn
// it. Pins made in an image model are pins the Director has to translate: a
// richer painted still, a flatter cel still — either way a style it did not
// draw. Asking the video model for one short clip that is nothing but N
// finished frames, hard cut, gives pins that are natively in its hand, all from
// one pass, all lit and designed the same way, for the price of one clip.
//
// ── The split, and why it falls here ────────────────────────────────────────
// The RENDER is the Worker's, because it needs a credential and a long-running
// queue poll. The CUTTING is the browser's, because the browser already has the
// video decoded on screen and a frame grab there costs nothing — where doing it
// server-side would mean an ffmpeg sandbox per sheet. So this file renders and
// files; `POST /api/shotsheet/pins` takes the frames back. (Auto has no
// browser, so its Stills stage pays for that sandbox instead —
// lib/film-stages/stills.js — writing the same keys and pinning through the
// same Director helpers.)
//
// ── The sheet is assembled, never typed ─────────────────────────────────────
// `lib/shot-sheet.ts` derives the grab times from the SAME list of shots the
// prompt is written from. A prompt with sixteen shots in it and seventeen grabs
// taken out of it is a film whose every pin is one beat wrong, and nothing
// about the result looks like a bug — it looks like the model drifting. The
// page and this route both call `validateSheet`, so a sheet either would refuse
// is refused in one place, before a render is paid for.
import { absolutizeSeries, readSeries, readSheets } from "../lib/director.js";
import { putMedia } from "../lib/media.js";
import { endpointFor, renderBody, slotsOf } from "../lib/shot-sheet.ts";
import {
  buildRun as planRun, finishRender, planView, runErrors, submitClips, takeWithUrl, writeSeams,
} from "../lib/shot-sheet-run.js";

function falKeyOf(c) {
  return c.req.header("x-fal-key") || c.env.FAL_KEY || "";
}

export function registerShotSheet(app) {
  // ── What this Series' sheet WOULD be ──────────────────────────────────────
  //
  // Every frame the cue sheet needs, whether it is already drawn, what the shot
  // line for it would say, and the Series' current reel changes. Read before
  // rendering, so the author chooses the slots rather than discovering the
  // choice was made for them.
  app.get("/api/shotsheet/:seriesId", async (c) => {
    const pid = c.get("projectId");
    const seriesId = c.req.param("seriesId");
    const series = await readSeries(c.env, pid, seriesId);
    if (!series) return c.json({ error: "No such Series" }, 404);

    // Absolutized because a reference is a url FAL fetches, from its own
    // network — a `/visual-media/…` path there is a 404 nobody sees until the
    // frames come back in the wrong hand.
    const resolved = absolutizeSeries(c.env, pid, series);
    const db = await readSheets(c.env, pid);
    return c.json({
      seriesId,
      title: series.title,
      slots: slotsOf(resolved),
      // The reel changes the last run wrote — the pin checks count per reel.
      reelChanges: series.reelChanges || [],
      clause: series.prompts?.shotSheet || null,
      // With its playable url — the tab plays `take.url`, and a take read back
      // after a reload used to arrive without one, as an empty player.
      takes: (db.takes || [])
        .filter((t) => t.seriesId === seriesId)
        .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
        .map(takeWithUrl),
    });
  });

  // Rehearse the render without paying for it: the assembled prompt, the grab
  // times, the endpoint it would go to, and every reason it would be refused.
  app.post("/api/shotsheet/:seriesId/preview", async (c) => {
    const pid = c.get("projectId");
    const series = await readSeries(c.env, pid, c.req.param("seriesId"));
    if (!series) return c.json({ error: "No such Series" }, 404);
    let body;
    try { body = await c.req.json(); } catch { body = {}; }

    const { plan, sheets } = buildRun(c, pid, series, body);
    const parts = sheets.map((sheet, index) => ({
      reel: index + 1,
      opensAt: plan.reels[index].opensAt,
      sheet,
      endpoint: endpointFor(sheet),
      request: renderBody(sheet),
    }));
    // `sheet`/`endpoint`/`request` are the first clip's, for callers that read
    // one; `parts` is the whole run, one clip per reel; `plan` is the reels,
    // the seams they open on and the frames those seams cost.
    return c.json({ ...parts[0], parts, plan: planView(plan), errors: runErrors(plan, sheets) });
  });

  // ── Render ────────────────────────────────────────────────────────────────
  //
  // Submitted to fal's queue and NOT waited on. A sheet takes minutes and a
  // Worker request does not — the same split `/api/musical/job/:id` makes. The
  // ledger row is written first, as `running`, which is what makes a reload
  // during a render show the render rather than nothing.
  app.post("/api/shotsheet/:seriesId/render", async (c) => {
    const pid = c.get("projectId");
    const seriesId = c.req.param("seriesId");
    const series = await readSeries(c.env, pid, seriesId);
    if (!series) return c.json({ error: "No such Series" }, 404);

    const key = falKeyOf(c);
    if (!key) {
      return c.json({ error: "Rendering a shot sheet needs your fal key — add it in Settings.", code: "no_fal_key" }, 401);
    }

    let body;
    try { body = await c.req.json(); } catch { body = {}; }

    // The run plans the REELS first and draws one clip per reel (ADR 0002).
    // Every clip, and the plan itself, is checked before any of it is paid for.
    const { plan, sheets } = buildRun(c, pid, series, body);
    const errors = runErrors(plan, sheets);
    if (errors.length) return c.json({ error: "This sheet would be refused", errors, plan: planView(plan) }, 400);

    // The seams go on the Series BEFORE fal is paid — re-planned from scratch,
    // so a render always leaves `reelChanges` matching the clips it drew. A pin
    // left inside a new seam's window is cleared (the Series would refuse it,
    // and every pin after it). If the seams would make the Series refuse
    // something it did not refuse already, nothing is written and nothing spent.
    const seamed = await writeSeams(c.env, pid, seriesId, plan);
    if (seamed.missing) return c.json({ error: "No such Series" }, 404);
    if (seamed.introduced) {
      return c.json({
        error: "The Series would refuse these reel changes",
        errors: seamed.introduced.map((message) => ({ message })),
        plan: planView(plan),
      }, 400);
    }

    const runId = crypto.randomUUID();
    // Filed even when a later clip was refused — the ones already queued are
    // being paid for, and a take nobody can see is money nobody can use.
    const { takes, failed } = await submitClips(c.env, pid, { seriesId, plan, sheets, key, runId });
    // Nothing was queued: nothing was spent, and nothing is filed.
    if (!takes.length) return c.json({ error: failed }, 502);

    return c.json({
      ok: true,
      runId,
      take: takes[0],
      takes,
      plan: planView(plan),
      // Offsets whose old pin sat inside a new seam's window and was cleared.
      cleared: seamed.cleared || [],
      ...(failed ? { error: failed } : {}),
    });
  });

  // Poll one take, and FINALIZE it the first time the queue says COMPLETED:
  // pull the bytes into our bucket and file the take. Whoever polls triggers
  // that — the browser, or the agent's render_shot_sheet — so the clip appears
  // without a separate write.
  //
  // On demand rather than in a `waitUntil`, because a render takes minutes and
  // a Worker invocation is not a place to wait them out. The row's `status`
  // guards the finalize, so two pollers arriving together cannot file it twice.
  app.get("/api/shotsheet/take/:id", async (c) => {
    const pid = c.get("projectId");
    const id = c.req.param("id");
    const db = await readSheets(c.env, pid);
    const take = (db.takes || []).find((t) => t.id === id);
    if (!take) return c.json({ error: "No such take" }, 404);

    if (take.status !== "running") return c.json(takeWithUrl(take));

    const key = falKeyOf(c);
    if (!key) return c.json(takeWithUrl(take));

    const finished = await finishRender(c.env, pid, take, key);
    return c.json(takeWithUrl(finished));
  });

  // ── The frames, coming back ───────────────────────────────────────────────
  //
  // The browser cut them out of the take at the grab times the sheet derived.
  // Each one arrives with the OFFSET it belongs to, because that is the only
  // thing that decides which beat it pins — and the trap this whole surface
  // exists around is that a pin belongs to the beat whose chunk ENDS at that
  // second, not the beat whose prompt describes the picture.
  app.post("/api/shotsheet/pins", async (c) => {
    const pid = c.get("projectId");
    let form;
    try { form = await c.req.parseBody({ all: true }); } catch {
      return c.json({ error: "Expected multipart form data" }, 400);
    }
    const seriesId = String(form.seriesId || "");
    const takeId = String(form.takeId || "");
    const series = await readSeries(c.env, pid, seriesId);
    if (!series) return c.json({ error: "No such Series" }, 404);

    const frames = [].concat(form["frame"] ?? []).filter((f) => f instanceof File);
    const offsets = [].concat(form["offset"] ?? []).map(Number);
    if (!frames.length) return c.json({ error: "Attach the cut frames as `frame`, one per pin" }, 400);
    if (frames.length !== offsets.length) {
      return c.json({ error: `${frames.length} frames but ${offsets.length} offsets — each frame names the second it pins` }, 400);
    }

    const stored = [];
    for (let i = 0; i < frames.length; i++) {
      const bytes = await frames[i].arrayBuffer();
      if (!bytes.byteLength) continue;
      const name = `pin_${seriesId}_${offsets[i]}s_${takeId || "manual"}.png`;
      await putMedia(c.env, pid, "director", name, bytes, frames[i].type || "image/png");
      stored.push({ offset: offsets[i], file: name });
    }
    return c.json({
      ok: true,
      // NOT pinned here. Writing `endImageUrl` runs the whole cue-sheet
      // validation — spacing, count, the opening chunk — and that belongs in
      // one place, which is the Director's own cue route. This hands back the
      // paths to send there.
      frames: stored.map((s) => ({ offset: s.offset, imageUrl: `/director-media/${s.file}` })),
      next: `POST /api/director/series/${seriesId}/pin, one per frame`,
    });
  });
}

// The route's run: the shared planner (lib/shot-sheet-run.js) on this request's env.
const buildRun = (c, pid, series, body) => planRun(c.env, pid, series, body);
