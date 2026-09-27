// The H3 flow's "Segment prompts" stage (`engine: "h3"` — the MiniMax H3 Film;
// film-plan.ts › The H3 FLOW).
//
// The story flow's prompts stage, written to the MiniMax H3 skill
// (./h3-skill.js). Pure code, no model: every segment the Shot list wrote is
// COMPILED into the one H3 prompt and request it is rendered with (fal's
// minimax/h3/reference-to-video). The prompt is H3's OWN brief — the six
// fields its prompt expansion writes, because the Film sends it with expansion
// off (film-plan.ts › The H3 FLOW), so nothing else puts it in that shape:
//
//   subject_definitions  — <Subject n>: each character (its turnaround and
//                          face, cited as fal's tokens Image 1, Image 2 …) and
//                          the place (its plate); from segment 2 on, the LAST
//                          FRAME of the previous segment as one more image —
//                          the frame this one opens on (H3 treats a reference
//                          VIDEO as a performance to re-enact: handed the
//                          previous segment's last 3s as Video 1, segment 4 of
//                          film-1fd51691 replayed segment 3's fall, with a
//                          character who was not in its cast — so the seam is
//                          a still; Video 1 survives only as the fallback for a
//                          job whose previous segment was cut before frames
//                          were); <Audio n>, the auditions (the Voices stage,
//                          ../story-flow/voices.js) of the characters who
//                          SPEAK here, each bound to its speaker ID (S1…).
//   summary              — the task types and what this part of the film is.
//   retention_analysis   — what each reference keeps; a voice is a timbre
//                          `reference` whose words are never spoken.
//   detailed_description — the look, then the writer's stages as [Shot n] at
//                          H3's MM:SS.mmm clock, every line as
//                          `<Subject 1> Leo (S1) … says <d>[English] words.</d>`
//                          with the lips closing after it; who stays silent;
//                          the scope lock; the negatives.
//   overall_soundscape   — the ambience under every pause, and the sound lock.
//   non_diegetic_music   — N/A (the Score stage lays the music under it).
//
// So every "Image n" / "Audio n" points at an existing array slot and the
// arrays are built from the same registry in the same order. Validated against
// fal's limits here (9 images, 3 audio files of 15s together, 12 files in all,
// 5–15s), before a second of video is paid for.
import {
  AUDITION_SECONDS,
  EXTENSION_TAIL_SECONDS,
  H3_ASPECT_RATIO,
  H3_AUDIO_MAX_SECONDS,
  H3_SEGMENT_MAX_SECONDS,
  H3_SEGMENT_MIN_SECONDS,
  MAX_H3_REFERENCE_AUDIO,
  MAX_H3_REFERENCE_FILES,
  MAX_H3_REFERENCE_IMAGES,
  filmResolutionOf,
  filmStyleFor,
  h3ResolutionOf,
} from "../../film-plan.ts";
import { DEFAULT_FILM_LANGUAGE, filmSoundLock } from "../../film-sound.js";
import { segmentDirection } from "../story-flow/direction.js";
import { stageLines, stageSound, unquote } from "../story-flow/lines.js";

export { stageLines, stageSound };

const key = (name) => String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim();
/** A note as a sentence: trimmed, ending on a full stop. */
const sentence = (t) => {
  const x = String(t || "").trim();
  return !x || /[.!?]$/.test(x) ? x : `${x}.`;
};

// ── Reference modes: what a segment may hand H3 ─────────────────────────────
//
// The same three the Seedance flow has (story-flow/prompts.js), because the
// refusal is the same shape — a safety checker that reads a photoreal
// character sheet as a real person:
//
//   full       character sheets + place plate (+ the seam frame from segment 2).
//   no-people  place plate only; each character is bound IN WORDS.
//   no-video   no-people, and no seam (no frame, no Video 1) either: a fresh
//              generation whose first beat restates the previous segment's
//              end state in words.
export const REF_MODES = ["full", "no-people", "no-video"];
export const defaultMode = (look) => (look?.id === "live-action" ? "no-people" : "full");
export function nextMode(mode, index) {
  if (mode === "full") return "no-people";
  if (mode === "no-people" && index > 0) return "no-video";
  return null;
}
/** fal's / MiniMax's refusal for a reference that looks like a real person, or that its checker flagged. */
export const isLikenessRefusal = (message) =>
  /likeness|real (people|person)|private information|sensitive|safety/i.test(String(message || ""));

