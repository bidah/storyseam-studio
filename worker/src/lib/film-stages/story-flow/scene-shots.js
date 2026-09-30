// The story-flow Shot list, cut the way the studio cuts one (flue-agent's
// shot-list skill, vendored as SHOTLIST_FIELDS): each segment's scene is broken
// into SHOTS of a few seconds — one camera setup each, wides → mediums →
// close-ups → inserts — with the action, the lines and the end state of each.
// A segment is then one ≤15s (H3) / ≤30s (Seedance) bundle of those shots,
// rendered as one take, the way the Episode tab packs a studio shot list.
//
// Why per segment. The Shot list used to be ONE call for the whole film, and
// the writer collapsed it: film-a45e1cb9 ("Star Ronin", H3, Qwen 3.8,
// 2026-09-29) came back as 8 segments of ONE 15s stage each — "the camera
// slowly pushes in… The Thug taunts him… The Girl asks who he is" — so H3 got
// one [Shot 1] per take and invented the cutting itself, and two of the four
// screenplay lines were dropped or merged. One call per segment gives the
// writer one scene to stage, in parallel, and CODE checks what it wrote
// (`segmentIssues`: the shot count, every screenplay line verbatim and once, a
// camera on every shot) and sends the problems back once before it is kept.
import { SHOTLIST_FIELDS } from "../../auto-prompts.generated.js";
import { formatScreenplay } from "../../script-elements.js";
import { stageLines } from "./lines.js";

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim();
const key = (name) => str(name).toLowerCase().replace(/\s+/g, " ");
/** Words only, for comparing a line as written with the screenplay's. */
const norm = (t) => str(t).toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9'\s]+/g, " ").replace(/\s+/g, " ").trim();
const words = (t) => (str(t).match(/\S+/g) || []).length;

/**
 * The shot-list skill's cutting rule (its step 2: walk the screenplay in order,
 * wides → mediums → close-ups → inserts, ~2–4s a shot), as the chat agent
 * reads it. Only that step: its field list is the studio's shot schema.
 */
export const CUTTING_RULE = SHOTLIST_FIELDS.split(/\n3\. /)[0].replace(/^2\.\s*/, "").trim();

// ── How many shots a segment holds ──────────────────────────────────────────

/** Seconds one shot may run: a camera setup is 2–5s on H3, 2–6s on Seedance. */
export const SHOT_SECONDS = { min: 2, target: { h3: 3, seedance: 4 }, max: { h3: 5, seedance: 6 } };

/**
 * The shots a segment of `dur` seconds is cut into → { min, target, max }.
 * 15s → 3–7 (aim 5), 30s → 5–10 (aim 8). The floor is what one shot per
 * max-length setup needs; the ceiling keeps each shot at least 2s long.
 */
export function shotRangeFor(dur, engine = "h3") {
  const d = Math.max(1, Number(dur) || 0);
  const longest = SHOT_SECONDS.max[engine] || SHOT_SECONDS.max.h3;
  const min = Math.max(2, Math.ceil(d / longest));
  const max = Math.max(min, Math.min(24, Math.floor(d / SHOT_SECONDS.min)));
  const target = Math.min(max, Math.max(min, Math.round(d / (SHOT_SECONDS.target[engine] || SHOT_SECONDS.target.h3))));
  return { min, target, max };
}

// ── The screenplay, cut to the segments ─────────────────────────────────────

/** Screen time an element takes, roughly: speech at its pace, action a little slower to read than to see. */
const weightOf = (el) => {
  const w = words(el?.text);
  if (el?.type === "dialogue") return w / 2.4;
  if (el?.type === "action") return w / 3.5;
  return 0;
};

/** Elements → scenes: each starts at a scene heading (anything before the first is its own). */
export function screenplayScenes(elements = []) {
  const scenes = [];
  for (const el of elements) {
    if (el?.type === "scene_heading" || !scenes.length) scenes.push([]);
    scenes.at(-1).push(el);
  }
  return scenes.filter((s) => s.some((el) => el?.type !== "scene_heading" && el?.type !== "transition"));
}

