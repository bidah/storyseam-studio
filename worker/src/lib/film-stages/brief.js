// The AUTHOR'S BRIEF — the prompt read once, before anything is written, on
// the Film's own writer: what KIND of prompt it is, and when it tells a story,
// that story as a contract the World, the Script and the room keep.
//
// Why. Prompts come in two shapes. "A funny story about my cat's revenge" is a
// SEED: the writers should invent, and the prompt is only its tone and premise.
// film-a45e1cb9 ("Star Ronin", 2026-09-29) was the other shape — a whole beat
// sheet: the city at night, a girl turning into an empty corner, "wrong turn,
// girl", "please don't hurt me", a blade crossing the air, the samurai behind
// with his eyes down, "thank you", eyes closed, gone. The screenwriter never saw
// the prompt (only the Idea and the World distilled from it), the World made
// ONE place, and the film kept a third of it. So the prompt is classified, and
// a STORY prompt's beats, lines and places are handed to every writing pass
// word for word and checked where code can check them.
//
// It runs inside the World stage (a stage added in front of it would shift the
// steps of every Film in flight, which map onto stages by position) and is kept
// on that step's result as `brief`; later stages read it from there.
const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim();
const norm = (t) => str(t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();

/** The two shapes a prompt comes in. */
export const BRIEF_KINDS = Object.freeze({
  seed: "a premise, a tone or a subject — the writers invent the story",
  story: "the author tells the story — its events, in order, sometimes its lines — the writers stage it",
});

export function briefMessages(prompt) {
  const system = [
    "You read an author's prompt for a short film before any writer touches it, and say what the author",
    "actually GAVE, so the writers know what is theirs to invent and what is not.",
    "",
    "`kind`:",
    `- "seed" — ${BRIEF_KINDS.seed}. E.g. "a funny story about a cat who hates Mondays".`,
    `- "story" — ${BRIEF_KINDS.story}. The author narrates what happens: first this, then that, and it ends so.`,
    "A prompt that only sets a scene or a mood is a seed, however long; a prompt that lays out events is a story,",
    "however loosely written.",
    "",
    "For a STORY, extract — in the author's order, in plain words, keeping every concrete detail they gave:",
    "- `beats`: each event the author describes, one per entry — what visibly happens (who does what, where).",
    "  Include openings like \"we see the city at night\" and endings like \"when she opens her eyes he is gone\".",
    "- `lines`: every line of speech the author gives or paraphrases (\"saying, wrong turn, girl\" → text",
    "  \"Wrong turn, girl.\"), with who says it (a role or name as the author calls them) and `verbatim` true",
    "  ONLY when the author put the words in quotation marks.",
    "- `places`: every distinct place the story happens in (\"the city at night\", \"an empty corner\"), as short names.",
    "- `characters`: every character the author names or describes, as the author calls them, with their",
    "  look or role in a few words.",
    "For a SEED, leave beats and lines empty and give only what the author did specify (places, characters).",
    "",
    "Always: `premise` one sentence of what the author wants; `tone` a few words (genre, mood, audience);",
    "`references` works or styles the author names (\"Jodorowsky's Incal\", \"Pixar\"); `seconds` the length",
    "the author asks for in seconds (\"a one-minute trailer\" → 60), or null when they name none;",
    "`format` what the piece is (short film, trailer, music video, ad…).",
    "",
    "Answer with ONE JSON object and nothing else:",
    '{ "kind": "seed" | "story", "premise": string, "tone": string, "format": string, "references": [string],',
    '  "seconds": number | null, "beats": [string], "lines": [{ "speaker": string, "text": string, "verbatim": boolean }],',
    '  "places": [string], "characters": [{ "name": string, "note": string }] }',
  ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: `The author's prompt:\n\n${str(prompt)}` },
  ];
}

