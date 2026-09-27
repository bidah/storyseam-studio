// The story flow's "Segment prompts" stage — its cue sheet (/story-flow, the
// Seedance 2.5 Film).
//
// Pure code, no model: every segment the Shot list wrote is COMPILED into the
// one Seedance 2.5 prompt and request it is rendered with, in the skill's
// production order (./seedance-skill.js):
//
//   [Reference Map]      — only THIS segment's references: each character in
//                          it as two images of one person (turnaround + face),
//                          each PROP seen in it as its own object sheet (the
//                          characters are drawn empty-handed, so who holds
//                          what is the stages' to say), its place as an
//                          empty plate; every token bound to
//                          one named job, with what NOT to take from it.
//                          From segment 2 on, @Video1 is the cut of the
//                          previous segment's last seconds. Under [Audio],
//                          @Audio1… are the characters' AUDITIONS (the Voices
//                          stage, ./voices.js): each defines one character's
//                          voice, so the same voice reaches every segment.
//   [Generation Goal]
//   [Global Direction]   — the chosen look and its lock, the film's direction,
//                          the language and sound locks.
//   [Forward Extension]  — segment 2 on: the first frame inherits @Video1's
//                          last frame; every subject stays one instance.
//   [Stage n | name]     — the writer's stages, with their time budgets.
//   [Maintain Consistency] / [Negative Constraints]
//
// So the @ tokens always point at an existing array slot, in the case-sensitive
// fal dialect (@Image1, @Video1), and the arrays are built from the same
// registry in the same order. Validated against fal's limits here, before a
// second of video is paid for.
import {
  AUDITION_SECONDS,
  EXTENSION_TAIL_SECONDS,
  MAX_SEEDANCE_AUDIO_REFS,
  SEEDANCE_ASPECT_RATIO,
  SEEDANCE_AUDIO_MAX_SECONDS,
  filmResolutionOf,
  filmStyleFor,
} from "../../film-plan.ts";
import { DEFAULT_FILM_LANGUAGE, filmSoundLock } from "../../film-sound.js";
import { segmentDirection } from "./direction.js";
import { segmentSpeakers } from "./lines.js";

const key = (name) => String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
/** fal: at most 30 images a generation, 50 files in all. */
export const MAX_IMAGE_REFS = 30;
const MAX_FILES = 50;

const clock = (s) => `${s}s`;
/** A note as a sentence: trimmed, ending on a full stop. */
const sentence = (t) => {
  const x = String(t || "").trim();
  return !x || /[.!?]$/.test(x) ? x : `${x}.`;
};

// ── Reference modes: what a segment may hand Seedance ───────────────────────
//
// Seedance 2.5 refuses a request whose images or videos "may contain likenesses
// of real people" — a safeguard, and a photoreal character sheet trips it
// every time. So what a segment sends is a MODE, not a constant:
//
//   full       character sheets + place plates (+ @Video1 from segment 2).
//   no-people  place plates only (they hold no people); each character is
//              bound IN WORDS, by their identity note. @Video1 still carries
//              the seam from segment 2.
//   no-video   no-people, and no @Video1 either: a fresh generation whose
//              first stage restates the previous segment's end state.
//
// Live action starts at `no-people` — its sheets are photographs of people.
// Every other look starts `full`; a refusal steps the segment down one mode
// (the Video run's `nextMode`), and only a refusal with nowhere left to step
// stops the Film.
export const REF_MODES = ["full", "no-people", "no-video"];

/** The mode a segment starts in, for this look. */
export const defaultMode = (look) => (look?.id === "live-action" ? "no-people" : "full");

/** The next mode down after a likeness refusal, or null when there is none. */
export function nextMode(mode, index) {
  if (mode === "full") return "no-people";
  if (mode === "no-people" && index > 0) return "no-video";
  return null;
}

/** fal's refusal for a reference that looks like a real person. */
export const isLikenessRefusal = (message) => /likeness|real (people|person)|private information/i.test(String(message || ""));

