// Radio-version endpoints (/api/radio*). The "radio version" is the audio-only
// pass of the episode: every scene's dialogue voiced with each character's
// favorited Sound Studio voice (rendered with Seed Audio via the agent), laid
// out in order so it can be sent into the Editor as a new "radio version"
// timeline.
//
// STRUCTURE is DERIVED, never stored: the scenes + lines come fresh from the
// shot list (grouped by `beat`), so the radio view always tracks the shots. The
// radio doc `state/<pid>/radio.json` stores ONLY user intent + render results:
//   { casting:   { <CHARKEY>: voiceRef|null },   // override — orphan speakers only
//     lineEdits: { <lineId>: { character?, text? } },
//     takes:     { <lineId>: [ { trackId, v, at, selected, selectedAt } ] } }
// A line keeps an ARRAY of rendered voice takes (each recreate appends one),
// with a single `selected` pointer — the version that flows to send-to-editor /
// pacing / the animatic. Rendering auto-selects the newest; the user can pick an
// earlier take (e.g. one whose ending isn't clipped). Legacy docs stored a single
// take object per line; `normalizeTakeList` coerces that to a one-element array on
// read, so both shapes work.
// A character's voice is the World character's `voiceRef` (name match) — the
// single source of truth shared with the World tab, so casting here writes THROUGH
// to the World roster and the two never diverge. `casting` above only holds a
// voice for a speaker who has no World record (a shot-list name not in the
// roster). A line's voice = its speaker's voice; the casting rail lists every
// speaker plus every voiced World character.
//
// The final "send to editor" builds an audio-only timeline from the rendered
// takes and appends it to `db.radioVersions` in the selections doc, then loads
// it as the editor's working timeline (mirrors /api/timeline/from-cut).
import { readDoc, updateDoc } from "../lib/docs.js";
import { setCharacterVoiceByName } from "./world.js";
import { normalizeShot } from "../lib/shots.js";
import { listMedia, mediaKey } from "../lib/media.js";
import { broadcast } from "../lib/broadcast.js";
import { appendCapped, nextVersion, MAX_VERSIONS } from "../lib/versions.js";

const TL_FPS = 24;
const NO_DIALOGUE = /^\(?\s*no dialogue\s*\)?\.?$/i;
const charKey = (s) => String(s || "").trim().toUpperCase();
const secFrames = (sec) => Math.max(1, Math.round((sec || 0) * TL_FPS));

const readRadio = (env, pid) =>
  readDoc(env, pid, "radio", { casting: {}, lineEdits: {}, takes: {} });
const updateRadio = (env, pid, mutate) =>
  updateDoc(env, pid, "radio", { casting: {}, lineEdits: {}, takes: {} }, mutate);

async function readShots(env, pid) {
  const obj = await readDoc(env, pid, "shotlist", null);
  return (obj?.shots || []).map(normalizeShot);
}