/** Split `items` (weighted) into `n` contiguous non-empty runs of about equal weight. */
function balance(items, n, weight) {
  if (n <= 1 || items.length <= 1) return [items];
  const total = items.reduce((a, x) => a + weight(x), 0) || items.length;
  const out = [];
  let run = [];
  let acc = 0;
  items.forEach((x, i) => {
    run.push(x);
    acc += weight(x) || total / items.length / 4;
    const left = items.length - i - 1;
    const runsLeft = n - out.length - 1;
    // Close this run once it has its share, or when every remaining item is
    // needed to give each remaining run one.
    if (runsLeft > 0 && (acc >= (total * (out.length + 1)) / n || left === runsLeft)) {
      out.push(run);
      run = [];
    }
  });
  if (run.length) out.push(run);
  return out;
}

/**
 * The screenplay → `n` parts, one per segment, in order. The Script stage
 * writes one scene per segment, so this is usually scene k → segment k; when
 * the counts differ, whole scenes are grouped by screen time (more scenes than
 * segments) or a long scene is split between its lines (fewer), a split part
 * carrying the heading again. → [{ elements, headings }]
 */
export function screenplayParts(elements = [], n = 1) {
  const scenes = screenplayScenes(elements);
  if (!scenes.length || n < 1) return Array.from({ length: Math.max(0, n) }, () => ({ elements: [], headings: [] }));
  const sceneWeight = (s) => s.reduce((a, el) => a + weightOf(el), 0);
  let parts;
  if (scenes.length === n) {
    parts = scenes;
  } else if (scenes.length > n) {
    parts = balance(scenes, n, sceneWeight).map((group) => group.flat());
  } else {
    // Fewer scenes than segments: give each scene segments by its weight (at
    // least one), then split its body between beats.
    const total = scenes.reduce((a, s) => a + sceneWeight(s), 0) || scenes.length;
    const share = scenes.map((s) => (sceneWeight(s) / total) * n);
    const count = share.map((x) => Math.max(1, Math.floor(x)));
    let left = n - count.reduce((a, b) => a + b, 0);
    const order = share.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
    for (let k = 0; left > 0; k = (k + 1) % scenes.length, left--) count[order[k]] += 1;
    for (let i = scenes.length - 1; left < 0 && i >= 0; i--) {
      const take = Math.min(count[i] - 1, -left);
      count[i] -= take;
      left += take;
    }
    parts = scenes.flatMap((scene, i) => {
      const heading = scene[0]?.type === "scene_heading" ? scene[0] : null;
      const body = heading ? scene.slice(1) : scene;
      // A character cue belongs with its line: split only before a cue or an action.
      const beats = [];
      for (const el of body) {
        if (!beats.length || (el.type !== "dialogue" && el.type !== "parenthetical" && beats.at(-1).at(-1)?.type !== "character")) beats.push([]);
        beats.at(-1).push(el);
      }
      return balance(beats, count[i], (b) => b.reduce((a, el) => a + weightOf(el), 0))
        .map((run, j) => [...(heading ? [j ? { ...heading, text: `${heading.text} (CONTINUED)` } : heading] : []), ...run.flat()]);
    });
    while (parts.length < n) parts.push([]);
  }
  return parts.map((els) => ({ elements: els, headings: els.filter((el) => el.type === "scene_heading").map((el) => el.text) }));
}

/**
 * The spoken lines of a part of the screenplay, speaker as the World spells it
 * (the screenplay's cue, CAPITALISED, matched by name; kept as written when
 * the World has nobody by that name). → [{ speaker, text }]
 */