/**
 * The references one segment binds, in token order: its characters (turnaround
 * then face), then its props (one object sheet each), then its place's plate.
 * With `people: false` the props and the plate — an object sheet holds no
 * likeness. → [{ token, ref }]
 */
export function segmentRegistry(segment, refs, { people = true } = {}) {
  const picked = [];
  for (const name of people ? segment.characters || [] : []) {
    for (const view of ["body", "face"]) {
      const r = refs.find((x) => x.kind === "character" && x.view === view && key(x.subject) === key(name));
      if (r) picked.push(r);
    }
  }
  for (const name of segment.props || []) {
    const r = refs.find((x) => x.kind === "prop" && key(x.subject) === key(name));
    if (r) picked.push(r);
  }
  const plate = refs.find((x) => x.view === "plate" && key(x.subject) === key(segment.location));
  if (plate) picked.push(plate);
  return picked.slice(0, MAX_IMAGE_REFS).map((ref, i) => ({ token: `@Image${i + 1}`, ref }));
}

/**
 * The voices one segment binds, in character order: each character's audition
 * (the Voices stage's `voices`, matched by name) as @Audio1… — at most
 * MAX_SEEDANCE_AUDIO_REFS, and no more once their seconds together would pass
 * SEEDANCE_AUDIO_MAX_SECONDS. → [{ token, voice }]
 */
export function segmentVoices(segment, voices) {
  const picked = [];
  let seconds = 0;
  for (const name of segment.characters || []) {
    const v = (voices || []).find((x) => x?.url && key(x.name) === key(name));
    if (!v) continue;
    const s = Number(v.seconds) || AUDITION_SECONDS;
    if (picked.length >= MAX_SEEDANCE_AUDIO_REFS || seconds + s > SEEDANCE_AUDIO_MAX_SECONDS) break;
    // The segment's spelling of the name is the one every other line uses.
    picked.push({ ...v, name });
    seconds += s;
  }
  return picked.map((voice, i) => ({ token: `@Audio${i + 1}`, voice }));
}

/** Characters bound in words only (no image): name + identity note. */
function characterWords(segment, refs) {
  return (segment.characters || []).map((name) => {
    const note = refs.find((r) => r.kind === "character" && key(r.subject) === key(name))?.inherit;
    return `${name} has no reference image: ${note ? sentence(note) : "keep them exactly as first shown."} Keep exactly one ${name} throughout.`;
  });
}