/** The model's reading → a clean brief. Never throws: a reading that says nothing is a seed. */
export function parseBrief(answer, prompt = "") {
  const a = answer && typeof answer === "object" ? answer : {};
  const list = (v) => (Array.isArray(v) ? v : []);
  const beats = list(a.beats).map(str).filter(Boolean).slice(0, 24);
  const lines = list(a.lines)
    .filter((l) => l && typeof l === "object")
    .map((l) => ({ speaker: str(l.speaker), text: str(l.text).replace(/^["“]+|["”]+$/g, "").trim(), verbatim: l.verbatim === true }))
    .filter((l) => l.text)
    .slice(0, 16);
  // A line the author put in quotation marks is verbatim whatever the reading says.
  const quoted = [...String(prompt).matchAll(/["“]([^"“”]{1,240})["”]/g)].map((m) => norm(m[1]));
  for (const l of lines) if (quoted.includes(norm(l.text))) l.verbatim = true;
  const kind = a.kind === "story" && beats.length >= 2 ? "story" : "seed";
  const seconds = Number(a.seconds);
  return {
    kind,
    premise: str(a.premise),
    tone: str(a.tone),
    format: str(a.format),
    references: list(a.references).map(str).filter(Boolean).slice(0, 6),
    seconds: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null,
    beats: kind === "story" ? beats : [],
    lines: kind === "story" ? lines : lines.filter((l) => l.verbatim),
    places: list(a.places).map(str).filter(Boolean).slice(0, 8),
    characters: list(a.characters)
      .filter((c) => c && typeof c === "object" && str(c.name))
      .map((c) => ({ name: str(c.name), note: str(c.note) }))
      .slice(0, 8),
  };
}

/** A Film's brief, off its World step (null for a Film from before the brief). */
export const briefOf = (job) => job?.steps?.find((s) => s?.key === "world")?.result?.brief || null;

/**
 * What every writing pass is told about the author's prompt: the prompt itself
 * (the writers used to see only the World distilled from it) and, for a story,
 * its beats as a contract. [] for a Film with no prompt.
 */
export function briefLines(prompt, brief) {
  const p = str(prompt);
  if (!p) return [];
  const out = ["THE AUTHOR'S PROMPT, as they typed it:", "<<<", p, ">>>"];
  if (brief?.kind === "story" && brief.beats?.length) {
    out.push(
      "",
      "The author TOLD THE STORY. It is theirs, not yours: every beat below happens on screen, in this order.",
      "You stage it — you may add the connective tissue between beats, give a beat its build-up and its",
      "reaction, and sharpen how it plays — but never drop, replace, reorder or contradict a beat, and never",
      "add a plot the author did not ask for:",
      ...brief.beats.map((b, i) => `  ${i + 1}. ${b}`),
    );
    const said = (brief.lines || []).filter((l) => !l.verbatim);
    if (said.length) {
      out.push(
        "The author's lines — each is spoken, by that character at that beat, in the author's words (tidy the",
        "grammar at most):",
        ...said.map((l) => `  ${l.speaker ? `${l.speaker}: ` : ""}${l.text}`),
      );
    }
    if (brief.places?.length) out.push(`The places the author's story moves through: ${brief.places.join(" · ")}.`);
  } else if (brief) {
    out.push(
      "",
      "The prompt is a SEED — a premise and a tone, not a plot. Invent the story, and make it a strong one;",
      `keep its premise${brief.tone ? ` and its tone (${brief.tone})` : ""}${brief.references?.length ? ` and what it cites (${brief.references.join(", ")})` : ""}.`,
    );
  }
  return out;
}

/**
 * A screenplay against the brief's lines → the ones it does not say. A line
 * counts as said when a dialogue element holds most of its words (the author's
 * paraphrase, tidied), or all of them when the author quoted it.
 */
export function unsaidBriefLines(brief, elements = []) {
  const spoken = (elements || []).filter((el) => el?.type === "dialogue").map((el) => norm(el.text));
  return (brief?.lines || []).filter((l) => {
    const want = norm(l.text);
    if (!want) return false;
    if (spoken.some((s) => s.includes(want))) return false;
    if (l.verbatim) return true;
    const words = want.split(" ").filter((w) => w.length > 2);
    if (!words.length) return false;
    return !spoken.some((s) => {
      const have = new Set(s.split(" "));
      return words.filter((w) => have.has(w)).length / words.length >= 0.6;
    });
  });
}
