// Director Series — the cue sheet a live Director plans a whole film from.
//
// The other way to make a picture in this studio. Everywhere else you render a
// shot, then the next shot, then cut them together. Here you write ONE recipe —
// an opening prompt, an exact first frame, and a cue sheet of timed beats — and
// the endpoint generates the piece continuously against it. A beat is a second
// on the FILM'S OWN CLOCK (not the wall clock) plus what happens there: a prompt
// that directs from then on, the exact frame to land on, or the audio to shoot
// against.
//
// ── Why the validation lives in a zod module and not in shared/schemas ───────
// Every other capability here describes itself once in `shared/schemas/*.json`,
// which the route validates against and the flue tool builds its valibot input
// from. This one describes itself once in `src/lib/series.ts` instead, vendored
// to this package and to flue-agent by `npm run series:sync`. The reason is that
// a Series' rules are not field shapes — they are relationships BETWEEN fields
// that only code can state: two pinned frames must be three seconds apart, a
// reel's first pin must clear its opening chunk, and both of those are counted
// per REEL after the sheet has been cut and rebased. A JSON schema can say a
// number is a number. It cannot say that a 17-pin sheet is refused whole and
// legal cut in two.
//
// It matters because of HOW the endpoint refuses: not per field, and not on the
// beat that is wrong, but the whole session at `configure` — after the sheet was
// saved, after the frames were drawn, and after the author pressed play.
//
// ── Storage ─────────────────────────────────────────────────────────────────
// One `docs` row per Series (`director:<id>`) plus a small index row. See
// lib/director.js for why. Bytes go to R2 under `media/<pid>/director/`.
import {
  absolutizeSeries,
  newSeriesId,
  readIndex,
  readSeries,
  seriesDocName,
  updateIndex,
  updateSeries,
} from "../lib/director.js";
import { readDoc } from "../lib/docs.js";
import { readStillsContext } from "../lib/stills.js";
import { normalizeShot } from "../lib/shots.js";
import {
  MIN_END_IMAGE_GAP_SECONDS,
  MIN_OPENING_END_IMAGE_SECONDS,
  applyPatch,
  archiveReplacedAudio,
  artSettings,
  fieldErrors,
  recipe,
  reels,
  screening,
  seriesFields,
  seriesInput,
  seriesPatch,
  stampCueTiming,
} from "../lib/series.ts";

const nowIso = () => new Date().toISOString();

/**
 * A Series as the client reads it: the row, plus everything derived from it.
 *
 * Derived rather than stored, always. A stored recipe is a second truth that
 * goes stale the moment a beat moves, and the failure it causes — a sitting
 * generated from last week's sheet — looks exactly like the endpoint behaving
 * oddly rather than like a caching bug.
 */
function seriesView(env, pid, series) {
  const resolved = absolutizeSeries(env, pid, series);
  const check = seriesInput.safeParse(series);
  const cut = reels(resolved);
  return {
    series,
    /** The exact `configure` message a sitting would open with. */
    recipe: recipe(resolved),
    /** Everything one sitting sends, in order, plus how long the film runs. */
    screening: screening(resolved),
    /** How the sheet is cut. One entry unless the Series names a reel change. */
    reels: cut.map((beats, i) => ({
      reel: i + 1,
      beats: beats.length,
      pins: beats.filter((b) => b.end_image_url).length,
      seconds: beats.at(-1)?.offset ?? 0,
    })),
    art: artSettings(series),
    /**
     * What the endpoint would refuse, said now. Empty means a sitting is worth
     * paying for; every entry is a session that would die at `configure`.
     */
    issues: check.success ? {} : fieldErrors(check.error),
  };
}

/** The short form for the index: enough to draw a list, nothing more. */
const summary = (s) => ({
  id: s.id,
  title: s.title,
  status: s.status,
  aspectRatio: s.aspectRatio,
  resolution: s.resolution,
  beats: (s.directions || []).length,
  pins: (s.directions || []).filter((d) => d.endImageUrl).length,
  sheets: (s.modelSheets || []).length,
  hasTargetAudio: !!s.audioVersion?.audioUrl,
  updatedAt: s.updatedAt,
});

