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

// The Auto grid's scene. Every part of it is written for a reader that is not
// the Director too: the shot sheet draws ONE still per beat, and reads the
// still's picture off the beat's text — the "End on …" sentence first, else the
// longest sentence that is not speech (`endBrief` in shot-sheet.ts); the
// opening frame is the scene's FIRST sentence. So:
//
//   - a new shot opens on its FRAME, as one sentence: the camera, the place by
//     the NAME its model sheet is filed under (the shot list writes a slug),
//     every character in it by their sheet's name, then what the camera sees
//     (the shot's own `prompt`). The shot sheet tags a reference into a shot
//     only where the text says the sheet's name — "Mika (Image 2)" — and picks
//     which sheets a reel is handed by the same count;
//   - every beat ENDS on the frame of the shot playing at its last second, so
//     each still is the picture of the shot it pins, and a hold line — or a
//     long line of action — never becomes the picture;
//   - a shot carried on from the beat before is a SHORT hold line: the action
//     is not told twice (the Director played it twice).
const placeOf = (shot, places) => places?.[shot.location] || shot.location || "";
const oneSentence = (text) =>
  String(text || "").replace(/\s+/g, " ").trim().replace(/[.!?]+(\s|$)/g, ";$1").replace(/;\s*$/, "");
const frameOf = (shot, places) => {
  const where = [placeOf(shot, places), shot.characters?.length ? shot.characters.join(", ") : ""].filter(Boolean).join(" — ");
  const what = oneSentence(shot.prompt || shot.action);
  const camera = oneSentence(shot.camera);
  return [camera, where].filter(Boolean).join(", ") + (what ? `: ${what}` : "");
};
const gridSceneOf = (shot, places) =>
  [
    `${frameOf(shot, places)}.`,
    shot.action,
    shot.dialogue ? `Dialogue: ${shot.dialogue}` : "",
  ].filter(Boolean).join(" ");

// A shot carried on into the next beat — never the action again.
const holdOf = () => "The shot continues: hold it, do not restart the action.";

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
 * A shot is ACTED once. A six-second shot spans two four-second beats, and a
 * beat that restates the shot's action makes the Director play it again — the
 * "repeated animation" a sitting showed. So a shot's action and dialogue go in
 * the beat where it STARTS; a beat it merely continues into gets a hold line
 * (where we are, who is there, carry on — do not restart it).
 *
 * `places` (optional) maps a location slug to the name its model sheet is
 * filed under, so the scene names the place as the sheet does.
 *
 * `sound` (optional) is a section every beat carries verbatim: the spoken
 * language and what may be heard. The Film job's stream carries no music —
 * the score is laid under it afterwards — and a beat that does not say so
 * gets a soundtrack, and an anime look gets Japanese.
 *
 * → `{ beats, shotsByOffset: { [offset]: shotId[] }, filmSeconds }`
 */
export function beatsOnGrid(shots, { seconds, spacing, sound = "", places = null }) {
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
      const scene = inWindow
        .map((sp) => (sp.start >= t - 1e-6 ? gridSceneOf(sp.shot, places) : holdOf()))
        .filter(Boolean)
        .join(" Then: ");
      // The frame this beat closes on: the shot playing at its last second.
      // Spans are in film order, so that is the window's last.
      const closing = inWindow[inWindow.length - 1];
      const ending = `End on ${frameOf(closing.shot, places)}.`;
      sections.scene = scene ? `${scene} ${ending}` : ending;
      const score = inWindow
        .filter((sp) => sp.start >= t - 1e-6)
        .map((sp) => sp.shot.audioSync)
        .filter(Boolean)
        .join(" / ");
      if (score) sections.score = score;
      shotsByOffset[t] = inWindow.map((sp) => sp.shot.id).filter(Boolean);
    } else {
      shotsByOffset[t] = [];
    }
    if (sound) sections.sound = sound;
    beats.push({ offset: t, prompt: sections });
  }
  return { beats, shotsByOffset, filmSeconds: total };
}