function referenceMap(registry, { extension, words = [], audio = [] }) {
  const lines = ["[Reference Map]"];
  if (words.length) lines.push("[Characters]", ...words);
  const chars = new Map();
  for (const r of registry.filter((x) => x.ref.kind === "character")) {
    const list = chars.get(r.ref.subject) || [];
    list.push(r);
    chars.set(r.ref.subject, list);
  }
  if (chars.size) lines.push("[Characters]");
  for (const [name, list] of chars) {
    const body = list.find((x) => x.ref.view === "body");
    const face = list.find((x) => x.ref.view === "face");
    const tokens = list.map((x) => x.token).join(" and ");
    lines.push(`${name} corresponds to ${tokens}.`);
    if (body) lines.push(`${body.token} defines ${name}'s full body, build, clothing and colours, seen from the front, three-quarter, side and back — one figure, not four.`);
    if (face) lines.push(`${face.token} defines ${name}'s face, hair and features.`);
    if (list.length > 1) lines.push(`Both images are the same ${name}: keep exactly one ${name} throughout.`);
    const inherit = list[0].ref.inherit;
    if (inherit) lines.push(`Use only ${name}'s identity: ${sentence(inherit)}`);
    lines.push("Do not use the reference's grey background, its turnaround layout, its framing or any text.");
    lines.push(`${name}'s references show them empty-handed: ${name} holds only what the stages below put in their hands.`);
  }
  const props = registry.filter((x) => x.ref.kind === "prop");
  if (props.length) lines.push("[Props]");
  for (const p of props) {
    lines.push(
      `${p.ref.subject} corresponds to ${p.token}. Use only its shape, size, material, colours and wear${p.ref.inherit ? `: ${sentence(p.ref.inherit)}` : "."}` +
        ` ${p.token} shows ONE object from several sides — keep exactly one ${p.ref.subject}; do not use its grey background, its layout or any text.` +
        ` It is where the stages put it: in the hands of whoever the stages say holds it, and nowhere else.`,
    );
  }
  const plates = registry.filter((x) => x.ref.view === "plate");
  if (plates.length) lines.push("[Scenes]");
  for (const p of plates) {
    lines.push(
      `${p.ref.subject} references ${p.token} as a design reference, not a background. Use only its architecture, materials, colours, landmarks and light${p.ref.inherit ? `: ${sentence(p.ref.inherit)}` : "."}` +
        " Do not use its framing, camera viewpoint or composition — each stage sees the place from the camera it describes — and never show it as a flat backdrop." +
        " Do not use any people, creatures or foreground objects from it.",
    );
  }
  if (extension) {
    lines.push("[Motion and Camera]");
    lines.push(
      `@Video1 is the last ${EXTENSION_TAIL_SECONDS} seconds of the previous shot of this same film — the source video to extend. ` +
        "It defines where every character and object is, the camera position and framing, the light and the direction of motion at the seam.",
    );
  }
  if (audio.length) {
    lines.push("[Audio]");
    for (const a of audio) {
      lines.push(
        `${a.token} defines ${a.voice.name}'s voice timbre, accent, cadence and delivery — every line ${a.voice.name} speaks is in this voice. ` +
          "None of its words are spoken in this video; do not use its pacing or any sound from it.",
      );
    }
  }
  return lines;
}

/**
 * One segment → { prompt, task, imageRefs: [{ token, name, imageUrl }], hasVideo,
 * audioRefs: [{ token, name, url }], hasAudio }. `look` is a FILM_STYLES entry;
 * `total` the number of segments; `voices` the Voices stage's auditions ([]
 * for a Film without the pass — nothing about the prompt changes then).
 *
 * What the model can read as speech, it speaks (film-1fd51691, 2026-09-27, on
 * H3 — the same model family of failure): so the film's title is not quoted
 * in the goal, a voice is bound only for a character who has a line in THIS
 * segment (an unscripted segment handed an audition spoke the audition), and
 * the direction pasted is the segment's own (./direction.js), never a
 * film-wide note that names another place — a narrated journey played the
 * whole journey in one segment.
 */