export function registerDirector(app) {
  // ── The index ─────────────────────────────────────────────────────────────

  app.get("/api/director", async (c) => {
    const pid = c.get("projectId");
    const index = await readIndex(c.env, pid);
    const rows = await Promise.all((index.seriesIds || []).map((id) => readSeries(c.env, pid, id)));
    const series = rows.filter(Boolean).map(summary);
    return c.json({
      series,
      // A dangling id means the Series row was restored away or never landed.
      // Reported rather than silently dropped: the index is repaired by a write,
      // and a read that quietly hid it would make that repair look unnecessary.
      missing: (index.seriesIds || []).filter((id, i) => !rows[i]),
      selectedId: index.selectedId && series.some((s) => s.id === index.selectedId)
        ? index.selectedId
        : series[0]?.id || null,
    });
  });

  app.post("/api/director/series", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }

    const parsed = seriesFields.safeParse({
      title: String(body.title || "").trim() || "Untitled Series",
      prompt: String(body.prompt || "").trim(),
      // The Stage is a browser, so a Series written here is landscape unless the
      // author says otherwise. The SCHEMA still defaults to 9:16 — see the note
      // on DEFAULT_ASPECT_RATIO — because a Series imported from elsewhere must
      // not silently change its opening frame. This default is the Stage's.
      aspectRatio: body.aspectRatio || "16:9",
      ...(body.resolution ? { resolution: body.resolution } : {}),
      ...(body.imageUrl ? { imageUrl: body.imageUrl } : {}),
    });
    if (!parsed.success) return c.json({ error: "Invalid Series", issues: fieldErrors(parsed.error) }, 400);

    const id = newSeriesId();
    const at = nowIso();
    const row = { ...parsed.data, id, createdAt: at, updatedAt: at };

    // The index is the PRIMARY (it is compare-and-swapped) and the Series rides
    // as an `also` row, so either both land or neither does. A Series written
    // without its index entry is a document nothing can reach; an index entry
    // written without its Series is the `missing` list above.
    await updateIndex(c.env, pid, (index) => {
      index.seq = (index.seq || 0) + 1;
      index.seriesIds = [...(index.seriesIds || []), id];
      index.selectedId = id;
      return {};
    }, { also: [{ name: seriesDocName(id), value: row }] });

    return c.json({ ok: true, ...seriesView(c.env, pid, row) });
  });

  // Which Series the tab opens on. Per PROJECT, not per user: two authors on one
  // project are working on the same film, and the Stage's whole premise is that
  // one session exists at a time.
  app.put("/api/director/selected", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const id = String(body.seriesId || "");
    const res = await updateIndex(c.env, pid, (index) => {
      if (!(index.seriesIds || []).includes(id)) return { abort: true, missing: true };
      index.selectedId = id;
      return {};
    });
    if (res.missing) return c.json({ error: `No Series ${id} on this project` }, 404);
    return c.json({ ok: true, selectedId: id });
  });

  // ── One Series ────────────────────────────────────────────────────────────

  app.get("/api/director/series/:id", async (c) => {
    const pid = c.get("projectId");
    const series = await readSeries(c.env, pid, c.req.param("id"));
    if (!series) return c.json({ error: "No such Series" }, 404);
    return c.json(seriesView(c.env, pid, series));
  });

  // What to generate this Series' art AT. Derived from the row, served as a
  // route, because these numbers used to live in a skill and in a doc — two
  // places a Series cannot reach and that nothing updates when it changes shape.
  app.get("/api/director/series/:id/art", async (c) => {
    const pid = c.get("projectId");
    const series = await readSeries(c.env, pid, c.req.param("id"));
    if (!series) return c.json({ error: "No such Series" }, 404);
    return c.json(artSettings(series));
  });

  // A patch changes what it NAMES. `undefined` is "not mentioned", never "clear
  // this" — a form that omits a field must not erase it; clearing is `null`.
  app.put("/api/director/series/:id", async (c) => {
    const pid = c.get("projectId");
    const id = c.req.param("id");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }

    const parsed = seriesPatch.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid patch", issues: fieldErrors(parsed.error) }, 400);

    const res = await updateSeries(c.env, pid, id, (series) => {
      if (!series?.id) return { abort: true, missing: true };
      // Swapping which sound a Series is shot against archives the one it had —
      // a render that is replaced is kept, never overwritten, because a version
      // whose prompt was lost cannot be made again in the same hand.
      const patch = archiveReplacedAudio(series, parsed.data);
      const next = stampCueTiming(applyPatch(series, patch));
      const check = seriesInput.safeParse(next);
      if (!check.success) return { abort: true, issues: fieldErrors(check.error) };
      Object.assign(series, next, { updatedAt: nowIso() });
      return {};
    });
    if (res.missing) return c.json({ error: "No such Series" }, 404);
    if (res.issues) return c.json({ error: "The endpoint would refuse this", issues: res.issues }, 400);

    const series = await readSeries(c.env, pid, id);
    return c.json({ ok: true, ...seriesView(c.env, pid, series) });
  });

  // ── The cue sheet ─────────────────────────────────────────────────────────
  //
  // Its own route rather than a `directions` patch, because writing a sheet has
  // modes the whole-field PUT cannot express — and because a REPLACE that
  // shrinks the sheet is the one destructive thing here.
  app.post("/api/director/series/:id/cue", async (c) => {
    const pid = c.get("projectId");
    const id = c.req.param("id");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }

    const mode = ["replace", "merge", "remove"].includes(body.mode) ? body.mode : "replace";
    const beats = Array.isArray(body.beats) ? body.beats : [];

    const res = await updateSeries(c.env, pid, id, (series) => {
      if (!series?.id) return { abort: true, missing: true };
      const before = series.directions || [];
      let next;
      if (mode === "replace") {
        next = beats;
      } else if (mode === "remove") {
        // Offsets, because an offset IS the beat's identity to the Director.
        const drop = new Set(beats.map((b) => Number(b.offset ?? b)));
        next = before.filter((b) => !drop.has(b.offset));
      } else {
        // MERGE by offset: a beat at an offset that already exists replaces it
        // field by field, so moving one beat does not require resending forty.
        const byOffset = new Map(before.map((b) => [b.offset, b]));
        for (const beat of beats) {
          const at = Number(beat.offset);
          byOffset.set(at, { ...(byOffset.get(at) || {}), ...beat, offset: at });
        }
        next = [...byOffset.values()];
      }
      next = [...next].sort((a, b) => Number(a.offset) - Number(b.offset));

      const candidate = stampCueTiming({ ...series, directions: next });
      const check = seriesInput.safeParse(candidate);
      if (!check.success) return { abort: true, issues: fieldErrors(check.error) };

      Object.assign(series, candidate, { updatedAt: nowIso() });
      return { removed: Math.max(0, before.length - next.length), beats: next.length };
    });
    if (res.missing) return c.json({ error: "No such Series" }, 404);
    if (res.issues) return c.json({ error: "The endpoint would refuse this cue sheet", issues: res.issues }, 400);

    const series = await readSeries(c.env, pid, id);
    return c.json({ ok: true, mode, removed: res.removed, ...seriesView(c.env, pid, series) });
  });

  // ── Derive a cue sheet from the shot list ─────────────────────────────────
  //
  // The link that makes this a plugin of THIS studio rather than a second app
  // sharing its header: Script → Shot list → Cue sheet → Stage.
  //
  // What a shot becomes, and why each part lands where it does:
  //
  //   offset     the accumulated `dur` of every shot before it. The shot list
  //              already carries how long each shot runs, which is the only
  //              number the cue sheet needs and the one nobody wants to retype.
  //   range      the window this beat covers, written out. A beat directs from
  //              its offset until the NEXT text beat, and saying so in the
  //              prompt is what stops one beat inventing three shots.
  //   style      the camera language, verbatim.
  //   scene      the action, with the location and who is in it.
  //   score      the shot's audio sync note, when it has one.
  //
  // Sections rather than one string, so a whole layer can be dropped from the
  // piece later by editing `prompts.sections` — one list, not forty-eight beats.
  app.post("/api/director/series/:id/derive", async (c) => {
    const pid = c.get("projectId");
    const id = c.req.param("id");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const pin = body.pin !== false;

    const series = await readSeries(c.env, pid, id);
    if (!series) return c.json({ error: "No such Series" }, 404);

    const doc = await readDoc(c.env, pid, "shotlist", { shots: [] });
    const shots = (doc.shots || []).map(normalizeShot);
    if (!shots.length) {
      return c.json({ error: "This project has no shot list yet — write one first, or author the beats by hand." }, 400);
    }

    const stills = pin ? await readStillsContext(c.env, pid, shots) : null;

    const beats = [];
    const skippedPins = [];
    let clock = 0;
    let lastPin = null;
    for (const shot of shots) {
      const offset = Math.round(clock);
      const seconds = Number(shot.dur) || 0;
      clock += seconds;

      const until = Math.round(clock);
      const sections = {};
      sections.range = seconds
        ? `Seconds ${offset}–${until} of the film.`
        : `From second ${offset}.`;
      if (shot.camera) sections.style = shot.camera;
      const scene = [
        shot.location ? `${shot.location}.` : "",
        shot.action,
        shot.dialogue ? `Dialogue: ${shot.dialogue}` : "",
      ].filter(Boolean).join(" ");
      if (scene) sections.scene = scene;
      if (shot.audioSync) sections.score = shot.audioSync;

      const beat = { offset, prompt: sections };

      // A pin is the EXACT frame the chunk ending at this offset lands on, and
      // the endpoint spaces them: three seconds apart, and the first one clear
      // of the longer opening chunk. A storyboard still that cannot legally be
      // pinned is reported rather than dropped silently — the author decides
      // whether to move the beat or let the shot go unpinned.
      const take = stills?.resolve(shot.id)?.take;
      if (take?.file) {
        const tooEarly = offset < MIN_OPENING_END_IMAGE_SECONDS;
        const tooClose = lastPin !== null && offset - lastPin < MIN_END_IMAGE_GAP_SECONDS;
        if (tooEarly || tooClose) {
          skippedPins.push({
            shot: shot.id,
            offset,
            why: tooEarly
              ? `inside the opening chunk (the first pin must be at least ${MIN_OPENING_END_IMAGE_SECONDS}s in)`
              : `only ${offset - lastPin}s after the pin at ${lastPin}s (the Director needs ${MIN_END_IMAGE_GAP_SECONDS}s)`,
          });
        } else {
          beat.endImageUrl = `/storyboard-media/${take.file}`;
          lastPin = offset;
        }
      }
      beats.push(beat);
    }

    const res = await updateSeries(c.env, pid, id, (row) => {
      if (!row?.id) return { abort: true, missing: true };
      const candidate = stampCueTiming({ ...row, directions: beats });
      const check = seriesInput.safeParse(candidate);
      if (!check.success) return { abort: true, issues: fieldErrors(check.error) };
      Object.assign(row, candidate, { updatedAt: nowIso() });
      return {};
    });
    if (res.missing) return c.json({ error: "No such Series" }, 404);
    if (res.issues) return c.json({ error: "The derived cue sheet would be refused", issues: res.issues }, 400);

    const next = await readSeries(c.env, pid, id);
    return c.json({
      ok: true,
      derived: beats.length,
      pinned: beats.filter((b) => b.endImageUrl).length,
      skippedPins,
      filmSeconds: Math.round(clock),
      ...seriesView(c.env, pid, next),
    });
  });

  // ── Model sheets ──────────────────────────────────────────────────────────
  //
  // The reference art everything else is drawn against, and the one part of a
  // Series that is never sent anywhere: `configure` rejects properties it does
  // not know, and these are prompts for an IMAGE model, kept so the next frame
  // can be made in the same hand as the last.
  //
  // They are POINTED AT rather than generated here. The picture comes from the
  // Images plugin, the Library, or the Bible's character sheets — this route
  // records which picture, what made it, and what it is a sheet OF.
  app.post("/api/director/series/:id/sheets", async (c) => {
    const pid = c.get("projectId");
    const id = c.req.param("id");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }

    const remove = String(body.remove || "");
    const sheet = body.sheet || null;

    const res = await updateSeries(c.env, pid, id, (series) => {
      if (!series?.id) return { abort: true, missing: true };
      const sheets = [...(series.modelSheets || [])];
      if (remove) {
        const at = sheets.findIndex((s) => s.name === remove);
        if (at < 0) return { abort: true, noSheet: true };
        sheets.splice(at, 1);
      } else if (sheet) {
        // Named, not indexed: a sheet's name is what the cue sheet's beats refer
        // to it by ("Image 2 is Kai's mecha"), so replacing by name is what
        // keeps those references pointing at the same thing.
        const at = sheets.findIndex((s) => s.name === sheet.name);
        if (at >= 0) sheets[at] = { ...sheets[at], ...sheet };
        else sheets.push(sheet);
      } else {
        return { abort: true, empty: true };
      }
      const candidate = { ...series, modelSheets: sheets };
      const check = seriesInput.safeParse(candidate);
      if (!check.success) return { abort: true, issues: fieldErrors(check.error) };
      Object.assign(series, candidate, { updatedAt: nowIso() });
      return { sheets: sheets.length };
    });
    if (res.missing) return c.json({ error: "No such Series" }, 404);
    if (res.noSheet) return c.json({ error: `No model sheet named "${remove}"` }, 404);
    if (res.empty) return c.json({ error: "Send a `sheet` to add or replace, or a `remove` name" }, 400);
    if (res.issues) return c.json({ error: "Invalid model sheet", issues: res.issues }, 400);

    const series = await readSeries(c.env, pid, id);
    return c.json({ ok: true, sheets: res.sheets, ...seriesView(c.env, pid, series) });
  });

  // ── Target Audio ──────────────────────────────────────────────────────────
  //
  // Audio the Director generates AGAINST rather than plays over: every chunk is
  // shaped by the next window of the recording. That is why a soundtrack here is
  // an INPUT to the film and not a layer on it, and why a refused one is not a
  // quieter sitting but a different one.
  //
  // The Director repo grew its own renderer for this. Here it points at Sound
  // Studio instead — this studio already keeps versioned audio takes with a
  // liked pick, and a second place to render a mix is a second place for it to
  // go stale. Pass a `/sound-media/<file>` path and the prompt that made it.
  app.post("/api/director/series/:id/audio", async (c) => {
    const pid = c.get("projectId");
    const id = c.req.param("id");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }

    const clear = body.clear === true;
    const version = clear
      ? null
      : {
          prompt: String(body.prompt || "").trim(),
          audioUrl: String(body.audioUrl || "").trim(),
          model: body.model ?? null,
          seconds: typeof body.seconds === "number" ? body.seconds : null,
          renderedAt: body.renderedAt || nowIso(),
        };

    const res = await updateSeries(c.env, pid, id, (series) => {
      if (!series?.id) return { abort: true, missing: true };
      const patch = archiveReplacedAudio(series, { audioVersion: version });
      const candidate = stampCueTiming(applyPatch(series, patch));
      const check = seriesInput.safeParse(candidate);
      if (!check.success) return { abort: true, issues: fieldErrors(check.error) };
      Object.assign(series, candidate, { updatedAt: nowIso() });
      return { past: (series.pastAudioVersions || []).length };
    });
    if (res.missing) return c.json({ error: "No such Series" }, 404);
    if (res.issues) return c.json({ error: "Invalid target audio", issues: res.issues }, 400);

    const series = await readSeries(c.env, pid, id);
    return c.json({ ok: true, archived: res.past, ...seriesView(c.env, pid, series) });
  });

  // ── Pin a frame to a beat ─────────────────────────────────────────────────
  //
  // Its own route because pinning is the operation with the trap in it: a pin
  // belongs to the beat whose chunk ENDS at that second, which is not the beat
  // whose prompt describes the picture. Pin by OFFSET and the endpoint and the
  // author are talking about the same beat.
  app.post("/api/director/series/:id/pin", async (c) => {
    const pid = c.get("projectId");
    const id = c.req.param("id");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const offset = Number(body.offset);
    if (!Number.isFinite(offset)) return c.json({ error: "Send the `offset` of the beat to pin" }, 400);

    const res = await updateSeries(c.env, pid, id, (series) => {
      if (!series?.id) return { abort: true, missing: true };
      const beats = [...(series.directions || [])];
      const at = beats.findIndex((b) => b.offset === offset);
      if (at < 0) return { abort: true, noBeat: true };
      beats[at] = {
        ...beats[at],
        endImageUrl: body.clear ? null : String(body.imageUrl || ""),
        // Kept beside the pin for the same reason a model sheet keeps its
        // prompt: a pin whose prompt was lost is a shot that cannot be redrawn
        // in the same hand. None of it reaches the Director.
        endImagePrompt: body.clear ? null : (body.prompt ?? beats[at].endImagePrompt ?? null),
        endImageModel: body.clear ? null : (body.model ?? beats[at].endImageModel ?? null),
        endImageRefs: body.clear ? null : (body.refs ?? beats[at].endImageRefs ?? null),
      };
      const candidate = stampCueTiming({ ...series, directions: beats });
      const check = seriesInput.safeParse(candidate);
      if (!check.success) return { abort: true, issues: fieldErrors(check.error) };
      Object.assign(series, candidate, { updatedAt: nowIso() });
      return {};
    });
    if (res.missing) return c.json({ error: "No such Series" }, 404);
    if (res.noBeat) {
      return c.json({ error: `No beat at ${offset}s. A pin belongs to the beat whose chunk ENDS there.` }, 404);
    }
    if (res.issues) return c.json({ error: "That pin would be refused", issues: res.issues }, 400);

    const series = await readSeries(c.env, pid, id);
    return c.json({ ok: true, ...seriesView(c.env, pid, series) });
  });
}
