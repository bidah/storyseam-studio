// The Director Film's "Dialogue" stage (film-plan.ts › Voices).
//
// The live Director invents a voice for every chunk it generates: a line is
// only text in a beat ("Dialogue: …"), so the same character comes back with
// another voice four seconds later — and sometimes one that fits nobody. The
// Director takes no voice reference, but it does take TARGET AUDIO: a beat's
// `audioUrl` is played from that second, every chunk is generated against it,
// and the PCM itself is what the stream carries (src/director/session.ts). So
// the lines are SPOKEN BEFORE THE SITTING, in the voices the Voices stage
// auditioned, and handed to the Director to act to:
//
//   1. Every beat whose shots START there (the beat the cue sheet wrote their
//      dialogue into, cue-derive.js `beatsOnGrid`) gets that dialogue, split
//      into lines with a speaker each.
//   2. The lines are grouped into CLIPS, one per spoken beat, then merged:
//      a clip whose speech would run past the next clip's start is joined to
//      it, and a reel with more than MAX_AUDIO_BEATS clips (the endpoint's
//      `script_max_audio_beats`, per reel) merges its two closest neighbours
//      until it fits. A clip carries at most three voices (Seed Audio's
//      `audio_urls`); lines nobody can voice — no audition for the speaker,
//      no speaker at all — stay text, with the speaker's voice note beside
//      them so the Director at least casts the right kind of voice.
//   3. Each clip is ONE Seed Audio render on fal: the speakers' auditions as
//      @Audio1…3, the lines in order, voice only (no room, no music — the
//      score is laid under later). Filed as an mp3 under the Film's Director
//      media and set as its beat's `audioUrl`, with a sound note telling the
//      Director whose lips the audio belongs to.
//
// Runs after the Stills, when the Series' reels are fixed: the ceiling is per
// reel, and the run stage is what writes the reel changes.
//
// ── Across alarms ───────────────────────────────────────────────────────────
// A pending stage in the Voices' shape: each call submits what is queued,
// polls what is rendering, and answers `{ pending: true }` until every clip
// is filed; the state is this step's own result. A render fal failed is
// resubmitted on the retry; a finished clip is never paid for twice.
import { VOICE_RATES_USD } from "../film-plan.ts";
import { MAX_AUDIO_BEATS } from "../series.ts";
import { DEFAULT_FILM_LANGUAGE } from "../film-sound.js";
import { absolutize, directorUrl, readSeries, voiceBeats } from "../director.js";
import { readDoc } from "../docs.js";
import { putMedia } from "../media.js";
import { normalizeShot } from "../shots.js";
import { falPoll, falSubmit } from "../fal.js";
import { readWorld } from "../../routes/world.js";
import { stageLines, unquote } from "./story-flow/lines.js";
import { voiceNote } from "./story-flow/voices.js";