export function compileSegment(segment, {
  refs, look, direction, total, language = DEFAULT_FILM_LANGUAGE, mode = defaultMode(look), previous = null, voices = [],
}) {
  const people = mode === "full";
  const extension = segment.index > 0 && mode !== "no-video";
  const registry = segmentRegistry(segment, refs, { people });
  // A voice only for a character who speaks here; and fal: audio needs at
  // least one image or video reference beside it.
  const speakers = segmentSpeakers(segment);
  const audio = registry.length || extension ? segmentVoices({ characters: speakers }, voices) : [];
  const words = people ? [] : characterWords(segment, refs);
  const names = segment.characters || [];
  const propNames = registry.filter((x) => x.ref.kind === "prop").map((x) => x.ref.subject);
  const dir = segmentDirection(segment, direction, refs);
  const lines = [...referenceMap(registry, { extension, words, audio }), ""];

  lines.push("[Generation Goal]");
  lines.push(
    extension
      ? `Extend @Video1 forward with the next ${segment.dur} seconds of the same short film (part ${segment.index + 1} of ${total}). ${sentence(segment.goal)}`.trim()
      : `Generate ${segment.dur} seconds of a short film (part ${segment.index + 1} of ${total}). ${sentence(segment.goal)}`.trim(),
  );
  lines.push("");

  lines.push("[Global Direction]");
  lines.push(`Look: ${look.look}`);
  lines.push(look.lock);
  if (segment.location) lines.push(`Place: ${segment.location}.`);
  if (dir.environment) lines.push(`Environment: ${sentence(dir.environment)}`);
  if (dir.camera) lines.push(`Camera language: ${sentence(dir.camera)}`);
  // The scope lock: this segment is its own stages in its own place, nothing
  // before or after them, whatever else the prompt happens to name.
  lines.push(
    `This generation is only the stages below${segment.location ? `, and it stays in ${segment.location} throughout` : ""}. ` +
      "It shows nothing that happens before or after them and ends exactly on the last stage's end state; any other place this prompt names belongs to other parts of the film.",
  );
  // The Film's sound lock (film-sound.js): the language, and NO MUSIC — the
  // Score stage lays the music under the final cut, and a bed the model baked
  // in cannot be ducked or cut out.
  lines.push(`${filmSoundLock(language)}${dir.sound ? ` Sound bed: ${sentence(dir.sound)}` : ""}`);
  lines.push("");

  if (segment.index > 0 && !extension) {
    // No @Video1 to inherit from: the seam is carried in words.
    const end = previous?.stages?.at(-1)?.end;
    lines.push("[Continuity]");
    lines.push(
      `This continues directly from the previous shot of the same film${end ? `, which ended: ${sentence(end)}` : "."} ` +
        "Open on that same moment — the same place, positions, clothing and light — then the new action begins.",
    );
    lines.push("");
  }

  if (extension) {
    lines.push("[Forward Extension]");
    lines.push(
      "The first generated frame inherits @Video1's last frame exactly: every character's pose and orientation, " +
        "every prop's position and state, the background, the camera position and composition, the lighting and the direction of motion. " +
        "Every subject stays the same single instance — nothing is duplicated, split or swapped. Then the new action begins.",
    );
    lines.push("");
  }

  let at = 0;
  segment.stages.forEach((st, i) => {
    const from = at;
    at += st.seconds;
    lines.push(`[Stage ${i + 1} | ${st.name}] (${clock(from)}–${clock(at)})`);
    if (i === 0) {
      if (st.initial) lines.push(`${extension ? "Continue from @Video1" : "Initial state"}: ${st.initial}`);
    } else {
      lines.push(`Continue from Stage ${i}${st.initial ? `: ${st.initial}` : "."}`);
    }
    if (st.event) lines.push(`Primary event: ${st.event}`);
    if (st.camera) lines.push(`Camera: ${st.camera}`);
    if (st.audio) lines.push(`Audio: ${st.audio}`);
    if (st.end) lines.push(`End state: ${st.end}`);
    lines.push("");
  });

  lines.push("[Maintain Consistency]");
  lines.push(
    [
      names.length ? `Keep ${names.join(", ")} exactly as their references define them — face, hair, clothing, proportions — one instance each, and keep each voice the same.` : "",
      audio.length ? `${audio.map((a) => `${a.voice.name} keeps the voice ${a.token} defines`).join("; ")} — never another voice.` : "",
      speakers.length
        ? `Only the quoted lines in the stages are spoken, each exactly once by its named speaker; nobody says anything else${names.some((n) => !speakers.includes(n)) ? `, and ${names.filter((n) => !speakers.includes(n)).join(" and ")} ${names.filter((n) => !speakers.includes(n)).length === 1 ? "does" : "do"} not speak at all` : ""}.`
        : "Nobody speaks in this generation: no talking, whispering or murmuring.",
      segment.location ? `Keep ${segment.location}'s layout and light.` : "",
      propNames.length ? `Keep ${propNames.join(", ")} exactly as ${propNames.length === 1 ? "its reference defines it" : "their references define them"}, one of each, in the hands the stages give ${propNames.length === 1 ? "it" : "them"}.` : "",
      "Keep prop ownership, object counts, screen direction and the camera axis consistent from stage to stage.",
      "The look never changes part way through.",
    ].filter(Boolean).join(" "),
  );
  lines.push("");
  lines.push("[Negative Constraints]");
  lines.push("Do not use the reference sheets' grey backgrounds, turnaround layouts, labels or text. No subtitles, captions, watermarks or on-screen text. NO MUSIC of any kind — no score, no soundtrack, no singing, no humming.");

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
  if (images > MAX_IMAGE_REFS) errors.push(`segment ${seg.index + 1}: ${images} images (fal takes ${MAX_IMAGE_REFS})`);
  if (audios.length > MAX_SEEDANCE_AUDIO_REFS) errors.push(`segment ${seg.index + 1}: ${audios.length} audio files (fal takes ${MAX_SEEDANCE_AUDIO_REFS})`);
  const audioSeconds = audios.reduce((a, r) => a + (Number(r.seconds) || AUDITION_SECONDS), 0);
  if (audioSeconds > SEEDANCE_AUDIO_MAX_SECONDS) errors.push(`segment ${seg.index + 1}: ${audioSeconds}s of audio (fal takes ${SEEDANCE_AUDIO_MAX_SECONDS})`);
  if (audios.length && !images && !seg.hasVideo) errors.push(`segment ${seg.index + 1}: audio with no image or video reference`);
  if (images + (seg.hasVideo ? 1 : 0) + audios.length > MAX_FILES) errors.push(`segment ${seg.index + 1}: more than ${MAX_FILES} files`);
  for (const m of seg.prompt.matchAll(/@(Image|Video|Audio)(\d+)/g)) {
    const n = Number(m[2]);
    const ok = m[1] === "Image" ? n >= 1 && n <= images
      : m[1] === "Video" ? n === 1 && seg.hasVideo
      : n >= 1 && n <= audios.length;
    if (!ok) errors.push(`segment ${seg.index + 1}: ${m[0]} points at no reference`);
  }
  if (!Number.isInteger(seg.dur) || seg.dur < 4 || seg.dur > 30) errors.push(`segment ${seg.index + 1}: ${seg.dur}s (fal takes 4–30)`);
  return [...new Set(errors)];
}

