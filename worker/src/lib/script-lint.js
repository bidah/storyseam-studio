// Deterministic screenplay lint + a runtime estimate. Pure: no I/O, no env, no
// model.
//
// WHY this is a plain function and not another doctor. The specialists
// (lib/specialists.ts) are advisors — they answer questions that have no exact
// answer: does this scene turn, does the theme land, would an actor believe
// this line. What's in here is the opposite: mechanical faults with EXACTLY one
// right answer. A dialogue block with no character cue above it is wrong; a
// slugline that doesn't start INT./EXT. is wrong; two consecutive cues for the
// same person is wrong. Burning a model pass on those is waste — it costs money
// and seconds, it can hallucinate a fault that isn't there or miss one that is,
// and the author has to wait for it. Here the answer is instant, free,
// identical every time, and carries the element index so the UI can jump
// straight to the offending line. Run this FIRST; spend the doctors on the
// questions only a reader can answer.
//
// Input is the flat screenplay `elements` array — `[{ type, text }]`, one
// element per screenplay line, the same shape the agent's docToElements
// produces and elementsToDoc consumes:
//   scene_heading | action | character | dialogue | parenthetical | transition

const TYPES = [
  "scene_heading",
  "action",
  "character",
  "dialogue",
  "parenthetical",
  "transition",
];

const str = (v) => (v == null ? "" : String(v));
const normType = (t) => (TYPES.includes(str(t)) ? str(t) : "action");
const words = (text) => str(text).trim().split(/\s+/).filter(Boolean).length;

// How the issue's own text is echoed back, so a list of issues is readable
// without re-fetching the script. Clipped — a dense action block can be long.
const excerpt = (text) => {
  const t = str(text).replace(/\s+/g, " ").trim();
  return t.length > 120 ? `${t.slice(0, 119)}…` : t;
};

// A cue may carry an extension — SARA (V.O.), SARA (CONT'D) — which is part of
// the format, not part of the name. Strip it before comparing two cues.
const cueName = (text) => str(text).replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
// The identity key for "is this the same character": casing and spacing are
// formatting, not identity. Two cues that differ only there are the same person
// written two ways — which is what `name-drift` is for.
const cueKey = (text) => cueName(text).toUpperCase();

const SLUG_HEAD = /^\s*(INT\.?\/EXT\.?|EXT\.?\/INT\.?|I\/E\b|INT\.|EXT\.)/i;
// A time-of-day tail is separated by a dash: "INT. KITCHEN - NIGHT".
const SLUG_TIME = /\s[-–—]\s*\S/;

// --- Runtime estimate ------------------------------------------------------
// The page-a-minute rule needs formatted pages, which we don't have (the script
// lives as elements, not paginated), so estimate from word counts instead.
//
//   DIALOGUE_WPS  spoken words per second — 2.6 w/s ≈ 156 wpm, the middle of
//                 the range a performance holds for; slower than conversation.
//   ACTION_WPS    3.3 w/s — screen time reads FASTER than the words say it,
//                 because a line of action describes something the picture
//                 shows in a moment ("She runs" is two words and one second).
//   ACTION_FLOOR  no action block plays in under a second, however terse.
//   SLUG_SECONDS  the cut itself: a new scene heading buys ~1.5s of
//                 establishing before anything in it happens.
//
// This is a PLANNING estimate — enough to answer "is this a 3-minute episode
// or a 9-minute one" before spending a render. It is not a promise, and the
// real runtime is whatever the cut ends up being.
const DIALOGUE_WPS = 2.6;
const ACTION_WPS = 3.3;
const ACTION_FLOOR = 1.0;
const SLUG_SECONDS = 1.5;

// A dialogue block past this reads as a speech, not an exchange.
const LONG_SPEECH_WORDS = 45;
// An action block past this is a paragraph the eye slides off.
const DENSE_ACTION_SENTENCES = 4;

