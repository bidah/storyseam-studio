// The Film job's "Reference sheets" stage (Auto, PRD #59 / #66).
//
// The writing model reads the World and writes ONE model-sheet prompt per
// recurring subject — every character and place the World names, plus any
// machine the story keeps returning to — and one or two STYLE sheets that fix
// the house look. At most nine in all (fal's reference ceiling,
// MAX_REFERENCE_SHEETS), style first: the shot sheet numbers references style
// first, and the subjects are drawn WITH the style sheet as their reference so
// the whole cast comes out in one hand.
//
// Images run on the PLATFORM fal key (`env.FAL_KEY`, ADR 0003 — an Auto Film
// has no browser to carry a BYOK key), through the same Nano Banana Pro
// endpoints the Images tab uses, and are filed on the Film's Director Series as
// model sheets exactly as `attach_model_sheet` files one: kind, name, the
// prompt verbatim, the picture, the model, the refs it was drawn from.
//
// The Series is the Film's: created here on first run (tagged `filmId`), found
// again by that tag when the stage re-runs, so a retry never makes a second
// Series — and a sheet already filed with a picture is not paid for twice.
import { SHEET_FORM } from "../auto-prompts.generated.js";
import { filmSoundLock } from "../film-sound.js";
import { filmStyleFor } from "../film-plan.ts";
import { absolutize, createSeries, directorUrl, readIndex, readSeries, upsertModelSheet } from "../director.js";
import { artSettings } from "../series.ts";
import { MAX_REFERENCE_SHEETS } from "../film-plan.ts";
import { falPoll, falSubmit } from "../fal.js";
import { putMedia } from "../media.js";
import { readWorld } from "../../routes/world.js";

export const MAX_STYLE_SHEETS = 2;
// GPT Image 2.5 Flare on fal: text-to-image for a sheet drawn from its prompt
// alone, /edit for one drawn against other sheets (the style sheets first).
export const SHEET_MODEL = {
  id: "fal:openai/gpt-image-2.5/flare",
  label: "GPT Image 2.5 Flare · fal",
  endpoint: "openai/gpt-image-2.5/flare/text-to-image",
  editEndpoint: "openai/gpt-image-2.5/flare/edit",
};
/** Model sheets are looked at, never played: high quality so each view is big enough to reference. */
export const SHEET_QUALITY = "high";
// Flare takes an image_size preset, not an aspect ratio.
const IMAGE_SIZE = { "16:9": "landscape_16_9", "9:16": "portrait_16_9", "1:1": "square_hd", "4:3": "landscape_4_3", "3:4": "portrait_4_3" };
const POLL_MS = 3000;
const POLL_TIMEOUT_MS = 6 * 60 * 1000;

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim();
const key = (name) => str(name).toLowerCase().replace(/\s+/g, " ");

// ── The writing half ────────────────────────────────────────────────────────

