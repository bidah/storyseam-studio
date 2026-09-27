// The H3 flow's "Segment prompts" stage (`engine: "h3"` — the MiniMax H3 Film;
// film-plan.ts › The H3 FLOW).
//
// The story flow's prompts stage, written to the MiniMax H3 skill
// (./h3-skill.js). Pure code, no model: every segment the Shot list wrote is
// COMPILED into the one H3 prompt and request it is rendered with (fal's
// minimax/h3/reference-to-video), in the skill's production order:
//
//   [REFERENCE USE]      — H3 cites its references by MODALITY AND ORDER:
//                          "Image 1, Image 2 …" for `reference_image_urls`,
//                          "Video 1" for `reference_video_urls`. Only THIS
//                          segment's references: each character in it as two
//                          images of one person (turnaround + face), its place
//                          as an empty plate; every token bound to one named
//                          job, with what NOT to take from it. From segment 2
//                          on, Video 1 is the cut of the previous segment's
//                          last seconds. Audio 1… are the characters'
//                          AUDITIONS (the Voices stage, ../story-flow/
//                          voices.js): each defines one character's voice.
//   [IDENTITY / CONTINUITY LOCKS] — one instance each, the look, and from
//                          segment 2 the continuation from Video 1's last frame.
//   [SCENE]              — the segment's goal, place, environment.
//   [DIALOGUE]           — every line, bound to its speaker, in the language,
//                          in the voice its Audio n defines.
//   [SHOT LIST]          — the writer's stages as consecutive time ranges.
//   [CAMERA] / [PRODUCTION SOUND] / [NEGATIVES]
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

const key = (name) => String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
const clock = (s) => `${s}s`;
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
//   full       character sheets + place plate (+ Video 1 from segment 2).
//   no-people  place plate only; each character is bound IN WORDS.
//   no-video   no-people, and no Video 1 either: a fresh generation whose
//              first beat restates the previous segment's end state.
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
 * The images one segment binds, in list order: its characters (turnaround
 * then face), then its place's plate — at most MAX_H3_REFERENCE_IMAGES, and
 * no more than fit under the 12-file ceiling beside the video and the audio
 * (`maxImages`); the plate kept (a crowded segment loses its last faces before
 * its place). → [{ token, ref }] with token "Image n" (1-based, the array slot).
 */
export function segmentRegistry(segment, refs, { people = true, maxImages = MAX_H3_REFERENCE_IMAGES } = {}) {
  const picked = [];
  for (const name of people ? segment.characters || [] : []) {
    for (const view of ["body", "face"]) {
      const r = refs.find((x) => x.kind === "character" && x.view === view && key(x.subject) === key(name));
      if (r) picked.push(r);
    }
  }
  const plate = refs.find((x) => x.view === "plate" && key(x.subject) === key(segment.location));
  const cap = Math.max(0, Math.min(MAX_H3_REFERENCE_IMAGES, maxImages));
  const room = Math.max(0, plate ? cap - 1 : cap);
  const list = [...picked.slice(0, room), ...(plate && cap > 0 ? [plate] : [])];
  return list.map((ref, i) => ({ token: `Image ${i + 1}`, ref }));
}

/** Characters bound in words only (no image): name + identity note. */
function characterWords(segment, refs) {
  return (segment.characters || []).map((name) => {
    const note = refs.find((r) => r.kind === "character" && key(r.subject) === key(name))?.inherit;
    return `${name} has no reference image: ${note ? sentence(note) : "keep them exactly as first shown."}`;
  });
}