export function partLines(elements = [], worldNames = []) {
  const out = [];
  let speaker = "";
  for (const el of elements) {
    if (el?.type === "character") speaker = str(el.text).replace(/\s*\((?:V\.O\.|O\.S\.|CONT'D|CONT’D)\)\s*$/i, "");
    else if (el?.type === "dialogue" && str(el.text)) {
      const name = worldNames.find((n) => key(n) === key(speaker)) || speaker;
      out.push({ speaker: name, text: str(el.text) });
    }
  }
  return out;
}

// ── What one segment's writer is told ───────────────────────────────────────

/**
 * The messages for ONE segment's shots. `part` is its piece of the screenplay
 * (screenplayParts), `prev`/`next` its neighbours' (for where it opens and
 * where it must leave off), `eng` the engine profile (shotlist.js
 * STORY_ENGINES).
 */
export function segmentShotMessages({ eng, engineId = "h3", world, idea = "", screenplay = [], part, prev = null, next = null, index, durations, language, takeMax = null }) {
  const dur = durations[index];
  const total = durations.length;
  const range = shotRangeFor(dur, engineId);
  const longest = SHOT_SECONDS.max[engineId] || SHOT_SECONDS.max.h3;
  const lines = partLines(part?.elements, (world.characters || []).map((c) => c.name));
  const system = [
    `You are the shot director of StorySeam's story flow. A short film will be generated by ${eng.model} on fal,`,
    ...eng.chain,
    takeMax
      ? `You are cutting ONE scene of it into SHOTS: scene ${index + 1} of ${total}, exactly ${dur} seconds. The studio then packs consecutive shots into takes of at most ${takeMax}s — each take one continuous generation — so write the shots, not the takes.`
      : `You are cutting ONE segment of it into SHOTS: segment ${index + 1} of ${total}, exactly ${dur} seconds, rendered as one take.`,
    "",
    "How a storyboard artist cuts a scene into shots — the studio's own rules (a `scene_heading` is a",
    "location; you are writing one segment, so everything below happens in its one place):",
    CUTTING_RULE,
    "",
    `How ${eng.model} is prompted (you write the CONTENT; the studio compiles the references, the look and the`,
    "continuation clause itself):",
    "<<<SKILL",
    eng.skill,
    "SKILL>>>",
    "",
    "THIS SEGMENT'S SHOTS:",
    `- ${range.min}–${range.max} shots (aim for ${range.target}), each ${SHOT_SECONDS.min}–${longest} seconds, adding up to ${dur}. One shot = ONE camera`,
    "  setup and ONE main action. When the camera cuts to a new size or angle, that is a new shot. Never one",
    "  shot for the whole segment: a talking beat is shot / reverse shot / reaction, an action beat is",
    "  wide → medium → close-up → insert.",
    "- `camera`: shot size (extreme wide, wide, medium, medium close-up, close-up, extreme close-up, insert),",
    "  angle (eye level, low, high, over-the-shoulder, profile, top-down) and movement (static, slow push-in,",
    "  pull-back, pan, tilt, tracking, handheld). Plainly — no style or look words, the look is added for you.",
    "- `initial`: what is visibly true as the shot opens (who is where, facing what, holding what).",
    "- `event`: the ONE thing that visibly happens in the shot, as physical action a camera can see.",
    "- `end`: what is visibly true when the shot ends — positions, who holds what, screen direction.",
    "  The next shot opens on it.",
    "- Shot 1 opens where the previous segment left off (below), unless the screenplay cuts somewhere new.",
    "  The last shot ends where the next segment picks up — do not play the next segment's action.",
    "- Name every character by their World name EXACTLY in every field (never \"he\", \"the pilot\").",
    "- `characters`: everyone who appears in the segment. `props`: the World's props seen in it (names",
    "  EXACTLY); a prop is in a character's hands only where a shot says so — the character references",
    "  are drawn empty-handed.",
    ...(eng.lines
      ? [...eng.dialogue, `- Every line is in ${language} only.`]
      : [
          `- \`audio\` is plain prose: named speaker + delivery before any line, the line itself in double quotes,`,
          `  in ${language} only; then ambience and effects. Every screenplay line is spoken VERBATIM, once, in`,
          "  the shot where it lands — never paraphrased, never added, never repeated.",
        ]),
    "- NEVER music in `audio` or `sound`: no score, no singing, no humming — the music is laid under the",
    "  finished film later. No subtitles, captions or on-screen text.",
    "- `environment` is THIS segment's place at this moment — light, time of day, weather, what is physically",
    "  there — and `sound` its ambience bed (never music, never speech). Only this segment's place.",
    "- `goal` is one sentence: what this segment shows. `title` a few words (a label, never spoken).",
    "",
    "Answer with ONE JSON object and nothing else:",
    '{ "title": string, "goal": string, "location": string, "characters": [string], "props": [string],',
    '  "environment": string, "sound": string,',
    '  "shots": [{ "name": string, "seconds": number, "camera": string, "initial": string, "event": string,',
    `    "audio": string,${eng.lines ? ' "lines": [{ "speaker": string, "delivery": string, "text": string }],' : ""} "end": string }] }`,
  ].join("\n");

  const cast = (world.characters || []).map((c) => `- ${c.name}${c.role ? ` — ${c.role}` : ""}${c.look || c.description ? `: ${str(c.look || c.description).slice(0, 240)}` : ""}`).join("\n");
  const places = (world.locations || []).map((l) => `- ${l.name}${l.description ? `: ${str(l.description).slice(0, 240)}` : ""}`).join("\n");
  const propList = (world.props || []).map((p) => `- ${p.name}${p.owner ? ` (${p.owner}'s)` : ""}${p.description ? `: ${str(p.description).slice(0, 200)}` : ""}`).join("\n");
  const user = [
    `The Idea: ${idea || "(none)"}`,
    `Title: ${world.title || "(untitled)"}`,
    world.logline ? `Logline: ${world.logline}` : "",
    "",
    "Characters:", cast || "(none)", "",
    "Places:", places || "(none)", "",
    "Props:", propList || "(none)", "",
    ...(screenplay.length ? ["The whole screenplay, for context:", formatScreenplay(screenplay), ""] : []),
    prev?.elements?.length ? `The previous ${takeMax ? "scene" : "segment"} (${index}) ends with:\n${formatScreenplay(prev.elements.slice(-4))}\n` : `This is the film's first ${takeMax ? "scene" : "segment"}: it opens the film.\n`,
    `YOUR ${takeMax ? "SCENE — scene" : "SEGMENT — segment"} ${index + 1} of ${total}, ${dur} seconds, ${range.min}–${range.max} shots (aim for ${range.target}):`,
    part?.elements?.length ? formatScreenplay(part.elements) : "(this part of the screenplay is empty — stage the bridge between its neighbours)",
    "",
    lines.length
      ? `Its lines, each spoken VERBATIM exactly once, in this order:\n${lines.map((l, i) => `${i + 1}. ${l.speaker}: ${l.text}`).join("\n")}`
      : "It has no dialogue: nobody speaks in it.",
    "",
    next?.elements?.length ? `The next ${takeMax ? "scene" : "segment"} (${index + 2}) — NOT yours, do not play it — begins:\n${formatScreenplay(next.elements.slice(0, 3))}` : `This is the film's last ${takeMax ? "scene" : "segment"}: it ends the film.`,
  ].filter((l) => l !== "").join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// ── What code checks ────────────────────────────────────────────────────────

/**
 * A parsed segment against its part of the screenplay → the problems, as
 * sentences a writer can act on ([] when none). Checked: the shot count, the
 * length of each shot, a camera on each, and every screenplay line — spoken,
 * verbatim, once — with nothing spoken the screenplay does not have.
 * `asked` is the seconds the writer asked for per shot (before fitting).
 */
export function segmentIssues(segment, { lines = [], engine = "h3", asked = null } = {}) {
  const issues = [];
  const range = shotRangeFor(segment.dur, engine);
  const longest = SHOT_SECONDS.max[engine] || SHOT_SECONDS.max.h3;
  const shots = segment.stages || [];
  if (shots.length < range.min) {
    issues.push(`It has ${shots.length} shot${shots.length === 1 ? "" : "s"}; a ${segment.dur}s segment needs ${range.min}–${range.max} (aim for ${range.target}), each one camera setup of ${SHOT_SECONDS.min}–${longest}s.`);
  }
  const long = shots.map((s, i) => [i, s.seconds]).filter(([, s]) => s > longest + 1);
  if (long.length && shots.length >= range.min) {
    issues.push(`Shot${long.length === 1 ? "" : "s"} ${long.map(([i]) => i + 1).join(", ")} run${long.length === 1 ? "s" : ""} longer than ${longest}s — cut ${long.length === 1 ? "it" : "them"} into more shots.`);
  }
  const blind = shots.map((s, i) => [i, s]).filter(([, s]) => !str(s.camera));
  if (blind.length) issues.push(`Shot${blind.length === 1 ? "" : "s"} ${blind.map(([i]) => i + 1).join(", ")} ha${blind.length === 1 ? "s" : "ve"} no camera (size, angle, movement).`);
  void asked;

  const names = segment.characters || [];
  const spoken = shots.flatMap((s) => stageLines(s, names));
  const said = norm(spoken.map((l) => l.text).join(" "));
  const script = norm(lines.map((l) => l.text).join(" "));
  const missing = lines.filter((l) => norm(l.text) && !said.includes(norm(l.text)));
  if (missing.length) {
    issues.push(`Screenplay line${missing.length === 1 ? "" : "s"} missing or reworded (speak ${missing.length === 1 ? "it" : "them"} VERBATIM, in the shot where ${missing.length === 1 ? "it lands" : "they land"}): ${missing.map((l) => `${l.speaker}: ${l.text}`).join(" | ")}`);
  }
  const extra = spoken.filter((l) => norm(l.text) && !script.includes(norm(l.text)));
  if (extra.length) {
    issues.push(`Line${extra.length === 1 ? "" : "s"} the screenplay does not have (cut ${extra.length === 1 ? "it" : "them"}): ${extra.map((l) => `${l.speaker || "?"}: ${l.text}`).join(" | ")}`);
  }
  const counts = new Map();
  for (const l of spoken) counts.set(norm(l.text), (counts.get(norm(l.text)) || 0) + 1);
  const twice = [...counts.entries()].filter(([t, n]) => t && n > 1);
  if (twice.length) issues.push(`Line${twice.length === 1 ? "" : "s"} spoken more than once (once only): ${twice.map(([t]) => t).join(" | ")}`);
  return issues;
}

/** The repair turn: the writer's own answer back, with what code found wrong with it. */
export function repairMessages(messages, answer, issues) {
  return [
    ...messages,
    { role: "assistant", content: JSON.stringify(answer) },
    {
      role: "user",
      content: [
        "Checked against the screenplay and the segment's length, that answer has these problems:",
        ...issues.map((t) => `- ${t}`),
        "Write the whole segment again, fixing every one, as ONE JSON object in the same shape and nothing else.",
      ].join("\n"),
    },
  ];
}

// ── Scene lengths, and packing shots into takes ─────────────────────────────

/**
 * Seconds per scene, adding up to `total`: the outline's own `seconds` per
 * scene when it planned exactly these scenes (the writer sized each to its
 * content), else the screen time each scene's words take (weightOf, at least
 * a few seconds each) — scaled to the film's length, whole seconds, each at
 * least `floor`.
 */
export function sceneSecondsFor(scenes, outline = null, total = 60, floor = 3) {
  const planned = Array.isArray(outline) && outline.length === scenes.length && outline.every((o) => Number(o?.seconds) > 0)
    ? outline.map((o) => Number(o.seconds))
    : null;
  const want = planned || scenes.map((sc) => Math.max(floor, sc.reduce((a, el) => a + weightOf(el), 0) + 1.5));
  const sum = want.reduce((a, b) => a + b, 0) || 1;
  const share = want.map((w) => (w / sum) * total);
  const out = share.map((x) => Math.max(floor, Math.floor(x)));
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = share.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
  for (let k = 0; left > 0; k = (k + 1) % out.length, left--) out[order[k]] += 1;
  // Over (every scene held at the floor): take it back from the longest.
  while (left < 0) {
    const i = out.indexOf(Math.max(...out));
    if (out[i] <= floor) break;
    out[i] -= 1;
    left += 1;
  }
  return { seconds: out, from: planned ? "outline" : "content" };
}

/**
 * One scene's shots → takes, the way the studio packs a shot list into ≤15s
 * bundles (worker/src/lib/pack.js packShots): consecutive shots, never across
 * a scene, each take at most `max` seconds — but BALANCED, so a 20s scene is
 * 10 + 10 rather than 15 + 5. A take shorter than `min` (a scene shorter than
 * one generation allows) has its shots stretched to `min`. → [[shot]]
 */
export function packSceneShots(shots, { max = 15, min = 5 } = {}) {
  if (!shots.length) return [];
  const total = shots.reduce((a, s) => a + s.seconds, 0);
  const k = Math.max(1, Math.ceil(total / max));
  const target = total / k;
  const takes = [];
  let cur = [];
  let acc = 0;
  shots.forEach((s, i) => {
    const left = shots.length - i;
    const takesLeft = k - takes.length;
    // Close the current take before this shot when it would overflow, or when
    // it has its share and the rest still fits in the takes left.
    if (cur.length && (acc + s.seconds > max || (acc >= target - s.seconds / 2 && takesLeft > 1 && left >= takesLeft - 1))) {
      takes.push(cur);
      cur = [];
      acc = 0;
    }
    cur.push(s);
    acc += s.seconds;
  });
  if (cur.length) takes.push(cur);
  return takes.map((take) => {
    const sum = take.reduce((a, s) => a + s.seconds, 0);
    if (sum >= min) return take;
    // Stretch: hand the missing seconds to the shots in turn.
    const out = take.map((s) => ({ ...s }));
    for (let need = min - sum, j = 0; need > 0; need--, j = (j + 1) % out.length) out[j].seconds += 1;
    return out;
  });
}