/**
 * Every segment of the Film compiled from the Shot list's segments and the
 * sheets' references → { seriesId, resolution, aspectRatio, segments:
 * [{ index, dur, title, prompt, task, hasVideo, imageRefs }] }. Pure: the Video
 * run compiles again rather than carrying twenty prompts in the job (the
 * Durable Object keeps the whole job under one 128 KB key).
 */
export function compileSegments({ job, results }, modeOf = () => null) {
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
    }),
  }));
  // The resolution the author chose (film-plan.ts FILM_RESOLUTIONS); 480p when none.
  return { seriesId: sheets.seriesId, resolution: filmResolutionOf(job?.resolution), aspectRatio: SEEDANCE_ASPECT_RATIO, segments };
}

export async function runStoryFlowPromptsStage({ job, results }) {
  const compiled = compileSegments({ job, results });
  const errors = compiled.segments.flatMap(segmentErrors);
  if (errors.length) throw new Error(`Seedance would refuse: ${errors.join("; ")}`);

  const total = compiled.segments.length;
  const refsUsed = new Set(compiled.segments.flatMap((s) => s.imageRefs.map((r) => r.name))).size;
  const voicesUsed = new Set(compiled.segments.flatMap((s) => s.audioRefs.map((r) => r.name))).size;
  return {
    summary: `${total} prompt${total === 1 ? "" : "s"} · ${refsUsed} references bound${voicesUsed ? ` · ${voicesUsed} voice${voicesUsed === 1 ? "" : "s"} bound` : ""} · ${compiled.resolution} ${SEEDANCE_ASPECT_RATIO} · extension from segment 2${compiled.segments[0]?.mode === "no-people" ? " · characters in words (live action)" : ""}`,
    // What each segment binds, not its prompt text (see compileSegments).
    result: {
      seriesId: compiled.seriesId,
      resolution: compiled.resolution,
      aspectRatio: compiled.aspectRatio,
      segments: compiled.segments.map(({ prompt, ...s }) => ({ ...s, promptChars: prompt.length })),
    },
  };
}