/**
 * The voices one segment binds, in character order: each character's audition
 * (the Voices stage's `voices`, matched by name) as Audio 1… — at most
 * MAX_H3_REFERENCE_AUDIO, and no more once their seconds together would pass
 * H3_AUDIO_MAX_SECONDS. → [{ token, voice }]
 */
export function segmentVoices(segment, voices) {
  const picked = [];
  let seconds = 0;
  for (const name of segment.characters || []) {
    const v = (voices || []).find((x) => x?.url && key(x.name) === key(name));
    if (!v) continue;
    const s = Number(v.seconds) || AUDITION_SECONDS;
    if (picked.length >= MAX_H3_REFERENCE_AUDIO || seconds + s > H3_AUDIO_MAX_SECONDS) break;
    // The segment's spelling of the name is the one every other line uses.
    picked.push({ ...v, name });
    seconds += s;
  }
  return picked.map((voice, i) => ({ token: `Audio ${i + 1}`, voice }));
}

/**
 * The seam: the previous segment's last frame, bound as one more image. Its
 * URL is not known when the prompts are compiled (the frame is cut when that
 * segment is done), so the Video run fills it in at submit time (./run.js
 * segmentInput) — the compiled ref carries `seam: true` and no `imageUrl`.
 */
export const SEAM_REF = Object.freeze({ kind: "seam", view: "frame", subject: "previous shot", name: "Previous shot — last frame", imageUrl: null });

/**
 * The images one segment binds, in list order: its characters (turnaround
 * then face), then its place's plate, then (with `seam`) the previous
 * segment's last frame — at most MAX_H3_REFERENCE_IMAGES, and no more than fit
 * under the 12-file ceiling beside the video and the audio (`maxImages`); the
 * plate and the seam kept (a crowded segment loses its last faces before its
 * place or its seam). → [{ token, ref }] with token "Image n" (1-based, the
 * array slot).
 */
export function segmentRegistry(segment, refs, { people = true, maxImages = MAX_H3_REFERENCE_IMAGES, seam = false } = {}) {
  const picked = [];
  for (const name of people ? segment.characters || [] : []) {
    for (const view of ["body", "face"]) {
      const r = refs.find((x) => x.kind === "character" && x.view === view && key(x.subject) === key(name));
      if (r) picked.push(r);
    }
  }
  const plate = refs.find((x) => x.view === "plate" && key(x.subject) === key(segment.location));
  const fixed = [...(plate ? [plate] : []), ...(seam ? [SEAM_REF] : [])];
  const cap = Math.max(0, Math.min(MAX_H3_REFERENCE_IMAGES, maxImages));
  const room = Math.max(0, cap - fixed.length);
  const list = [...picked.slice(0, room), ...fixed.slice(0, cap)];
  return list.map((ref, i) => ({ token: `Image ${i + 1}`, ref }));
}

