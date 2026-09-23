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
// files; `POST /api/shotsheet/pins` takes the frames back.
//
// ── The sheet is assembled, never typed ─────────────────────────────────────
// `lib/shot-sheet.ts` derives the grab times from the SAME list of shots the
// prompt is written from. A prompt with sixteen shots in it and seventeen grabs
// taken out of it is a film whose every pin is one beat wrong, and nothing
// about the result looks like a bug — it looks like the model drifting. The
// page and this route both call `validateSheet`, so a sheet either would refuse
// is refused in one place, before a render is paid for.
import { absolutizeSeries, readSeries, readSheets, updateSeries, updateSheets } from "../lib/director.js";
import { putMedia } from "../lib/media.js";
import { endpointFor, renderBody, sheetFrom, slotsOf, validateSheet } from "../lib/shot-sheet.ts";
import { falAuthorization } from "./stage.js";

const FAL_QUEUE = "https://queue.fal.run";

const nowIso = () => new Date().toISOString();

const takeWithUrl = (row) => ({ ...row, url: row.file ? `/director-media/${row.file}` : null });

function falKeyOf(c) {
  return c.req.header("x-fal-key") || c.env.FAL_KEY || "";
}

export function registerShotSheet(app) {
  // ── What this Series' sheet WOULD be ──────────────────────────────────────
  //
  // Every frame the cue sheet needs, whether it is already drawn, what the shot
  // line for it would say, and which of them fit in one clip. Read before
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

    const sheet = buildSheet(c, pid, series, body);
    const errors = validateSheet(sheet);
    return c.json({ sheet, endpoint: endpointFor(sheet), request: renderBody(sheet), errors });
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

    const sheet = buildSheet(c, pid, series, body);
    const errors = validateSheet(sheet);
    if (errors.length) return c.json({ error: "This sheet would be refused", errors }, 400);

    const endpoint = endpointFor(sheet);
    const submitted = await fetch(`${FAL_QUEUE}/${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: falAuthorization(key) },
      body: JSON.stringify(renderBody(sheet)),
    });
    const queued = await submitted.json().catch(() => null);
    if (!submitted.ok || !queued?.request_id) {
      return c.json({ error: queued?.detail || `fal refused the sheet (${submitted.status})` }, 502);
    }

    const take = {
      id: queued.request_id,
      seriesId,
      status: "running",
      endpoint,
      // The WHOLE sheet, kept verbatim. A take whose prompt was lost is a look
      // that cannot be redrawn, and the grab times are only meaningful beside
      // the shot list they were derived from.
      sheet,
      startedAt: nowIso(),
      file: null,
      error: null,
    };
    await updateSheets(c.env, pid, (db) => {
      db.seq = (db.seq || 0) + 1;
      db.takes = [take, ...(db.takes || [])];
      return {};
    });

    return c.json({ ok: true, take });
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

/**
 * The sheet a request amounts to.
 *
 * `slots` names which offsets to draw; omitted, every slot the cue sheet offers
 * that is not already refused. The duration is the author's — it is the one
 * number that trades "how many pins fit" against "how long each is held".
 */
function buildSheet(c, pid, series, body) {
  const resolved = absolutizeSeries(c.env, pid, series);
  const chosen = Array.isArray(body.slots) && body.slots.length
    ? body.slots.map(Number)
    : slotsOf(resolved).filter((s) => !s.refused).map((s) => s.offset);
  const duration = Number.isInteger(body.duration) ? body.duration : undefined;
  const sheet = sheetFrom(resolved, chosen, duration);
  if (Number.isInteger(body.seed)) sheet.seed = body.seed;
  return sheet;
}

/**
 * Ask the queue once, and file the take if it is done.
 *
 * Returns the ledger row as it now stands. Filed as a STYLE model sheet on the
 * Series as well as in the ledger, because that is what it is: one pass of the
 * whole look, with the prompt that made it — so the next sheet of this Series
 * can be asked for with the last one in front of it.
 */
async function finishRender(env, pid, take, key) {
  const headers = { authorization: falAuthorization(key) };
  const fail = async (error) => {
    const res = await updateSheets(env, pid, (db) => {
      const row = (db.takes || []).find((t) => t.id === take.id);
      if (!row || row.status !== "running") return { abort: true, row };
      row.status = "error";
      row.error = error;
      row.endedAt = nowIso();
      return { row };
    });
    return res.row ?? { ...take, status: "error", error };
  };

  let result = null;
  try {
    const status = await fetch(`${FAL_QUEUE}/${take.endpoint}/requests/${take.id}/status`, { headers });
    const state = await status.json().catch(() => null);
    if (state?.status === "FAILED") return fail(state?.error || "fal reported FAILED");
    if (state?.status !== "COMPLETED") return take;

    const done = await fetch(`${FAL_QUEUE}/${take.endpoint}/requests/${take.id}`, { headers });
    result = await done.json().catch(() => null);
  } catch (e) {
    // A transient network failure is not a finished render — leave the row
    // running so the next poll tries again rather than burying a live take.
    return take;
  }

  const url = result?.video?.url || result?.videos?.[0]?.url;
  if (!url) return fail("the render finished with no video");

  try {
    const bytes = await (await fetch(url)).arrayBuffer();
    // Derived from the request id, so a second poller that gets here writes the
    // same object rather than minting a copy.
    const file = `shot-sheet_${take.seriesId}_${take.id}.mp4`;
    await putMedia(env, pid, "director", file, bytes, "video/mp4");

    const res = await updateSheets(env, pid, (db) => {
      const row = (db.takes || []).find((t) => t.id === take.id);
      if (!row || row.status !== "running") return { abort: true, row };
      row.status = "done";
      row.file = file;
      row.endedAt = nowIso();
      return { row };
    });

    await updateSeries(env, pid, take.seriesId, (series) => {
      if (!series?.id) return { abort: true };
      const name = `shot sheet ${take.id.slice(0, 8)}`;
      const sheets = series.modelSheets || [];
      if (sheets.some((sheet) => sheet.name === name)) return { abort: true };
      series.modelSheets = [
        ...sheets,
        {
          kind: "style",
          name,
          prompt: take.sheet?.premise ?? null,
          imageUrl: `/director-media/${file}`,
          model: take.endpoint,
          refs: (take.sheet?.references || []).map((r) => r.url),
        },
      ];
      series.updatedAt = nowIso();
      return {};
    });

    return res.row ?? { ...take, status: "done", file };
  } catch (e) {
    return fail(String(e?.message || e));
  }
}