/** [REFERENCE USE] — every asset with one bounded job and what it must not contribute. */
function referenceUse(registry, { extension, audio = [] }) {
  const lines = [];
  const chars = new Map();
  for (const r of registry.filter((x) => x.ref.kind === "character")) {
    const list = chars.get(r.ref.subject) || [];
    list.push(r);
    chars.set(r.ref.subject, list);
  }
  for (const [name, list] of chars) {
    const body = list.find((x) => x.ref.view === "body");
    const face = list.find((x) => x.ref.view === "face");
    if (body) lines.push(`${body.token} defines ${name}'s full body, build, clothing and colours only (front, three-quarter, side and back of ONE figure). Ignore its grey background, its turnaround layout and any text.`);
    if (face) lines.push(`${face.token} defines ${name}'s face, hair and features only. Ignore its background and framing.`);
    if (list.length > 1) lines.push(`${list.map((x) => x.token).join(" and ")} are the same ${name}.`);
  }
  for (const p of registry.filter((x) => x.ref.view === "plate")) {
    lines.push(`${p.token} defines ${p.ref.subject}'s layout, architecture, landmarks and light only. Ignore its people, creatures and foreground objects.`);
  }
  if (extension) {
    lines.push(
      `Video 1 is the last ${EXTENSION_TAIL_SECONDS} seconds of the previous shot of this same film. ` +
        "It defines where every character and object is, the camera position and framing, the light, the sound and the direction of motion at the seam. Continue it; do not restage it.",
    );
  }
  for (const a of audio) {
    lines.push(`${a.token} defines only ${a.voice.name}'s voice timbre, accent, cadence and delivery. Ignore its words and pacing.`);
  }
  return lines;
}

/** The lines a segment's stages carry, in order: `Speaker, delivery: "line"` as the writer wrote them. */
function dialogueLines(segment) {
  return segment.stages.map((st) => String(st.audio || "").trim()).filter((a) => /"[^"]+"/.test(a));
}

/**
 * One segment → { prompt, task, imageRefs: [{ token, name, imageUrl }], hasVideo,
 * audioRefs: [{ token, name, url }], hasAudio, mode }. `look` is a FILM_STYLES
 * entry; `total` the number of segments; `voices` the Voices stage's auditions
 * ([] for a Film without the pass — nothing about the prompt changes then).
 */