/** Seconds → H3's timeline clock, MM:SS.mmm. */
const stamp = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.000`;

/** Characters bound in words only (no image): their identity note. */
const identity = (refs, name) => refs.find((r) => r.kind === "character" && key(r.subject) === key(name))?.inherit;

/**
 * One segment → { prompt, task, imageRefs: [{ token, name, imageUrl }], hasVideo,
 * audioRefs: [{ token, name, url }], hasAudio, mode }. `look` is a FILM_STYLES
 * entry; `total` the number of segments; `voices` the Voices stage's auditions
 * ([] for a Film without the pass).
 *
 * The prompt is written in H3's OWN brief — the six fields its prompt
 * expansion writes (subject_definitions, summary, retention_analysis,
 * detailed_description, overall_soundscape, non_diegetic_music), because the
 * Film sends it with expansion off: nothing rewrites it into the shape the
 * model was trained on, so it is written in that shape. Assets keep fal's
 * tokens (Image 1, Video 1, Audio 1). Dialogue is the fragile part, so it is
 * written the way H3 reads speech — and nothing else in the prompt looks like
 * speech:
 *   - each line bound to a speaker ID, `<Subject 1> (S1) … says <d>[English]
 *     words.</d>`, the lips closing when it ends;
 *   - a voice reference only for a character who SPEAKS in this segment, as a
 *     timbre `reference` whose words are never carried (an unscripted segment
 *     bound to an audition spoke the audition);
 *   - no quotation marks, titles or stage names anywhere else (H3 read out
 *     "Segment two of Concrete King" and a stage called "The Decision");
 *   - who does not speak, and that nothing else is said, stated outright, and
 *     a soundscape under every pause — H3 fills silence with mumbling.
 */
export function compileSegment(segment, {
  refs, look, direction, total, language = DEFAULT_FILM_LANGUAGE, mode = defaultMode(look), previous = null, voices = [], seam = "frame",
}) {
  const people = mode === "full";
  const extension = segment.index > 0 && mode !== "no-video";
  // How the seam is carried: the previous segment's last frame as an image
  // (the rule), or its last seconds as Video 1 (only for a segment whose
  // predecessor was cut before frames were — a job in flight at the change).
  const video = extension && seam === "video";
  const frame = extension && !video;
  const names = segment.characters || [];
  const lang = String(language || DEFAULT_FILM_LANGUAGE).trim() || DEFAULT_FILM_LANGUAGE;
  const dir = segmentDirection(segment, direction, refs);

  // Who speaks, in the order they first do — that order is the speaker IDs.
  const staged = segment.stages.map((st) => ({ ...st, spoken: stageLines(st, names), sound: stageSound(st) }));
  const speakers = [];
  for (const l of staged.flatMap((st) => st.spoken)) {
    const name = names.find((n) => key(n) === key(l.speaker)) || str(l.speaker);
    if (name && !speakers.some((s) => key(s) === key(name))) speakers.push(name);
  }
  const sid = (name) => {
    const i = speakers.findIndex((s) => key(s) === key(name));
    return i >= 0 ? `S${i + 1}` : null;
  };

  // A voice only for a character who speaks here. The audio first: it and the
  // video take their files off the images' room.
  let audio = segmentVoices({ characters: speakers }, voices);
  const maxImages = MAX_H3_REFERENCE_FILES - (video ? 1 : 0) - audio.length;
  const registry = segmentRegistry(segment, refs, { people, maxImages, seam: frame });
  // H3: audio needs at least one image or video reference beside it.
  if (!registry.length && !video) audio = [];
  const seamTok = registry.find((r) => r.ref.kind === "seam")?.token || null;

  // <Subject n>: each character, then the place.
  const subjects = names.map((name, i) => ({ label: `<Subject ${i + 1}>`, name }));
  const place = segment.location ? { label: `<Subject ${names.length + 1}>`, name: segment.location } : null;
  const who = (name) => {
    const s = subjects.find((x) => key(x.name) === key(name));
    const id = sid(name);
    return s ? `${s.label} ${name}${id ? ` (${id})` : ""}` : `${name}${id ? ` (${id})` : ""}`;
  };
  const tokens = (name, view) => registry.filter((r) => r.ref.kind === "character" && r.ref.view === view && key(r.ref.subject) === key(name)).map((r) => r.token);
  const plate = registry.find((r) => r.ref.view === "plate");

  const out = [];
  out.push("subject_definitions:");
  for (const s of subjects) {
    const note = identity(refs, s.name);
    const body = tokens(s.name, "body")[0];
    const face = tokens(s.name, "face")[0];
    const from = [
      body && `${s.name}'s full body, build, clothing and colours follow ${body}, a turnaround sheet of ONE figure (ignore its grey background, its layout and any text)`,
      face && `${s.name}'s face and hair follow ${face} (ignore its background)`,
    ].filter(Boolean);
    out.push(`${s.label} is ${s.name}, one character${note ? `: ${unquote(sentence(note))}` : "."}${from.length ? ` ${from.join("; ")}.` : " There is no reference image; keep them exactly as described."}`);
  }
  if (place) {
    // A DESIGN reference, not a backdrop: told only "layout, architecture,
    // landmarks and light", H3 re-shot the plate — its camera angle, its
    // framing, the mural where the plate had it (film-6767fc11, 2026-09-27).
    out.push(
      `${place.label} is the setting, ${place.name}${plate
        ? `. ${plate.token} is a design reference for this place, not a background: take its architecture, materials, colours, landmarks and light, ` +
          "and see the place from the camera each shot below describes — never the image's own framing, viewpoint or composition, and never the image as a flat backdrop. Ignore any people or objects in it."
        : "."}`,
    );
  }
  if (seamTok) {
    out.push(
      `${seamTok} is the exact last frame of the previous shot of this same film: the frame this video opens on, ` +
        "with every character, prop, camera position, framing and light exactly as they are in it. It is a moment, not a scene to play out.",
    );
  }
  if (video) out.push(`<Video 1> is the last ${EXTENSION_TAIL_SECONDS} seconds of the previous shot of this same film, the starting point this video continues from.`);
  for (const a of audio) {
    const s = subjects.find((x) => key(x.name) === key(a.voice.name));
    out.push(`<${a.token}> is the voice-timbre reference for ${s ? `${s.label} ` : ""}${a.voice.name} (${sid(a.voice.name)}): an isolated recording of that voice alone.`);
  }
  out.push("");

  const kinds = ["reference generation", ...(video ? ["video continuation"] : []), ...(audio.length ? ["audio reference"] : [])];
  out.push("summary:");
  out.push(
    `[${kinds.join(" + ")}] The target video is one continuous ${segment.dur}-second part (${segment.index + 1} of ${total}) of a short film. ` +
      `${unquote(sentence(segment.goal)) || ""}${place ? ` It takes place only in ${place.label}.` : ""}` +
      `${seamTok ? ` It opens on ${seamTok} exactly and continues from it without a cut.` : ""}` +
      `${video ? " It continues directly from the last frame of <Video 1>." : ""}` +
      `${audio.length ? ` ${audio.map((a) => `<${a.token}>`).join(" and ")} ${audio.length === 1 ? "gives" : "give"} only voice timbre.` : ""}`,
  );
  out.push("");

  out.push("retention_analysis:");
  for (const s of subjects) {
    out.push(`${s.label} (appears throughout): fully_preserved - identity, face, hair, build, clothing and colours retained.`);
  }
  if (place) out.push(`${place.label} (the setting): partially_preserved - architecture, materials, colours, landmarks and light retained; its reference image's framing, viewpoint and composition are not reused, each shot sees the place from its own camera.`);
  if (seamTok) out.push(`${seamTok} (opening frame): fully_preserved - the first frame of the target matches it: the same positions, props, camera, framing and light; then the action continues from there.`);
  if (video) out.push("<Video 1> (continuation starting point): fully_preserved - the target opens on its last frame: the same positions, props, camera and light.");
  for (const a of audio) {
    out.push(`<${a.token}> (voice of ${a.voice.name}): reference - only timbre, accent and cadence are referenced; none of its words are spoken in the target video.`);
  }
  out.push("");

  out.push("detailed_description:");
  out.push(`The target video is in this style: ${look.look} ${look.lock}`.trim());
  if (dir.environment) out.push(unquote(sentence(dir.environment)));
  if (dir.camera) out.push(`Camera language: ${unquote(sentence(dir.camera))}`);
  let at = 0;
  staged.forEach((st, i) => {
    const from = at;
    at += st.seconds;
    const parts = [];
    if (i === 0) {
      if (seamTok) parts.push(`The shot begins on ${seamTok} exactly and continues it without a cut.`);
      else if (video) parts.push("The shot begins from the last frame of <Video 1> and continues it without a cut.");
      else if (segment.index > 0 && previous?.stages?.at(-1)?.end) {
        parts.push(`The shot opens on the moment the previous shot ended: ${unquote(sentence(previous.stages.at(-1).end))}`);
      }
      const present = names.map(who).reduce((a, w, k, all) => (k === 0 ? w : `${a}${k === all.length - 1 ? " and " : ", "}${w}`), "");
      if (present || place) parts.push(`${present || "The scene"}${present ? (names.length === 1 ? " is" : " are") : " is"} in ${place ? `${place.label} ${place.name}` : "the setting"}.`);
      if (st.initial) parts.push(unquote(sentence(st.initial)));
    } else if (st.initial) {
      parts.push(unquote(sentence(st.initial)));
    }
    if (st.camera) parts.push(unquote(sentence(st.camera)));
    if (st.event) parts.push(unquote(sentence(st.event)));
    for (const l of st.spoken) {
      const name = names.find((n) => key(n) === key(l.speaker)) || str(l.speaker);
      const delivery = unquote(l.delivery);
      parts.push(
        `${who(name)}, on-screen,${delivery ? ` ${delivery},` : ""} says <d>[${lang}] ${sentence(unquote(l.text))}</d> ` +
          `As the line ends, ${name}'s lips close and ${name}'s mouth stops moving.`,
      );
    }
    if (st.sound) parts.push(sentence(st.sound));
    if (st.end) parts.push(`By ${stamp(at)} the shot has reached this end state: ${unquote(sentence(st.end))}`);
    const head = i === 0 ? "[Shot 1]" : `[Shot ${i + 1}] At ${stamp(from)}, the shot changes to what follows.`;
    out.push(`${head} ${parts.join(" ")}`);
  });
  const quiet = names.filter((n) => !sid(n));
  out.push(
    speakers.length
      ? `Only the dialogue above is spoken, each line exactly once, in ${lang}; nobody says, whispers or murmurs anything else, and outside those lines every mouth stays closed.` +
          `${quiet.length ? ` ${quiet.join(" and ")} ${quiet.length === 1 ? "does" : "do"} not speak at all.` : ""}`
      : "Nobody speaks in this video: every mouth stays closed, with no talking, whispering, murmuring or mumbling.",
  );
  // The scope lock. H3 renders every place a prompt names: a film-wide
  // Environment or Camera note that narrated the journey ("from the apartment
  // to the street to the skate spot") made segment 1 play the whole film in its
  // fifteen seconds and end where segment 4 should (2026-09-27, film-1fd51691).
  out.push(
    `This video is only the moments above${place ? `, and it stays in ${place.label} throughout` : ""}. ` +
      "It shows nothing that happens before or after them and ends exactly on the last end state; any other place this brief names belongs to other parts of the film.",
  );
  out.push(
    "No subtitles, captions, on-screen text or watermarks. No extra copies of any character, no identity drift, no wardrobe swaps, no duplicate props, no position reversals. " +
      "Nothing from the reference sheets' grey backgrounds, turnaround layouts or labels. The look never changes part way through.",
  );
  out.push("");

  // The Film's sound lock (film-sound.js): the language, and NO MUSIC — the
  // Score stage lays the music under the final cut, and a bed the model baked
  // in cannot be ducked or cut out. And a soundscape under every pause: H3
  // fills a silence it was not given a sound for with mumbling.
  out.push("overall_soundscape:");
  out.push(
    [
      dir.sound ? unquote(sentence(dir.sound)) : "",
      `The ambience of ${place ? place.name : "the setting"} runs under every moment, so no pause is empty${video ? ", continuous with the sound of <Video 1>" : ""}.`,
      "Any crowd is heard as footsteps, movement and traffic, never as words.",
      filmSoundLock(lang),
    ].filter(Boolean).join(" "),
  );
  out.push("");
  out.push("non_diegetic_music:");
  out.push("N/A");

  return {
    prompt: out.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    task: extension ? "extension" : "reference",
    hasVideo: video,
    hasFrame: frame && Boolean(seamTok),
    hasAudio: audio.length > 0,
    mode,
    imageRefs: registry.map(({ token, ref }) => ({ token, name: ref.name, imageUrl: ref.imageUrl, ...(ref.kind === "seam" ? { seam: true } : {}) })),
    audioRefs: audio.map(({ token, voice }) => ({ token, name: voice.name, url: voice.url, seconds: Number(voice.seconds) || AUDITION_SECONDS })),
  };
}

