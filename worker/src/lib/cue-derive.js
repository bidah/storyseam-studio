// Shot list → cue sheet. The derive step, as plain functions: the Director's
// `POST /api/director/series/:id/derive` (the `derive_cue_sheet` tool) and the
// Auto Film job's cue-sheet stage both write beats with these.
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
import { MIN_END_IMAGE_GAP_SECONDS, MIN_OPENING_END_IMAGE_SECONDS } from "./series.ts";

const sceneOf = (shot) =>
  [
    shot.location ? `${shot.location}.` : "",
    shot.action,
    shot.dialogue ? `Dialogue: ${shot.dialogue}` : "",
  ].filter(Boolean).join(" ");

/**
 * One beat per shot, at the shot's own accumulated offset — the author's derive.
 *
 * `takeFor(shotId)` → the storyboard take to pin (`{ file }`), or null. A pin is
 * the EXACT frame the chunk ending at this offset lands on, and the endpoint
 * spaces them: three seconds apart, and the first one clear of the longer
 * opening chunk. A still that cannot legally be pinned is reported in
 * `skippedPins` rather than dropped silently — the author decides whether to
 * move the beat or let the shot go unpinned.
 *
 * → `{ beats, skippedPins, filmSeconds }`
 */
export function beatsFromShots(shots, takeFor = () => null) {
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
    sections.range = seconds ? `Seconds ${offset}–${until} of the film.` : `From second ${offset}.`;
    if (shot.camera) sections.style = shot.camera;
    const scene = sceneOf(shot);
    if (scene) sections.scene = scene;
    if (shot.audioSync) sections.score = shot.audioSync;

    const beat = { offset, prompt: sections };
    const take = takeFor(shot.id);
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
  return { beats, skippedPins, filmSeconds: Math.round(clock) };
}

/**
 * The same shots laid on an EVEN grid — one beat every `spacing` seconds across
 * exactly `seconds` of film — which is what the Auto job writes: the Film plan
 * quoted a length and a beat count, and the cue sheet must be that sheet, not
 * whatever the shot durations happen to add up to.
 *
 * The shot list's durations are scaled to fill `seconds`; each grid window
 * [t, t+spacing) then takes every shot that plays in it, in order — the one
 * with the most time in the window leads the `style`, all of them feed the
 * `scene`. No pins: the stills they would pin are drawn by a later stage.
 *
 * → `{ beats, shotsByOffset: { [offset]: shotId[] }, filmSeconds }`
 */
export function beatsOnGrid(shots, { seconds, spacing }) {
  const total = Math.max(1, Math.round(Number(seconds) || 0));
  const step = Math.max(1, Math.round(Number(spacing) || 4));
  const list = shots.filter(Boolean);
  const durs = list.map((s) => Math.max(0, Number(s.dur) || 0));
  const sum = durs.reduce((a, b) => a + b, 0);
  // No durations at all → share the film evenly.
  const scale = sum > 0 ? total / sum : 0;
  const spans = [];
  let clock = 0;
  list.forEach((shot, i) => {
    const len = sum > 0 ? durs[i] * scale : total / list.length;
    spans.push({ shot, start: clock, end: clock + len });
    clock += len;
  });

  const beats = [];
  const shotsByOffset = {};
  for (let t = 0; t < total; t += step) {
    const until = Math.min(total, t + step);
    const inWindow = spans
      .map((sp) => ({ ...sp, overlap: Math.min(sp.end, until) - Math.max(sp.start, t) }))
      .filter((sp) => sp.overlap > 1e-6);
    const sections = { range: `Seconds ${t}–${until} of the film.` };
    if (inWindow.length) {
      const lead = inWindow.reduce((a, b) => (b.overlap > a.overlap ? b : a));
      if (lead.shot.camera) sections.style = lead.shot.camera;
      const scene = inWindow.map((sp) => sceneOf(sp.shot)).filter(Boolean).join(" Then: ");
      if (scene) sections.scene = scene;
      const score = inWindow.map((sp) => sp.shot.audioSync).filter(Boolean).join(" / ");
      if (score) sections.score = score;
      shotsByOffset[t] = inWindow.map((sp) => sp.shot.id).filter(Boolean);
    } else {
      shotsByOffset[t] = [];
    }
    beats.push({ offset: t, prompt: sections });
  }
  return { beats, shotsByOffset, filmSeconds: total };
}