export function sheetMessages({ idea, world, look = null }) {
  const cast = (world.characters || [])
    .map((c) => `- ${c.name}${c.role ? ` (${c.role})` : ""}: ${c.appearance || c.traits || "(no appearance given — design one)"}`)
    .join("\n");
  const places = (world.locations || [])
    .map((l) => `- ${l.name}: ${l.description || "(no description given — design one)"}`)
    .join("\n");
  const system = [
    "You are the art department of StorySeam's Auto pipeline. A short film's World is written; you write",
    "the prompts for its REFERENCE SHEETS — the model sheets every later frame is drawn against. Nobody",
    "will be asked anything: decide every design detail yourself, concretely.",
    "",
    "Write:",
    `- 1 or 2 STYLE sheets (at most ${MAX_STYLE_SHEETS}): a style frame fixing the palette, film stock, grain,`,
    "  line and lighting of the whole film — no characters.",
    "- ONE sheet per character in the World (kind \"character\"), using the character's name EXACTLY.",
    "- ONE sheet per place in the World (kind \"location\"), using the place's name EXACTLY.",
    "- Optionally a sheet for a machine, vehicle or creature the story keeps returning to (kind",
    "  \"character\" — a figure held still across the piece, alive or not).",
    `At most ${MAX_REFERENCE_SHEETS} sheets in all, style included. Every character and place MUST have one.`,
    "",
    "Also write ONE `renderClause`: the house-style sentence every sheet carries verbatim (it is appended",
    "to each prompt for you — do not repeat it inside the prompts).",
    ...(look
      ? [
          "",
          "THE FILM'S LOOK IS ALREADY CHOSEN — do not invent another, and do not drift from it:",
          look.look,
          "The style sheets are frames OF this look (palette, light, texture, line), and the renderClause restates",
          "it. Every character and place is designed to belong in it.",
        ]
      : []),
    "",
    "How a model sheet is drawn and prompted, as the studio's model-sheets playbook states it:",
    "",
    SHEET_FORM,
    "",
    "Answer with ONE JSON object and nothing else:",
    '{ "renderClause": string,',
    '  "styles": [{ "name": string, "prompt": string }],',
    '  "sheets": [{ "kind": "character" | "location", "name": string, "prompt": string }] }',
  ].join("\n");
  const user = [
    `The Idea: ${idea || "(none)"}`,
    `Title: ${world.title || "(untitled)"}`,
    world.logline ? `Logline: ${world.logline}` : "",
    "",
    "Characters:",
    cast || "(none)",
    "",
    "Places:",
    places || "(none)",
  ].filter((l) => l !== "").join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/**
 * The model's answer + the World → the ordered, capped list of sheets to draw.
 *
 * Style first (1–2), then the World's characters in roster order, then its
 * places, then any extra recurring machine the model added. A World subject
 * the model forgot gets a sheet written from its own appearance note — every
 * recurring subject is covered. The cap of nine gives way in this order: the
 * second style sheet, then the extras, then (only for a World too big to fit)
 * the last subjects.
 *
 * → [{ kind: 'style'|'character'|'location', name, prompt }]
 */
export function planSheets(answer, world, max = MAX_REFERENCE_SHEETS, { look = null } = {}) {
  // The chosen look leads every sheet's clause, whatever the model wrote.
  const clause = [look ? `In the film's look: ${look.look}` : "", str(answer?.renderClause)].filter(Boolean).join(" ");
  const withClause = (p) => [str(p), clause].filter(Boolean).join("\n\n");

  let styles = (Array.isArray(answer?.styles) ? answer.styles : [])
    .map((s) => ({ kind: "style", name: str(s?.name) || "House style", prompt: withClause(s?.prompt) }))
    .filter((s) => s.prompt)
    .slice(0, MAX_STYLE_SHEETS);
  if (!styles.length) {
    styles = [{
      kind: "style",
      name: "House style",
      prompt: withClause(`A style frame for the whole film: palette swatches, film stock, grain, line and lighting${look ? `, in this look: ${look.look}` : ""}. No characters.`),
    }];
  }

  const written = new Map();
  for (const s of Array.isArray(answer?.sheets) ? answer.sheets : []) {
    const name = str(s?.name);
    const prompt = str(s?.prompt);
    if (!name || !prompt || written.has(key(name))) continue;
    written.set(key(name), { kind: s?.kind === "location" ? "location" : "character", name, prompt: withClause(prompt) });
  }

  const take = (name, kind, fallback) => {
    const hit = written.get(key(name));
    written.delete(key(name));
    return hit ? { ...hit, kind, name } : { kind, name, prompt: withClause(fallback) };
  };
  const characters = (world.characters || []).filter((c) => str(c?.name)).map((c) =>
    take(c.name, "character",
      `A character model sheet of ${c.name}: ${c.appearance || c.traits || c.role || "a figure from this story"}. ` +
      "Four consistent full-body views in a row — front, 3/4, side profile, back — plus one head-and-shoulders detail " +
      "at the far right, on a plain neutral pale grey background. The same design and proportions in every view. " +
      "No text, no watermark, no other characters."),
  );
  const locations = (world.locations || []).filter((l) => str(l?.name)).map((l) =>
    take(l.name, "location",
      `A location model sheet of ${l.name}: ${l.description || "a place from this story"}. Three views: a wide ` +
      "establishing view, a mid view from inside it, and a detail of one piece of architecture. Even light. " +
      "No characters, no text, no watermark."),
  );
  const subjects = [...characters, ...locations];
  const extras = [...written.values()]; // machines etc. the model added beyond the World

  // Fit the cap: drop the second style, then extras, then the tail.
  if (styles.length + subjects.length > max) styles = styles.slice(0, 1);
  const room = Math.max(0, max - styles.length - subjects.length);
  return [...styles, ...subjects, ...extras.slice(0, room)].slice(0, max);
}

// ── The Film's Series ───────────────────────────────────────────────────────

/** The Director Series this Film files onto — found by `filmId`, or made. */
export async function ensureFilmSeries(env, pid, job, { title, prompt }) {
  const index = await readIndex(env, pid);
  for (const id of index.seriesIds || []) {
    const s = await readSeries(env, pid, id);
    if (s?.filmId === job.id) return s;
  }
  const res = await createSeries(
    env,
    pid,
    // 480p on purpose: the Sitting streams at the Series' resolution, and an
    // Auto Film is shot at 480p by default.
    { title: str(title).slice(0, 200) || "Auto Film", prompt: str(prompt) || job.prompt, aspectRatio: "16:9", resolution: "480p" },
    { filmId: job.id, source: "auto" },
  );
  if (!res.ok) throw new Error(`Could not create the Film's Series: ${Object.values(res.issues || {}).join("; ")}`);
  return res.series;
}

// ── The drawing half ────────────────────────────────────────────────────────

const slug = (s) => str(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "sheet";

/**
 * Draw one sheet on fal and put its bytes in R2 under this project's Director
 * media. `refs` are fal-reachable urls of the pictures it is drawn FROM (the
 * style sheet): with any, it goes to the /edit endpoint, as the Images tab does.
 *
 * → { imageUrl: '/director-media/<file>', sourceUrl }
 */
export async function drawSheet({ env, pid, job, sheet, aspectRatio, refs = [] }, deps = {}) {
  const fal = deps.fal || { submit: falSubmit, poll: falPoll };
  const fetchFn = deps.fetch || fetch;
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const put = deps.putMedia || putMedia;
  const falKey = str(env?.FAL_KEY);
  if (!falKey) throw new Error("FAL_KEY is not set on the Worker — reference sheets cannot be drawn");

  const endpoint = refs.length ? SHEET_MODEL.editEndpoint : SHEET_MODEL.endpoint;
  const { requestId } = await fal.submit(falKey, endpoint, {
    prompt: sheet.prompt,
    image_size: IMAGE_SIZE[aspectRatio] || "landscape_16_9",
    quality: SHEET_QUALITY,
    num_images: 1,
    output_format: "png",
    ...(refs.length ? { image_urls: refs } : {}),
  });

  const deadline = (deps.now || Date.now)() + POLL_TIMEOUT_MS;
  let result;
  for (;;) {
    result = await fal.poll(falKey, endpoint, requestId);
    if (result?.done) break;
    if ((deps.now || Date.now)() > deadline) throw new Error(`"${sheet.name}" timed out on fal`);
    await sleep(POLL_MS);
  }
  if (result.failed || !result.url) throw new Error(`"${sheet.name}": ${result.error || "fal returned no image"}`);

  const res = await fetchFn(result.url);
  if (!res.ok) throw new Error(`"${sheet.name}": image fetch failed (${res.status})`);
  const ct = res.headers?.get?.("content-type") || "image/png";
  const ext = /webp/.test(ct) ? "webp" : /jpe?g/.test(ct) ? "jpg" : "png";
  const file = `auto-${slug(job.id)}-${slug(sheet.name)}-${crypto.randomUUID().slice(0, 6)}.${ext}`;
  await put(env, pid, "director", file, await res.arrayBuffer(), ct);
  return { imageUrl: directorUrl(file), sourceUrl: result.url };
}

// ── The stage ───────────────────────────────────────────────────────────────

/**
 * deps (all optional — production defaults): { readWorld, fal: { submit, poll },
 * fetch, putMedia, sleep, now }. Tests pass fakes; FILM_STAGES passes none.
 */
export async function runSheetsStage({ job, results, env, model }, deps = {}) {
  const pid = job.projectId;
  const world = await (deps.readWorld || readWorld)(env, pid);
  if (!world?.characters?.length) throw new Error("There is no World to draw sheets from.");
  const idea = results?.world?.idea || "";

  const look = filmStyleFor({ style: job.style, prompt: job.prompt });
  const answer = await model.json({ messages: sheetMessages({ idea, world, look }), maxTokens: 8000, temperature: 0.7 });
  const plan = planSheets(answer, world, undefined, { look });

  const series = await ensureFilmSeries(env, pid, job, {
    title: world.title || results?.world?.title,
    // The sound lock rides on the Series prompt too: it is what `configure`
    // opens the sitting with, before the first beat says anything.
    // The look opens it, with its lock: the Series prompt is what the Director
    // opens the sitting with and what every shot sheet's premise is.
    prompt: [look.look, look.lock, idea, world.logline, filmSoundLock(job.language)].filter(Boolean).join("\n\n"),
  });
  const aspectRatio = artSettings(series).sheets.aspectRatio;
  const filed = new Map((series.modelSheets || []).filter((s) => s.imageUrl).map((s) => [s.name, s]));

  const failures = [];
  // Draw a group in parallel, then file it in PLAN order (a Series' sheets are
  // numbered by position — style first — so completion order must not leak in).
  const drawGroup = async (group, refs) => {
    const drawn = await Promise.all(group.map(async (sheet) => {
      const have = filed.get(sheet.name);
      if (have) return { ...sheet, imageUrl: have.imageUrl, sourceUrl: null, reused: true };
      try {
        // fal fetches a reference itself: the style's own fal url when it was
        // just drawn, else (a re-run) its public /files url.
        const refUrls = refs
          .map((r) => r.sourceUrl || absolutize(env, pid, r.imageUrl))
          .filter((u) => /^https?:\/\//i.test(u));
        return { ...sheet, ...(await drawSheet({ env, pid, job, sheet, aspectRatio, refs: refUrls }, deps)) };
      } catch (err) {
        failures.push(String(err?.message || err));
        return null;
      }
    }));
    const out = [];
    for (const sheet of drawn) {
      if (!sheet) continue;
      if (!sheet.reused) {
        const res = await upsertModelSheet(env, pid, series.id, {
          kind: sheet.kind,
          name: sheet.name,
          prompt: sheet.prompt,
          imageUrl: sheet.imageUrl,
          model: SHEET_MODEL.label,
          refs: refs.map((r) => r.imageUrl),
        });
        if (!res.ok) {
          failures.push(`"${sheet.name}" could not be filed: ${Object.values(res.issues || { e: "no such Series" }).join("; ")}`);
          continue;
        }
      }
      out.push(sheet);
    }
    return out;
  };

  // Style first — its picture is what every subject is drawn against.
  const styles = await drawGroup(plan.filter((s) => s.kind === "style"), []);
  const subjects = await drawGroup(plan.filter((s) => s.kind !== "style"), styles);

  if (failures.length) {
    // What was drawn is filed and will not be redrawn when the stage re-runs.
    throw new Error(`${failures.length} of ${plan.length} reference sheets failed — ${failures.join("; ")}`);
  }

  const sheets = [...styles, ...subjects].map((s) => ({ kind: s.kind, name: s.name, imageUrl: s.imageUrl }));
  return {
    summary: `${sheets.length} reference sheet${sheets.length === 1 ? "" : "s"} — ${sheets.map((s) => s.name).join(", ")}`,
    result: { seriesId: series.id, sheets },
  };
}