/** A compiled segment → what fal would refuse, as messages ([] when none). */
export function segmentErrors(seg) {
  const errors = [];
  const images = seg.imageRefs.length;
  const audios = seg.audioRefs || [];
  const files = images + (seg.hasVideo ? 1 : 0) + audios.length;
  if (images > MAX_H3_REFERENCE_IMAGES) errors.push(`segment ${seg.index + 1}: ${images} images (H3 takes ${MAX_H3_REFERENCE_IMAGES})`);
  if (audios.length > MAX_H3_REFERENCE_AUDIO) errors.push(`segment ${seg.index + 1}: ${audios.length} audio files (H3 takes ${MAX_H3_REFERENCE_AUDIO})`);
  const audioSeconds = audios.reduce((a, r) => a + (Number(r.seconds) || AUDITION_SECONDS), 0);
  if (audioSeconds > H3_AUDIO_MAX_SECONDS) errors.push(`segment ${seg.index + 1}: ${audioSeconds}s of audio (H3 takes ${H3_AUDIO_MAX_SECONDS})`);
  if (audios.length && !images && !seg.hasVideo) errors.push(`segment ${seg.index + 1}: audio with no image or video reference`);
  if (files > MAX_H3_REFERENCE_FILES) errors.push(`segment ${seg.index + 1}: ${files} files (H3 takes ${MAX_H3_REFERENCE_FILES})`);
  for (const m of seg.prompt.matchAll(/\b(Image|Video|Audio) (\d+)\b/g)) {
    const n = Number(m[2]);
    const ok = m[1] === "Image" ? n >= 1 && n <= images
      : m[1] === "Video" ? n === 1 && seg.hasVideo
      : n >= 1 && n <= audios.length;
    if (!ok) errors.push(`segment ${seg.index + 1}: ${m[0]} points at no reference`);
  }
  if (!Number.isInteger(seg.dur) || seg.dur < H3_SEGMENT_MIN_SECONDS || seg.dur > H3_SEGMENT_MAX_SECONDS) {
    errors.push(`segment ${seg.index + 1}: ${seg.dur}s (H3 takes ${H3_SEGMENT_MIN_SECONDS}–${H3_SEGMENT_MAX_SECONDS})`);
  }
  return [...new Set(errors)];
}