const sentenceCount = (text) =>
  str(text).split(/[.!?]+[\s"')\]]*/).map((s) => s.trim()).filter(Boolean).length;

const mmss = (seconds) => {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/**
 * Lint a screenplay and estimate its runtime.
 *
 * @param {Array<{type?: string, text?: string}>} elements
 * @returns {{ issues: Array<object>, stats: object }}
 *   issues — { code, severity, index, line, message, fix }, where `index` is
 *   the ELEMENT index (so the UI can scroll to it) and `line` is that element's
 *   own text, clipped. Ordered by element index, so the list reads top-to-bottom
 *   like the script does.
 */
export function lintScript(elements) {
  const els = (Array.isArray(elements) ? elements : [])
    .filter((el) => el && typeof el === "object")
    .map((el) => ({ type: normType(el.type), text: str(el.text) }));

  const issues = [];
  const add = (code, severity, index, message, fix) => {
    issues.push({ code, severity, index, line: excerpt(els[index]?.text), message, fix });
  };

  // Nearest neighbour that isn't a parenthetical — the wryly sits INSIDE a
  // speech, so it never counts as the thing before or after one.
  const prevSignificant = (i) => {
    for (let j = i - 1; j >= 0; j--) if (els[j].type !== "parenthetical") return els[j];
    return null;
  };
  const nextSignificant = (i) => {
    for (let j = i + 1; j < els.length; j++) if (els[j].type !== "parenthetical") return els[j];
    return null;
  };

  // --- Per-element rules ---------------------------------------------------
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    const text = el.text.trim();

    if (!text) {
      add(
        "empty-element",
        "medium",
        i,
        `An empty ${el.type.replace("_", " ")} element.`,
        "Type the line, or delete the empty element — a blank cue or slugline breaks the shot list generated from it.",
      );
      continue; // every other rule needs text to judge
    }

    if (el.type === "scene_heading") {
      if (!SLUG_HEAD.test(text)) {
        add(
          "slugline-format",
          "medium",
          i,
          "Scene heading doesn't start with INT. / EXT.",
          'Prefix the slugline with where we are: "INT. " for inside, "EXT. " for outside, "INT./EXT. " for both.',
        );
      }
      if (!SLUG_TIME.test(text)) {
        add(
          "slugline-time",
          "low",
          i,
          "Scene heading has no time of day.",
          `Append a time after a dash — "${text} - DAY" (or NIGHT / DUSK / CONTINUOUS).`,
        );
      }
    }

    if (el.type === "transition" && !/[:.]$/.test(text)) {
      add(
        "transition-format",
        "low",
        i,
        "Transition doesn't end in a colon or a period.",
        `End it with a colon — "${text.toUpperCase()}:".`,
      );
    }

    if (el.type === "dialogue") {
      const before = prevSignificant(i);
      if (!before || before.type !== "character") {
        add(
          "orphan-dialogue",
          "high",
          i,
          "Dialogue with no character cue above it — nobody is speaking this.",
          "Add a CHARACTER cue directly above this line, or change the element's type to Action if it isn't spoken.",
        );
      }
      const n = words(text);
      if (n > LONG_SPEECH_WORDS) {
        add(
          "long-speech",
          "low",
          i,
          `A single speech of ${n} words (about ${Math.round(n / DIALOGUE_WPS)}s on screen).`,
          "Break it up: interrupt with a reaction, split it across the scene, or cut it to the two lines that carry the point.",
        );
      }
    }

    if (el.type === "character") {
      const after = nextSignificant(i);
      if (!after || after.type !== "dialogue") {
        add(
          "dangling-character",
          "high",
          i,
          `Cue for ${cueName(text) || text} is followed by no dialogue.`,
          `Write ${cueName(text) || "the character"}'s line under the cue, or delete the cue — if they act without speaking, put it in an Action line instead.`,
        );
      }
    }

    if (el.type === "parenthetical") {
      const before = prevSignificant(i);
      const after = nextSignificant(i);
      // Valid in two places: right under a cue (before the speech) and mid
      // speech between two dialogue blocks — both are standard format. Anywhere
      // else it's an action beat wearing brackets.
      const underCue = before?.type === "character" && after?.type === "dialogue";
      const midSpeech = before?.type === "dialogue" && after?.type === "dialogue";
      if (!underCue && !midSpeech) {
        add(
          "stray-parenthetical",
          "medium",
          i,
          "A parenthetical that isn't inside a speech.",
          "Move it under the character cue it belongs to, or rewrite it as an Action line — a wryly only reads as direction when it sits with the line it directs.",
        );
      }
    }

    if (el.type === "action") {
      const s = sentenceCount(text);
      if (s > DENSE_ACTION_SENTENCES) {
        add(
          "dense-action",
          "low",
          i,
          `An action block of ${s} sentences.`,
          "Split it into blocks of one to three sentences — one block per beat or per shot, so the storyboard pass has something to cut on.",
        );
      }
    }
  }

  // --- Opening -------------------------------------------------------------
  if (els.length && els[0].type !== "scene_heading") {
    add(
      "missing-opening-slug",
      "low",
      0,
      "The script opens on something other than a scene heading.",
      'Start with a slugline — "INT. SOMEWHERE - DAY" — so the first scene has a place and a time to render.',
    );
  }

  // --- Cross-element: consecutive cues, and the same name spelled two ways --
  // Walk the cues in order, remembering what sat between them.
  const cues = [];
  for (let i = 0; i < els.length; i++) {
    if (els[i].type === "character" && els[i].text.trim()) cues.push(i);
  }
  for (let k = 1; k < cues.length; k++) {
    const prev = cues[k - 1];
    const cur = cues[k];
    // "Consecutive" means nothing but that first speech sits between them.
    let onlySpeech = true;
    for (let j = prev + 1; j < cur; j++) {
      if (els[j].type !== "dialogue" && els[j].type !== "parenthetical") { onlySpeech = false; break; }
    }
    if (!onlySpeech) continue;
    if (cueKey(els[prev].text) && cueKey(els[prev].text) === cueKey(els[cur].text)) {
      add(
        "duplicate-cue",
        "medium",
        cur,
        `${cueName(els[cur].text)} is cued twice in a row with nothing in between.`,
        `Delete this second cue and merge the two speeches into one block under the first — or put a beat (an action line, another character's line) between them if the break is deliberate.`,
      );
    }
  }

  // name-drift: one identity, several spellings. Reported once per group, at
  // the first cue in it, because fifteen cues for the same drifting name is one
  // decision to make, not fifteen.
  const byKey = new Map();
  for (const i of cues) {
    const key = cueKey(els[i].text);
    if (!key) continue;
    const name = cueName(els[i].text);
    const g = byKey.get(key) || { first: i, variants: new Map() };
    if (!g.variants.has(name)) g.variants.set(name, i);
    byKey.set(key, g);
  }
  for (const [, g] of byKey) {
    if (g.variants.size < 2) continue;
    const variants = [...g.variants.keys()];
    // The spelling used by the most cues wins the suggestion; ties go to the
    // first one written.
    const counts = new Map(variants.map((v) => [v, 0]));
    for (const i of cues) {
      const name = cueName(els[i].text);
      if (counts.has(name)) counts.set(name, counts.get(name) + 1);
    }
    const winner = variants.reduce((a, b) => (counts.get(b) > counts.get(a) ? b : a), variants[0]);
    add(
      "name-drift",
      "medium",
      g.first,
      `One character is cued ${variants.length} different ways: ${variants.join(", ")}.`,
      `Rename every cue to "${winner}" — the cue text is the key the cast, the voice pipeline and the shot list all match on, so a drifted spelling reads as a second character.`,
    );
  }

  issues.sort((a, b) => a.index - b.index);

  // --- Stats + runtime -----------------------------------------------------
  let scenes = 0;
  let actionBlocks = 0;
  let dialogueLines = 0;
  let totalWords = 0;
  let dialogueWords = 0;
  let seconds = 0;
  const cast = new Map();
  let speaker = null;

  for (const el of els) {
    const text = el.text.trim();
    const n = words(text);
    totalWords += n;
    switch (el.type) {
      case "scene_heading":
        scenes += 1;
        seconds += SLUG_SECONDS;
        speaker = null;
        break;
      case "action":
        if (!text) break;
        actionBlocks += 1;
        seconds += Math.max(ACTION_FLOOR, n / ACTION_WPS);
        speaker = null;
        break;
      case "character":
        speaker = cueName(text) || null;
        break;
      case "dialogue": {
        if (!text) break;
        dialogueLines += 1;
        dialogueWords += n;
        seconds += n / DIALOGUE_WPS;
        // Keyed by identity, not by spelling: SARA and Sara are one member of
        // the cast with one line count. (The drift itself is reported as an
        // issue — it must not also split the roster, or every count downstream
        // of this, the producer's included, sees two characters.)
        const who = speaker || "(uncredited)";
        const key = cueKey(who) || "(UNCREDITED)";
        const row = cast.get(key) || { name: who, lines: 0, words: 0 };
        row.lines += 1;
        row.words += n;
        cast.set(key, row);
        break;
      }
      default:
        break;
    }
  }

  const characters = [...cast.values()].sort(
    (a, b) => b.lines - a.lines || b.words - a.words || a.name.localeCompare(b.name),
  );

  return {
    issues,
    stats: {
      elements: els.length,
      lines: els.filter((el) => el.text.trim()).length,
      scenes,
      actionBlocks,
      dialogueLines,
      words: totalWords,
      dialogueWords,
      estimatedSeconds: Math.round(seconds * 10) / 10,
      estimatedRuntime: mmss(seconds),
      characters,
    },
  };
}

/**
 * The pinned draft's ProseMirror doc → the flat elements array this lints.
 *
 * Deliberately NOT the agent's docToElements: that one drops every empty block,
 * which is right for feeding a model and wrong for a linter — a blank CHARACTER
 * cue or a blank slugline is exactly the fault `empty-element` exists to catch,
 * and dropping it also shifts every index after it, so the UI would jump to the
 * wrong line. Empty blocks are kept when they carry a screenplay type, and
 * dropped when they're the editor's own escape-hatch paragraphs.
 */
export function elementsFromDoc(doc) {
  const blocks = doc && doc.type === "doc" && Array.isArray(doc.content) ? doc.content : [];
  const textOf = (node) => {
    if (!node || typeof node !== "object") return "";
    if (typeof node.text === "string") return node.text;
    return (Array.isArray(node.content) ? node.content : []).map(textOf).join("");
  };
  const out = [];
  for (const node of blocks) {
    if (node?.type === "title") continue; // legacy; the title lives outside the doc
    const text = textOf(node).trim();
    const screenplay = node?.type === "screenplay";
    if (!text && !screenplay) continue; // a bare empty paragraph is the editor, not the script
    out.push({ type: screenplay ? normType(node?.attrs?.spType) : "action", text });
  }
  // A trailing empty block is how the editor keeps a cursor below the last line,
  // not a fault the author left behind.
  while (out.length && !out[out.length - 1].text) out.pop();
  return out;
}