export const DIALOGUE_ENDPOINT = "bytedance/seed-audio-1.0";
/** Seed Audio's `audio_urls` ceiling — so a clip speaks in at most three voices. */
export const MAX_CLIP_VOICES = 3;
/** Seed Audio's own ceiling on a prompt, in bytes. */
const MAX_PROMPT_BYTES = 2000;
/** Spoken pace for the overlap check: words a second, plus a breath per line. */
const WORDS_PER_SECOND = 2.6;
const LINE_PAUSE_SECONDS = 0.4;

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim();
const key = (name) => str(name).toLowerCase().replace(/\s+/g, " ");
const slug = (s) => str(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "x";
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bytes = (s) => new TextEncoder().encode(s).length;

const readShots = async (env, pid) =>
  ((await readDoc(env, pid, "shotlist", { shots: [] })).shots || []).map(normalizeShot);

// ── Lines ───────────────────────────────────────────────────────────────────

const SILENT = /^\(?\s*(no dialogue|none|silent|silence|n\/a|—|-)\s*\)?\.?$/i;

/**
 * The names a speaker may be written as → the cast name: the full name, and
 * the first name where no one else in the cast shares it ("Kai" for "Kai
 * Morales" — the shot list is told to write full names, and does not always).
 */
export function speakerAliases(names) {
  const out = new Map();
  const firsts = new Map();
  for (const n of new Map(names.map((x) => [key(x), x])).values()) {
    const full = str(n);
    if (!full) continue;
    out.set(key(full), full);
    const first = key(full).split(" ")[0];
    if (first && first !== key(full)) firsts.set(first, firsts.has(first) ? null : full);
  }
  for (const [first, full] of firsts) if (full && !out.has(first)) out.set(first, full);
  return out;
}

/**
 * A shot's `dialogue` → [{ speaker, delivery, text }]. Read three ways, in
 * order: `Name (delivery): line` markers; quoted lines after a name (the
 * story flow's `Name, delivery: "line"`); else the whole text, spoken by the
 * shot's one character when it has exactly one. A line whose speaker cannot
 * be named keeps `speaker: ""` — it stays text.
 */
export function dialogueLines(dialogue, { cast = [], characters = [] } = {}) {
  const text = str(dialogue);
  if (!text || SILENT.test(text)) return [];
  const aliases = speakerAliases([...cast, ...characters]);
  const alts = [...aliases.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
  if (alts.length) {
    const marker = new RegExp(`(^|[\\s"“”.;!?—–-])(${alts.join("|")})\\s*(?:\\(([^)]*)\\))?\\s*:`, "gi");
    const hits = [...text.matchAll(marker)];
    if (hits.length) {
      const lines = [];
      hits.forEach((m, i) => {
        const start = m.index + m[0].length;
        const end = i + 1 < hits.length ? hits[i + 1].index + hits[i + 1][1].length : text.length;
        const said = unquote(text.slice(start, end)).replace(/\s+/g, " ").trim();
        if (said) lines.push({ speaker: aliases.get(key(m[2])) || "", delivery: str(m[3]), text: said });
      });
      // Text before the first marker is a line nobody was named for.
      const lead = unquote(text.slice(0, hits[0].index + hits[0][1].length)).trim();
      return lead ? [{ speaker: "", delivery: "", text: lead }, ...lines] : lines;
    }
  }
  // A line nobody is named for is the shot's when the shot has one character.
  const only = characters.length === 1 ? aliases.get(key(characters[0])) || "" : "";
  const quoted = stageLines({ audio: text }, [...aliases.keys()]);
  if (quoted.length) {
    return quoted.map((l) => ({ ...l, speaker: aliases.get(key(l.speaker)) || only }));
  }
  return [{ speaker: only, delivery: "", text: unquote(text) }];
}

/** Roughly how long a clip's lines take to say, in seconds. */
export const spokenSeconds = (lines) =>
  lines.reduce((s, l) => s + str(l.text).split(/\s+/).filter(Boolean).length / WORDS_PER_SECOND + LINE_PAUSE_SECONDS, 0);

const speakersOf = (lines) => {
  const out = [];
  for (const l of lines) if (l.speaker && !out.some((s) => key(s) === key(l.speaker))) out.push(l.speaker);
  return out;
};

// ── The plan ────────────────────────────────────────────────────────────────

/** The reel a beat at `offset` plays in: one per reel change at or before it. */
export const reelOf = (offset, reelChanges = []) => (reelChanges || []).filter((c) => c <= offset).length;

/**
 * Which beats speak, and what — the CLIPS to render, and the beats left as
 * text. Pure.
 *
 * `shotsByOffset` is the cue sheet's own map (`{ [offset]: shotId[] }`, a
 * shot listed in every beat it plays in); a shot's lines belong to the FIRST
 * beat it appears in, where the cue sheet wrote them. `voiced` is the set of
 * cast keys that have an audition.
 *
 * → { clips: [{ offset, reel, lines, speakers }], unvoiced: [{ offset, speakers }] }
 */
export function planDialogue({ shotsByOffset = {}, shots = [], cast = [], voiced = new Set(), reelChanges = [], maxPerReel = MAX_AUDIO_BEATS }) {
  const byId = new Map(shots.filter((s) => s?.id).map((s) => [s.id, s]));
  const offsets = Object.keys(shotsByOffset).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const seen = new Set();
  const beats = [];
  for (const offset of offsets) {
    const lines = [];
    for (const id of shotsByOffset[offset] || []) {
      if (seen.has(id)) continue;
      seen.add(id);
      const shot = byId.get(id);
      if (shot) lines.push(...dialogueLines(shot.dialogue, { cast, characters: shot.characters || [] }));
    }
    if (lines.length) beats.push({ offset, reel: reelOf(offset, reelChanges), lines, speakers: speakersOf(lines) });
  }

  // A beat is voiced only whole: every line has a speaker with an audition, and
  // three voices at most. Anything else is left for the Director to speak.
  const canVoice = (b) =>
    b.lines.every((l) => l.speaker && voiced.has(key(l.speaker))) && b.speakers.length <= MAX_CLIP_VOICES;
  let clips = beats.filter(canVoice).map((b) => ({ ...b }));
  const unvoiced = beats.filter((b) => !canVoice(b)).map((b) => ({ offset: b.offset, speakers: b.speakers }));

  const mergeable = (a, b) => a.reel === b.reel && speakersOf([...a.lines, ...b.lines]).length <= MAX_CLIP_VOICES;
  const merge = (a, b) => ({ offset: a.offset, reel: a.reel, lines: [...a.lines, ...b.lines], speakers: speakersOf([...a.lines, ...b.lines]) });

  // Speech that would still be running when the next clip starts is joined to
  // it — two clips must not talk over each other.
  for (let i = 0; i + 1 < clips.length; ) {
    const [a, b] = [clips[i], clips[i + 1]];
    if (a.offset + spokenSeconds(a.lines) > b.offset && mergeable(a, b)) clips.splice(i, 2, merge(a, b));
    else i++;
  }

  // The per-reel ceiling: pack neighbouring clips into runs of `size`, in
  // order, growing `size` until the reel fits (a run stops early where a
  // fourth voice would join it). When even that cannot fit — too many voices
  // taking turns — the clip with the least to say goes back to text.
  const pack = (mine, size) => {
    const runs = [];
    for (const c of mine) {
      const last = runs.at(-1);
      if (last && last.n < size && mergeable(last.clip, c)) Object.assign(last, { clip: merge(last.clip, c), n: last.n + 1 });
      else runs.push({ clip: c, n: 1 });
    }
    return runs.map((r) => r.clip);
  };
  const out = [];
  for (const reel of [...new Set(clips.map((c) => c.reel))]) {
    let mine = clips.filter((c) => c.reel === reel);
    for (;;) {
      let packed = mine;
      for (let size = Math.ceil(mine.length / maxPerReel); packed.length > maxPerReel && size <= mine.length; size++) {
        packed = pack(mine, size);
      }
      if (packed.length <= maxPerReel) {
        out.push(...packed);
        break;
      }
      const least = mine.reduce((x, y) => (spokenSeconds(y.lines) < spokenSeconds(x.lines) ? y : x));
      mine = mine.filter((c) => c !== least);
      unvoiced.push({ offset: least.offset, speakers: least.speakers });
    }
  }
  clips = out;
  return { clips, unvoiced: unvoiced.sort((a, b) => a.offset - b.offset) };
}

// ── The request ─────────────────────────────────────────────────────────────

/**
 * The Seed Audio prompt for one clip: who each reference is, then the lines
 * in order, as a clean voice-only recording. `refs` maps a speaker's key to
 * its `@AudioN`.
 */
export function dialoguePrompt(clip, refs, language = DEFAULT_FILM_LANGUAGE) {
  const lang = str(language) || DEFAULT_FILM_LANGUAGE;
  const who = clip.speakers.map((s) => `${refs.get(key(s))} is ${s}'s voice`).join(", ");
  const head = `${who}: keep each voice exactly as its reference — timbre, accent and delivery. A clean, dry, close-mic dialogue recording in ${lang}, voices only: no ambience, no room tone, no music, no sound effects. A short natural pause between lines.`;
  let body = "";
  for (const l of clip.lines) {
    const tag = l.delivery ? `${l.speaker} (${refs.get(key(l.speaker))}, ${l.delivery})` : `${l.speaker} (${refs.get(key(l.speaker))})`;
    const next = `${body} ${tag}: "${l.text.replace(/["“”]/g, "")}"`;
    if (bytes(`${head}${next}`) > MAX_PROMPT_BYTES) break;
    body = next;
  }
  return `${head}${body}`;
}

/** The fal request for one clip: the speakers' auditions as @Audio1…, the prompt. */
export function dialogueInput(env, pid, clip, voiceUrls, language) {
  const refs = new Map(clip.speakers.map((s, i) => [key(s), `@Audio${i + 1}`]));
  return {
    prompt: dialoguePrompt(clip, refs, language),
    audio_urls: clip.speakers.map((s) => absolutize(env, pid, voiceUrls.get(key(s)))),
    output_format: "mp3",
    sample_rate: 44100,
    ...(key(language || DEFAULT_FILM_LANGUAGE) !== "english" ? { multilingual: true } : {}),
  };
}

/** The sound note a voiced beat carries — whose lips the audio belongs to. */
export const voicedNote = (speakers) =>
  `The spoken lines in this beat are the attached audio, in ${speakers.join(" and ")}'s own voice${speakers.length === 1 ? "" : "s"}: lips move in sync with it, and nobody else speaks.`;

/** The sound note an unvoiced speaking beat carries — the voice to cast, from the World. */
export const castNote = (speakers, notes) =>
  speakers
    .map((s) => [s, str(notes.get(key(s)))])
    .filter(([, n]) => n)
    .map(([s, n]) => `${s}'s voice: ${n.replace(/[.!?]?$/, ".")}`)
    .join(" ");

// ── The stage ───────────────────────────────────────────────────────────────

/**
 * deps (optional): { fal: { submit, poll }, fetch, readShots, readWorld,
 * readSeries, voiceBeats, putMedia }.
 *
 * result = { seriesId, clips: [{ offset, reel, speakers, lines, status:
 *   'queued'|'rendering'|'done', requestId, renderAttempt, file, url, seconds }],
 *   unvoiced: [{ offset, speakers }], written }
 */
export async function runDialogueStage({ job, results, env, attempt = 1 }, deps = {}) {
  const fal = deps.fal || { submit: falSubmit, poll: falPoll };
  const fetchFn = deps.fetch || fetch;
  const pid = job.projectId;
  const seriesId = results?.cuesheet?.seriesId || results?.sheets?.seriesId;
  if (!seriesId) throw new Error("The Film has no cue sheet yet — the cue sheet step did not finish.");
  const falKey = str(env?.FAL_KEY);
  if (!falKey) throw new Error("No fal key connected — add yours in Settings › Connectors; the dialogue cannot be voiced.");
  const language = job.language || DEFAULT_FILM_LANGUAGE;

  const voiceUrls = new Map(
    (results?.voices?.voices || []).filter((v) => v?.status === "done" && v.url).map((v) => [key(v.name), v.url]),
  );
  if (!voiceUrls.size) throw new Error("There are no auditioned voices — the Voices step did not finish.");

  const prev = (job.steps || []).find((s) => s.key === "dialogue")?.result;
  let clips = prev?.clips;
  let unvoiced = prev?.unvoiced;
  if (!clips) {
    const [series, shots, world] = await Promise.all([
      (deps.readSeries || readSeries)(env, pid, seriesId),
      (deps.readShots || readShots)(env, pid),
      (deps.readWorld || readWorld)(env, pid),
    ]);
    if (!series) throw new Error(`The Film's Series ${seriesId} is gone.`);
    const cast = (world?.characters || []).map((c) => str(c?.name)).filter(Boolean);
    const planned = planDialogue({
      shotsByOffset: results?.cuesheet?.shotsByOffset || {},
      shots,
      cast,
      voiced: new Set(voiceUrls.keys()),
      reelChanges: series.reelChanges || [],
    });
    clips = planned.clips.map((c) => ({ ...c, status: "queued" }));
    // An unvoiced speaking beat still gets its speakers' voice notes.
    const notes = new Map((world?.characters || []).map((c) => [key(c?.name), voiceNote(c)]));
    unvoiced = planned.unvoiced.map((u) => ({ ...u, note: castNote(u.speakers, notes) }));
  }

  const tag = slug(job.id);
  let spend = 0;
  const view = () => {
    const done = clips.filter((c) => c.status === "done").length;
    const lines = clips.reduce((n, c) => n + c.lines.length, 0);
    const left = unvoiced.length ? ` · ${unvoiced.length} left to the Director` : "";
    const summary = !clips.length
      ? `No line could be voiced${left}`
      : done < clips.length
        ? `${done} of ${clips.length} dialogue clips voiced`
        : `${lines} line${lines === 1 ? "" : "s"} voiced in ${clips.length} clip${clips.length === 1 ? "" : "s"}${left}`;
    return { summary, result: { seriesId, clips, unvoiced } };
  };
  const pending = () => ({ pending: true, ...view(), spend });
  const fail = (message) => {
    const err = new Error(message);
    if (spend > 0) err.spend = spend;
    return err;
  };

  // A retry resubmits what an earlier attempt left rendering.
  for (const c of clips) {
    if (c.status === "rendering" && (c.renderAttempt || 1) < attempt) Object.assign(c, { status: "queued", requestId: null });
  }

  const queued = clips.filter((c) => c.status === "queued");
  if (queued.length) {
    await Promise.all(queued.map(async (c) => {
      try {
        const { requestId } = await fal.submit(falKey, DIALOGUE_ENDPOINT, dialogueInput(env, pid, c, voiceUrls, language));
        Object.assign(c, { status: "rendering", requestId, renderAttempt: attempt });
      } catch (err) {
        throw fail(`The lines at ${c.offset}s: ${String(err?.message || err)}`);
      }
    }));
    return pending();
  }

  for (const c of clips.filter((x) => x.status === "rendering")) {
    const polled = await fal.poll(falKey, DIALOGUE_ENDPOINT, c.requestId);
    if (!polled?.done) continue;
    const url = str(polled.output?.audio?.url || polled.url);
    if (polled.failed || !url) throw fail(`The lines at ${c.offset}s: ${polled.error || "fal returned no audio"}`);
    spend += VOICE_RATES_USD.dialogueClip;
    const got = await fetchFn(url);
    if (!got.ok) throw fail(`The lines at ${c.offset}s could not be fetched from fal (${got.status})`);
    const file = `dialogue-${tag}-${c.offset}s-${crypto.randomUUID().slice(0, 6)}.mp3`;
    await (deps.putMedia || putMedia)(env, pid, "director", file, await got.arrayBuffer(), "audio/mpeg");
    Object.assign(c, { status: "done", file, url: directorUrl(file), seconds: Number(polled.output?.audio?.duration) || null });
  }
  if (clips.some((c) => c.status !== "done")) return pending();

  // Everything is filed: hand the beats their audio in one validated write.
  const entries = [
    ...clips.map((c) => ({ offset: c.offset, audioUrl: c.url, sound: voicedNote(c.speakers) })),
    ...unvoiced.filter((u) => u.note).map((u) => ({ offset: u.offset, audioUrl: null, sound: u.note })),
  ];
  if (entries.length) {
    const res = await (deps.voiceBeats || voiceBeats)(env, pid, seriesId, entries);
    if (res.missing) throw fail(`The Film's Series ${seriesId} is gone.`);
    if (res.noBeat !== undefined) throw fail(`The cue sheet has no beat at ${res.noBeat}s any more.`);
    if (res.issues) throw fail(`The Series would refuse the dialogue: ${Object.values(res.issues).join("; ")}`);
  }
  return { ...view(), spend };
}