/**
 * Every segment of the Film compiled from the Shot list's segments and the
 * sheets' references → { seriesId, resolution, h3Resolution, aspectRatio,
 * segments: [{ index, dur, title, prompt, task, hasVideo, mode, imageRefs }] }.
 * Pure: the Video run compiles again rather than carrying twenty prompts in
 * the job (the Durable Object keeps the whole job under one 128 KB key).
 */
export function compileH3Segments({ job, results }, modeOf = () => null, seamOf = () => "frame") {
  const shotlist = results?.shotlist;
  const sheets = results?.sheets;
  if (!shotlist?.segments?.length) throw new Error("The Film has no segments yet — the shot list step did not finish.");
  if (!sheets?.refs) throw new Error("The Film has no sheets yet — the sheets step did not finish.");
  const look = filmStyleFor({ style: results?.look?.style || job.style, prompt: job.prompt });
  const total = shotlist.segments.length;
  // The Voices stage's auditions (story-flow/voices.js), when the Film ran one.
  const voices = Array.isArray(results?.voices?.voices) ? results.voices.voices : [];
  const segments = shotlist.segments.map((segment) => ({
    index: segment.index,
    dur: segment.dur,
    title: segment.title,
    ...compileSegment(segment, {
      refs: sheets.refs,
      look,
      direction: shotlist.direction,
      total,
      language: job.language || DEFAULT_FILM_LANGUAGE,
      mode: modeOf(segment.index) || defaultMode(look),
      previous: shotlist.segments[segment.index - 1] || null,
      voices,
      seam: seamOf(segment.index) || "frame",
    }),
  }));
  const resolution = filmResolutionOf(job?.resolution);
  return { seriesId: sheets.seriesId, resolution, h3Resolution: h3ResolutionOf(resolution), aspectRatio: H3_ASPECT_RATIO, segments };
}