// The voiced line for a shot, or null when the shot has no spoken dialogue.
// Speaker attribution from free-text shot data: a "NAME:" prefix wins, else the
// lone on-screen character, else the first on-screen character (user-editable).
function deriveLine(shot) {
  const raw = String(shot.dialogue || "").trim();
  if (!raw || NO_DIALOGUE.test(raw)) return null;
  const chars = Array.isArray(shot.characters) ? shot.characters.filter(Boolean) : [];
  let character = chars.length === 1 ? chars[0] : chars[0] || "";
  let text = raw;
  const m = /^\s*([A-Za-z][A-Za-z0-9 .'’-]{0,30}?):\s*(.+)$/s.exec(raw);
  if (m) {
    const named = m[1].trim();
    const hit = chars.find((c) => charKey(c) === charKey(named));
    character = hit || named;
    text = m[2].trim();
  }
  return { id: `sh${shot.n}`, shotId: shot.id, shotN: shot.n, character, text };
}

// Resolve a { trackId, v } take against the sounds doc → playable status.
function resolveTake(sdb, soundFiles, take) {
  if (!take || !take.trackId) return null;
  const t = (sdb.tracks || []).find((x) => x.id === take.trackId);
  const ver = t && (t.versions || []).find((v) => v.v === Number(take.v));
  if (!ver) return { trackId: take.trackId, v: take.v ?? null, status: "missing", url: null, duration: 0, ready: false };
  const ready = ver.status === "ready" && !!ver.file && soundFiles.has(ver.file);
  return {
    trackId: take.trackId,
    v: ver.v,
    status: ver.status || "pending",
    url: ver.file ? "/sound-media/" + ver.file : null,
    duration: ver.duration || 0,
    ready,
  };
}

// A line's takes as a uniform array. New docs store an array; legacy docs stored
// a single take object (auto-selected). Bad entries (no trackId) are dropped.
function normalizeTakeList(entry) {
  if (Array.isArray(entry)) return entry.filter((t) => t && t.trackId);
  if (entry && entry.trackId) return [{ ...entry, selected: true }];
  return [];
}

// The active take out of a stored list: the explicitly-selected one, else the
// newest (last appended). Same rule storyboard/episode use for their selections.
function pickStoredTake(list) {
  return list.find((t) => t.selected) || list[list.length - 1] || null;
}

// Build the derived radio view: scenes (from shots, grouped by beat) with each
// line's resolved speaker, voice (casting), and rendered take. Also the per-
// character casting roster with its source (world vs override).
//
// Exported because the animatic (routes/animatic.js) is this view plus the
// storyboard's pictures — it needs the same resolved lines/takes and must not
// re-derive them, or the two would drift apart.
export async function buildRadioView(env, pid) {
  const [shots, radio, world, sdb] = await Promise.all([
    readShots(env, pid),
    readRadio(env, pid),
    readDoc(env, pid, "world", { characters: [] }),
    readDoc(env, pid, "sounds", { tracks: [] }),
  ]);
  const soundFiles = new Set(await listMedia(env, pid, "sound-media"));

  // World voiceRef by character name (the casting seed).
  const worldVoice = new Map();
  for (const ch of world.characters || []) {
    const key = charKey(ch.name);
    if (key && ch.voiceRef && ch.voiceRef.url && !worldVoice.has(key)) worldVoice.set(key, ch.voiceRef);
  }
  const casting = radio.casting || {};
  const lineEdits = radio.lineEdits || {};
  const takes = radio.takes || {};

  // Attach an ABSOLUTE, publicly-fetchable reference-clip URL to a voiceRef. The
  // stored `url` is the project-scoped `/sound-media/<file>` (needs the project
  // header), which the render agent's bash sandbox can't fetch. `/files/<r2key>`
  // is not auth-gated and encodes the project in the key, so the agent can pull
  // the clip to upload it to Seed Audio as the voice reference.
  const publicBase = String(env.WORKER_PUBLIC_URL || "").replace(/\/+$/, "");
  const withRefUrl = (vref) => {
    if (!vref) return null;
    const m = vref.url && /\/sound-media\/(.+)$/.exec(vref.url);
    const refUrl = m && publicBase ? `${publicBase}/files/${mediaKey(pid, "sound-media", m[1])}` : null;
    return { ...vref, refUrl };
  };

  // The effective voice for a character key: override wins (incl. explicit
  // null = cleared), else the World seed, else none.
  const voiceFor = (key) => {
    if (Object.prototype.hasOwnProperty.call(casting, key)) return { voiceRef: withRefUrl(casting[key] || null), source: "override" };
    if (worldVoice.has(key)) return { voiceRef: withRefUrl(worldVoice.get(key)), source: "world" };
    return { voiceRef: null, source: null };
  };

  const scenes = [];
  const speakers = new Set();
  for (const shot of shots) {
    const derived = deriveLine(shot);
    if (!derived) continue;
    const edit = lineEdits[derived.id] || {};
    const character = edit.character != null ? edit.character : derived.character;
    const text = edit.text != null ? edit.text : derived.text;
    const key = charKey(character);
    if (key) speakers.add(character);
    const { voiceRef } = voiceFor(key);
    // All rendered takes for the line (each recreate appended one), resolved to
    // playable status, plus the single active take that flows downstream.
    const storedTakes = normalizeTakeList(takes[derived.id]);
    const activeStored = pickStoredTake(storedTakes);
    // Mark the ACTIVE take as selected (the one that plays + flows downstream),
    // even when it's the newest fallback rather than an explicit pick — so the UI
    // always highlights exactly the take everything else uses.
    const resolvedTakes = storedTakes.map((t) => ({
      ...resolveTake(sdb, soundFiles, t),
      selected: t === activeStored,
      at: t.at || null,
    }));
    const line = {
      id: derived.id,
      shotId: derived.shotId,
      shotN: derived.shotN,
      character,
      text,
      voiceRef,
      take: activeStored ? resolveTake(sdb, soundFiles, activeStored) : null,
      takes: resolvedTakes,
    };
    const last = scenes[scenes.length - 1];
    if (!last || last.beat !== shot.beat) {
      scenes.push({ beat: shot.beat, beatTitle: shot.beatTitle, lines: [line] });
    } else {
      last.lines.push(line);
    }
  }

  // Casting roster: every speaker in the script, PLUS every World character who
  // already has a voice attached — so a voice set on the World tab always shows
  // here, even for a character who doesn't (yet) speak a line. That's the fix for
  // the two rosters diverging: the World tab could show N voiced characters while
  // this rail only listed the one who happened to have a dialogue line. Keyed by
  // normalized name so a speaker and their World record collapse to one entry.
  const rosterName = new Map(); // charKey -> display name
  for (const character of speakers) {
    const key = charKey(character);
    if (key && !rosterName.has(key)) rosterName.set(key, character);
  }
  for (const ch of world.characters || []) {
    const key = charKey(ch.name);
    if (key && worldVoice.has(key) && !rosterName.has(key)) rosterName.set(key, ch.name);
  }
  const roster = [...rosterName.entries()]
    .map(([key, character]) => {
      const { voiceRef, source } = voiceFor(key);
      return { character, voiceRef, source };
    })
    .sort((a, b) => a.character.localeCompare(b.character));

  const readyLines = scenes.reduce((n, s) => n + s.lines.filter((l) => l.take?.ready).length, 0);
  const totalLines = scenes.reduce((n, s) => n + s.lines.length, 0);
  return { generatedAt: radio.generatedAt || null, scenes, casting: roster, totalLines, readyLines };
}

// Assemble an audio-only timeline from the rendered takes, gapless in
// scene→line order on a single "Dialogue" track (plus an empty video track so
// the Editor's video lane still exists). Mirrors buildTimelineFromCut's shape.
function buildRadioTimeline(view) {
  const items = [];
  let cursor = 0;
  for (const scene of view.scenes) {
    for (const line of scene.lines) {
      if (!line.take?.ready || !line.take.url) continue;
      const words = String(line.text || "").split(/\s+/).filter(Boolean).length;
      const dur = line.take.duration > 0 ? line.take.duration : Math.max(1.2, words / 2.6);
      const durationInFrames = secFrames(dur);
      const label = `${line.character || "?"}: ${String(line.text || "").slice(0, 40)}`;
      items.push({
        id: `rl_${line.id}`,
        src: line.take.url,
        name: label,
        from: cursor,
        durationInFrames,
        sourceDurationInFrames: durationInFrames,
        offsetFrames: 0,
        volume: 1,
      });
      cursor += durationInFrames;
    }
  }
  return {
    fps: TL_FPS,
    width: 1280,
    height: 720,
    source: { kind: "radio", at: new Date().toISOString() },
    tracks: [
      { id: "video", name: "Video", type: "video", items: [] },
      { id: "dialogue", name: "Dialogue", type: "audio", items },
    ],
    _itemCount: items.length,
  };
}

export function registerRadio(app) {
  // The derived radio view (scenes from the shot list + casting + takes).
  app.get("/api/radio", async (c) => {
    const pid = c.get("projectId");
    return c.json(await buildRadioView(c.env, pid));
  });

  // Set a character's voice. Body: { character, voiceRef|null }; null clears it.
  //
  // Single source of truth: if the character is on the World roster, the voice is
  // written onto that World character (shared with the World tab, so the two never
  // diverge) and any stale per-radio override is dropped. Only a speaker with no
  // World record — a name that appears in the shot list but not the character
  // roster — falls back to the radio-only override map.
  app.put("/api/radio/casting", async (c) => {
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON body" }, 400); }
    const key = charKey(body?.character);
    if (!key) return c.json({ error: "character required" }, 400);
    const voiceRef = body?.voiceRef && typeof body.voiceRef === "object"
      ? {
          trackId: String(body.voiceRef.trackId || ""),
          v: Number.isFinite(Number(body.voiceRef.v)) ? Number(body.voiceRef.v) : null,
          name: String(body.voiceRef.name || ""),
          url: String(body.voiceRef.url || ""),
        }
      : null;
    const linked = await setCharacterVoiceByName(c.env, pid, body?.character, voiceRef);
    await updateRadio(c.env, pid, (db) => {
      db.casting = db.casting || {};
      if (linked) delete db.casting[key];
      else db.casting[key] = voiceRef;
    });
    return c.json({ ok: true });
  });

  // Edit one derived line (speaker and/or text). Body: { character?, text? }.
  app.put("/api/radio/line/:id", async (c) => {
    const pid = c.get("projectId");
    const id = c.req.param("id");
    let body;
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON body" }, 400); }
    await updateRadio(c.env, pid, (db) => {
      db.lineEdits = db.lineEdits || {};
      const cur = db.lineEdits[id] || {};
      if (typeof body.character === "string") cur.character = body.character;
      if (typeof body.text === "string") cur.text = body.text;
      db.lineEdits[id] = cur;
    });
    return c.json({ ok: true });
  });

  // Record the rendered voice take for a line (the agent calls this after
  // attach_sound). Body: { trackId, v }. APPENDS to the line's take list and
  // auto-selects the just-rendered take — so a "Recreate" keeps the prior take(s)
  // as alternatives instead of clobbering, and the newest one is active by
  // default. Re-attaching the same { trackId, v } just re-selects it (idempotent).
  app.put("/api/radio/take/:id", async (c) => {
    const pid = c.get("projectId");
    const id = c.req.param("id");
    let body;
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON body" }, 400); }
    const trackId = String(body?.trackId || "");
    const v = Number(body?.v);
    if (!trackId || !Number.isFinite(v)) return c.json({ error: "trackId and v required" }, 400);
    await updateRadio(c.env, pid, (db) => {
      db.takes = db.takes || {};
      const at = new Date().toISOString();
      const list = normalizeTakeList(db.takes[id]);
      const same = (t) => t.trackId === trackId && Number(t.v) === v;
      let take = list.find(same);
      if (take) take.at = at;
      else { take = { trackId, v, at }; list.push(take); }
      for (const t of list) t.selected = false;   // single-selection
      take.selected = true;
      take.selectedAt = at;
      db.takes[id] = list;
      db.generatedAt = at;
    });
    return c.json({ ok: true });
  });

  // Pick which rendered take is active for a line (the version pills on the Radio
  // tab). Body: { trackId, v, selected? }. Single-selection: selecting one clears
  // the others; the active take is what send-to-editor / pacing / the animatic use.
  app.post("/api/radio/take/:id/select", async (c) => {
    const pid = c.get("projectId");
    const id = c.req.param("id");
    let body;
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON body" }, 400); }
    const trackId = String(body?.trackId || "");
    const v = Number(body?.v);
    const selected = body?.selected !== false; // default: select
    if (!trackId || !Number.isFinite(v)) return c.json({ error: "trackId and v required" }, 400);
    let found = false;
    await updateRadio(c.env, pid, (db) => {
      db.takes = db.takes || {};
      const list = normalizeTakeList(db.takes[id]);
      const at = new Date().toISOString();
      for (const t of list) {
        if (t.trackId === trackId && Number(t.v) === v) {
          found = true;
          t.selected = selected;
          if (selected) t.selectedAt = at;
        } else if (selected) {
          t.selected = false;
        }
      }
      if (found) db.takes[id] = list;
    });
    if (!found) return c.json({ error: "No such take for this line" }, 404);
    return c.json({ ok: true });
  });

  // Build the audio-only timeline from the rendered takes and send it to the
  // Editor: append a named "radio version" to db.radioVersions and load it as
  // the working timeline. Broadcasts on the timeline channel so an open Editor
  // reloads (the generic /api/* firehose also fires "data" for the Radio tab).
  app.post("/api/radio/to-editor", async (c) => {
    const pid = c.get("projectId");
    const view = await buildRadioView(c.env, pid);
    const timeline = buildRadioTimeline(view);
    if (!timeline._itemCount) {
      return c.json({ error: "No rendered dialogue yet — render a scene first." }, 400);
    }
    delete timeline._itemCount;

    const db = await readDoc(c.env, pid, "selections", { library: {}, episode: {} });
    db.radioVersions = Array.isArray(db.radioVersions) ? db.radioVersions : [];
    const v = nextVersion(db.radioVersions);
    const at = new Date().toISOString();
    const entry = {
      v,
      name: `radio version v${v}`,
      at,
      clips: timeline.tracks.find((t) => t.id === "dialogue").items.length,
      timeline,
    };
    // Bounded history: this drops the OLDEST versions past the cap, and they are
    // gone for good — so say so in the response rather than reporting a bare ok.
    // CAS on the shared `selections` doc: building the timeline above reads the
    // sounds + shot list, which is long enough for a concurrent Editor autosave
    // or still-attach to land inside the window and be clobbered.
    let pruned = 0;
    await updateDoc(c.env, pid, "selections", { library: {}, episode: {} }, (db) => {
      db.radioVersions = Array.isArray(db.radioVersions) ? db.radioVersions : [];
      ({ pruned } = appendCapped(db.radioVersions, entry));
      db.editorTimeline = timeline;
    });

    await broadcast(
      c.env, pid, "timeline",
      { at, clientId: null },
      c.executionCtx,
    );
    return c.json({
      ok: true,
      version: { v, name: entry.name, at, clips: entry.clips },
      ...(pruned ? { pruned, warning: `Dropped the ${pruned} oldest radio version(s) — only the ${MAX_VERSIONS} most recent are kept.` } : {}),
      timeline,
    });
  });

  // Commit the paced Editor timeline's timing back to the Shot list: set each
  // shot's `dur` to its REALIZED screen time so everything derived from the
  // shot list — the animatic, the <=15s multishot packs, the episode video
  // requests — inherits the pacing instead of the original planned lengths.
  // The pipeline's ordering contract: radio → pace → commit → animatic →
  // generate episode video, so the generated clips land at the paced size.
  //
  // Timing attribution per timeline kind:
  //  - animatic: exact. Every shot's picture item(s) carry `shot` provenance;
  //    its dur = the summed length of its picture items.
  //  - radio: only voiced shots are on the timeline, so the air between two
  //    lines has to be attributed. The voiced shot keeps its take plus a small
  //    trailing breath; the rest of the gap is split across the silent shots
  //    between them, proportional to their planned durs (what the writer
  //    thought each was worth). No silent shots ⇒ the whole gap is the voiced
  //    shot's. Shots outside the voiced span are left untouched.
  //
  // Only `dur` values change — ids, order, and every other field are preserved
  // (shot ids are a public key space; see routes/shotlist.js).
  app.post("/api/radio/commit-pacing", async (c) => {
    const pid = c.get("projectId");
    const sel = await readDoc(c.env, pid, "selections", { library: {}, episode: {} });
    const tl = sel.editorTimeline;
    const kind = tl?.source?.kind;
    if (!tl || (kind !== "radio" && kind !== "animatic")) {
      return c.json({ error: "The Editor doesn't hold a radio or animatic timeline — send one there (and pace it) first." }, 400);
    }
    const fps = tl.fps || TL_FPS;
    const slDoc = await readDoc(c.env, pid, "shotlist", null);
    const shots = (slDoc?.shots || []).map(normalizeShot);
    if (!shots.length) return c.json({ error: "No shot list to commit into." }, 400);

    const newDur = new Map(); // shot n → seconds
    if (kind === "animatic") {
      const secByShotId = new Map();
      for (const t of tl.tracks || []) {
        if (t.type !== "video") continue;
        for (const it of t.items || []) {
          if (it.kind === "image" && it.shot) {
            secByShotId.set(it.shot, (secByShotId.get(it.shot) || 0) + (it.durationInFrames || 0) / fps);
          }
        }
      }
      for (const s of shots) if (secByShotId.has(s.id)) newDur.set(s.n, secByShotId.get(s.id));
    } else {
      // Span of each voiced shot's take(s) on the timeline. Matched by the
      // `rl_sh<n>` id PREFIX so splits (`_r…` suffixes) and takes moved onto an
      // overlap lane still count toward their shot.
      const spans = new Map(); // n → { n, start, end } in frames
      for (const t of tl.tracks || []) {
        if (t.type !== "audio") continue;
        for (const it of t.items || []) {
          const m = /^rl_sh(\d+)/.exec(it.id || "");
          if (!m) continue;
          const n = Number(m[1]);
          const start = it.from || 0;
          const end = start + (it.durationInFrames || 0);
          const sp = spans.get(n);
          if (!sp) spans.set(n, { n, start, end });
          else { sp.start = Math.min(sp.start, start); sp.end = Math.max(sp.end, end); }
        }
      }
      const voiced = [...spans.values()].sort((a, b) => a.start - b.start);
      const shotByN = new Map(shots.map((s) => [s.n, s]));
      const BREATH_SEC = 0.4; // trailing air a spoken shot keeps before the cut
      for (let i = 0; i < voiced.length; i++) {
        const a = voiced[i];
        const b = voiced[i + 1] || null;
        const takeSec = (a.end - a.start) / fps;
        if (!b) { newDur.set(a.n, takeSec); break; }
        // Overlapping lines (a second dialogue lane) clamp to a zero gap.
        const gapSec = Math.max(0, (b.start - a.end) / fps);
        const silent = [];
        for (let n = a.n + 1; n < b.n; n++) {
          if (shotByN.has(n) && !spans.has(n)) silent.push(shotByN.get(n));
        }
        if (!silent.length) { newDur.set(a.n, takeSec + gapSec); continue; }
        const breath = Math.min(gapSec, BREATH_SEC);
        newDur.set(a.n, takeSec + breath);
        const rest = gapSec - breath;
        const weights = silent.map((s) => (s.dur > 0 ? s.dur : 1));
        const totalW = weights.reduce((x, y) => x + y, 0);
        silent.forEach((s, j) => newDur.set(s.n, rest * (weights[j] / totalW)));
      }
    }
    if (!newDur.size) {
      return c.json({ error: kind === "radio" ? "No radio takes on the timeline to commit." : "No animatic pictures on the timeline to commit." }, 400);
    }

    const changes = [];
    const out = shots.map((s) => {
      const sec = newDur.get(s.n);
      if (sec == null) return s;
      const rounded = Math.max(0.1, Math.round(sec * 10) / 10);
      if (rounded === s.dur) return s;
      changes.push({ shot: s.id, n: s.n, from: s.dur, to: rounded });
      return { ...s, dur: rounded };
    });
    // Re-apply the new durations by shot id under a CAS rather than writing the
    // shot list we read back wholesale — the agent edits shots concurrently.
    const byN = new Map(out.map((s) => [s.n, s.dur]));
    await updateDoc(c.env, pid, "shotlist", { shots: [] }, (doc) => {
      doc.shots = (doc.shots || []).map((s) => (byN.has(s.n) ? { ...s, dur: byN.get(s.n) } : s));
      doc.generatedAt = new Date().toISOString();
    });
    return c.json({
      ok: true,
      source: kind,
      updated: changes.length,
      unchanged: newDur.size - changes.length,
      untouched: shots.length - newDur.size,
      changes,
    });
  });
}
