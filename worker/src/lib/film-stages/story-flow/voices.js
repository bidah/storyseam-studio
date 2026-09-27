// The story engines' "Voices" stage (`engine: "seedance" | "h3"` — film-plan.ts
// › Voices).
//
// A story engine writes the sound itself, so a character's voice is whatever
// the model gave them in THAT segment — and the next segment, prompted afresh,
// gives them another. Seedance 2.5 and MiniMax H3 both take AUDIO REFERENCES
// (`@Audio1` / "Audio 1": a clip that "defines <Name>'s voice timbre, accent,
// cadence and delivery"), which is the only way one voice reaches every
// segment. So, right after the sheets, every character in the World is
// AUDITIONED: the SAME lines (AUDITION_LINES) read in their own voice as the
// World describes it, as a clean voice-only recording — no ambience, no room
// tone, no music, no effects — and the take is filed as an mp3 that every
// later segment they appear in binds as their voice (story-flow/prompts.js,
// h3/prompts.js). The mp3 is also attached to the World character's `voiceRef`
// so the Bible shows it.
//
// Three ways to run the audition (`job.voices`), all on fal:
//   video       the Film's OWN video model generates a 5s audition to camera
//               against the character's sheets; the box cuts its audio track.
//               The voice is exactly what the engine gives that face.
//   seedaudio   ByteDance Seed Audio renders the lines from the voice note.
//   elevenlabs  ElevenLabs designs a voice from the note and reads the lines.
// Whatever made it, ONE box job (media.js `extract`) turns every take into a
// mono mp3 under the Film's Director media — one code path files the voices.
//
// ── Across alarms ───────────────────────────────────────────────────────────
// A pending stage in the Video run's shape (story-flow/run.js): each call does
// what is due and answers `{ pending: true }` until every voice is `done`; the
// state is this step's own result, read back from the job on the next call.
//   queued → rendering (all submitted in one call, polled per alarm) →
//   rendered (all) → cutting (one box job for the lot) → done
//
// ── Retry ───────────────────────────────────────────────────────────────────
// A render fal failed is resubmitted on the retry (`renderAttempt < attempt`);
// a cut that failed is cut again from the renders it already has. A likeness
// refusal (the safety checker reading a photoreal sheet as a real person)
// steps that ONE character down to words — no images — once; a second refusal
// fails the stage. Finished voices are never paid for twice.
import {
  AUDITION_LINES,
  AUDITION_SECONDS,
  FILM_RATES_USD,
  H3_ASPECT_RATIO,
  H3_ENDPOINT,
  H3_PROMPT_EXPANSION,
  H3_RATES_USD,
  SEEDANCE_ASPECT_RATIO,
  SEEDANCE_ENDPOINT,
  STORY_FLOW_RATES_USD,
  VOICE_RATES_USD,
  filmResolutionOf,
  filmStyleFor,
  filmVoicesOf,
  h3ResolutionOf,
  seedanceRateScale,
} from "../../film-plan.ts";
import { DEFAULT_FILM_LANGUAGE } from "../../film-sound.js";
import { absolutize, directorUrl } from "../../director.js";
import { falPoll, falSubmit } from "../../fal.js";
import { readWorld, setCharacterVoiceByName } from "../../../routes/world.js";
import { daytonaStoryBox, storyKey } from "./media.js";

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim();
const key = (name) => str(name).toLowerCase().replace(/\s+/g, " ");
const round = (x) => Math.round(x * 1e6) / 1e6;
const slug = (s) => str(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "voice";
/** A note as a sentence: trimmed, ending on a full stop. */
const sentence = (t) => {
  const x = str(t);
  return !x || /[.!?]$/.test(x) ? x : `${x}.`;
};

/** fal's / MiniMax's refusal for a reference that looks like a real person, or that a checker flagged. */
export const isLikenessRefusal = (message) =>
  /likeness|real (people|person)|private information|sensitive|safety/i.test(String(message || ""));

/** The one sound rule every audition carries: the voice, and nothing else. */
export const VOICE_ONLY =
  "Voice only: no ambient sound, no room tone, no music, no sound effects, no other voices, no subtitles.";

// ── The audio models (seedaudio / elevenlabs) ───────────────────────────────
//
// One table names each mode's fal endpoint and how its request is built from
// the audition; `voiceOutputUrl` reads the take back off a poll. Contracts
// from fal's published schemas (Sept 2026):
//   bytedance/seed-audio-1.0    { prompt (≤2048, the SCRIPT — the speaker's
//                                 description in brackets, then the line),
//                                 output_format, sample_rate }. No `voice`:
//                                 a preset would override the description.
//                                 → { audio: { url, duration } }
//   fal-ai/elevenlabs/text-to-voice/design/eleven-v3
//                               { prompt (the voice, ≤1000), text (100–1000
//                                 chars — AUDITION_LINES is written to that),
//                                 auto_generate_text: false, output_format }
//                                 → { previews: [{ audio: { url } … }] }
const CLEAN_RECORDING = "a clean close-mic studio recording, no background sound, no music";
export const VOICE_MODELS = {
  seedaudio: {
    endpoint: "bytedance/seed-audio-1.0",
    label: "Seed Audio · fal",
    input: ({ name, note, lines, language }) => ({
      prompt: `${name} (${sentence(note).replace(/\.$/, "")}; speaks in ${str(language) || DEFAULT_FILM_LANGUAGE}; ${CLEAN_RECORDING}) says clearly: "${lines}"`.slice(0, 2048),
      output_format: "mp3",
      sample_rate: 44100,
    }),
    url: (polled) => str(polled?.output?.audio?.url || polled?.url),
  },
  elevenlabs: {
    endpoint: "fal-ai/elevenlabs/text-to-voice/design/eleven-v3",
    label: "ElevenLabs · fal",
    input: ({ name, note, lines, language }) => ({
      prompt: `${voiceDesign({ name, note }, language)} ${CLEAN_RECORDING[0].toUpperCase()}${CLEAN_RECORDING.slice(1)}.`.slice(0, 1000),
      text: lines,
      auto_generate_text: false,
      output_format: "mp3_44100_128",
    }),
    url: (polled) => str(polled?.output?.previews?.[0]?.audio?.url || polled?.url),
  },
};

/** The audio url a finished audio-model request delivered, read the way that model answers. */
export const voiceOutputUrl = (mode, polled) => (VOICE_MODELS[mode]?.url || ((p) => str(p?.url)))(polled);

/** What the Voices card names the engine that auditioned. */
const engineLabel = (mode, engine) =>
  mode === "video" ? `Audition on ${engine === "h3" ? "MiniMax H3" : "Seedance 2.5"}` : VOICE_MODELS[mode]?.label || mode;

// ── The cast ────────────────────────────────────────────────────────────────

/** A character's voice as the World describes it — the `voice` note, else a sentence from what it does say. */
export function voiceNote(c) {
  const voice = str(c?.voice);
  if (voice) return voice;
  const bits = [c?.archetype, c?.role, c?.traits].map(str).filter(Boolean);
  const who = bits.length ? bits.join(", ") : "a figure from this story";
  const look = str(c?.appearance);
  return `${c?.name || "This character"} is ${who}${look ? ` — ${look}` : ""}; a voice that fits that`;
}

/** The voice, designed in one line: the note, and the language it speaks. */
export function voiceDesign({ name, note }, language = DEFAULT_FILM_LANGUAGE) {
  const lang = str(language) || DEFAULT_FILM_LANGUAGE;
  return `${name}'s voice: ${sentence(note)} Speaks in ${lang}.`;
}

/** The World's cast → one audition each: [{ name, note }]. Pure. */
export function planVoices(world, { language = DEFAULT_FILM_LANGUAGE } = {}) {
  const seen = new Set();
  const out = [];
  for (const c of world?.characters || []) {
    const name = str(c?.name);
    if (!name || seen.has(key(name))) continue;
    seen.add(key(name));
    out.push({ name, note: voiceNote({ ...c, name }), language: str(language) || DEFAULT_FILM_LANGUAGE });
  }
  return out;
}

// ── The prompts ─────────────────────────────────────────────────────────────

/**
 * The audition prompt for one character, in the dialect of what renders it.
 * `mode` is the Voices mode; for `video`, `engine` picks the video model's
 * layout (Seedance's [Reference Map] … or H3's [REFERENCE USE] …) and
 * `images` is how many reference images ride along (0 = described in words).
 */
export function auditionPrompt(mode, { name, note, lines = AUDITION_LINES, language = DEFAULT_FILM_LANGUAGE, engine = "seedance", look = null, images = 0 } = {}) {
  const design = voiceDesign({ name, note }, language);
  const lang = str(language) || DEFAULT_FILM_LANGUAGE;
  if (mode !== "video") {
    return `${design} A clean, dry, close-mic voice recording of ${name} alone, reading these lines: "${lines}". ${VOICE_ONLY}`;
  }
  const lookLine = look?.look ? `Look: ${look.look}` : "";
  if (engine === "h3") {
    const lines_ = ["[REFERENCE USE]"];
    if (images >= 1) lines_.push(`Image 1 defines ${name}'s full body, build, clothing and colours only (front, three-quarter, side and back of ONE figure). Ignore its grey background, its turnaround layout and any text.`);
    if (images >= 2) lines_.push(`Image 2 defines ${name}'s face, hair and features only. Ignore its background and framing.`);
    if (images >= 2) lines_.push(`Image 1 and Image 2 are the same ${name}.`);
    if (!images) lines_.push(`No reference assets: ${name} is ${sentence(note)}`);
    lines_.push("", "[IDENTITY / CONTINUITY LOCKS]", `Exactly one ${name}, alone, throughout. ${design}`);
    if (lookLine) lines_.push(lookLine);
    lines_.push(
      "",
      "[SCENE]",
      `A voice audition: ${name} stands alone in a plain, silent recording booth, facing the camera, and reads the lines. Nothing else happens.`,
      "",
      "[DIALOGUE]",
      `${name} speaks in natural ${lang}, clearly, at a natural pace, with accurate lip sync: "${lines}"`,
      "",
      "[SHOT LIST]",
      `0–${AUDITION_SECONDS}s — medium close-up, static camera, eye level; ${name} reads the lines to camera. Ends with ${name} silent, looking at the camera.`,
      "",
      "[PRODUCTION SOUND]",
      `A clean, dry, close-mic voice recording of ${name} alone. ${VOICE_ONLY}`,
      "",
      "[NEGATIVES]",
      "No extra people, no identity drift, no cuts, no captions, no on-screen text, no watermarks. NO MUSIC of any kind. No ambience, no room tone, no sound effects — only the one voice. Nothing from the reference sheets' grey backgrounds, turnaround layouts or labels.",
    );
    return lines_.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  const out = ["[Reference Map]"];
  if (images >= 1) out.push(`${name} corresponds to ${images >= 2 ? "@Image1 and @Image2" : "@Image1"}.`);
  if (images >= 1) out.push(`@Image1 defines ${name}'s full body, build, clothing and colours, seen from the front, three-quarter, side and back — one figure, not four.`);
  if (images >= 2) out.push(`@Image2 defines ${name}'s face, hair and features.`, `Both images are the same ${name}: keep exactly one ${name} throughout.`);
  if (images >= 1) out.push("Do not use the reference's grey background, its turnaround layout, its framing or any text.");
  if (!images) out.push(`${name} has no reference image: ${sentence(note)} Keep exactly one ${name} throughout.`);
  out.push(
    "",
    "[Generation Goal]",
    `Generate a ${AUDITION_SECONDS}-second voice audition: ${name} alone, facing the camera, reads the lines.`,
    "",
    "[Global Direction]",
    ...(lookLine ? [lookLine] : []),
    `A plain, silent recording booth, even soft light, static medium close-up at eye level. ${design}`,
    `Every spoken line is in ${lang} only — never any other language, no subtitles, no on-screen text.`,
    "",
    "[Stage 1 | Audition]",
    `Initial state: ${name} stands alone, centred, looking at the camera, mouth closed.`,
    `Primary event: ${name} reads the lines to camera, clearly, at a natural pace.`,
    "Camera: static medium close-up, eye level, no movement.",
    `Audio: ${name} says, clearly, "${lines}". ${VOICE_ONLY}`,
    `End state: ${name} silent, still looking at the camera.`,
    "",
    "[Maintain Consistency]",
    `Keep ${name} exactly as the references define them — face, hair, clothing, proportions — one instance, one voice.`,
    "",
    "[Negative Constraints]",
    "Do not use the reference sheets' grey backgrounds, turnaround layouts, labels or text. No subtitles, captions, watermarks or on-screen text. NO MUSIC of any kind. No ambience, no room tone, no sound effects, no other voices — only the one voice.",
  );
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** The character's sheets (turnaround, then face) as fal-reachable urls. */
function sheetUrls(env, pid, refs, name) {
  const mine = (view) => (refs || []).find((r) => r.kind === "character" && r.view === view && key(r.subject) === key(name));
  return ["body", "face"].map(mine).filter(Boolean).map((r) => absolutize(env, pid, r.imageUrl)).filter((u) => /^https?:\/\//i.test(u));
}

/** The fal request for one character's audition, by mode and engine. */
export function auditionInput(env, pid, mode, { voice, job, look, refs, withImages = true }) {
  const lines = AUDITION_LINES;
  const language = job.language || DEFAULT_FILM_LANGUAGE;
  if (mode !== "video") return { endpoint: VOICE_MODELS[mode].endpoint, input: VOICE_MODELS[mode].input({ ...voice, lines, language }) };
  const images = withImages ? sheetUrls(env, pid, refs, voice.name) : [];
  const prompt = auditionPrompt("video", { ...voice, lines, language, engine: job.engine, look, images: images.length });
  if (job.engine === "h3") {
    return {
      endpoint: H3_ENDPOINT,
      input: {
        prompt,
        ...(images.length ? { reference_image_urls: images } : {}),
        duration: AUDITION_SECONDS,
        resolution: h3ResolutionOf(job.resolution),
        aspect_ratio: H3_ASPECT_RATIO,
        prompt_expansion_mode: H3_PROMPT_EXPANSION,
        enable_safety_checker: true,
      },
    };
  }
  return {
    endpoint: SEEDANCE_ENDPOINT,
    input: {
      prompt,
      task: "reference",
      ...(images.length ? { image_urls: images } : {}),
      aspect_ratio: SEEDANCE_ASPECT_RATIO,
      resolution: filmResolutionOf(job.resolution),
      duration: String(AUDITION_SECONDS),
      generate_audio: true,
    },
  };
}

/** What one audition costs when fal delivers it. */
export function auditionSpend(mode, engine, resolution) {
  if (mode !== "video") return round(VOICE_RATES_USD[mode] || 0);
  const perSecond = engine === "h3"
    ? H3_RATES_USD.second[h3ResolutionOf(resolution)]
    : STORY_FLOW_RATES_USD.seedanceSecond * seedanceRateScale(resolution);
  return round(AUDITION_SECONDS * perSecond);
}

// ── The stage ───────────────────────────────────────────────────────────────

/**
 * deps (optional): { fal: { submit, poll }, box: daytonaStoryBox-shaped
 * (startExtract, poll), readWorld, setVoice }.
 *
 * result = { mode, lines, seconds, engine, cut: { jobId, attempt } | null,
 *   voices: [{ name, note, status: 'queued'|'rendering'|'rendered'|'cutting'|'done',
 *   requestId, renderAttempt, sourceUrl, words?, refusals?, file, url, seconds }] }
 */
export async function runVoicesStage({ job, results, env, attempt = 1 }, deps = {}) {
  const fal = deps.fal || { submit: falSubmit, poll: falPoll };
  const box = deps.box || daytonaStoryBox;
  const setVoice = deps.setVoice || setCharacterVoiceByName;
  const pid = job.projectId;
  const mode = filmVoicesOf(job.voices, job.engine);
  if (!mode) throw new Error("This Film has no Voices pass to run.");
  const falKey = str(env?.FAL_KEY);
  if (!falKey) throw new Error("FAL_KEY is not set on the Worker — the voices cannot be auditioned");
  if (!deps.box && !env?.DAYTONA_API_KEY) throw new Error("DAYTONA_API_KEY is not set on the Worker — the voices cannot be cut");

  const world = await (deps.readWorld || readWorld)(env, pid);
  const cast = planVoices(world, { language: job.language || DEFAULT_FILM_LANGUAGE });
  if (!cast.length) throw new Error("There is no World cast to audition.");
  const look = filmStyleFor({ style: results?.look?.style || job.style, prompt: job.prompt });
  const refs = results?.sheets?.refs || [];

  // This step's own state from the last call (a pending answer's result).
  const prev = (job.steps || []).find((s) => s.key === "voices")?.result;
  const had = new Map((prev?.voices || []).map((v) => [key(v.name), v]));
  const voices = cast.map((c) => ({ ...c, status: "queued", seconds: AUDITION_SECONDS, ...(had.get(key(c.name)) || {}) }));
  let cut = prev?.cut || null;
  const tag = slug(job.id);
  const total = voices.length;
  let spend = 0;

  const view = () => {
    const done = voices.filter((v) => v.status === "done").length;
    const now = voices.find((v) => v.status !== "done");
    const phase = cut && voices.some((v) => v.status === "cutting") ? "cutting"
      : voices.some((v) => v.status === "rendering") ? "rendering" : now ? now.status : "";
    const doing = now ? ` · ${phase === "cutting" ? "cutting the takes" : `${now.name} ${phase}`}` : "";
    const summary = now
      ? `${done} of ${total} voices auditioned${doing}`
      : `${total} voice${total === 1 ? "" : "s"} — ${voices.map((v) => v.name).join(", ")} (${engineLabel(mode, job.engine)})`;
    return { summary, result: { mode, engine: job.engine, lines: AUDITION_LINES, seconds: AUDITION_SECONDS, cut, voices } };
  };
  const pending = () => ({ pending: true, ...view(), spend });
  const fail = (message) => {
    const err = new Error(message);
    if (spend > 0) err.spend = spend;
    return err;
  };
  // The checker read the sheets as a real person: audition this one in words.
  const stepDown = (v, message) => {
    if (mode !== "video" || v.words || !isLikenessRefusal(message)) return false;
    const refusals = [...(v.refusals || []), { error: String(message).slice(0, 300), at: new Date().toISOString() }];
    Object.assign(v, { status: "queued", requestId: null, words: true, refusals });
    return true;
  };

  // A retry redoes the phase that failed on an earlier attempt.
  for (const v of voices) {
    if (v.status === "rendering" && (v.renderAttempt || 1) < attempt) Object.assign(v, { status: "queued", requestId: null });
  }
  if (cut && (cut.attempt || 1) < attempt) {
    cut = null;
    for (const v of voices) if (v.status === "cutting") v.status = "rendered";
  }

  // Submit everything that is queued, in one call.
  const queued = voices.filter((v) => v.status === "queued");
  if (queued.length) {
    await Promise.all(queued.map(async (v) => {
      const { endpoint, input } = auditionInput(env, pid, mode, { voice: v, job, look, refs, withImages: !v.words });
      try {
        const { requestId } = await fal.submit(falKey, endpoint, input);
        Object.assign(v, { status: "rendering", requestId, endpoint, renderAttempt: attempt, submittedAt: new Date().toISOString() });
      } catch (err) {
        if (stepDown(v, err?.message || err)) return;
        throw fail(`${v.name}: ${String(err?.message || err)}`);
      }
    }));
    return pending();
  }

  // Poll what is rendering.
  for (const v of voices.filter((x) => x.status === "rendering")) {
    const polled = await fal.poll(falKey, v.endpoint || (mode === "video" ? (job.engine === "h3" ? H3_ENDPOINT : SEEDANCE_ENDPOINT) : VOICE_MODELS[mode].endpoint), v.requestId);
    if (!polled?.done) continue;
    const url = mode === "video" ? str(polled.url) : voiceOutputUrl(mode, polled);
    if (polled.failed || !url) {
      if (stepDown(v, polled.error)) continue;
      throw fail(`${v.name}: ${polled.error || "fal returned no take"}`);
    }
    // Counted when fal delivers: a refused request is not billed.
    spend += auditionSpend(mode, job.engine, job.resolution);
    Object.assign(v, { status: "rendered", sourceUrl: url, seed: polled.output?.seed ?? null });
  }
  if (voices.some((v) => v.status === "queued")) return pending(); // a step-down: submitted next call
  if (voices.some((v) => v.status === "rendering")) return pending();

  // Every take is in: one box job cuts them all to mp3.
  if (!cut) {
    const stamp = crypto.randomUUID().slice(0, 6);
    const items = voices.map((v) => {
      const file = v.file || `voice-${tag}-${slug(v.name)}-${stamp}.mp3`;
      Object.assign(v, { file, status: "cutting" });
      return { sourceUrl: v.sourceUrl, outKey: storyKey(pid, file) };
    });
    const jobId = await box.startExtract(env, { items });
    spend += FILM_RATES_USD.sandboxMinute;
    cut = { jobId, attempt, startedAt: new Date().toISOString() };
    return pending();
  }

  const polled = await box.poll(env, cut.jobId);
  if (polled.status === "running") return pending();
  if (polled.status === "error") throw fail(`Cutting the voices failed — ${polled.error || "the sandbox failed"}`);
  const at = new Date().toISOString();
  for (const v of voices) Object.assign(v, { status: "done", url: directorUrl(v.file), doneAt: at });

  // The Bible shows each voice on its character. Best-effort; never fails the stage.
  for (const v of voices) {
    try {
      await setVoice(env, pid, v.name, { url: v.url, name: `${v.name} — audition`, trackId: "", v: null });
    } catch { /* the voice is filed on the step either way */ }
  }
  return { ...view(), spend };
}