export function compileSegment(segment, {
  refs, look, direction, title, total, language = DEFAULT_FILM_LANGUAGE, mode = defaultMode(look), previous = null, voices = [],
}) {
  const people = mode === "full";
  const extension = segment.index > 0 && mode !== "no-video";
  // The audio first: it and the video take their files off the images' room.
  let audio = segmentVoices(segment, voices);
  const maxImages = MAX_H3_REFERENCE_FILES - (extension ? 1 : 0) - audio.length;
  const registry = segmentRegistry(segment, refs, { people, maxImages });
  // H3: audio needs at least one image or video reference beside it.
  if (!registry.length && !extension) audio = [];
  const words = people ? [] : characterWords(segment, refs);
  const names = segment.characters || [];
  const lines = [];

  lines.push("[REFERENCE USE]");
  const use = referenceUse(registry, { extension, audio });
  lines.push(...(use.length ? use : ["No reference assets: every subject is defined in the locks below."]));
  lines.push("");

  lines.push("[IDENTITY / CONTINUITY LOCKS]");
  lines.push(`Segment ${segment.index + 1} of ${total} of the short film "${title}".`);
  for (const [i, name] of names.entries()) {
    const inherit = refs.find((r) => r.kind === "character" && key(r.subject) === key(name))?.inherit;
    lines.push(`Exactly one ${name} throughout${inherit ? `: ${sentence(inherit)}` : "."}${words[i] ? ` ${words[i]}` : ""}`);
  }
  lines.push(`Look: ${look.look} ${look.lock}`.trim());
  if (extension) {
    lines.push(
      "The first frame is Video 1's last frame exactly: every character's pose and orientation, every prop's position and state, " +
        "the background, the camera position and composition, the lighting and the direction of motion continue without a cut. " +
        "Nothing is duplicated, split or swapped. Then the new action begins.",
    );
  } else if (segment.index > 0) {
    // No Video 1 to inherit from: the seam is carried in words.
    const end = previous?.stages?.at(-1)?.end;
    lines.push(
      `This continues directly from the previous shot of the same film${end ? `, which ended: ${sentence(end)}` : "."} ` +
        "Open on that same moment — the same place, positions, clothing and light — then the new action begins.",
    );
  }
  lines.push("");

  lines.push("[SCENE]");
  lines.push(sentence(segment.goal) || `${segment.title}.`);
  if (segment.location) lines.push(`Place: ${segment.location}.`);
  if (direction?.environment) lines.push(`Environment: ${sentence(direction.environment)}`);
  // The scope lock. H3 renders every place a prompt names: a film-wide
  // Environment or Camera note that narrated the journey ("from the apartment
  // to the street to the skate spot") made segment 1 play the whole film in its
  // fifteen seconds and end where segment 4 should (2026-09-27, film-1fd51691).
  lines.push(
    `This segment is ${segment.stages.length === 1 ? "only the moment" : "only the moments"} in the shot list below${segment.location ? `, and it stays in ${segment.location} throughout` : ""}. ` +
      "It shows nothing that happens before or after them and ends exactly on the shot list's last end state; any other place this prompt names belongs to other segments of the film.",
  );
  lines.push("");

  const spoken = dialogueLines(segment);
  if (spoken.length || audio.length) {
    lines.push("[DIALOGUE]");
    lines.push(`All dialogue in ${language}, each line bound to the one speaker named before it, with accurate lip sync.`);
    for (const a of audio) {
      lines.push(`Every line ${a.voice.name} speaks is in the voice ${a.token} defines — never another voice.`);
    }
    lines.push(...spoken);
    lines.push("");
  }

  lines.push("[SHOT LIST]");
  let at = 0;
  segment.stages.forEach((st, i) => {
    const from = at;
    at += st.seconds;
    const parts = [];
    if (st.camera) parts.push(st.camera);
    if (i === 0 && st.initial) parts.push(`${extension ? "From Video 1's last frame" : "Opens on"}: ${st.initial}`);
    else if (st.initial) parts.push(`Continues: ${st.initial}`);
    if (st.event) parts.push(st.event);
    if (st.end) parts.push(`Ends: ${st.end}`);
    lines.push(`${clock(from)}–${clock(at)} — ${st.name}: ${parts.map(sentence).join(" ")}`);
  });
  lines.push("");

  if (direction?.camera) {
    lines.push("[CAMERA]");
    lines.push(sentence(direction.camera));
    lines.push("");
  }

  // The Film's sound lock (film-sound.js): the language, and NO MUSIC — the
  // Score stage lays the music under the final cut, and a bed the model baked
  // in cannot be ducked or cut out.
  lines.push("[PRODUCTION SOUND]");
  lines.push(
    `${direction?.sound ? `${sentence(direction.sound)} ` : ""}Native stereo room tone, ambience and effects under clear dialogue${extension ? ", continuous with Video 1's sound" : ""}. ${filmSoundLock(language)}`,
  );
  lines.push("");

  lines.push("[NEGATIVES]");
  lines.push(
    [
      "No extra people, no identity drift, no wardrobe or voice swaps, no duplicate subjects or props, no position reversals, no broken eyelines,",
      "no unmotivated cuts, no subtitles, captions, on-screen text or watermarks. NO MUSIC of any kind — no score, no soundtrack, no singing, no humming.",
      "Nothing from the reference sheets' grey backgrounds, turnaround layouts or labels. The look never changes part way through.",
    ].join(" "),
  );

  return {
    prompt: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    task: extension ? "extension" : "reference",
    hasVideo: extension,
    hasAudio: audio.length > 0,
    mode,
    imageRefs: registry.map(({ token, ref }) => ({ token, name: ref.name, imageUrl: ref.imageUrl })),
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
export function compileH3Segments({ job, results }, modeOf = () => null) {
  const shotlist = results?.shotlist;
  const sheets = results?.sheets;
  if (!shotlist?.segments?.length) throw new Error("The Film has no segments yet — the shot list step did not finish.");
  if (!sheets?.refs) throw new Error("The Film has no sheets yet — the sheets step did not finish.");
  const look = filmStyleFor({ style: results?.look?.style || job.style, prompt: job.prompt });
  const title = results?.world?.title || "Untitled";
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
      title,
      total,
      language: job.language || DEFAULT_FILM_LANGUAGE,
      mode: modeOf(segment.index) || defaultMode(look),
      previous: shotlist.segments[segment.index - 1] || null,
      voices,
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
    summary: `${total} prompt${total === 1 ? "" : "s"} · ${refsUsed} references bound${voicesUsed ? ` · ${voicesUsed} voice${voicesUsed === 1 ? "" : "s"} bound` : ""} · ${compiled.h3Resolution} ${compiled.aspectRatio} · Video 1 from segment 2${compiled.segments[0]?.mode === "no-people" ? " · characters in words (live action)" : ""}`,
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