export async function runH3PromptsStage({ job, results }) {
  const compiled = compileH3Segments({ job, results });
  const errors = compiled.segments.flatMap(segmentErrors);
  if (errors.length) throw new Error(`MiniMax H3 would refuse: ${errors.join("; ")}`);

  const total = compiled.segments.length;
  const refsUsed = new Set(compiled.segments.flatMap((s) => s.imageRefs.map((r) => r.name))).size;
  const voicesUsed = new Set(compiled.segments.flatMap((s) => s.audioRefs.map((r) => r.name))).size;
  return {
    summary: `${total} prompt${total === 1 ? "" : "s"} · ${refsUsed} references bound${voicesUsed ? ` · ${voicesUsed} voice${voicesUsed === 1 ? "" : "s"} bound` : ""} · ${compiled.h3Resolution} ${compiled.aspectRatio} · opens on the previous shot's last frame from segment 2${compiled.segments[0]?.mode === "no-people" ? " · characters in words (live action)" : ""}`,
    // What each segment binds, not its prompt text (see compileH3Segments).
    result: {
      seriesId: compiled.seriesId,
      resolution: compiled.resolution,
      h3Resolution: compiled.h3Resolution,
      aspectRatio: compiled.aspectRatio,
      segments: compiled.segments.map(({ prompt, ...s }) => ({ ...s, promptChars: prompt.length })),
    },
  };
}
